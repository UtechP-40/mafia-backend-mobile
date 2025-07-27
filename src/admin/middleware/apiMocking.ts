import { Request, Response, NextFunction } from 'express';
import { ApiTestingService } from '../services/ApiTestingService';
import { adminLogger } from '../config/logger';

/**
 * Middleware to intercept requests and return mock responses if available
 */
export const apiMockingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip mocking for admin routes
  if (req.path.startsWith('/admin/')) {
    return next();
  }

  try {
    const mock = ApiTestingService.getMockResponse(req.path, req.method, {
      headers: req.headers,
      query: req.query,
      body: req.body,
      params: req.params
    });

    if (mock) {
      adminLogger.info('Mock response served', {
        endpoint: req.path,
        method: req.method,
        mockId: mock.id,
        statusCode: mock.statusCode
      });

      // Apply delay if specified
      if (mock.delay && mock.delay > 0) {
        setTimeout(() => {
          res.status(mock.statusCode).json(mock.responseData);
        }, mock.delay);
      } else {
        res.status(mock.statusCode).json(mock.responseData);
      }
      
      return;
    }

    // No mock found, continue to actual endpoint
    next();
  } catch (error) {
    adminLogger.error('Error in API mocking middleware', {
      endpoint: req.path,
      method: req.method,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    // Continue to actual endpoint on error
    next();
  }
};

/**
 * Middleware to enable/disable API mocking
 */
export const createApiMockingMiddleware = (enabled: boolean = true) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      return next();
    }
    
    return apiMockingMiddleware(req, res, next);
  };
};

/**
 * Middleware to log API requests for testing purposes
 */
export const apiRequestLoggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Capture original res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const responseTime = Date.now() - startTime;
    
    adminLogger.info('API request logged', {
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode,
      responseTime,
      requestHeaders: req.headers,
      requestBody: req.body,
      responseBody: body,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    return originalJson.call(this, body);
  };
  
  next();
};

/**
 * Middleware to validate API requests against endpoint schemas
 */
export const apiValidationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoint = ApiTestingService.getEndpoint(`${req.method.toUpperCase()}_${req.path.replace(/[^a-zA-Z0-9]/g, '_')}`);
    
    if (endpoint && endpoint.parameters) {
      const errors: string[] = [];
      
      // Validate required parameters
      endpoint.parameters.forEach(param => {
        if (param.required) {
          let value: any;
          
          if (param.name.startsWith(':')) {
            // Path parameter
            const paramName = param.name.substring(1);
            value = req.params[paramName];
          } else {
            // Query parameter or body parameter
            value = req.query[param.name] || req.body?.[param.name];
          }
          
          if (value === undefined || value === null || value === '') {
            errors.push(`Required parameter '${param.name}' is missing`);
          } else {
            // Type validation
            if (param.type === 'number' && isNaN(Number(value))) {
              errors.push(`Parameter '${param.name}' must be a number`);
            } else if (param.type === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
              errors.push(`Parameter '${param.name}' must be a boolean`);
            }
          }
        }
      });
      
      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors
        });
      }
    }
    
    next();
  } catch (error) {
    adminLogger.error('Error in API validation middleware', {
      endpoint: req.path,
      method: req.method,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    // Continue on validation error
    next();
  }
};

/**
 * Middleware to add API testing headers
 */
export const apiTestingHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Add testing-related headers
  res.setHeader('X-API-Testing-Enabled', 'true');
  res.setHeader('X-API-Testing-Timestamp', new Date().toISOString());
  res.setHeader('X-API-Testing-Request-ID', `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  
  next();
};

/**
 * Middleware to collect API performance metrics
 */
export const apiPerformanceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();
  
  // Capture original res.end to measure performance
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    
    const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    const memoryDelta = {
      rss: endMemory.rss - startMemory.rss,
      heapTotal: endMemory.heapTotal - startMemory.heapTotal,
      heapUsed: endMemory.heapUsed - startMemory.heapUsed,
      external: endMemory.external - startMemory.external,
      arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers
    };
    
    // Add performance headers
    res.setHeader('X-Response-Time', `${responseTime.toFixed(2)}ms`);
    res.setHeader('X-Memory-Usage', JSON.stringify(memoryDelta));
    
    adminLogger.debug('API performance metrics', {
      endpoint: req.path,
      method: req.method,
      responseTime,
      memoryDelta,
      statusCode: res.statusCode
    });
    
    return originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

/**
 * Middleware to handle API versioning for testing
 */
export const apiVersioningMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const version = req.headers['api-version'] || req.query.version || '1.0.0';
  
  // Add version to request for use in endpoints
  (req as any).apiVersion = version;
  
  // Add version header to response
  res.setHeader('X-API-Version', version);
  
  next();
};

/**
 * Middleware to enable CORS for API testing
 */
export const apiTestingCorsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Allow all origins for testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, api-version');
  res.setHeader('Access-Control-Expose-Headers', 'X-Response-Time, X-Memory-Usage, X-API-Version, X-API-Testing-Request-ID');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};

/**
 * Comprehensive API testing middleware that combines all testing features
 */
export const createComprehensiveApiTestingMiddleware = (options: {
  mockingEnabled?: boolean;
  loggingEnabled?: boolean;
  validationEnabled?: boolean;
  performanceEnabled?: boolean;
  corsEnabled?: boolean;
} = {}) => {
  const {
    mockingEnabled = true,
    loggingEnabled = true,
    validationEnabled = true,
    performanceEnabled = true,
    corsEnabled = true
  } = options;
  
  return [
    corsEnabled ? apiTestingCorsMiddleware : null,
    apiVersioningMiddleware,
    apiTestingHeadersMiddleware,
    performanceEnabled ? apiPerformanceMiddleware : null,
    loggingEnabled ? apiRequestLoggingMiddleware : null,
    validationEnabled ? apiValidationMiddleware : null,
    mockingEnabled ? createApiMockingMiddleware(true) : null
  ].filter(Boolean) as Array<(req: Request, res: Response, next: NextFunction) => void>;
};