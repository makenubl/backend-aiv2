/**
 * AI Task Extraction Service
 * 
 * Uses OpenAI to intelligently extract tasks, action items, deadlines, and owners
 * from documents synced from OneDrive or uploaded manually.
 * 
 * Design decisions:
 * - Explainable AI: Every extraction includes reasoning and confidence
 * - Human correction support: Stores feedback for potential fine-tuning
 * - Conservative extraction: Prefers missing tasks over hallucinated ones
 * - Chunked processing: Handles large documents by splitting into chunks
 * - Caching: Uses request manager for deduplication and cost control
 */

import { config } from '../config';
import { openAIRequestManager } from './openai-request-manager';
import {
  Task,
  AIExtractionResult,
  OwnerType,
  TaskPriority,
} from '../types/project-tracker.types';
import {
  createTask,
  getOneDriveSyncCollection,
  updateSyncRecord,
  getProjectById,
  getAllVendors,
  getAllExternalEmployees,
  logProjectActivity,
} from './project-tracker-db.service';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// =============================================================================
// CONFIGURATION
// =============================================================================

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_CHUNK_SIZE = 15000; // Characters per chunk for processing
const OVERLAP_SIZE = 500; // Overlap between chunks to avoid missing context

// =============================================================================
// TEXT EXTRACTION FROM VARIOUS FILE TYPES
// =============================================================================

/**
 * Extract text content from a file buffer based on file type
 */
export const extractTextFromFile = async (
  buffer: Buffer,
  fileName: string
): Promise<string> => {
  const lower = fileName.toLowerCase();
  
  try {
    if (lower.endsWith('.pdf')) {
      const data = await pdfParse(buffer);
      return data.text || '';
    }
    
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }
    
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      // For Excel, we'd use a library like xlsx
      // For now, return a placeholder
      return '[Excel file - structured data extraction needed]';
    }
    
    // Plain text files
    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      return buffer.toString('utf-8');
    }
    
    // Fallback
    return buffer.toString('utf-8');
  } catch (error: any) {
    console.error(`Error extracting text from ${fileName}:`, error);
    throw new Error(`Failed to extract text: ${error.message}`);
  }
};

/**
 * Split text into chunks for processing large documents
 */
const chunkText = (text: string): string[] => {
  if (text.length <= MAX_CHUNK_SIZE) {
    return [text];
  }
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + MAX_CHUNK_SIZE;
    
    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf('\n\n', end);
      const lastSentence = text.lastIndexOf('. ', end);
      
      if (lastParagraph > start + MAX_CHUNK_SIZE / 2) {
        end = lastParagraph + 2;
      } else if (lastSentence > start + MAX_CHUNK_SIZE / 2) {
        end = lastSentence + 2;
      }
    }
    
    chunks.push(text.substring(start, end));
    start = end - OVERLAP_SIZE; // Overlap to maintain context
  }
  
  return chunks;
};

// =============================================================================
// AI EXTRACTION ENGINE
// =============================================================================

/**
 * System prompt for task extraction
 * Designed to be conservative and explainable
 */
const EXTRACTION_SYSTEM_PROMPT = `You are an expert project manager AI assistant specialized in extracting actionable tasks from documents.

Your job is to analyze text and extract:
1. Tasks and action items
2. Deadlines (explicit or reasonably inferred)
3. Assigned owners (if mentioned)
4. Priority indicators

IMPORTANT RULES:
- Be CONSERVATIVE: Only extract clear, actionable tasks. If something is vague, skip it.
- Be EXPLAINABLE: For each extraction, provide the source text and your reasoning.
- Be HONEST about confidence: Rate confidence 0.0-1.0 based on clarity.
- NEVER hallucinate: If information isn't in the text, don't invent it.
- Handle ambiguity gracefully: Flag uncertain items rather than guessing.

For owner inference:
- Look for names, titles, departments, or company names
- Categorize as: "internal" (employee), "external" (contractor), or "vendor" (company)
- If owner is unclear, leave as null

For deadline inference:
- Look for dates, timeframes, urgency words
- Only infer dates if there's strong evidence
- Use ISO 8601 format for dates

Output format: JSON array of extracted tasks.`;

/**
 * User prompt template for extraction
 */
const buildExtractionPrompt = (
  text: string,
  documentInfo: { fileName: string; projectName?: string },
  knownOwners?: { vendors: string[]; externals: string[] }
): string => {
  let prompt = `Analyze the following document and extract all tasks, action items, and deliverables.

Document: ${documentInfo.fileName}
${documentInfo.projectName ? `Project: ${documentInfo.projectName}` : ''}

`;

  if (knownOwners && (knownOwners.vendors.length > 0 || knownOwners.externals.length > 0)) {
    prompt += `Known entities in this project:
- Vendors: ${knownOwners.vendors.join(', ') || 'None specified'}
- External contacts: ${knownOwners.externals.join(', ') || 'None specified'}

When inferring owners, try to match against these known entities.

`;
  }

  prompt += `Document content:
---
${text}
---

Extract tasks and return as a JSON array with this structure:
[
  {
    "title": "Brief task title (max 100 chars)",
    "description": "Detailed description if available",
    "type": "task|action_item|deliverable|deadline",
    "dueDate": "YYYY-MM-DD or null",
    "inferredOwner": "Name or company or null",
    "inferredOwnerType": "internal|external|vendor|null",
    "priority": "low|medium|high|critical",
    "confidence": 0.0-1.0,
    "sourceText": "The exact text this was extracted from",
    "reasoning": "Why this is a task and how you determined the details"
  }
]

Type classification:
- "task": General work items that need to be completed
- "action_item": Specific actions someone needs to take immediately
- "deliverable": Tangible outputs, documents, or products to produce
- "deadline": Time-sensitive items with explicit due dates

If no clear tasks are found, return an empty array [].
Only return the JSON array, no other text.`;

  return prompt;
};

interface RawExtractedTask {
  title: string;
  description?: string;
  type?: 'task' | 'action_item' | 'deliverable' | 'deadline';
  dueDate?: string;
  inferredOwner?: string;
  inferredOwnerType?: 'internal' | 'external' | 'vendor' | null;
  priority?: string;
  confidence: number;
  sourceText: string;
  reasoning: string;
}

/**
 * Call OpenAI to extract tasks from text
 */
const callExtractionAI = async (
  text: string,
  documentInfo: { fileName: string; projectName?: string },
  knownOwners?: { vendors: string[]; externals: string[] },
  customPrompt?: string
): Promise<RawExtractedTask[]> => {
  const prompt = buildExtractionPrompt(text, documentInfo, knownOwners);
  const finalPrompt = customPrompt 
    ? `${customPrompt}\n\n---\n\nDocument Content:\n${text}\n\n---\n\nExtract tasks and return as a JSON array.`
    : prompt;
  
  const requestStartTime = Date.now();
  
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🤖 OPENAI API REQUEST - Task Extraction');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('📄 File:', documentInfo.fileName);
  console.log('📁 Project:', documentInfo.projectName || 'N/A');
  console.log('🕐 Request Started:', new Date().toISOString());
  console.log('📝 Custom Prompt:', customPrompt ? 'YES' : 'NO');
  console.log('📏 Text Length:', text.length, 'characters');
  console.log('───────────────────────────────────────────────────────────────────────────────');
  console.log('📦 API Request Payload:');
  console.log(JSON.stringify({
    model: config.OPENAI_MODEL || 'gpt-4o',
    temperature: 0.3,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: customPrompt ? customPrompt.substring(0, 200) + '...' : EXTRACTION_SYSTEM_PROMPT.substring(0, 200) + '...' },
      { role: 'user', content: finalPrompt.substring(0, 500) + '... [truncated]' }
    ]
  }, null, 2));
  console.log('───────────────────────────────────────────────────────────────────────────────');
  
  const response = await openAIRequestManager.execute<string>({
    requestName: 'task-extraction',
    promptSnippet: text.substring(0, 100),
    cacheKey: openAIRequestManager.buildCacheKey('task-extraction', documentInfo.fileName, text.length),
    operation: async () => {
      console.log(`   📡 Sending request to OpenAI (model: ${config.OPENAI_MODEL || 'gpt-4o'})...`);
      
      const requestBody = {
        model: config.OPENAI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: customPrompt || EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: finalPrompt }
        ],
        temperature: 0.3,
        max_tokens: 4000,
      };
      
      const apiResponse = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });
      
      const responseEndTime = Date.now();
      const apiDuration = ((responseEndTime - requestStartTime) / 1000).toFixed(2);
      
      if (!apiResponse.ok) {
        const errorBody = await apiResponse.text();
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        console.log('❌ OPENAI API ERROR');
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        console.log('⏱️ Duration:', apiDuration, 'seconds');
        console.log('🔴 Status:', apiResponse.status, apiResponse.statusText);
        console.log('📛 Error Body:', errorBody);
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        throw new Error(`OpenAI API error: ${apiResponse.status} ${apiResponse.statusText}`);
      }
      
      const data = await apiResponse.json() as { 
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      
      // Extract text from chat completions response
      let responseText = '';
      if (data.choices && data.choices[0]?.message?.content) {
        responseText = data.choices[0].message.content;
      }
      
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('✅ OPENAI API RESPONSE');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('⏱️ Duration:', apiDuration, 'seconds');
      console.log('📊 Token Usage:');
      console.log('   - Prompt Tokens:', data.usage?.prompt_tokens || 0);
      console.log('   - Completion Tokens:', data.usage?.completion_tokens || 0);
      console.log('   - Total Tokens:', data.usage?.total_tokens || 0);
      console.log('───────────────────────────────────────────────────────────────────────────────');
      console.log('📄 Raw Response Content:');
      console.log(responseText);
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      
      return { value: responseText, usage: data.usage };
    },
  });
  
  // Parse JSON response
  try {
    // Clean up response - remove markdown code blocks if present
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.substring(7);
    }
    if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.substring(3);
    }
    if (cleanResponse.endsWith('```')) {
      cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
    }
    
    const parsed = JSON.parse(cleanResponse.trim());
    const tasks = Array.isArray(parsed) ? parsed.map(t => ({
      ...t,
      type: t.type || 'task', // Default to 'task' if not specified
    })) : [];
    
    console.log('───────────────────────────────────────────────────────────────────────────────');
    console.log('📋 Parsed Tasks:', tasks.length);
    tasks.forEach((task: RawExtractedTask, index: number) => {
      console.log(`   ${index + 1}. [${task.type}] ${task.title} (confidence: ${task.confidence})`);
    });
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    
    return tasks;
  } catch (error) {
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('❌ JSON PARSE ERROR');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('📄 Raw Response:', response);
    console.log('📛 Parse Error:', error);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    return [];
  }
};

// =============================================================================
// MAIN EXTRACTION PIPELINE
// =============================================================================

/**
 * Process a document and extract tasks
 * Main entry point for task extraction
 */
export const extractTasksFromDocument = async (
  content: string | Buffer,
  fileName: string,
  options: {
    projectId: string;
    syncId?: string;
    createdBy: string;
    autoCreateTasks?: boolean; // If true, creates tasks in DB
  }
): Promise<AIExtractionResult> => {
  const startTime = Date.now();
  
  console.log(`🤖 Starting task extraction for: ${fileName}`);
  
  // Get text content if buffer provided
  let textContent: string;
  if (Buffer.isBuffer(content)) {
    textContent = await extractTextFromFile(content, fileName);
  } else {
    textContent = content;
  }
  
  if (!textContent || textContent.trim().length < 50) {
    console.log('⚠️ Document too short or empty for extraction');
    return {
      success: true,
      tasks: [],
      metadata: {
        documentType: fileName.split('.').pop() || 'unknown',
        processingTimeMs: Date.now() - startTime,
      },
    };
  }
  
  // Get project info and known owners for better inference
  const project = await getProjectById(options.projectId);
  const vendors = await getAllVendors('active');
  const externals = await getAllExternalEmployees();
  
  const knownOwners = {
    vendors: vendors.map(v => v.name),
    externals: externals.map(e => e.name),
  };
  
  // Chunk text for large documents
  const chunks = chunkText(textContent);
  console.log(`📄 Processing ${chunks.length} chunk(s)`);
  
  // Process each chunk
  const allExtractedTasks: RawExtractedTask[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`   Processing chunk ${i + 1}/${chunks.length}`);
    
    const chunkTasks = await callExtractionAI(
      chunks[i],
      { fileName, projectName: project?.name },
      knownOwners
    );
    
    allExtractedTasks.push(...chunkTasks);
  }
  
  // Deduplicate tasks (similar titles might appear in overlapping chunks)
  const uniqueTasks = deduplicateTasks(allExtractedTasks);
  
  console.log(`✅ Extracted ${uniqueTasks.length} unique tasks`);
  
  // Optionally create tasks in database
  const createdTasks: Task[] = [];
  
  if (options.autoCreateTasks && uniqueTasks.length > 0) {
    for (const extracted of uniqueTasks) {
      // Only auto-create high-confidence tasks
      if (extracted.confidence < 0.6) {
        console.log(`   Skipping low-confidence task: ${extracted.title}`);
        continue;
      }
      
      // Resolve owner
      const ownerInfo = await resolveOwner(
        extracted.inferredOwner,
        extracted.inferredOwnerType,
        vendors,
        externals
      );
      
      const task = await createTask(
        {
          projectId: options.projectId,
          title: extracted.title,
          description: extracted.description,
          status: 'not-started',
          priority: (extracted.priority as TaskPriority) || 'medium',
          percentComplete: 0,
          ownerType: ownerInfo.type,
          ownerId: ownerInfo.id,
          ownerName: ownerInfo.name,
          dueDate: extracted.dueDate ? new Date(extracted.dueDate) : undefined,
          sourceInfo: {
            sourceType: options.syncId ? 'onedrive' : 'upload',
            fileName,
            syncId: options.syncId,
            extractedText: extracted.sourceText,
            extractionReason: extracted.reasoning,
            confidence: extracted.confidence,
          },
          isAIGenerated: true,
          aiConfidence: extracted.confidence,
          createdBy: 'AI-Extraction',
        },
        options.createdBy,
        'AI Extraction System'
      );
      
      createdTasks.push(task);
    }
    
    console.log(`💾 Created ${createdTasks.length} tasks in database`);
  }
  
  // Update sync record if applicable
  if (options.syncId) {
    await updateSyncRecord(options.syncId, {
      processingStatus: 'completed',
      processedAt: new Date(),
      extractedText: textContent.substring(0, 10000), // Store first 10k chars
      extractedTaskCount: uniqueTasks.length,
    });
  }
  
  // Log activity
  await logProjectActivity(
    'ai.extraction.completed',
    'project',
    options.projectId,
    options.createdBy,
    options.createdBy,
    'system',
    {
      newValue: {
        fileName,
        tasksExtracted: uniqueTasks.length,
        tasksCreated: createdTasks.length,
      },
      description: `AI extracted ${uniqueTasks.length} tasks from ${fileName}`,
    }
  );
  
  return {
    success: true,
    tasks: uniqueTasks.map(t => ({
      title: t.title,
      description: t.description,
      dueDate: t.dueDate,
      inferredOwner: t.inferredOwner,
      inferredOwnerType: t.inferredOwnerType as OwnerType | undefined,
      priority: t.priority as TaskPriority | undefined,
      confidence: t.confidence,
      sourceText: t.sourceText,
      reasoning: t.reasoning,
    })),
    metadata: {
      documentType: fileName.split('.').pop() || 'unknown',
      processingTimeMs: Date.now() - startTime,
    },
  };
};

/**
 * Deduplicate tasks based on title similarity
 */
const deduplicateTasks = (tasks: RawExtractedTask[]): RawExtractedTask[] => {
  const unique: RawExtractedTask[] = [];
  
  for (const task of tasks) {
    const isDuplicate = unique.some(existing => {
      // Simple similarity check - could be enhanced with proper fuzzy matching
      const titleSimilarity = calculateSimilarity(
        existing.title.toLowerCase(),
        task.title.toLowerCase()
      );
      return titleSimilarity > 0.8;
    });
    
    if (!isDuplicate) {
      unique.push(task);
    } else {
      // Keep the one with higher confidence
      const existingIndex = unique.findIndex(e => 
        calculateSimilarity(e.title.toLowerCase(), task.title.toLowerCase()) > 0.8
      );
      if (existingIndex >= 0 && task.confidence > unique[existingIndex].confidence) {
        unique[existingIndex] = task;
      }
    }
  }
  
  return unique;
};

/**
 * Simple string similarity calculation (Jaccard index on words)
 */
const calculateSimilarity = (a: string, b: string): number => {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  
  return intersection.size / union.size;
};

/**
 * Resolve inferred owner to actual entity
 */
const resolveOwner = async (
  inferredOwner: string | undefined,
  inferredType: string | null | undefined,
  vendors: any[],
  externals: any[]
): Promise<{ type: OwnerType; id: string; name: string }> => {
  // Default to unassigned internal
  if (!inferredOwner) {
    return { type: 'internal', id: 'unassigned', name: 'Unassigned' };
  }
  
  const ownerLower = inferredOwner.toLowerCase();
  
  // Try to match vendor
  const matchedVendor = vendors.find(v => 
    v.name.toLowerCase().includes(ownerLower) ||
    ownerLower.includes(v.name.toLowerCase())
  );
  if (matchedVendor) {
    return { type: 'vendor', id: matchedVendor.vendorId, name: matchedVendor.name };
  }
  
  // Try to match external employee
  const matchedExternal = externals.find(e =>
    e.name.toLowerCase().includes(ownerLower) ||
    ownerLower.includes(e.name.toLowerCase())
  );
  if (matchedExternal) {
    return { type: 'external', id: matchedExternal.externalId, name: matchedExternal.name };
  }
  
  // Use inferred type if provided
  if (inferredType === 'vendor') {
    return { type: 'vendor', id: 'unknown-vendor', name: inferredOwner };
  }
  if (inferredType === 'external') {
    return { type: 'external', id: 'unknown-external', name: inferredOwner };
  }
  
  // Default to internal
  return { type: 'internal', id: 'unknown-internal', name: inferredOwner };
};

// =============================================================================
// BATCH PROCESSING
// =============================================================================

/**
 * Process all pending sync records
 * Called periodically or manually after sync
 */
export const processPendingSyncRecords = async (
  projectId: string,
  triggeredBy: string
): Promise<{ processed: number; errors: number }> => {
  const syncCol = getOneDriveSyncCollection();
  const pending = await syncCol.find({
    projectId,
    processingStatus: 'pending',
  }).toArray();
  
  console.log(`📋 Processing ${pending.length} pending sync records`);
  
  let processed = 0;
  let errors = 0;
  
  for (const record of pending) {
    try {
      // Update status
      await updateSyncRecord(record.syncId, { processingStatus: 'processing' });
      
      // Read file content from local filesystem
      const fs = await import('fs/promises');
      let content: Buffer;
      if (record.localStoragePath) {
        content = await fs.readFile(record.localStoragePath);
      } else {
        throw new Error('Local storage path not available');
      }
      
      // Extract tasks
      await extractTasksFromDocument(content, record.fileName, {
        projectId: record.projectId!,
        syncId: record.syncId,
        createdBy: triggeredBy,
        autoCreateTasks: true,
      });
      
      processed++;
    } catch (error: any) {
      console.error(`Error processing ${record.fileName}:`, error);
      await updateSyncRecord(record.syncId, {
        processingStatus: 'failed',
        processingError: error.message,
      });
      errors++;
    }
  }
  
  return { processed, errors };
};

// =============================================================================
// HUMAN CORRECTION SUPPORT
// =============================================================================

/**
 * Record human correction to an AI-extracted task
 * This data can be used for future improvements
 */
export const recordTaskCorrection = async (
  taskId: string,
  correctionType: 'title' | 'owner' | 'deadline' | 'deleted' | 'merged',
  originalValue: any,
  correctedValue: any,
  correctedBy: string
): Promise<void> => {
  // Log the correction for potential future use in fine-tuning
  await logProjectActivity(
    'ai.correction.recorded',
    'task',
    taskId,
    correctedBy,
    correctedBy,
    'internal',
    {
      previousValue: { type: correctionType, value: originalValue },
      newValue: { type: correctionType, value: correctedValue },
      description: `Human corrected AI extraction: ${correctionType}`,
    }
  );
  
  console.log(`📝 Recorded correction for task ${taskId}: ${correctionType}`);
};

// =============================================================================
// WIZARD-MODE EXTRACTION (no DB writes)
// =============================================================================

export interface WizardExtractedTask {
  title: string;
  description?: string;
  type: 'task' | 'action_item' | 'deliverable' | 'deadline';
  dueDate?: string;
  inferredOwner?: string;
  inferredOwnerType?: 'internal' | 'external' | 'vendor' | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  sourceText: string;
  reasoning: string;
}

/**
 * Extract tasks from text content without database operations
 * Used by the wizard flow before project is created
 */
export const extractTasksFromText = async (
  textContent: string,
  documentInfo: { fileName: string; projectName?: string },
  knownOwners?: { vendors: string[]; externals: string[] },
  customPrompt?: string
): Promise<{ tasks: WizardExtractedTask[]; processingTimeMs: number }> => {
  const startTime = Date.now();
  
  if (!textContent || textContent.trim().length < 50) {
    return { tasks: [], processingTimeMs: Date.now() - startTime };
  }
  
  // Use custom prompt if provided, otherwise use default
  const systemPrompt = customPrompt || EXTRACTION_SYSTEM_PROMPT;
  
  // Chunk text for large documents
  const chunks = chunkText(textContent);
  console.log(`📄 [Wizard] Processing ${chunks.length} chunk(s)`);
  if (customPrompt) {
    console.log(`   Using custom prompt (${customPrompt.length} chars)`);
  }
  
  const allTasks: WizardExtractedTask[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const userPrompt = buildExtractionPrompt(chunks[i], documentInfo, knownOwners);
    
    try {
      const response = await openAIRequestManager.execute<string>({
        requestName: 'wizard-task-extraction',
        promptSnippet: chunks[i].substring(0, 100),
        cacheKey: openAIRequestManager.buildCacheKey('wizard-extraction', documentInfo.fileName, i),
        operation: async () => {
          console.log(`   📡 [Wizard] Calling OpenAI chat/completions (chunk ${i + 1}/${chunks.length})...`);
          
          const apiResponse = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: config.OPENAI_MODEL || 'gpt-4o',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.3,
              max_tokens: 4000,
            }),
          });
          
          if (!apiResponse.ok) {
            const errorBody = await apiResponse.text();
            console.error(`   ❌ OpenAI API error: ${apiResponse.status}`, errorBody);
            throw new Error(`OpenAI API error: ${apiResponse.status} ${apiResponse.statusText}`);
          }
          
          const data = await apiResponse.json() as { 
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          };
          
          let responseText = '';
          if (data.choices && data.choices[0]?.message?.content) {
            responseText = data.choices[0].message.content;
          }
          
          console.log(`   ✅ [Wizard] Response received (${data.usage?.total_tokens || 0} tokens)`);
          
          return { value: responseText, usage: data.usage };
        },
      });
      
      // Parse response
      let cleanResponse = response.trim();
      if (cleanResponse.startsWith('```json')) cleanResponse = cleanResponse.substring(7);
      if (cleanResponse.startsWith('```')) cleanResponse = cleanResponse.substring(3);
      if (cleanResponse.endsWith('```')) cleanResponse = cleanResponse.slice(0, -3);
      
      const parsed = JSON.parse(cleanResponse.trim());
      if (Array.isArray(parsed)) {
        allTasks.push(...parsed.map(t => ({
          ...t,
          type: t.type || 'task', // Default to 'task' if not specified
          priority: t.priority || 'medium',
        })));
      }
    } catch (error) {
      console.error(`Error extracting from chunk ${i}:`, error);
    }
  }
  
  // Deduplicate
  const uniqueTasks = deduplicateTasks(allTasks as any) as WizardExtractedTask[];
  
  return {
    tasks: uniqueTasks,
    processingTimeMs: Date.now() - startTime,
  };
};

// =============================================================================
// EXPORT
// =============================================================================

export default {
  extractTextFromFile,
  extractTasksFromDocument,
  processPendingSyncRecords,
  recordTaskCorrection,
};
