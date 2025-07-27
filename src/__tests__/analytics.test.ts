import { adminAnalyticsService } from '../admin/services/AnalyticsService';
import { loggingService } from '../admin/services/LoggingService';
import { scheduledReportsService } from '../admin/services/ScheduledReportsService';
import { AnalyticsEvent, PerformanceMetric, ErrorLog } from '../models';
import { connectDatabase } from '../utils/database';
import { connectAdminDatabase } from '../admin/config/database';

describe('Analytics and Metrics API', () => {
  beforeAll(async () => {
    // Connect to test databases
    await connectDatabase();
    await connectAdminDatabase();
  });

  afterAll(async () => {
    // Clean up test data
    await AnalyticsEvent.deleteMany({ testData: true });
    await PerformanceMetric.deleteMany({ testData: true });
    await ErrorLog.deleteMany({ testData: true });
  });

  describe('AdminAnalyticsService', () => {
    test('should generate dashboard metrics', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

      const metrics = await adminAnalyticsService.getDashboardMetrics({
        startDate,
        endDate,
        granularity: 'hour'
      });

      expect(metrics).toBeDefined();
      expect(metrics.overview).toBeDefined();
      expect(metrics.timeRange).toBeDefined();
      expect(metrics.timeRange.startDate).toEqual(startDate);
      expect(metrics.timeRange.endDate).toEqual(endDate);
      expect(metrics.generatedAt).toBeInstanceOf(Date);
    });

    test('should execute custom queries', async () => {
      // Create test data
      const testEvent = new AnalyticsEvent({
        eventType: 'TEST_EVENT',
        properties: { testData: true },
        timestamp: new Date()
      });
      await testEvent.save();

      const queryBuilder = {
        collection: 'analytics_events',
        filters: { testData: true },
        limit: 10
      };

      const result = await adminAnalyticsService.executeCustomQuery(queryBuilder);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].properties.testData).toBe(true);
    });

    test('should perform time-based aggregation', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      const aggregation = await adminAnalyticsService.getTimeBasedAggregation(
        'analytics_events',
        'count',
        startDate,
        endDate,
        'day',
        false
      );

      expect(aggregation).toBeDefined();
      expect(aggregation.current).toBeDefined();
      expect(Array.isArray(aggregation.current)).toBe(true);
      expect(aggregation.period).toBeDefined();
      expect(aggregation.period.granularity).toBe('day');
    });

    test('should export analytics data', async () => {
      const filters = { testData: true };
      const options = {
        format: 'json' as const,
        includeMetadata: true
      };

      const result = await adminAnalyticsService.exportAnalyticsData(
        'analytics_events',
        filters,
        options
      );

      expect(result).toBeDefined();
      expect(result.filePath).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.format).toBe('json');
      expect(result.metadata.collection).toBe('analytics_events');
    });

    test('should manage cache correctly', async () => {
      // Test cache clearing
      adminAnalyticsService.clearCache();
      adminAnalyticsService.clearCache('test-tag');

      // These should not throw errors
      expect(true).toBe(true);
    });
  });

  describe('LoggingService', () => {
    test('should create structured log entries', async () => {
      const logEntry = await loggingService.createLogEntry(
        'info',
        'Test log message',
        { testData: true, userId: 'test-user' },
        {
          category: 'test',
          userId: 'test-user',
          tags: ['test', 'analytics']
        }
      );

      expect(logEntry).toBeDefined();
      expect(logEntry.id).toBeDefined();
      expect(logEntry.level).toBe('info');
      expect(logEntry.message).toBe('Test log message');
      expect(logEntry.category).toBe('test');
      expect(logEntry.userId).toBe('test-user');
      expect(logEntry.correlationId).toBeDefined();
      expect(logEntry.tags).toContain('test');
      expect(logEntry.tags).toContain('analytics');
    });

    test('should retrieve logs with filtering', async () => {
      // Create a test log entry first
      await loggingService.createLogEntry(
        'error',
        'Test error log',
        { errorCode: 500 },
        {
          category: 'error',
          tags: ['error', 'test']
        }
      );

      const filter = {
        level: 'error',
        category: 'error',
        startTime: new Date(Date.now() - 60 * 1000), // Last minute
        endTime: new Date()
      };

      const result = await loggingService.getLogs(filter);

      expect(result).toBeDefined();
      expect(result.logs).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(typeof result.hasMore).toBe('boolean');
    });

    test('should analyze log patterns', async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

      const analysis = await loggingService.analyzeLogPatterns(
        startTime,
        endTime,
        {
          groupBy: 'level',
          includeAnomalies: false
        }
      );

      expect(analysis).toBeDefined();
      expect(analysis.totalLogs).toBeGreaterThanOrEqual(0);
      expect(analysis.timeRange).toBeDefined();
      expect(analysis.patterns).toBeDefined();
      expect(analysis.summary).toBeDefined();
    });

    test('should export logs in different formats', async () => {
      const filter = {
        startTime: new Date(Date.now() - 60 * 1000),
        endTime: new Date()
      };

      const jsonExport = await loggingService.exportLogs(filter, 'json');
      expect(jsonExport).toBeDefined();
      expect(jsonExport.endsWith('.json')).toBe(true);

      const csvExport = await loggingService.exportLogs(filter, 'csv');
      expect(csvExport).toBeDefined();
      expect(csvExport.endsWith('.csv')).toBe(true);
    });

    test('should handle log correlation', async () => {
      const correlationId = 'test-correlation-123';

      // Create multiple log entries with same correlation ID
      await loggingService.createLogEntry(
        'info',
        'First correlated log',
        { step: 1 },
        { correlationId, category: 'test' }
      );

      await loggingService.createLogEntry(
        'info',
        'Second correlated log',
        { step: 2 },
        { correlationId, category: 'test' }
      );

      const correlation = await loggingService.getLogCorrelation(correlationId);

      expect(correlation).toBeDefined();
      if (correlation) {
        expect(correlation.correlationId).toBe(correlationId);
        expect(correlation.entries.length).toBeGreaterThanOrEqual(2);
        expect(correlation.startTime).toBeInstanceOf(Date);
        expect(correlation.services).toContain('admin-portal');
      }
    });

    test('should stream logs in real-time', (done) => {
      const filter = {
        level: 'info',
        category: 'stream-test'
      };

      let receivedLogs = 0;
      const unsubscribe = loggingService.streamLogs(filter, (log) => {
        expect(log).toBeDefined();
        expect(log.level).toBe('info');
        expect(log.category).toBe('stream-test');
        receivedLogs++;
        
        if (receivedLogs >= 1) {
          unsubscribe();
          done();
        }
      });

      // Create a log entry that should trigger the stream
      setTimeout(async () => {
        await loggingService.createLogEntry(
          'info',
          'Stream test log',
          { streamTest: true },
          { category: 'stream-test' }
        );
      }, 100);
    });
  });

  describe('ScheduledReportsService', () => {
    test('should create scheduled reports', async () => {
      const schedule = await scheduledReportsService.createSchedule({
        name: 'Test Daily Report',
        description: 'Test report for analytics',
        cronExpression: '0 9 * * *', // 9 AM daily
        reportType: 'dashboard',
        recipients: ['test@example.com'],
        format: 'json',
        parameters: { days: 1 },
        isActive: false, // Don't actually run it
        createdBy: 'test-user'
      });

      expect(schedule).toBeDefined();
      expect(schedule.id).toBeDefined();
      expect(schedule.name).toBe('Test Daily Report');
      expect(schedule.reportType).toBe('dashboard');
      expect(schedule.recipients).toContain('test@example.com');
      expect(schedule.isActive).toBe(false);
      expect(schedule.createdAt).toBeInstanceOf(Date);
    });

    test('should retrieve scheduled reports', async () => {
      const schedules = scheduledReportsService.getSchedules();
      expect(Array.isArray(schedules)).toBe(true);
    });

    test('should validate cron expressions', () => {
      const cron = require('node-cron');
      
      expect(cron.validate('0 9 * * *')).toBe(true); // Valid: 9 AM daily
      expect(cron.validate('0 0 1 * *')).toBe(true); // Valid: 1st of every month
      expect(cron.validate('invalid')).toBe(false); // Invalid
    });

    test('should update scheduled reports', async () => {
      // First create a report
      const schedule = await scheduledReportsService.createSchedule({
        name: 'Test Update Report',
        description: 'Test report for updating',
        cronExpression: '0 10 * * *',
        reportType: 'dashboard',
        recipients: ['update@example.com'],
        format: 'json',
        parameters: {},
        isActive: false,
        createdBy: 'test-user'
      });

      // Then update it
      const updatedSchedule = await scheduledReportsService.updateSchedule(schedule.id, {
        name: 'Updated Test Report',
        isActive: true
      });

      expect(updatedSchedule.name).toBe('Updated Test Report');
      expect(updatedSchedule.isActive).toBe(true);
      expect(updatedSchedule.id).toBe(schedule.id);
    });

    test('should delete scheduled reports', async () => {
      // Create a report to delete
      const schedule = await scheduledReportsService.createSchedule({
        name: 'Test Delete Report',
        description: 'Test report for deletion',
        cronExpression: '0 11 * * *',
        reportType: 'dashboard',
        recipients: ['delete@example.com'],
        format: 'json',
        parameters: {},
        isActive: false,
        createdBy: 'test-user'
      });

      // Delete it
      await scheduledReportsService.deleteSchedule(schedule.id);

      // Verify it's gone
      const deletedSchedule = scheduledReportsService.getSchedule(schedule.id);
      expect(deletedSchedule).toBeNull();
    });

    test('should get execution history', async () => {
      // Create a report
      const schedule = await scheduledReportsService.createSchedule({
        name: 'Test History Report',
        description: 'Test report for history',
        cronExpression: '0 12 * * *',
        reportType: 'dashboard',
        recipients: ['history@example.com'],
        format: 'json',
        parameters: {},
        isActive: false,
        createdBy: 'test-user'
      });

      const history = scheduledReportsService.getExecutionHistory(schedule.id);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    test('should handle end-to-end analytics workflow', async () => {
      // 1. Create some test analytics data
      const testEvent = new AnalyticsEvent({
        eventType: 'INTEGRATION_TEST',
        properties: { integrationTest: true },
        timestamp: new Date()
      });
      await testEvent.save();

      const testMetric = new PerformanceMetric({
        metricName: 'integration_test_metric',
        metricType: 'COUNTER',
        value: 100,
        source: 'test',
        timestamp: new Date()
      });
      await testMetric.save();

      // 2. Generate dashboard metrics
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 60 * 60 * 1000); // 1 hour ago

      const metrics = await adminAnalyticsService.getDashboardMetrics({
        startDate,
        endDate,
        granularity: 'hour'
      });

      expect(metrics).toBeDefined();
      expect(metrics.overview.totalEvents).toBeGreaterThanOrEqual(1);

      // 3. Export the data
      const exportResult = await adminAnalyticsService.exportAnalyticsData(
        'analytics_events',
        { integrationTest: true },
        { format: 'json', includeMetadata: true }
      );

      expect(exportResult.filePath).toBeDefined();
      expect(exportResult.metadata.recordCount).toBeGreaterThanOrEqual(1);

      // 4. Create a log entry about the export
      const logEntry = await loggingService.createLogEntry(
        'info',
        'Integration test export completed',
        { exportPath: exportResult.filePath },
        { category: 'integration-test' }
      );

      expect(logEntry.id).toBeDefined();
      expect(logEntry.message).toContain('Integration test export completed');
    });

    test('should handle error scenarios gracefully', async () => {
      // Test invalid collection name
      await expect(
        adminAnalyticsService.executeCustomQuery({
          collection: 'invalid_collection',
          filters: {},
          limit: 10
        })
      ).rejects.toThrow('Unsupported collection');

      // Test invalid date range
      const invalidEndDate = new Date('2020-01-01');
      const invalidStartDate = new Date('2021-01-01'); // Start after end

      await expect(
        adminAnalyticsService.getDashboardMetrics({
          startDate: invalidStartDate,
          endDate: invalidEndDate
        })
      ).resolves.toBeDefined(); // Should handle gracefully

      // Test invalid export format
      await expect(
        adminAnalyticsService.exportAnalyticsData(
          'analytics_events',
          {},
          { format: 'invalid' as any }
        )
      ).rejects.toThrow('Unsupported format');
    });
  });
});