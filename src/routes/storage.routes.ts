import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../config';
import { listRecommendations, acceptOrRejectRecommendations } from '../services/recommendations.service';
import { appendActivity, readActivities } from '../services/activity-log.service';
import { deleteRecommendationsForDocument } from '../services/database.service';
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
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

// Helper function for new OpenAI Responses API (gpt-5.1)
async function callOpenAIResponses(input: string, options?: { reasoning?: boolean; webSearch?: boolean }): Promise<string> {
  const url = 'https://api.openai.com/v1/responses';
  const startTime = Date.now();
  
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input: input
  };

  if (options?.reasoning) {
    // Use 'low' effort for faster responses (was 'high' - took 28s, 'low' should be ~5-8s)
    body.reasoning = { effort: 'low' };
  }

  if (options?.webSearch) {
    body.tools = [{ type: 'web_search_preview' }];
  }

  const inputLength = typeof input === 'string' ? input.length : JSON.stringify(input).length;
  console.log(`🤖 [OpenAI] Starting request - Model: ${body.model}, Input: ${inputLength} chars, Reasoning: ${options?.reasoning || false}`);

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
    console.error(`❌ [OpenAI] Error after ${fetchTime}ms:`, error);
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data: OpenAIResponsesData = await response.json() as OpenAIResponsesData;
  const totalTime = Date.now() - startTime;
  console.log(`✅ [OpenAI] Response received - Status: ${data.status}, Time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
  
  // Parse new Responses API format: { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
  if (data.output && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const contentItem of item.content) {
          if (contentItem.type === 'output_text' && contentItem.text) {
            console.log(`📊 [OpenAI] Output: ${contentItem.text.length} chars`);
            return contentItem.text;
          }
        }
      }
    }
  }
  
  // Fallback for legacy format
  return data.choices?.[0]?.message?.content || '';
}

const router = Router();

// Helper function to extract text from various file types
async function readFileText(filePath: string): Promise<string> {
  try {
    // Check if file exists and has content
    if (!fs.existsSync(filePath)) {
      console.error('File does not exist:', filePath);
      return '[File not found]';
    }
    
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      console.error('File is empty (0 bytes):', filePath);
      return '[File is empty - upload may have failed. Please re-upload this document.]';
    }
    
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.pdf')) {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text || '';
    }
    if (lower.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    // Fallback to plain text
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Error reading file:', filePath, err);
    return '[Error: Could not extract text from this document. The file may be corrupted or in an unsupported format.]';
  }
}

// Base directory where application folders live
function getApplicationsBasePath() {
  // Prefer workspace root ../applications; fallback to backend/applications
  const workspaceRoot = path.join(process.cwd(), '..');
  let base = path.join(workspaceRoot, 'applications');
  if (!fs.existsSync(base)) {
    base = path.join(process.cwd(), 'applications');
  }
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
}

// Ensure a folder path under base directory safely
function resolveFolder(folderName: string) {
  const base = getApplicationsBasePath();
  const safeName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const full = path.join(base, safeName);
  return { base, safeName, full };
}

// Create a new application folder with standard structure
router.post('/folders', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  const { full, safeName } = resolveFolder(name);
  if (fs.existsSync(full)) {
    return res.status(409).json({ error: 'Folder already exists', folder: safeName });
  }

  // Create folder and subdirectories
  fs.mkdirSync(full, { recursive: true });
  const docsDir = path.join(full, 'documents');
  fs.mkdirSync(docsDir, { recursive: true });

  // Initialize minimal application.json
  const appJson = {
    id: safeName,
    companyName: '',
    submittedBy: '',
    submitterEmail: '',
    applicationDate: new Date().toISOString(),
    documents: [] as string[],
  };
  fs.writeFileSync(path.join(full, 'application.json'), JSON.stringify(appJson, null, 2));

  appendActivity(getApplicationsBasePath(), {
    id: `create-${safeName}-${Date.now()}`,
    userEmail: String(req.header('x-user-email') || ''),
    userRole: String(req.header('x-user-role') || ''),
    action: 'create-folder',
    folder: safeName,
    timestamp: new Date().toISOString(),
  });

  return res.status(201).json({
    message: 'Folder created',
    folder: safeName,
    path: full,
  });
});

// Delete a folder
router.delete('/folders', (req, res) => {
  const { folder } = req.body || {};
  if (!folder || typeof folder !== 'string') {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  const { full, safeName } = resolveFolder(folder);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  // Recursively delete folder
  fs.rmSync(full, { recursive: true, force: true });

  appendActivity(getApplicationsBasePath(), {
    id: `delete-${safeName}-${Date.now()}`,
    userEmail: String(req.header('x-user-email') || ''),
    userRole: String(req.header('x-user-role') || ''),
    action: 'delete-folder',
    folder: safeName,
    timestamp: new Date().toISOString(),
  });

  return res.status(200).json({
    message: 'Folder deleted',
    folder: safeName
  });
});

// Multer storage configured to place files under the specified folder's documents directory
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const folderName = String(req.body.folder || req.query.folder || '');
    if (!folderName) return cb(new Error('Target folder is required'), '');
    const { full } = resolveFolder(folderName);
    const docsDir = path.join(full, 'documents');
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    cb(null, docsDir);
  },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9-_.]/g, '_');
    cb(null, safe);
  }
});

const upload = multer({ storage });

// Upload one or multiple files to a folder
router.post('/upload', upload.array('files', 20), async (req, res) => {
  const folderName = String(req.body.folder || req.query.folder || '');
  if (!folderName) {
    return res.status(400).json({ error: 'Target folder is required' });
  }

  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) {
    return res.status(400).json({ error: 'No files uploaded. Use field name "files".' });
  }

  // Update application.json documents list if present
  const { full } = resolveFolder(folderName);
  const appJsonPath = path.join(full, 'application.json');
  if (fs.existsSync(appJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
      const added = files.map(f => f.filename);
      data.documents = Array.from(new Set([...(data.documents || []), ...added]));
      fs.writeFileSync(appJsonPath, JSON.stringify(data, null, 2));
    } catch {
      // ignore malformed json
    }
  }

  // NOTE: Recommendations are now generated on-demand when chat opens (not during upload)
  // This dramatically improves upload speed - no AI processing during upload
  
  appendActivity(getApplicationsBasePath(), {
    id: `upload-${folderName}-${Date.now()}`,
    userEmail: String(req.header('x-user-email') || ''),
    userRole: String(req.header('x-user-role') || ''),
    action: 'upload-files',
    folder: folderName,
    meta: { files: files.map(f => f.filename) },
    timestamp: new Date().toISOString(),
  });
  
  console.log(`📤 Upload complete - Files: ${files.map(f => f.filename).join(', ')} (No AI processing at upload time)`);
  
  return res.status(200).json({
    message: 'Files uploaded',
    folder: folderName,
    files: files.map(f => ({ name: f.filename, size: f.size })),
    recommendationsGenerated: [] // Recommendations generated on-demand via chat
  });
});

// List folders
router.get('/folders', (_req, res) => {
  const base = getApplicationsBasePath();
  const entries = fs.readdirSync(base, { withFileTypes: true });
  const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
  res.json({ folders });
});

// List files in a folder
router.get('/files', (req, res) => {
  const folderName = String(req.query.folder || '');
  if (!folderName) {
    res.status(400).json({ error: 'Folder is required' });
    return;
  }
  const { full } = resolveFolder(folderName);
  const docsDir = path.join(full, 'documents');
  if (!fs.existsSync(docsDir)) {
    res.json({ files: [] });
    return;
  }
  const files = fs.readdirSync(docsDir).filter(n => !n.startsWith('.'));
  res.json({ files });
});

// Download a file from a folder
router.get('/download', (req, res) => {
  const folderName = String(req.query.folder || '');
  const fileName = String(req.query.file || '');
  
  if (!folderName || !fileName) {
    res.status(400).json({ error: 'folder and file are required' });
    return;
  }
  
  const { full } = resolveFolder(folderName);
  const filePath = path.join(full, 'documents', fileName);
  
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  
  res.download(filePath, fileName);
});

// Delete a file from a folder
router.delete('/files', async (req, res) => {
  const { folder, fileName } = req.body || {};
  if (!folder || !fileName) {
    res.status(400).json({ error: 'folder and fileName are required' });
    return;
  }
  const { full } = resolveFolder(String(folder));
  const filePath = path.join(full, 'documents', String(fileName));
  
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  
  try {
    // Delete the file
    fs.unlinkSync(filePath);
    
    // Delete associated recommendations from MongoDB
    await deleteRecommendationsForDocument(String(folder), String(fileName));
    
    appendActivity(getApplicationsBasePath(), {
      id: `delete-file-${folder}-${Date.now()}`,
      userEmail: String(req.header('x-user-email') || ''),
      userRole: String(req.header('x-user-role') || ''),
      action: 'delete-file',
      folder: String(folder),
      meta: { fileName: String(fileName) },
      timestamp: new Date().toISOString(),
    });
    res.json({ message: 'File deleted successfully' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to delete file' });
  }
});

// Get all recommendations for a specific folder (or folder+document)
router.get('/recommendations', async (req, res) => {
  const folderName = String(req.query.folder || '');
  const documentName = req.query.document ? String(req.query.document) : undefined;
  if (!folderName) {
    res.status(400).json({ error: 'Folder is required' });
    return;
  }
  try {
    const trail = await listRecommendations(folderName, documentName);
    
    // Filter out recommendations for files that no longer exist on disk
    const basePath = getApplicationsBasePath();
    const filteredTrail = trail.filter((entry: any) => {
      const docPath = path.join(basePath, folderName, 'documents', entry.documentName);
      const exists = fs.existsSync(docPath);
      if (!exists) {
        console.log(`⚠️  File not found, filtering out: ${entry.documentName}`);
      }
      return exists;
    });
    
    res.json({ trail: filteredTrail });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list recommendations' });
  }
});

// Accept or reject recommendations by IDs on a specific version
router.post('/recommendations/decision', async (req, res) => {
  const { folder, document, version, acceptIds, rejectIds } = req.body || {};
  const userRole = String(req.header('x-user-role') || '');
  // Simple role enforcement: only owner/editor can modify recommendations
  if (!userRole || !['owner', 'editor'].includes(userRole)) {
    res.status(403).json({ error: 'Insufficient role to modify recommendations' });
    return;
  }
  if (!folder || !document || typeof version !== 'number') {
    res.status(400).json({ error: 'folder, document, and numeric version are required' });
    return;
  }
  try {
    await acceptOrRejectRecommendations(String(folder), String(document), Number(version), acceptIds || [], rejectIds || []);
    appendActivity(getApplicationsBasePath(), {
      id: `decide-${folder}-${document}-${version}-${Date.now()}`,
      userEmail: String(req.header('x-user-email') || ''),
      userRole,
      action: 'recommendations-decision',
      folder: String(folder),
      document: String(document),
      version: Number(version),
      meta: { acceptIds: acceptIds || [], rejectIds: rejectIds || [] },
      timestamp: new Date().toISOString(),
    });
    res.json({ message: 'Updated recommendation statuses' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to update recommendation statuses' });
  }
});

// Chat endpoint with AI-powered conversations about recommendations
router.post('/chat', async (req, res) => {
  const { folder, document, message } = req.body || {};
  const userRole = String(req.header('x-user-role') || 'owner');
  
  console.log(`💬 Chat request - Folder: ${folder}, Document: ${document}, Message: ${message?.substring(0, 50)}`);
  
  if (!folder || typeof message !== 'string') {
    res.status(400).json({ error: 'folder and message are required' });
    return;
  }
  
  const normalized = String(message).toLowerCase();
  let applied = 0;
  let reply = '';
  
  try {
    // Get current recommendations context
    const trail = await listRecommendations(String(folder), document ? String(document) : undefined);
    const pendingCount = (trail || []).reduce((sum: number, e: any) => 
      sum + (e.recommendations || []).filter((r: any) => r.status === 'pending').length, 0);
    const acceptedCount = (trail || []).reduce((sum: number, e: any) => 
      sum + (e.recommendations || []).filter((r: any) => r.status === 'accepted').length, 0);
    const rejectedCount = (trail || []).reduce((sum: number, e: any) => 
      sum + (e.recommendations || []).filter((r: any) => r.status === 'rejected').length, 0);
    
    // Check for action intents first
    if (normalized.includes('apply') && (normalized.includes('all') || normalized.includes('pending'))) {
      for (const entry of trail || []) {
        const pendingIds = (entry.recommendations || []).filter((r: any) => r.status === 'pending').map((r: any) => r.id);
        if (pendingIds.length) {
          await acceptOrRejectRecommendations(String(folder), String(entry.documentName), Number(entry.version), pendingIds, []);
          applied += pendingIds.length;
        }
      }
      reply = applied
        ? `✅ Done! I applied ${applied} pending recommendation(s) for you.`
        : 'There are no pending recommendations to apply at the moment.';
    } else if (normalized.includes('reject') && normalized.includes('all')) {
      for (const entry of trail || []) {
        const pendingIds = (entry.recommendations || []).filter((r: any) => r.status === 'pending').map((r: any) => r.id);
        if (pendingIds.length) {
          await acceptOrRejectRecommendations(String(folder), String(entry.documentName), Number(entry.version), [], pendingIds);
          applied += pendingIds.length;
        }
      }
      reply = applied
        ? `❌ Rejected ${applied} pending recommendation(s).`
        : 'There are no pending recommendations to reject.';
    } else {
      // Use OpenAI for conversational responses
      const recommendationsSummary = (trail || []).map((e: any) => ({
        document: e.documentName,
        version: e.version,
        recommendations: (e.recommendations || []).map((r: any) => ({
          status: r.status,
          point: r.point
        }))
      }));
      
      // If a document is specified, read its content
      let documentContent = '';
      if (document) {
        console.log(`📖 Reading document content for: ${document}`);
        const { full } = resolveFolder(String(folder));
        const docPath = path.join(full, 'documents', String(document));
        console.log(`📂 Document path: ${docPath}`);
        if (fs.existsSync(docPath)) {
          documentContent = await readFileText(docPath);
          console.log(`✅ Extracted ${documentContent.length} characters from document`);
          if (!documentContent.trim()) {
            documentContent = '[Document content could not be extracted or is empty]';
          }
          // No truncation - gpt-5.1 handles full documents
        } else {
          console.log(`❌ Document file not found at: ${docPath}`);
        }
      } else {
        console.log(`ℹ️ No document specified in chat request`);
      }
      
      const systemPrompt = `You are a helpful AI assistant for managing software licensing and compliance documents. 
You have access to the following context about the current folder "${folder}":
- Total pending recommendations: ${pendingCount}
- Total accepted recommendations: ${acceptedCount}
- Total rejected recommendations: ${rejectedCount}
- Current recommendations: ${JSON.stringify(recommendationsSummary, null, 2)}
${documentContent ? `\n\nDocument Content for "${document}":\n---\n${documentContent}\n---\n` : ''}

Help the user understand their documents and recommendations. You can:
- Summarize document content
- Answer questions about specific sections
- Explain recommendations and their importance
- Guide them on actions they can take

Available commands they can use:
- "Apply all" or "Accept all pending" - to accept all pending recommendations
- "Reject all" - to reject all pending recommendations
- Ask about specific recommendations or documents

Keep responses concise and helpful. Use emojis sparingly to make responses friendly.`;

      try {
        // Determine if this is a simple summary request or a complex analysis
        // Simple summaries don't need reasoning (faster: ~3-5s), complex analysis uses reasoning (~8-10s)
        const isSimpleSummary = normalized.includes('summary') || 
                                normalized.includes('summarize') || 
                                normalized.includes('overview') ||
                                normalized.includes('what is this') ||
                                normalized.includes('brief');
        
        const useReasoning = !isSimpleSummary; // Skip reasoning for simple summaries
        console.log(`🧠 Chat mode: ${isSimpleSummary ? 'Fast Summary (no reasoning)' : 'Analysis (with reasoning)'}`);
        
        // Use new Responses API - reasoning only for complex questions
        const fullInput = `${systemPrompt}\n\nUser Question: ${message}`;
        reply = await callOpenAIResponses(fullInput, { reasoning: useReasoning });
      } catch (aiError: any) {
        console.error('OpenAI chat error:', aiError?.message);
        // Fallback to basic responses
        if (normalized.includes('pending') || normalized.includes('status')) {
          reply = pendingCount 
            ? `📋 You have ${pendingCount} pending, ${acceptedCount} accepted, and ${rejectedCount} rejected recommendation(s).`
            : 'No pending recommendations. Everything is up to date!';
        } else if (normalized.includes('help')) {
          reply = `I can help you manage recommendations! Try:\n• "What's pending?" - see pending items\n• "Apply all" - accept all pending\n• "Reject all" - reject all pending`;
        } else {
          reply = `I'm here to help with your recommendations. You have ${pendingCount} pending items. Say "apply all" to accept them or ask me anything!`;
        }
      }
    }
    
    appendActivity(getApplicationsBasePath(), {
      id: `chat-${folder}-${Date.now()}`,
      userEmail: String(req.header('x-user-email') || ''),
      userRole,
      action: 'chat',
      folder: String(folder),
      document: document ? String(document) : undefined,
      meta: { message, applied, reply: reply.substring(0, 100) },
      timestamp: new Date().toISOString(),
    });
    
    res.json({ reply, applied });
  } catch (e: any) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e?.message || 'Chat action failed' });
  }
});

// GET /storage/chat returns empty history placeholder (no persistence implemented here)
router.get('/chat', async (_req, res) => {
  res.json({ history: [] });
});

// Apply changes with GPT-5.1 - creates updated file with recommendations
router.post('/apply-changes', async (req, res) => {
  const { folder, document, recommendations } = req.body;
  
  if (!folder || !document || !Array.isArray(recommendations)) {
    res.status(400).json({ error: 'folder, document, and recommendations array are required' });
    return;
  }
  
  const startTime = Date.now();
  
  try {
    const { full } = resolveFolder(String(folder));
    const originalFilePath = path.join(full, 'documents', String(document));
    
    console.log(`📝 Applying ${recommendations.length} changes to: ${originalFilePath}`);
    
    if (!fs.existsSync(originalFilePath)) {
      console.error(`❌ File not found: ${originalFilePath}`);
      res.status(404).json({ error: 'Original file not found' });
      return;
    }
    
    // Read original file content (supports docx, pdf, txt)
    const originalContent = await readFileText(originalFilePath);
    console.log(`📖 Read ${originalContent.length} characters from original document`);
    
    // Prepare recommendations summary
    const recommendationsList = recommendations
      .map((r: any, idx: number) => `${idx + 1}. ${r.point}`)
      .join('\n');
    
    // Use GPT-5.1 for applying changes
    const systemPrompt = `You are an expert document editor. Apply the provided recommendations to the document and return the complete updated version.

IMPORTANT INSTRUCTIONS:
- Apply ALL recommendations listed below to the document
- Return ONLY the updated document content
- Do NOT include any explanations, commentary, or markdown code blocks
- Do NOT include phrases like "Here is the updated document" 
- Maintain the original document structure, headings, and formatting style
- Make changes seamlessly integrated into the document
- If a recommendation suggests adding new content, insert it in the most appropriate location
- If a recommendation suggests modifying existing content, make the change while preserving context`;

    const userPrompt = `ORIGINAL DOCUMENT:
---
${originalContent}
---

RECOMMENDATIONS TO APPLY:
${recommendationsList}

Return the complete updated document with all recommendations applied. Start directly with the document content.`;

    console.log(`🤖 Sending to GPT-5.1 for document generation...`);
    const fullInput = `${systemPrompt}\n\n${userPrompt}`;
    const updatedContent = await callOpenAIResponses(fullInput, { reasoning: true });
    
    const processTime = Date.now() - startTime;
    console.log(`✅ Document generated in ${processTime}ms (${(processTime/1000).toFixed(1)}s)`);
    
    // Create new versioned file (don't overwrite original)
    const baseName = path.basename(String(document), path.extname(String(document)));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const newFileName = `${baseName}_updated_${timestamp}.txt`; // Save as .txt to preserve content
    const newFilePath = path.join(full, 'documents', newFileName);
    
    fs.writeFileSync(newFilePath, updatedContent, 'utf-8');
    console.log(`💾 Saved updated document: ${newFileName}`);
    
    // Mark all recommendations as accepted in the database
    const trail = await listRecommendations(String(folder), String(document));
    const entry = trail?.find((e: any) => e.documentName === document);
    
    if (entry) {
      const allIds = entry.recommendations.map((r: any) => r.id);
      await acceptOrRejectRecommendations(
        String(folder),
        String(document),
        Number(entry.version),
        allIds,
        []
      );
    }
    
    res.json({
      success: true,
      originalFileName: document,
      newFileName: newFileName,
      summary: `Applied ${recommendations.length} recommendation(s). New file created: ${newFileName}`,
      recommendationsApplied: recommendations.length,
      processingTimeMs: processTime
    });
  } catch (e: any) {
    console.error('Apply changes error:', e);
    res.status(500).json({ error: e?.message || 'Failed to apply changes' });
  }
});

// Activity log endpoint for UI visibility
router.get('/activity', (req, res) => {
  const folderName = String(req.query.folder || '');
  const base = getApplicationsBasePath();
  const all = readActivities(base);
  const filtered = folderName ? all.filter(a => a.folder === folderName) : all;
  res.json({ activities: filtered });
});

export default router;
