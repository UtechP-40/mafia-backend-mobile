import { AdminAuthService, AdminRegistrationData, AdminLoginCredentials } from '../services/AdminAuthService';
import { SuperUser, ISuperUser, Permission, SuperUserStatus } from '../models/SuperUser';
import { AdminSession } from '../models/AdminSession';
import { EmailApproval } from '../models/EmailApproval';
import { AdminLog } from '../models/AdminLog';
import { connectAdminDatabase } from '../config/database';
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

describe('AdminAuthService', () => {
  beforeAll(async () => {
    // Connect to test database
    await connectAdminDatabase();
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

  describe('Password Validation', () => {
    it('should validate strong passwords', () => {
      const strongPassword = 'StrongP@ssw0rd123!';
      const result = AdminAuthService.validatePassword(strongPassword);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject weak passwords', () => {
      const weakPassword = 'weak';
      const result = AdminAuthService.validatePassword(weakPassword);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject passwords with forbidden patterns', () => {
      const forbiddenPassword = 'Password123!';
      const result = AdminAuthService.validatePassword(forbiddenPassword);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('common patterns'))).toBe(true);
    });

    it('should reject passwords with repeated characters', () => {
      const repeatedPassword = 'Aaaa1234!@#$';
      const result = AdminAuthService.validatePassword(repeatedPassword);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('repeated characters'))).toBe(true);
    });

    it('should reject passwords with sequential characters', () => {
      const sequentialPassword = 'Abc123!@#$%^';
      const result = AdminAuthService.validatePassword(sequentialPassword);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('sequential characters'))).toBe(true);
    });
  });

  describe('Password Hashing', () => {
    it('should hash passwords securely', async () => {
      const password = 'TestP@ssw0rd123!';
      const hashedPassword = await AdminAuthService.hashPassword(password);
      
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(password);
      expect(hashedPassword.length).toBeGreaterThan(50); // bcrypt hashes are long
    });

    it('should verify passwords correctly', async () => {
      const password = 'TestP@ssw0rd123!';
      const hashedPassword = await AdminAuthService.hashPassword(password);
      
      const isValid = await AdminAuthService.comparePassword(password, hashedPassword);
      expect(isValid).toBe(true);
      
      const isInvalid = await AdminAuthService.comparePassword('wrongpassword', hashedPassword);
      expect(isInvalid).toBe(false);
    });
  });

  describe('JWT Token Management', () => {
    const mockPayload = {
      userId: '507f1f77bcf86cd799439011',
      username: 'testadmin',
      email: 'test@admin.com',
      permissions: [Permission.USER_READ],
      status: SuperUserStatus.APPROVED,
      isAdmin: true
    };

    it('should generate and verify access tokens', () => {
      const token = AdminAuthService.generateAccessToken(mockPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      const decoded = AdminAuthService.verifyAccessToken(token);
      expect(decoded).toBeDefined();
      expect(decoded?.userId).toBe(mockPayload.userId);
      expect(decoded?.username).toBe(mockPayload.username);
      expect(decoded?.isAdmin).toBe(true);
    });

    it('should generate and verify refresh tokens', () => {
      const token = AdminAuthService.generateRefreshToken(mockPayload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      const decoded = AdminAuthService.verifyRefreshToken(token);
      expect(decoded).toBeDefined();
      expect(decoded?.userId).toBe(mockPayload.userId);
      expect(decoded?.username).toBe(mockPayload.username);
      expect(decoded?.isAdmin).toBe(true);
    });

    it('should reject invalid tokens', () => {
      const invalidToken = 'invalid.token.here';
      
      const accessDecoded = AdminAuthService.verifyAccessToken(invalidToken);
      expect(accessDecoded).toBeNull();
      
      const refreshDecoded = AdminAuthService.verifyRefreshToken(invalidToken);
      expect(refreshDecoded).toBeNull();
    });
  });

  describe('User Registration', () => {
    const validRegistrationData: AdminRegistrationData = {
      username: 'testadmin',
      email: 'test@admin.com',
      password: 'StrongP@ssw0rd123!',
      firstName: 'Test',
      lastName: 'Admin',
      requestedPermissions: [Permission.USER_READ, Permission.ANALYTICS_READ],
      justification: 'Need access for testing purposes and user management tasks'
    };

    it('should register a new admin user successfully', async () => {
      const result = await AdminAuthService.register(validRegistrationData, '127.0.0.1');
      
      expect(result.success).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.message).toContain('submitted successfully');
      
      // Check if user was created in database
      const user = await SuperUser.findOne({ username: validRegistrationData.username });
      expect(user).toBeDefined();
      expect(user?.status).toBe(SuperUserStatus.PENDING);
      expect(user?.permissions).toEqual(validRegistrationData.requestedPermissions);
      
      // Check if email approval record was created
      const emailApproval = await EmailApproval.findOne({ userId: user?._id });
      expect(emailApproval).toBeDefined();
      expect(emailApproval?.type).toBe('admin_registration');
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ userId: user?._id, action: 'admin_registration_request' });
      expect(adminLog).toBeDefined();
    });

    it('should reject registration with weak password', async () => {
      const weakPasswordData = { ...validRegistrationData, password: 'weak' };
      const result = await AdminAuthService.register(weakPasswordData, '127.0.0.1');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('security requirements');
    });

    it('should reject registration with duplicate username', async () => {
      // First registration
      await AdminAuthService.register(validRegistrationData, '127.0.0.1');
      
      // Second registration with same username
      const duplicateData = { ...validRegistrationData, email: 'different@admin.com' };
      const result = await AdminAuthService.register(duplicateData, '127.0.0.1');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Username already exists');
    });

    it('should reject registration with duplicate email', async () => {
      // First registration
      await AdminAuthService.register(validRegistrationData, '127.0.0.1');
      
      // Second registration with same email
      const duplicateData = { ...validRegistrationData, username: 'differentadmin' };
      const result = await AdminAuthService.register(duplicateData, '127.0.0.1');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Email already exists');
    });

    it('should reject registration with invalid input', async () => {
      const invalidData = { ...validRegistrationData, username: 'ab' }; // Too short
      const result = await AdminAuthService.register(invalidData, '127.0.0.1');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('at least 3 characters');
    });
  });

  describe('User Login', () => {
    let testUser: ISuperUser;
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

    it('should login successfully with valid credentials', async () => {
      const credentials: AdminLoginCredentials = {
        username: 'testadmin',
        password: testPassword
      };
      
      const result = await AdminAuthService.login(credentials, '127.0.0.1', 'test-agent');
      
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user?.username).toBe('testadmin');
      
      // Check if admin session was created
      const session = await AdminSession.findOne({ userId: testUser._id });
      expect(session).toBeDefined();
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ userId: testUser._id, action: 'admin_login_success' });
      expect(adminLog).toBeDefined();
    });

    it('should login successfully with email', async () => {
      const credentials: AdminLoginCredentials = {
        email: 'test@admin.com',
        password: testPassword
      };
      
      const result = await AdminAuthService.login(credentials, '127.0.0.1', 'test-agent');
      
      expect(result.success).toBe(true);
      expect(result.user?.email).toBe('test@admin.com');
    });

    it('should reject login with invalid password', async () => {
      const credentials: AdminLoginCredentials = {
        username: 'testadmin',
        password: 'wrongpassword'
      };
      
      const result = await AdminAuthService.login(credentials, '127.0.0.1', 'test-agent');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid credentials');
      
      // Check if login attempts were incremented
      const updatedUser = await SuperUser.findById(testUser._id).select('+loginAttempts');
      expect(updatedUser?.loginAttempts).toBe(1);
    });

    it('should reject login with non-existent user', async () => {
      const credentials: AdminLoginCredentials = {
        username: 'nonexistent',
        password: testPassword
      };
      
      const result = await AdminAuthService.login(credentials, '127.0.0.1', 'test-agent');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid credentials');
    });

    it('should reject login for pending user', async () => {
      // Update user status to pending
      testUser.status = SuperUserStatus.PENDING;
      await testUser.save();
      
      const credentials: AdminLoginCredentials = {
        username: 'testadmin',
        password: testPassword
      };
      
      const result = await AdminAuthService.login(credentials, '127.0.0.1', 'test-agent');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Account is pending approval');
    });

    it('should reject login for suspended user', async () => {
      // Update user status to suspended
      testUser.status = SuperUserStatus.SUSPENDED;
      await testUser.save();
      
      const credentials: AdminLoginCredentials = {
        username: 'testadmin',
        password: testPassword
      };
      
      const result = await AdminAuthService.login(credentials, '127.0.0.1', 'test-agent');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Account has been suspended');
    });

    it('should lock account after max login attempts', async () => {
      const credentials: AdminLoginCredentials = {
        username: 'testadmin',
        password: 'wrongpassword'
      };
      
      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await AdminAuthService.login(credentials, '127.0.0.1', 'test-agent');
      }
      
      // Check if account is locked
      const lockedUser = await SuperUser.findById(testUser._id).select('+lockUntil');
      expect(lockedUser?.isLocked).toBe(true);
      
      // Try to login with correct password - should still fail due to lock
      const validCredentials: AdminLoginCredentials = {
        username: 'testadmin',
        password: testPassword
      };
      
      const result = await AdminAuthService.login(validCredentials, '127.0.0.1', 'test-agent');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Account is locked');
    });
  });

  describe('Token Refresh', () => {
    let testUser: ISuperUser;
    let refreshToken: string;

    beforeEach(async () => {
      // Create an approved test user and login to get refresh token
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
      }, '127.0.0.1', 'test-agent');

      refreshToken = loginResult.refreshToken!;
    });

    it('should refresh tokens successfully', async () => {
      const result = await AdminAuthService.refreshToken(refreshToken, '127.0.0.1');
      
      expect(result.success).toBe(true);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(refreshToken); // Should be a new token
      expect(result.user).toBeDefined();
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ userId: testUser._id, action: 'admin_token_refresh' });
      expect(adminLog).toBeDefined();
    });

    it('should reject invalid refresh token', async () => {
      const result = await AdminAuthService.refreshToken('invalid.token.here', '127.0.0.1');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid refresh token');
    });

    it('should reject refresh token for non-approved user', async () => {
      // Update user status to pending
      testUser.status = SuperUserStatus.PENDING;
      await testUser.save();
      
      const result = await AdminAuthService.refreshToken(refreshToken, '127.0.0.1');
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Account access denied');
    });
  });

  describe('User Logout', () => {
    let testUser: ISuperUser;
    let refreshToken: string;

    beforeEach(async () => {
      // Create an approved test user and login to get refresh token
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
      }, '127.0.0.1', 'test-agent');

      refreshToken = loginResult.refreshToken!;
    });

    it('should logout successfully', async () => {
      const result = await AdminAuthService.logout(refreshToken, '127.0.0.1');
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Logout successful');
      
      // Check if refresh token was removed from user
      const updatedUser = await SuperUser.findById(testUser._id).select('+refreshTokens');
      expect(updatedUser?.refreshTokens).not.toContain(refreshToken);
      
      // Check if admin session was removed
      const session = await AdminSession.findOne({ sessionToken: refreshToken });
      expect(session).toBeNull();
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ userId: testUser._id, action: 'admin_logout' });
      expect(adminLog).toBeDefined();
    });

    it('should logout all devices successfully', async () => {
      const result = await AdminAuthService.logoutAll(testUser._id.toString(), '127.0.0.1');
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Logged out from all devices');
      
      // Check if all refresh tokens were removed
      const updatedUser = await SuperUser.findById(testUser._id).select('+refreshTokens');
      expect(updatedUser?.refreshTokens).toHaveLength(0);
      
      // Check if all admin sessions were removed
      const sessions = await AdminSession.find({ userId: testUser._id });
      expect(sessions).toHaveLength(0);
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ userId: testUser._id, action: 'admin_logout_all' });
      expect(adminLog).toBeDefined();
    });
  });

  describe('Registration Approval', () => {
    let pendingUser: ISuperUser;
    let approverUser: ISuperUser;

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

      // Create an approver user
      approverUser = new SuperUser({
        username: 'approver',
        email: 'approver@admin.com',
        password: hashedPassword,
        firstName: 'Approver',
        lastName: 'Admin',
        permissions: [Permission.SUPER_ADMIN],
        status: SuperUserStatus.APPROVED
      });
      await approverUser.save();

      // Create email approval record
      await EmailApproval.create({
        userId: pendingUser._id,
        email: pendingUser.email,
        type: 'admin_registration',
        token: 'test-token',
        requestedPermissions: pendingUser.permissions,
        justification: 'Test justification',
        requestIp: '127.0.0.1'
      });
    });

    it('should approve registration successfully', async () => {
      const result = await AdminAuthService.approveRegistration(
        pendingUser._id.toString(),
        approverUser._id.toString(),
        '127.0.0.1'
      );
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Admin registration approved successfully');
      
      // Check if user status was updated
      const updatedUser = await SuperUser.findById(pendingUser._id);
      expect(updatedUser?.status).toBe(SuperUserStatus.APPROVED);
      expect(updatedUser?.approvedBy?.toString()).toBe(approverUser._id.toString());
      expect(updatedUser?.approvedAt).toBeDefined();
      
      // Check if email approval record was updated
      const emailApproval = await EmailApproval.findOne({ userId: pendingUser._id });
      expect(emailApproval?.status).toBe('approved');
      expect(emailApproval?.approvedBy?.toString()).toBe(approverUser._id.toString());
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ 
        userId: pendingUser._id, 
        action: 'admin_registration_approved' 
      });
      expect(adminLog).toBeDefined();
    });

    it('should reject registration successfully', async () => {
      const rejectionReason = 'Insufficient justification provided';
      const result = await AdminAuthService.rejectRegistration(
        pendingUser._id.toString(),
        approverUser._id.toString(),
        rejectionReason,
        '127.0.0.1'
      );
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Admin registration rejected successfully');
      
      // Check if user status was updated
      const updatedUser = await SuperUser.findById(pendingUser._id);
      expect(updatedUser?.status).toBe(SuperUserStatus.REJECTED);
      
      // Check if email approval record was updated
      const emailApproval = await EmailApproval.findOne({ userId: pendingUser._id });
      expect(emailApproval?.status).toBe('rejected');
      expect(emailApproval?.rejectionReason).toBe(rejectionReason);
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ 
        userId: pendingUser._id, 
        action: 'admin_registration_rejected' 
      });
      expect(adminLog).toBeDefined();
    });

    it('should reject approval for non-pending user', async () => {
      // Update user to approved status
      pendingUser.status = SuperUserStatus.APPROVED;
      await pendingUser.save();
      
      const result = await AdminAuthService.approveRegistration(
        pendingUser._id.toString(),
        approverUser._id.toString(),
        '127.0.0.1'
      );
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Admin user is not in pending status');
    });
  });

  describe('Password Reset', () => {
    let testUser: ISuperUser;

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
      const result = await AdminAuthService.initiatePasswordReset(
        { email: 'test@admin.com' },
        '127.0.0.1'
      );
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('password reset link has been sent');
      
      // Check if reset token was set
      const updatedUser = await SuperUser.findById(testUser._id).select('+passwordResetToken +passwordResetExpires');
      expect(updatedUser?.passwordResetToken).toBeDefined();
      expect(updatedUser?.passwordResetExpires).toBeDefined();
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ 
        userId: testUser._id, 
        action: 'admin_password_reset_request' 
      });
      expect(adminLog).toBeDefined();
    });

    it('should not reveal if email does not exist', async () => {
      const result = await AdminAuthService.initiatePasswordReset(
        { email: 'nonexistent@admin.com' },
        '127.0.0.1'
      );
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('password reset link has been sent');
    });

    it('should confirm password reset successfully', async () => {
      // First initiate password reset
      await AdminAuthService.initiatePasswordReset({ email: 'test@admin.com' }, '127.0.0.1');
      
      // Get the reset token from database
      const userWithToken = await SuperUser.findById(testUser._id).select('+passwordResetToken');
      const resetToken = userWithToken?.passwordResetToken;
      
      // We need to reverse the hash to get the original token for testing
      // In a real scenario, this would come from the email link
      // For testing, we'll create a new token and set it directly
      const crypto = require('crypto');
      const plainToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
      
      testUser.passwordResetToken = hashedToken;
      testUser.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await testUser.save();
      
      const newPassword = 'NewStrongP@ssw0rd456!';
      const result = await AdminAuthService.confirmPasswordReset(
        { token: plainToken, newPassword },
        '127.0.0.1'
      );
      
      expect(result.success).toBe(true);
      expect(result.message).toBe('Password reset successful. Please log in with your new password.');
      
      // Check if password was updated and reset token cleared
      const updatedUser = await SuperUser.findById(testUser._id).select('+password +passwordResetToken +refreshTokens');
      expect(updatedUser?.passwordResetToken).toBeUndefined();
      expect(updatedUser?.refreshTokens).toHaveLength(0); // Should be cleared for security
      
      // Check if new password works
      const isNewPasswordValid = await AdminAuthService.comparePassword(newPassword, updatedUser!.password);
      expect(isNewPasswordValid).toBe(true);
      
      // Check if admin log was created
      const adminLog = await AdminLog.findOne({ 
        userId: testUser._id, 
        action: 'admin_password_reset_complete' 
      });
      expect(adminLog).toBeDefined();
    });

    it('should reject password reset with weak password', async () => {
      const crypto = require('crypto');
      const plainToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
      
      testUser.passwordResetToken = hashedToken;
      testUser.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
      await testUser.save();
      
      const weakPassword = 'weak';
      const result = await AdminAuthService.confirmPasswordReset(
        { token: plainToken, newPassword: weakPassword },
        '127.0.0.1'
      );
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('security requirements');
    });

    it('should reject password reset with invalid token', async () => {
      const result = await AdminAuthService.confirmPasswordReset(
        { token: 'invalid-token', newPassword: 'NewStrongP@ssw0rd456!' },
        '127.0.0.1'
      );
      
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid or expired reset token');
    });
  });
});