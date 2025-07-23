import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { analyticsService } from '../services';
import {
  EventType,
  MetricType,
  AnalyticsEvent,
  PerformanceMetric,
  ErrorLog,
  Experiment,
  UserExperiment
} from '../models';

describe('AnalyticsService', () => {
  let mongoServer: MongoMemoryServer;

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
    // Clear all collections before each test
    await AnalyticsEvent.deleteMany({});
    await PerformanceMetric.deleteMany({});
    await ErrorLog.deleteMany({});
    await Experiment.deleteMany({});
    await UserExperiment.deleteMany({});
  });

  describe('trackEvent', () => {
    it('should track an analytics event successfully', async () => {
      const userId = new Types.ObjectId();
      const gameId = new Types.ObjectId();
      
      const event = await analyticsService.trackEvent({
        eventType: EventType.GAME_START,
        userId,
        gameId,
        properties: { playerCount: 6 },
        platform: 'mobile',
        version: '1.0.0'
      });

      expect(event).toBeDefined();
      expect(event.eventType).toBe(EventType.GAME_START);
      expect(event.userId).toEqual(userId);
      expect(event.gameId).toEqual(gameId);
      expect(event.properties.playerCount).toBe(6);
      expect(event.platform).toBe('mobile');
      expect(event.version).toBe('1.0.0');
    });

    it('should track event without optional fields', async () => {
      const event = await analyticsService.trackEvent({
        eventType: EventType.USER_LOGIN
      });

      expect(event).toBeDefined();
      expect(event.eventType).toBe(EventType.USER_LOGIN);
      expect(event.userId).toBeUndefined();
      expect(event.properties).toEqual({});
    });

    it('should handle tracking errors gracefully', async () => {
      // Mock save to throw error
      const originalSave = AnalyticsEvent.prototype.save;
      AnalyticsEvent.prototype.save = jest.fn().mockRejectedValue(new Error('Database error'));

      await expect(analyticsService.trackEvent({
        eventType: EventType.USER_LOGIN
      })).rejects.toThrow('Database error');

      // Restore original save method
      AnalyticsEvent.prototype.save = originalSave;
    });
  });

  describe('recordMetric', () => {
    it('should record a performance metric successfully', async () => {
      const metric = await analyticsService.recordMetric({
        metricName: 'api_response_time',
        metricType: MetricType.TIMER,
        value: 150.5,
        tags: { endpoint: '/api/games', method: 'POST' },
        source: 'api'
      });

      expect(metric).toBeDefined();
      expect(metric.metricName).toBe('api_response_time');
      expect(metric.metricType).toBe(MetricType.TIMER);
      expect(metric.value).toBe(150.5);
      expect(metric.tags.endpoint).toBe('/api/games');
      expect(metric.source).toBe('api');
    });

    it('should record metric with default tags', async () => {
      const metric = await analyticsService.recordMetric({
        metricName: 'memory_usage',
        metricType: MetricType.GAUGE,
        value: 1024,
        source: 'system'
      });

      expect(metric).toBeDefined();
      expect(metric.metricName).toBe('memory_usage');
      expect(typeof metric.tags).toBe('object');
    });
  });

  describe('logError', () => {
    it('should log an error successfully', async () => {
      const userId = new Types.ObjectId();
      
      const errorLog = await analyticsService.logError({
        errorType: 'ValidationError',
        message: 'Invalid input data',
        stack: 'Error stack trace...',
        userId,
        endpoint: '/api/games',
        method: 'POST',
        statusCode: 400,
        severity: 'medium'
      });

      expect(errorLog).toBeDefined();
      expect(errorLog.errorType).toBe('ValidationError');
      expect(errorLog.message).toBe('Invalid input data');
      expect(errorLog.userId).toEqual(userId);
      expect(errorLog.statusCode).toBe(400);
      expect(errorLog.severity).toBe('medium');
      expect(errorLog.resolved).toBe(false);
    });

    it('should use default severity when not provided', async () => {
      const errorLog = await analyticsService.logError({
        errorType: 'UnknownError',
        message: 'Something went wrong'
      });

      expect(errorLog.severity).toBe('medium');
    });
  });

  describe('getDashboardMetrics', () => {
    beforeEach(async () => {
      const userId1 = new Types.ObjectId();
      const userId2 = new Types.ObjectId();
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Create test events
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

      // Create test metrics
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

      // Create test errors
      await ErrorLog.create([
        {
          errorType: 'ValidationError',
          message: 'Test error',
          severity: 'medium',
          timestamp: now
        }
      ]);
    });

    it('should return dashboard metrics for date range', async () => {
      const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const endDate = new Date();

      const metrics = await analyticsService.getDashboardMetrics(startDate, endDate);

      expect(metrics).toBeDefined();
      expect(metrics.totalEvents).toBe(3);
      expect(metrics.activeUsers).toBe(2);
      expect(metrics.topEvents).toHaveLength(2);
      expect(metrics.topEvents[0].eventType).toBe(EventType.USER_LOGIN);
      expect(metrics.topEvents[0].count).toBe(2);
      expect(metrics.performanceMetrics).toHaveLength(1);
      expect(metrics.performanceMetrics[0].metricName).toBe('api_response_time');
      expect(metrics.performanceMetrics[0].avg).toBe(150);
      expect(metrics.errorSummary).toHaveLength(1);
    });

    it('should handle empty data gracefully', async () => {
      await AnalyticsEvent.deleteMany({});
      await PerformanceMetric.deleteMany({});
      await ErrorLog.deleteMany({});

      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const metrics = await analyticsService.getDashboardMetrics(startDate, endDate);

      expect(metrics.totalEvents).toBe(0);
      expect(metrics.activeUsers).toBe(0);
      expect(metrics.topEvents).toHaveLength(0);
      expect(metrics.performanceMetrics).toHaveLength(0);
      expect(metrics.errorSummary).toHaveLength(0);
    });
  });

  describe('getEvents', () => {
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

    it('should get events with pagination', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const result = await analyticsService.getEvents({
        startDate,
        endDate
      }, 1, 2);

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.pages).toBe(2);
    });

    it('should filter events by type', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const result = await analyticsService.getEvents({
        startDate,
        endDate,
        eventTypes: [EventType.USER_LOGIN, EventType.USER_LOGOUT]
      });

      expect(result.events).toHaveLength(2);
      expect(result.events.every(e => 
        e.eventType === EventType.USER_LOGIN || e.eventType === EventType.USER_LOGOUT
      )).toBe(true);
    });

    it('should filter events by userId', async () => {
      const userId = new Types.ObjectId();
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      // Create event for different user
      await AnalyticsEvent.create({
        eventType: EventType.USER_LOGIN,
        userId,
        timestamp: new Date(),
        properties: {}
      });

      const result = await analyticsService.getEvents({
        startDate,
        endDate,
        userId
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].userId?.toString()).toBe(userId.toString());
    });
  });

  describe('exportData', () => {
    beforeEach(async () => {
      const userId = new Types.ObjectId();
      await AnalyticsEvent.create({
        eventType: EventType.USER_LOGIN,
        userId,
        timestamp: new Date(),
        properties: { platform: 'mobile' }
      });
    });

    it('should export data as JSON', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const data = await analyticsService.exportData({
        startDate,
        endDate
      }, 'json');

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].eventType).toBe(EventType.USER_LOGIN);
    });

    it('should export data as CSV', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const csv = await analyticsService.exportData({
        startDate,
        endDate
      }, 'csv');

      expect(typeof csv).toBe('string');
      expect(csv).toContain('timestamp,eventType,userId,gameId,roomId,properties');
      expect(csv).toContain(EventType.USER_LOGIN);
    });
  });

  describe('A/B Testing', () => {
    describe('createExperiment', () => {
      it('should create an experiment successfully', async () => {
        const createdBy = new Types.ObjectId();
        
        const experiment = await analyticsService.createExperiment({
          name: 'Button Color Test',
          description: 'Testing different button colors',
          variants: [
            { name: 'control', weight: 50, config: { color: 'blue' } },
            { name: 'variant', weight: 50, config: { color: 'red' } }
          ],
          startDate: new Date(),
          targetAudience: { percentage: 100 },
          metrics: {
            primary: 'click_rate',
            secondary: ['engagement_time']
          },
          createdBy
        });

        expect(experiment).toBeDefined();
        expect(experiment.name).toBe('Button Color Test');
        expect(experiment.variants).toHaveLength(2);
        expect(experiment.isActive).toBe(true);
      });

      it('should reject experiment with invalid variant weights', async () => {
        const createdBy = new Types.ObjectId();
        
        await expect(analyticsService.createExperiment({
          name: 'Invalid Test',
          description: 'Test with invalid weights',
          variants: [
            { name: 'control', weight: 60, config: {} },
            { name: 'variant', weight: 50, config: {} } // Total = 110
          ],
          startDate: new Date(),
          targetAudience: {},
          metrics: { primary: 'test', secondary: [] },
          createdBy
        })).rejects.toThrow('Variant weights must sum to 100');
      });
    });

    describe('assignUserToExperiment', () => {
      let experiment: any;
      let userId: Types.ObjectId;

      beforeEach(async () => {
        userId = new Types.ObjectId();
        const createdBy = new Types.ObjectId();
        
        experiment = await analyticsService.createExperiment({
          name: 'Test Experiment',
          description: 'Test description',
          variants: [
            { name: 'control', weight: 50, config: {} },
            { name: 'variant', weight: 50, config: {} }
          ],
          startDate: new Date(Date.now() - 1000), // Started 1 second ago
          targetAudience: {},
          metrics: { primary: 'test', secondary: [] },
          createdBy
        });
      });

      it('should assign user to experiment variant', async () => {
        const assignment = await analyticsService.assignUserToExperiment(userId, experiment._id);

        expect(assignment).toBeDefined();
        expect(assignment!.userId).toEqual(userId);
        expect(assignment!.experimentId).toEqual(experiment._id);
        expect(['control', 'variant']).toContain(assignment!.variant);
      });

      it('should return existing assignment for already assigned user', async () => {
        const firstAssignment = await analyticsService.assignUserToExperiment(userId, experiment._id);
        const secondAssignment = await analyticsService.assignUserToExperiment(userId, experiment._id);

        expect(firstAssignment!._id.toString()).toBe(secondAssignment!._id.toString());
        expect(firstAssignment!.variant).toBe(secondAssignment!.variant);
      });

      it('should return null for inactive experiment', async () => {
        experiment.isActive = false;
        await experiment.save();

        const assignment = await analyticsService.assignUserToExperiment(userId, experiment._id);
        expect(assignment).toBeNull();
      });

      it('should return null for experiment not yet started', async () => {
        experiment.startDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
        await experiment.save();

        const assignment = await analyticsService.assignUserToExperiment(userId, experiment._id);
        expect(assignment).toBeNull();
      });
    });

    describe('recordConversion', () => {
      let experiment: any;
      let userId: Types.ObjectId;
      let assignment: any;

      beforeEach(async () => {
        userId = new Types.ObjectId();
        const createdBy = new Types.ObjectId();
        
        experiment = await analyticsService.createExperiment({
          name: 'Conversion Test',
          description: 'Test conversions',
          variants: [
            { name: 'control', weight: 100, config: {} }
          ],
          startDate: new Date(),
          targetAudience: {},
          metrics: { primary: 'conversion', secondary: [] },
          createdBy
        });

        assignment = await analyticsService.assignUserToExperiment(userId, experiment._id);
      });

      it('should record conversion successfully', async () => {
        const success = await analyticsService.recordConversion(userId, experiment._id, 10.5);

        expect(success).toBe(true);

        const updatedAssignment = await UserExperiment.findById(assignment!._id);
        expect(updatedAssignment!.convertedAt).toBeDefined();
        expect(updatedAssignment!.conversionValue).toBe(10.5);
      });

      it('should not record conversion twice', async () => {
        await analyticsService.recordConversion(userId, experiment._id);
        const success = await analyticsService.recordConversion(userId, experiment._id);

        expect(success).toBe(false);
      });

      it('should return false for unassigned user', async () => {
        const otherUserId = new Types.ObjectId();
        const success = await analyticsService.recordConversion(otherUserId, experiment._id);

        expect(success).toBe(false);
      });
    });

    describe('getExperimentResults', () => {
      let experiment: any;

      beforeEach(async () => {
        const createdBy = new Types.ObjectId();
        
        experiment = await analyticsService.createExperiment({
          name: 'Results Test',
          description: 'Test results',
          variants: [
            { name: 'control', weight: 50, config: {} },
            { name: 'variant', weight: 50, config: {} }
          ],
          startDate: new Date(),
          targetAudience: {},
          metrics: { primary: 'conversion', secondary: [] },
          createdBy
        });

        // Create test assignments and conversions
        const user1 = new Types.ObjectId();
        const user2 = new Types.ObjectId();
        const user3 = new Types.ObjectId();

        await UserExperiment.create([
          {
            userId: user1,
            experimentId: experiment._id,
            variant: 'control',
            assignedAt: new Date(),
            convertedAt: new Date(),
            conversionValue: 5
          },
          {
            userId: user2,
            experimentId: experiment._id,
            variant: 'control',
            assignedAt: new Date()
          },
          {
            userId: user3,
            experimentId: experiment._id,
            variant: 'variant',
            assignedAt: new Date(),
            convertedAt: new Date(),
            conversionValue: 10
          }
        ]);
      });

      it('should return experiment results with conversion metrics', async () => {
        const results = await analyticsService.getExperimentResults(experiment._id);

        expect(results.experiment).toBeDefined();
        expect(results.results).toHaveLength(2);

        const controlResult = results.results.find((r: any) => r.variant === 'control');
        const variantResult = results.results.find((r: any) => r.variant === 'variant');

        expect(controlResult.totalAssignments).toBe(2);
        expect(controlResult.conversions).toBe(1);
        expect(controlResult.conversionRate).toBe(50);

        expect(variantResult.totalAssignments).toBe(1);
        expect(variantResult.conversions).toBe(1);
        expect(variantResult.conversionRate).toBe(100);
      });
    });
  });

  describe('cleanupOldData', () => {
    beforeEach(async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const recentDate = new Date();

      // Create old and recent data
      await AnalyticsEvent.create([
        { eventType: EventType.USER_LOGIN, timestamp: oldDate, properties: {} },
        { eventType: EventType.USER_LOGIN, timestamp: recentDate, properties: {} }
      ]);

      await PerformanceMetric.create([
        { metricName: 'test', metricType: MetricType.GAUGE, value: 1, source: 'test', timestamp: oldDate },
        { metricName: 'test', metricType: MetricType.GAUGE, value: 2, source: 'test', timestamp: recentDate }
      ]);

      await ErrorLog.create([
        { errorType: 'OldError', message: 'old', timestamp: oldDate, resolved: true },
        { errorType: 'RecentError', message: 'recent', timestamp: recentDate, resolved: false }
      ]);
    });

    it('should clean up old data while preserving recent data', async () => {
      await analyticsService.cleanupOldData(90);

      const eventsCount = await AnalyticsEvent.countDocuments();
      const metricsCount = await PerformanceMetric.countDocuments();
      const errorsCount = await ErrorLog.countDocuments();

      expect(eventsCount).toBe(1); // Only recent event should remain
      expect(metricsCount).toBe(1); // Only recent metric should remain
      expect(errorsCount).toBe(1); // Only unresolved error should remain
    });
  });
});