"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const evaluation_service_1 = require("../services/evaluation.service");
const uuid_1 = require("uuid");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
// Store applications and evaluations in memory (replace with DB)
const applications = new Map();
const evaluations = new Map();
// Multer setup for file uploads per application
const storage = multer_1.default.diskStorage({
    destination: (req, _file, cb) => {
        const appId = req.body.applicationId || req.body.id || (0, uuid_1.v4)();
        const dir = path_1.default.join(process.cwd(), 'applications', appId);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        // attach selected id so later middleware can use
        req.resolvedAppId = appId;
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = (0, multer_1.default)({ storage });
// Evaluate application
router.post('/evaluate', async (req, res) => {
    try {
        const { name, description, vendor, version, contextFiles } = req.body;
        const application = {
            id: (0, uuid_1.v4)(),
            name,
            description,
            vendor,
            version,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        applications.set(application.id, application);
        // If already evaluated (by same composite key), return cached
        const cacheKey = `${name}|${vendor}|${version}`;
        if (evaluations.has(cacheKey)) {
            const cached = evaluations.get(cacheKey);
            res.json({ ...cached, applicationId: application.id });
            return;
        }
        const result = await evaluation_service_1.evaluationService.evaluateApplicationSingleCall(application, contextFiles);
        evaluations.set(cacheKey, result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: 'Evaluation failed' });
    }
});
// Process voice command
router.post('/voice-command', async (req, res) => {
    try {
        const { transcript, applicationId } = req.body;
        if (!transcript || !applicationId) {
            res.status(400).json({ error: 'Missing transcript or applicationId' });
            return;
        }
        const response = await evaluation_service_1.evaluationService.processVoiceQuery(transcript, applicationId);
        const audioBuffer = await evaluation_service_1.evaluationService.generateTextToSpeech(response);
        res.json({
            response,
            audioBase64: audioBuffer.toString('base64'),
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Voice command processing failed' });
    }
});
// Get evaluation history
router.get('/applications/:id', (req, res) => {
    const application = applications.get(req.params.id);
    if (!application) {
        res.status(404).json({ error: 'Application not found' });
        return;
    }
    res.json(application);
});
// List all applications
router.get('/applications', (_req, res) => {
    const appList = Array.from(applications.values());
    res.json(appList);
});
// Upload files and optionally create + evaluate a new application in one go
router.post('/upload', upload.array('files'), async (req, res) => {
    try {
        const appId = req.resolvedAppId || (0, uuid_1.v4)();
        const { name, vendor, version, description } = req.body;
        // If applicationId not provided, create new app
        let app = applications.get(appId);
        if (!app) {
            const newApp = {
                id: appId,
                name: name || `Uploaded App ${appId.slice(0, 6)}`,
                vendor: vendor || 'Unknown Vendor',
                version: version || '1.0.0',
                description: description || 'No description provided',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            applications.set(appId, newApp);
            app = newApp;
        }
        const files = req.files || [];
        const filePaths = files.map(f => f.path);
        // Basic analysis context: use filenames for context
        const context = filePaths.map(p => path_1.default.basename(p));
        // Single-call evaluation with caching by composite key
        const cacheKey = `${app.name}|${app.vendor}|${app.version}`;
        let result = evaluations.get(cacheKey);
        if (!result) {
            result = await evaluation_service_1.evaluationService.evaluateApplicationSingleCall(app, context);
            evaluations.set(cacheKey, result);
        }
        res.json({ application: app, evaluation: result, uploaded: files.map(f => ({ name: f.originalname, path: f.path })) });
    }
    catch (error) {
        console.error('Upload + evaluate error:', error);
        res.status(500).json({ error: 'Upload/evaluation failed' });
    }
});
exports.default = router;
//# sourceMappingURL=evaluation.routes.js.map