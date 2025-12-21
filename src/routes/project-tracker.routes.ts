/**
 * Project Tracker Wizard Routes
 * 
 * Comprehensive API for the project tracker wizard:
 * - File upload and management (using Storage API - S3 + MongoDB)
 * - AI-powered document analysis
 * - Task extraction and management
 * - Vendor and external employee management
 * 
 * Flow:
 * 1. Create project (draft) - creates a storage folder
 * 2. Upload files to project - uses storage API (S3 + MongoDB)
 * 3. Analyze files with AI
 * 4. Review and assign extracted tasks
 * 5. Finalize project
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import {
  createProject,
  updateProject,
  getProjectById,
  getAllProjects,
  createTask,
  updateTask,
  getTasksByProject,
  getTasksWithFilters,
  createVendor,
  updateVendor,
  getAllVendors,
  getVendorById,
  createExternalEmployee,
  getAllExternalEmployees,
  getExternalEmployeeById,
  logProjectActivity,
  getActivityLogs,
  getProjectActivityLogs,
} from '../services/project-tracker-db.service';
import { extractTasksFromText, extractTextFromFile } from '../services/task-extraction.service';
import { 
  deleteFileDirect,
  createFolder as createStorageFolder,
  uploadFile as uploadStorageFile,
  deleteFile as deleteStorageFile,
  appendActivityLog,
  isS3Configured,
  getFolder as getStorageFolder,
  getFile as getFileWithBuffer,
} from '../services/s3-storage.service';
import { Task } from '../types/project-tracker.types';

const router = Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'text/markdown',
      'application/json',
      'image/png',
      'image/jpeg',
      'image/gif',
    ];
    
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|md|json|png|jpg|jpeg|gif)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

// Helper to get user info from request headers
const getUserInfo = (req: Request): { id: string; name: string; email: string } => {
  const email = req.header('x-user-email') || 'unknown';
  return {
    id: email,
    name: email.split('@')[0],
    email,
  };
};

// Store for uploaded files per session (in-memory for simplicity)
interface UploadedFile {
  id: string;
  originalName: string;
  size: number;
  mimeType: string;
  s3Key?: string;
  s3Url?: string;
  uploadedAt: Date;
  extractedText?: string;
  analysisStatus: 'pending' | 'analyzing' | 'completed' | 'error';
  analysisError?: string;
  extractedTasks?: any[];
}

interface WizardSession {
  sessionId: string;
  projectId?: string;
  projectName?: string;
  storageFolderName?: string; // Links to Storage & AI Chat folder
  files: UploadedFile[];
  status: 'draft' | 'uploading' | 'analyzing' | 'reviewing' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

const wizardSessions = new Map<string, WizardSession>();

// =============================================================================
// WIZARD SESSION MANAGEMENT
// =============================================================================

/**
 * POST /api/project-tracker/session/start
 * Start a new wizard session
 */
router.post('/session/start', async (req: Request, res: Response) => {
  const user = getUserInfo(req);
  const sessionId = uuidv4();
  
  const session: WizardSession = {
    sessionId,
    files: [],
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  wizardSessions.set(sessionId, session);
  
  console.log(`[ProjectTracker] New wizard session started: ${sessionId} by ${user.email}`);
  
  return res.json({
    success: true,
    sessionId,
    message: 'Wizard session started',
    storageIntegration: {
      enabled: isS3Configured(),
      info: 'Files will be uploaded to Storage & AI Chat system (S3 + MongoDB)',
    },
  });
});

/**
 * GET /api/project-tracker/session/:sessionId
 * Get wizard session status
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = wizardSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  
  return res.json({
    success: true,
    session: {
      ...session,
      storageFolderName: session.storageFolderName,
      projectName: session.projectName,
      files: session.files.map(f => ({
        id: f.id,
        originalName: f.originalName,
        size: f.size,
        mimeType: f.mimeType,
        uploadedAt: f.uploadedAt,
        analysisStatus: f.analysisStatus,
        extractedTasksCount: f.extractedTasks?.length || 0,
        s3Key: f.s3Key,
      })),
    },
  });
});

// =============================================================================
// PROJECT MANAGEMENT
// =============================================================================

/**
 * POST /api/project-tracker/projects
 * Create a new project (can be draft or finalized)
 */
router.post('/projects', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { name, description, tags, sessionId, status = 'active' } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Project name is required' });
    }
    
    const project = await createProject({
      name,
      description: description || '',
      status,
      priority: 'medium',
      ownerId: user.id,
      ownerName: user.name,
      createdBy: user.id,
      tags: tags || [],
    }, user.id, user.name);
    
    // Link to wizard session if provided
    if (sessionId) {
      const session = wizardSessions.get(sessionId);
      if (session) {
        session.projectId = project.projectId;
        session.updatedAt = new Date();
      }
    }
    
    return res.json({ success: true, project });
  } catch (error: any) {
    console.error('Error creating project:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/projects
 * List all projects
 */
router.get('/projects', async (_req: Request, res: Response) => {
  try {
    const projects = await getAllProjects();
    return res.json({ success: true, projects });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/projects/:projectId
 * Get project by ID
 */
router.get('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const project = await getProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    return res.json({ success: true, project });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/project-tracker/projects/:projectId
 * Update project
 */
router.put('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const project = await updateProject(req.params.projectId, req.body, user.id, user.name);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    return res.json({ success: true, project });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// FILE UPLOAD & MANAGEMENT
// =============================================================================

/**
 * POST /api/project-tracker/files/upload
 * Upload files to a wizard session - uses Storage API for S3 + MongoDB integration
 * Files are stored under a folder named after the project, accessible via Storage & AI Chat
 */
router.post('/files/upload', upload.array('files', 20), async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { sessionId, projectName } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }
    
    const session = wizardSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }
    
    session.status = 'uploading';
    const uploadedFiles: UploadedFile[] = [];
    
    // Determine storage folder name
    // Use project name if provided, otherwise use session-based folder
    const storageFolderName = projectName 
      ? `Project_${projectName.replace(/[^a-zA-Z0-9-_]/g, '_')}`
      : `Project_${sessionId.substring(0, 8)}`;
    
    // Create storage folder if not exists (integrates with Storage & AI Chat)
    if (!session.storageFolderName) {
      try {
        const existingFolder = await getStorageFolder(storageFolderName);
        if (!existingFolder) {
          await createStorageFolder(storageFolderName, user.email);
          console.log(`[ProjectTracker] Created storage folder: ${storageFolderName}`);
        }
        session.storageFolderName = storageFolderName;
        session.projectName = projectName;
        
        // Log activity
        await appendActivityLog({
          id: `project-wizard-${sessionId}-${Date.now()}`,
          userEmail: user.email,
          userRole: 'wizard',
          action: 'project-wizard-start',
          folder: storageFolderName,
          meta: { sessionId, projectName },
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        // Folder may already exist, continue
        if (!err.message?.includes('already exists')) {
          console.warn('Error creating storage folder:', err);
        }
        session.storageFolderName = storageFolderName;
      }
    }
    
    // Upload files using Storage API (same as Storage & AI Chat)
    for (const file of files) {
      const fileId = uuidv4();
      const safeFileName = file.originalname.replace(/[^a-zA-Z0-9-_.]/g, '_');
      
      // Upload via Storage API - this stores in S3 and creates MongoDB metadata
      const fileMetadata = await uploadStorageFile(
        session.storageFolderName!,
        safeFileName,
        file.buffer,
        file.mimetype,
        user.email
      );
      
      const uploadedFile: UploadedFile = {
        id: fileId,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        s3Key: fileMetadata.s3Key,
        s3Url: fileMetadata.s3Url,
        uploadedAt: new Date(),
        analysisStatus: 'pending',
      };
      
      // Try to extract text for supported file types
      try {
        const textContent = await extractTextFromFile(file.buffer, file.originalname);
        uploadedFile.extractedText = textContent;
      } catch (err) {
        console.warn(`Could not extract text from ${file.originalname}:`, err);
      }
      
      session.files.push(uploadedFile);
      uploadedFiles.push(uploadedFile);
    }
    
    session.updatedAt = new Date();
    
    // Log file upload activity
    await appendActivityLog({
      id: `upload-wizard-${sessionId}-${Date.now()}`,
      userEmail: user.email,
      userRole: 'wizard',
      action: 'wizard-upload-files',
      folder: session.storageFolderName,
      meta: { 
        sessionId, 
        projectName,
        files: uploadedFiles.map(f => f.originalName),
        storage: 's3'
      },
      timestamp: new Date().toISOString(),
    });
    
    console.log(`[ProjectTracker] ${files.length} files uploaded to storage folder: ${session.storageFolderName}`);
    
    return res.json({
      success: true,
      storageFolderName: session.storageFolderName,
      files: uploadedFiles.map(f => ({
        id: f.id,
        originalName: f.originalName,
        size: f.size,
        mimeType: f.mimeType,
        s3Url: f.s3Url,
        uploadedAt: f.uploadedAt,
      })),
    });
  } catch (error: any) {
    console.error('Error uploading files:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/project-tracker/files/:sessionId/:fileId
 * Remove a file from session - uses Storage API
 */
router.delete('/files/:sessionId/:fileId', async (req: Request, res: Response) => {
  try {
    const { sessionId, fileId } = req.params;
    const session = wizardSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    const fileIndex = session.files.findIndex(f => f.id === fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    const file = session.files[fileIndex];
    
    // Delete from S3 via Storage API
    if (session.storageFolderName && file.originalName) {
      try {
        const safeFileName = file.originalName.replace(/[^a-zA-Z0-9-_.]/g, '_');
        await deleteStorageFile(session.storageFolderName, safeFileName);
        console.log(`[ProjectTracker] Deleted file from storage: ${session.storageFolderName}/${safeFileName}`);
      } catch (err) {
        console.warn('Could not delete file from storage:', err);
        // Fallback to direct delete if storage API fails
        if (file.s3Key) {
          await deleteFileDirect(file.s3Key);
        }
      }
    } else if (file.s3Key) {
      await deleteFileDirect(file.s3Key);
    }
    
    session.files.splice(fileIndex, 1);
    session.updatedAt = new Date();
    
    return res.json({ success: true, message: 'File removed' });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/files/:sessionId
 * Get all files in a session
 */
router.get('/files/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = wizardSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  
  return res.json({
    success: true,
    files: session.files.map(f => ({
      id: f.id,
      originalName: f.originalName,
      size: f.size,
      mimeType: f.mimeType,
      s3Url: f.s3Url,
      uploadedAt: f.uploadedAt,
      analysisStatus: f.analysisStatus,
      extractedTasksCount: f.extractedTasks?.length || 0,
    })),
  });
});

/**
 * POST /api/project-tracker/load-existing-files/:sessionId
 * Load existing files from an S3 storage folder into the wizard session
 * Downloads files, extracts text, and prepares them for AI analysis
 */
router.post('/load-existing-files/:sessionId', async (req: Request, res: Response) => {
  const loadStartTime = Date.now();
  
  try {
    const { sessionId } = req.params;
    const { folderName, files } = req.body; // files is array of {name, size, mimeType, s3Key}
    
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('📂 LOAD EXISTING FILES REQUEST');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('📍 Session ID:', sessionId);
    console.log('📁 Folder Name:', folderName);
    console.log('📄 Files to Load:', files?.length || 0);
    console.log('🕐 Request Time:', new Date().toISOString());
    console.log('───────────────────────────────────────────────────────────────────────────────');
    
    const session = wizardSessions.get(sessionId);
    if (!session) {
      console.log('❌ Session not found:', sessionId);
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    if (!folderName || !files || !Array.isArray(files) || files.length === 0) {
      console.log('❌ Invalid request - missing folderName or files');
      return res.status(400).json({ success: false, error: 'folderName and files array are required' });
    }
    
    session.storageFolderName = folderName;
    const loadedFiles: UploadedFile[] = [];
    const errors: Array<{ fileName: string; error: string }> = [];
    
    console.log('🔄 Starting to load files from S3...');
    console.log('───────────────────────────────────────────────────────────────────────────────');
    
    for (const fileInfo of files) {
      const fileStartTime = Date.now();
      const fileName = fileInfo.name;
      
      console.log(`\n📄 Loading: ${fileName}`);
      
      try {
        // Download file from S3
        const fileData = await getFileWithBuffer(folderName, fileName);
        
        if (!fileData) {
          console.log(`   ⚠️ File not found in S3: ${fileName}`);
          errors.push({ fileName, error: 'File not found in S3' });
          continue;
        }
        
        const fileId = uuidv4();
        
        const uploadedFile: UploadedFile = {
          id: fileId,
          originalName: fileName,
          size: fileData.metadata.size || fileInfo.size || 0,
          mimeType: fileData.metadata.mimeType || fileInfo.mimeType || 'application/octet-stream',
          s3Key: fileData.metadata.s3Key,
          s3Url: fileData.metadata.s3Url,
          uploadedAt: fileData.metadata.createdAt || new Date(),
          analysisStatus: 'pending',
        };
        
        // Extract text content
        try {
          const textContent = await extractTextFromFile(fileData.buffer, fileName);
          uploadedFile.extractedText = textContent;
          console.log(`   ✅ Text extracted: ${textContent.length} characters`);
        } catch (textErr: any) {
          console.log(`   ⚠️ Could not extract text: ${textErr.message}`);
        }
        
        loadedFiles.push(uploadedFile);
        session.files.push(uploadedFile);
        
        const fileDuration = ((Date.now() - fileStartTime) / 1000).toFixed(2);
        console.log(`   ✅ Loaded in ${fileDuration}s (${uploadedFile.extractedText?.length || 0} chars of text)`);
        
      } catch (err: any) {
        const fileDuration = ((Date.now() - fileStartTime) / 1000).toFixed(2);
        console.log(`   ❌ Failed in ${fileDuration}s: ${err.message}`);
        errors.push({ fileName, error: err.message });
      }
    }
    
    session.updatedAt = new Date();
    
    const totalDuration = ((Date.now() - loadStartTime) / 1000).toFixed(2);
    
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('✅ LOAD EXISTING FILES COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('⏱️ Total Duration:', totalDuration, 'seconds');
    console.log('📄 Files Loaded:', loadedFiles.length);
    console.log('❌ Errors:', errors.length);
    if (errors.length > 0) {
      errors.forEach(e => console.log(`   - ${e.fileName}: ${e.error}`));
    }
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    
    return res.json({
      success: true,
      loadedFiles: loadedFiles.map(f => ({
        id: f.id,
        originalName: f.originalName,
        size: f.size,
        mimeType: f.mimeType,
        s3Url: f.s3Url,
        uploadedAt: f.uploadedAt,
        hasText: !!f.extractedText,
        textLength: f.extractedText?.length || 0,
      })),
      errors,
      duration: totalDuration,
    });
  } catch (error: any) {
    const totalDuration = ((Date.now() - loadStartTime) / 1000).toFixed(2);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('❌ LOAD EXISTING FILES FAILED');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('⏱️ Duration:', totalDuration, 'seconds');
    console.log('📛 Error:', error.message);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// AI ANALYSIS
// =============================================================================

/**
 * POST /api/project-tracker/analyze/:sessionId
 * Analyze all files in a session with AI
 */
router.post('/analyze/:sessionId', async (req: Request, res: Response) => {
  const analysisStartTime = Date.now();
  
  try {
    const { sessionId } = req.params;
    const { projectName, customPrompt } = req.body;
    
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('🚀 AI ANALYSIS REQUEST RECEIVED');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('📍 Session ID:', sessionId);
    console.log('📁 Project Name:', projectName || 'N/A');
    console.log('📝 Custom Prompt:', customPrompt ? 'YES (' + customPrompt.length + ' chars)' : 'NO');
    console.log('🕐 Request Time:', new Date().toISOString());
    console.log('───────────────────────────────────────────────────────────────────────────────');
    
    // Note: user info could be used for logging but not currently needed
    
    const session = wizardSessions.get(sessionId);
    if (!session) {
      console.log('❌ Session not found:', sessionId);
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    console.log('📄 Files in Session:', session.files.length);
    session.files.forEach((f, i) => {
      console.log(`   ${i + 1}. ${f.originalName} (${f.size} bytes, text: ${f.extractedText?.length || 0} chars)`);
    });
    console.log('───────────────────────────────────────────────────────────────────────────────');
    
    if (session.files.length === 0) {
      console.log('❌ No files to analyze');
      return res.status(400).json({ success: false, error: 'No files to analyze' });
    }
    
    session.status = 'analyzing';
    
    // Get known vendors and externals for better owner matching
    const [vendors, externals] = await Promise.all([
      getAllVendors(),
      getAllExternalEmployees(),
    ]);
    
    const knownOwners = {
      vendors: vendors.map(v => v.name),
      externals: externals.map(e => e.name),
    };
    
    console.log('👥 Known Owners - Vendors:', knownOwners.vendors.length, ', Externals:', knownOwners.externals.length);
    
    const allExtractedTasks: any[] = [];
    const analysisResults: any[] = [];
    
    // Analyze each file
    console.log('───────────────────────────────────────────────────────────────────────────────');
    console.log('🔍 Starting File Analysis...');
    console.log('───────────────────────────────────────────────────────────────────────────────');
    
    for (const file of session.files) {
      const fileStartTime = Date.now();
      console.log(`\n📄 Analyzing: ${file.originalName}`);
      
      if (!file.extractedText) {
        file.analysisStatus = 'error';
        file.analysisError = 'No text content available';
        console.log(`   ⚠️ Skipped - No text content available`);
        analysisResults.push({
          fileId: file.id,
          fileName: file.originalName,
          status: 'error',
          error: 'No text content available',
        });
        continue;
      }
      
      file.analysisStatus = 'analyzing';
      
      try {
        const result = await extractTasksFromText(
          file.extractedText,
          { fileName: file.originalName, projectName },
          knownOwners,
          customPrompt
        );
        
        const fileDuration = ((Date.now() - fileStartTime) / 1000).toFixed(2);
        
        file.extractedTasks = result.tasks;
        file.analysisStatus = 'completed';
        allExtractedTasks.push(...result.tasks.map(t => ({
          ...t,
          sourceFile: file.originalName,
          sourceFileId: file.id,
        })));
        
        console.log(`   ✅ Completed in ${fileDuration}s - Found ${result.tasks.length} tasks`);
        
        analysisResults.push({
          fileId: file.id,
          fileName: file.originalName,
          status: 'completed',
          tasksFound: result.tasks.length,
          tasks: result.tasks,
          duration: fileDuration,
        });
      } catch (err: any) {
        const fileDuration = ((Date.now() - fileStartTime) / 1000).toFixed(2);
        file.analysisStatus = 'error';
        file.analysisError = err.message;
        console.log(`   ❌ Failed in ${fileDuration}s - ${err.message}`);
        analysisResults.push({
          fileId: file.id,
          fileName: file.originalName,
          status: 'error',
          error: err.message,
          duration: fileDuration,
        });
      }
    }
    
    session.status = 'reviewing';
    session.updatedAt = new Date();
    
    const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(2);
    
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('✅ AI ANALYSIS COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('⏱️ Total Duration:', totalDuration, 'seconds');
    console.log('📋 Total Tasks Extracted:', allExtractedTasks.length);
    console.log('📄 Files Processed:', session.files.length);
    console.log('───────────────────────────────────────────────────────────────────────────────');
    console.log('📊 Results Summary:');
    analysisResults.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.fileName}: ${r.status} (${r.tasksFound || 0} tasks, ${r.duration || 'N/A'}s)`);
    });
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    
    return res.json({
      success: true,
      totalTasks: allExtractedTasks.length,
      results: analysisResults,
      tasks: allExtractedTasks,
      duration: totalDuration,
    });
  } catch (error: any) {
    const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(2);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('❌ AI ANALYSIS FAILED');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('⏱️ Duration:', totalDuration, 'seconds');
    console.log('📛 Error:', error.message);
    console.log('📚 Stack:', error.stack);
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/analysis/:sessionId
 * Get analysis results for a session
 */
router.get('/analysis/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = wizardSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  
  const allTasks: any[] = [];
  const fileResults = session.files.map(f => {
    const tasks = (f.extractedTasks || []).map(t => ({
      ...t,
      sourceFile: f.originalName,
      sourceFileId: f.id,
    }));
    allTasks.push(...tasks);
    
    return {
      fileId: f.id,
      fileName: f.originalName,
      status: f.analysisStatus,
      error: f.analysisError,
      tasksFound: f.extractedTasks?.length || 0,
    };
  });
  
  return res.json({
    success: true,
    status: session.status,
    totalTasks: allTasks.length,
    files: fileResults,
    tasks: allTasks,
  });
});

// =============================================================================
// TASK MANAGEMENT
// =============================================================================

/**
 * POST /api/project-tracker/tasks
 * Create tasks (typically from AI extraction)
 */
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { projectId, tasks } = req.body;
    
    if (!projectId || !tasks || !Array.isArray(tasks)) {
      return res.status(400).json({ success: false, error: 'Project ID and tasks array required' });
    }
    
    const createdTasks: Task[] = [];
    
    for (const taskData of tasks) {
      const task = await createTask({
        projectId,
        title: taskData.title,
        description: taskData.description || '',
        status: 'not-started',
        priority: taskData.priority || 'medium',
        percentComplete: 0,
        dueDate: taskData.dueDate ? new Date(taskData.dueDate) : undefined,
        ownerId: taskData.ownerId || '',
        ownerName: taskData.ownerName || 'Unassigned',
        ownerType: taskData.ownerType || 'internal',
        sourceInfo: {
          sourceType: 'upload',
          fileName: taskData.sourceFile,
          extractedText: taskData.sourceText,
          extractionReason: taskData.reasoning,
          confidence: taskData.confidence || 0.5,
        },
        isAIGenerated: true,
        aiConfidence: taskData.confidence,
        createdBy: user.id,
      }, user.id, user.name);
      
      createdTasks.push(task);
    }
    
    return res.json({ success: true, tasks: createdTasks });
  } catch (error: any) {
    console.error('Error creating tasks:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/all-tasks
 * Get all tasks (debug endpoint)
 */
router.get('/all-tasks', async (_req: Request, res: Response) => {
  try {
    const tasks = await getTasksWithFilters({});
    console.log('[ProjectTracker] All tasks in database:', tasks.length);
    tasks.forEach(t => {
      console.log(`   - ${t.taskId}: projectId="${t.projectId}" title="${t.title}"`);
    });
    return res.json({ success: true, tasks, count: tasks.length });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/tasks/:projectId
 * Get tasks for a project
 */
router.get('/tasks/:projectId', async (req: Request, res: Response) => {
  try {
    console.log(`[ProjectTracker] Getting tasks for projectId: "${req.params.projectId}"`);
    const tasks = await getTasksByProject(req.params.projectId);
    console.log(`[ProjectTracker] Found ${tasks.length} tasks`);
    return res.json({ success: true, tasks });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/project-tracker/tasks/:taskId
 * Update a task (including assignment)
 */
router.put('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const task = await updateTask(req.params.taskId, req.body, user.id, user.name, 'internal');
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    return res.json({ success: true, task });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/project-tracker/tasks/:taskId/assign
 * Assign a task to a vendor or external employee
 */
router.post('/tasks/:taskId/assign', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { ownerId, ownerName, ownerType } = req.body;
    
    if (!ownerType || !['internal', 'external', 'vendor'].includes(ownerType)) {
      return res.status(400).json({ success: false, error: 'Valid ownerType required (internal, external, vendor)' });
    }
    
    const task = await updateTask(
      req.params.taskId,
      { ownerId, ownerName, ownerType },
      user.id,
      user.name,
      'internal'
    );
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    return res.json({ success: true, task });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// VENDOR MANAGEMENT
// =============================================================================

/**
 * GET /api/project-tracker/vendors
 * List all vendors
 */
router.get('/vendors', async (_req: Request, res: Response) => {
  try {
    const vendors = await getAllVendors();
    return res.json({ success: true, vendors });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/project-tracker/vendors
 * Create a new vendor
 */
router.post('/vendors', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { name, contactName, contactEmail, phone, address, category, notes } = req.body;
    
    if (!name || !contactEmail) {
      return res.status(400).json({ success: false, error: 'Name and contact email are required' });
    }
    
    const vendor = await createVendor({
      name,
      contactName: contactName || name,
      contactEmail,
      phone,
      address,
      category,
      notes,
      status: 'active',
      portalEnabled: true,
      createdBy: user.id,
    }, user.id);
    
    return res.json({ success: true, vendor });
  } catch (error: any) {
    console.error('Error creating vendor:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/project-tracker/vendors/:vendorId
 * Update a vendor
 */
router.put('/vendors/:vendorId', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const vendor = await updateVendor(req.params.vendorId, req.body, user.id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }
    return res.json({ success: true, vendor });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/vendors/:vendorId
 * Get vendor by ID
 */
router.get('/vendors/:vendorId', async (req: Request, res: Response) => {
  try {
    const vendor = await getVendorById(req.params.vendorId);
    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }
    return res.json({ success: true, vendor });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// EXTERNAL EMPLOYEE MANAGEMENT
// =============================================================================

/**
 * GET /api/project-tracker/externals
 * List all external employees
 */
router.get('/externals', async (_req: Request, res: Response) => {
  try {
    const externals = await getAllExternalEmployees();
    return res.json({ success: true, externals });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/project-tracker/externals
 * Create a new external employee
 */
router.post('/externals', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { name, email, phone, organization, vendorId, role } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Name and email are required' });
    }
    
    const external = await createExternalEmployee({
      name,
      email,
      phone,
      organization,
      vendorId,
      role,
      status: 'active',
      portalEnabled: true,
      createdBy: user.id,
    }, user.id);
    
    return res.json({ success: true, external });
  } catch (error: any) {
    console.error('Error creating external employee:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/project-tracker/externals/:externalId
 * Update an external employee
 * TODO: Implement updateExternalEmployee in db service
 */
router.put('/externals/:externalId', async (_req: Request, res: Response) => {
  return res.status(501).json({ success: false, error: 'Update external employee not yet implemented' });
});

/**
 * GET /api/project-tracker/externals/:externalId
 * Get external employee by ID
 */
router.get('/externals/:externalId', async (req: Request, res: Response) => {
  try {
    const external = await getExternalEmployeeById(req.params.externalId);
    if (!external) {
      return res.status(404).json({ success: false, error: 'External employee not found' });
    }
    return res.json({ success: true, external });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// ASSIGNEES - Combined endpoint for task assignment dropdown
// =============================================================================

/**
 * GET /api/project-tracker/assignees
 * Get all possible assignees (vendors + external employees)
 */
router.get('/assignees', async (_req: Request, res: Response) => {
  try {
    const [vendors, externals] = await Promise.all([
      getAllVendors(),
      getAllExternalEmployees(),
    ]);
    
    const assignees = [
      ...vendors.map(v => ({
        id: v.vendorId,
        name: v.name,
        email: v.contactEmail,
        type: 'vendor' as const,
        organization: v.name,
        category: v.category,
      })),
      ...externals.map(e => ({
        id: e.externalId,
        name: e.name,
        email: e.email,
        type: 'external' as const,
        organization: e.organization,
        role: e.role,
        vendorId: e.vendorId,
      })),
    ];
    
    return res.json({ success: true, assignees, vendors, externals });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// FINALIZE PROJECT
// =============================================================================

/**
 * POST /api/project-tracker/finalize/:sessionId
 * Finalize a wizard session - create all tasks and complete project setup
 */
router.post('/finalize/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { projectId, projectInfo, tasks, existingProjectId } = req.body;
    const user = getUserInfo(req);
    
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('🏁 FINALIZE WIZARD SESSION');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('📍 Session ID:', sessionId);
    console.log('📁 Project Info:', JSON.stringify(projectInfo, null, 2));
    console.log('📋 Tasks received:', tasks?.length || 0);
    if (tasks && tasks.length > 0) {
      console.log('📝 Task details:');
      tasks.forEach((t: any, i: number) => {
        console.log(`   ${i + 1}. "${t.title}" - Owner: ${t.ownerName || 'N/A'} (${t.ownerType || 'N/A'})`);
      });
    }
    console.log('───────────────────────────────────────────────────────────────────────────────');
    
    const session = wizardSessions.get(sessionId);
    if (!session) {
      console.log('❌ Session not found:', sessionId);
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    // Determine or create the project
    let finalProjectId = projectId || existingProjectId;
    
    if (!finalProjectId && projectInfo) {
      // Create new project from projectInfo
      console.log(`[ProjectTracker] Creating new project: ${projectInfo.name}`);
      const newProject = await createProject({
        name: projectInfo.name,
        description: projectInfo.description || '',
        status: 'active',
        priority: 'medium',
        ownerId: user.id,
        ownerName: user.name,
        tags: projectInfo.tags || [],
        startDate: projectInfo.startDate ? new Date(projectInfo.startDate) : undefined,
        targetEndDate: projectInfo.targetEndDate ? new Date(projectInfo.targetEndDate) : undefined,
        linkedFolders: session.storageFolderName ? [session.storageFolderName] : [],
        createdBy: user.id,
      }, user.id, user.name);
      // Always use projectId (e.g., PRJ-001), not MongoDB _id
      finalProjectId = newProject.projectId;
      console.log(`[ProjectTracker] Created project with ID: ${finalProjectId}`);
    }
    
    if (!finalProjectId) {
      return res.status(400).json({ success: false, error: 'Project ID is required or projectInfo must be provided to create a new project' });
    }
    
    // Create all tasks
    const createdTasks: Task[] = [];
    if (tasks && Array.isArray(tasks)) {
      console.log(`[ProjectTracker] Creating ${tasks.length} tasks for project ${finalProjectId}`);
      for (const taskData of tasks) {
        console.log(`[ProjectTracker] Creating task: "${taskData.title}" - Owner: ${taskData.ownerName || 'Unassigned'} (${taskData.ownerType || 'internal'})`);
        const task = await createTask({
          projectId: finalProjectId,
          title: taskData.title,
          description: taskData.description || '',
          status: 'not-started',
          priority: taskData.priority || 'medium',
          percentComplete: 0,
          dueDate: taskData.dueDate || taskData.deadline ? new Date(taskData.dueDate || taskData.deadline) : undefined,
          ownerId: taskData.ownerId || '',
          ownerName: taskData.ownerName || 'Unassigned',
          ownerType: taskData.ownerType || 'internal',
          sourceInfo: {
            sourceType: 'upload',
            fileName: taskData.sourceFile,
            extractedText: taskData.sourceText,
            extractionReason: taskData.reasoning,
            confidence: taskData.confidence || 0.5,
          },
          isAIGenerated: true,
          aiConfidence: taskData.confidence,
          createdBy: user.id,
        }, user.id, user.name);
        
        console.log(`[ProjectTracker] Task created: ${task.taskId}`);
        createdTasks.push(task);
      }
    } else {
      console.log('[ProjectTracker] No tasks provided in finalize request');
    }
    
    // Update project status
    await updateProject(finalProjectId, { status: 'active' }, user.id, user.name);
    
    // Mark session as completed
    session.status = 'completed';
    session.updatedAt = new Date();
    
    // Log activity
    await logProjectActivity(
      'project.finalized',
      'project',
      finalProjectId,
      user.id,
      user.name,
      'internal',
      {
        description: `Project finalized with ${createdTasks.length} tasks from ${session.files.length} documents`,
        newValue: { tasksCreated: createdTasks.length, filesAnalyzed: session.files.length },
      }
    );
    
    console.log(`[ProjectTracker] Session ${sessionId} finalized: ${createdTasks.length} tasks created`);
    
    return res.json({
      success: true,
      projectId: finalProjectId,
      tasksCreated: createdTasks.length,
      tasks: createdTasks,
    });
  } catch (error: any) {
    console.error('Error finalizing session:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// AUDIT TRAIL / ACTIVITY LOGS
// =============================================================================

/**
 * GET /api/project-tracker/audit/:projectId
 * Get complete audit trail for a project
 */
router.get('/audit/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    
    const logs = await getProjectActivityLogs(projectId, limit);
    
    return res.json({
      success: true,
      logs,
      count: logs.length,
    });
  } catch (error: any) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/project-tracker/audit
 * Get all audit logs with optional filters
 */
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const { entityType, actorId, action, startDate, endDate, limit } = req.query;
    
    const logs = await getActivityLogs({
      entityType: entityType as any,
      actorId: actorId as string,
      action: action as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string) : 100,
    });
    
    return res.json({
      success: true,
      logs,
      count: logs.length,
    });
  } catch (error: any) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
