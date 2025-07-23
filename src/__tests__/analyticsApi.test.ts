import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import { Types } from 'mongoose';
import analyticsRouter from '../api/analytics';
import { authenticateToken } from '../middleware/authMiddleware';
import { rateLimiter } from '../middleware/rateLimiter';
import { analyticsMiddleware } from '../middleware/analyticsMiddleware';
import {
  AnalyticsEvent,
  PerformanceMetric,
  ErrorLog,
  Experiment,
  UserExperiment,
  EventType,
  MetricType
} from '../models';

// Mock middleware
jest.mock('../middleware/authMiddleware');
jest.mock('../middleware/rateLimiter');

const mockAuthMiddleware = authenticateToken as jest.MockedFunction<typeof authenticateToken>;
const mockRateLimiter = rateLimiter as jest.MockedFunction<typeof rateLimiter>;

describe('Analytics API', () => {
  let app: express.Application;
  let mongoServer: MongoMemoryServer;
  let mockUser: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(analyticsMiddleware);

    // Mock auth middleware to add user to request
    mockAuthMiddleware.mockImplementation(async (req: any, res: any, next: any) => {
      req.user = mockUser;
      req.sessionID = 'test-session-123';
      next();
    });

    // Mock rate limiter
    mockRateLimiter.mockReturnValue((req: any, res: any, next: any) => {
      next();
    });

    app.use('/api/analytics', analyticsRouter);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear all collections before each test
    await AnalyticsEvent.deleteMany({});
    await PerformanceMetric.deleteMany({});
    await ErrorLog.deleteMany({});
    await Experiment.deleteMany({});
    await UserExperiment.deleteMany({});

    // Setup mock user
    mockUser = {
      id: new Types.ObjectId().toString(),
      username: 'testuser'
    };
  });

  describe('POST /api/analytics/events', () => {
    it('should track an analytics event successfully', async () => {
      const eventData = {
        eventType: EventType.GAME_START,
        gameId: new Types.ObjectId().toString(),
        properties: { playerCount: 6 },
        platform: 'mobile',
        version: '1.0.0'
      };

      const response = await request(app)
        .post('/api/analytics/events')
        .send(eventData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.eventType).toBe(EventType.GAME_START);
      expect(response.body.data.properties.playerCount).toBe(6);

      // Verify event was saved to database
      const savedEvent = await AnalyticsEvent.findById(response.body.data._id);
      expect(savedEvent).toBeDefined();
      expect(savedEvent!.eventType).toBe(EventType.GAME_START);
    });

    it('should reject invalid event type', async () => {
      const eventData = {
        eventType: 'invalid_event_type',
        properties: {}
      };

      const response = await request(app)
        .post('/api/analytics/events')
        .send(eventData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid event type');
    });

    it('should track event without optional fields', async () => {
      const eventData = {
        eventType: EventType.USER_LOGIN
      };

      const response = await request(app)
        .post('/api/analytics/events')
        .send(eventData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.eventType).toBe(EventType.USER_LOGIN);
    });
  });

  describe('POST /api/analytics/metrics', () => {
    it('should record a performance metric successfully', async () => {
      const metricData = {
        metricName: 'api_response_time',
        metricType: MetricType.TIMER,
        value: 150.5,
        tags: { endpoint: '/api/games' },
        source: 'api'
      };

      const response = await request(app)
        .post('/api/analytics/metrics')
        .send(metricData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.metricName).toBe('api_response_time');
      expect(response.body.data.value).toBe(150.5);

      // Verify metric was saved to database
      const savedMetric = await PerformanceMetric.findById(response.body.data._id);
      expect(savedMetric).toBeDefined();
      expect(savedMetric!.metricName).toBe('api_response_time');
    });

    it('should reject invalid metric type', async () => {
      const metricData = {
        metricName: 'test_metric',
        metricType: 'invalid_type',
        value: 100,
        source: 'test'
      };

      const response = await request(app)
        .post('/api/analytics/metrics')
        .send(metricData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid metric type');
    });

    it('should reject non-numeric value', async () => {
      const metricData = {
        metricName: 'test_metric',
        metricType: MetricType.GAUGE,
        value: 'not_a_number',
        source: 'test'
      };

      const response = await request(app)
        .post('/api/analytics/metrics')
        .send(metricData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Metric value must be a number');
    });
  });

  describe('POST /api/analytics/errors', () => {
    it('should log an error successfully', async () => {
      const errorData = {
        errorType: 'ValidationError',
        message: 'Invalid input data',
        stack: 'Error stack trace...',
        endpoint: '/api/games',
        method: 'POST',
        statusCode: 400,
        severity: 'medium'
      };

      const response = await request(app)
        .post('/api/analytics/errors')
        .send(errorData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.errorType).toBe('ValidationError');
      expect(response.body.data.severity).toBe('medium');

      // Verify error was saved to database
      const savedError = await ErrorLog.findById(response.body.data._id);
      expect(savedError).toBeDefined();
      expect(savedError!.errorType).toBe('ValidationError');
    });

    it('should use default severity when not provided', async () => {
      const errorData = {
        errorType: 'UnknownError',
        message: 'Something went wrong'
      };

      const response = await request(app)
        .post('/api/analytics/errors')
        .send(errorData)
        .expect(201);

      expect(response.body.data.severity).toBe('medium');
    });
  });

  describe('GET /api/analytics/dashboard', () => {
    beforeEach(async () => {
      const userId1 = new Types.ObjectId();
      const userId2 = new Types.ObjectId();
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Create test data
      await AnalyticsEvent.create([
        {
          eventType: EventType.USER_LOGIN,
          userId: userId1,
          timestamp: yesterday,
          properties: {}
        },
        {
          eventType: EventType.GAME_START,
          userId: userId1,
          timestamp: now,
          properties: {}
        },
        {
          eventType: EventType.USER_LOGIN,
          userId: userId2,
          timestamp: now,
          properties: {}
        }
      ]);

      await PerformanceMetric.create([
        {
          metricName: 'api_response_time',
          metricType: MetricType.TIMER,
          value: 100,
          source: 'api',
          timestamp: now
        },
        {
          metricName: 'api_response_time',
          metricType: MetricType.TIMER,
          value: 200,
          source: 'api',
          timestamp: now
        }
      ]);

      await ErrorLog.create([
        {
          errorType: 'ValidationError',
          message: 'Test error',
          severity: 'medium',
          timestamp: now
        }
      ]);
    });

    it('should return dashboard metrics for default date range', async () => {
      const response = await request(app)
        .get('/api/analytics/dashboard')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.totalEvents).toBe(3);
      expect(response.body.data.activeUsers).toBe(2);
      expect(response.body.data.topEvents).toHaveLength(2);
      expect(response.body.data.performanceMetrics).toHaveLength(1);
      expect(response.body.data.errorSummary).toHaveLength(1);
      expect(response.body.dateRange).toBeDefined();
    });

    it('should return dashboard metrics for custom date range', async () => {
      const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const response = await request(app)
        .get('/api/analytics/dashboard')
        .query({ startDate, endDate })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalEvents).toBe(3);
      expect(response.body.dateRange.startDate).toBe(startDate);
      expect(response.body.dateRange.endDate).toBe(endDate);
    });

    it('should reject invalid date range', async () => {
      const startDate = new Date().toISOString();
      const endDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const response = await request(app)
        .get('/api/analytics/dashboard')
        .query({ startDate, endDate })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Start date must be before end date');
    });
  });

  describe('GET /api/analytics/events', () => {
    beforeEach(async () => {
      const userId = new Types.ObjectId();
      const gameId = new Types.ObjectId();
      const now = new Date();

      await AnalyticsEvent.create([
        {
          eventType: EventType.USER_LOGIN,
          userId,
          timestamp: now,
          properties: {}
        },
        {
          eventType: EventType.GAME_START,
          userId,
          gameId,
          timestamp: now,
          properties: { playerCount: 6 }
        },
        {
          eventType: EventType.USER_LOGOUT,
          userId,
          timestamp: new Date(now.getTime() + 1000),
          properties: {}
        }
      ]);
    });

    it('should get events with default pagination', async () => {
      const response = await request(app)
        .get('/api/analytics/events')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.total).toBe(3);
    });

    it('should filter events by type', async () => {
      const response = await request(app)
        .get('/api/analytics/events')
        .query({ eventTypes: [EventType.USER_LOGIN, EventType.USER_LOGOUT] })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((event: any) => 
        event.eventType === EventType.USER_LOGIN || event.eventType === EventType.USER_LOGOUT
      )).toBe(true);
    });

    it('should paginate events correctly', async () => {
      const response = await request(app)
        .get('/api/analytics/events')
        .query({ page: 1, limit: 2 })
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.pages).toBe(2);
    });

    it('should cap limit at 1000', async () => {
      const response = await request(app)
        .get('/api/analytics/events')
        .query({ limit: 2000 })
        .expect(200);

      expect(response.body.pagination.limit).toBe(1000);
    });
  });

  describe('GET /api/analytics/export', () => {
    beforeEach(async () => {
      const userId = new Types.ObjectId();
      await AnalyticsEvent.create({
        eventType: EventType.USER_LOGIN,
        userId,
        timestamp: new Date(),
        properties: { platform: 'mobile' }
      });
    });

    it('should export data as JSON by default', async () => {
      const response = await request(app)
        .get('/api/analytics/export')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].eventType).toBe(EventType.USER_LOGIN);
    });

    it('should export data as CSV', async () => {
      const response = await request(app)
        .get('/api/analytics/export')
        .query({ format: 'csv' })
        .expect(200);

      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toContain('attachment; filename=analytics-export-');
      expect(response.text).toContain('timestamp,eventType,userId,gameId,roomId,properties');
      expect(response.text).toContain(EventType.USER_LOGIN);
    });

    it('should reject date range exceeding 30 days', async () => {
      const startDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const response = await request(app)
        .get('/api/analytics/export')
        .query({ startDate, endDate })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Export date range cannot exceed 30 days');
    });
  });

  describe('Experiments API', () => {
    describe('POST /api/analytics/experiments', () => {
      it('should create an experiment successfully', async () => {
        const experimentData = {
          name: 'Button Color Test',
          description: 'Testing different button colors',
          variants: [
            { name: 'control', weight: 50, config: { color: 'blue' } },
            { name: 'variant', weight: 50, config: { color: 'red' } }
          ],
          startDate: new Date().toISOString(),
          targetAudience: { percentage: 100 },
          metrics: {
            primary: 'click_rate',
            secondary: ['engagement_time']
          }
        };

        const response = await request(app)
          .post('/api/analytics/experiments')
          .send(experimentData)
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.data.name).toBe('Button Color Test');
        expect(response.body.data.variants).toHaveLength(2);
        expect(response.body.data.isActive).toBe(true);
      });

      it('should reject experiment with missing required fields', async () => {
        const experimentData = {
          name: 'Incomplete Test'
          // Missing required fields
        };

        const response = await request(app)
          .post('/api/analytics/experiments')
          .send(experimentData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Missing required fields');
      });

      it('should reject experiment with insufficient variants', async () => {
        const experimentData = {
          name: 'Single Variant Test',
          description: 'Test with only one variant',
          variants: [
            { name: 'control', weight: 100, config: {} }
          ],
          startDate: new Date().toISOString(),
          metrics: { primary: 'test', secondary: [] }
        };

        const response = await request(app)
          .post('/api/analytics/experiments')
          .send(experimentData)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('At least 2 variants are required');
      });
    });

    describe('GET /api/analytics/experiments/:experimentId/assignment', () => {
      let experiment: any;

      beforeEach(async () => {
        experiment = await Experiment.create({
          name: 'Test Experiment',
          description: 'Test description',
          variants: [
            { name: 'control', weight: 50, config: {} },
            { name: 'variant', weight: 50, config: {} }
          ],
          startDate: new Date(),
          targetAudience: {},
          metrics: { primary: 'test', secondary: [] },
          createdBy: new Types.ObjectId(),
          isActive: true
        });
      });

      it('should assign user to experiment and return assignment', async () => {
        const response = await request(app)
          .get(`/api/analytics/experiments/${experiment._id}/assignment`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.userId.toString()).toBe(mockUser.id);
        expect(response.body.data.experimentId.toString()).toBe(experiment._id.toString());
        expect(['control', 'variant']).toContain(response.body.data.variant);
      });

      it('should return 404 for non-existent experiment', async () => {
        const nonExistentId = new Types.ObjectId();
        
        const response = await request(app)
          .get(`/api/analytics/experiments/${nonExistentId}/assignment`)
          .expect(404);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Experiment not found or not active');
      });
    });

    describe('POST /api/analytics/experiments/:experimentId/conversion', () => {
      let experiment: any;
      let assignment: any;

      beforeEach(async () => {
        experiment = await Experiment.create({
          name: 'Conversion Test',
          description: 'Test conversions',
          variants: [
            { name: 'control', weight: 100, config: {} }
          ],
          startDate: new Date(),
          targetAudience: {},
          metrics: { primary: 'conversion', secondary: [] },
          createdBy: new Types.ObjectId(),
          isActive: true
        });

        assignment = await UserExperiment.create({
          userId: new Types.ObjectId(mockUser.id),
          experimentId: experiment._id,
          variant: 'control',
          assignedAt: new Date()
        });
      });

      it('should record conversion successfully', async () => {
        const response = await request(app)
          .post(`/api/analytics/experiments/${experiment._id}/conversion`)
          .send({ conversionValue: 10.5 })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Conversion recorded successfully');

        // Verify conversion was recorded
        const updatedAssignment = await UserExperiment.findById(assignment._id);
        expect(updatedAssignment!.convertedAt).toBeDefined();
        expect(updatedAssignment!.conversionValue).toBe(10.5);
      });

      it('should return 400 for user not assigned to experiment', async () => {
        // Change mock user to different ID
        mockUser.id = new Types.ObjectId().toString();

        const response = await request(app)
          .post(`/api/analytics/experiments/${experiment._id}/conversion`)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('User not assigned to experiment or already converted');
      });
    });

    describe('GET /api/analytics/experiments/:experimentId/results', () => {
      let experiment: any;

      beforeEach(async () => {
        experiment = await Experiment.create({
          name: 'Results Test',
          description: 'Test results',
          variants: [
            { name: 'control', weight: 50, config: {} },
            { name: 'variant', weight: 50, config: {} }
          ],
          startDate: new Date(),
          targetAudience: {},
          metrics: { primary: 'conversion', secondary: [] },
          createdBy: new Types.ObjectId(),
          isActive: true
        });

        // Create test assignments and conversions
        await UserExperiment.create([
          {
            userId: new Types.ObjectId(),
            experimentId: experiment._id,
            variant: 'control',
            assignedAt: new Date(),
            convertedAt: new Date(),
            conversionValue: 5
          },
          {
            userId: new Types.ObjectId(),
            experimentId: experiment._id,
            variant: 'control',
            assignedAt: new Date()
          },
          {
            userId: new Types.ObjectId(),
            experimentId: experiment._id,
            variant: 'variant',
            assignedAt: new Date(),
            convertedAt: new Date(),
            conversionValue: 10
          }
        ]);
      });

      it('should return experiment results with conversion metrics', async () => {
        const response = await request(app)
          .get(`/api/analytics/experiments/${experiment._id}/results`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.experiment).toBeDefined();
        expect(response.body.data.results).toHaveLength(2);

        const controlResult = response.body.data.results.find((r: any) => r.variant === 'control');
        const variantResult = response.body.data.results.find((r: any) => r.variant === 'variant');

        expect(controlResult.totalAssignments).toBe(2);
        expect(controlResult.conversions).toBe(1);
        expect(controlResult.conversionRate).toBe(50);

        expect(variantResult.totalAssignments).toBe(1);
        expect(variantResult.conversions).toBe(1);
        expect(variantResult.conversionRate).toBe(100);
      });
    });
  });

  describe('GET /api/analytics/health', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/api/analytics/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.database).toBe('connected');
    });
  });
});