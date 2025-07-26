import { Router, Request, Response } from 'express';
import { AuthService, LoginCredentials, RegistrationData } from '../services/AuthService';
import { authenticateToken, validateRefreshToken, authRateLimit } from '../middleware/authMiddleware';
import { createRateLimit, validateRequest } from '../middleware/securityMiddleware';
import { authValidationSchemas } from '../utils/validation';
import { SecurityService } from '../services/SecurityService';

const router = Router();

// Enhanced rate limiting for registration
const registrationRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 3,
  keyGenerator: (req) => req.ip || 'unknown',
  onLimitReached: (req) => {
    SecurityService.logSecurityEvent({
      type: 'registration_rate_limit_exceeded',
      ip: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      url: req.url,
      indicators: ['rate_limit_violation'],
      timestamp: new Date(),
      severity: 'medium'
    });
  }
});

/**
 * POST /api/auth/register
 * Register a new player account
 */
router.post('/register', 
  registrationRateLimit,
  validateRequest(authValidationSchemas.register),
  async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, avatar }: RegistrationData = req.body;

    // Enhanced password strength validation
    const passwordStrength = SecurityService.validatePasswordStrength(password);
    if (!passwordStrength.isStrong) {
      res.status(400).json({
        success: false,
        message: 'Password does not meet security requirements',
        details: passwordStrength.feedback
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

// Enhanced rate limiting for login
const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
  keyGenerator: (req) => req.ip || 'unknown',
  onLimitReached: (req) => {
    SecurityService.logSecurityEvent({
      type: 'login_rate_limit_exceeded',
      ip: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      url: req.url,
      indicators: ['rate_limit_violation', 'potential_brute_force'],
      timestamp: new Date(),
      severity: 'high'
    });
  }
});

/**
 * POST /api/auth/login
 * Login with username/email and password
 */
router.post('/login', 
  loginRateLimit,
  validateRequest(authValidationSchemas.login),
  async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password }: LoginCredentials = req.body;

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