/**
 * Project Tracker API Routes
 * 
 * Provides REST API endpoints for the Project Activity Tracking system.
 * Handles projects, tasks, vendors, external employees, OneDrive sync, and AI analysis.
 * 
 * Design decisions:
 * - Follows existing API patterns from storage.routes.ts
 * - Uses role-based permissions from existing middleware
 * - Comprehensive error handling
 * - Activity logging for all mutations
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requirePermission } from '../middleware/role.middleware';
import {
  // Projects
  createProject,
  getProjectById,
  getAllProjects,
  updateProject,
  deleteProject,
  // Tasks
  createTask,
  getTaskById,
  getTasksByProject,
  getTasksWithFilters,
  updateTask,
  addTaskComment,
  deleteTask,
  // Vendors
  createVendor,
  getVendorById,
  getAllVendors,
  updateVendor,
  // External Employees
  createExternalEmployee,
  getAllExternalEmployees,
  // Dashboard
  getDashboardStats,
  // Activity logs
  getProjectActivityLogsCollection,
} from '../services/project-tracker-db.service';
// OneDrive integration removed - now using manual file upload wizard
import {
  extractTasksFromDocument,
  processPendingSyncRecords,
  recordTaskCorrection,
} from '../services/task-extraction.service';
import {
  generateProjectSummary,
  generatePendingOnWhomAnalysis,
  generateDashboardSummary,
} from '../services/project-intelligence.service';
import { TaskFilterOptions, OwnerType, TaskStatus, TaskPriority } from '../types/project-tracker.types';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// Helper to get user info from request
const getUserInfo = (req: Request): { id: string; name: string; email: string } => {
  const email = req.header('x-user-email') || 'unknown';
  return {
    id: email,
    name: email.split('@')[0],
    email,
  };
};

// =============================================================================
// DASHBOARD ENDPOINTS
// =============================================================================

/**
 * GET /api/projects/dashboard/stats
 * Get aggregated dashboard statistics
 */
router.get('/dashboard/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getDashboardStats();
    return res.json({ success: true, stats });
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/dashboard/summary
 * Get AI-generated dashboard summary
 */
router.get('/dashboard/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await generateDashboardSummary();
    return res.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('Error generating dashboard summary:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/dashboard/pending-on-whom
 * Get analysis of what's pending on whom
 */
router.get('/dashboard/pending-on-whom', async (_req: Request, res: Response) => {
  try {
    const analysis = await generatePendingOnWhomAnalysis();
    
    // Convert Map to array for JSON response
    const byOwnerArray = Array.from(analysis.byOwner.entries()).map(([key, value]) => ({
      key,
      owner: value.owner,
      type: value.type,
      taskCount: value.tasks.length,
      tasks: value.tasks.map(t => ({
        taskId: t.taskId,
        title: t.title,
        status: t.status,
        dueDate: t.dueDate,
        projectId: t.projectId,
      })),
    }));
    
    return res.json({
      success: true,
      summary: analysis.summary,
      topBlockers: analysis.topBlockers,
      recommendations: analysis.recommendations,
      riskAreas: analysis.riskAreas,
      byOwner: byOwnerArray,
    });
  } catch (error: any) {
    console.error('Error generating pending-on-whom analysis:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// PROJECT ENDPOINTS
// =============================================================================

/**
 * GET /api/projects
 * List all projects with optional filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, ownerId, limit, skip } = req.query;
    
    const projects = await getAllProjects({
      status: status ? (status as string).split(',') as any[] : undefined,
      ownerId: ownerId as string,
      limit: limit ? parseInt(limit as string) : undefined,
      skip: skip ? parseInt(skip as string) : undefined,
    });
    
    return res.json({ success: true, projects });
  } catch (error: any) {
    console.error('Error listing projects:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:projectId
 * Get a single project by ID
 */
router.get('/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const project = await getProjectById(projectId);
    
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    
    return res.json({ success: true, project });
  } catch (error: any) {
    console.error('Error fetching project:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { name, description, status, priority, startDate, targetEndDate, linkedFolders, tags } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Project name is required' });
    }
    
    const project = await createProject(
      {
        name,
        description,
        status: status || 'active',
        priority: priority || 'medium',
        ownerId: user.id,
        ownerName: user.name,
        startDate: startDate ? new Date(startDate) : undefined,
        targetEndDate: targetEndDate ? new Date(targetEndDate) : undefined,
        linkedFolders,
        tags,
        createdBy: user.id,
      },
      user.id,
      user.name
    );
    
    return res.status(201).json({ success: true, project });
  } catch (error: any) {
    console.error('Error creating project:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/projects/:projectId
 * Update a project
 */
router.put('/:projectId', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { projectId } = req.params;
    const updates = req.body;
    
    // Sanitize date fields
    if (updates.startDate) updates.startDate = new Date(updates.startDate);
    if (updates.targetEndDate) updates.targetEndDate = new Date(updates.targetEndDate);
    if (updates.actualEndDate) updates.actualEndDate = new Date(updates.actualEndDate);
    
    const project = await updateProject(projectId, updates, user.id, user.name);
    
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    
    return res.json({ success: true, project });
  } catch (error: any) {
    console.error('Error updating project:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/projects/:projectId
 * Delete a project (admin only)
 */
router.delete('/:projectId', requirePermission('storage:delete'), async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { projectId } = req.params;
    
    const deleted = await deleteProject(projectId, user.id, user.name);
    
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    
    return res.json({ success: true, message: 'Project deleted' });
  } catch (error: any) {
    console.error('Error deleting project:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/:projectId/summary
 * Get AI summary for a project
 */
router.get('/:projectId/summary', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { refresh } = req.query;
    
    const summary = await generateProjectSummary(projectId, refresh === 'true');
    
    res.json({ success: true, summary });
  } catch (error: any) {
    console.error('Error generating project summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// TASK ENDPOINTS
// =============================================================================

/**
 * GET /api/projects/:projectId/tasks
 * List tasks for a project
 */
router.get('/:projectId/tasks', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { status, ownerType } = req.query;
    
    const tasks = await getTasksByProject(projectId, {
      status: status ? (status as string).split(',') as TaskStatus[] : undefined,
      ownerType: ownerType ? (ownerType as string).split(',') as OwnerType[] : undefined,
    });
    
    res.json({ success: true, tasks });
  } catch (error: any) {
    console.error('Error listing tasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/tasks/filter
 * Filter tasks across all projects
 */
router.get('/tasks/filter', async (req: Request, res: Response) => {
  try {
    const {
      projectId,
      status,
      ownerType,
      ownerId,
      priority,
      dueDateFrom,
      dueDateTo,
      isOverdue,
      isBlocked,
      searchQuery,
    } = req.query;
    
    const filters: TaskFilterOptions = {
      projectId: projectId as string,
      status: status ? (status as string).split(',') as TaskStatus[] : undefined,
      ownerType: ownerType ? (ownerType as string).split(',') as OwnerType[] : undefined,
      ownerId: ownerId as string,
      priority: priority ? (priority as string).split(',') as TaskPriority[] : undefined,
      dueDateFrom: dueDateFrom ? new Date(dueDateFrom as string) : undefined,
      dueDateTo: dueDateTo ? new Date(dueDateTo as string) : undefined,
      isOverdue: isOverdue === 'true',
      isBlocked: isBlocked === 'true',
      searchQuery: searchQuery as string,
    };
    
    const tasks = await getTasksWithFilters(filters);
    
    res.json({ success: true, tasks });
  } catch (error: any) {
    console.error('Error filtering tasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/tasks/:taskId
 * Get a single task
 */
router.get('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const task = await getTaskById(taskId);
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    return res.json({ success: true, task });
  } catch (error: any) {
    console.error('Error fetching task:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/projects/:projectId/tasks
 * Create a task manually
 */
router.post('/:projectId/tasks', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { projectId } = req.params;
    const {
      title,
      description,
      status,
      priority,
      ownerType,
      ownerId,
      ownerName,
      dueDate,
      dependsOn,
    } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, error: 'Task title is required' });
    }
    
    const task = await createTask(
      {
        projectId,
        title,
        description,
        status: status || 'not-started',
        priority: priority || 'medium',
        percentComplete: 0,
        ownerType: ownerType || 'internal',
        ownerId: ownerId || user.id,
        ownerName: ownerName || user.name,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        dependsOn,
        isAIGenerated: false,
        createdBy: user.id,
      },
      user.id,
      user.name
    );
    
    return res.status(201).json({ success: true, task });
  } catch (error: any) {
    console.error('Error creating task:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/projects/tasks/:taskId
 * Update a task
 */
router.put('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { taskId } = req.params;
    const updates = req.body;
    
    // Track corrections for AI-generated tasks
    const existingTask = await getTaskById(taskId);
    if (existingTask?.isAIGenerated) {
      // Record significant corrections
      if (updates.title && updates.title !== existingTask.title) {
        await recordTaskCorrection(taskId, 'title', existingTask.title, updates.title, user.id);
      }
      if (updates.ownerName && updates.ownerName !== existingTask.ownerName) {
        await recordTaskCorrection(taskId, 'owner', existingTask.ownerName, updates.ownerName, user.id);
      }
      if (updates.dueDate && updates.dueDate !== existingTask.dueDate?.toISOString()) {
        await recordTaskCorrection(taskId, 'deadline', existingTask.dueDate, updates.dueDate, user.id);
      }
    }
    
    // Sanitize date fields
    if (updates.dueDate) updates.dueDate = new Date(updates.dueDate);
    if (updates.startDate) updates.startDate = new Date(updates.startDate);
    
    const task = await updateTask(taskId, updates, user.id, user.name, 'internal');
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    return res.json({ success: true, task });
  } catch (error: any) {
    console.error('Error updating task:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/projects/tasks/:taskId/comments
 * Add a comment to a task
 */
router.post('/tasks/:taskId/comments', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { taskId } = req.params;
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, error: 'Comment content is required' });
    }
    
    const task = await addTaskComment(taskId, content, user.id, user.name, 'internal');
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    return res.json({ success: true, task });
  } catch (error: any) {
    console.error('Error adding comment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/projects/tasks/:taskId
 * Delete a task
 */
router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { taskId } = req.params;
    
    // Record deletion for AI-generated tasks
    const existingTask = await getTaskById(taskId);
    if (existingTask?.isAIGenerated) {
      await recordTaskCorrection(taskId, 'deleted', existingTask.title, null, user.id);
    }
    
    const deleted = await deleteTask(taskId, user.id, user.name);
    
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    return res.json({ success: true, message: 'Task deleted' });
  } catch (error: any) {
    console.error('Error deleting task:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// VENDOR ENDPOINTS
// =============================================================================

/**
 * GET /api/projects/vendors
 * List all vendors
 */
router.get('/vendors', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const vendors = await getAllVendors(status as any);
    res.json({ success: true, vendors });
  } catch (error: any) {
    console.error('Error listing vendors:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/projects/vendors/:vendorId
 * Get a vendor by ID
 */
router.get('/vendors/:vendorId', async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const vendor = await getVendorById(vendorId);
    
    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }
    
    return res.json({ success: true, vendor });
  } catch (error: any) {
    console.error('Error fetching vendor:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/projects/vendors
 * Create a new vendor
 */
router.post('/vendors', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { name, contactName, contactEmail, phone, address, category, portalEnabled } = req.body;
    
    if (!name || !contactName || !contactEmail) {
      return res.status(400).json({ success: false, error: 'Name, contact name, and contact email are required' });
    }
    
    const vendor = await createVendor(
      {
        name,
        contactName,
        contactEmail,
        phone,
        address,
        category,
        status: 'active',
        portalEnabled: portalEnabled || false,
        createdBy: user.id,
      },
      user.id
    );
    
    return res.status(201).json({ success: true, vendor });
  } catch (error: any) {
    console.error('Error creating vendor:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/projects/vendors/:vendorId
 * Update a vendor
 */
router.put('/vendors/:vendorId', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { vendorId } = req.params;
    const updates = req.body;
    
    const vendor = await updateVendor(vendorId, updates, user.id);
    
    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found' });
    }
    
    return res.json({ success: true, vendor });
  } catch (error: any) {
    console.error('Error updating vendor:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// EXTERNAL EMPLOYEE ENDPOINTS
// =============================================================================

/**
 * GET /api/projects/externals
 * List all external employees
 */
router.get('/externals', async (_req: Request, res: Response) => {
  try {
    const externals = await getAllExternalEmployees();
    return res.json({ success: true, externals });
  } catch (error: any) {
    console.error('Error listing external employees:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/projects/externals
 * Create a new external employee
 */
router.post('/externals', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { name, email, phone, organization, vendorId, role, portalEnabled } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Name and email are required' });
    }
    
    const external = await createExternalEmployee(
      {
        name,
        email,
        phone,
        organization,
        vendorId,
        role,
        status: 'active',
        portalEnabled: portalEnabled || false,
        createdBy: user.id,
      },
      user.id
    );
    
    return res.status(201).json({ success: true, external });
  } catch (error: any) {
    console.error('Error creating external employee:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// AI EXTRACTION ENDPOINTS
// =============================================================================

/**
 * POST /api/projects/:projectId/extract
 * Extract tasks from an uploaded file
 */
router.post('/:projectId/extract', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { projectId } = req.params;
    const { autoCreate } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }
    
    const result = await extractTasksFromDocument(
      req.file.buffer,
      req.file.originalname,
      {
        projectId,
        createdBy: user.id,
        autoCreateTasks: autoCreate === 'true',
      }
    );
    
    return res.json({ ...result, success: true });
  } catch (error: any) {
    console.error('Error extracting tasks:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/projects/:projectId/process-synced
 * Process all pending synced files for a project
 */
router.post('/:projectId/process-synced', async (req: Request, res: Response) => {
  try {
    const user = getUserInfo(req);
    const { projectId } = req.params;
    
    const result = await processPendingSyncRecords(projectId, user.id);
    
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Error processing synced files:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// ACTIVITY LOG ENDPOINTS
// =============================================================================

/**
 * GET /api/projects/activity-logs
 * Get activity logs with optional filters
 */
router.get('/activity-logs', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId, limit, skip } = req.query;
    
    const col = getProjectActivityLogsCollection();
    const query: any = {};
    
    if (entityType) query.entityType = entityType;
    if (entityId) query.entityId = entityId;
    
    let cursor = col.find(query).sort({ timestamp: -1 });
    if (skip) cursor = cursor.skip(parseInt(skip as string));
    if (limit) cursor = cursor.limit(parseInt(limit as string) || 50);
    
    const logs = await cursor.toArray();
    
    res.json({ success: true, logs });
  } catch (error: any) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
