import { Router, Request, Response } from 'express';
import { evaluationService } from '../services/evaluation.service';
import { NOCApplication, VoiceCommandRequest } from '../types';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Store applications and evaluations in memory (replace with DB)
const applications = new Map<string, NOCApplication>();
const evaluations = new Map<string, any>();

// Multer setup for file uploads per application
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const appId = (req.body.applicationId as string) || (req.body.id as string) || uuidv4();
    const dir = path.join(process.cwd(), 'applications', appId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // attach selected id so later middleware can use
    (req as any).resolvedAppId = appId;
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Evaluate application
router.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const { name, description, vendor, version, contextFiles } = req.body;

    const application: NOCApplication = {
      id: uuidv4(),
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

    const result = await evaluationService.evaluateApplicationSingleCall(application, contextFiles);
    evaluations.set(cacheKey, result);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

// Process voice command
router.post('/voice-command', async (req: Request, res: Response): Promise<void> => {
  try {
    const { transcript, applicationId } = req.body as VoiceCommandRequest;

    if (!transcript || !applicationId) {
      res.status(400).json({ error: 'Missing transcript or applicationId' });
      return;
    }

    const response = await evaluationService.processVoiceQuery(transcript, applicationId);
    const audioBuffer = await evaluationService.generateTextToSpeech(response);

    res.json({
      response,
      audioBase64: audioBuffer.toString('base64'),
    });
  } catch (error) {
    res.status(500).json({ error: 'Voice command processing failed' });
  }
});

// Get evaluation history
router.get('/applications/:id', (req: Request, res: Response): void => {
  const application = applications.get(req.params.id);

  if (!application) {
    res.status(404).json({ error: 'Application not found' });
    return;
  }

  res.json(application);
});

// List all applications
router.get('/applications', (_req: Request, res: Response) => {
  const appList = Array.from(applications.values());
  res.json(appList);
});

// Upload files and optionally create + evaluate a new application in one go
router.post('/upload', upload.array('files'), async (req: Request, res: Response) => {
  try {
    const appId = (req as any).resolvedAppId || uuidv4();
    const { name, vendor, version, description } = req.body;

    // If applicationId not provided, create new app
    let app = applications.get(appId);
    if (!app) {
      const newApp: NOCApplication = {
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

    const files = (req.files as Express.Multer.File[]) || [];
    const filePaths = files.map(f => f.path);

    // Basic analysis context: use filenames for context
    const context = filePaths.map(p => path.basename(p));

    // Single-call evaluation with caching by composite key
    const cacheKey = `${app.name}|${app.vendor}|${app.version}`;
    let result = evaluations.get(cacheKey);
    if (!result) {
      result = await evaluationService.evaluateApplicationSingleCall(app, context);
      evaluations.set(cacheKey, result);
    }

    res.json({ application: app, evaluation: result, uploaded: files.map(f => ({ name: f.originalname, path: f.path })) });
  } catch (error) {
    console.error('Upload + evaluate error:', error);
    res.status(500).json({ error: 'Upload/evaluation failed' });
  }
});

export default router;
