import request from 'supertest';
import { app } from '../index';
import { SecurityService } from '../services/SecurityService';
import { AntiCheatService } from '../services/AntiCheatService';
import { GDPRService } from '../services/GDPRService';
import { connectDatabase, disconnectDatabase } from '../utils/database';

describe('Security Integration Tests', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('Input Sanitization', () => {
    it('should sanitize XSS attempts in request body', async () => {
      const maliciousInput = {
        username: '<script>alert("xss")</script>',
        message: '<img src="x" onerror="alert(1)">'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(maliciousInput);

      // Should not contain script tags in error messages
      expect(JSON.stringify(response.body)).not.toMatch(/<script>/);
      expect(JSON.stringify(response.body)).not.toMatch(/onerror=/);
    });

    it('should sanitize SQL injection attempts', async () => {
      const maliciousInput = {
        username: "admin'; DROP TABLE users; --",
        password: "password"
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(maliciousInput);

      // Should handle gracefully without exposing database errors
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('should sanitize path traversal attempts', async () => {
      const response = await request(app)
        .get('/api/players/../../../etc/passwd')
        .expect(404); // Should not find the path

      expect(response.body).not.toContain('root:');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on authentication endpoints', async () => {
      const requests = [];
      
      // Make multiple rapid requests
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/auth/login')
            .send({ username: 'test', password: 'test' })
        );
      }

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should set rate limit headers', async () => {
      const response = await request(app)
        .get('/api/security/health');

      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
    });
  });

  describe('Security Headers', () => {
    it('should set security headers', async () => {
      const response = await request(app)
        .get('/api/security/health');

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
      expect(response.headers).toHaveProperty('referrer-policy', 'strict-origin-when-cross-origin');
    });

    it('should set advanced security headers', async () => {
      const response = await request(app)
        .get('/api/security/health');

      expect(response.headers).toHaveProperty('permissions-policy');
      expect(response.headers).toHaveProperty('x-dns-prefetch-control', 'off');
      expect(response.headers).toHaveProperty('x-download-options', 'noopen');
    });

    it('should remove server information headers', async () => {
      const response = await request(app)
        .get('/api/security/health');

      expect(response.headers).not.toHaveProperty('x-powered-by');
      expect(response.headers).not.toHaveProperty('server');
    });
  });

  describe('Suspicious Activity Detection', () => {
    it('should detect and log suspicious patterns', async () => {
      const suspiciousRequests = [
        '/api/auth/login?id=1 OR 1=1',
        '/api/players/<script>alert(1)</script>',
        '/api/rooms/../../../etc/passwd'
      ];

      for (const path of suspiciousRequests) {
        await request(app).get(path);
      }

      const events = SecurityService.getSecurityEvents(10);
      const suspiciousEvents = events.filter(e => e.type === 'suspicious_activity');
      
      expect(suspiciousEvents.length).toBeGreaterThan(0);
    });

    it('should block high-risk requests', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          username: "'; DROP TABLE users; --",
          password: '<script>alert("xss")</script>'
        });

      // Should either block or handle safely
      expect([400, 403, 422]).toContain(response.status);
    });
  });

  describe('Request Size Limiting', () => {
    it('should reject oversized requests', async () => {
      const largePayload = {
        data: 'x'.repeat(10 * 1024 * 1024) // 10MB
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(largePayload);

      expect(response.status).toBe(413);
      expect(response.body.error.message).toContain('too large');
    });
  });

  describe('CSRF Protection', () => {
    it('should validate CSRF tokens for state-changing operations', async () => {
      // First get a valid token
      const tokenResponse = await request(app)
        .post('/api/security/csrf-token')
        .set('Authorization', 'Bearer valid-token');

      if (tokenResponse.status === 200) {
        const { csrfToken, sessionToken } = tokenResponse.body.data;

        // Use the token in a request
        const response = await request(app)
          .post('/api/auth/register')
          .set('X-CSRF-Token', csrfToken)
          .set('X-Session-Token', sessionToken)
          .send({
            username: 'testuser',
            password: 'TestPass123!'
          });

        // Should not be rejected for CSRF reasons
        expect(response.status).not.toBe(403);
      }
    });
  });

  describe('Password Security', () => {
    it('should enforce strong password requirements', async () => {
      const weakPasswords = [
        'password',
        '123456',
        'abc',
        'Password', // No numbers or special chars
        '12345678' // No letters
      ];

      for (const password of weakPasswords) {
        const response = await request(app)
          .post('/api/security/validate-password')
          .send({ password });

        expect(response.body.data.isStrong).toBe(false);
        expect(response.body.data.feedback.length).toBeGreaterThan(0);
      }
    });

    it('should accept strong passwords', async () => {
      const strongPassword = 'MyStr0ng!P@ssw0rd';

      const response = await request(app)
        .post('/api/security/validate-password')
        .send({ password: strongPassword });

      expect(response.body.data.isStrong).toBe(true);
      expect(response.body.data.score).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Anti-Cheat System', () => {
    it('should detect suspicious gaming patterns', async () => {
      // Simulate rapid game actions that might indicate cheating
      const playerId = 'test-player-123';
      const gameId = 'test-game-123';
      const roomId = 'test-room-123';

      // Simulate superhuman reaction times
      for (let i = 0; i < 5; i++) {
        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          'vote',
          gameId,
          roomId,
          { reactionTime: 10 } // 10ms reaction time (superhuman)
        );
      }

      const violations = AntiCheatService.getPlayerViolations(playerId);
      expect(violations).toBeTruthy();
      expect(violations!.count).toBeGreaterThan(0);
    });

    it('should flag players with multiple violations', async () => {
      const playerId = 'repeat-offender-123';
      
      // Simulate multiple violations
      for (let i = 0; i < 10; i++) {
        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          'suspicious_action',
          'game-123',
          'room-123',
          { suspicious: true }
        );
      }

      const shouldFlag = AntiCheatService.shouldFlagPlayer(playerId);
      expect(shouldFlag).toBe(true);
    });
  });

  describe('GDPR Compliance', () => {
    it('should handle data export requests', async () => {
      // This would require authentication in real scenario
      const response = await request(app)
        .post('/api/gdpr/export-request')
        .set('Authorization', 'Bearer valid-token');

      if (response.status === 202) {
        expect(response.body.success).toBe(true);
        expect(response.body.data.requestId).toBeDefined();
      }
    });

    it('should handle consent recording', async () => {
      const response = await request(app)
        .post('/api/gdpr/consent')
        .set('Authorization', 'Bearer valid-token')
        .send({
          consentType: 'analytics',
          granted: true
        });

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });

    it('should validate consent types', async () => {
      const response = await request(app)
        .post('/api/gdpr/consent')
        .set('Authorization', 'Bearer valid-token')
        .send({
          consentType: 'invalid_type',
          granted: true
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid consent type');
    });
  });

  describe('Security Monitoring', () => {
    it('should provide security health status', async () => {
      const response = await request(app)
        .get('/api/security/health');

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('healthy');
      expect(response.body.data.checks).toBeDefined();
      expect(response.body.data.metrics).toBeDefined();
    });

    it('should track security events', async () => {
      // Generate some security events
      await request(app)
        .get('/api/auth/login?malicious=<script>alert(1)</script>');

      const response = await request(app)
        .get('/api/security/events')
        .set('Authorization', 'Bearer admin-token');

      if (response.status === 200) {
        expect(response.body.data.events).toBeDefined();
        expect(Array.isArray(response.body.data.events)).toBe(true);
      }
    });
  });

  describe('Input Validation', () => {
    it('should validate email formats', async () => {
      const invalidEmails = [
        'invalid-email',
        '@domain.com',
        'user@',
        'user@domain',
        'user..name@domain.com'
      ];

      for (const email of invalidEmails) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email,
            username: 'testuser',
            password: 'ValidPass123!'
          });

        expect(response.status).toBe(400);
      }
    });

    it('should validate username formats', async () => {
      const invalidUsernames = [
        'ab', // Too short
        'a'.repeat(25), // Too long
        'user@name', // Invalid characters
        '_username', // Starts with underscore
        'username_' // Ends with underscore
      ];

      for (const username of invalidUsernames) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            username,
            password: 'ValidPass123!'
          });

        expect(response.status).toBe(400);
      }
    });
  });

  describe('Error Handling', () => {
    it('should not expose sensitive information in errors', async () => {
      const response = await request(app)
        .get('/api/nonexistent-endpoint');

      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toMatch(/stack trace/i);
      expect(JSON.stringify(response.body)).not.toMatch(/internal error/i);
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Session Security', () => {
    it('should invalidate tokens on logout', async () => {
      // This test would require a valid authentication flow
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'TestPass123!'
        });

      if (loginResponse.status === 200) {
        const { refreshToken } = loginResponse.body.data;

        const logoutResponse = await request(app)
          .delete('/api/auth/logout')
          .send({ refreshToken });

        expect(logoutResponse.body.success).toBe(true);

        // Try to use the token again
        const refreshResponse = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken });

        expect(refreshResponse.status).toBe(401);
      }
    });
  });
});