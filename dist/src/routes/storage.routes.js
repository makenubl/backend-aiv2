"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const config_1 = require("../config");
const recommendations_service_1 = require("../services/recommendations.service");
const openai_request_manager_1 = require("../services/openai-request-manager");
const activity_log_service_1 = require("../services/activity-log.service");
const database_service_1 = require("../services/database.service");
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
const gridfs = __importStar(require("../services/gridfs-storage.service"));
const role_middleware_1 = require("../middleware/role.middleware");
// Check if running on serverless (Vercel/Lambda - read-only filesystem)
const isServerless = () => {
    return !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
};
// Helper function for new OpenAI Responses API (gpt-5.1)
async function callOpenAIResponses(input, options, metadata) {
    const url = 'https://api.openai.com/v1/responses';
    const body = {
        model: config_1.config.OPENAI_MODEL || 'gpt-5.1',
        input,
    };
    if (options?.reasoning) {
        body.reasoning = { effort: 'low' };
    }
    if (options?.webSearch) {
        body.tools = [{ type: 'web_search_preview' }];
    }
    const inputLength = typeof input === 'string' ? input.length : JSON.stringify(input).length;
    console.log(`🤖 [OpenAI] Starting request - Model: ${body.model}, Input: ${inputLength} chars, Reasoning: ${options?.reasoning || false}`);
    return openai_request_manager_1.openAIRequestManager.execute({
        tenantId: metadata?.tenantId,
        requestName: metadata?.requestName || 'storage.callOpenAIResponses',
        promptSnippet: input,
        cacheKey: metadata?.cacheKey ||
            openai_request_manager_1.openAIRequestManager.buildCacheKey('storage.callOpenAIResponses', input.length, options?.reasoning, options?.webSearch),
        operation: async () => {
            const startedAt = Date.now();
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config_1.config.OPENAI_API_KEY}`
                },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const error = await response.text();
                console.error(`❌ [OpenAI] Error after ${Date.now() - startedAt}ms:`, error);
                throw new Error(`OpenAI API error: ${response.statusText}`);
            }
            const data = await response.json();
            const totalTime = Date.now() - startedAt;
            console.log(`✅ [OpenAI] Response received - Status: ${data.status}, Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
            if (data.output && Array.isArray(data.output)) {
                for (const item of data.output) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                        for (const contentItem of item.content) {
                            if (contentItem.type === 'output_text' && contentItem.text) {
                                console.log(`📊 [OpenAI] Output: ${contentItem.text.length} chars`);
                                return { value: contentItem.text, usage: data.usage };
                            }
                        }
                    }
                }
            }
            const fallback = data.choices?.[0]?.message?.content || '';
            return { value: fallback, usage: data.usage };
        }
    });
}
const router = (0, express_1.Router)();
// Helper function to extract text from file buffer
async function extractTextFromBuffer(buffer, fileName) {
    try {
        if (buffer.length === 0) {
            return '[File is empty - upload may have failed. Please re-upload this document.]';
        }
        const lower = fileName.toLowerCase();
        if (lower.endsWith('.pdf')) {
            const data = await (0, pdf_parse_1.default)(buffer);
            return data.text || '';
        }
        if (lower.endsWith('.docx')) {
            const result = await mammoth_1.default.extractRawText({ buffer });
            return result.value || '';
        }
        // Fallback to plain text
        return buffer.toString('utf-8');
    }
    catch (err) {
        console.error('Error extracting text from buffer:', fileName, err);
        return '[Error: Could not extract text from this document.]';
    }
}
// Helper function to extract text from various file types (filesystem)
async function readFileText(filePath) {
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
            const data = await (0, pdf_parse_1.default)(buffer);
            return data.text || '';
        }
        if (lower.endsWith('.docx')) {
            const result = await mammoth_1.default.extractRawText({ path: filePath });
            return result.value || '';
        }
        // Fallback to plain text
        return fs.readFileSync(filePath, 'utf-8');
    }
    catch (err) {
        console.error('Error reading file:', filePath, err);
        return '[Error: Could not extract text from this document. The file may be corrupted or in an unsupported format.]';
    }
}
// Helper to get file content as text (works for both filesystem and GridFS)
async function getFileText(folderName, fileName) {
    if (isServerless()) {
        // Use GridFS
        const buffer = await gridfs.getFileBuffer(folderName, fileName);
        if (!buffer) {
            return '[File not found]';
        }
        return extractTextFromBuffer(buffer, fileName);
    }
    else {
        // Use filesystem
        const { full } = resolveFolder(folderName);
        const filePath = path.join(full, 'documents', fileName);
        return readFileText(filePath);
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
function resolveFolder(folderName) {
    const base = getApplicationsBasePath();
    const safeName = folderName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const full = path.join(base, safeName);
    return { base, safeName, full };
}
// Create a new application folder with standard structure
// Requires: storage:upload permission (admin or evaluator)
router.post('/folders', (0, role_middleware_1.requirePermission)('storage:upload'), async (req, res) => {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Folder name is required' });
    }
    try {
        const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
        const userEmail = String(req.header('x-user-email') || '');
        const userRole = String(req.header('x-user-role') || '');
        if (isServerless()) {
            // Use GridFS on serverless
            await gridfs.createFolder(name, userEmail);
            await gridfs.appendActivityLog({
                id: `create-${safeName}-${Date.now()}`,
                userEmail,
                userRole,
                action: 'create-folder',
                folder: safeName,
                timestamp: new Date().toISOString(),
            });
        }
        else {
            // Use filesystem locally
            const { full } = resolveFolder(name);
            if (fs.existsSync(full)) {
                return res.status(409).json({ error: 'Folder already exists', folder: safeName });
            }
            fs.mkdirSync(full, { recursive: true });
            const docsDir = path.join(full, 'documents');
            fs.mkdirSync(docsDir, { recursive: true });
            const appJson = {
                id: safeName,
                companyName: '',
                submittedBy: '',
                submitterEmail: '',
                applicationDate: new Date().toISOString(),
                documents: [],
            };
            fs.writeFileSync(path.join(full, 'application.json'), JSON.stringify(appJson, null, 2));
            (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
                id: `create-${safeName}-${Date.now()}`,
                userEmail,
                userRole,
                action: 'create-folder',
                folder: safeName,
                timestamp: new Date().toISOString(),
            });
        }
        return res.status(201).json({
            message: 'Folder created',
            folder: safeName,
        });
    }
    catch (error) {
        console.error('Error creating folder:', error);
        if (error.message === 'Folder already exists') {
            return res.status(409).json({ error: 'Folder already exists' });
        }
        return res.status(500).json({ error: error.message || 'Failed to create folder' });
    }
});
// Delete a folder
// Requires: storage:delete permission (admin only)
router.delete('/folders', (0, role_middleware_1.requirePermission)('storage:delete'), async (req, res) => {
    const { folder } = req.body || {};
    if (!folder || typeof folder !== 'string') {
        return res.status(400).json({ error: 'Folder name is required' });
    }
    try {
        const safeName = folder.replace(/[^a-zA-Z0-9-_]/g, '_');
        const userEmail = String(req.header('x-user-email') || '');
        const userRole = String(req.header('x-user-role') || '');
        if (isServerless()) {
            // Use GridFS on serverless
            const deleted = await gridfs.deleteFolder(safeName);
            if (!deleted) {
                return res.status(404).json({ error: 'Folder not found' });
            }
            await gridfs.appendActivityLog({
                id: `delete-${safeName}-${Date.now()}`,
                userEmail,
                userRole,
                action: 'delete-folder',
                folder: safeName,
                timestamp: new Date().toISOString(),
            });
        }
        else {
            // Use filesystem locally
            const { full } = resolveFolder(folder);
            if (!fs.existsSync(full)) {
                return res.status(404).json({ error: 'Folder not found' });
            }
            fs.rmSync(full, { recursive: true, force: true });
            (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
                id: `delete-${safeName}-${Date.now()}`,
                userEmail,
                userRole,
                action: 'delete-folder',
                folder: safeName,
                timestamp: new Date().toISOString(),
            });
        }
        return res.status(200).json({
            message: 'Folder deleted',
            folder: safeName
        });
    }
    catch (error) {
        console.error('Error deleting folder:', error);
        return res.status(500).json({ error: error.message || 'Failed to delete folder' });
    }
});
// Multer storage configured to place files under the specified folder's documents directory
// Use memory storage for serverless (GridFS), disk storage for local
const diskStorage = multer_1.default.diskStorage({
    destination: (req, _file, cb) => {
        const folderName = String(req.body.folder || req.query.folder || '');
        if (!folderName)
            return cb(new Error('Target folder is required'), '');
        const { full } = resolveFolder(folderName);
        const docsDir = path.join(full, 'documents');
        if (!fs.existsSync(full))
            fs.mkdirSync(full, { recursive: true });
        if (!fs.existsSync(docsDir))
            fs.mkdirSync(docsDir, { recursive: true });
        cb(null, docsDir);
    },
    filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9-_.]/g, '_');
        cb(null, safe);
    }
});
const memoryStorage = multer_1.default.memoryStorage();
// Choose storage based on environment
const upload = (0, multer_1.default)({
    storage: isServerless() ? memoryStorage : diskStorage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});
// Upload one or multiple files to a folder
// Requires: storage:upload permission (admin or evaluator)
router.post('/upload', (0, role_middleware_1.requirePermission)('storage:upload'), upload.array('files', 20), async (req, res) => {
    const folderName = String(req.body.folder || req.query.folder || '');
    if (!folderName) {
        return res.status(400).json({ error: 'Target folder is required' });
    }
    const files = req.files || [];
    if (!files.length) {
        return res.status(400).json({ error: 'No files uploaded. Use field name "files".' });
    }
    const userEmail = String(req.header('x-user-email') || '');
    const userRole = String(req.header('x-user-role') || '');
    const uploadedFiles = [];
    try {
        if (isServerless()) {
            // Use GridFS on serverless - files are in memory (buffer)
            for (const file of files) {
                const safeFileName = file.originalname.replace(/[^a-zA-Z0-9-_.]/g, '_');
                await gridfs.uploadFile(folderName, safeFileName, file.buffer, file.mimetype, userEmail);
                uploadedFiles.push({ name: safeFileName, size: file.size });
            }
            await gridfs.appendActivityLog({
                id: `upload-${folderName}-${Date.now()}`,
                userEmail,
                userRole,
                action: 'upload-files',
                folder: folderName,
                meta: { files: uploadedFiles.map(f => f.name) },
                timestamp: new Date().toISOString(),
            });
        }
        else {
            // Disk storage - files already saved to disk by multer
            for (const file of files) {
                uploadedFiles.push({ name: file.filename, size: file.size });
            }
            // Update application.json documents list if present
            const { full } = resolveFolder(folderName);
            const appJsonPath = path.join(full, 'application.json');
            if (fs.existsSync(appJsonPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
                    const added = uploadedFiles.map(f => f.name);
                    data.documents = Array.from(new Set([...(data.documents || []), ...added]));
                    fs.writeFileSync(appJsonPath, JSON.stringify(data, null, 2));
                }
                catch {
                    // ignore malformed json
                }
            }
            (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
                id: `upload-${folderName}-${Date.now()}`,
                userEmail,
                userRole,
                action: 'upload-files',
                folder: folderName,
                meta: { files: uploadedFiles.map(f => f.name) },
                timestamp: new Date().toISOString(),
            });
        }
        console.log(`📤 Upload complete - Files: ${uploadedFiles.map(f => f.name).join(', ')} (No AI processing at upload time)`);
        return res.status(200).json({
            message: 'Files uploaded',
            folder: folderName,
            files: uploadedFiles,
            recommendationsGenerated: [] // Recommendations generated on-demand via chat
        });
    }
    catch (error) {
        console.error('Error uploading files:', error);
        return res.status(500).json({ error: error.message || 'Failed to upload files' });
    }
});
// List folders
router.get('/folders', async (_req, res) => {
    try {
        if (isServerless()) {
            // Use GridFS on serverless
            const folders = await gridfs.listFolders();
            res.json({ folders: folders.map(f => f.safeName) });
        }
        else {
            // Use filesystem locally
            const base = getApplicationsBasePath();
            const entries = fs.readdirSync(base, { withFileTypes: true });
            const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
            res.json({ folders });
        }
    }
    catch (error) {
        console.error('Error listing folders:', error);
        res.status(500).json({ error: error.message || 'Failed to list folders' });
    }
});
// List files in a folder
router.get('/files', async (req, res) => {
    const folderName = String(req.query.folder || '');
    if (!folderName) {
        res.status(400).json({ error: 'Folder is required' });
        return;
    }
    try {
        if (isServerless()) {
            // Use GridFS on serverless
            const files = await gridfs.listFiles(folderName);
            res.json({ files: files.map(f => f.fileName) });
        }
        else {
            // Use filesystem locally
            const { full } = resolveFolder(folderName);
            const docsDir = path.join(full, 'documents');
            if (!fs.existsSync(docsDir)) {
                res.json({ files: [] });
                return;
            }
            const files = fs.readdirSync(docsDir).filter(n => !n.startsWith('.'));
            res.json({ files });
        }
    }
    catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: error.message || 'Failed to list files' });
    }
});
// Download a file from a folder
router.get('/download', async (req, res) => {
    const folderName = String(req.query.folder || '');
    const fileName = String(req.query.file || '');
    if (!folderName || !fileName) {
        res.status(400).json({ error: 'folder and file are required' });
        return;
    }
    try {
        if (isServerless()) {
            // Use GridFS on serverless
            const fileData = await gridfs.getFile(folderName, fileName);
            if (!fileData) {
                res.status(404).json({ error: 'File not found' });
                return;
            }
            res.setHeader('Content-Type', fileData.metadata.mimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(fileData.buffer);
        }
        else {
            // Use filesystem locally
            const { full } = resolveFolder(folderName);
            const filePath = path.join(full, 'documents', fileName);
            if (!fs.existsSync(filePath)) {
                res.status(404).json({ error: 'File not found' });
                return;
            }
            res.download(filePath, fileName);
        }
    }
    catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: error.message || 'Failed to download file' });
    }
});
// Delete a file from a folder
// Requires: storage:delete permission (admin only)
router.delete('/files', (0, role_middleware_1.requirePermission)('storage:delete'), async (req, res) => {
    const { folder, fileName } = req.body || {};
    if (!folder || !fileName) {
        res.status(400).json({ error: 'folder and fileName are required' });
        return;
    }
    try {
        if (isServerless()) {
            // Use GridFS on serverless
            const deleted = await gridfs.deleteFile(String(folder), String(fileName));
            if (!deleted) {
                res.status(404).json({ error: 'File not found' });
                return;
            }
        }
        else {
            // Use filesystem locally
            const { full } = resolveFolder(String(folder));
            const filePath = path.join(full, 'documents', String(fileName));
            if (!fs.existsSync(filePath)) {
                res.status(404).json({ error: 'File not found' });
                return;
            }
            fs.unlinkSync(filePath);
        }
        // Delete associated recommendations from MongoDB
        await (0, database_service_1.deleteRecommendationsForDocument)(String(folder), String(fileName));
        // Log activity
        if (isServerless()) {
            await gridfs.appendActivityLog({
                id: `delete-file-${folder}-${Date.now()}`,
                userEmail: String(req.header('x-user-email') || ''),
                userRole: String(req.header('x-user-role') || ''),
                action: 'delete-file',
                folder: String(folder),
                meta: { fileName: String(fileName) },
                timestamp: new Date().toISOString(),
            });
        }
        else {
            (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
                id: `delete-file-${folder}-${Date.now()}`,
                userEmail: String(req.header('x-user-email') || ''),
                userRole: String(req.header('x-user-role') || ''),
                action: 'delete-file',
                folder: String(folder),
                meta: { fileName: String(fileName) },
                timestamp: new Date().toISOString(),
            });
        }
        res.json({ message: 'File deleted successfully' });
    }
    catch (e) {
        console.error('Error deleting file:', e);
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
        const trail = await (0, recommendations_service_1.listRecommendations)(folderName, documentName);
        // Filter out recommendations for files that no longer exist on disk
        const basePath = getApplicationsBasePath();
        const filteredTrail = trail.filter((entry) => {
            const docPath = path.join(basePath, folderName, 'documents', entry.documentName);
            const exists = fs.existsSync(docPath);
            if (!exists) {
                console.log(`⚠️  File not found, filtering out: ${entry.documentName}`);
            }
            return exists;
        });
        res.json({ trail: filteredTrail });
    }
    catch (e) {
        res.status(500).json({ error: e?.message || 'Failed to list recommendations' });
    }
});
// Accept or reject recommendations by IDs on a specific version
// Requires: recommendations:modify permission (admin or evaluator)
router.post('/recommendations/decision', (0, role_middleware_1.requirePermission)('recommendations:modify'), async (req, res) => {
    const { folder, document, version, acceptIds, rejectIds } = req.body || {};
    const userRole = (0, role_middleware_1.getUserRole)(req);
    if (!folder || !document || typeof version !== 'number') {
        res.status(400).json({ error: 'folder, document, and numeric version are required' });
        return;
    }
    try {
        await (0, recommendations_service_1.acceptOrRejectRecommendations)(String(folder), String(document), Number(version), acceptIds || [], rejectIds || []);
        (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
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
    }
    catch (e) {
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
        const trail = await (0, recommendations_service_1.listRecommendations)(String(folder), document ? String(document) : undefined);
        const pendingCount = (trail || []).reduce((sum, e) => sum + (e.recommendations || []).filter((r) => r.status === 'pending').length, 0);
        const acceptedCount = (trail || []).reduce((sum, e) => sum + (e.recommendations || []).filter((r) => r.status === 'accepted').length, 0);
        const rejectedCount = (trail || []).reduce((sum, e) => sum + (e.recommendations || []).filter((r) => r.status === 'rejected').length, 0);
        // Check for action intents first
        if (normalized.includes('apply') && (normalized.includes('all') || normalized.includes('pending'))) {
            for (const entry of trail || []) {
                const pendingIds = (entry.recommendations || []).filter((r) => r.status === 'pending').map((r) => r.id);
                if (pendingIds.length) {
                    await (0, recommendations_service_1.acceptOrRejectRecommendations)(String(folder), String(entry.documentName), Number(entry.version), pendingIds, []);
                    applied += pendingIds.length;
                }
            }
            reply = applied
                ? `✅ Done! I applied ${applied} pending recommendation(s) for you.`
                : 'There are no pending recommendations to apply at the moment.';
        }
        else if (normalized.includes('reject') && normalized.includes('all')) {
            for (const entry of trail || []) {
                const pendingIds = (entry.recommendations || []).filter((r) => r.status === 'pending').map((r) => r.id);
                if (pendingIds.length) {
                    await (0, recommendations_service_1.acceptOrRejectRecommendations)(String(folder), String(entry.documentName), Number(entry.version), [], pendingIds);
                    applied += pendingIds.length;
                }
            }
            reply = applied
                ? `❌ Rejected ${applied} pending recommendation(s).`
                : 'There are no pending recommendations to reject.';
        }
        else {
            // Use OpenAI for conversational responses
            const recommendationsSummary = (trail || []).map((e) => ({
                document: e.documentName,
                version: e.version,
                recommendations: (e.recommendations || []).map((r) => ({
                    status: r.status,
                    point: r.point
                }))
            }));
            // If a document is specified, read its content (works with both filesystem and GridFS)
            let documentContent = '';
            if (document) {
                console.log(`📖 Reading document content for: ${document}`);
                documentContent = await getFileText(String(folder), String(document));
                console.log(`✅ Extracted ${documentContent.length} characters from document`);
                if (!documentContent.trim() || documentContent.startsWith('[')) {
                    if (!documentContent.startsWith('[')) {
                        documentContent = '[Document content could not be extracted or is empty]';
                    }
                }
            }
            else {
                console.log(`ℹ️ No document specified in chat request`);
            }
            const systemPrompt = `You are a senior regulatory auditor and compliance expert for the Pakistan Virtual Assets Regulatory Authority (PVARA). 
Your role is to review submitted documents from a regulatory, legal, and policy perspective, acting as a helpful auditor and support resource for PVARA's policy and regulatory team.

You have access to the following context about the current folder "${folder}":
- Total pending recommendations: ${pendingCount}
- Total accepted recommendations: ${acceptedCount}
- Total rejected recommendations: ${rejectedCount}
- Current recommendations: ${JSON.stringify(recommendationsSummary, null, 2)}
${documentContent ? `\n\n📄 Document Under Review: "${document}"\n---\n${documentContent}\n---\n` : ''}

As a PVARA Regulatory Auditor, you should:

1. **Regulatory Compliance Review**: Check if the document meets PVARA regulations, Pakistan's VASP licensing requirements, and international standards (FATF, AML/CFT guidelines).

2. **Legal Perspective**: Identify any legal gaps, missing clauses, or potential legal risks. Check for proper legal disclaimers, terms of service, privacy policies, and contractual obligations.

3. **Policy Assessment**: Evaluate if internal policies align with PVARA requirements including:
   - KYC/AML procedures
   - Customer due diligence (CDD)
   - Transaction monitoring
   - Suspicious activity reporting (SAR)
   - Record keeping requirements
   - Risk assessment frameworks

4. **Gap Analysis**: Clearly identify what is MISSING from the document that should be included for regulatory approval.

5. **Actionable Recommendations**: Provide specific, actionable feedback on what needs to be added, modified, or removed.

When reviewing documents, structure your response as:
- ✅ **Compliant Areas**: What's good and meets requirements
- ⚠️ **Concerns/Gaps**: Issues that need attention
- ❌ **Missing Requirements**: Critical items that must be added
- 📋 **Recommendations**: Specific actions to take

Available commands the user can use:
- "Apply all" or "Accept all pending" - to accept all pending recommendations
- "Reject all" - to reject all pending recommendations
- Ask about specific recommendations or documents

Be thorough but concise. Act as a supportive auditor helping the applicant achieve compliance, not as an obstacle.`;
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
                reply = await callOpenAIResponses(fullInput, { reasoning: useReasoning }, {
                    tenantId: String(folder || config_1.config.OPENAI_DEFAULT_TENANT_ID),
                    cacheKey: openai_request_manager_1.openAIRequestManager.buildCacheKey('storage.chat', folder, document, normalized, useReasoning),
                    requestName: 'storage.chat',
                });
            }
            catch (aiError) {
                console.error('OpenAI chat error:', aiError?.message);
                // Fallback to basic responses
                if (normalized.includes('pending') || normalized.includes('status')) {
                    reply = pendingCount
                        ? `📋 You have ${pendingCount} pending, ${acceptedCount} accepted, and ${rejectedCount} rejected recommendation(s).`
                        : 'No pending recommendations. Everything is up to date!';
                }
                else if (normalized.includes('help')) {
                    reply = `I can help you manage recommendations! Try:\n• "What's pending?" - see pending items\n• "Apply all" - accept all pending\n• "Reject all" - reject all pending`;
                }
                else {
                    reply = `I'm here to help with your recommendations. You have ${pendingCount} pending items. Say "apply all" to accept them or ask me anything!`;
                }
            }
        }
        // Log activity
        const activityData = {
            id: `chat-${folder}-${Date.now()}`,
            userEmail: String(req.header('x-user-email') || ''),
            userRole,
            action: 'chat',
            folder: String(folder),
            meta: { message, applied, reply: reply.substring(0, 100), document: document ? String(document) : undefined },
            timestamp: new Date().toISOString(),
        };
        if (isServerless()) {
            await gridfs.appendActivityLog(activityData);
        }
        else {
            (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), { ...activityData, document: document ? String(document) : undefined });
        }
        res.json({ reply, applied });
    }
    catch (e) {
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
        console.log(`📝 Applying ${recommendations.length} changes to: ${folder}/${document}`);
        // Read original file content (works with both filesystem and GridFS)
        const originalContent = await getFileText(String(folder), String(document));
        if (originalContent.startsWith('[File not found]') || originalContent.startsWith('[Error')) {
            console.error(`❌ File not found or error: ${folder}/${document}`);
            res.status(404).json({ error: 'Original file not found' });
            return;
        }
        console.log(`📖 Read ${originalContent.length} characters from original document`);
        // Prepare recommendations summary
        const recommendationsList = recommendations
            .map((r, idx) => `${idx + 1}. ${r.point}`)
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
        const updatedContent = await callOpenAIResponses(fullInput, { reasoning: true }, {
            tenantId: String(folder || config_1.config.OPENAI_DEFAULT_TENANT_ID),
            cacheKey: openai_request_manager_1.openAIRequestManager.buildCacheKey('storage.applyChanges', folder, document, recommendations.length, originalContent.length),
            requestName: 'storage.applyChanges',
        });
        const processTime = Date.now() - startTime;
        console.log(`✅ Document generated in ${processTime}ms (${(processTime / 1000).toFixed(1)}s)`);
        // Create new versioned file
        const baseName = path.basename(String(document), path.extname(String(document)));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const newFileName = `${baseName}_updated_${timestamp}.txt`;
        if (isServerless()) {
            // Save to GridFS
            await gridfs.uploadFile(String(folder), newFileName, Buffer.from(updatedContent, 'utf-8'), 'text/plain', String(req.header('x-user-email') || ''));
        }
        else {
            // Save to filesystem
            const { full } = resolveFolder(String(folder));
            const newFilePath = path.join(full, 'documents', newFileName);
            fs.writeFileSync(newFilePath, updatedContent, 'utf-8');
        }
        console.log(`💾 Saved updated document: ${newFileName}`);
        // Mark all recommendations as accepted in the database
        const trail = await (0, recommendations_service_1.listRecommendations)(String(folder), String(document));
        const entry = trail?.find((e) => e.documentName === document);
        if (entry) {
            const allIds = entry.recommendations.map((r) => r.id);
            await (0, recommendations_service_1.acceptOrRejectRecommendations)(String(folder), String(document), Number(entry.version), allIds, []);
        }
        res.json({
            success: true,
            originalFileName: document,
            newFileName: newFileName,
            summary: `Applied ${recommendations.length} recommendation(s). New file created: ${newFileName}`,
            recommendationsApplied: recommendations.length,
            processingTimeMs: processTime
        });
    }
    catch (e) {
        console.error('Apply changes error:', e);
        res.status(500).json({ error: e?.message || 'Failed to apply changes' });
    }
});
// Activity log endpoint for UI visibility
router.get('/activity', async (req, res) => {
    try {
        const folderName = String(req.query.folder || '');
        if (isServerless()) {
            const all = await gridfs.getActivityLogs();
            const filtered = folderName ? all.filter(a => a.folder === folderName) : all;
            res.json({ activities: filtered });
        }
        else {
            const base = getApplicationsBasePath();
            const all = (0, activity_log_service_1.readActivities)(base);
            const filtered = folderName ? all.filter(a => a.folder === folderName) : all;
            res.json({ activities: filtered });
        }
    }
    catch (error) {
        console.error('Error fetching activities:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch activities' });
    }
});
exports.default = router;
//# sourceMappingURL=storage.routes.js.map