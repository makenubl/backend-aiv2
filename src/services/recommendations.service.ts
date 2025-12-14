import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { saveRecommendationsVersion, getRecommendationsTrail, updateRecommendationStatus } from './database.service';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

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
}

// Use new OpenAI Responses API (gpt-5.1)
async function callOpenAIResponses(input: string, options?: { reasoning?: boolean }): Promise<string> {
  const url = 'https://api.openai.com/v1/responses';
  const startTime = Date.now();
  
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input: input
  };

  if (options?.reasoning) {
    // Use 'low' effort for faster responses (was 'medium' - took 41s, 'low' should be ~10-15s)
    body.reasoning = { effort: 'low' };
  }

  const inputLength = typeof input === 'string' ? input.length : JSON.stringify(input).length;
  console.log(`🤖 [OpenAI-Recommendations] Starting request - Model: ${body.model}, Input: ${inputLength} chars`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const fetchTime = Date.now() - startTime;

  if (!response.ok) {
    const error = await response.text();
    console.error(`❌ [OpenAI-Recommendations] Error after ${fetchTime}ms:`, error);
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data: OpenAIResponsesData = await response.json() as OpenAIResponsesData;
  const totalTime = Date.now() - startTime;
  console.log(`✅ [OpenAI-Recommendations] Response received - Status: ${data.status}, Time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
  
  // Parse new Responses API format
  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const contentItem of item.content) {
          if (contentItem.type === 'output_text' && contentItem.text) {
            console.log(`📊 [OpenAI-Recommendations] Output: ${contentItem.text.length} chars`);
            return contentItem.text;
          }
        }
      }
    }
  }
  
  return '';
}

export interface GeneratedRecommendation {
  id: string;
  point: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
}

async function readFileText(filePath: string): Promise<string> {
  try {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.pdf')) {
      const buffer = fs.readFileSync(filePath);
      // Add timeout for PDF parsing
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('PDF parsing timeout')), 10000)
      );
      const parsePromise = pdfParse(buffer).then(data => data.text || '');
      return await Promise.race([parsePromise, timeoutPromise]);
    }
    if (lower.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    // Fallback to plain text
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Error reading file:', err);
    return '';
  }
}

async function generateAIRecommendations(documentName: string, documentContent: string, folderName: string): Promise<string[]> {
  // No truncation needed with gpt-5.1 - it handles full documents
  const truncatedContent = documentContent;

  if (!truncatedContent.trim()) {
    return [
      'Document content could not be extracted - please verify the file format',
      'Consider uploading a text-based version of this document'
    ];
  }

  const systemPrompt = `You are an expert regulatory compliance analyst specializing in software licensing, NOC (No Objection Certificate) applications, and regulatory documentation for fintech and virtual asset service providers.

Your task is to analyze the uploaded document and provide specific, actionable recommendations for compliance and completeness.

Focus on:
1. Missing required sections or information
2. Regulatory compliance gaps
3. Document formatting and structure issues
4. Clarity and completeness of statements
5. References to applicable laws/regulations that should be included
6. Risk areas that need attention
7. Best practices that should be followed

Provide 3-7 specific, actionable recommendations. Each recommendation should be:
- Specific to the document content
- Actionable (what exactly needs to be done)
- Clear about why it matters for compliance

Do NOT provide generic advice - analyze THIS specific document.`;

  const userPrompt = `Analyze this document from folder "${folderName}" named "${documentName}":

---DOCUMENT START---
${truncatedContent}
---DOCUMENT END---

Provide your recommendations as a JSON array of strings. Example format:
["Recommendation 1", "Recommendation 2", "Recommendation 3"]

Only return the JSON array, nothing else.`;

  try {
    console.log(`🤖 Generating AI recommendations for: ${documentName}`);
    
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    const responseText = await callOpenAIResponses(fullPrompt, { reasoning: true });
    
    console.log(`✅ AI response received for: ${documentName}`);
    
    // Parse JSON array from response
    try {
      // Handle markdown code blocks if present
      let jsonText = responseText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }
      const recommendations = JSON.parse(jsonText);
      if (Array.isArray(recommendations) && recommendations.length > 0) {
        return recommendations.filter((r: any) => typeof r === 'string' && r.trim());
      }
    } catch (parseError) {
      console.error('Failed to parse AI recommendations JSON:', parseError);
      // Try to extract recommendations from text if JSON parsing fails
      const lines = responseText.split('\n').filter(l => l.trim().startsWith('-') || l.trim().match(/^\d+\./));
      if (lines.length > 0) {
        return lines.map(l => l.replace(/^[-\d.)\s]+/, '').trim()).filter(l => l);
      }
    }
  } catch (error: any) {
    console.error('OpenAI API error:', error?.message);
  }

  // Fallback recommendations if AI fails
  return [
    `Review ${documentName} for completeness and regulatory compliance`,
    'Ensure all required sections are present and properly formatted',
    'Verify references to applicable regulations are up to date'
  ];
}

export async function generateRecommendationsForUpload(applicationId: string, documentPath: string, documentName: string): Promise<{ version: number; recommendations: GeneratedRecommendation[]; extract: string }>{
  const trails = await getRecommendationsTrail(applicationId, documentName);
  const nextVersion = (trails[trails.length - 1]?.version || 0) + 1;

  console.log(`📄 Processing document: ${documentName} for folder: ${applicationId}`);
  const extract = await readFileText(documentPath);
  console.log(`📝 Extracted ${extract.length} characters from document`);

  // Generate AI-powered recommendations based on actual file content
  const points = await generateAIRecommendations(documentName, extract, applicationId);
  console.log(`💡 Generated ${points.length} recommendations`);

  const recommendations: GeneratedRecommendation[] = points.map(p => ({ 
    id: uuidv4(), 
    point: p, 
    status: 'pending', 
    createdAt: new Date() 
  }));
  
  await saveRecommendationsVersion(applicationId, documentName, nextVersion, recommendations, extract);
  return { version: nextVersion, recommendations, extract };
}

export async function acceptOrRejectRecommendations(applicationId: string, documentName: string, version: number, acceptIds: string[], rejectIds: string[]) {
  if (acceptIds?.length) {
    await updateRecommendationStatus(applicationId, documentName, version, acceptIds, 'accepted');
  }
  if (rejectIds?.length) {
    await updateRecommendationStatus(applicationId, documentName, version, rejectIds, 'rejected');
  }
}

export async function listRecommendations(applicationId: string, documentName?: string): Promise<ReturnType<typeof getRecommendationsTrail>> {
  return await getRecommendationsTrail(applicationId, documentName);
}
