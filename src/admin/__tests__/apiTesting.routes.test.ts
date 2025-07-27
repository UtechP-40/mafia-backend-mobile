import request from 'supertest';
import express from 'express';
import { ApiTestingService } from '../services/ApiTestingService';
import apiTestingRoutes from '../routes/apiTesting';
import { adminAuthMiddleware } from '../middleware/auth';
import { Permission } from '../models/SuperUser';

// Mock the ApiTestingService
jest.mock('../services/ApiTestingService');

// Mock the admin auth middleware
jest.mock('../middleware/auth', () => ({
  adminAuthMiddleware: jest.fn((req, res, next) => {
    req.adminUser = {
      id: 'test-admin-id',
      username: 'testadmin',
      permissions: [Permission.SYSTEM_MONITOR, Permission.ANALYTICS_READ]
    };
    next();
  }),
  requireAdminPermission: jest.fn(() => (req: any, res: any, next: any) => next())
}));

// Mock the admin logger
jest.mock('../config/logger', () => ({
  adminLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('API Testing Routes', () => {
  let app: express.Application;
  const mockApiTestingService = ApiTestingService as jest.Mocked<typeof ApiTestingService>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/admin/api/api-testing', apiTestingRoutes);
    
    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('GET /discover', () => {
    it('should discover API endpoints successfully', async () => {
      const mockEndpoints = [
        {
          id: 'GET_test',
          path: '/test',
          method: 'GET',
          description: 'Test endpoint',
          parameters: [],
          responses: [],
          tags: ['test'],
          requiresAuth: false,
          version: '1.0.0'
        }
      ];

      mockApiTestingService.discoverEndpoints
        .mockReturnValueOnce(mockEndpoints)
        .mockReturnValueOnce([]);

      const response = await request(app)
        .get('/admin/api/api-testing/discover')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'API endpoints discovered successfully',
        data: {
          endpoints: mockEndpoints,
          total: 1,
          mainAppEndpoints: 1,
          adminAppEndpoints: 0
        }
      });
    });

    it('should handle discovery errors', async () => {
      mockApiTestingService.discoverEndpoints.mockImplementation(() => {
        throw new Error('Discovery failed');
      });

      const response = await request(app)
        .get('/admin/api/api-testing/discover')
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Failed to discover API endpoints',
        error: 'Discovery failed'
      });
    });
  });

  describe('GET /endpoints', () => {
    it('should get all endpoints', async () => {
      const mockEndpoints = [
        {
          id: 'GET_test',
          path: '/test',
          method: 'GET',
          description: 'Test endpoint',
          tags: ['test']
        }
      ];

      mockApiTestingService.getAllEndpoints.mockReturnValue(mockEndpoints);

      const response = await request(app)
        .get('/admin/api/api-testing/endpoints')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          endpoints: mockEndpoints,
          total: 1
        }
      });
    });

    it('should filter endpoints by tag', async () => {
      const mockEndpoints = [
        {
          id: 'GET_test',
          path: '/test',
          method: 'GET',
          tags: ['test']
        }
      ];

      mockApiTestingService.getAllEndpoints.mockReturnValue(mockEndpoints);

      const response = await request(app)
        .get('/admin/api/api-testing/endpoints?tag=test')
        .expect(200);

      expect(response.body.data.endpoints).toHaveLength(1);
    });

    it('should filter endpoints by method', async () => {
      const mockEndpoints = [
        {
          id: 'GET_test',
          path: '/test',
          method: 'GET',
          tags: []
        }
      ];

      mockApiTestingService.getAllEndpoints.mockReturnValue(mockEndpoints);

      const response = await request(app)
        .get('/admin/api/api-testing/endpoints?method=GET')
        .expect(200);

      expect(response.body.data.endpoints).toHaveLength(1);
    });

    it('should filter endpoints by search term', async () => {
      const mockEndpoints = [
        {
          id: 'GET_test',
          path: '/test',
          method: 'GET',
          description: 'Test endpoint',
          tags: []
        }
      ];

      mockApiTestingService.getAllEndpoints.mockReturnValue(mockEndpoints);

      const response = await request(app)
        .get('/admin/api/api-testing/endpoints?search=test')
        .expect(200);

      expect(response.body.data.endpoints).toHaveLength(1);
    });
  });

  describe('GET /endpoints/:id', () => {
    it('should get specific endpoint', async () => {
      const mockEndpoint = {
        id: 'GET_test',
        path: '/test',
        method: 'GET',
        description: 'Test endpoint'
      };

      mockApiTestingService.getEndpoint.mockReturnValue(mockEndpoint);

      const response = await request(app)
        .get('/admin/api/api-testing/endpoints/GET_test')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: { endpoint: mockEndpoint }
      });
    });

    it('should return 404 for non-existent endpoint', async () => {
      mockApiTestingService.getEndpoint.mockReturnValue(undefined);

      const response = await request(app)
        .get('/admin/api/api-testing/endpoints/non-existent')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Endpoint not found'
      });
    });
  });

  describe('POST /test/:id', () => {
    it('should test endpoint successfully', async () => {
      const mockTestResult = {
        id: 'test-result-1',
        timestamp: new Date(),
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseTime: 100,
        success: true,
        responseData: { message: 'OK' }
      };

      mockApiTestingService.testEndpoint.mockResolvedValue(mockTestResult);

      const response = await request(app)
        .post('/admin/api/api-testing/test/GET_test')
        .send({
          baseUrl: 'http://localhost:3000',
          headers: { 'Content-Type': 'application/json' }
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Endpoint tested successfully',
        data: { testResult: mockTestResult }
      });
    });

    it('should handle test errors', async () => {
      mockApiTestingService.testEndpoint.mockRejectedValue(new Error('Test failed'));

      const response = await request(app)
        .post('/admin/api/api-testing/test/GET_test')
        .send({ baseUrl: 'http://localhost:3000' })
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Failed to test endpoint',
        error: 'Test failed'
      });
    });
  });

  describe('POST /benchmark/:id', () => {
    it('should benchmark endpoint successfully', async () => {
      const mockBenchmarkResult = {
        totalRequests: 10,
        successfulRequests: 10,
        failedRequests: 0,
        averageResponseTime: 150,
        minResponseTime: 100,
        maxResponseTime: 200,
        requestsPerSecond: 66.67,
        errorRate: 0,
        results: []
      };

      mockApiTestingService.benchmarkEndpoint.mockResolvedValue(mockBenchmarkResult);

      const response = await request(app)
        .post('/admin/api/api-testing/benchmark/GET_test')
        .send({
          baseUrl: 'http://localhost:3000',
          concurrency: 5,
          requests: 10
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Endpoint benchmark completed successfully',
        data: { benchmarkResult: mockBenchmarkResult }
      });
    });

    it('should handle benchmark errors', async () => {
      mockApiTestingService.benchmarkEndpoint.mockRejectedValue(new Error('Benchmark failed'));

      const response = await request(app)
        .post('/admin/api/api-testing/benchmark/GET_test')
        .send({ baseUrl: 'http://localhost:3000' })
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Failed to benchmark endpoint',
        error: 'Benchmark failed'
      });
    });
  });

  describe('GET /results', () => {
    it('should get test results', async () => {
      const mockResults = [
        {
          id: 'result-1',
          timestamp: new Date(),
          endpoint: '/test',
          method: 'GET',
          statusCode: 200,
          success: true
        }
      ];

      mockApiTestingService.getTestResults.mockReturnValue(mockResults);

      const response = await request(app)
        .get('/admin/api/api-testing/results')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          results: mockResults,
          total: 1
        }
      });
    });

    it('should filter test results', async () => {
      mockApiTestingService.getTestResults.mockReturnValue([]);

      await request(app)
        .get('/admin/api/api-testing/results?endpoint=/test&method=GET&success=true&limit=10')
        .expect(200);

      expect(mockApiTestingService.getTestResults).toHaveBeenCalledWith({
        endpoint: '/test',
        method: 'GET',
        success: true,
        limit: 10
      });
    });
  });

  describe('DELETE /results', () => {
    it('should clear test results', async () => {
      mockApiTestingService.clearTestResults.mockImplementation(() => {});

      const response = await request(app)
        .delete('/admin/api/api-testing/results')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Test results cleared successfully'
      });

      expect(mockApiTestingService.clearTestResults).toHaveBeenCalled();
    });
  });

  describe('GET /analytics', () => {
    it('should get usage analytics', async () => {
      const mockAnalytics = [
        {
          endpoint: '/test',
          method: 'GET',
          totalRequests: 10,
          successfulRequests: 9,
          failedRequests: 1,
          averageResponseTime: 150,
          errorRate: 10,
          popularityScore: 9
        }
      ];

      mockApiTestingService.getUsageAnalytics.mockReturnValue(mockAnalytics);

      const response = await request(app)
        .get('/admin/api/api-testing/analytics')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          analytics: mockAnalytics,
          total: 1
        }
      });
    });
  });

  describe('POST /collections', () => {
    it('should create test collection', async () => {
      const mockCollection = {
        id: 'collection-1',
        name: 'Test Collection',
        description: 'A test collection',
        endpoints: ['GET_test'],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockApiTestingService.createCollection.mockReturnValue(mockCollection);

      const response = await request(app)
        .post('/admin/api/api-testing/collections')
        .send({
          name: 'Test Collection',
          description: 'A test collection',
          endpoints: ['GET_test']
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Test collection created successfully',
        data: { collection: mockCollection }
      });
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/admin/api/api-testing/collections')
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Name and endpoints array are required'
      });
    });
  });

  describe('GET /collections', () => {
    it('should get all collections', async () => {
      const mockCollections = [
        {
          id: 'collection-1',
          name: 'Test Collection',
          endpoints: ['GET_test']
        }
      ];

      mockApiTestingService.getCollections.mockReturnValue(mockCollections);

      const response = await request(app)
        .get('/admin/api/api-testing/collections')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          collections: mockCollections,
          total: 1
        }
      });
    });
  });

  describe('POST /collections/:id/run', () => {
    it('should run test collection', async () => {
      const mockResults = [
        {
          id: 'result-1',
          success: true,
          statusCode: 200
        },
        {
          id: 'result-2',
          success: false,
          statusCode: 404
        }
      ];

      mockApiTestingService.runCollection.mockResolvedValue(mockResults);

      const response = await request(app)
        .post('/admin/api/api-testing/collections/collection-1/run')
        .send({
          baseUrl: 'http://localhost:3000',
          parallel: true
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Test collection completed successfully',
        data: {
          results: mockResults,
          total: 2,
          successful: 1,
          failed: 1
        }
      });
    });

    it('should handle collection run errors', async () => {
      mockApiTestingService.runCollection.mockRejectedValue(new Error('Collection run failed'));

      const response = await request(app)
        .post('/admin/api/api-testing/collections/collection-1/run')
        .send({ baseUrl: 'http://localhost:3000' })
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Failed to run test collection',
        error: 'Collection run failed'
      });
    });
  });

  describe('POST /mocks', () => {
    it('should create mock response', async () => {
      const mockResponse = {
        id: 'mock-1',
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: true
      };

      mockApiTestingService.createMockResponse.mockReturnValue(mockResponse);

      const response = await request(app)
        .post('/admin/api/api-testing/mocks')
        .send({
          endpoint: '/test',
          method: 'GET',
          statusCode: 200,
          responseData: { mocked: true }
        })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Mock response created successfully',
        data: { mock: mockResponse }
      });
    });

    it('should validate required fields for mock creation', async () => {
      const response = await request(app)
        .post('/admin/api/api-testing/mocks')
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Endpoint, method, statusCode, and responseData are required'
      });
    });
  });

  describe('GET /mocks', () => {
    it('should get all mock responses', async () => {
      const mockResponses = [
        {
          id: 'mock-1',
          endpoint: '/test',
          method: 'GET',
          statusCode: 200,
          responseData: { mocked: true }
        }
      ];

      mockApiTestingService.getMockResponses.mockReturnValue(mockResponses);

      const response = await request(app)
        .get('/admin/api/api-testing/mocks')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          mocks: mockResponses,
          total: 1
        }
      });
    });
  });

  describe('POST /environments', () => {
    it('should set environment variables', async () => {
      mockApiTestingService.setEnvironment.mockImplementation(() => {});

      const response = await request(app)
        .post('/admin/api/api-testing/environments')
        .send({
          name: 'test',
          variables: {
            baseUrl: 'http://localhost:3000',
            apiKey: 'test-key'
          }
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Environment variables set successfully'
      });

      expect(mockApiTestingService.setEnvironment).toHaveBeenCalledWith('test', {
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key'
      });
    });

    it('should validate required fields for environment', async () => {
      const response = await request(app)
        .post('/admin/api/api-testing/environments')
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Name and variables are required'
      });
    });
  });

  describe('GET /export/:format', () => {
    it('should export OpenAPI documentation', async () => {
      const mockSpec = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {}
      };

      mockApiTestingService.exportDocumentation.mockReturnValue(mockSpec);

      const response = await request(app)
        .get('/admin/api/api-testing/export/openapi')
        .expect(200);

      expect(response.body).toEqual(mockSpec);
      expect(response.headers['content-disposition']).toContain('openapi-spec.json');
    });

    it('should export Postman collection', async () => {
      const mockCollection = {
        info: { name: 'Test API' },
        item: [],
        variable: []
      };

      mockApiTestingService.exportDocumentation.mockReturnValue(mockCollection);

      const response = await request(app)
        .get('/admin/api/api-testing/export/postman')
        .expect(200);

      expect(response.body).toEqual(mockCollection);
      expect(response.headers['content-disposition']).toContain('postman-collection.json');
    });

    it('should return error for unsupported format', async () => {
      const response = await request(app)
        .get('/admin/api/api-testing/export/unsupported')
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Unsupported format. Use: openapi, postman, or insomnia'
      });
    });

    it('should handle export errors', async () => {
      mockApiTestingService.exportDocumentation.mockImplementation(() => {
        throw new Error('Export failed');
      });

      const response = await request(app)
        .get('/admin/api/api-testing/export/openapi')
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Failed to export documentation',
        error: 'Export failed'
      });
    });
  });

  describe('POST /security-scan/:id', () => {
    it('should run security scan successfully', async () => {
      const mockEndpoint = {
        id: 'GET_test',
        path: '/test',
        method: 'GET'
      };

      const mockTestResults = [
        {
          id: 'test-1',
          statusCode: 200,
          responseTime: 100,
          responseData: { message: 'OK' }
        }
      ];

      mockApiTestingService.getEndpoint.mockReturnValue(mockEndpoint);
      mockApiTestingService.testEndpoint.mockResolvedValue(mockTestResults[0] as any);

      const response = await request(app)
        .post('/admin/api/api-testing/security-scan/GET_test')
        .send({ baseUrl: 'http://localhost:3000' })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Security scan completed',
        data: {
          endpoint: '/test',
          method: 'GET',
          testsRun: expect.any(Number),
          vulnerabilities: expect.any(Number),
          results: expect.any(Array),
          summary: {
            safe: expect.any(Boolean),
            riskLevel: expect.any(String)
          }
        }
      });
    });

    it('should return 404 for non-existent endpoint', async () => {
      mockApiTestingService.getEndpoint.mockReturnValue(undefined);

      const response = await request(app)
        .post('/admin/api/api-testing/security-scan/non-existent')
        .send({ baseUrl: 'http://localhost:3000' })
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Endpoint not found'
      });
    });

    it('should handle security scan errors', async () => {
      const mockEndpoint = {
        id: 'GET_test',
        path: '/test',
        method: 'GET'
      };

      mockApiTestingService.getEndpoint.mockReturnValue(mockEndpoint);
      mockApiTestingService.testEndpoint.mockRejectedValue(new Error('Scan failed'));

      const response = await request(app)
        .post('/admin/api/api-testing/security-scan/GET_test')
        .send({ baseUrl: 'http://localhost:3000' })
        .expect(500);

      expect(response.body).toMatchObject({
        success: false,
        message: 'Failed to run security scan',
        error: 'Scan failed'
      });
    });
  });
});