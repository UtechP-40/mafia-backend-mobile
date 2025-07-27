import { ApiTestingService } from '../services/ApiTestingService';
import express from 'express';
import { AdminLog } from '../models/AdminLog';

// Mock AdminLog
jest.mock('../models/AdminLog', () => ({
  AdminLog: {
    create: jest.fn().mockResolvedValue({})
  }
}));

// Mock axios
const mockAxios = {
  __esModule: true,
  default: jest.fn(),
  isAxiosError: jest.fn()
};

jest.mock('axios', () => mockAxios);

describe('ApiTestingService', () => {
  let mockApp: express.Application;

  beforeEach(() => {
    // Create a mock Express app
    mockApp = express();
    
    // Add some test routes
    mockApp.get('/test', (req, res) => res.json({ message: 'test' }));
    mockApp.post('/users', (req, res) => res.json({ message: 'user created' }));
    mockApp.put('/users/:id', (req, res) => res.json({ message: 'user updated' }));
    mockApp.delete('/users/:id', (req, res) => res.json({ message: 'user deleted' }));
    
    // Clear any existing data
    ApiTestingService.clearTestResults();
    
    // Reset axios mock
    jest.clearAllMocks();
    mockAxios.default.mockReset?.();
  });

  describe('discoverEndpoints', () => {
    it('should discover endpoints from Express app', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      
      expect(endpoints).toBeInstanceOf(Array);
      expect(endpoints.length).toBeGreaterThan(0);
      
      // Check that endpoints have required properties
      endpoints.forEach(endpoint => {
        expect(endpoint).toHaveProperty('id');
        expect(endpoint).toHaveProperty('path');
        expect(endpoint).toHaveProperty('method');
        expect(endpoint).toHaveProperty('description');
        expect(endpoint).toHaveProperty('parameters');
        expect(endpoint).toHaveProperty('responses');
        expect(endpoint).toHaveProperty('tags');
        expect(endpoint).toHaveProperty('requiresAuth');
        expect(endpoint).toHaveProperty('version');
      });
    });

    it('should generate appropriate descriptions for different HTTP methods', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      
      const getEndpoint = endpoints.find(e => e.method === 'GET');
      const postEndpoint = endpoints.find(e => e.method === 'POST');
      const putEndpoint = endpoints.find(e => e.method === 'PUT');
      const deleteEndpoint = endpoints.find(e => e.method === 'DELETE');
      
      expect(getEndpoint?.description).toContain('Get');
      expect(postEndpoint?.description).toContain('Create');
      expect(putEndpoint?.description).toContain('Update');
      expect(deleteEndpoint?.description).toContain('Delete');
    });

    it('should infer parameters from path parameters', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      
      const paramEndpoint = endpoints.find(e => e.path.includes(':id'));
      expect(paramEndpoint?.parameters).toHaveLength(1);
      expect(paramEndpoint?.parameters?.[0]).toMatchObject({
        name: 'id',
        type: 'string',
        required: true
      });
    });

    it('should generate appropriate tags', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      
      const userEndpoint = endpoints.find(e => e.path.includes('users'));
      expect(userEndpoint?.tags).toContain('users');
    });
  });

  describe('testEndpoint', () => {
    beforeEach(() => {
      // Reset axios mock
      jest.clearAllMocks();
      mockAxios.default.mockReset?.();
    });

    it('should test endpoint successfully', async () => {
      // Mock successful response
      mockAxios.default.mockResolvedValue({
        status: 200,
        data: { success: true, message: 'OK' }
      });

      // First discover endpoints
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      
      // Skip if no endpoints discovered (due to Express internals)
      if (endpoints.length === 0) {
        // Create a mock endpoint manually for testing
        const mockEndpoint = {
          id: 'GET_test',
          path: '/test',
          method: 'GET',
          description: 'Test endpoint',
          parameters: [],
          responses: [],
          tags: ['test'],
          requiresAuth: false,
          version: '1.0.0'
        };
        
        // Manually add to service for testing
        (ApiTestingService as any).endpoints.set(mockEndpoint.id, mockEndpoint);
        
        const result = await ApiTestingService.testEndpoint(
          mockEndpoint.id,
          'http://localhost:3000'
        );

        expect(result).toMatchObject({
          endpoint: mockEndpoint.path,
          method: mockEndpoint.method,
          statusCode: 200,
          success: true
        });
        expect(result.responseTime).toBeGreaterThan(0);
        expect(result.responseData).toEqual({ success: true, message: 'OK' });
        return;
      }

      const testEndpoint = endpoints[0];
      const result = await ApiTestingService.testEndpoint(
        testEndpoint.id,
        'http://localhost:3000'
      );

      expect(result).toMatchObject({
        endpoint: testEndpoint.path,
        method: testEndpoint.method,
        statusCode: 200,
        success: true
      });
      expect(result.responseTime).toBeGreaterThan(0);
      expect(result.responseData).toEqual({ success: true, message: 'OK' });
    });

    it('should handle endpoint test failure', async () => {
      // Mock error response
      const errorResponse = {
        response: {
          status: 404,
          data: { error: 'Not found' }
        }
      };
      mockAxios.default.mockRejectedValue(errorResponse);
      mockAxios.isAxiosError.mockReturnValue(true);

      // Create a mock endpoint manually for testing
      const mockEndpoint = {
        id: 'GET_test_fail',
        path: '/test-fail',
        method: 'GET',
        description: 'Test endpoint',
        parameters: [],
        responses: [],
        tags: ['test'],
        requiresAuth: false,
        version: '1.0.0'
      };
      
      // Manually add to service for testing
      (ApiTestingService as any).endpoints.set(mockEndpoint.id, mockEndpoint);

      const result = await ApiTestingService.testEndpoint(
        mockEndpoint.id,
        'http://localhost:3000'
      );

      expect(result).toMatchObject({
        endpoint: mockEndpoint.path,
        method: mockEndpoint.method,
        statusCode: 404,
        success: false
      });
      expect(result.responseData).toEqual({ error: 'Not found' });
    });

    it('should include performance metrics', async () => {
      mockAxios.default.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      // Create a mock endpoint manually for testing
      const mockEndpoint = {
        id: 'GET_test_perf',
        path: '/test-perf',
        method: 'GET',
        description: 'Test endpoint',
        parameters: [],
        responses: [],
        tags: ['test'],
        requiresAuth: false,
        version: '1.0.0'
      };
      
      // Manually add to service for testing
      (ApiTestingService as any).endpoints.set(mockEndpoint.id, mockEndpoint);

      const result = await ApiTestingService.testEndpoint(
        mockEndpoint.id,
        'http://localhost:3000'
      );

      expect(result.performanceMetrics).toBeDefined();
      expect(result.performanceMetrics?.responseTime).toBeGreaterThan(0);
      expect(result.performanceMetrics?.memoryUsage).toBeDefined();
      expect(result.performanceMetrics?.cpuUsage).toBeDefined();
    });

    it('should throw error for non-existent endpoint', async () => {
      await expect(
        ApiTestingService.testEndpoint('non-existent', 'http://localhost:3000')
      ).rejects.toThrow('Endpoint non-existent not found');
    });
  });

  describe('benchmarkEndpoint', () => {
    const axios = require('axios');

    beforeEach(() => {
      axios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });
    });

    it('should run performance benchmark', async () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const testEndpoint = endpoints[0];

      const result = await ApiTestingService.benchmarkEndpoint(
        testEndpoint.id,
        'http://localhost:3000',
        {
          concurrency: 2,
          requests: 5,
          duration: 1000
        }
      );

      expect(result).toMatchObject({
        totalRequests: expect.any(Number),
        successfulRequests: expect.any(Number),
        failedRequests: expect.any(Number),
        averageResponseTime: expect.any(Number),
        minResponseTime: expect.any(Number),
        maxResponseTime: expect.any(Number),
        requestsPerSecond: expect.any(Number),
        errorRate: expect.any(Number)
      });
      expect(result.results).toBeInstanceOf(Array);
      expect(result.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('collections', () => {
    it('should create test collection', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const endpointIds = endpoints.slice(0, 2).map(e => e.id);

      const collection = ApiTestingService.createCollection({
        name: 'Test Collection',
        description: 'A test collection',
        endpoints: endpointIds,
        environment: 'test',
        variables: { baseUrl: 'http://localhost:3000' }
      });

      expect(collection).toMatchObject({
        name: 'Test Collection',
        description: 'A test collection',
        endpoints: endpointIds,
        environment: 'test',
        variables: { baseUrl: 'http://localhost:3000' }
      });
      expect(collection.id).toBeDefined();
      expect(collection.createdAt).toBeInstanceOf(Date);
      expect(collection.updatedAt).toBeInstanceOf(Date);
    });

    it('should run test collection', async () => {
      const axios = require('axios');
      axios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const endpointIds = endpoints.slice(0, 2).map(e => e.id);

      const collection = ApiTestingService.createCollection({
        name: 'Test Collection',
        endpoints: endpointIds
      });

      const results = await ApiTestingService.runCollection(
        collection.id,
        'http://localhost:3000'
      );

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBe(endpointIds.length);
      results.forEach(result => {
        expect(result).toMatchObject({
          success: true,
          statusCode: 200
        });
      });
    });
  });

  describe('mock responses', () => {
    it('should create mock response', () => {
      const mock = ApiTestingService.createMockResponse({
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: true
      });

      expect(mock).toMatchObject({
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: true
      });
      expect(mock.id).toBeDefined();
    });

    it('should get mock response for matching request', () => {
      ApiTestingService.createMockResponse({
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: true
      });

      const mock = ApiTestingService.getMockResponse('/test', 'GET', {});
      expect(mock).toBeDefined();
      expect(mock?.responseData).toEqual({ mocked: true });
    });

    it('should not return inactive mock response', () => {
      ApiTestingService.createMockResponse({
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: false
      });

      const mock = ApiTestingService.getMockResponse('/test', 'GET', {});
      expect(mock).toBeNull();
    });

    it('should evaluate mock conditions', () => {
      ApiTestingService.createMockResponse({
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        conditions: [
          {
            type: 'header',
            key: 'Authorization',
            operator: 'exists',
            value: undefined
          }
        ],
        active: true
      });

      // Should match when header exists
      let mock = ApiTestingService.getMockResponse('/test', 'GET', {
        headers: { Authorization: 'Bearer token' }
      });
      expect(mock).toBeDefined();

      // Should not match when header doesn't exist
      mock = ApiTestingService.getMockResponse('/test', 'GET', {
        headers: {}
      });
      expect(mock).toBeNull();
    });
  });

  describe('environment management', () => {
    it('should set environment variables', () => {
      const variables = {
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key'
      };

      ApiTestingService.setEnvironment('test', variables);

      // Test that environment is set by running a collection with it
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const collection = ApiTestingService.createCollection({
        name: 'Test Collection',
        endpoints: [endpoints[0].id]
      });

      // The environment should be available for use
      expect(() => {
        ApiTestingService.runCollection(collection.id, 'http://localhost:3000', {
          environment: 'test'
        });
      }).not.toThrow();
    });
  });

  describe('documentation export', () => {
    it('should export OpenAPI specification', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const spec = ApiTestingService.exportDocumentation('openapi');

      expect(spec).toHaveProperty('openapi', '3.0.0');
      expect(spec).toHaveProperty('info');
      expect(spec).toHaveProperty('paths');
      expect(spec).toHaveProperty('components');
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    });

    it('should export Postman collection', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const collection = ApiTestingService.exportDocumentation('postman');

      expect(collection).toHaveProperty('info');
      expect(collection).toHaveProperty('item');
      expect(collection).toHaveProperty('variable');
      expect(collection.item).toBeInstanceOf(Array);
      expect(collection.item.length).toBeGreaterThan(0);
    });

    it('should export Insomnia collection', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const collection = ApiTestingService.exportDocumentation('insomnia');

      expect(collection).toHaveProperty('_type', 'export');
      expect(collection).toHaveProperty('resources');
      expect(collection.resources).toBeInstanceOf(Array);
      expect(collection.resources.length).toBeGreaterThan(0);
    });

    it('should throw error for unsupported format', () => {
      expect(() => {
        ApiTestingService.exportDocumentation('unsupported' as any);
      }).toThrow('Unsupported format: unsupported');
    });
  });

  describe('usage analytics', () => {
    it('should track usage analytics', async () => {
      const axios = require('axios');
      axios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const testEndpoint = endpoints[0];

      // Run multiple tests to generate analytics
      await ApiTestingService.testEndpoint(testEndpoint.id, 'http://localhost:3000');
      await ApiTestingService.testEndpoint(testEndpoint.id, 'http://localhost:3000');

      const analytics = ApiTestingService.getUsageAnalytics();
      expect(analytics).toBeInstanceOf(Array);
      expect(analytics.length).toBeGreaterThan(0);

      const endpointAnalytics = analytics.find(a => 
        a.endpoint === testEndpoint.path && a.method === testEndpoint.method
      );
      expect(endpointAnalytics).toBeDefined();
      expect(endpointAnalytics?.totalRequests).toBe(2);
      expect(endpointAnalytics?.successfulRequests).toBe(2);
      expect(endpointAnalytics?.failedRequests).toBe(0);
    });
  });

  describe('test results management', () => {
    it('should get test results with filters', async () => {
      const axios = require('axios');
      axios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const testEndpoint = endpoints[0];

      await ApiTestingService.testEndpoint(testEndpoint.id, 'http://localhost:3000');

      // Get all results
      let results = ApiTestingService.getTestResults();
      expect(results.length).toBe(1);

      // Filter by endpoint
      results = ApiTestingService.getTestResults({
        endpoint: testEndpoint.path
      });
      expect(results.length).toBe(1);

      // Filter by method
      results = ApiTestingService.getTestResults({
        method: testEndpoint.method
      });
      expect(results.length).toBe(1);

      // Filter by success
      results = ApiTestingService.getTestResults({
        success: true
      });
      expect(results.length).toBe(1);

      // Filter with limit
      results = ApiTestingService.getTestResults({
        limit: 0
      });
      expect(results.length).toBe(0);
    });

    it('should clear test results', async () => {
      const axios = require('axios');
      axios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const testEndpoint = endpoints[0];

      await ApiTestingService.testEndpoint(testEndpoint.id, 'http://localhost:3000');

      let results = ApiTestingService.getTestResults();
      expect(results.length).toBe(1);

      ApiTestingService.clearTestResults();

      results = ApiTestingService.getTestResults();
      expect(results.length).toBe(0);
    });
  });

  describe('data retrieval methods', () => {
    it('should get all endpoints', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const allEndpoints = ApiTestingService.getAllEndpoints();
      
      expect(allEndpoints).toEqual(endpoints);
    });

    it('should get endpoint by ID', () => {
      const endpoints = ApiTestingService.discoverEndpoints(mockApp);
      const firstEndpoint = endpoints[0];
      
      const retrievedEndpoint = ApiTestingService.getEndpoint(firstEndpoint.id);
      expect(retrievedEndpoint).toEqual(firstEndpoint);
    });

    it('should return undefined for non-existent endpoint', () => {
      const endpoint = ApiTestingService.getEndpoint('non-existent');
      expect(endpoint).toBeUndefined();
    });

    it('should get collections', () => {
      const collection = ApiTestingService.createCollection({
        name: 'Test Collection',
        endpoints: []
      });

      const collections = ApiTestingService.getCollections();
      expect(collections).toContain(collection);
    });

    it('should get mock responses', () => {
      const mock = ApiTestingService.createMockResponse({
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: true
      });

      const mocks = ApiTestingService.getMockResponses();
      expect(mocks).toContain(mock);
    });
  });
});