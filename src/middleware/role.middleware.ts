import { Request, Response, NextFunction } from 'express';

// Role hierarchy - higher index = more permissions
export type UserRole = 'admin' | 'evaluator' | 'reviewer';

// Define permissions for each feature area
export const PERMISSIONS: Record<string, readonly UserRole[]> = {
  // Applications
  'applications:view': ['admin', 'evaluator', 'reviewer'],
  'applications:upload': ['admin', 'evaluator'],
  'applications:delete': ['admin'],
  
  // AI Evaluation
  'evaluation:view': ['admin', 'evaluator', 'reviewer'],
  'evaluation:trigger': ['admin', 'evaluator'],
  'evaluation:refresh': ['admin', 'evaluator'],
  
  // Storage Manager
  'storage:view': ['admin', 'evaluator', 'reviewer'],
  'storage:upload': ['admin', 'evaluator'],
  'storage:delete': ['admin'],
  
  // Chat/AI Assistant
  'chat:access': ['admin', 'evaluator', 'reviewer'],
  
  // Recommendations
  'recommendations:view': ['admin', 'evaluator', 'reviewer'],
  'recommendations:modify': ['admin', 'evaluator'],
  
  // NOC Creation
  'noc:view': ['admin', 'evaluator', 'reviewer'],
  'noc:create': ['admin', 'evaluator'],
  
  // Settings
  'settings:access': ['admin'],
  'users:manage': ['admin'],
};

export type Permission = keyof typeof PERMISSIONS;

/**
 * Get user role from request headers
 */
export function getUserRole(req: Request): UserRole {
  const role = req.header('x-user-role') as UserRole;
  // Default to 'reviewer' (most restrictive) if no role provided
  if (!role || !['admin', 'evaluator', 'reviewer'].includes(role)) {
    return 'reviewer';
  }
  return role;
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const allowedRoles = PERMISSIONS[permission];
  return allowedRoles.includes(role);
}

/**
 * Middleware factory to require specific permission
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = getUserRole(req);
    
    if (!hasPermission(role, permission)) {
      res.status(403).json({
        success: false,
        error: 'Access denied',
        message: `Your role (${role}) does not have permission for this action`,
        requiredPermission: permission
      });
      return;
    }
    
    next();
  };
}

/**
 * Middleware to require admin role
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = getUserRole(req);
  
  if (role !== 'admin') {
    res.status(403).json({
      success: false,
      error: 'Admin access required',
      message: 'This action requires administrator privileges'
    });
    return;
  }
  
  next();
}

/**
 * Middleware to require evaluator or admin role
 */
export function requireEvaluator(req: Request, res: Response, next: NextFunction): void {
  const role = getUserRole(req);
  
  if (!['admin', 'evaluator'].includes(role)) {
    res.status(403).json({
      success: false,
      error: 'Evaluator access required',
      message: 'This action requires evaluator or administrator privileges'
    });
    return;
  }
  
  next();
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: UserRole): Permission[] {
  return Object.entries(PERMISSIONS)
    .filter(([_, roles]) => roles.includes(role))
    .map(([permission]) => permission as Permission);
}

/**
 * API endpoint to get current user's permissions
 */
export function getPermissionsHandler(req: Request, res: Response): void {
  const role = getUserRole(req);
  const permissions = getRolePermissions(role);
  
  res.json({
    success: true,
    role,
    permissions,
    permissionDetails: Object.fromEntries(
      Object.entries(PERMISSIONS).map(([key, roles]) => [key, roles.includes(role)])
    )
  });
}
