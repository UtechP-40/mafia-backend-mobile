import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

export const rateLimiter = (options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
}) => {
  const { windowMs, maxRequests, message = 'Too many requests' } = options;
  
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    
    // Clean up expired entries
    if (store[key] && now > store[key].resetTime) {
      delete store[key];
    }
    
    // Initialize or update counter
    if (!store[key]) {
      store[key] = {
        count: 1,
        resetTime: now + windowMs
      };
    } else {
      store[key].count++;
    }
    
    // Check if limit exceeded
    if (store[key].count > maxRequests) {
      logger.warn(`Rate limit exceeded for IP: ${key}`);
      res.status(429).json({
        success: false,
        error: {
          message,
          retryAfter: Math.ceil((store[key].resetTime - now) / 1000)
        }
      });
      return;
    }
    
    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': (maxRequests - store[key].count).toString(),
      'X-RateLimit-Reset': new Date(store[key].resetTime).toISOString()
    });
    
    next();
  };
};