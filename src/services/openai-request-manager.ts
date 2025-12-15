import crypto from 'crypto';
import { config } from '../config';

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface TenantUsageTracker {
  tokensUsed: number;
  resetAt: number;
}

export interface ExecuteOptions<T> {
  tenantId?: string;
  requestName: string;
  promptSnippet?: string;
  cacheKey?: string;
  operation: () => Promise<{ value: T; usage?: TokenUsage }>;
}

class OpenAIRequestManager {
  private tenantUsage = new Map<string, TenantUsageTracker>();
  private globalUsage: TenantUsageTracker = { tokensUsed: 0, resetAt: this.getNextResetTimestamp() };
  private cache = new Map<string, CacheEntry<unknown>>();
  private failureCount = 0;
  private breakerOpenUntil = 0;

  public buildCacheKey(requestName: string, ...parts: Array<unknown>): string {
    const hash = crypto.createHash('sha256');
    hash.update(requestName);
    for (const part of parts) {
      if (part === undefined || part === null) {
        continue;
      }
      const serialized = typeof part === 'string' ? part : JSON.stringify(part);
      hash.update(serialized);
    }
    return hash.digest('hex');
  }

  public async execute<T>(options: ExecuteOptions<T>): Promise<T> {
    const tenantId = options.tenantId || config.OPENAI_DEFAULT_TENANT_ID || 'global';
    this.resetUsageWindow(this.globalUsage);
    this.resetUsageWindow(this.ensureTenantTracker(tenantId));

    if (this.isCircuitOpen()) {
      return this.returnCachedOrThrow<T>(options.cacheKey, `[OpenAI][${options.requestName}] circuit breaker active`);
    }

    if (this.isGlobalBudgetExceeded()) {
      return this.returnCachedOrThrow<T>(options.cacheKey, '[OpenAI] Global token budget exhausted');
    }

    if (this.isTenantBudgetExceeded(tenantId)) {
      return this.returnCachedOrThrow<T>(options.cacheKey, `[OpenAI][tenant=${tenantId}] quota exhausted`);
    }

    const maxRetries = Math.max(1, config.OPENAI_MAX_RETRIES || 3);
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt += 1;
      const startedAt = Date.now();
      try {
        const { value, usage } = await options.operation();
        const durationMs = Date.now() - startedAt;
        this.failureCount = 0;
        this.recordUsage(tenantId, usage);
        this.logSuccess(options.requestName, tenantId, durationMs, usage, options.promptSnippet);
        if (options.cacheKey) {
          this.cacheResult(options.cacheKey, value);
        }
        return value;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        this.failureCount += 1;
        this.logFailure(options.requestName, tenantId, attempt, durationMs, error, options.promptSnippet);
        if (this.failureCount >= config.OPENAI_CIRCUIT_BREAK_THRESHOLD) {
          this.openCircuit();
        }
        if (attempt >= maxRetries) {
          return this.returnCachedOrThrow<T>(
            options.cacheKey,
            `[OpenAI][${options.requestName}] failed after ${attempt} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
        await this.sleep(Math.pow(2, attempt - 1) * 250);
      }
    }

    return this.returnCachedOrThrow<T>(options.cacheKey, `[OpenAI][${options.requestName}] execution aborted`);
  }

  private recordUsage(tenantId: string, usage?: TokenUsage): void {
    if (!usage) {
      return;
    }
    const tokens = usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0);
    if (!tokens) {
      return;
    }
    this.globalUsage.tokensUsed += tokens;
    const tenantTracker = this.ensureTenantTracker(tenantId);
    tenantTracker.tokensUsed += tokens;
  }

  private logSuccess(
    requestName: string,
    tenantId: string,
    durationMs: number,
    usage: TokenUsage | undefined,
    promptSnippet?: string
  ): void {
    const tokens = usage?.total_tokens ?? 'n/a';
    console.log(
      `[OpenAI][${requestName}] tenant=${tenantId} duration=${durationMs}ms tokens=${tokens} prompt="${this.formatPrompt(promptSnippet)}"`
    );
  }

  private logFailure(
    requestName: string,
    tenantId: string,
    attempt: number,
    durationMs: number,
    error: unknown,
    promptSnippet?: string
  ): void {
    console.warn(
      `[OpenAI][${requestName}] tenant=${tenantId} attempt=${attempt} duration=${durationMs}ms error=${
        error instanceof Error ? error.message : String(error)
      } prompt="${this.formatPrompt(promptSnippet)}"`
    );
  }

  private formatPrompt(snippet?: string): string {
    if (!snippet) {
      return '';
    }
    const trimmed = snippet.replace(/\s+/g, ' ').trim();
    return trimmed.length > 120 ? `${trimmed.substring(0, 117)}...` : trimmed;
  }

  private isCircuitOpen(): boolean {
    if (!this.breakerOpenUntil) {
      return false;
    }
    if (Date.now() >= this.breakerOpenUntil) {
      this.breakerOpenUntil = 0;
      this.failureCount = 0;
      return false;
    }
    return true;
  }

  private openCircuit(): void {
    if (this.breakerOpenUntil && Date.now() < this.breakerOpenUntil) {
      return;
    }
    const cooldown = config.OPENAI_CIRCUIT_BREAK_COOLDOWN_MS || 300000;
    this.breakerOpenUntil = Date.now() + cooldown;
    console.warn(`[OpenAI] Circuit breaker opened for ${cooldown}ms after repeated failures.`);
  }

  private returnCachedOrThrow<T>(cacheKey: string | undefined, reason: string): T {
    const cached = this.getCached<T>(cacheKey);
    if (cached !== undefined) {
      console.warn(`${reason}; returning cached response.`);
      return cached;
    }
    throw new Error(reason);
  }

  private cacheResult<T>(cacheKey: string, value: T): void {
    const ttl = config.OPENAI_CACHE_TTL_MS || 3600000;
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + ttl });
  }

  private getCached<T>(cacheKey?: string): T | undefined {
    if (!cacheKey) {
      return undefined;
    }
    const entry = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }
    return entry.value;
  }

  private isGlobalBudgetExceeded(): boolean {
    const limit = config.OPENAI_GLOBAL_DAILY_BUDGET_TOKENS;
    if (!limit) {
      return false;
    }
    return this.globalUsage.tokensUsed >= limit;
  }

  private isTenantBudgetExceeded(tenantId: string): boolean {
    const limit = config.OPENAI_TENANT_DAILY_QUOTA_TOKENS;
    if (!limit) {
      return false;
    }
    const tracker = this.ensureTenantTracker(tenantId);
    return tracker.tokensUsed >= limit;
  }

  private ensureTenantTracker(tenantId: string): TenantUsageTracker {
    const existing = this.tenantUsage.get(tenantId);
    if (existing) {
      return existing;
    }
    const tracker: TenantUsageTracker = { tokensUsed: 0, resetAt: this.getNextResetTimestamp() };
    this.tenantUsage.set(tenantId, tracker);
    return tracker;
  }

  private resetUsageWindow(tracker: TenantUsageTracker): void {
    if (Date.now() >= tracker.resetAt) {
      tracker.tokensUsed = 0;
      tracker.resetAt = this.getNextResetTimestamp();
    }
  }

  private getNextResetTimestamp(): number {
    return Date.now() + 24 * 60 * 60 * 1000;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const openAIRequestManager = new OpenAIRequestManager();
