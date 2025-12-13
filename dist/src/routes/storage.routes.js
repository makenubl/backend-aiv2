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
const openai_1 = require("openai");
const config_1 = require("../config");
const recommendations_service_1 = require("../services/recommendations.service");
const activity_log_service_1 = require("../services/activity-log.service");
const openai = new openai_1.OpenAI({ apiKey: config_1.config.OPENAI_API_KEY });
const router = (0, express_1.Router)();
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
        documents: [],
    };
    fs.writeFileSync(path.join(full, 'application.json'), JSON.stringify(appJson, null, 2));
    (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
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
    (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
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
const storage = multer_1.default.diskStorage({
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
const upload = (0, multer_1.default)({ storage });
// Upload one or multiple files to a folder
router.post('/upload', upload.array('files', 20), async (req, res) => {
    const folderName = String(req.body.folder || req.query.folder || '');
    if (!folderName) {
        return res.status(400).json({ error: 'Target folder is required' });
    }
    const files = req.files || [];
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
        }
        catch {
            // ignore malformed json
        }
    }
    // Trigger AI recommendations generation per uploaded file
    const generated = [];
    for (const f of files) {
        const docPath = f.path;
        try {
            const { version } = await (0, recommendations_service_1.generateRecommendationsForUpload)(folderName, docPath, f.filename);
            generated.push({ name: f.filename, version });
        }
        catch (e) {
            // continue even if one fails
        }
    }
    (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
        id: `upload-${folderName}-${Date.now()}`,
        userEmail: String(req.header('x-user-email') || ''),
        userRole: String(req.header('x-user-role') || ''),
        action: 'upload-files',
        folder: folderName,
        meta: { files: files.map(f => f.filename) },
        timestamp: new Date().toISOString(),
    });
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
        const trail = await (0, recommendations_service_1.listRecommendations)(folderName, documentName);
        res.json({ trail });
    }
    catch (e) {
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
            const systemPrompt = `You are a helpful AI assistant for managing software licensing recommendations. 
You have access to the following context about the current folder "${folder}":
- Total pending recommendations: ${pendingCount}
- Total accepted recommendations: ${acceptedCount}
- Total rejected recommendations: ${rejectedCount}
- Current recommendations: ${JSON.stringify(recommendationsSummary, null, 2)}

Help the user understand their recommendations and guide them on actions they can take.
Available commands they can use:
- "Apply all" or "Accept all pending" - to accept all pending recommendations
- "Reject all" - to reject all pending recommendations
- Ask about specific recommendations or documents

Keep responses concise and helpful. Use emojis sparingly to make responses friendly.`;
            try {
                const completion = await openai.chat.completions.create({
                    model: config_1.config.OPENAI_MODEL || 'gpt-4o',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: message }
                    ],
                    max_tokens: 500,
                    temperature: 0.7
                });
                reply = completion.choices[0]?.message?.content || 'I understood your message. How can I help you with your recommendations?';
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
        (0, activity_log_service_1.appendActivity)(getApplicationsBasePath(), {
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
// Activity log endpoint for UI visibility
router.get('/activity', (req, res) => {
    const folderName = String(req.query.folder || '');
    const base = getApplicationsBasePath();
    const all = (0, activity_log_service_1.readActivities)(base);
    const filtered = folderName ? all.filter(a => a.folder === folderName) : all;
    res.json({ activities: filtered });
});
exports.default = router;
//# sourceMappingURL=storage.routes.js.map