import { OpenAI } from 'openai';
import { config } from '../config';
import { openAIRequestManager, TokenUsage } from './openai-request-manager';
import {
  NOCApplication,
  ComplianceResult,
  RiskAssessment,
  EvaluationResult,
} from '../types';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// Logging utility for LLM calls
function logLLMCall(operation: string, model: string, tokens?: number, duration?: number) {
  const timestamp = new Date().toISOString();
  console.log(`[LLM] ${timestamp} | Operation: ${operation} | Model: ${model}${tokens ? ` | Tokens: ${tokens}` : ''}${duration ? ` | Duration: ${duration}ms` : ''}`);
}

// Calculate weighted evaluation score
function calculateOverallScore(compliance: ComplianceResult, risk: RiskAssessment): number {
  const complianceScore = compliance.score;
  const securityScore = 100 - risk.riskScore; // Invert risk score for security score
  const documentationScore = compliance.issues.length === 0 ? 100 : Math.max(0, 100 - (compliance.issues.length * 10));
  const technicalScore = risk.threats.length === 0 ? 100 : Math.max(0, 100 - (risk.threats.length * 15));

  const weights = config.EVALUATION_WEIGHTS;
  const overallScore = 
    (complianceScore * weights.COMPLIANCE) +
    (securityScore * weights.SECURITY) +
    (documentationScore * weights.DOCUMENTATION) +
    (technicalScore * weights.TECHNICAL);

  return Math.round(overallScore);
}

// Determine risk level based on score
function determineRiskLevel(riskScore: number): 'critical' | 'high' | 'medium' | 'low' {
  const thresholds = config.RISK_THRESHOLDS;
  if (riskScore >= thresholds.CRITICAL) return 'critical';
  if (riskScore >= thresholds.HIGH) return 'high';
  if (riskScore >= thresholds.MEDIUM) return 'medium';
  return 'low';
}

// Response type for OpenAI Responses API
interface OpenAIResponsesData {
  status?: string;
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
    }>;
  }>;
  error?: { message: string };
  usage?: TokenUsage;
}

// Helper function for new OpenAI Responses API (gpt-5.1)
async function callOpenAIResponsesAPI(
  input: string,
  options?: { reasoning?: boolean },
  metadata?: { tenantId?: string; cacheKey?: string; requestName?: string }
): Promise<string> {
  const url = 'https://api.openai.com/v1/responses';
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input,
  };

  if (options?.reasoning) {
    body.reasoning = { effort: 'medium' };
  }

  console.log(`🤖 [OpenAI Responses API] Starting request - Model: ${body.model}, Reasoning: ${options?.reasoning || false}`);

  return openAIRequestManager.execute<string>({
    tenantId: metadata?.tenantId,
    requestName: metadata?.requestName || 'evaluation.callOpenAIResponsesAPI',
    promptSnippet: input,
    cacheKey:
      metadata?.cacheKey ||
      openAIRequestManager.buildCacheKey(
        'evaluation.callOpenAIResponsesAPI',
        input.length,
        options?.reasoning
      ),
    operation: async () => {
      const startedAt = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`❌ [OpenAI] Error:`, error);
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data: OpenAIResponsesData = await response.json() as OpenAIResponsesData;
      const totalTime = Date.now() - startedAt;
      console.log(`✅ [OpenAI] Response received - Time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
      
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem.type === 'output_text' && contentItem.text) {
                return { value: contentItem.text, usage: data.usage };
              }
            }
          }
        }
      }
      
      return { value: '', usage: data.usage };
    }
  });
}

interface ChatResult {
  content: string;
  usage?: TokenUsage;
}

interface ChatCompletionOptions {
  prompt: string;
  tenantId: string;
  operation: string;
  maxTokens?: number;
  cacheKey?: string;
}

async function runTrackedChatCompletion(options: ChatCompletionOptions): Promise<ChatResult> {
  return openAIRequestManager.execute<ChatResult>({
    tenantId: options.tenantId,
    requestName: options.operation,
    promptSnippet: options.prompt,
    cacheKey:
      options.cacheKey ||
      openAIRequestManager.buildCacheKey(
        options.operation,
        options.tenantId,
        options.prompt.length,
        options.maxTokens
      ),
    operation: async () => {
      const message = await openai.chat.completions.create({
        model: config.OPENAI_MODEL,
        messages: [{ role: 'user', content: options.prompt }],
        max_completion_tokens: options.maxTokens ?? config.OPENAI_MAX_TOKENS,
      });

      const usage: TokenUsage | undefined = message.usage
        ? {
            input_tokens: message.usage.prompt_tokens,
            output_tokens: message.usage.completion_tokens,
            total_tokens: message.usage.total_tokens,
          }
        : undefined;

      return {
        value: {
          content: message.choices[0].message.content || '',
          usage,
        },
        usage,
      };
    }
  });
}

export class EvaluationService {
  // Single-call evaluation to reduce OpenAI usage - Uses GPT-5.1 Responses API
  async evaluateApplicationSingleCall(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<EvaluationResult> {
    const startTime = Date.now();
    const context = contextFiles?.join('\n---\n') || 'No additional context provided.';

    console.log(`\n📊 [EVALUATION START] Application: ${application.name} v${application.version}`);
    console.log(`🔧 Using LLM Model: ${config.OPENAI_MODEL} (Responses API)`);
    console.log(`📋 Max Tokens: ${config.OPENAI_MAX_TOKENS}`);
    console.log(`⚖️  Evaluation Weights: Compliance=${config.EVALUATION_WEIGHTS.COMPLIANCE * 100}%, Security=${config.EVALUATION_WEIGHTS.SECURITY * 100}%, Docs=${config.EVALUATION_WEIGHTS.DOCUMENTATION * 100}%, Technical=${config.EVALUATION_WEIGHTS.TECHNICAL * 100}%`);

    const prompt = `You are a senior regulatory evaluator for the Pakistan Virtual Assets Regulatory Authority (PVARA). 
You are conducting a comprehensive NOC (No Objection Certificate) evaluation for a Virtual Asset Service Provider (VASP) license application.

🏢 **APPLICATION DETAILS:**
- Name: ${application.name}
- Vendor/Applicant: ${application.vendor}
- Version: ${application.version}
- Description: ${application.description}

📄 **SUBMITTED DOCUMENTS/CONTEXT:**
${context}

🔍 **EVALUATION REQUIREMENTS:**
Conduct a DETAILED assessment covering:

1. **REGULATORY COMPLIANCE** (Weight: 40%)
   - PVARA Regulations compliance
   - FATF Recommendations alignment (especially Rec. 15 for VASPs)
   - AML/CFT Act 2010 (Pakistan) requirements
   - SBP regulations for digital payments
   - KYC/CDD requirements under AMLA
   - Travel Rule compliance readiness
   - Licensing prerequisites checklist

2. **SECURITY & RISK ASSESSMENT** (Weight: 30%)
   - Cybersecurity framework adequacy
   - Cold/hot wallet security measures
   - Multi-signature requirements
   - Incident response procedures
   - Business continuity planning
   - Insurance/reserve requirements
   - Third-party security audits

3. **DOCUMENTATION REVIEW** (Weight: 15%)
   - Business plan completeness
   - Organizational structure clarity
   - Beneficial ownership disclosure
   - Source of funds documentation
   - Policies and procedures manuals
   - Board/management qualifications

4. **TECHNICAL INFRASTRUCTURE** (Weight: 15%)
   - Transaction monitoring systems
   - Blockchain analytics integration
   - Sanctions screening capability
   - Record-keeping systems (5-year retention)
   - Reporting mechanisms (STR/CTR)
   - System audit trails

📋 **RESPONSE FORMAT:**
Provide a comprehensive JSON response with detailed findings:

{
  "compliance": {
    "compliant": boolean,
    "score": number (0-100),
    "overallAssessment": "string - 2-3 sentence summary of compliance status",
    "issues": [
      {
        "severity": "critical|high|medium|low",
        "category": "string (e.g., KYC/AML, Licensing, FATF, Cybersecurity)",
        "description": "Detailed description of the issue",
        "regulatoryReference": "Specific regulation/guideline being violated",
        "recommendation": "Specific remediation steps required",
        "deadline": "Suggested timeline for remediation"
      }
    ],
    "recommendations": ["Array of general improvement recommendations"],
    "requiredDocuments": ["List of any missing required documents"],
    "conditionalApproval": boolean,
    "conditionsForApproval": ["If conditional, list specific conditions"]
  },
  "risk": {
    "riskLevel": "critical|high|medium|low",
    "riskScore": number (0-100, higher = more risky),
    "riskSummary": "2-3 sentence risk assessment summary",
    "threats": [
      {
        "type": "string (e.g., Money Laundering, Terrorist Financing, Fraud, Cyber Attack)",
        "likelihood": "high|medium|low",
        "impact": "high|medium|low",
        "description": "Detailed threat description",
        "existingControls": "What controls exist (if any)",
        "controlGaps": "What's missing",
        "recommendedMitigation": "Specific mitigation measures"
      }
    ],
    "mitigations": ["General risk mitigation recommendations"],
    "monitoringRequirements": ["Ongoing monitoring requirements if approved"]
  },
  "summary": "Comprehensive executive summary (4-6 sentences) covering overall assessment, key concerns, recommendation (approve/reject/conditional), and next steps"
}

Be thorough, specific, and cite relevant Pakistani regulations where applicable. Identify ALL gaps and provide actionable recommendations.`;

    try {
      // Use OpenAI Responses API with reasoning for thorough analysis
      const responseText = await callOpenAIResponsesAPI(
        prompt,
        { reasoning: true },
        {
          tenantId: application.id,
          cacheKey: openAIRequestManager.buildCacheKey(
            'evaluation.singleCall',
            application.id,
            context.length
          ),
          requestName: 'evaluation.singleCall',
        }
      );
      
      const duration = Date.now() - startTime;
      logLLMCall('evaluateApplicationSingleCall', config.OPENAI_MODEL, undefined, duration);

      // Extract JSON from response (handle markdown code blocks)
      let jsonContent = responseText;
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1].trim();
      }
      
      const parsed = JSON.parse(jsonContent);
      
      const compliance = parsed.compliance || { compliant: true, score: 75, issues: [], recommendations: ['Manual review recommended'] };
      const risk = parsed.risk || { riskLevel: 'medium', riskScore: 50, threats: [], mitigations: ['Manual review recommended'] };
      const overallScore = calculateOverallScore(compliance, risk);
      
      console.log(`✅ [EVALUATION COMPLETE] Overall Score: ${overallScore}/100`);
      console.log(`   Compliance: ${compliance.score}/100 | Risk: ${risk.riskLevel} (${risk.riskScore}/100)`);
      console.log(`   Issues: ${compliance.issues?.length || 0} | Threats: ${risk.threats?.length || 0}`);
      
      return {
        applicationId: application.id,
        compliance,
        risk,
        summary: parsed.summary || 'Evaluation completed.',
        evaluatedAt: new Date(),
      };
    } catch (error) {
      console.error(`❌ [EVALUATION ERROR] Failed to parse LLM response:`, error);
      const compliance = await this.assessCompliance(application, contextFiles);
      const risk = await this.assessRisk(application, contextFiles);
      const summary = await this.generateSummary(application, compliance, risk);
      return {
        applicationId: application.id,
        compliance,
        risk,
        summary,
        evaluatedAt: new Date(),
      };
    }
  }
  async evaluateApplication(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<EvaluationResult> {
    const compliance = await this.assessCompliance(application, contextFiles);
    const risk = await this.assessRisk(application, contextFiles);
    const summary = await this.generateSummary(application, compliance, risk);

    return {
      applicationId: application.id,
      compliance,
      risk,
      summary,
      evaluatedAt: new Date(),
    };
  }

  private async assessCompliance(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<ComplianceResult> {
    const startTime = Date.now();
    const context = contextFiles?.join('\n---\n') || 'No additional context provided.';

    console.log(`\n🔍 [COMPLIANCE CHECK] Assessing compliance for ${application.name}`);

    const prompt = `You are a NOC compliance expert. Evaluate the following application for compliance issues.

Application Details:
Name: ${application.name}
Vendor: ${application.vendor}
Version: ${application.version}
Description: ${application.description}

Additional Context:
${context}

Provide a JSON response with:
{
  "compliant": boolean,
  "score": number (0-100),
  "issues": [{"severity": "critical|high|medium|low", "category": string, "description": string, "recommendation": string}],
  "recommendations": [string]
}`;

    const chatResult = await runTrackedChatCompletion({
      prompt,
      tenantId: application.id,
      operation: 'evaluation.assessCompliance',
      maxTokens: config.OPENAI_MAX_TOKENS,
    });

    const duration = Date.now() - startTime;
    logLLMCall('assessCompliance', config.OPENAI_MODEL, chatResult.usage?.total_tokens, duration);

    try {
      const content = chatResult.content || '{}';
      const result = JSON.parse(content);
      console.log(`   ✓ Compliance Score: ${result.score}/100 | Issues: ${result.issues?.length || 0}`);
      return result;
    } catch (error) {
      console.error(`   ✗ Failed to parse compliance response:`, error);
      return {
        compliant: true,
        score: 75,
        issues: [],
        recommendations: ['Manual review recommended'],
      };
    }
  }

  private async assessRisk(
    application: NOCApplication,
    contextFiles?: string[]
  ): Promise<RiskAssessment> {
    const startTime = Date.now();
    const context = contextFiles?.join('\n---\n') || 'No additional context provided.';

    console.log(`\n🛡️  [RISK ASSESSMENT] Analyzing security risks for ${application.name}`);

    const prompt = `You are a security risk assessment expert for NOC systems. Evaluate the following application for security risks.

Application Details:
Name: ${application.name}
Vendor: ${application.vendor}
Version: ${application.version}
Description: ${application.description}

Additional Context:
${context}

Provide a JSON response with:
{
  "riskLevel": "critical|high|medium|low",
  "riskScore": number (0-100),
  "threats": [{"type": string, "likelihood": "high|medium|low", "impact": "high|medium|low", "description": string}],
  "mitigations": [string]
}`;

    const chatResult = await runTrackedChatCompletion({
      prompt,
      tenantId: application.id,
      operation: 'evaluation.assessRisk',
      maxTokens: config.OPENAI_MAX_TOKENS,
    });

    const duration = Date.now() - startTime;
    logLLMCall('assessRisk', config.OPENAI_MODEL, chatResult.usage?.total_tokens, duration);

    try {
      const content = chatResult.content || '{}';
      const result = JSON.parse(content);
      const calculatedLevel = determineRiskLevel(result.riskScore);
      result.riskLevel = calculatedLevel; // Override with calculated risk level
      console.log(`   ✓ Risk Level: ${result.riskLevel} (${result.riskScore}/100) | Threats: ${result.threats?.length || 0}`);
      return result;
    } catch (error) {
      console.error(`   ✗ Failed to parse risk response:`, error);
      return {
        riskLevel: 'medium',
        riskScore: 50,
        threats: [],
        mitigations: ['Manual review recommended'],
      };
    }
  }

  private async generateSummary(
    application: NOCApplication,
    compliance: ComplianceResult,
    risk: RiskAssessment
  ): Promise<string> {
    const startTime = Date.now();
    const overallScore = calculateOverallScore(compliance, risk);
    
    console.log(`\n📝 [SUMMARY GENERATION] Creating executive summary`);
    
    const prompt = `Create a concise executive summary (2-3 sentences) for NOC evaluation of:
Application: ${application.name} v${application.version}
Overall Score: ${overallScore}/100
Compliance Score: ${compliance.score}/100
Risk Level: ${risk.riskLevel}
Critical Issues: ${compliance.issues.filter(i => i.severity === 'critical').length}
Key Threats: ${risk.threats.slice(0, 2).map(t => t.type).join(', ')}`;

    const chatResult = await runTrackedChatCompletion({
      prompt,
      tenantId: application.id,
      operation: 'evaluation.generateSummary',
      maxTokens: config.OPENAI_MAX_TOKENS,
    });

    const duration = Date.now() - startTime;
    logLLMCall('generateSummary', config.OPENAI_MODEL, chatResult.usage?.total_tokens, duration);

    return chatResult.content || 'Evaluation completed.';
  }

  async processVoiceQuery(query: string, applicationId: string): Promise<string> {
    const startTime = Date.now();
    console.log(`\n🎤 [VOICE QUERY] Processing: "${query}" for app ${applicationId}`);
    
    const prompt = `You are a helpful NOC operations assistant. Answer this question about the NOC application evaluation:
Question: ${query}
Application ID: ${applicationId}

Provide a helpful, concise response that can be read aloud.`;

    const chatResult = await runTrackedChatCompletion({
      prompt,
      tenantId: applicationId,
      operation: 'evaluation.processVoiceQuery',
      maxTokens: 1500,
    });

    const duration = Date.now() - startTime;
    logLLMCall('processVoiceQuery', config.OPENAI_MODEL, chatResult.usage?.total_tokens, duration);

    return chatResult.content || 'I could not process your question.';
  }

  async generateTextToSpeech(text: string): Promise<Buffer> {
    return openAIRequestManager.execute<Buffer>({
      tenantId: 'tts',
      requestName: 'evaluation.generateTextToSpeech',
      promptSnippet: text,
      cacheKey: openAIRequestManager.buildCacheKey('evaluation.tts', text),
      operation: async () => {
        const speech = await openai.audio.speech.create({
          model: 'tts-1',
          voice: 'nova',
          input: text,
        });

        const buffer = Buffer.from(await speech.arrayBuffer());
        return { value: buffer };
      }
    });
  }
}

export const evaluationService = new EvaluationService();
