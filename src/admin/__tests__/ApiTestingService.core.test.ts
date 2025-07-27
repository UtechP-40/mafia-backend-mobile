import { ApiTestingService } from '../services/ApiTestingService';

// Mock AdminLog
jest.mock('../models/AdminLog', () => ({
  AdminLog: {
    create: jest.fn().mockResolvedValue({})
  }
}));

describe('ApiTestingService - Core Functionality (No Network)', () => {
  beforeEach(() => {
    // Clear any existing data
    ApiTestingService.clearTestResults();
    
    // Clear internal maps
    (ApiTestingService as any).endpoints.clear();
    (ApiTestingService as any).collections.clear();
    (ApiTestingService as any).mockResponses.clear();
    (ApiTestingService as any).usageAnalytics.clear();
    (ApiTestingService as any).environments.clear();
  });

  describe('Test Collections Management', () => {
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
      expect(collections).toHaveLength(1);
    });

    it('should retrieve collections correctly', () => {
      // Create multiple collections
      const collection1 = ApiTestingService.createCollection({
        name: 'Collection 1',
        endpoints: ['endpoint1']
      });

      const collection2 = ApiTestingService.createCollection({
        name: 'Collection 2',
        endpoints: ['endpoint2']
      });

      const collections = ApiTestingService.getCollections();
      expect(collections).toHaveLength(2);
      expect(collections).toContain(collection1);
      expect(collections).toContain(collection2);
    });
  });

  describe('Mock Response Management', () => {
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
      expect(mocks).toHaveLength(1);
    });

    it('should return active mock response for matching request', () => {
      ApiTestingService.createMockResponse({
        endpoint: '/test-active',
        method: 'GET',
        statusCode: 200,
        responseData: { mocked: true },
        active: true
      });

      const mock = ApiTestingService.getMockResponse('/test-active', 'GET', {});
      expect(mock).toBeDefined();
      expect(mock?.responseData).toEqual({ mocked: true });
    });

    it('should not return inactive mock response', () => {
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
      // Clear any existing mocks first
      (ApiTestingService as any).mockResponses.clear();
      
      ApiTestingService.createMockResponse({
        endpoint: '/test-conditions',
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
      let mock = ApiTestingService.getMockResponse('/test-conditions', 'GET', {
        headers: { Authorization: 'Bearer token' }
      });
      expect(mock).toBeDefined();

      // Should not match when header doesn't exist
      mock = ApiTestingService.getMockResponse('/test-conditions', 'GET', {
        headers: {}
      });
      expect(mock).toBeNull();
    });

    it('should evaluate different condition operators', () => {
      // Clear any existing mocks first
      (ApiTestingService as any).mockResponses.clear();
      
      // Test 'equals' operator
      ApiTestingService.createMockResponse({
        endpoint: '/test-equals',
        method: 'GET',
        statusCode: 200,
        responseData: { type: 'equals' },
        conditions: [
          {
            type: 'header',
            key: 'Content-Type',
            operator: 'equals',
            value: 'application/json'
          }
        ],
        active: true
      });

      let mock = ApiTestingService.getMockResponse('/test-equals', 'GET', {
        headers: { 'Content-Type': 'application/json' }
      });
      expect(mock).toBeDefined();
      expect(mock?.responseData).toEqual({ type: 'equals' });

      mock = ApiTestingService.getMockResponse('/test-equals', 'GET', {
        headers: { 'Content-Type': 'text/html' }
      });
      expect(mock).toBeNull();

      // Test 'contains' operator
      ApiTestingService.createMockResponse({
        endpoint: '/test-contains',
        method: 'GET',
        statusCode: 200,
        responseData: { type: 'contains' },
        conditions: [
          {
            type: 'header',
            key: 'User-Agent',
            operator: 'contains',
            value: 'Chrome'
          }
        ],
        active: true
      });

      mock = ApiTestingService.getMockResponse('/test-contains', 'GET', {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/91.0' }
      });
      expect(mock).toBeDefined();
      expect(mock?.responseData).toEqual({ type: 'contains' });

      mock = ApiTestingService.getMockResponse('/test-contains', 'GET', {
        headers: { 'User-Agent': 'Mozilla/5.0 Firefox/89.0' }
      });
      expect(mock).toBeNull();
    });
  });

  describe('Environment Management', () => {
    it('should manage environment variables', () => {
      const variables = {
        baseUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        timeout: 5000
      };

      ApiTestingService.setEnvironment('test', variables);
      ApiTestingService.setEnvironment('production', {
        baseUrl: 'https://api.example.com',
        apiKey: 'prod-key'
      });

      // Environment should be set (we can't directly test this without exposing internals)
      expect(() => {
        ApiTestingService.setEnvironment('test', variables);
      }).not.toThrow();

      // Test that multiple environments can be set
      expect(() => {
        ApiTestingService.setEnvironment('staging', {
          baseUrl: 'https://staging.example.com'
        });
      }).not.toThrow();
    });
  });

  describe('Endpoint Management', () => {
    it('should manage endpoints manually', () => {
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

      // Manually add endpoint
      (ApiTestingService as any).endpoints.set(mockEndpoint.id, mockEndpoint);

      // Test retrieval
      const endpoint = ApiTestingService.getEndpoint(mockEndpoint.id);
      expect(endpoint).toEqual(mockEndpoint);

      const allEndpoints = ApiTestingService.getAllEndpoints();
      expect(allEndpoints).toContain(mockEndpoint);
      expect(allEndpoints).toHaveLength(1);
    });

    it('should return undefined for non-existent endpoint', () => {
      const endpoint = ApiTestingService.getEndpoint('non-existent');
      expect(endpoint).toBeUndefined();
    });
  });

  describe('Documentation Export', () => {
    beforeEach(() => {
      // Add some mock endpoints for testing
      const mockEndpoints = [
        {
          id: 'GET_users',
          path: '/users',
          method: 'GET',
          description: 'Get all users',
          parameters: [],
          responses: [
            {
              statusCode: 200,
              description: 'Success',
              example: { users: [] }
            }
          ],
          tags: ['users'],
          requiresAuth: true,
          version: '1.0.0'
        },
        {
          id: 'POST_users',
          path: '/users',
          method: 'POST',
          description: 'Create new user',
          parameters: [
            {
              name: 'name',
              type: 'string' as const,
              required: true,
              description: 'User name',
              example: 'John Doe'
            }
          ],
          responses: [
            {
              statusCode: 201,
              description: 'Created',
              example: { id: 1, name: 'John Doe' }
            }
          ],
          tags: ['users'],
          requiresAuth: true,
          version: '1.0.0'
        }
      ];

      mockEndpoints.forEach(endpoint => {
        (ApiTestingService as any).endpoints.set(endpoint.id, endpoint);
      });
    });

    it('should export OpenAPI specification', () => {
      const openApiSpec = ApiTestingService.exportDocumentation('openapi');
      
      expect(openApiSpec).toHaveProperty('openapi', '3.0.0');
      expect(openApiSpec).toHaveProperty('info');
      expect(openApiSpec.info).toHaveProperty('title', 'Mobile Mafia Game API');
      expect(openApiSpec.info).toHaveProperty('version', '1.0.0');
      expect(openApiSpec).toHaveProperty('paths');
      expect(openApiSpec).toHaveProperty('components');
      
      // Check that paths are populated
      expect(Object.keys(openApiSpec.paths)).toContain('/users');
      expect(openApiSpec.paths['/users']).toHaveProperty('get');
      expect(openApiSpec.paths['/users']).toHaveProperty('post');
      
      // Check security scheme
      expect(openApiSpec.components).toHaveProperty('securitySchemes');
      expect(openApiSpec.components.securitySchemes).toHaveProperty('bearerAuth');
    });

    it('should export Postman collection', () => {
      const postmanCollection = ApiTestingService.exportDocumentation('postman');
      
      expect(postmanCollection).toHaveProperty('info');
      expect(postmanCollection.info).toHaveProperty('name', 'Mobile Mafia Game API');
      expect(postmanCollection).toHaveProperty('item');
      expect(postmanCollection).toHaveProperty('variable');
      
      expect(postmanCollection.item).toBeInstanceOf(Array);
      expect(postmanCollection.item.length).toBe(2); // GET and POST users
      
      // Check variables
      expect(postmanCollection.variable).toContainEqual({
        key: 'baseUrl',
        value: 'http://localhost:3000'
      });
      expect(postmanCollection.variable).toContainEqual({
        key: 'token',
        value: ''
      });
    });

    it('should export Insomnia collection', () => {
      const insomniaCollection = ApiTestingService.exportDocumentation('insomnia');
      
      expect(insomniaCollection).toHaveProperty('_type', 'export');
      expect(insomniaCollection).toHaveProperty('__export_format', 4);
      expect(insomniaCollection).toHaveProperty('resources');
      
      expect(insomniaCollection.resources).toBeInstanceOf(Array);
      expect(insomniaCollection.resources.length).toBeGreaterThan(2); // workspace + env + requests
      
      // Check workspace
      const workspace = insomniaCollection.resources.find((r: any) => r._type === 'workspace');
      expect(workspace).toBeDefined();
      expect(workspace.name).toBe('Mobile Mafia Game API');
      
      // Check environment
      const environment = insomniaCollection.resources.find((r: any) => r._type === 'environment');
      expect(environment).toBeDefined();
      expect(environment.data).toHaveProperty('baseUrl', 'http://localhost:3000');
    });

    it('should throw error for unsupported format', () => {
      expect(() => {
        ApiTestingService.exportDocumentation('unsupported' as any);
      }).toThrow('Unsupported format: unsupported');
    });
  });

  describe('Test Results Management', () => {
    it('should manage test results without network calls', () => {
      // Initially no results
      let results = ApiTestingService.getTestResults();
      expect(results).toHaveLength(0);

      // Manually add a test result
      const mockResult = {
        id: 'test-result-1',
        timestamp: new Date(),
        endpoint: '/test',
        method: 'GET',
        statusCode: 200,
        responseTime: 150,
        success: true,
        responseData: { success: true }
      };

      (ApiTestingService as any).testResults.push(mockResult);

      // Get all results
      results = ApiTestingService.getTestResults();
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(mockResult);

      // Test filtering
      results = ApiTestingService.getTestResults({
        endpoint: '/test'
      });
      expect(results).toHaveLength(1);

      results = ApiTestingService.getTestResults({
        endpoint: '/other'
      });
      expect(results).toHaveLength(0);

      results = ApiTestingService.getTestResults({
        method: 'GET'
      });
      expect(results).toHaveLength(1);

      results = ApiTestingService.getTestResults({
        success: true
      });
      expect(results).toHaveLength(1);

      results = ApiTestingService.getTestResults({
        success: false
      });
      expect(results).toHaveLength(0);

      results = ApiTestingService.getTestResults({
        limit: 0
      });
      expect(results).toHaveLength(0);

      // Clear results
      ApiTestingService.clearTestResults();
      results = ApiTestingService.getTestResults();
      expect(results).toHaveLength(0);
    });
  });

  describe('Usage Analytics', () => {
    it('should manage usage analytics without network calls', () => {
      // Initially no analytics
      let analytics = ApiTestingService.getUsageAnalytics();
      expect(analytics).toHaveLength(0);

      // Manually add analytics data
      const mockAnalytics = {
        endpoint: '/test',
        method: 'GET',
        totalRequests: 5,
        successfulRequests: 4,
        failedRequests: 1,
        averageResponseTime: 200,
        minResponseTime: 150,
        maxResponseTime: 300,
        lastAccessed: new Date(),
        errorRate: 20,
        popularityScore: 4
      };

      (ApiTestingService as any).usageAnalytics.set('GET_/test', mockAnalytics);

      // Get analytics
      analytics = ApiTestingService.getUsageAnalytics();
      expect(analytics).toHaveLength(1);
      expect(analytics[0]).toEqual(mockAnalytics);

      // Analytics should be sorted by popularity score
      const mockAnalytics2 = {
        endpoint: '/popular',
        method: 'GET',
        totalRequests: 10,
        successfulRequests: 10,
        failedRequests: 0,
        averageResponseTime: 100,
        minResponseTime: 80,
        maxResponseTime: 120,
        lastAccessed: new Date(),
        errorRate: 0,
        popularityScore: 10
      };

      (ApiTestingService as any).usageAnalytics.set('GET_/popular', mockAnalytics2);

      analytics = ApiTestingService.getUsageAnalytics();
      expect(analytics).toHaveLength(2);
      expect(analytics[0]).toEqual(mockAnalytics2); // Higher popularity score should be first
      expect(analytics[1]).toEqual(mockAnalytics);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-existent endpoint in testEndpoint', async () => {
      await expect(
        ApiTestingService.testEndpoint('non-existent', 'http://localhost:3000')
      ).rejects.toThrow('Endpoint non-existent not found');
    });

    it('should handle invalid collection run', async () => {
      await expect(
        ApiTestingService.runCollection('non-existent', 'http://localhost:3000')
      ).rejects.toThrow('Collection non-existent not found');
    });
  });
});