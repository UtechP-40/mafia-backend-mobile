import { Request, Response, NextFunction } from 'express';
import { AuthService, JWTPayload } from '../services/AuthService';
import { IPlayer } from '../models/Player';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: IPlayer;
      userId?: string;
    }
  }
}

/**
 * Middleware to authenticate JWT tokens
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
      return;
    }

    // Verify token
    const payload = AuthService.verifyAccessToken(token);
    if (!payload) {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired access token' 
      });
      return;
    }

    // Get user from database
    const user = await AuthService.getPlayerById(payload.userId);
    if (!user) {
      res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
      return;
    }

    // Attach user to request
    req.user = user;
    req.userId = payload.userId;
    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Authentication failed' 
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const payload = AuthService.verifyAccessToken(token);
      if (payload) {
        const user = await AuthService.getPlayerById(payload.userId);
        if (user) {
          req.user = user;
          req.userId = payload.userId;
        }
      }
    }

    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // Continue even if authentication fails
  }
};

/**
 * Middleware to validate refresh token
 */
export const validateRefreshToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(401).json({ 
        success: false, 
        message: 'Refresh token required' 
      });
      return;
    }

    // Verify refresh token format
    const payload = AuthService.verifyRefreshToken(refreshToken);
    if (!payload) {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid refresh token' 
      });
      return;
    }

    // Attach payload to request for use in route handler
    req.body.tokenPayload = payload;
    next();
  } catch (error) {
    console.error('Refresh token validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Token validation failed' 
    });
  }
};

/**
 * Middleware for role-based access control (future use)
 */
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }

    // For now, all authenticated users have access
    // This can be extended when role system is implemented
    next();
  };
};

/**
 * Rate limiting middleware for authentication endpoints
 */
export const authRateLimit = (maxAttempts: number = 5, windowMs: number = 15 * 60 * 1000) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate limiting in test environment
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }

    const identifier = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    // Clean up expired entries
    for (const [key, value] of attempts.entries()) {
      if (now > value.resetTime) {
        attempts.delete(key);
      }
    }

    const userAttempts = attempts.get(identifier);

    if (!userAttempts) {
      attempts.set(identifier, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (userAttempts.count >= maxAttempts) {
      res.status(429).json({
        success: false,
        message: 'Too many authentication attempts. Please try again later.',
        retryAfter: Math.ceil((userAttempts.resetTime - now) / 1000)
      });
      return;
    }

    userAttempts.count++;
    next();
  };
};