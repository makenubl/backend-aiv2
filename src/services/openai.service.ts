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

import { config } from '../config';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

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

/**
 * Extract text from OpenAI Response
 */
function extractResponseText(response: OpenAIResponse): string {
  if (response.error) {
    throw new Error(response.error.message || 'OpenAI API error');
  }
  
  const output = response.output?.[0];
  if (!output || output.type !== 'message') {
    return '';
  }
  
  const textContent = output.content?.find(c => c.type === 'output_text');
  return textContent?.text || '';
}

/**
 * Basic text completion using gpt-5.1
 */
export async function textCompletion(input: string, instructions?: string): Promise<string> {
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input
  };
  
  if (instructions) {
    body.instructions = instructions;
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json() as OpenAIResponse;
  return extractResponseText(data);
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
  instructions?: string
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
  
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json() as OpenAIResponse;
  return extractResponseText(data);
}

/**
 * Web search enabled completion
 * @param input - The search query/question
 * @param instructions - Optional system instructions
 */
export async function webSearchCompletion(input: string, instructions?: string): Promise<string> {
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input,
    tools: [{ type: 'web_search_preview' }]
  };
  
  if (instructions) {
    body.instructions = instructions;
  }

  console.log(`🌐 Web search request: ${input.substring(0, 50)}...`);
  
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json() as OpenAIResponse;
  return extractResponseText(data);
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
  useReasoning: boolean = false
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
  
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json() as OpenAIResponse;
  return extractResponseText(data);
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
  chatWithDocumentContext
};
