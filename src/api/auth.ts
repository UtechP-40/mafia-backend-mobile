import { Router, Request, Response } from 'express';
import { AuthService, LoginCredentials, RegistrationData } from '../services/AuthService';
import { authenticateToken, validateRefreshToken, authRateLimit } from '../middleware/authMiddleware';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new player account
 */
router.post('/register', authRateLimit(3, 15 * 60 * 1000), async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, avatar }: RegistrationData = req.body;

    // Input validation
    if (!username || !password) {
      res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
      return;
    }

    // Additional validation
    if (username.length < 3 || username.length > 20) {
      res.status(400).json({
        success: false,
        message: 'Username must be between 3 and 20 characters'
      });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      res.status(400).json({
        success: false,
        message: 'Username can only contain letters, numbers, and underscores'
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
      return;
    }

    const result = await AuthService.register({
      username,
      email,
      password,
      avatar
    });

    if (result.success) {
      res.status(201).json({
        success: true,
        message: result.message,
        data: {
          player: result.player,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Registration endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/login
 * Login with username/email and password
 */
router.post('/login', authRateLimit(5, 15 * 60 * 1000), async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password }: LoginCredentials = req.body;

    // Input validation
    if (!password) {
      res.status(400).json({
        success: false,
        message: 'Password is required'
      });
      return;
    }

    if (!username && !email) {
      res.status(400).json({
        success: false,
        message: 'Username or email is required'
      });
      return;
    }

    const result = await AuthService.login({
      username,
      email,
      password
    });

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          player: result.player,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Login endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', validateRefreshToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    const result = await AuthService.refreshToken(refreshToken);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          player: result.player,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Token refresh endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/auth/logout
 * Logout and invalidate refresh token
 */
router.delete('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
      return;
    }

    const result = await AuthService.logout(refreshToken);

    res.status(200).json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('Logout endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/auth/logout-all
 * Logout from all devices (invalidate all refresh tokens)
 */
router.delete('/logout-all', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    const result = await AuthService.logoutAll(userId);

    res.status(200).json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('Logout all endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user profile
 */
router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    res.status(200).json({
      success: true,
      message: 'User profile retrieved successfully',
      data: {
        player: user
      }
    });
  } catch (error) {
    console.error('Get profile endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/verify-token
 * Verify if access token is valid
 */
router.post('/verify-token', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      message: 'Token is valid',
      data: {
        userId: req.userId,
        username: req.user!.username
      }
    });
  } catch (error) {
    console.error('Token verification endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export { router as authRoutes };