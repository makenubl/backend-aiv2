/**
 * OpenAI Responses API Service
 * Uses the new /v1/responses endpoint with gpt-5.1 model
 * 
 * Capabilities:
 * 1. Basic text completion
 * 2. Reasoning (with effort levels: low, medium, high)
 * 3. Web search
 * 4. File/document analysis
 */

import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import { config } from '../config';
import { openAIRequestManager, TokenUsage } from './openai-request-manager';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const fsp = fs.promises;
const openaiClient = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

interface OpenAIFileCacheRecord {
  fileId: string;
  size: number;
  mtimeMs: number;
  uploadedAt: string;
  filename: string;
}

const OPENAI_FILE_CACHE_PATH = path.join(process.cwd(), '.cache', 'openai-files.json');
const openaiFileCache = new Map<string, OpenAIFileCacheRecord>();
const inflightFileUploads = new Map<string, Promise<string>>();

function loadOpenAIFileCache(): void {
  try {
    if (fs.existsSync(OPENAI_FILE_CACHE_PATH)) {
      const raw = fs.readFileSync(OPENAI_FILE_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, OpenAIFileCacheRecord>;
      for (const [key, value] of Object.entries(parsed)) {
        openaiFileCache.set(key, value);
      }
    }
  } catch (error) {
    console.warn('⚠️  Failed to load OpenAI file cache:', error);
  }
}

async function persistOpenAIFileCache(): Promise<void> {
  try {
    const dir = path.dirname(OPENAI_FILE_CACHE_PATH);
    await fsp.mkdir(dir, { recursive: true });
    const contents = JSON.stringify(Object.fromEntries(openaiFileCache.entries()), null, 2);
    await fsp.writeFile(OPENAI_FILE_CACHE_PATH, contents, 'utf-8');
  } catch (error) {
    console.warn('⚠️  Failed to persist OpenAI file cache:', error);
  }
}

loadOpenAIFileCache();

interface OpenAIResponseOutput {
  id: string;
  type: string;
  status: string;
  content: Array<{
    type: string;
    text: string;
    annotations?: any[];
  }>;
  role: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created_at: number;
  status: string;
  model: string;
  output: OpenAIResponseOutput[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: any;
}

export interface OpenAIRequestOptions {
  tenantId?: string;
  cacheKey?: string;
}

/**
 * Extract text from OpenAI Response
 */
function extractResponseText(response: OpenAIResponse | any): string {
  if (response?.error) {
    throw new Error(response.error.message || 'OpenAI API error');
  }

  const outputs: any[] = Array.isArray(response?.output) ? response.output : [];
  for (const output of outputs) {
    if (!output || !Array.isArray(output.content)) continue;
    for (const contentItem of output.content) {
      if (!contentItem) continue;
      if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
        return contentItem.text;
      }
      if (contentItem.type === 'text') {
        if (typeof contentItem.text === 'string') {
          return contentItem.text;
        }
        if (contentItem.text && typeof contentItem.text.value === 'string') {
          return contentItem.text.value;
        }
      }
    }
  }
  return '';
}

/**
 * Basic text completion using gpt-5.1
 */
export async function textCompletion(
  input: string,
  instructions?: string,
  requestOptions?: OpenAIRequestOptions
): Promise<string> {
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input
  };
  
  if (instructions) {
    body.instructions = instructions;
  }

  return openAIRequestManager.execute<string>({
    tenantId: requestOptions?.tenantId,
    requestName: 'textCompletion',
    promptSnippet: typeof input === 'string' ? input : JSON.stringify(input),
    cacheKey:
      requestOptions?.cacheKey ||
      openAIRequestManager.buildCacheKey('textCompletion', instructions, input),
    operation: async () => {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        body: JSON.stringify(body)
      });
  
      const data = await response.json() as OpenAIResponse;
      return { value: extractResponseText(data), usage: data.usage };
    }
  });
}

/**
 * Reasoning completion with effort level
 * @param input - The prompt/question
 * @param effort - 'low' | 'medium' | 'high' - determines reasoning depth
 * @param instructions - Optional system instructions
 */
export async function reasoningCompletion(
  input: string, 
  effort: 'low' | 'medium' | 'high' = 'medium',
  instructions?: string,
  requestOptions?: OpenAIRequestOptions
): Promise<string> {
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input,
    reasoning: {
      effort
    }
  };
  
  if (instructions) {
    body.instructions = instructions;
  }

  console.log(`🧠 Reasoning request with effort: ${effort}`);
  
  return openAIRequestManager.execute<string>({
    tenantId: requestOptions?.tenantId,
    requestName: 'reasoningCompletion',
    promptSnippet: input,
    cacheKey:
      requestOptions?.cacheKey ||
      openAIRequestManager.buildCacheKey('reasoningCompletion', instructions, input, effort),
    operation: async () => {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json() as OpenAIResponse;
      return { value: extractResponseText(data), usage: data.usage };
    }
  });
}

/**
 * Web search enabled completion
 * @param input - The search query/question
 * @param instructions - Optional system instructions
 */
export async function webSearchCompletion(
  input: string,
  instructions?: string,
  requestOptions?: OpenAIRequestOptions
): Promise<string> {
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input,
    tools: [{ type: 'web_search_preview' }]
  };
  
  if (instructions) {
    body.instructions = instructions;
  }

  console.log(`🌐 Web search request: ${input.substring(0, 50)}...`);
  
  return openAIRequestManager.execute<string>({
    tenantId: requestOptions?.tenantId,
    requestName: 'webSearchCompletion',
    promptSnippet: input,
    cacheKey:
      requestOptions?.cacheKey ||
      openAIRequestManager.buildCacheKey('webSearchCompletion', instructions, input),
    operation: async () => {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json() as OpenAIResponse;
      return { value: extractResponseText(data), usage: data.usage };
    }
  });
}

/**
 * Document/File analysis - sends file content for analysis
 * @param fileContent - The extracted text content of the file
 * @param fileName - Name of the file being analyzed
 * @param prompt - What to do with the file
 * @param useReasoning - Whether to use reasoning for deeper analysis
 */
export async function analyzeDocument(
  fileContent: string,
  fileName: string,
  prompt: string,
  useReasoning: boolean = false,
  requestOptions?: OpenAIRequestOptions
): Promise<string> {
  const fullInput = `Analyze this document "${fileName}":

---DOCUMENT CONTENT---
${fileContent}
---END DOCUMENT---

${prompt}`;

  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input: fullInput
  };
  
  if (useReasoning) {
    body.reasoning = { effort: 'high' };
  }

  console.log(`📄 Document analysis for: ${fileName} (${fileContent.length} chars)`);
  
  return openAIRequestManager.execute<string>({
    tenantId: requestOptions?.tenantId,
    requestName: 'analyzeDocument',
    promptSnippet: `${fileName}: ${prompt}`,
    cacheKey:
      requestOptions?.cacheKey ||
      openAIRequestManager.buildCacheKey('analyzeDocument', fileName, prompt, useReasoning),
    operation: async () => {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json() as OpenAIResponse;
      return { value: extractResponseText(data), usage: data.usage };
    }
  });
}

/**
 * Generate recommendations for a document
 * Uses reasoning for better analysis
 */
export async function generateDocumentRecommendations(
  documentContent: string,
  documentName: string,
  _folderName: string
): Promise<string[]> {
  const prompt = `You are an expert regulatory compliance analyst. Analyze this document and provide specific, actionable recommendations.

Focus on:
1. Missing required sections or information
2. Regulatory compliance gaps
3. Document formatting and structure issues
4. Clarity and completeness of statements
5. References to applicable laws/regulations
6. Risk areas that need attention

Provide 3-7 specific recommendations. Return ONLY a JSON array of strings.
Example: ["Recommendation 1", "Recommendation 2", "Recommendation 3"]`;

  const result = await analyzeDocument(documentContent, documentName, prompt, true);
  
  // Parse JSON from response
  try {
    let jsonText = result.trim();
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }
    const recommendations = JSON.parse(jsonText);
    if (Array.isArray(recommendations)) {
      return recommendations.filter(r => typeof r === 'string' && r.trim());
    }
  } catch (e) {
    console.error('Failed to parse recommendations JSON:', e);
  }
  
  // Fallback
  return [
    `Review ${documentName} for completeness`,
    'Ensure all required sections are present',
    'Verify regulatory references are up to date'
  ];
}

/**
 * Apply recommendations to a document
 */
export async function applyRecommendationsToDocument(
  originalContent: string,
  documentName: string,
  recommendations: string[]
): Promise<string> {
  const recommendationsList = recommendations
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n');

  const prompt = `Apply ALL these recommendations to the document and return the complete updated version.

RECOMMENDATIONS TO APPLY:
${recommendationsList}

IMPORTANT:
- Apply ALL recommendations listed above
- Return ONLY the updated document content (no explanations, no markdown code blocks)
- Maintain the original document format and structure
- Make changes seamlessly integrated into the document`;

  return await analyzeDocument(originalContent, documentName, prompt, false);
}

/**
 * Chat completion with document context
 */
export async function chatWithDocumentContext(
  message: string,
  documentContent: string | null,
  documentName: string | null,
  _folderName: string,
  recommendationsSummary: any[]
): Promise<string> {
  const instructions = `You are a helpful AI assistant for managing software licensing and compliance documents.
Recommendations: ${JSON.stringify(recommendationsSummary, null, 2)}

Available commands:
- "Apply all" - accept all pending recommendations
- "Reject all" - reject all pending recommendations

Keep responses concise and helpful.`;

  let input = message;
  if (documentContent && documentName) {
    input = `[Document: ${documentName}]
---
${documentContent.substring(0, 50000)}
---

User message: ${message}`;
  }

  return await textCompletion(input, instructions);
}

export default {
  textCompletion,
  reasoningCompletion,
  webSearchCompletion,
  analyzeDocument,
  generateDocumentRecommendations,
  applyRecommendationsToDocument,
  chatWithDocumentContext,
  getOrUploadOpenAIFileId,
  fileAwareCompletion,
};

export type OpenAIFilePurpose = 'assistants' | 'batch' | 'fine-tune';

export interface FileAwareCompletionOptions {
  prompt: string;
  fileIds: string[];
  instructions?: string;
  reasoning?: 'low' | 'medium' | 'high';
  preferAssistant?: boolean;
  assistantId?: string;
  model?: string;
  tenantId?: string;
  cacheKey?: string;
}

export async function getOrUploadOpenAIFileId(
  filePath: string,
  purpose: OpenAIFilePurpose = 'assistants'
): Promise<string> {
  if (!config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured; cannot upload files.');
  }

  const absolutePath = path.resolve(filePath);
  const stats = await fsp.stat(absolutePath);
  const cacheKey = absolutePath;
  const cached = openaiFileCache.get(cacheKey);
  if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return cached.fileId;
  }

  if (inflightFileUploads.has(cacheKey)) {
    return inflightFileUploads.get(cacheKey)!;
  }

  const uploadPromise = (async () => {
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Cannot upload missing file: ${absolutePath}`);
    }
    const fileStream = fs.createReadStream(absolutePath);
    const uploaded = await openaiClient.files.create({
      file: fileStream,
      purpose,
    });
    const record: OpenAIFileCacheRecord = {
      fileId: uploaded.id,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      uploadedAt: new Date().toISOString(),
      filename: path.basename(absolutePath),
    };
    openaiFileCache.set(cacheKey, record);
    await persistOpenAIFileCache();
    return uploaded.id;
  })();

  inflightFileUploads.set(cacheKey, uploadPromise);
  try {
    return await uploadPromise;
  } finally {
    inflightFileUploads.delete(cacheKey);
  }
}

async function createResponseWithFilesInternal(
  options: FileAwareCompletionOptions
): Promise<{ value: string; usage?: TokenUsage }> {
  const userContent: any[] = [
    {
      type: 'input_text',
      text: options.prompt,
    }
  ];
  for (const fileId of options.fileIds) {
    userContent.push({ type: 'input_file', file_id: fileId });
  }

  const response = await openaiClient.responses.create({
    model: options.model || config.OPENAI_MODEL || 'gpt-5.1',
    input: [
      {
        role: 'user',
        content: userContent,
      }
    ],
    reasoning: options.reasoning ? { effort: options.reasoning } : undefined,
    instructions: options.instructions,
  });

  const usage = (response as any).usage as TokenUsage | undefined;
  return { value: extractResponseText(response), usage };
}

async function runAssistantWithFiles(
  options: FileAwareCompletionOptions & { assistantId: string }
): Promise<{ value: string; usage?: TokenUsage }> {
  const thread = await openaiClient.beta.threads.create();

  const attachments = options.fileIds.map(fileId => ({
    file_id: fileId,
    tools: [{ type: 'file_search' as const }],
  }));

  const prompt = options.instructions
    ? `${options.instructions}\n\nUser Request:\n${options.prompt}`
    : options.prompt;

  await openaiClient.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    attachments: attachments.length ? attachments : undefined,
  });

  const run = await openaiClient.beta.threads.runs.createAndPoll(thread.id, {
    assistant_id: options.assistantId,
  });

  if (run.status !== 'completed') {
    throw new Error(`Assistant run ended with status ${run.status}`);
  }

  const usage: TokenUsage | undefined = run.usage
    ? {
        input_tokens:
          (run.usage as any).prompt_tokens ?? (run.usage as any).input_tokens ?? undefined,
        output_tokens:
          (run.usage as any).completion_tokens ?? (run.usage as any).output_tokens ?? undefined,
        total_tokens: (run.usage as any).total_tokens,
      }
    : undefined;

  const messages = await openaiClient.beta.threads.messages.list(thread.id, {
    order: 'desc',
    limit: 10,
  });

  for (const message of messages.data) {
    if (message.role !== 'assistant') continue;
    const parts: string[] = [];
    for (const part of message.content) {
      if ('text' in part && part.text?.value) {
        parts.push(part.text.value);
      } else if (part.type === 'text' && typeof (part as any).text === 'string') {
        parts.push((part as any).text);
      }
    }
    if (parts.length) {
      return { value: parts.join('\n'), usage };
    }
  }

  return { value: '', usage };
}

export async function fileAwareCompletion(options: FileAwareCompletionOptions): Promise<string> {
  if (!config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured.');
  }
  if (!options.fileIds || options.fileIds.length === 0) {
    return textCompletion(options.prompt, options.instructions, {
      tenantId: options.tenantId,
      cacheKey: options.cacheKey,
    });
  }

  const cacheKey =
    options.cacheKey ||
    openAIRequestManager.buildCacheKey(
      'fileAwareCompletion',
      options.prompt,
      options.instructions,
      options.fileIds,
      options.reasoning,
      options.preferAssistant,
    );

  return openAIRequestManager.execute<string>({
    tenantId: options.tenantId,
    requestName: 'fileAwareCompletion',
    promptSnippet: options.prompt,
    cacheKey,
    operation: async () => {
      const assistantId = options.assistantId || config.OPENAI_ASSISTANT_ID;
      if (assistantId && options.preferAssistant !== false) {
        try {
          return await runAssistantWithFiles({ ...options, assistantId });
        } catch (error) {
          console.warn('⚠️  Assistant run failed, falling back to Responses API:', error);
        }
      }
      return createResponseWithFilesInternal(options);
    }
  });
}

export const openAIFileTools = {
  getOrUploadOpenAIFileId,
  fileAwareCompletion,
};
