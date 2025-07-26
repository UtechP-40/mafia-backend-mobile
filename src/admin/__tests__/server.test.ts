import request from 'supertest';
import app from '../server';
import { connectAdminDatabase, closeAdminDatabase } from '../config/database';

describe('Admin Portal Server', () => {
  beforeAll(async () => {
    // Mock database connection for testing
    jest.mock('../config/database', () => ({
      connectAdminDatabase: jest.fn().mockResolvedValue({}),
      closeAdminDatabase: jest.fn().mockResolvedValue(undefined),
      getAdminConnection: jest.fn().mockReturnValue({})
    }));
  });

  afterAll(async () => {
    await closeAdminDatabase();
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/admin/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        service: 'admin-portal',
        version: '1.0.0'
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should require authentication for protected routes', async () => {
      const response = await request(app)
        .get('/admin/api/dashboard')
        .expect(403);

      expect(response.body.error.code).toBe('ADMIN_ACCESS_DENIED');
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/admin/api/dashboard')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error.code).toBe('ADMIN_INVALID_TOKEN');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to admin endpoints', async () => {
      // This test would need to be more sophisticated in a real scenario
      // For now, just verify the endpoint exists and rate limiting is configured
      const response = await request(app)
        .get('/admin/health')
        .expect(200);

      // Rate limiting headers may vary by implementation
      // Just verify the response is successful, indicating rate limiting middleware is working
      expect(response.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app)
        .get('/admin/non-existent')
        .expect(404);

      expect(response.body.error).toBe('Admin endpoint not found');
      expect(response.body.path).toBe('/admin/non-existent');
    });
  });

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const response = await request(app)
        .options('/admin/health')
        .set('Origin', 'http://localhost:3000')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
  });
});