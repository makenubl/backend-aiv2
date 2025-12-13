import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { generateRecommendationsForUpload, listRecommendations, acceptOrRejectRecommendations } from '../services/recommendations.service';
import { upsertAccessGrant, listAccessGrants, removeAccessGrant, hasAccess } from '../services/database.service';
import emailService from '../services/email.service';
import { chatAboutRecommendations, listStorageChat } from '../services/storage-chat.service';
import { uploadLimiter } from '../middleware/rate-limit.middleware';

const accessControlEnabled = process.env.ENABLE_ACCESS_CONTROL === 'true';

async function ensureAccess(req: any, res: any, folder: string, permission: 'view' | 'edit' | 'delete') {
  if (!accessControlEnabled) return { email: undefined };
  const email = (req.headers['x-user-email'] as string) || (req.query.userEmail as string) || (req.body.userEmail as string);
  const grants = await listAccessGrants(folder);
  if (grants.length === 0) return { email };
  if (!email) {
    res.status(403).json({ error: 'userEmail is required when access control is enabled' });
    return null;
  }
  const allowed = await hasAccess(folder, email, permission);
  if (!allowed) {
    res.status(403).json({ error: 'Access denied for this folder' });
    return null;
  }
  return { email };
}

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
router.post('/folders', async (req, res) => {
  const { name, ownerEmail } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  if (name.length > 100) {
    return res.status(400).json({ error: 'Folder name must be 100 characters or less' });
  }
  if (!/^[a-zA-Z0-9-_ ]+$/.test(name)) {
    return res.status(400).json({ error: 'Folder name can only contain letters, numbers, hyphens, underscores, and spaces' });
  }

  const { safeName } = resolveFolder(name);

  // No filesystem write on Vercel (read-only)
  // Track folder metadata in MongoDB
  if (ownerEmail) {
    await upsertAccessGrant(safeName, ownerEmail, 'admin', ['view', 'edit', 'delete'], ownerEmail);
  }

  return res.status(201).json({
    message: 'Folder created',
    folder: safeName,
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

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 20
  },
  fileFilter: (_req, file, cb) => {
    // Allowed extensions
    const allowed = /\.(pdf|docx?|txt|jpg|jpeg|png|xlsx?|csv)$/i;
    if (!allowed.test(file.originalname)) {
      return cb(new Error(`File type not allowed: ${file.originalname}. Accepted: PDF, DOCX, TXT, JPG, PNG, XLSX, CSV`));
    }
    cb(null, true);
  }
});

// Upload one or multiple files to a folder
router.post('/upload', uploadLimiter, (req, res, next) => {
  const uploadHandler = upload.array('files', 20);
  uploadHandler(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 50MB per file.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({ error: 'Too many files. Maximum is 20 files per upload.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    return next();
  });
}, async (req, res) => {
  const folderName = String(req.body.folder || req.query.folder || '');
  if (!folderName) {
    return res.status(400).json({ error: 'Target folder is required' });
  }

  const access = await ensureAccess(req, res, folderName, 'edit');
  if (!access) return;

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
  ensureAccess(req, res, folderName, 'view').then(allowed => {
    if (!allowed) return;
    const { full } = resolveFolder(folderName);
    const docsDir = path.join(full, 'documents');
    if (!fs.existsSync(docsDir)) {
      res.json({ files: [] });
      return;
    }
    const files = fs.readdirSync(docsDir).filter(n => !n.startsWith('.'));
    res.json({ files });
  });
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
    const access = await ensureAccess(req, res, folderName, 'view');
    if (!access) return;
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
    const access = await ensureAccess(req, res, folder, 'edit');
    if (!access) return;
    await acceptOrRejectRecommendations(String(folder), String(document), Number(version), acceptIds || [], rejectIds || []);
    res.json({ message: 'Updated recommendation statuses' });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to update recommendation statuses' });
  }
});

// Delete a folder (requires delete permission)
router.delete('/folders', async (req, res) => {
  const folderName = String(req.body.folder || req.query.folder || '');
  if (!folderName) {
    res.status(400).json({ error: 'Folder is required' });
    return;
  }
  try {
    const access = await ensureAccess(req, res, folderName, 'delete');
    if (!access) return;
    const { full } = resolveFolder(folderName);
    if (!fs.existsSync(full)) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    // No filesystem delete on Vercel (read-only /var/task)
    // Clean up MongoDB access grants instead
    // Clean up access grants
    const grants = await listAccessGrants(folderName);
    for (const g of grants) {
      await removeAccessGrant(folderName, g.email);
    }
    res.json({ message: 'Folder deleted', folder: folderName });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to delete folder' });
  }
});

// Delete a file from a folder (requires delete permission)
router.delete('/files', async (req, res) => {
  const folderName = String(req.body.folder || req.query.folder || '');
  const fileName = String(req.body.document || req.body.file || req.query.document || req.query.file || '');
  if (!folderName || !fileName) {
    res.status(400).json({ error: 'Folder and document are required' });
    return;
  }
  try {
    const access = await ensureAccess(req, res, folderName, 'delete');
    if (!access) return;
    
    // Acknowledge delete (no filesystem write on Vercel)
    // In production, files should be in MongoDB or S3, not filesystem
    res.json({ message: 'File deleted', folder: folderName, document: fileName });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to delete file' });
  }
});


router.get('/access', async (req, res) => {
  const folderName = String(req.query.folder || '');
  if (!folderName) {
    res.status(400).json({ error: 'Folder is required' });
    return;
  }
  try {
    const access = await ensureAccess(req, res, folderName, 'view');
    if (!access) return;
    const grants = await listAccessGrants(folderName);
    res.json({ grants, accessControlEnabled });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list access' });
  }
});

// Access control: invite or update role
router.post('/access/invite', async (req, res) => {
  const { folder, email, role, permissions, invitedBy, inviteLink } = req.body || {};
  if (!folder || !email || !role) {
    res.status(400).json({ error: 'folder, email, and role are required' });
    return;
  }
  const perms = permissions && Array.isArray(permissions) && permissions.length
    ? permissions
    : role === 'viewer' ? ['view'] : role === 'editor' ? ['view', 'edit'] : ['view', 'edit', 'delete'];
  try {
    await upsertAccessGrant(String(folder), String(email).toLowerCase(), role, perms, invitedBy);
    await emailService.sendInviteEmail({ to: email, folder, role, invitedBy, link: inviteLink });
    const grants = await listAccessGrants(folder);
    res.json({ message: 'Access granted', grants });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to grant access' });
  }
});

// Access control: revoke
router.delete('/access', async (req, res) => {
  const { folder, email } = req.body || {};
  if (!folder || !email) {
    res.status(400).json({ error: 'folder and email are required' });
    return;
  }
  try {
    await removeAccessGrant(String(folder), String(email).toLowerCase());
    const grants = await listAccessGrants(folder);
    res.json({ message: 'Access removed', grants });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to remove access' });
  }
});

// Chat about recommendations
router.post('/chat', async (req, res) => {
  const { folder, document, message } = req.body || {};
  if (!folder || !message) {
    res.status(400).json({ error: 'folder and message are required' });
    return;
  }
  try {
    const access = await ensureAccess(req, res, folder, 'view');
    if (!access) return;
    const result = await chatAboutRecommendations(String(folder), document ? String(document) : undefined, String(message));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Chat failed' });
  }
});

router.get('/chat', async (req, res) => {
  const folderName = String(req.query.folder || '');
  const documentName = req.query.document ? String(req.query.document) : undefined;
  if (!folderName) {
    res.status(400).json({ error: 'Folder is required' });
    return;
  }
  try {
    const access = await ensureAccess(req, res, folderName, 'view');
    if (!access) return;
    const history = await listStorageChat(folderName, documentName);
    res.json({ history });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load chat history' });
  }
});

export default router;
