import { Request, Response, NextFunction } from 'express';
import {
  createRateLimit,
  sanitizeInput,
  securityHeaders,
  suspiciousActivityDetection,
  requestSizeLimit
} from '../middleware/securityMiddleware';

// Mock the SecurityService
jest.mock('../services/SecurityService', () => ({
  SecurityService: {
    sanitizeObject: jest.fn((obj) => obj),
    detectSuspiciousActivity: jest.fn(() => []),
    logSecurityEvent: jest.fn()
  }
}));

describe('Security Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    // Enable rate limiting for tests
    process.env.TEST_RATE_LIMITING = 'true';
    mockReq = {
      ip: '127.0.0.1',
      get: jest.fn(),
      body: {},
      query: {},
      params: {},
      url: '/test'
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      removeHeader: jest.fn().mockReturnThis()
    };
    
    mockNext = jest.fn();
  });

  afterEach(() => {
    // Clean up test environment
    delete process.env.TEST_RATE_LIMITING;
    jest.clearAllMocks();
  });

  describe('createRateLimit', () => {
    it('should allow requests within limit', () => {
      const rateLimit = createRateLimit({
        windowMs: 60000,
        maxRequests: 5
      });

      // First request should pass
      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(429);
    });

    it('should block requests exceeding limit', () => {
      const rateLimit = createRateLimit({
        windowMs: 60000,
        maxRequests: 2
      });

      // Make requests up to limit
      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      
      // This should be blocked
      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: 'Rate limit exceeded'
          })
        })
      );
    });

    it('should set rate limit headers', () => {
      const rateLimit = createRateLimit({
        windowMs: 60000,
        maxRequests: 10
      });

      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '9'
        })
      );
    });

    it('should use custom key generator', () => {
      const customKeyGen = jest.fn(() => 'custom-key');
      const rateLimit = createRateLimit({
        windowMs: 60000,
        maxRequests: 5,
        keyGenerator: customKeyGen
      });

      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(customKeyGen).toHaveBeenCalledWith(mockReq);
    });

    it('should call onLimitReached callback', () => {
      const onLimitReached = jest.fn();
      const rateLimit = createRateLimit({
        windowMs: 60000,
        maxRequests: 1,
        onLimitReached
      });

      // First request passes
      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      
      // Second request should trigger callback
      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(onLimitReached).toHaveBeenCalledWith(mockReq);
    });

    it('should skip rate limiting in test environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const rateLimit = createRateLimit({
        windowMs: 1,
        maxRequests: 0 // Would normally block everything
      });

      rateLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(429);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('sanitizeInput', () => {
    it('should sanitize request body', () => {
      const { SecurityService } = require('../services/SecurityService');
      
      mockReq.body = { 
        username: '<script>alert("xss")</script>',
        message: 'normal text'
      };

      sanitizeInput(mockReq as Request, mockRes as Response, mockNext);
      
      expect(SecurityService.sanitizeObject).toHaveBeenCalledWith(mockReq.body);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should sanitize query parameters', () => {
      const { SecurityService } = require('../services/SecurityService');
      
      mockReq.query = { 
        search: '<img onerror="alert(1)">',
        page: '1'
      };

      sanitizeInput(mockReq as Request, mockRes as Response, mockNext);
      
      expect(SecurityService.sanitizeObject).toHaveBeenCalledWith(mockReq.query);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should sanitize URL parameters', () => {
      const { SecurityService } = require('../services/SecurityService');
      
      mockReq.params = { 
        id: 'javascript:alert(1)',
        slug: 'normal-slug'
      };

      sanitizeInput(mockReq as Request, mockRes as Response, mockNext);
      
      expect(SecurityService.sanitizeObject).toHaveBeenCalledWith(mockReq.params);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle sanitization errors', () => {
      const { SecurityService } = require('../services/SecurityService');
      SecurityService.sanitizeObject.mockImplementationOnce(() => {
        throw new Error('Sanitization failed');
      });

      mockReq.body = { test: 'data' };

      sanitizeInput(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: { message: 'Invalid input format' }
        })
      );
    });

    it('should handle non-object inputs', () => {
      mockReq.body = 'string body';
      mockReq.query = undefined;
      mockReq.params = undefined;

      expect(() => {
        sanitizeInput(mockReq as Request, mockRes as Response, mockNext);
      }).not.toThrow();
      
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('securityHeaders', () => {
    it('should set security headers', () => {
      securityHeaders(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        expect.stringContaining("default-src 'self'")
      );
      
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      
      expect(mockRes.removeHeader).toHaveBeenCalledWith('X-Powered-By');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('suspiciousActivityDetection', () => {
    it('should detect and log suspicious activity', () => {
      const { SecurityService } = require('../services/SecurityService');
      SecurityService.detectSuspiciousActivity.mockReturnValueOnce(['xss_attempt']);

      mockReq.userId = 'test-user';

      suspiciousActivityDetection(mockReq as Request, mockRes as Response, mockNext);
      
      expect(SecurityService.detectSuspiciousActivity).toHaveBeenCalledWith(mockReq);
      expect(SecurityService.logSecurityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'suspicious_activity',
          userId: 'test-user',
          indicators: ['xss_attempt']
        })
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should block high-risk activities', () => {
      const { SecurityService } = require('../services/SecurityService');
      SecurityService.detectSuspiciousActivity.mockReturnValueOnce(['sql_injection']);

      suspiciousActivityDetection(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: { message: 'Request blocked for security reasons' }
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should continue on detection errors', () => {
      const { SecurityService } = require('../services/SecurityService');
      SecurityService.detectSuspiciousActivity.mockImplementationOnce(() => {
        throw new Error('Detection failed');
      });

      suspiciousActivityDetection(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle requests without suspicious indicators', () => {
      const { SecurityService } = require('../services/SecurityService');
      SecurityService.detectSuspiciousActivity.mockReturnValueOnce([]);

      suspiciousActivityDetection(mockReq as Request, mockRes as Response, mockNext);
      
      expect(SecurityService.logSecurityEvent).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requestSizeLimit', () => {
    it('should allow requests within size limit', () => {
      const sizeLimit = requestSizeLimit(1000);
      mockReq.get = jest.fn().mockReturnValue('500');

      sizeLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalledWith(413);
    });

    it('should block requests exceeding size limit', () => {
      const sizeLimit = requestSizeLimit(1000);
      mockReq.get = jest.fn().mockReturnValue('2000');

      sizeLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(413);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message: 'Request entity too large',
            maxSize: '1000 bytes'
          })
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle missing content-length header', () => {
      const sizeLimit = requestSizeLimit(1000);
      mockReq.get = jest.fn().mockReturnValue(undefined);

      sizeLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use default size limit', () => {
      const sizeLimit = requestSizeLimit();
      mockReq.get = jest.fn().mockReturnValue('2000000'); // 2MB, over 1MB default

      sizeLimit(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(413);
    });
  });

  describe('middleware integration', () => {
    it('should work with multiple middleware in sequence', () => {
      const rateLimit = createRateLimit({
        windowMs: 60000,
        maxRequests: 10
      });

      // Apply middleware in sequence
      rateLimit(mockReq as Request, mockRes as Response, () => {
        sanitizeInput(mockReq as Request, mockRes as Response, () => {
          securityHeaders(mockReq as Request, mockRes as Response, mockNext);
        });
      });

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalled();
    });

    it('should handle middleware errors gracefully', () => {
      const { SecurityService } = require('../services/SecurityService');
      SecurityService.sanitizeObject.mockImplementationOnce(() => {
        throw new Error('Critical error');
      });

      mockReq.body = { test: 'data' };

      sanitizeInput(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});