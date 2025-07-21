import { AuthService } from '../services/AuthService';
import { Player } from '../models/Player';

describe('AuthService', () => {
  const testUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'password123',
    avatar: 'test-avatar.png'
  };

  describe('Password Hashing', () => {
    it('should hash password correctly', async () => {
      const hashedPassword = await AuthService.hashPassword('password123');
      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe('password123');
      expect(hashedPassword.length).toBeGreaterThan(50);
    });

    it('should compare passwords correctly', async () => {
      const hashedPassword = await AuthService.hashPassword('password123');
      const isValid = await AuthService.comparePassword('password123', hashedPassword);
      const isInvalid = await AuthService.comparePassword('wrongpassword', hashedPassword);
      
      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });
  });

  describe('Token Generation and Verification', () => {
    const payload = { userId: '507f1f77bcf86cd799439011', username: 'testuser' };

    it('should generate and verify access token', () => {
      const token = AuthService.generateAccessToken(payload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const verified = AuthService.verifyAccessToken(token);
      expect(verified).toBeDefined();
      expect(verified!.userId).toBe(payload.userId);
      expect(verified!.username).toBe(payload.username);
    });

    it('should generate and verify refresh token', () => {
      const token = AuthService.generateRefreshToken(payload);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const verified = AuthService.verifyRefreshToken(token);
      expect(verified).toBeDefined();
      expect(verified!.userId).toBe(payload.userId);
      expect(verified!.username).toBe(payload.username);
    });

    it('should return null for invalid tokens', () => {
      const invalidToken = 'invalid.token.here';
      
      expect(AuthService.verifyAccessToken(invalidToken)).toBeNull();
      expect(AuthService.verifyRefreshToken(invalidToken)).toBeNull();
    });
  });

  describe('User Registration', () => {
    it('should register a new user successfully', async () => {
      const result = await AuthService.register(testUser);

      expect(result.success).toBe(true);
      expect(result.player).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.player!.username).toBe(testUser.username);
      expect(result.player!.email).toBe(testUser.email);
      expect(result.message).toBe('Registration successful');
    });

    it('should fail registration with duplicate username', async () => {
      await AuthService.register(testUser);
      const result = await AuthService.register(testUser);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Username already exists');
    });

    it('should fail registration with duplicate email', async () => {
      await AuthService.register(testUser);
      const duplicateEmailUser = {
        username: 'differentuser',
        email: testUser.email,
        password: 'password123'
      };
      const result = await AuthService.register(duplicateEmailUser);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Email already exists');
    });

    it('should fail registration with short username', async () => {
      const invalidUser = { ...testUser, username: 'ab' };
      const result = await AuthService.register(invalidUser);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Username must be at least 3 characters long');
    });

    it('should fail registration with short password', async () => {
      const invalidUser = { ...testUser, password: '123' };
      const result = await AuthService.register(invalidUser);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Password must be at least 6 characters long');
    });

    it('should register user without email', async () => {
      const userWithoutEmail = {
        username: 'noemailuser',
        password: 'password123'
      };
      const result = await AuthService.register(userWithoutEmail);

      expect(result.success).toBe(true);
      expect(result.player!.username).toBe(userWithoutEmail.username);
      expect(result.player!.email).toBeUndefined();
    });
  });

  describe('User Login', () => {
    beforeEach(async () => {
      await AuthService.register(testUser);
    });

    it('should login with username successfully', async () => {
      const result = await AuthService.login({
        username: testUser.username,
        password: testUser.password
      });

      expect(result.success).toBe(true);
      expect(result.player).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.message).toBe('Login successful');
    });

    it('should login with email successfully', async () => {
      const result = await AuthService.login({
        email: testUser.email,
        password: testUser.password
      });

      expect(result.success).toBe(true);
      expect(result.player).toBeDefined();
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should fail login with wrong password', async () => {
      const result = await AuthService.login({
        username: testUser.username,
        password: 'wrongpassword'
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid credentials');
    });

    it('should fail login with non-existent user', async () => {
      const result = await AuthService.login({
        username: 'nonexistentuser',
        password: 'password123'
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid credentials');
    });

    it('should fail login without password', async () => {
      const result = await AuthService.login({
        username: testUser.username,
        password: ''
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Password is required');
    });

    it('should fail login without username or email', async () => {
      const result = await AuthService.login({
        password: testUser.password
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Username or email is required');
    });
  });

  describe('Token Refresh', () => {
    let refreshToken: string;
    let userId: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      refreshToken = registerResult.refreshToken!;
      userId = registerResult.player!._id.toString();
    });

    it('should refresh token successfully', async () => {
      const result = await AuthService.refreshToken(refreshToken);

      expect(result.success).toBe(true);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(refreshToken); // Should be a new token
      expect(result.message).toBe('Token refreshed successfully');
    });

    it('should fail refresh with invalid token', async () => {
      const result = await AuthService.refreshToken('invalid.token.here');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid refresh token');
    });

    it('should fail refresh with non-existent token', async () => {
      const validButNonExistentToken = AuthService.generateRefreshToken({
        userId: '507f1f77bcf86cd799439011',
        username: 'testuser'
      });

      const result = await AuthService.refreshToken(validButNonExistentToken);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid refresh token');
    });
  });

  describe('User Logout', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      refreshToken = registerResult.refreshToken!;
    });

    it('should logout successfully', async () => {
      const result = await AuthService.logout(refreshToken);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logout successful');

      // Verify token is invalidated
      const refreshResult = await AuthService.refreshToken(refreshToken);
      expect(refreshResult.success).toBe(false);
    });

    it('should handle logout with invalid token gracefully', async () => {
      const result = await AuthService.logout('invalid.token.here');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid refresh token');
    });
  });

  describe('Logout All Devices', () => {
    let userId: string;
    let refreshToken1: string;
    let refreshToken2: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      userId = registerResult.player!._id.toString();
      refreshToken1 = registerResult.refreshToken!;

      // Simulate second login
      const loginResult = await AuthService.login({
        username: testUser.username,
        password: testUser.password
      });
      refreshToken2 = loginResult.refreshToken!;
    });

    it('should logout from all devices successfully', async () => {
      const result = await AuthService.logoutAll(userId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logged out from all devices');

      // Verify both tokens are invalidated
      const refresh1Result = await AuthService.refreshToken(refreshToken1);
      const refresh2Result = await AuthService.refreshToken(refreshToken2);

      expect(refresh1Result.success).toBe(false);
      expect(refresh2Result.success).toBe(false);
    });
  });

  describe('Get Player By ID', () => {
    let userId: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      userId = registerResult.player!._id.toString();
    });

    it('should get player by ID successfully', async () => {
      const player = await AuthService.getPlayerById(userId);

      expect(player).toBeDefined();
      expect(player!.username).toBe(testUser.username);
      expect(player!.email).toBe(testUser.email);
    });

    it('should return null for non-existent user ID', async () => {
      const player = await AuthService.getPlayerById('507f1f77bcf86cd799439011');

      expect(player).toBeNull();
    });

    it('should return null for invalid user ID', async () => {
      const player = await AuthService.getPlayerById('invalid-id');

      expect(player).toBeNull();
    });
  });
});