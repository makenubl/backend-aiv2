import { Router, Request, Response } from 'express';
import { getAllUsers, createUser, updateUser, deleteUser, findUserByUsername } from '../services/database.service';
import { requirePermission } from '../middleware/role.middleware';

const router = Router();

/**
 * GET /api/users
 * Get all users (admin only)
 */
router.get('/', requirePermission('users:manage'), async (_req: Request, res: Response) => {
  try {
    const users = await getAllUsers();
    // Don't send passwords to frontend
    const sanitizedUsers = users.map(({ password, ...user }) => user);
    res.json({
      success: true,
      users: sanitizedUsers
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * POST /api/users
 * Create a new user (admin only)
 */
router.post('/', requirePermission('users:manage'), async (req: Request, res: Response) => {
  try {
    const { username, email, password, name, role } = req.body;

    // Validation
    if (!username || !email || !password || !name || !role) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required: username, email, password, name, role'
      });
    }

    if (!['admin', 'evaluator', 'reviewer'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Role must be admin, evaluator, or reviewer'
      });
    }

    // Check if user already exists
    const existingUser = await findUserByUsername(username);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Username already exists'
      });
    }

    const newUser = await createUser({
      username,
      email,
      password,
      name,
      role
    });

    // Don't send password back
    const { password: _, ...sanitizedUser } = newUser;

    return res.status(201).json({
      success: true,
      user: sanitizedUser,
      message: 'User created successfully'
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Username or email already exists'
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

/**
 * PUT /api/users/:username
 * Update a user (admin only)
 */
router.put('/:username', requirePermission('users:manage'), async (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    const { email, password, name, role } = req.body;

    const updates: any = {};
    if (email) updates.email = email;
    if (password) updates.password = password;
    if (name) updates.name = name;
    if (role) {
      if (!['admin', 'evaluator', 'reviewer'].includes(role)) {
        return res.status(400).json({
          success: false,
          error: 'Role must be admin, evaluator, or reviewer'
        });
      }
      updates.role = role;
    }

    const updatedUser = await updateUser(username, updates);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Don't send password back
    const { password: _, ...sanitizedUser } = updatedUser;

    return res.json({
      success: true,
      user: sanitizedUser,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

/**
 * DELETE /api/users/:username
 * Delete a user (admin only)
 */
router.delete('/:username', requirePermission('users:manage'), async (req: Request, res: Response) => {
  try {
    const { username } = req.params;

    const deleted = await deleteUser(username);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    return res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete user'
    });
  }
});

export default router;
