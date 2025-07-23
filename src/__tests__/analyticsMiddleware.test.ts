import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import {
  analyticsMiddleware,
  requestTrackingMiddleware,
  performanceTrackingMiddleware,
  errorTrackingMiddleware,
  sessionTrackingMiddleware
} from '../middleware/analyticsMiddleware';
import { AnalyticsEvent, PerformanceMetric, ErrorLog, EventType } from '../models';

describe('Analytics Middleware', () => {
  let mongoServer: MongoMemoryServer;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear collections
    await AnalyticsEvent.deleteMany({});
    await PerformanceMetric.deleteMany({});
    await ErrorLog.deleteMany({});

    // Setup mock request and response
    req = {
      path: '/api/test',
      method: 'GET',
      sessionID: 'test-session-123',
      user: {
        id: new Types.ObjectId().toString(),
        username: 'testuser'
      },
      get: jest.fn((header: string) => {
        const headers: Record<string, string> = {
          'User-Agent': 'test-agent',
          'X-Platform': 'mobile',
          'X-App-Version': '1.0.0'
        };
        return headers[header];
      }),
      ip: '127.0.0.1'
    };

    res = {
      statusCode: 200,
      end: jest.fn()
    };

    next = jest.fn();
  });

  describe('analyticsMiddleware', () => {
    it('should add tracking methods to request object', () => {
      analyticsMiddleware(req as Request, res as Response, next);

      expect(req.trackEvent).toBeDefined();
      expect(req.recordMetric).toBeDefined();
      expect(req.logError).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('should track event successfully', async () => {
      analyticsMiddleware(req as Request, res as Response, next);

      await req.trackEvent!(EventType.USER_LOGIN, { test: 'data' });

      const events = await AnalyticsEvent.find({});
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(EventType.USER_LOGIN);
      expect(events[0].properties.test).toBe('data');
      expect(events[0].properties.endpoint).toBe('/api/test');
      expect(events[0].properties.method).toBe('GET');
    });

    it('should record metric successfully', async () => {
      analyticsMiddleware(req as Request, res as Response, next);

      await req.recordMetric!('test_metric', 100, { tag: 'value' });

      const metrics = await PerformanceMetric.find({});
      expect(metrics).toHaveLength(1);
      expect(metrics[0].metricName).toBe('test_metric');
      expect(metrics[0].value).toBe(100);
      expect(metrics[0].tags.get('tag')).toBe('value');
      expect(metrics[0].tags.get('endpoint')).toBe('/api/test');
    });

    it('should log error successfully', async () => {
      analyticsMiddleware(req as Request, res as Response, next);

      const testError = new Error('Test error');
      await req.logError!(testError, { severity: 'high' });

      const errors = await ErrorLog.find({});
      expect(errors).toHaveLength(1);
      expect(errors[0].errorType).toBe('Error');
      expect(errors[0].message).toBe('Test error');
      expect(errors[0].severity).toBe('high');
      expect(errors[0].endpoint).toBe('/api/test');
    });

    it('should handle tracking errors gracefully', async () => {
      // Mock AnalyticsEvent.save to throw error
      const originalSave = AnalyticsEvent.prototype.save;
      AnalyticsEvent.prototype.save = jest.fn().mockRejectedValue(new Error('Database error'));

      analyticsMiddleware(req as Request, res as Response, next);

      // Should not throw error
      await expect(req.trackEvent!(EventType.USER_LOGIN)).resolves.toBeUndefined();

      // Restore original save method
      AnalyticsEvent.prototype.save = originalSave;
    });
  });

  describe('requestTrackingMiddleware', () => {
    it('should track login events', async () => {
      req.path = '/auth/login';
      req.trackEvent = jest.fn();

      requestTrackingMiddleware(req as Request, res as Response, next);

      // Wait for async tracking to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.trackEvent).toHaveBeenCalledWith(EventType.USER_LOGIN, {
        endpoint: '/auth/login',
        method: 'GET'
      });
    });

    it('should track game start events', async () => {
      req.path = '/games';
      req.method = 'POST';
      req.trackEvent = jest.fn();

      requestTrackingMiddleware(req as Request, res as Response, next);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.trackEvent).toHaveBeenCalledWith(EventType.GAME_START, {
        endpoint: '/games',
        method: 'POST'
      });
    });

    it('should track room creation events', async () => {
      req.path = '/rooms';
      req.method = 'POST';
      req.trackEvent = jest.fn();

      requestTrackingMiddleware(req as Request, res as Response, next);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.trackEvent).toHaveBeenCalledWith(EventType.ROOM_CREATE, {
        endpoint: '/rooms',
        method: 'POST'
      });
    });

    it('should override res.end to track response metrics', () => {
      const originalEnd = res.end;
      req.recordMetric = jest.fn();

      requestTrackingMiddleware(req as Request, res as Response, next);

      expect(res.end).not.toBe(originalEnd);
      expect(next).toHaveBeenCalled();
    });

    it('should track response time when response ends', async () => {
      req.recordMetric = jest.fn().mockResolvedValue(undefined);
      
      requestTrackingMiddleware(req as Request, res as Response, next);

      // Simulate response ending
      (res.end as jest.Mock)();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.recordMetric).toHaveBeenCalledWith(
        'api_response_time',
        expect.any(Number),
        {
          endpoint: '/api/test',
          method: 'GET',
          statusCode: '200'
        }
      );
    });

    it('should track error events for 4xx responses', async () => {
      res.statusCode = 400;
      req.trackEvent = jest.fn().mockResolvedValue(undefined);
      req.recordMetric = jest.fn().mockResolvedValue(undefined);

      requestTrackingMiddleware(req as Request, res as Response, next);

      (res.end as jest.Mock)();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.trackEvent).toHaveBeenCalledWith(
        EventType.PERFORMANCE_METRIC,
        expect.objectContaining({
          statusCode: 400
        })
      );
    });

    it('should track error events for 5xx responses', async () => {
      res.statusCode = 500;
      req.trackEvent = jest.fn().mockResolvedValue(undefined);
      req.recordMetric = jest.fn().mockResolvedValue(undefined);

      requestTrackingMiddleware(req as Request, res as Response, next);

      (res.end as jest.Mock)();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.trackEvent).toHaveBeenCalledWith(
        EventType.ERROR_OCCURRED,
        expect.objectContaining({
          statusCode: 500
        })
      );
    });
  });

  describe('performanceTrackingMiddleware', () => {
    it('should override res.end to capture performance metrics', () => {
      const originalEnd = res.end;
      
      performanceTrackingMiddleware(req as Request, res as Response, next);

      expect(res.end).not.toBe(originalEnd);
      expect(next).toHaveBeenCalled();
    });

    it('should record performance metrics when response ends', async () => {
      req.recordMetric = jest.fn().mockResolvedValue(undefined);
      
      performanceTrackingMiddleware(req as Request, res as Response, next);

      // Simulate response ending
      (res.end as jest.Mock)();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.recordMetric).toHaveBeenCalledTimes(3);
      expect(req.recordMetric).toHaveBeenCalledWith(
        'http_request_duration_ms',
        expect.any(Number),
        expect.objectContaining({
          endpoint: '/api/test',
          method: 'GET',
          statusCode: '200'
        })
      );
      expect(req.recordMetric).toHaveBeenCalledWith(
        'http_request_memory_delta_bytes',
        expect.any(Number),
        expect.any(Object)
      );
      expect(req.recordMetric).toHaveBeenCalledWith(
        'http_requests_total',
        1,
        expect.any(Object)
      );
    });

    it('should handle metric recording errors gracefully', async () => {
      req.recordMetric = jest.fn().mockRejectedValue(new Error('Metric error'));
      
      performanceTrackingMiddleware(req as Request, res as Response, next);

      // Should not throw error when response ends
      expect(() => (res.end as jest.Mock)()).not.toThrow();
    });
  });

  describe('errorTrackingMiddleware', () => {
    it('should log error and track error event', async () => {
      const error = new Error('Test error');
      res.statusCode = 500;
      req.logError = jest.fn().mockResolvedValue(undefined);
      req.trackEvent = jest.fn().mockResolvedValue(undefined);

      errorTrackingMiddleware(error, req as Request, res as Response, next);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.logError).toHaveBeenCalledWith(error, {
        severity: 'high',
        endpoint: '/api/test',
        method: 'GET',
        statusCode: 500
      });

      expect(req.trackEvent).toHaveBeenCalledWith(EventType.ERROR_OCCURRED, {
        errorType: 'Error',
        errorMessage: 'Test error',
        endpoint: '/api/test',
        method: 'GET',
        statusCode: 500
      });

      expect(next).toHaveBeenCalledWith(error);
    });

    it('should use medium severity for 4xx errors', async () => {
      const error = new Error('Client error');
      res.statusCode = 400;
      req.logError = jest.fn().mockResolvedValue(undefined);
      req.trackEvent = jest.fn().mockResolvedValue(undefined);

      errorTrackingMiddleware(error, req as Request, res as Response, next);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.logError).toHaveBeenCalledWith(error, expect.objectContaining({
        severity: 'medium'
      }));
    });

    it('should handle tracking errors gracefully', async () => {
      const error = new Error('Test error');
      req.logError = jest.fn().mockRejectedValue(new Error('Log error'));
      req.trackEvent = jest.fn().mockRejectedValue(new Error('Track error'));

      // Should not throw error
      expect(() => errorTrackingMiddleware(error, req as Request, res as Response, next)).not.toThrow();
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('sessionTrackingMiddleware', () => {
    it('should track user activity for authenticated requests', async () => {
      req.trackEvent = jest.fn().mockResolvedValue(undefined);

      sessionTrackingMiddleware(req as Request, res as Response, next);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.trackEvent).toHaveBeenCalledWith(EventType.PERFORMANCE_METRIC, {
        activityType: 'api_request',
        endpoint: '/api/test',
        method: 'GET'
      });

      expect(next).toHaveBeenCalled();
    });

    it('should not track activity for unauthenticated requests', async () => {
      req.user = undefined;
      req.trackEvent = jest.fn();

      sessionTrackingMiddleware(req as Request, res as Response, next);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(req.trackEvent).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should handle tracking errors gracefully', async () => {
      req.trackEvent = jest.fn().mockRejectedValue(new Error('Track error'));

      // Should not throw error
      expect(() => sessionTrackingMiddleware(req as Request, res as Response, next)).not.toThrow();
      expect(next).toHaveBeenCalled();
    });
  });
});