import { ApiTestingService } from '../services/ApiTestingService';

// Mock AdminLog
jest.mock('../models/AdminLog', () => ({
  AdminLog: {
    create: jest.fn().mockResolvedValue({})
  }
}));

// Mock axios
jest.mock('axios', () => ({
  __esModule: true,
  default: jest.fn(),
  isAxiosError: jest.fn()
}));

describe('ApiTestingService - Core Functionality', () => {
  beforeEach(() => {
    // Clear any existing data
    ApiTestingService.clearTestResults();
    
    // Reset axios mock
    jest.clearAllMocks();
  });

  describe('Basic Service Operations', () => {
    it('should create and manage test collections', () => {
      const collection = ApiTestingService.createCollection({
        name: 'Test Collection',
        description: 'A test collection',
        endpoints: ['endpoint1', 'endpoint2'],
        environment: 'test',
        variables: { baseUrl: 'http://localhost:3000' }
      });

      expect(collection).toMatchObject({
        name: 'Test Collection',
        description: 'A test collection',
        endpoints: ['endpoint1', 'endpoint2'],
        environment: 'test',
        variables: { baseUrl: 'http://localhost:3000' }
      });
      expect(collection.id).toBeDefined();
      expect(collection.createdAt).toBeInstanceOf(Date);
      expect(collection.updatedAt).toBeInstanceOf(Date);

      // Test retrieval
      const collections = ApiTestingService.getCollections();
      expect(collections).toContain(collection);
    });

    it('should create and manage mock responses', () => {
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

      // Test retrieval
      const mocks = ApiTestingService.getMockResponses();
      expect(mocks).toContain(mock);

      // Test getting mock for request
      const foundMock = ApiTestingService.getMockResponse('/test', 'GET', {});
      expect(foundMock).toBeDefined();
      expect(foundMock?.responseData).toEqual({ mocked: true });
    });

    it('should not return inactive mock response', () => {
      // Clear any existing mocks first
      (ApiTestingService as any).mockResponses.clear();
      
      ApiTestingService.createMockResponse({
        endpoint: '/test-inactive',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: false
      });

      const mock = ApiTestingService.getMockResponse('/test-inactive', 'GET', {});
      expect(mock).toBeNull();
    });

    it('should evaluate mock conditions correctly', () => {
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

    it('should manage environment variables', () => {
      const variables = {
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key'
      };

      ApiTestingService.setEnvironment('test', variables);

      // Environment should be set (we can't directly test this without exposing internals)
      expect(() => {
        ApiTestingService.setEnvironment('test', variables);
      }).not.toThrow();
    });

    it('should test endpoint with manual setup', async () => {
      const axios = require('axios');
      // Mock successful response
      axios.mockResolvedValue({
        status: 200,
        data: { success: true, message: 'OK' }
      });

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
      expect(result.performanceMetrics).toBeDefined();
    });

    it('should handle endpoint test failure', async () => {
      const axios = require('axios');
      // Mock error response
      const errorResponse = {
        response: {
          status: 404,
          data: { error: 'Not found' }
        }
      };
      axios.mockRejectedValue(errorResponse);
      axios.isAxiosError.mockReturnValue(true);

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

    it('should throw error for non-existent endpoint', async () => {
      await expect(
        ApiTestingService.testEndpoint('non-existent', 'http://localhost:3000')
      ).rejects.toThrow('Endpoint non-existent not found');
    });

    it('should export documentation in different formats', () => {
      // Create some mock endpoints
      const mockEndpoints = [
        {
          id: 'GET_test',
          path: '/test',
          method: 'GET',
          description: 'Test endpoint',
          parameters: [],
          responses: [
            {
              statusCode: 200,
              description: 'Success',
              example: { success: true }
            }
          ],
          tags: ['test'],
          requiresAuth: false,
          version: '1.0.0'
        }
      ];

      // Manually add endpoints for testing
      mockEndpoints.forEach(endpoint => {
        (ApiTestingService as any).endpoints.set(endpoint.id, endpoint);
      });

      // Test OpenAPI export
      const openApiSpec = ApiTestingService.exportDocumentation('openapi');
      expect(openApiSpec).toHaveProperty('openapi', '3.0.0');
      expect(openApiSpec).toHaveProperty('info');
      expect(openApiSpec).toHaveProperty('paths');
      expect(openApiSpec).toHaveProperty('components');

      // Test Postman export
      const postmanCollection = ApiTestingService.exportDocumentation('postman');
      expect(postmanCollection).toHaveProperty('info');
      expect(postmanCollection).toHaveProperty('item');
      expect(postmanCollection).toHaveProperty('variable');
      expect(postmanCollection.item).toBeInstanceOf(Array);

      // Test Insomnia export
      const insomniaCollection = ApiTestingService.exportDocumentation('insomnia');
      expect(insomniaCollection).toHaveProperty('_type', 'export');
      expect(insomniaCollection).toHaveProperty('resources');
      expect(insomniaCollection.resources).toBeInstanceOf(Array);

      // Test unsupported format
      expect(() => {
        ApiTestingService.exportDocumentation('unsupported' as any);
      }).toThrow('Unsupported format: unsupported');
    });

    it('should manage test results', async () => {
      const axios = require('axios');
      // Mock successful response
      axios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      // Create a mock endpoint
      const mockEndpoint = {
        id: 'GET_test_results',
        path: '/test-results',
        method: 'GET',
        description: 'Test endpoint',
        parameters: [],
        responses: [],
        tags: ['test'],
        requiresAuth: false,
        version: '1.0.0'
      };
      
      (ApiTestingService as any).endpoints.set(mockEndpoint.id, mockEndpoint);

      // Run test
      await ApiTestingService.testEndpoint(mockEndpoint.id, 'http://localhost:3000');

      // Get all results
      let results = ApiTestingService.getTestResults();
      expect(results.length).toBe(1);

      // Filter by endpoint
      results = ApiTestingService.getTestResults({
        endpoint: mockEndpoint.path
      });
      expect(results.length).toBe(1);

      // Filter by method
      results = ApiTestingService.getTestResults({
        method: mockEndpoint.method
      });
      expect(results.length).toBe(1);

      // Filter by success
      results = ApiTestingService.getTestResults({
        success: true
      });
      expect(results.length).toBe(1);

      // Clear results
      ApiTestingService.clearTestResults();
      results = ApiTestingService.getTestResults();
      expect(results.length).toBe(0);
    });

    it('should track usage analytics', async () => {
      const axios = require('axios');
      // Mock successful response
      axios.mockResolvedValue({
        status: 200,
        data: { success: true }
      });

      // Create a mock endpoint
      const mockEndpoint = {
        id: 'GET_test_analytics',
        path: '/test-analytics',
        method: 'GET',
        description: 'Test endpoint',
        parameters: [],
        responses: [],
        tags: ['test'],
        requiresAuth: false,
        version: '1.0.0'
      };
      
      (ApiTestingService as any).endpoints.set(mockEndpoint.id, mockEndpoint);

      // Run multiple tests to generate analytics
      await ApiTestingService.testEndpoint(mockEndpoint.id, 'http://localhost:3000');
      await ApiTestingService.testEndpoint(mockEndpoint.id, 'http://localhost:3000');

      const analytics = ApiTestingService.getUsageAnalytics();
      expect(analytics).toBeInstanceOf(Array);
      expect(analytics.length).toBeGreaterThan(0);

      const endpointAnalytics = analytics.find(a => 
        a.endpoint === mockEndpoint.path && a.method === mockEndpoint.method
      );
      expect(endpointAnalytics).toBeDefined();
      expect(endpointAnalytics?.totalRequests).toBe(2);
      expect(endpointAnalytics?.successfulRequests).toBe(2);
      expect(endpointAnalytics?.failedRequests).toBe(0);
    });
  });
});