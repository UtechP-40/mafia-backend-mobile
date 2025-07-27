import request from 'supertest';
import express from 'express';
import { SuperUser, Permission, SuperUserStatus } from '../models/SuperUser';
import { AdminSession } from '../models/AdminSession';
import { EmailApproval } from '../models/EmailApproval';
import { AdminLog } from '../models/AdminLog';
import { AdminAuthService } from '../services/AdminAuthService';
import { connectAdminDatabase } from '../config/database';
import { adminAuthMiddleware } from '../middleware/auth';
import { adminErrorHandler } from '../middleware/errorHandler';
import authRoutes from '../routes/auth';
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

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/admin/auth', authRoutes);
  app.use('/admin/api', adminAuthMiddleware, (req, res) => {
    res.json({ message: 'Protected route accessed', user: (req as any).adminUser });
  });
  app.use(adminErrorHandler);
  return app;
};

describe('Admin Auth Routes', () => {
  let app: express.Application;

  beforeAll(async () => {
    await connectAdminDatabase();
    app = createTestApp();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await SuperUser.deleteMany({});
    await AdminSession.deleteMany({});
    await EmailApproval.deleteMany({});
    await AdminLog.deleteMany({});
  });

  afterAll(async () => {
    // Clean up and close database connection
    await SuperUser.deleteMany({});
    await AdminSession.deleteMany({});
    await EmailApproval.deleteMany({});
    await AdminLog.deleteMany({});
    await mongoose.connection.close();
  });

  describe('POST /admin/auth/register', () => {
    const validRegistrationData = {
      username: 'testadmin',
      email: 'test@admin.com',
      password: 'StrongP@ssw0rd123!',
      firstName: 'Test',
      lastName: 'Admin',
      requestedPermissions: [Permission.USER_READ, Permission.ANALYTICS_READ],
      justification: 'Need access for testing purposes and user management tasks'
    };

    it('should register a new admin user successfully', async () => {
      const response = await request(app)
        .post('/admin/auth/register')
        .send(validRegistrationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.requiresApproval).toBe(true);
      expect(response.body.message).toContain('submitted successfully');

      // Verify user was created in database
      const user = await SuperUser.findOne({ username: validRegistrationData.username });
      expect(user).toBeDefined();
      expect(user?.status).toBe(SuperUserStatus.PENDING);
    });

    it('should reject registration with weak password', async () => {
      const weakPasswordData = { ...validRegistrationData, password: 'weak' };
      
      const response = await request(app)
        .post('/admin/auth/register')
        .send(weakPasswordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('security requirements');
    });

    it('should reject registration with invalid input', async () => {
      const invalidData = { ...validRegistrationData, username: 'ab' }; // Too short
      
      const response = await request(app)
        .post('/admin/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toContain('Username must be between 3 and 30 characters');
    });

    it('should reject registration with super admin permission', async () => {
      const superAdminData = { 
        ...validRegistrationData, 
        requestedPermissions: [Permission.SUPER_ADMIN] 
      };
      
      const response = await request(app)
        .post('/admin/auth/register')
        .send(superAdminData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Super admin permission cannot be requested directly');
    });

    it('should reject registration with invalid permissions', async () => {
      const invalidPermissionData = { 
        ...validRegistrationData, 
        requestedPermissions: ['invalid_permission'] 
      };
      
      const response = await request(app)
        .post('/admin/auth/register')
        .send(invalidPermissionData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid permissions requested');
    });

    it('should enforce rate limiting', async () => {
      // Make multiple requests quickly
      const promises = Array(3).fill(0).map(() => 
        request(app)
          .post('/admin/auth/register')
          .send(validRegistrationData)
      );

      const responses = await Promise.all(promises);
      
      // At least one should be rate limited
      const rateLimitedResponse = responses.find(res => res.status === 429);
      expect(rateLimitedResponse).toBeDefined();
    });
  });

  describe('POST /admin/auth/login', () => {
    let testUser: any;
    const testPassword = 'StrongP@ssw0rd123!';

    beforeEach(async () => {
      // Create an approved test user
      const hashedPassword = await AdminAuthService.hashPassword(testPassword);
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
    });

    it('should login successfully with username', async () => {
      const response = await request(app)
        .post('/admin/auth/login')
        .send({
          username: 'testadmin',
          password: testPassword
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.user.username).toBe('testadmin');
    });

    it('should login successfully with email', async () => {
      const response = await request(app)
        .post('/admin/auth/login')
        .send({
          email: 'test@admin.com',
          password: testPassword
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@admin.com');
    });

    it('should reject login with invalid password', async () => {
      const response = await request(app)
        .post('/admin/auth/login')
        .send({
          username: 'testadmin',
          password: 'wrongpassword'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should reject login with non-existent user', async () => {
      const response = await request(app)
        .post('/admin/auth/login')
        .send({
          username: 'nonexistent',
          password: testPassword
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should reject login for pending user', async () => {
      testUser.status = SuperUserStatus.PENDING;
      await testUser.save();

      const response = await request(app)
        .post('/admin/auth/login')
        .send({
          username: 'testadmin',
          password: testPassword
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Account is pending approval');
    });

    it('should reject login with invalid input', async () => {
      const response = await request(app)
        .post('/admin/auth/login')
        .send({
          // Missing username/email and password
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toContain('Password is required');
      expect(response.body.errors).toContain('Username or email is required');
    });
  });

  describe('POST /admin/auth/refresh', () => {
    let testUser: any;
    let refreshToken: string;

    beforeEach(async () => {
      // Create an approved test user and get refresh token
      const hashedPassword = await AdminAuthService.hashPassword('StrongP@ssw0rd123!');
      testUser = new SuperUser({
        username: 'testadmin',
        email: 'test@admin.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        permissions: [Permission.USER_READ],
        status: SuperUserStatus.APPROVED
      });
      await testUser.save();

      const loginResult = await AdminAuthService.login({
        username: 'testadmin',
        password: 'StrongP@ssw0rd123!'
      });
      refreshToken = loginResult.refreshToken!;
    });

    it('should refresh tokens successfully', async () => {
      const response = await request(app)
        .post('/admin/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.refreshToken).not.toBe(refreshToken); // Should be new token
    });

    it('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/admin/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid refresh token');
    });

    it('should reject missing refresh token', async () => {
      const response = await request(app)
        .post('/admin/auth/refresh')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Refresh token is required');
    });
  });

  describe('POST /admin/auth/logout', () => {
    let testUser: any;
    let refreshToken: string;

    beforeEach(async () => {
      // Create an approved test user and get refresh token
      const hashedPassword = await AdminAuthService.hashPassword('StrongP@ssw0rd123!');
      testUser = new SuperUser({
        username: 'testadmin',
        email: 'test@admin.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        permissions: [Permission.USER_READ],
        status: SuperUserStatus.APPROVED
      });
      await testUser.save();

      const loginResult = await AdminAuthService.login({
        username: 'testadmin',
        password: 'StrongP@ssw0rd123!'
      });
      refreshToken = loginResult.refreshToken!;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/admin/auth/logout')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logout successful');

      // Verify refresh token was removed
      const updatedUser = await SuperUser.findById(testUser._id).select('+refreshTokens');
      expect(updatedUser?.refreshTokens).not.toContain(refreshToken);
    });

    it('should handle logout with invalid token gracefully', async () => {
      const response = await request(app)
        .post('/admin/auth/logout')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid refresh token');
    });
  });

  describe('GET /admin/auth/me', () => {
    let testUser: any;
    let accessToken: string;

    beforeEach(async () => {
      // Create an approved test user and get access token
      const hashedPassword = await AdminAuthService.hashPassword('StrongP@ssw0rd123!');
      testUser = new SuperUser({
        username: 'testadmin',
        email: 'test@admin.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        permissions: [Permission.USER_READ],
        status: SuperUserStatus.APPROVED
      });
      await testUser.save();

      const loginResult = await AdminAuthService.login({
        username: 'testadmin',
        password: 'StrongP@ssw0rd123!'
      });
      accessToken = loginResult.accessToken!;
    });

    it('should get user profile successfully', async () => {
      const response = await request(app)
        .get('/admin/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.username).toBe('testadmin');
      expect(response.body.data.user.email).toBe('test@admin.com');
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/admin/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('authentication token required');
    });

    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/admin/auth/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid or expired admin token');
    });
  });

  describe('POST /admin/auth/verify-token', () => {
    let testUser: any;
    let accessToken: string;

    beforeEach(async () => {
      // Create an approved test user and get access token
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

      const loginResult = await AdminAuthService.login({
        username: 'testadmin',
        password: 'StrongP@ssw0rd123!'
      });
      accessToken = loginResult.accessToken!;
    });

    it('should verify token successfully', async () => {
      const response = await request(app)
        .post('/admin/auth/verify-token')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe(testUser._id.toString());
      expect(response.body.data.username).toBe('testadmin');
      expect(response.body.data.permissions).toEqual([Permission.USER_READ, Permission.ANALYTICS_READ]);
    });
  });

  describe('POST /admin/auth/password-reset', () => {
    let testUser: any;

    beforeEach(async () => {
      // Create an approved test user
      const hashedPassword = await AdminAuthService.hashPassword('StrongP@ssw0rd123!');
      testUser = new SuperUser({
        username: 'testadmin',
        email: 'test@admin.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'Admin',
        permissions: [Permission.USER_READ],
        status: SuperUserStatus.APPROVED
      });
      await testUser.save();
    });

    it('should initiate password reset successfully', async () => {
      const response = await request(app)
        .post('/admin/auth/password-reset')
        .send({ email: 'test@admin.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('password reset link has been sent');
    });

    it('should not reveal if email does not exist', async () => {
      const response = await request(app)
        .post('/admin/auth/password-reset')
        .send({ email: 'nonexistent@admin.com' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('password reset link has been sent');
    });

    it('should reject invalid email', async () => {
      const response = await request(app)
        .post('/admin/auth/password-reset')
        .send({ email: 'invalid-email' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Valid email address is required');
    });
  });

  describe('GET /admin/auth/password-policy', () => {
    it('should return password policy', async () => {
      const response = await request(app)
        .get('/admin/auth/password-policy')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.policy).toBeDefined();
      expect(response.body.data.policy.minLength).toBe(12);
      expect(response.body.data.policy.requireUppercase).toBe(true);
      expect(response.body.data.policy.rules).toBeInstanceOf(Array);
    });
  });

  describe('Registration Approval Endpoints', () => {
    let pendingUser: any;
    let approverUser: any;
    let approverAccessToken: string;

    beforeEach(async () => {
      // Create a pending user
      const hashedPassword = await AdminAuthService.hashPassword('StrongP@ssw0rd123!');
      pendingUser = new SuperUser({
        username: 'pendingadmin',
        email: 'pending@admin.com',
        password: hashedPassword,
        firstName: 'Pending',
        lastName: 'Admin',
        permissions: [Permission.USER_READ],
        status: SuperUserStatus.PENDING
      });
      await pendingUser.save();

      // Create an approver user with super admin permission
      approverUser = new SuperUser({
        username: 'approver',
        email: 'approver@admin.com',
        password: hashedPassword,
        firstName: 'Approver',
        lastName: 'Admin',
        permissions: [Permission.ADMIN_APPROVE],
        status: SuperUserStatus.APPROVED
      });
      await approverUser.save();

      // Get access token for approver
      const loginResult = await AdminAuthService.login({
        username: 'approver',
        password: 'StrongP@ssw0rd123!'
      });
      approverAccessToken = loginResult.accessToken!;
    });

    describe('POST /admin/auth/approve-registration', () => {
      it('should approve registration successfully', async () => {
        const response = await request(app)
          .post('/admin/auth/approve-registration')
          .set('Authorization', `Bearer ${approverAccessToken}`)
          .send({ userId: pendingUser._id.toString() })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Admin registration approved successfully');

        // Verify user status was updated
        const updatedUser = await SuperUser.findById(pendingUser._id);
        expect(updatedUser?.status).toBe(SuperUserStatus.APPROVED);
      });

      it('should reject approval without permission', async () => {
        // Create user without approval permission
        const hashedPassword = await AdminAuthService.hashPassword('StrongP@ssw0rd123!');
        const regularUser = new SuperUser({
          username: 'regular',
          email: 'regular@admin.com',
          password: hashedPassword,
          firstName: 'Regular',
          lastName: 'User',
          permissions: [Permission.USER_READ], // No approval permission
          status: SuperUserStatus.APPROVED
        });
        await regularUser.save();

        const loginResult = await AdminAuthService.login({
          username: 'regular',
          password: 'StrongP@ssw0rd123!'
        });

        const response = await request(app)
          .post('/admin/auth/approve-registration')
          .set('Authorization', `Bearer ${loginResult.accessToken}`)
          .send({ userId: pendingUser._id.toString() })
          .expect(403);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('permission');
      });
    });

    describe('POST /admin/auth/reject-registration', () => {
      it('should reject registration successfully', async () => {
        const rejectionReason = 'Insufficient justification provided';
        const response = await request(app)
          .post('/admin/auth/reject-registration')
          .set('Authorization', `Bearer ${approverAccessToken}`)
          .send({ 
            userId: pendingUser._id.toString(),
            reason: rejectionReason
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Admin registration rejected successfully');

        // Verify user status was updated
        const updatedUser = await SuperUser.findById(pendingUser._id);
        expect(updatedUser?.status).toBe(SuperUserStatus.REJECTED);
      });

      it('should reject without proper reason', async () => {
        const response = await request(app)
          .post('/admin/auth/reject-registration')
          .set('Authorization', `Bearer ${approverAccessToken}`)
          .send({ 
            userId: pendingUser._id.toString(),
            reason: 'bad' // Too short
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('minimum 5 characters');
      });
    });
  });
});