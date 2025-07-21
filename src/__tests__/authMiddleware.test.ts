import { Request, Response, NextFunction } from 'express';
import { authenticateToken, optionalAuth, validateRefreshToken, authRateLimit } from '../middleware/authMiddleware';
import { AuthService } from '../services/AuthService';
import { Player } from '../models/Player';

// Mock response object
const mockResponse = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Mock next function
const mockNext = jest.fn() as NextFunction;

describe('Authentication Middleware', () => {
  const testUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'password123'
  };

  let accessToken: string;
  let refreshToken: string;
  let userId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    const registerResult = await AuthService.register(testUser);
    accessToken = registerResult.accessToken!;
    refreshToken = registerResult.refreshToken!;
    userId = registerResult.player!._id.toString();
  });

  describe('authenticateToken middleware', () => {
    it('should authenticate valid token successfully', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      } as Request;
      const res = mockResponse();

      await authenticateToken(req, res, mockNext);

      expect(req.user).toBeDefined();
      expect(req.userId).toBe(userId);
      expect(req.user!.username).toBe(testUser.username);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should fail without authorization header', async () => {
      const req = {
        headers: {}
      } as Request;
      const res = mockResponse();

      await authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Access token required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should fail with invalid token format', async () => {
      const req = {
        headers: {
          authorization: 'InvalidFormat'
        }
      } as Request;
      const res = mockResponse();

      await authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Access token required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should fail with invalid token', async () => {
      const req = {
        headers: {
          authorization: 'Bearer invalid.token.here'
        }
      } as Request;
      const res = mockResponse();

      await authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid or expired access token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should fail when user not found', async () => {
      // Create token for non-existent user
      const fakeToken = AuthService.generateAccessToken({
        userId: '507f1f77bcf86cd799439011',
        username: 'fakeuser'
      });

      const req = {
        headers: {
          authorization: `Bearer ${fakeToken}`
        }
      } as Request;
      const res = mockResponse();

      await authenticateToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not found'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth middleware', () => {
    it('should authenticate valid token successfully', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      } as Request;
      const res = mockResponse();

      await optionalAuth(req, res, mockNext);

      expect(req.user).toBeDefined();
      expect(req.userId).toBe(userId);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should continue without token', async () => {
      const req = {
        headers: {}
      } as Request;
      const res = mockResponse();

      await optionalAuth(req, res, mockNext);

      expect(req.user).toBeUndefined();
      expect(req.userId).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should continue with invalid token', async () => {
      const req = {
        headers: {
          authorization: 'Bearer invalid.token.here'
        }
      } as Request;
      const res = mockResponse();

      await optionalAuth(req, res, mockNext);

      expect(req.user).toBeUndefined();
      expect(req.userId).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('validateRefreshToken middleware', () => {
    it('should validate refresh token successfully', () => {
      const req = {
        body: {
          refreshToken
        }
      } as Request;
      const res = mockResponse();

      validateRefreshToken(req, res, mockNext);

      expect(req.body.tokenPayload).toBeDefined();
      expect(req.body.tokenPayload.userId).toBe(userId);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should fail without refresh token', () => {
      const req = {
        body: {}
      } as Request;
      const res = mockResponse();

      validateRefreshToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Refresh token required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should fail with invalid refresh token', () => {
      const req = {
        body: {
          refreshToken: 'invalid.token.here'
        }
      } as Request;
      const res = mockResponse();

      validateRefreshToken(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid refresh token'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('authRateLimit middleware', () => {
    it('should allow requests within limit', () => {
      const rateLimitMiddleware = authRateLimit(5, 60000);
      const req = {
        ip: '127.0.0.1'
      } as Request;
      const res = mockResponse();

      // First request should pass
      rateLimitMiddleware(req, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests exceeding limit', () => {
      // Temporarily set NODE_ENV to non-test to test rate limiting
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const rateLimitMiddleware = authRateLimit(2, 60000);
      const req = {
        ip: '127.0.0.1'
      } as Request;
      const res = mockResponse();

      // First two requests should pass
      rateLimitMiddleware(req, res, mockNext);
      rateLimitMiddleware(req, res, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(2);

      // Third request should be blocked
      jest.clearAllMocks();
      rateLimitMiddleware(req, res, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Too many authentication attempts. Please try again later.'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();

      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    });

    it('should handle different IP addresses separately', () => {
      const rateLimitMiddleware = authRateLimit(1, 60000);
      const req1 = { ip: '127.0.0.1' } as Request;
      const req2 = { ip: '192.168.1.1' } as Request;
      const res = mockResponse();

      // Both requests should pass as they're from different IPs
      rateLimitMiddleware(req1, res, mockNext);
      rateLimitMiddleware(req2, res, mockNext);
      
      expect(mockNext).toHaveBeenCalledTimes(2);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});