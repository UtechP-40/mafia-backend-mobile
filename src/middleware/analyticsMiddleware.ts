import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { analyticsService } from '../services';
import { EventType, MetricType } from '../models';

// Extend Request interface to include analytics tracking
declare global {
  namespace Express {
    interface Request {
      trackEvent?: (eventType: EventType, properties?: Record<string, any>) => Promise<void>;
      recordMetric?: (metricName: string, value: number, tags?: Record<string, string>) => Promise<void>;
      logError?: (error: Error, context?: Record<string, any>) => Promise<void>;
    }
  }
}

/**
 * Middleware to add analytics tracking methods to request object
 */
export const analyticsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Add trackEvent method to request
  req.trackEvent = async (eventType: EventType, properties: Record<string, any> = {}) => {
    try {
      await analyticsService.trackEvent({
        eventType,
        userId: req.user?.id ? new Types.ObjectId(req.user.id) : undefined,
        sessionId: req.sessionID,
        properties: {
          ...properties,
          endpoint: req.path,
          method: req.method,
          statusCode: res.statusCode
        },
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip,
        platform: req.get('X-Platform'),
        version: req.get('X-App-Version')
      });
    } catch (error) {
      console.error('Failed to track event:', error);
      // Don't throw error to avoid breaking the main request flow
    }
  };

  // Add recordMetric method to request
  req.recordMetric = async (metricName: string, value: number, tags: Record<string, string> = {}) => {
    try {
      await analyticsService.recordMetric({
        metricName,
        metricType: MetricType.GAUGE, // Default to gauge, can be overridden
        value,
        tags: {
          ...tags,
          endpoint: req.path,
          method: req.method,
          userId: req.user?.id || 'anonymous'
        },
        source: 'api'
      });
    } catch (error) {
      console.error('Failed to record metric:', error);
    }
  };

  // Add logError method to request
  req.logError = async (error: Error, context: Record<string, any> = {}) => {
    try {
      await analyticsService.logError({
        errorType: error.name || 'UnknownError',
        message: error.message,
        stack: error.stack,
        userId: req.user?.id ? new Types.ObjectId(req.user.id) : undefined,
        sessionId: req.sessionID,
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode,
        userAgent: req.get('User-Agent'),
        severity: context.severity || 'medium'
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
  };

  next();
};

/**
 * Middleware to automatically track API requests
 */
export const requestTrackingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  // Track request start
  const trackRequest = async () => {
    try {
      // Determine event type based on endpoint
      let eventType: EventType = EventType.PERFORMANCE_METRIC;
      
      if (req.path.includes('/auth/login')) {
        eventType = EventType.USER_LOGIN;
      } else if (req.path.includes('/auth/logout')) {
        eventType = EventType.USER_LOGOUT;
      } else if (req.path.includes('/auth/register')) {
        eventType = EventType.USER_REGISTER;
      } else if (req.path.includes('/games') && req.method === 'POST') {
        eventType = EventType.GAME_START;
      } else if (req.path.includes('/rooms') && req.method === 'POST') {
        eventType = EventType.ROOM_CREATE;
      }

      // Track the event if it's not a performance metric
      if (eventType !== EventType.PERFORMANCE_METRIC && req.trackEvent) {
        await req.trackEvent(eventType, {
          endpoint: req.path,
          method: req.method
        });
      }
    } catch (error) {
      console.error('Failed to track request:', error);
    }
  };

  // Override res.end to track response metrics
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any): any {
    const responseTime = Date.now() - startTime;

    // Track response time metric
    if (req.recordMetric) {
      req.recordMetric('api_response_time', responseTime, {
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode.toString()
      }).catch(error => console.error('Failed to record response time:', error));
    }

    // Track error events for 4xx and 5xx responses
    if (res.statusCode >= 400 && req.trackEvent) {
      const eventType = res.statusCode >= 500 ? EventType.ERROR_OCCURRED : EventType.PERFORMANCE_METRIC;
      req.trackEvent(eventType, {
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode,
        responseTime
      }).catch(error => console.error('Failed to track error event:', error));
    }

    // Call original end method
    return originalEnd.call(this, chunk, encoding);
  };

  // Track the request
  trackRequest();

  next();
};

/**
 * Middleware to track performance metrics
 */
export const performanceTrackingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();

  // Override res.end to capture performance metrics
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any): any {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    
    const responseTimeNs = Number(endTime - startTime);
    const responseTimeMs = responseTimeNs / 1000000; // Convert to milliseconds
    
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;

    // Record performance metrics
    if (req.recordMetric) {
      const tags = {
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode.toString()
      };

      Promise.all([
        req.recordMetric('http_request_duration_ms', responseTimeMs, tags),
        req.recordMetric('http_request_memory_delta_bytes', memoryDelta, tags),
        req.recordMetric('http_requests_total', 1, tags)
      ]).catch(error => console.error('Failed to record performance metrics:', error));
    }

    // Call original end method
    return originalEnd.call(this, chunk, encoding);
  };

  next();
};

/**
 * Error tracking middleware - should be used after error handler
 */
export const errorTrackingMiddleware = (error: Error, req: Request, res: Response, next: NextFunction) => {
  // Log the error to analytics
  if (req.logError) {
    req.logError(error, {
      severity: res.statusCode >= 500 ? 'high' : 'medium',
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode
    }).catch(logError => console.error('Failed to log error to analytics:', logError));
  }

  // Track error event
  if (req.trackEvent) {
    req.trackEvent(EventType.ERROR_OCCURRED, {
      errorType: error.name,
      errorMessage: error.message,
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode
    }).catch(trackError => console.error('Failed to track error event:', trackError));
  }

  next(error);
};

/**
 * Middleware to track user activity and session management
 */
export const sessionTrackingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Track user activity for authenticated requests
  if (req.user && req.trackEvent) {
    // Update last active timestamp and track activity
    const trackActivity = async () => {
      try {
        // Track general user activity
        await req.trackEvent!(EventType.PERFORMANCE_METRIC, {
          activityType: 'api_request',
          endpoint: req.path,
          method: req.method
        });
      } catch (error) {
        console.error('Failed to track user activity:', error);
      }
    };

    trackActivity();
  }

  next();
};