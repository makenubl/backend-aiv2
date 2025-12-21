/**
 * Vendor Portal Routes
 * 
 * Provides a separate, limited-access API for vendors and external employees
 * to view and update their assigned tasks.
 * 
 * Design decisions:
 * - Separate authentication from main system
 * - Limited endpoints - only what vendors need
 * - No access to raw files or other projects
 * - All actions are audited
 * - Simple token-based auth (can be upgraded to JWT)
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  getVendorById,
  getVendorByEmail,
  getExternalEmployeeById,
  getExternalEmployeeByEmail,
  updateVendor,
  getTasksForPortalUser,
  updateTaskFromPortal,
  addTaskComment,
  getTaskById,
  logProjectActivity,
  getProjectById,
} from '../services/project-tracker-db.service';
import { VendorTaskUpdate, Vendor, ExternalEmployee } from '../types/project-tracker.types';

const router = Router();

// =============================================================================
// PORTAL SESSION MANAGEMENT
// =============================================================================

// Simple in-memory session store (use Redis in production)
interface PortalSession {
  token: string;
  userType: 'vendor' | 'external';
  userId: string;
  userName: string;
  userEmail: string;
  createdAt: Date;
  expiresAt: Date;
}

const portalSessions = new Map<string, PortalSession>();

// Session duration: 8 hours
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Generate a secure session token
 */
const generateToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Clean up expired sessions
 */
const cleanupSessions = () => {
  const now = new Date();
  for (const [token, session] of portalSessions.entries()) {
    if (session.expiresAt < now) {
      portalSessions.delete(token);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupSessions, 60 * 60 * 1000);

/**
 * Hash password for comparison
 * In production, use bcrypt
 */
const hashPassword = (password: string): string => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

// =============================================================================
// PORTAL AUTHENTICATION MIDDLEWARE
// =============================================================================

interface PortalRequest extends Request {
  portalUser?: {
    type: 'vendor' | 'external';
    id: string;
    name: string;
    email: string;
  };
}

/**
 * Middleware to authenticate portal requests
 */
const portalAuthMiddleware = (req: PortalRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  
  const token = authHeader.substring(7);
  const session = portalSessions.get(token);
  
  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
  
  if (session.expiresAt < new Date()) {
    portalSessions.delete(token);
    return res.status(401).json({ success: false, error: 'Session expired' });
  }
  
  // Attach user info to request
  req.portalUser = {
    type: session.userType,
    id: session.userId,
    name: session.userName,
    email: session.userEmail,
  };
  
  return next();
};

// =============================================================================
// AUTHENTICATION ENDPOINTS
// =============================================================================

/**
 * POST /api/portal/login
 * Authenticate vendor or external user
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    
    // Try to find vendor first
    let user: Vendor | ExternalEmployee | null = await getVendorByEmail(email);
    let userType: 'vendor' | 'external' = 'vendor';
    let userId = '';
    
    if (user) {
      userId = user.vendorId;
    } else {
      // Try external employee
      user = await getExternalEmployeeByEmail(email);
      userType = 'external';
      if (user) {
        userId = user.externalId;
      }
    }
    
    if (!user) {
      // Log failed attempt
      await logProjectActivity(
        'portal.login.failed',
        'vendor',
        'unknown',
        email,
        email,
        userType,
        { description: `Failed login attempt: user not found` }
      );
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // Check if portal access is enabled
    if (!user.portalEnabled) {
      await logProjectActivity(
        'portal.login.denied',
        userType === 'vendor' ? 'vendor' : 'external',
        userId,
        email,
        user.name,
        userType,
        { description: `Portal access not enabled` }
      );
      return res.status(403).json({ success: false, error: 'Portal access not enabled for this account' });
    }
    
    // Verify password
    const hashedPassword = hashPassword(password);
    if (user.portalPasswordHash !== hashedPassword) {
      await logProjectActivity(
        'portal.login.failed',
        userType === 'vendor' ? 'vendor' : 'external',
        userId,
        email,
        user.name,
        userType,
        { description: `Failed login attempt: invalid password` }
      );
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // Create session
    const token = generateToken();
    const session: PortalSession = {
      token,
      userType,
      userId,
      userName: user.name,
      userEmail: userType === 'vendor' ? (user as Vendor).contactEmail : (user as ExternalEmployee).email,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    };
    
    portalSessions.set(token, session);
    
    // Update last login
    if (userType === 'vendor') {
      await updateVendor(userId, { lastPortalLogin: new Date() }, 'system');
    }
    // Similar for external employees...
    
    await logProjectActivity(
      'portal.login.success',
      userType === 'vendor' ? 'vendor' : 'external',
      userId,
      session.userEmail,
      user.name,
      userType,
      { description: `Successful portal login` }
    );
    
    return res.json({
      success: true,
      token,
      user: {
        type: userType,
        id: userId,
        name: user.name,
        email: session.userEmail,
      },
      expiresAt: session.expiresAt,
    });
  } catch (error: any) {
    console.error('Portal login error:', error);
    return res.status(500).json({ success: false, error: 'Login failed' });
  }
});

/**
 * POST /api/portal/logout
 * End portal session
 */
router.post('/logout', portalAuthMiddleware, async (req: PortalRequest, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.substring(7);
    
    if (token) {
      portalSessions.delete(token);
      
      if (req.portalUser) {
        await logProjectActivity(
          'portal.logout',
          req.portalUser.type === 'vendor' ? 'vendor' : 'external',
          req.portalUser.id,
          req.portalUser.email,
          req.portalUser.name,
          req.portalUser.type,
          { description: `Portal logout` }
        );
      }
    }
    
    res.json({ success: true, message: 'Logged out' });
  } catch (error: any) {
    console.error('Portal logout error:', error);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

/**
 * GET /api/portal/me
 * Get current user info
 */
router.get('/me', portalAuthMiddleware, async (req: PortalRequest, res: Response) => {
  try {
    const { type, id } = req.portalUser!;
    
    let user: Vendor | ExternalEmployee | null = null;
    
    if (type === 'vendor') {
      user = await getVendorById(id);
    } else {
      user = await getExternalEmployeeById(id);
    }
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Return sanitized user info (no password hash)
    const { portalPasswordHash, ...safeUser } = user as any;
    
    return res.json({ success: true, user: safeUser });
  } catch (error: any) {
    console.error('Error fetching portal user:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// TASK ENDPOINTS (Protected by portal auth)
// =============================================================================

/**
 * GET /api/portal/tasks
 * Get tasks assigned to the authenticated user
 */
router.get('/tasks', portalAuthMiddleware, async (req: PortalRequest, res: Response) => {
  try {
    const { type, id } = req.portalUser!;
    
    const tasks = await getTasksForPortalUser(type, id);
    
    // Enrich tasks with project names
    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => {
        const project = await getProjectById(task.projectId);
        return {
          ...task,
          projectName: project?.name || 'Unknown Project',
          // Hide sensitive source info
          sourceInfo: task.sourceInfo ? {
            sourceType: task.sourceInfo.sourceType,
            fileName: task.sourceInfo.fileName,
          } : undefined,
        };
      })
    );
    
    res.json({ success: true, tasks: enrichedTasks });
  } catch (error: any) {
    console.error('Error fetching portal tasks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/portal/tasks/:taskId
 * Get a specific task (if assigned to user)
 */
router.get('/tasks/:taskId', portalAuthMiddleware, async (req: PortalRequest, res: Response) => {
  try {
    const { type, id } = req.portalUser!;
    const { taskId } = req.params;
    
    const task = await getTaskById(taskId);
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    // Verify user is assigned to this task
    if (task.ownerId !== id || task.ownerType !== type) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this task' });
    }
    
    const project = await getProjectById(task.projectId);
    
    return res.json({
      success: true,
      task: {
        ...task,
        projectName: project?.name || 'Unknown Project',
        sourceInfo: task.sourceInfo ? {
          sourceType: task.sourceInfo.sourceType,
          fileName: task.sourceInfo.fileName,
        } : undefined,
      },
    });
  } catch (error: any) {
    console.error('Error fetching portal task:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/portal/tasks/:taskId
 * Update a task (limited fields)
 */
router.put('/tasks/:taskId', portalAuthMiddleware, async (req: PortalRequest, res: Response) => {
  try {
    const { type, id, name } = req.portalUser!;
    const { taskId } = req.params;
    const { percentComplete, status, comment, blockerReason } = req.body;
    
    const update: VendorTaskUpdate = {
      taskId,
      percentComplete,
      status,
      comment,
      blockerReason,
    };
    
    const task = await updateTaskFromPortal(taskId, update, id, name, type);
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found or not authorized' });
    }
    
    return res.json({ success: true, task });
  } catch (error: any) {
    console.error('Error updating portal task:', error);
    if (error.message === 'Not authorized to update this task') {
      return res.status(403).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/portal/tasks/:taskId/comments
 * Add a comment to a task
 */
router.post('/tasks/:taskId/comments', portalAuthMiddleware, async (req: PortalRequest, res: Response) => {
  try {
    const { type, id, name } = req.portalUser!;
    const { taskId } = req.params;
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, error: 'Comment content required' });
    }
    
    // Verify user owns this task
    const existingTask = await getTaskById(taskId);
    if (!existingTask || existingTask.ownerId !== id || existingTask.ownerType !== type) {
      return res.status(403).json({ success: false, error: 'Not authorized to comment on this task' });
    }
    
    const task = await addTaskComment(taskId, content, id, name, type);
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    return res.json({ success: true, task });
  } catch (error: any) {
    console.error('Error adding portal comment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// ADMIN ENDPOINTS (For internal users to manage portal access)
// =============================================================================

/**
 * POST /api/portal/admin/set-password
 * Set portal password for a vendor/external user (internal admin only)
 * This endpoint should use main app authentication, not portal auth
 */
router.post('/admin/set-password', async (req: Request, res: Response) => {
  try {
    // Verify this is an internal admin user
    const role = req.header('x-user-role');
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    const adminEmail = req.header('x-user-email') || 'admin';
    const { userType, userId, password, enablePortal } = req.body;
    
    if (!userType || !userId || !password) {
      return res.status(400).json({ success: false, error: 'userType, userId, and password required' });
    }
    
    const hashedPassword = hashPassword(password);
    
    if (userType === 'vendor') {
      await updateVendor(userId, {
        portalPasswordHash: hashedPassword,
        portalEnabled: enablePortal !== false,
      }, adminEmail);
    } else {
      // Update external employee password
      // Would need to add updateExternalEmployee function
      return res.status(400).json({ success: false, error: 'External employee password update not implemented' });
    }
    
    await logProjectActivity(
      'portal.password.set',
      userType === 'vendor' ? 'vendor' : 'external',
      userId,
      adminEmail,
      adminEmail,
      'internal',
      { description: `Portal password set by admin` }
    );
    
    return res.json({ success: true, message: 'Portal password set' });
  } catch (error: any) {
    console.error('Error setting portal password:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/portal/admin/sessions
 * List active portal sessions (internal admin only)
 */
router.get('/admin/sessions', async (req: Request, res: Response) => {
  try {
    const role = req.header('x-user-role');
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    const sessions = Array.from(portalSessions.values()).map(s => ({
      userType: s.userType,
      userId: s.userId,
      userName: s.userName,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
    
    return res.json({ success: true, sessions });
  } catch (error: any) {
    console.error('Error listing sessions:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/portal/admin/sessions/:userId
 * Revoke all sessions for a user (internal admin only)
 */
router.delete('/admin/sessions/:userId', async (req: Request, res: Response) => {
  try {
    const role = req.header('x-user-role');
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    
    const { userId } = req.params;
    
    let revokedCount = 0;
    for (const [token, session] of portalSessions.entries()) {
      if (session.userId === userId) {
        portalSessions.delete(token);
        revokedCount++;
      }
    }
    
    return res.json({ success: true, revokedCount });
  } catch (error: any) {
    console.error('Error revoking sessions:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
