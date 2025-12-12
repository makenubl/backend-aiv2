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
const recommendations_service_1 = require("../services/recommendations.service");
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
    return res.status(201).json({
        message: 'Folder created',
        folder: safeName,
        path: full,
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
    if (!folder || !document || typeof version !== 'number') {
        res.status(400).json({ error: 'folder, document, and numeric version are required' });
        return;
    }
    try {
        await (0, recommendations_service_1.acceptOrRejectRecommendations)(String(folder), String(document), Number(version), acceptIds || [], rejectIds || []);
        res.json({ message: 'Updated recommendation statuses' });
    }
    catch (e) {
        res.status(500).json({ error: e?.message || 'Failed to update recommendation statuses' });
    }
});
exports.default = router;
//# sourceMappingURL=storage.routes.js.map