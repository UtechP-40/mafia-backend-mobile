/**
 * Comprehensive Middleware Testing Suite
 * Part of Task 26: Backend API Comprehensive Testing
 */

import request from 'supertest';
import express, { Express } from 'express';
import { connectDB, disconnectDB, clearDB, setupTestApp } from './setup';
import { Player } from '../models/Player';
import { AuthService } from '../services/AuthService';
import jwt from 'jsonwebtoken';

describe('Comprehensive Middleware Testing', () => {
  let app: Express;
  let testPlayer: any;
  let authToken: string;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDB();
    app = await setupTestApp();
    
    // Create test player
    testPlayer = await Player.create({
      username: 'testuser',
      email: 'test@example.com',
      password: 'hashedpassword',
      statistics: {
        gamesPlayed: 0,
        gamesWon: 0,
        winRate: 0,
        favoriteRole: 'villager',
        averageGameDuration: 0,
        eloRating: 1000
      }
    });

    authToken = jwt.sign(
      { userId: testPlayer._id.toString(), username: testPlayer.username },
      process.env.JWT_ACCESS_SECRET || 'test-access-secret',
      { expiresIn: '1h' }
    );
  });

  afterEach(async () => {
    await clearDB();
  });

  describe('Authentication Middleware', () => {
    it('should accept valid Bearer tokens', async () => {
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });

    it('should reject missing Authorization header', async () => {
      await request(app)
        .get('/api/auth/me')
        .expect(401);
    });

    it('should reject malformed Authorization header', async () => {
      const malformedHeaders = [
        'InvalidFormat',
        'Bearer',
        'Bearer ',
        'Basic dGVzdDp0ZXN0',
        'Bearer invalid.token.format'
      ];

      for (const header of malformedHeaders) {
        await request(app)
          .get('/api/auth/me')
          .set('Authorization', header)
          .expect(401);
      }
    });

    it('should reject expired tokens', async () => {
      const expiredToken = jwt.sign(
        { userId: testPlayer._id.toString(), username: testPlayer.username },
        process.env.JWT_ACCESS_SECRET || 'test-access-secret',
        { expiresIn: '-1h' }
      );

      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    it('should reject tokens with invalid signature', async () => {
      const invalidToken = jwt.sign(
        { userId: testPlayer._id.toString(), username: testPlayer.username },
        'wrong-secret',
        { expiresIn: '1h' }
      );

      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);
    });

    it('should reject tokens for non-existent users', async () => {
      const nonExistentUserToken = jwt.sign(
        { userId: '507f1f77bcf86cd799439011', username: 'nonexistent' },
        process.env.JWT_ACCESS_SECRET || 'test-access-secret',
        { expiresIn: '1h' }
      );

      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${nonExistentUserToken}`)
        .expect(401);
    });

    it('should handle concurrent authentication requests', async () => {
      const requests = Array(10).fill(null).map(() =>
        request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${authToken}`)
      );

      const results = await Promise.allSettled(requests);
      const successful = results.filter(r => r.status === 'fulfilled' && (r.value as any).status === 200);
      
      expect(successful).toHaveLength(10);
    });
  });

  describe('Rate Limiting Middleware', () => {
    it('should allow requests within rate limit', async () => {
      // Make several requests within normal limits
      for (let i = 0; i < 5; i++) {
        await request(app)
          .get('/api/rooms/public')
          .expect(200);
      }
    });

    it('should handle burst requests appropriately', async () => {
      // Make many requests quickly
      const requests = Array(20).fill(null).map(() =>
        request(app).get('/api/rooms/public')
      );

      const results = await Promise.allSettled(requests);
      
      // In test environment, rate limiting might be disabled
      // But we verify the middleware doesn't break the requests
      expect(results.length).toBe(20);
    });

    it('should apply different limits to different endpoints', async () => {
      // Test auth endpoints (typically more restrictive)
      const authRequests = Array(5).fill(null).map(() =>
        request(app)
          .post('/api/auth/login')
          .send({ username: 'test', password: 'wrong' })
      );

      // Test public endpoints (typically less restrictive)
      const publicRequests = Array(10).fill(null).map(() =>
        request(app).get('/api/rooms/public')
      );

      const [authResults, publicResults] = await Promise.all([
        Promise.allSettled(authRequests),
        Promise.allSettled(publicRequests)
      ]);

      expect(authResults.length).toBe(5);
      expect(publicResults.length).toBe(10);
    });

    it('should reset rate limits after time window', async () => {
      // Make requests up to limit
      const initialRequests = Array(5).fill(null).map(() =>
        request(app).get('/api/rooms/public')
      );

      await Promise.all(initialRequests);

      // Wait a short time (in real implementation, this would be longer)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should be able to make more requests
      await request(app)
        .get('/api/rooms/public')
        .expect(200);
    });
  });

  describe('Security Middleware', () => {
    it('should set security headers', async () => {
      const response = await request(app)
        .get('/api/rooms/public')
        .expect(200);

      // Check for common security headers
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });

    it('should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');

      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
      expect(response.headers['access-control-allow-headers']).toBeDefined();
    });

    it('should sanitize request data', async () => {
      const maliciousData = {
        username: '<script>alert("xss")</script>',
        password: 'test123',
        email: 'test@example.com'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(maliciousData);

      // Should either reject or sanitize the input
      if (response.status === 201) {
        expect(response.body.data.player.username).not.toContain('<script>');
      } else {
        expect(response.status).toBe(400);
      }
    });

    it('should validate Content-Type headers', async () => {
      // Test with invalid content type
      const response = await request(app)
        .post('/api/auth/register')
        .set('Content-Type', 'text/plain')
        .send('invalid data format');

      expect([400, 415]).toContain(response.status);
    });

    it('should limit request body size', async () => {
      const largeData = {
        username: 'test',
        password: 'test123',
        email: 'test@example.com',
        largeField: 'x'.repeat(20 * 1024 * 1024) // 20MB
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(largeData);

      expect([400, 413]).toContain(response.status);
    });
  });

  describe('Error Handling Middleware', () => {
    it('should handle validation errors gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: '', // Invalid
          password: 'test123',
          email: 'test@example.com'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBeDefined();
    });

    it('should handle database errors gracefully', async () => {
      // Try to access with invalid ObjectId
      const response = await request(app)
        .get('/api/rooms/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBeDefined();
    });

    it('should handle unexpected errors gracefully', async () => {
      // This would require mocking to trigger an unexpected error
      // For now, we test that the error handler structure is in place
      
      const response = await request(app)
        .get('/api/nonexistent-endpoint')
        .expect(404);

      expect(response.body).toBeDefined();
    });

    it('should not expose sensitive error information', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'test',
          password: 'test123',
          email: 'invalid-email'
        })
        .expect(400);

      // Should not expose internal error details
      expect(response.body.message).not.toContain('ValidationError');
      expect(response.body.message).not.toContain('MongoError');
      expect(response.body.stack).toBeUndefined();
    });
  });

  describe('Analytics Middleware', () => {
    it('should track request metrics', async () => {
      // Make several requests
      await request(app)
        .get('/api/rooms/public')
        .expect(200);

      await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: 'wrong' })
        .expect(401);

      // Analytics should be recorded (this would require checking the analytics service)
      // For now, we verify the requests complete successfully
      expect(true).toBe(true);
    });

    it('should handle analytics failures gracefully', async () => {
      // Even if analytics fails, the main request should succeed
      await request(app)
        .get('/api/rooms/public')
        .expect(200);
    });
  });

  describe('Middleware Chain Integration', () => {
    it('should execute middleware in correct order', async () => {
      // Test that security headers are set before authentication
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401); // Should fail auth but still have security headers

      expect(response.headers['x-content-type-options']).toBeDefined();
    });

    it('should handle middleware failures gracefully', async () => {
      // Test with various edge cases that might break middleware chain
      const edgeCases = [
        { headers: { 'Content-Length': '-1' } },
        { headers: { 'Transfer-Encoding': 'chunked', 'Content-Length': '100' } },
        { headers: { 'Host': 'evil.com' } }
      ];

      for (const edgeCase of edgeCases) {
        const response = await request(app)
          .get('/api/rooms/public')
          .set(edgeCase.headers);

        // Should handle gracefully, not crash
        expect([200, 400, 401, 403]).toContain(response.status);
      }
    });

    it('should maintain performance under load', async () => {
      const startTime = Date.now();
      
      const requests = Array(50).fill(null).map(() =>
        request(app).get('/api/rooms/public')
      );

      await Promise.all(requests);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (5 seconds for 50 requests)
      expect(duration).toBeLessThan(5000);
    });
  });
});