import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { generateRecommendationsForUpload, listRecommendations, acceptOrRejectRecommendations } from '../services/recommendations.service';

const router = Router();

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

  return res.status(201).json({
    message: 'Folder created',
    folder: safeName,
    path: full,
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

  // Trigger AI recommendations generation per uploaded file
  const generated: Array<{ name: string; version: number }> = [];
  for (const f of files) {
    const docPath = f.path;
    try {
      const { version } = await generateRecommendationsForUpload(folderName, docPath, f.filename);
      generated.push({ name: f.filename, version });
    } catch (e) {
      // continue even if one fails
    }
  }
  return res.status(200).json({
    message: 'Files uploaded',
    folder: folderName,
    files: files.map(f => ({ name: f.filename, size: f.size })),
    recommendationsGenerated: generated
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

// Get recommendations trail for a folder (optionally filter by document)
router.get('/recommendations', async (req, res) => {
  const folderName = String(req.query.folder || '');
  const documentName = req.query.document ? String(req.query.document) : undefined;
  if (!folderName) {
    res.status(400).json({ error: 'Folder is required' });
    return;
  }
  try {
    const trail = await listRecommendations(folderName, documentName);
    res.json({ trail });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list recommendations' });
  }
});

// Accept or reject recommendations by IDs on a specific version
router.post('/recommendations/decision', async (req, res) => {
  const { folder, document, version, acceptIds, rejectIds } = req.body || {};
  if (!folder || !document || typeof version !== 'number') {
    res.status(400).json({ error: 'folder, document, and numeric version are required' });
    return;
  }
  try {
    await acceptOrRejectRecommendations(String(folder), String(document), Number(version), acceptIds || [], rejectIds || []);
    res.json({ message: 'Updated recommendation statuses' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to update recommendation statuses' });
  }
});

// Minimal chat endpoints to support frontend StorageChat without external AI.
// POST /storage/chat will parse simple intents like "apply all" to accept pending recommendations.
router.post('/chat', async (req, res) => {
  const { folder, document, message } = req.body || {};
  if (!folder || typeof message !== 'string') {
    res.status(400).json({ error: 'folder and message are required' });
    return;
  }
  const normalized = String(message).toLowerCase();
  let applied = 0;
  let reply = 'Okay, noted.';
  try {
    // If user asks to apply all pending recommendations
    if (normalized.includes('apply') && normalized.includes('all')) {
      const trail = await listRecommendations(String(folder), document ? String(document) : undefined);
      for (const entry of trail || []) {
        const pendingIds = (entry.recommendations || []).filter((r: any) => r.status === 'pending').map((r: any) => r.id);
        if (pendingIds.length) {
          await acceptOrRejectRecommendations(String(folder), String(entry.documentName), Number(entry.version), pendingIds, []);
          applied += pendingIds.length;
        }
      }
      reply = applied
        ? `Applied ${applied} pending recommendation(s).`
        : 'No pending recommendations to apply.';
    } else if (normalized.includes('pending')) {
      const trail = await listRecommendations(String(folder), document ? String(document) : undefined);
      const pendingTotal = (trail || []).reduce((sum: number, e: any) => sum + (e.recommendations || []).filter((r: any) => r.status === 'pending').length, 0);
      reply = pendingTotal ? `${pendingTotal} recommendation(s) pending.` : 'No pending recommendations.';
    } else {
      reply = 'You can say "apply all" or ask "what is pending?"';
    }
    res.json({ reply, applied });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Chat action failed' });
  }
});

// GET /storage/chat returns empty history placeholder (no persistence implemented here)
router.get('/chat', async (_req, res) => {
  res.json({ history: [] });
});

export default router;
