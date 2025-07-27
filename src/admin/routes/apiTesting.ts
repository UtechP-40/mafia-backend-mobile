import { Router, Request, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { Permission } from '../models/SuperUser';
import { ApiTestingService } from '../services/ApiTestingService';
import { adminLogger } from '../config/logger';
// Note: We'll import the apps dynamically to avoid circular dependencies

const router = Router();

/**
 * GET /admin/api/api-testing/discover
 * Discover all API endpoints from the application
 */
router.get('/discover',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('API endpoint discovery initiated', {
      userId: adminUser.id,
      username: adminUser.username
    });

    try {
      // Import apps dynamically to avoid circular dependencies
      const { app: mainApp } = await import('../../index');
      const adminApp = await import('../server');
      
      // Discover endpoints from main app
      const mainEndpoints = ApiTestingService.discoverEndpoints(mainApp);
      
      // Discover endpoints from admin app
      const adminEndpoints = ApiTestingService.discoverEndpoints(adminApp.default);
      
      const allEndpoints = [...mainEndpoints, ...adminEndpoints];

      res.json({
        success: true,
        message: 'API endpoints discovered successfully',
        data: {
          endpoints: allEndpoints,
          total: allEndpoints.length,
          mainAppEndpoints: mainEndpoints.length,
          adminAppEndpoints: adminEndpoints.length
        }
      });
    } catch (error) {
      adminLogger.error('API endpoint discovery failed', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to discover API endpoints',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/api-testing/endpoints
 * Get all discovered endpoints
 */
router.get('/endpoints',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { tag, method, search } = req.query;
    
    let endpoints = ApiTestingService.getAllEndpoints();
    
    // Apply filters
    if (tag) {
      endpoints = endpoints.filter(e => e.tags?.includes(tag as string));
    }
    
    if (method) {
      endpoints = endpoints.filter(e => e.method === (method as string).toUpperCase());
    }
    
    if (search) {
      const searchTerm = (search as string).toLowerCase();
      endpoints = endpoints.filter(e => 
        e.path.toLowerCase().includes(searchTerm) ||
        e.description?.toLowerCase().includes(searchTerm)
      );
    }

    res.json({
      success: true,
      data: {
        endpoints,
        total: endpoints.length
      }
    });
  })
);

/**
 * GET /admin/api/api-testing/endpoints/:id
 * Get specific endpoint details
 */
router.get('/endpoints/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const endpoint = ApiTestingService.getEndpoint(id);
    
    if (!endpoint) {
      return res.status(404).json({
        success: false,
        message: 'Endpoint not found'
      });
    }

    res.json({
      success: true,
      data: { endpoint }
    });
  })
);

/**
 * POST /admin/api/api-testing/test/:id
 * Test a specific endpoint
 */
router.post('/test/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { baseUrl, headers, data, timeout, environment } = req.body;
    const adminUser = req.adminUser;
    
    adminLogger.info('API endpoint test initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      endpointId: id,
      baseUrl
    });

    try {
      const testResult = await ApiTestingService.testEndpoint(id, baseUrl || 'http://localhost:3000', {
        headers,
        data,
        timeout,
        environment
      });

      res.json({
        success: true,
        message: 'Endpoint tested successfully',
        data: { testResult }
      });
    } catch (error) {
      adminLogger.error('API endpoint test failed', {
        userId: adminUser.id,
        endpointId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to test endpoint',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/api-testing/benchmark/:id
 * Run performance benchmark on endpoint
 */
router.post('/benchmark/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { baseUrl, concurrency, duration, requests, headers, data } = req.body;
    const adminUser = req.adminUser;
    
    adminLogger.info('API endpoint benchmark initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      endpointId: id,
      concurrency,
      duration,
      requests
    });

    try {
      const benchmarkResult = await ApiTestingService.benchmarkEndpoint(id, baseUrl || 'http://localhost:3000', {
        concurrency,
        duration,
        requests,
        headers,
        data
      });

      res.json({
        success: true,
        message: 'Endpoint benchmark completed successfully',
        data: { benchmarkResult }
      });
    } catch (error) {
      adminLogger.error('API endpoint benchmark failed', {
        userId: adminUser.id,
        endpointId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to benchmark endpoint',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/api-testing/results
 * Get test results with filtering
 */
router.get('/results',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { endpoint, method, success, limit } = req.query;
    
    const filters = {
      endpoint: endpoint as string,
      method: method as string,
      success: success === 'true' ? true : success === 'false' ? false : undefined,
      limit: limit ? parseInt(limit as string) : undefined
    };

    const results = ApiTestingService.getTestResults(filters);

    res.json({
      success: true,
      data: {
        results,
        total: results.length
      }
    });
  })
);

/**
 * DELETE /admin/api/api-testing/results
 * Clear test results
 */
router.delete('/results',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('API test results cleared', {
      userId: adminUser.id,
      username: adminUser.username
    });

    ApiTestingService.clearTestResults();

    res.json({
      success: true,
      message: 'Test results cleared successfully'
    });
  })
);

/**
 * GET /admin/api/api-testing/analytics
 * Get API usage analytics
 */
router.get('/analytics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const analytics = ApiTestingService.getUsageAnalytics();

    res.json({
      success: true,
      data: {
        analytics,
        total: analytics.length
      }
    });
  })
);

/**
 * POST /admin/api/api-testing/collections
 * Create a test collection
 */
router.post('/collections',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name, description, endpoints, environment, variables } = req.body;
    const adminUser = req.adminUser;
    
    if (!name || !endpoints || !Array.isArray(endpoints)) {
      return res.status(400).json({
        success: false,
        message: 'Name and endpoints array are required'
      });
    }

    adminLogger.info('API test collection created', {
      userId: adminUser.id,
      username: adminUser.username,
      collectionName: name,
      endpointCount: endpoints.length
    });

    const collection = ApiTestingService.createCollection({
      name,
      description,
      endpoints,
      environment,
      variables
    });

    res.status(201).json({
      success: true,
      message: 'Test collection created successfully',
      data: { collection }
    });
  })
);

/**
 * GET /admin/api/api-testing/collections
 * Get all test collections
 */
router.get('/collections',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const collections = ApiTestingService.getCollections();

    res.json({
      success: true,
      data: {
        collections,
        total: collections.length
      }
    });
  })
);

/**
 * POST /admin/api/api-testing/collections/:id/run
 * Run a test collection
 */
router.post('/collections/:id/run',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { baseUrl, environment, parallel } = req.body;
    const adminUser = req.adminUser;
    
    adminLogger.info('API test collection run initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      collectionId: id,
      parallel: parallel || false
    });

    try {
      const results = await ApiTestingService.runCollection(id, baseUrl || 'http://localhost:3000', {
        environment,
        parallel
      });

      res.json({
        success: true,
        message: 'Test collection completed successfully',
        data: {
          results,
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });
    } catch (error) {
      adminLogger.error('API test collection run failed', {
        userId: adminUser.id,
        collectionId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to run test collection',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/api-testing/mocks
 * Create a mock response
 */
router.post('/mocks',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { endpoint, method, statusCode, responseData, delay, conditions, active } = req.body;
    const adminUser = req.adminUser;
    
    if (!endpoint || !method || !statusCode || !responseData) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint, method, statusCode, and responseData are required'
      });
    }

    adminLogger.info('API mock response created', {
      userId: adminUser.id,
      username: adminUser.username,
      endpoint,
      method,
      statusCode
    });

    const mock = ApiTestingService.createMockResponse({
      endpoint,
      method,
      statusCode,
      responseData,
      delay,
      conditions,
      active: active !== false
    });

    res.status(201).json({
      success: true,
      message: 'Mock response created successfully',
      data: { mock }
    });
  })
);

/**
 * GET /admin/api/api-testing/mocks
 * Get all mock responses
 */
router.get('/mocks',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const mocks = ApiTestingService.getMockResponses();

    res.json({
      success: true,
      data: {
        mocks,
        total: mocks.length
      }
    });
  })
);

/**
 * POST /admin/api/api-testing/environments
 * Set environment variables
 */
router.post('/environments',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name, variables } = req.body;
    const adminUser = req.adminUser;
    
    if (!name || !variables) {
      return res.status(400).json({
        success: false,
        message: 'Name and variables are required'
      });
    }

    adminLogger.info('API testing environment created', {
      userId: adminUser.id,
      username: adminUser.username,
      environmentName: name,
      variableCount: Object.keys(variables).length
    });

    ApiTestingService.setEnvironment(name, variables);

    res.json({
      success: true,
      message: 'Environment variables set successfully'
    });
  })
);

/**
 * GET /admin/api/api-testing/export/:format
 * Export API documentation
 */
router.get('/export/:format',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { format } = req.params;
    const adminUser = req.adminUser;
    
    if (!['openapi', 'postman', 'insomnia'].includes(format)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported format. Use: openapi, postman, or insomnia'
      });
    }

    adminLogger.info('API documentation exported', {
      userId: adminUser.id,
      username: adminUser.username,
      format
    });

    try {
      const documentation = ApiTestingService.exportDocumentation(format as 'openapi' | 'postman' | 'insomnia');
      
      // Set appropriate content type and filename
      let contentType = 'application/json';
      let filename = `api-documentation.${format}.json`;
      
      if (format === 'openapi') {
        filename = 'openapi-spec.json';
      } else if (format === 'postman') {
        filename = 'postman-collection.json';
      } else if (format === 'insomnia') {
        filename = 'insomnia-collection.json';
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(documentation);
    } catch (error) {
      adminLogger.error('API documentation export failed', {
        userId: adminUser.id,
        format,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to export documentation',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/api-testing/security-scan/:id
 * Run security scan on endpoint
 */
router.post('/security-scan/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { baseUrl } = req.body;
    const adminUser = req.adminUser;
    
    adminLogger.info('API security scan initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      endpointId: id
    });

    try {
      const endpoint = ApiTestingService.getEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({
          success: false,
          message: 'Endpoint not found'
        });
      }

      // Run basic security tests
      const securityTests = [
        // SQL Injection test
        {
          name: 'SQL Injection',
          payload: "'; DROP TABLE users; --",
          type: 'injection'
        },
        // XSS test
        {
          name: 'Cross-Site Scripting',
          payload: '<script>alert("XSS")</script>',
          type: 'xss'
        },
        // Command Injection test
        {
          name: 'Command Injection',
          payload: '; cat /etc/passwd',
          type: 'command'
        },
        // Path Traversal test
        {
          name: 'Path Traversal',
          payload: '../../../etc/passwd',
          type: 'traversal'
        }
      ];

      const results = [];
      
      for (const test of securityTests) {
        try {
          const testResult = await ApiTestingService.testEndpoint(id, baseUrl || 'http://localhost:3000', {
            data: { maliciousInput: test.payload }
          });
          
          results.push({
            test: test.name,
            type: test.type,
            payload: test.payload,
            statusCode: testResult.statusCode,
            responseTime: testResult.responseTime,
            vulnerable: testResult.statusCode === 200 && 
                       testResult.responseData && 
                       JSON.stringify(testResult.responseData).includes(test.payload),
            details: testResult
          });
        } catch (error) {
          results.push({
            test: test.name,
            type: test.type,
            payload: test.payload,
            error: error instanceof Error ? error.message : 'Unknown error',
            vulnerable: false
          });
        }
      }

      const vulnerabilities = results.filter(r => r.vulnerable);
      
      res.json({
        success: true,
        message: 'Security scan completed',
        data: {
          endpoint: endpoint.path,
          method: endpoint.method,
          testsRun: results.length,
          vulnerabilities: vulnerabilities.length,
          results,
          summary: {
            safe: vulnerabilities.length === 0,
            riskLevel: vulnerabilities.length === 0 ? 'low' : 
                      vulnerabilities.length <= 2 ? 'medium' : 'high'
          }
        }
      });
    } catch (error) {
      adminLogger.error('API security scan failed', {
        userId: adminUser.id,
        endpointId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to run security scan',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

export default router;