import express, { Router, Request, Response } from 'express';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { performance } from 'perf_hooks';
import { adminLogger } from '../config/logger';
import { AdminLog } from '../models/AdminLog';

export interface ApiEndpoint {
  id: string;
  path: string;
  method: string;
  description?: string;
  parameters?: ApiParameter[];
  responses?: ApiResponse[];
  tags?: string[];
  requiresAuth?: boolean;
  rateLimit?: RateLimitInfo;
  version?: string;
  deprecated?: boolean;
  lastTested?: Date;
  testResults?: TestResult[];
}

export interface ApiParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  example?: any;
  validation?: ValidationRule[];
}

export interface ApiResponse {
  statusCode: number;
  description: string;
  schema?: any;
  example?: any;
}

export interface RateLimitInfo {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: string;
}

export interface TestResult {
  id: string;
  timestamp: Date;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  success: boolean;
  error?: string;
  requestData?: any;
  responseData?: any;
  performanceMetrics?: PerformanceMetrics;
}

export interface PerformanceMetrics {
  responseTime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  networkLatency?: number;
}

export interface ValidationRule {
  type: 'required' | 'minLength' | 'maxLength' | 'pattern' | 'min' | 'max' | 'email' | 'custom';
  value?: any;
  message?: string;
}

export interface TestCollection {
  id: string;
  name: string;
  description?: string;
  endpoints: string[];
  environment?: string;
  variables?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockResponse {
  id: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseData: any;
  delay?: number;
  conditions?: MockCondition[];
  active: boolean;
}

export interface MockCondition {
  type: 'header' | 'query' | 'body' | 'path';
  key: string;
  operator: 'equals' | 'contains' | 'regex' | 'exists';
  value?: any;
}

export interface ApiUsageAnalytics {
  endpoint: string;
  method: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  lastAccessed: Date;
  errorRate: number;
  popularityScore: number;
}

export class ApiTestingService {
  private static endpoints: Map<string, ApiEndpoint> = new Map();
  private static testResults: TestResult[] = [];
  private static collections: Map<string, TestCollection> = new Map();
  private static mockResponses: Map<string, MockResponse> = new Map();
  private static usageAnalytics: Map<string, ApiUsageAnalytics> = new Map();
  private static environments: Map<string, Record<string, any>> = new Map();

  /**
   * Discover API endpoints from Express app
   */
  static discoverEndpoints(app: express.Application): ApiEndpoint[] {
    const endpoints: ApiEndpoint[] = [];
    const routes = this.extractRoutes(app);

    routes.forEach(route => {
      const endpoint: ApiEndpoint = {
        id: `${route.method.toUpperCase()}_${route.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
        path: route.path,
        method: route.method.toUpperCase(),
        description: this.generateDescription(route.path, route.method),
        parameters: this.inferParameters(route.path),
        responses: this.generateDefaultResponses(),
        tags: this.generateTags(route.path),
        requiresAuth: this.inferAuthRequirement(route.path),
        version: '1.0.0'
      };

      endpoints.push(endpoint);
      this.endpoints.set(endpoint.id, endpoint);
    });

    adminLogger.info(`Discovered ${endpoints.length} API endpoints`);
    return endpoints;
  }

  /**
   * Extract routes from Express app
   */
  private static extractRoutes(app: express.Application): Array<{path: string, method: string}> {
    const routes: Array<{path: string, method: string}> = [];
    
    // Extract routes from app._router
    const router = (app as any)._router;
    if (router && router.stack) {
      this.extractRoutesFromStack(router.stack, '', routes);
    }

    return routes;
  }

  /**
   * Recursively extract routes from router stack
   */
  private static extractRoutesFromStack(stack: any[], basePath: string, routes: Array<{path: string, method: string}>) {
    stack.forEach(layer => {
      if (layer.route) {
        // Direct route
        const path = basePath + layer.route.path;
        Object.keys(layer.route.methods).forEach(method => {
          if (layer.route.methods[method]) {
            routes.push({ path, method: method.toUpperCase() });
          }
        });
      } else if (layer.name === 'router' && layer.handle.stack) {
        // Nested router
        const routerPath = layer.regexp.source
          .replace('\\', '')
          .replace('(?=\\/|$)', '')
          .replace(/\$.*/, '')
          .replace(/\\\//g, '/');
        
        this.extractRoutesFromStack(layer.handle.stack, basePath + routerPath, routes);
      }
    });
  }

  /**
   * Generate description for endpoint
   */
  private static generateDescription(path: string, method: string): string {
    const pathParts = path.split('/').filter(part => part);
    const resource = pathParts[pathParts.length - 1] || 'resource';
    
    switch (method.toUpperCase()) {
      case 'GET':
        return path.includes(':') ? `Get specific ${resource}` : `Get all ${resource}`;
      case 'POST':
        return `Create new ${resource}`;
      case 'PUT':
        return `Update ${resource}`;
      case 'DELETE':
        return `Delete ${resource}`;
      case 'PATCH':
        return `Partially update ${resource}`;
      default:
        return `${method.toUpperCase()} ${resource}`;
    }
  }

  /**
   * Infer parameters from path
   */
  private static inferParameters(path: string): ApiParameter[] {
    const parameters: ApiParameter[] = [];
    const pathParams = path.match(/:(\w+)/g);
    
    if (pathParams) {
      pathParams.forEach(param => {
        const name = param.substring(1);
        parameters.push({
          name,
          type: 'string',
          required: true,
          description: `${name} identifier`,
          example: name === 'id' ? '507f1f77bcf86cd799439011' : `example_${name}`
        });
      });
    }

    return parameters;
  }

  /**
   * Generate default responses
   */
  private static generateDefaultResponses(): ApiResponse[] {
    return [
      {
        statusCode: 200,
        description: 'Success',
        example: { success: true, message: 'Operation completed successfully' }
      },
      {
        statusCode: 400,
        description: 'Bad Request',
        example: { success: false, message: 'Invalid request data' }
      },
      {
        statusCode: 401,
        description: 'Unauthorized',
        example: { success: false, message: 'Authentication required' }
      },
      {
        statusCode: 500,
        description: 'Internal Server Error',
        example: { success: false, message: 'Internal server error' }
      }
    ];
  }

  /**
   * Generate tags for endpoint
   */
  private static generateTags(path: string): string[] {
    const tags: string[] = [];
    const pathParts = path.split('/').filter(part => part && !part.startsWith(':'));
    
    if (pathParts.length > 0) {
      tags.push(pathParts[0]);
    }
    
    if (path.includes('/admin/')) {
      tags.push('admin');
    }
    
    return tags;
  }

  /**
   * Infer if endpoint requires authentication
   */
  private static inferAuthRequirement(path: string): boolean {
    const authPaths = ['/auth/login', '/auth/register', '/health'];
    return !authPaths.some(authPath => path.includes(authPath));
  }

  /**
   * Test API endpoint
   */
  static async testEndpoint(
    endpointId: string, 
    baseUrl: string, 
    options: {
      headers?: Record<string, string>;
      data?: any;
      timeout?: number;
      environment?: string;
    } = {}
  ): Promise<TestResult> {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint ${endpointId} not found`);
    }

    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    const startCpu = process.cpuUsage();

    const testResult: TestResult = {
      id: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      endpoint: endpoint.path,
      method: endpoint.method,
      statusCode: 0,
      responseTime: 0,
      success: false,
      requestData: options.data
    };

    try {
      const url = `${baseUrl}${endpoint.path}`;
      const config = {
        method: endpoint.method.toLowerCase(),
        url,
        headers: options.headers || {},
        data: options.data,
        timeout: options.timeout || 10000,
        validateStatus: () => true // Don't throw on any status code
      };

      const response: AxiosResponse = await axios(config);
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);

      testResult.statusCode = response.status;
      testResult.responseTime = endTime - startTime;
      testResult.success = response.status >= 200 && response.status < 400;
      testResult.responseData = response.data;
      testResult.performanceMetrics = {
        responseTime: testResult.responseTime,
        memoryUsage: {
          rss: endMemory.rss - startMemory.rss,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external,
          arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers
        },
        cpuUsage: endCpu
      };

      // Update usage analytics
      this.updateUsageAnalytics(endpoint.path, endpoint.method, testResult);

    } catch (error) {
      const endTime = performance.now();
      testResult.responseTime = endTime - startTime;
      testResult.error = error instanceof Error ? error.message : 'Unknown error';
      
      if (axios.isAxiosError(error)) {
        testResult.statusCode = error.response?.status || 0;
        testResult.responseData = error.response?.data;
      }
    }

    // Store test result
    this.testResults.push(testResult);
    
    // Update endpoint with last tested time
    endpoint.lastTested = new Date();
    if (!endpoint.testResults) {
      endpoint.testResults = [];
    }
    endpoint.testResults.push(testResult);

    // Log test result
    await AdminLog.create({
      userId: 'system',
      action: 'api_test',
      resource: 'endpoint',
      resourceId: endpointId,
      details: {
        endpoint: endpoint.path,
        method: endpoint.method,
        success: testResult.success,
        responseTime: testResult.responseTime,
        statusCode: testResult.statusCode
      },
      ipAddress: 'localhost',
      userAgent: 'ApiTestingService'
    });

    adminLogger.info('API endpoint tested', {
      endpoint: endpoint.path,
      method: endpoint.method,
      success: testResult.success,
      responseTime: testResult.responseTime,
      statusCode: testResult.statusCode
    });

    return testResult;
  }

  /**
   * Update usage analytics
   */
  private static updateUsageAnalytics(path: string, method: string, testResult: TestResult) {
    const key = `${method}_${path}`;
    const existing = this.usageAnalytics.get(key);

    if (existing) {
      existing.totalRequests++;
      if (testResult.success) {
        existing.successfulRequests++;
      } else {
        existing.failedRequests++;
      }
      existing.averageResponseTime = (existing.averageResponseTime + testResult.responseTime) / 2;
      existing.minResponseTime = Math.min(existing.minResponseTime, testResult.responseTime);
      existing.maxResponseTime = Math.max(existing.maxResponseTime, testResult.responseTime);
      existing.lastAccessed = new Date();
      existing.errorRate = (existing.failedRequests / existing.totalRequests) * 100;
      existing.popularityScore = existing.totalRequests * (existing.successfulRequests / existing.totalRequests);
    } else {
      this.usageAnalytics.set(key, {
        endpoint: path,
        method,
        totalRequests: 1,
        successfulRequests: testResult.success ? 1 : 0,
        failedRequests: testResult.success ? 0 : 1,
        averageResponseTime: testResult.responseTime,
        minResponseTime: testResult.responseTime,
        maxResponseTime: testResult.responseTime,
        lastAccessed: new Date(),
        errorRate: testResult.success ? 0 : 100,
        popularityScore: testResult.success ? 1 : 0
      });
    }
  }

  /**
   * Run performance benchmark
   */
  static async benchmarkEndpoint(
    endpointId: string,
    baseUrl: string,
    options: {
      concurrency?: number;
      duration?: number;
      requests?: number;
      headers?: Record<string, string>;
      data?: any;
    } = {}
  ): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    requestsPerSecond: number;
    errorRate: number;
    results: TestResult[];
  }> {
    const {
      concurrency = 10,
      duration = 30000, // 30 seconds
      requests = 100,
      headers,
      data
    } = options;

    const results: TestResult[] = [];
    const startTime = Date.now();
    let requestCount = 0;

    const runTest = async (): Promise<TestResult> => {
      return this.testEndpoint(endpointId, baseUrl, { headers, data });
    };

    // Run concurrent requests
    const promises: Promise<TestResult>[] = [];
    
    while (requestCount < requests && (Date.now() - startTime) < duration) {
      for (let i = 0; i < concurrency && requestCount < requests; i++) {
        promises.push(runTest());
        requestCount++;
      }

      const batchResults = await Promise.allSettled(promises);
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      });

      promises.length = 0; // Clear array
    }

    // Calculate statistics
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = results.length - successfulRequests;
    const responseTimes = results.map(r => r.responseTime);
    const totalTime = Date.now() - startTime;

    return {
      totalRequests: results.length,
      successfulRequests,
      failedRequests,
      averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      requestsPerSecond: (results.length / totalTime) * 1000,
      errorRate: (failedRequests / results.length) * 100,
      results
    };
  }

  /**
   * Create test collection
   */
  static createCollection(collection: Omit<TestCollection, 'id' | 'createdAt' | 'updatedAt'>): TestCollection {
    const newCollection: TestCollection = {
      ...collection,
      id: `collection_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.collections.set(newCollection.id, newCollection);
    return newCollection;
  }

  /**
   * Run test collection
   */
  static async runCollection(
    collectionId: string,
    baseUrl: string,
    options: {
      environment?: string;
      parallel?: boolean;
    } = {}
  ): Promise<TestResult[]> {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new Error(`Collection ${collectionId} not found`);
    }

    const environment = this.environments.get(options.environment || 'default') || {};
    const results: TestResult[] = [];

    if (options.parallel) {
      // Run tests in parallel
      const promises = collection.endpoints.map(endpointId =>
        this.testEndpoint(endpointId, baseUrl, { environment: options.environment })
      );
      
      const settledResults = await Promise.allSettled(promises);
      settledResults.forEach(result => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      });
    } else {
      // Run tests sequentially
      for (const endpointId of collection.endpoints) {
        try {
          const result = await this.testEndpoint(endpointId, baseUrl, { environment: options.environment });
          results.push(result);
        } catch (error) {
          adminLogger.error('Failed to test endpoint in collection', {
            collectionId,
            endpointId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    return results;
  }

  /**
   * Create mock response
   */
  static createMockResponse(mock: Omit<MockResponse, 'id'>): MockResponse {
    const newMock: MockResponse = {
      ...mock,
      id: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    this.mockResponses.set(newMock.id, newMock);
    return newMock;
  }

  /**
   * Get mock response for request
   */
  static getMockResponse(endpoint: string, method: string, request: any): MockResponse | null {
    for (const mock of this.mockResponses.values()) {
      if (mock.endpoint === endpoint && mock.method === method && mock.active) {
        // Check conditions
        if (mock.conditions && mock.conditions.length > 0) {
          const conditionsMet = mock.conditions.every(condition => {
            return this.evaluateCondition(condition, request);
          });
          
          if (!conditionsMet) {
            continue;
          }
        }
        
        return mock;
      }
    }
    
    return null;
  }

  /**
   * Evaluate mock condition
   */
  private static evaluateCondition(condition: MockCondition, request: any): boolean {
    let value: any;
    
    switch (condition.type) {
      case 'header':
        value = request.headers?.[condition.key];
        break;
      case 'query':
        value = request.query?.[condition.key];
        break;
      case 'body':
        value = request.body?.[condition.key];
        break;
      case 'path':
        value = request.params?.[condition.key];
        break;
      default:
        return false;
    }

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'contains':
        return typeof value === 'string' && value.includes(condition.value);
      case 'regex':
        return typeof value === 'string' && new RegExp(condition.value).test(value);
      case 'exists':
        return value !== undefined && value !== null;
      default:
        return false;
    }
  }

  /**
   * Set environment variables
   */
  static setEnvironment(name: string, variables: Record<string, any>) {
    this.environments.set(name, variables);
  }

  /**
   * Get all endpoints
   */
  static getAllEndpoints(): ApiEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Get endpoint by ID
   */
  static getEndpoint(id: string): ApiEndpoint | undefined {
    return this.endpoints.get(id);
  }

  /**
   * Get test results
   */
  static getTestResults(filters?: {
    endpoint?: string;
    method?: string;
    success?: boolean;
    limit?: number;
  }): TestResult[] {
    let results = [...this.testResults];

    if (filters) {
      if (filters.endpoint) {
        results = results.filter(r => r.endpoint.includes(filters.endpoint!));
      }
      if (filters.method) {
        results = results.filter(r => r.method === filters.method);
      }
      if (filters.success !== undefined) {
        results = results.filter(r => r.success === filters.success);
      }
      if (filters.limit !== undefined && filters.limit >= 0) {
        results = results.slice(0, filters.limit);
      }
    }

    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get usage analytics
   */
  static getUsageAnalytics(): ApiUsageAnalytics[] {
    return Array.from(this.usageAnalytics.values())
      .sort((a, b) => b.popularityScore - a.popularityScore);
  }

  /**
   * Get collections
   */
  static getCollections(): TestCollection[] {
    return Array.from(this.collections.values());
  }

  /**
   * Get mock responses
   */
  static getMockResponses(): MockResponse[] {
    return Array.from(this.mockResponses.values());
  }

  /**
   * Clear test results
   */
  static clearTestResults() {
    this.testResults = [];
    this.endpoints.forEach(endpoint => {
      endpoint.testResults = [];
    });
  }

  /**
   * Export API documentation
   */
  static exportDocumentation(format: 'openapi' | 'postman' | 'insomnia'): any {
    const endpoints = this.getAllEndpoints();

    switch (format) {
      case 'openapi':
        return this.generateOpenApiSpec(endpoints);
      case 'postman':
        return this.generatePostmanCollection(endpoints);
      case 'insomnia':
        return this.generateInsomniaCollection(endpoints);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Generate OpenAPI specification
   */
  private static generateOpenApiSpec(endpoints: ApiEndpoint[]): any {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: 'Mobile Mafia Game API',
        version: '1.0.0',
        description: 'API documentation for Mobile Mafia Game'
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server'
        }
      ],
      paths: {} as any,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      }
    };

    endpoints.forEach(endpoint => {
      if (!spec.paths[endpoint.path]) {
        spec.paths[endpoint.path] = {};
      }

      spec.paths[endpoint.path][endpoint.method.toLowerCase()] = {
        summary: endpoint.description,
        tags: endpoint.tags,
        parameters: endpoint.parameters?.map(param => ({
          name: param.name,
          in: param.name.startsWith(':') ? 'path' : 'query',
          required: param.required,
          description: param.description,
          schema: {
            type: param.type
          },
          example: param.example
        })),
        responses: endpoint.responses?.reduce((acc, response) => {
          acc[response.statusCode] = {
            description: response.description,
            content: {
              'application/json': {
                example: response.example
              }
            }
          };
          return acc;
        }, {} as any),
        security: endpoint.requiresAuth ? [{ bearerAuth: [] }] : undefined
      };
    });

    return spec;
  }

  /**
   * Generate Postman collection
   */
  private static generatePostmanCollection(endpoints: ApiEndpoint[]): any {
    return {
      info: {
        name: 'Mobile Mafia Game API',
        description: 'API collection for Mobile Mafia Game',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
      },
      item: endpoints.map(endpoint => ({
        name: `${endpoint.method} ${endpoint.path}`,
        request: {
          method: endpoint.method,
          header: endpoint.requiresAuth ? [
            {
              key: 'Authorization',
              value: 'Bearer {{token}}',
              type: 'text'
            }
          ] : [],
          url: {
            raw: `{{baseUrl}}${endpoint.path}`,
            host: ['{{baseUrl}}'],
            path: endpoint.path.split('/').filter(p => p)
          },
          description: endpoint.description
        }
      })),
      variable: [
        {
          key: 'baseUrl',
          value: 'http://localhost:3000'
        },
        {
          key: 'token',
          value: ''
        }
      ]
    };
  }

  /**
   * Generate Insomnia collection
   */
  private static generateInsomniaCollection(endpoints: ApiEndpoint[]): any {
    return {
      _type: 'export',
      __export_format: 4,
      __export_date: new Date().toISOString(),
      __export_source: 'insomnia.desktop.app:v2023.5.8',
      resources: [
        {
          _id: 'wrk_base',
          _type: 'workspace',
          name: 'Mobile Mafia Game API',
          description: 'API workspace for Mobile Mafia Game'
        },
        {
          _id: 'env_base',
          _type: 'environment',
          name: 'Base Environment',
          data: {
            baseUrl: 'http://localhost:3000',
            token: ''
          }
        },
        ...endpoints.map((endpoint, index) => ({
          _id: `req_${index}`,
          _type: 'request',
          name: `${endpoint.method} ${endpoint.path}`,
          method: endpoint.method,
          url: `{{ _.baseUrl }}${endpoint.path}`,
          headers: endpoint.requiresAuth ? [
            {
              name: 'Authorization',
              value: 'Bearer {{ _.token }}'
            }
          ] : [],
          description: endpoint.description,
          parentId: 'wrk_base'
        }))
      ]
    };
  }
}