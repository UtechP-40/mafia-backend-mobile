import { Request, Response, NextFunction } from 'express';
import { adminAuthMiddleware, requireAdminPermission, requireAnyAdminPermission, requireAllAdminPermissions } from '../middleware/auth';
import { AdminAuthService } from '../services/AdminAuthService';
import { SuperUser, Permission, SuperUserStatus } from '../models/SuperUser';
import { connectAdminDatabase } from '../config/database';
import { AdminOperationalError } from '../middleware/errorHandler';
import mongoose from 'mongoose';

// Mock the logger to avoid console output during tests
jest.mock('../config/logger', () => ({
  adminLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  logAdminSecurity: jest.fn()
}));

describe('Admin Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let testUser: any;

  beforeAll(async () => {
    await connectAdminDatabase();
  });

  beforeEach(async () => {
    // Clean up database
    await SuperUser.deleteMany({});

    // Create test user
    const hashedPassword = await AdminAuthService.hashPassword('StrongP@ssw0rd123!');
    testUser = new SuperUser({
      username: 'testadmin',
      email: 'test@admin.com',
      password: hashedPassword,
      firstName: 'Test',
      lastName: 'Admin',
      permissions: [Permission.USER_READ, Permission.ANALYTICS_READ],
      status: SuperUserStatus.APPROVED
    });
    await testUser.save();

    // Reset mocks
    mockReq = {
      headers: {},
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-agent'),
      path: '/test',
      method: 'GET'
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
  });

  afterAll(async () => {
    await SuperUser.deleteMany({});
    await mongoose.connection.close();
  });

  describe('adminAuthMiddleware', () => {
    it('should authenticate valid token successfully', async () => {
      // Generate valid token
      const tokenPayload = {
        userId: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: testUser.permissions,
        status: testUser.status,
        isAdmin: true
      };
      const accessToken = AdminAuthService.generateAccessToken(tokenPayload);

      mockReq.headers = {
        authorization: `Bearer ${accessToken}`
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect((mockReq as any).adminUser).toBeDefined();
      expect((mockReq as any).adminUser.id).toBe(testUser._id.toString());
      expect((mockReq as any).adminUser.username).toBe(testUser.username);
      expect((mockReq as any).adminUser.permissions).toEqual(testUser.permissions);
    });

    it('should reject request without authorization header', async () => {
      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      expect((mockReq as any).adminUser).toBeUndefined();
    });

    it('should reject request with invalid token format', async () => {
      mockReq.headers = {
        authorization: 'InvalidFormat token'
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      expect((mockReq as any).adminUser).toBeUndefined();
    });

    it('should reject request with invalid token', async () => {
      mockReq.headers = {
        authorization: 'Bearer invalid.token.here'
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      expect((mockReq as any).adminUser).toBeUndefined();
    });

    it('should reject request for non-existent user', async () => {
      // Generate token for non-existent user
      const tokenPayload = {
        userId: new mongoose.Types.ObjectId().toString(),
        username: 'nonexistent',
        email: 'nonexistent@admin.com',
        permissions: [Permission.USER_READ],
        status: SuperUserStatus.APPROVED,
        isAdmin: true
      };
      const accessToken = AdminAuthService.generateAccessToken(tokenPayload);

      mockReq.headers = {
        authorization: `Bearer ${accessToken}`
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      expect((mockReq as any).adminUser).toBeUndefined();
    });

    it('should reject request for non-approved user', async () => {
      // Update user status to pending
      testUser.status = SuperUserStatus.PENDING;
      await testUser.save();

      const tokenPayload = {
        userId: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: testUser.permissions,
        status: testUser.status,
        isAdmin: true
      };
      const accessToken = AdminAuthService.generateAccessToken(tokenPayload);

      mockReq.headers = {
        authorization: `Bearer ${accessToken}`
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      expect((mockReq as any).adminUser).toBeUndefined();
    });

    it('should reject request for locked user', async () => {
      // Lock the user account
      testUser.lockUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      await testUser.save();

      const tokenPayload = {
        userId: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: testUser.permissions,
        status: testUser.status,
        isAdmin: true
      };
      const accessToken = AdminAuthService.generateAccessToken(tokenPayload);

      mockReq.headers = {
        authorization: `Bearer ${accessToken}`
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      expect((mockReq as any).adminUser).toBeUndefined();
    });

    it('should reject token without isAdmin flag', async () => {
      const tokenPayload = {
        userId: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: testUser.permissions,
        status: testUser.status,
        isAdmin: false // Not an admin token
      };
      const accessToken = AdminAuthService.generateAccessToken(tokenPayload);

      mockReq.headers = {
        authorization: `Bearer ${accessToken}`
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      expect((mockReq as any).adminUser).toBeUndefined();
    });
  });

  describe('requireAdminPermission', () => {
    beforeEach(() => {
      // Set up authenticated admin user
      (mockReq as any).adminUser = {
        id: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: [Permission.USER_READ, Permission.ANALYTICS_READ],
        status: SuperUserStatus.APPROVED,
        isActive: true
      };
    });

    it('should allow access with required permission', () => {
      const middleware = requireAdminPermission(Permission.USER_READ);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should deny access without required permission', () => {
      const middleware = requireAdminPermission(Permission.DATABASE_WRITE);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    });

    it('should allow super admin access to any permission', () => {
      (mockReq as any).adminUser.permissions = [Permission.SUPER_ADMIN];
      
      const middleware = requireAdminPermission(Permission.DATABASE_DELETE);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject request without authenticated user', () => {
      delete (mockReq as any).adminUser;
      
      const middleware = requireAdminPermission(Permission.USER_READ);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
    });
  });

  describe('requireAnyAdminPermission', () => {
    beforeEach(() => {
      // Set up authenticated admin user
      (mockReq as any).adminUser = {
        id: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: [Permission.USER_READ, Permission.ANALYTICS_READ],
        status: SuperUserStatus.APPROVED,
        isActive: true
      };
    });

    it('should allow access with any of the required permissions', () => {
      const middleware = requireAnyAdminPermission([Permission.USER_READ, Permission.DATABASE_WRITE]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should deny access without any required permissions', () => {
      const middleware = requireAnyAdminPermission([Permission.DATABASE_WRITE, Permission.DATABASE_DELETE]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    });

    it('should allow super admin access to any permissions', () => {
      (mockReq as any).adminUser.permissions = [Permission.SUPER_ADMIN];
      
      const middleware = requireAnyAdminPermission([Permission.DATABASE_DELETE, Permission.SYSTEM_CONFIG]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('requireAllAdminPermissions', () => {
    beforeEach(() => {
      // Set up authenticated admin user with multiple permissions
      (mockReq as any).adminUser = {
        id: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: [Permission.USER_READ, Permission.ANALYTICS_READ, Permission.DATABASE_READ],
        status: SuperUserStatus.APPROVED,
        isActive: true
      };
    });

    it('should allow access with all required permissions', () => {
      const middleware = requireAllAdminPermissions([Permission.USER_READ, Permission.ANALYTICS_READ]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should deny access without all required permissions', () => {
      const middleware = requireAllAdminPermissions([Permission.USER_READ, Permission.DATABASE_WRITE]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
      expect(error.details.missingPermissions).toContain(Permission.DATABASE_WRITE);
    });

    it('should allow super admin access to all permissions', () => {
      (mockReq as any).adminUser.permissions = [Permission.SUPER_ADMIN];
      
      const middleware = requireAllAdminPermissions([Permission.DATABASE_DELETE, Permission.SYSTEM_CONFIG, Permission.USER_DELETE]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should provide detailed error with missing permissions', () => {
      const middleware = requireAllAdminPermissions([
        Permission.USER_READ, // User has this
        Permission.DATABASE_WRITE, // User doesn't have this
        Permission.SYSTEM_CONFIG // User doesn't have this
      ]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AdminOperationalError));
      const error = (mockNext as jest.Mock).mock.calls[0][0];
      expect(error.details.missingPermissions).toEqual([Permission.DATABASE_WRITE, Permission.SYSTEM_CONFIG]);
    });
  });

  describe('Error Handling', () => {
    it('should handle middleware errors gracefully', () => {
      // Simulate an error in the middleware
      const middleware = requireAdminPermission(Permission.USER_READ);
      
      // Mock request that will cause an error
      const errorReq = {
        ...mockReq,
        adminUser: null // This should cause an error
      };

      middleware(errorReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should pass through unexpected errors', async () => {
      // Mock AdminAuthService to throw an error
      jest.spyOn(AdminAuthService, 'getAdminUserById').mockRejectedValueOnce(new Error('Database error'));

      const tokenPayload = {
        userId: testUser._id.toString(),
        username: testUser.username,
        email: testUser.email,
        permissions: testUser.permissions,
        status: testUser.status,
        isAdmin: true
      };
      const accessToken = AdminAuthService.generateAccessToken(tokenPayload);

      mockReq.headers = {
        authorization: `Bearer ${accessToken}`
      };

      await adminAuthMiddleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      
      // Restore the mock
      jest.restoreAllMocks();
    });
  });
});