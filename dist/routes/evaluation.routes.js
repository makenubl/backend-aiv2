"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const evaluation_service_1 = require("../services/evaluation.service");
const uuid_1 = require("uuid");
const router = (0, express_1.Router)();
// Store applications in memory (replace with DB)
const applications = new Map();
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
        const result = await evaluation_service_1.evaluationService.evaluateApplication(application, contextFiles);
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
exports.default = router;
//# sourceMappingURL=evaluation.routes.js.map