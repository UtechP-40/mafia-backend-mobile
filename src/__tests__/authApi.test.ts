import request from 'supertest';
import express from 'express';
import { authRoutes } from '../api/auth';
import { Player } from '../models/Player';
import { AuthService } from '../services/AuthService';
import { beforeEach } from 'node:test';
import { beforeEach } from 'node:test';
import { beforeEach } from 'node:test';
import { beforeEach } from 'node:test';
import { beforeEach } from 'node:test';
import { beforeEach } from 'node:test';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Authentication API', () => {
  const testUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'password123',
    avatar: 'test-avatar.png'
  };

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Registration successful');
      expect(response.body.data.player.username).toBe(testUser.username);
      expect(response.body.data.player.email).toBe(testUser.email);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.player.password).toBeUndefined();
    });

    it('should fail registration with missing username', async () => {
      const invalidUser: any = { ...testUser };
      delete invalidUser.username;

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Username and password are required');
    });

    it('should fail registration with missing password', async () => {
      const invalidUser: any = { ...testUser };
      delete invalidUser.password;

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Username and password are required');
    });

    it('should fail registration with short username', async () => {
      const invalidUser = { ...testUser, username: 'ab' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Username must be between 3 and 20 characters');
    });

    it('should fail registration with invalid username characters', async () => {
      const invalidUser = { ...testUser, username: 'test-user!' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Username can only contain letters, numbers, and underscores');
    });

    it('should fail registration with short password', async () => {
      const invalidUser = { ...testUser, password: '123' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Password must be at least 6 characters long');
    });

    it('should fail registration with invalid email', async () => {
      const invalidUser = { ...testUser, email: 'invalid-email' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid email format');
    });

    it('should fail registration with duplicate username', async () => {
      await request(app)
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Username already exists');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await AuthService.register(testUser);
    });

    it('should login with username successfully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Login successful');
      expect(response.body.data.player.username).toBe(testUser.username);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.player.password).toBeUndefined();
    });

    it('should login with email successfully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.player.email).toBe(testUser.email);
    });

    it('should fail login with missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Password is required');
    });

    it('should fail login with missing username and email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          password: testUser.password
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Username or email is required');
    });

    it('should fail login with wrong password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: testUser.username,
          password: 'wrongpassword'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should fail login with non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'nonexistentuser',
          password: testUser.password
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid credentials');
    });
  });

  describe('POST /api/auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      refreshToken = registerResult.refreshToken!;
    });

    it('should refresh token successfully', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Token refreshed successfully');
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.refreshToken).not.toBe(refreshToken);
    });

    it('should fail refresh with missing token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Refresh token required');
    });

    it('should fail refresh with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid refresh token');
    });
  });

  describe('DELETE /api/auth/logout', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      refreshToken = registerResult.refreshToken!;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .delete('/api/auth/logout')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logout successful');

      // Verify token is invalidated
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expect(refreshResponse.body.success).toBe(false);
    });

    it('should fail logout with missing token', async () => {
      const response = await request(app)
        .delete('/api/auth/logout')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Refresh token is required');
    });
  });

  describe('DELETE /api/auth/logout-all', () => {
    let accessToken: string;
    let refreshToken1: string;
    let refreshToken2: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      accessToken = registerResult.accessToken!;
      refreshToken1 = registerResult.refreshToken!;

      // Simulate second login
      const loginResult = await AuthService.login({
        username: testUser.username,
        password: testUser.password
      });
      refreshToken2 = loginResult.refreshToken!;
    });

    it('should logout from all devices successfully', async () => {
      const response = await request(app)
        .delete('/api/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logged out from all devices');

      // Verify both tokens are invalidated
      const refresh1Response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: refreshToken1 })
        .expect(401);

      const refresh2Response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: refreshToken2 })
        .expect(401);

      expect(refresh1Response.body.success).toBe(false);
      expect(refresh2Response.body.success).toBe(false);
    });

    it('should fail logout-all without authentication', async () => {
      const response = await request(app)
        .delete('/api/auth/logout-all')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Access token required');
    });
  });

  describe('GET /api/auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      accessToken = registerResult.accessToken!;
    });

    it('should get user profile successfully', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User profile retrieved successfully');
      expect(response.body.data.player.username).toBe(testUser.username);
      expect(response.body.data.player.email).toBe(testUser.email);
      expect(response.body.data.player.password).toBeUndefined();
    });

    it('should fail without authentication', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Access token required');
    });

    it('should fail with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid or expired access token');
    });
  });

  describe('POST /api/auth/verify-token', () => {
    let accessToken: string;

    beforeEach(async () => {
      const registerResult = await AuthService.register(testUser);
      accessToken = registerResult.accessToken!;
    });

    it('should verify token successfully', async () => {
      const response = await request(app)
        .post('/api/auth/verify-token')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Token is valid');
      expect(response.body.data.username).toBe(testUser.username);
      expect(response.body.data.userId).toBeDefined();
    });

    it('should fail verification without token', async () => {
      const response = await request(app)
        .post('/api/auth/verify-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Access token required');
    });
  });
});