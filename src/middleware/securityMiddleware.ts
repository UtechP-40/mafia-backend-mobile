import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { SecurityService } from '../services/SecurityService';

/**
 * Enhanced rate limiting with different tiers
 */
export const createRateLimit = (options: {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  onLimitReached?: (req: Request) => void;
}) => {
  const store = new Map<string, { count: number; resetTime: number; violations: number }>();
  
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate limiting in test environment unless explicitly testing it
    if (process.env.NODE_ENV === 'test' && !process.env.TEST_RATE_LIMITING) {
      next();
      return;
    }

    const key = options.keyGenerator ? options.keyGenerator(req) : (req.ip || 'unknown');
    const now = Date.now();
    
    // Clean up expired entries
    for (const [k, v] of store.entries()) {
      if (now > v.resetTime) {
        store.delete(k);
      }
    }
    
    let entry = store.get(key);
    if (!entry) {
      entry = { count: 0, resetTime: now + options.windowMs, violations: 0 };
      store.set(key, entry);
    }
    
    entry.count++;
    
    if (entry.count > options.maxRequests) {
      entry.violations++;
      
      // Progressive penalties for repeat offenders
      const penaltyMultiplier = Math.min(entry.violations, 10);
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000) * penaltyMultiplier;
      
      logger.warn(`Rate limit exceeded for ${key}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        violations: entry.violations
      });
      
      if (options.onLimitReached) {
        options.onLimitReached(req);
      }
      
      res.status(429).json({
        success: false,
        error: {
          message: 'Rate limit exceeded',
          retryAfter,
          violations: entry.violations
        }
      });
      return;
    }
    
    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': options.maxRequests.toString(),
      'X-RateLimit-Remaining': Math.max(0, options.maxRequests - entry.count).toString(),
      'X-RateLimit-Reset': new Date(entry.resetTime).toISOString()
    });
    
    next();
  };
};

/**
 * Input sanitization middleware
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = SecurityService.sanitizeObject(req.body);
    }
    
    // Sanitize query parameters - req.query is read-only, so we modify properties individually
    if (req.query && typeof req.query === 'object') {
      const sanitizedQuery = SecurityService.sanitizeObject(req.query);
      // Clear existing properties and set sanitized ones
      Object.keys(req.query).forEach(key => {
        delete (req.query as any)[key];
      });
      Object.assign(req.query, sanitizedQuery);
    }
    
    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      req.params = SecurityService.sanitizeObject(req.params);
    }
    
    next();
  } catch (error) {
    logger.error('Input sanitization error:', error);
    res.status(400).json({
      success: false,
      error: { message: 'Invalid input format' }
    });
  }
};

/**
 * Request validation middleware
 */
export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validation = SecurityService.validateInput(req.body, schema);
      
      if (!validation.isValid) {
        res.status(400).json({
          success: false,
          error: {
            message: 'Validation failed',
            details: validation.errors
          }
        });
        return;
      }
      
      next();
    } catch (error) {
      logger.error('Request validation error:', error);
      res.status(500).json({
        success: false,
        error: { message: 'Validation error' }
      });
    }
  };
};

/**
 * Security headers middleware
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // Content Security Policy
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' wss: ws:; " +
    "font-src 'self'; " +
    "object-src 'none'; " +
    "media-src 'self'; " +
    "frame-src 'none';"
  );
  
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  next();
};

/**
 * Anti-CSRF middleware for state-changing operations
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  // Skip for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  
  const token = req.headers['x-csrf-token'] as string;
  const sessionToken = req.headers['x-session-token'] as string;
  
  if (!token || !sessionToken) {
    res.status(403).json({
      success: false,
      error: { message: 'CSRF token required' }
    });
    return;
  }
  
  if (!SecurityService.validateCSRFToken(token, sessionToken)) {
    res.status(403).json({
      success: false,
      error: { message: 'Invalid CSRF token' }
    });
    return;
  }
  
  next();
};

/**
 * Suspicious activity detection middleware
 */
export const suspiciousActivityDetection = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const suspiciousIndicators = SecurityService.detectSuspiciousActivity(req);
    
    if (suspiciousIndicators.length > 0) {
      logger.warn('Suspicious activity detected', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        indicators: suspiciousIndicators,
        userId: req.userId
      });
      
      // Log to security service for analysis
      SecurityService.logSecurityEvent({
        type: 'suspicious_activity',
        ip: req.ip || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        url: req.url,
        userId: req.userId,
        indicators: suspiciousIndicators,
        timestamp: new Date()
      });
      
      // For high-risk indicators, block the request
      const highRiskIndicators = suspiciousIndicators.filter(i => 
        ['sql_injection', 'xss_attempt', 'path_traversal'].includes(i)
      );
      
      if (highRiskIndicators.length > 0) {
        res.status(403).json({
          success: false,
          error: { message: 'Request blocked for security reasons' }
        });
        return;
      }
    }
    
    next();
  } catch (error) {
    logger.error('Suspicious activity detection error:', error);
    next(); // Continue processing to avoid blocking legitimate requests
  }
};

/**
 * Request size limiting middleware
 */
export const requestSizeLimit = (maxSize: number = 1024 * 1024) => { // 1MB default
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.get('content-length') || '0');
    
    if (contentLength > maxSize) {
      res.status(413).json({
        success: false,
        error: { 
          message: 'Request entity too large',
          maxSize: `${maxSize} bytes`
        }
      });
      return;
    }
    
    next();
  };
};

/**
 * HTTPS redirect middleware for production
 */
export const httpsRedirect = (req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV === 'production' && !req.secure && req.get('x-forwarded-proto') !== 'https') {
    const httpsUrl = `https://${req.get('host')}${req.url}`;
    res.redirect(301, httpsUrl);
    return;
  }
  next();
};

/**
 * IP blocking middleware
 */
const blockedIPs = new Set<string>();
const ipBlockExpiry = new Map<string, number>();

export const ipBlocking = (req: Request, res: Response, next: NextFunction): void => {
  const clientIP = req.ip || 'unknown';
  
  // Clean up expired blocks
  const now = Date.now();
  for (const [ip, expiry] of ipBlockExpiry.entries()) {
    if (now > expiry) {
      blockedIPs.delete(ip);
      ipBlockExpiry.delete(ip);
    }
  }
  
  // Check if IP is blocked
  if (blockedIPs.has(clientIP)) {
    const expiry = ipBlockExpiry.get(clientIP);
    const remainingTime = expiry ? Math.ceil((expiry - now) / 1000) : 0;
    
    res.status(403).json({
      success: false,
      error: {
        message: 'IP address blocked',
        remainingTime,
        reason: 'Security violation'
      }
    });
    return;
  }
  
  // Auto-block IPs with too many security violations
  if (SecurityService.shouldBlockIP(clientIP)) {
    blockIP(clientIP, 'Automatic block due to security violations', 3600000); // 1 hour
    
    res.status(403).json({
      success: false,
      error: {
        message: 'IP address blocked due to security violations',
        remainingTime: 3600
      }
    });
    return;
  }
  
  next();
};

/**
 * Block an IP address
 */
export const blockIP = (ip: string, reason: string, duration: number = 3600000): void => {
  blockedIPs.add(ip);
  ipBlockExpiry.set(ip, Date.now() + duration);
  
  logger.warn(`IP blocked: ${ip}`, { reason, duration });
};

/**
 * Unblock an IP address
 */
export const unblockIP = (ip: string): boolean => {
  const wasBlocked = blockedIPs.has(ip);
  blockedIPs.delete(ip);
  ipBlockExpiry.delete(ip);
  
  if (wasBlocked) {
    logger.info(`IP unblocked: ${ip}`);
  }
  
  return wasBlocked;
};

/**
 * Get blocked IPs list
 */
export const getBlockedIPs = (): Array<{ ip: string; expiresAt: number }> => {
  const result = [];
  for (const ip of blockedIPs) {
    const expiresAt = ipBlockExpiry.get(ip) || 0;
    result.push({ ip, expiresAt });
  }
  return result;
};

/**
 * Advanced security headers middleware
 */
export const advancedSecurityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // Strict Transport Security (HSTS)
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  // Certificate Transparency
  res.setHeader('Expect-CT', 'max-age=86400, enforce');
  
  // Feature Policy / Permissions Policy
  res.setHeader('Permissions-Policy', [
    'geolocation=()',
    'microphone=()',
    'camera=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'speaker=()',
    'vibrate=()',
    'fullscreen=(self)',
    'sync-xhr=()'
  ].join(', '));
  
  // Cross-Origin policies
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  
  // Additional security headers
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  
  next();
};

/**
 * Request signature verification middleware
 */
export const verifyRequestSignature = (secret: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.get('x-signature');
    const timestamp = req.get('x-timestamp');
    
    if (!signature || !timestamp) {
      next(); // Optional signature verification
      return;
    }
    
    // Verify timestamp (prevent replay attacks)
    const requestTime = parseInt(timestamp);
    const now = Date.now();
    if (Math.abs(now - requestTime) > 300000) { // 5 minutes tolerance
      res.status(401).json({
        success: false,
        error: { message: 'Request timestamp expired' }
      });
      return;
    }
    
    // Verify signature
    const crypto = require('crypto');
    const payload = `${req.method}${req.url}${timestamp}${JSON.stringify(req.body || {})}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      res.status(401).json({
        success: false,
        error: { message: 'Invalid request signature' }
      });
      return;
    }
    
    next();
  };
};