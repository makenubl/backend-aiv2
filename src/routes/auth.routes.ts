import { Router, Request, Response } from 'express';
import { findUserByUsername } from '../services/database.service';

const router = Router();

interface LoginRequest extends Request {
  body: {
    username: string;
    password: string;
  };
}

// Login endpoint
router.post('/login', async (req: LoginRequest, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const user = await findUserByUsername(username);

    if (!user || user.password !== password) {
      console.log(`Login failed for username: ${username}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    console.log(`Login successful for username: ${username}`);
    // Return user info on successful login (without password)
    const { password: _, ...userWithoutPassword } = user;
    return res.status(200).json({
      success: true,
      user: userWithoutPassword,
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// Verify token endpoint (optional, for future JWT implementation)
router.post('/verify', (_req: Request, res: Response) => {
  try {
    return res.status(200).json({
      success: true,
      message: 'Token is valid'
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

export default router;
