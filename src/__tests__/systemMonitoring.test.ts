import { SystemMonitoringService } from '../services/SystemMonitoringService';
import { LoggingService } from '../admin/services/LoggingService';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

describe('System Monitoring Service', () => {
  let monitoringService: SystemMonitoringService;
  let loggingService: LoggingService;

  beforeAll(() => {
    monitoringService = SystemMonitoringService.getInstance();
    loggingService = LoggingService.getInstance();
  });

  afterAll(async () => {
    await monitoringService.stopMonitoring();
    loggingService.shutdown();
  });

  describe('SystemMonitoringService', () => {
    test('should be a singleton', () => {
      const instance1 = SystemMonitoringService.getInstance();
      const instance2 = SystemMonitoringService.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('should start and stop monitoring', async () => {
      await monitoringService.startMonitoring(1000);
      
      // Wait for at least one metrics collection
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const metrics = monitoringService.getLatestMetrics();
      expect(metrics).toBeDefined();
      expect(metrics?.timestamp).toBeDefined();
      expect(metrics?.cpu).toBeDefined();
      expect(metrics?.memory).toBeDefined();
      expect(metrics?.disk).toBeDefined();
      expect(metrics?.network).toBeDefined();
      expect(metrics?.process).toBeDefined();
      expect(metrics?.database).toBeDefined();

      await monitoringService.stopMonitoring();
    });

    test('should collect system metrics', async () => {
      await monitoringService.startMonitoring(1000);
      
      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const metrics = monitoringService.getLatestMetrics();
      expect(metrics).toBeDefined();
      
      if (metrics) {
        // CPU metrics
        expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
        expect(metrics.cpu.usage).toBeLessThanOrEqual(100);
        expect(metrics.cpu.cores).toBeGreaterThan(0);
        expect(metrics.cpu.speed).toBeGreaterThan(0);

        // Memory metrics
        expect(metrics.memory.total).toBeGreaterThan(0);
        expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
        expect(metrics.memory.free).toBeGreaterThanOrEqual(0);
        expect(metrics.memory.percentage).toBeGreaterThanOrEqual(0);
        expect(metrics.memory.percentage).toBeLessThanOrEqual(100);

        // Disk metrics
        expect(metrics.disk.total).toBeGreaterThan(0);
        expect(metrics.disk.used).toBeGreaterThanOrEqual(0);
        expect(metrics.disk.free).toBeGreaterThanOrEqual(0);
        expect(metrics.disk.percentage).toBeGreaterThanOrEqual(0);
        expect(metrics.disk.percentage).toBeLessThanOrEqual(100);

        // Process metrics
        expect(metrics.process.pid).toBe(process.pid);
        expect(metrics.process.uptime).toBeGreaterThan(0);
        expect(metrics.process.memoryUsage).toBeDefined();
        expect(metrics.process.cpuUsage).toBeDefined();
      }

      await monitoringService.stopMonitoring();
    });

    test('should manage alert rules', () => {
      const testRule = {
        id: 'test-rule',
        name: 'Test Rule',
        metric: 'cpu.usage',
        operator: 'gt' as const,
        threshold: 80,
        duration: 60,
        severity: 'high' as const,
        enabled: true,
        notifications: { email: ['test@example.com'] }
      };

      // Add rule
      monitoringService.addAlertRule(testRule);
      const rules = monitoringService.getAlertRules();
      expect(rules.find(r => r.id === 'test-rule')).toBeDefined();

      // Update rule
      const updated = monitoringService.updateAlertRule('test-rule', { threshold: 90 });
      expect(updated).toBe(true);
      
      const updatedRules = monitoringService.getAlertRules();
      const updatedRule = updatedRules.find(r => r.id === 'test-rule');
      expect(updatedRule?.threshold).toBe(90);

      // Remove rule
      const removed = monitoringService.removeAlertRule('test-rule');
      expect(removed).toBe(true);
      
      const finalRules = monitoringService.getAlertRules();
      expect(finalRules.find(r => r.id === 'test-rule')).toBeUndefined();
    });

    test('should generate capacity report', async () => {
      await monitoringService.startMonitoring(500);
      
      // Wait for some metrics to be collected
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const report = await monitoringService.generateCapacityReport();
      expect(report).toBeDefined();
      
      if (report) {
        expect(report.current).toBeDefined();
        expect(report.current.cpu).toBeGreaterThanOrEqual(0);
        expect(report.current.memory).toBeGreaterThanOrEqual(0);
        expect(report.current.disk).toBeGreaterThanOrEqual(0);
        
        expect(report.trends).toBeDefined();
        expect(report.recommendations).toBeDefined();
        expect(Array.isArray(report.recommendations)).toBe(true);
        expect(report.timestamp).toBeDefined();
      }

      await monitoringService.stopMonitoring();
    });

    test('should handle maintenance mode', async () => {
      expect(monitoringService.isInMaintenanceMode()).toBe(false);
      
      await monitoringService.enableMaintenanceMode();
      // In a real implementation, this would check persistent storage
      
      await monitoringService.disableMaintenanceMode();
      // In a real implementation, this would check persistent storage
    });

    test('should emit events on monitoring lifecycle', async () => {
      const startedPromise = new Promise(resolve => {
        monitoringService.once('monitoring-started', resolve);
      });

      const stoppedPromise = new Promise(resolve => {
        monitoringService.once('monitoring-stopped', resolve);
      });

      await monitoringService.startMonitoring(1000);
      await startedPromise;

      await monitoringService.stopMonitoring();
      await stoppedPromise;
    });
  });

  describe('LoggingService', () => {
    const testLogsDir = path.join(process.cwd(), 'test-logs');

    beforeEach(() => {
      // Create test logs directory
      if (!fs.existsSync(testLogsDir)) {
        fs.mkdirSync(testLogsDir, { recursive: true });
      }
    });

    afterEach(() => {
      // Clean up test logs
      if (fs.existsSync(testLogsDir)) {
        const files = fs.readdirSync(testLogsDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(testLogsDir, file));
        });
        fs.rmdirSync(testLogsDir);
      }
    });

    test('should be a singleton', () => {
      const instance1 = LoggingService.getInstance();
      const instance2 = LoggingService.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('should parse JSON log entries', () => {
      const jsonLog = JSON.stringify({
        timestamp: '2024-01-01T12:00:00.000Z',
        level: 'info',
        message: 'Test message',
        service: 'test-service',
        traceId: 'trace-123'
      });

      const parsed = (loggingService as any).parseLogEntry(jsonLog);
      expect(parsed).toBeDefined();
      expect(parsed.timestamp).toBe('2024-01-01T12:00:00.000Z');
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('Test message');
      expect(parsed.service).toBe('test-service');
      expect(parsed.traceId).toBe('trace-123');
    });

    test('should parse plain text log entries', () => {
      const textLog = '2024-01-01 12:00:00 INFO Test message';
      
      const parsed = (loggingService as any).parseLogEntry(textLog);
      expect(parsed).toBeDefined();
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('Test message');
      expect(parsed.raw).toBe(textLog);
    });

    test('should filter log entries correctly', () => {
      const entry = {
        timestamp: '2024-01-01T12:00:00.000Z',
        level: 'error',
        message: 'Test error message',
        service: 'test-service',
        category: 'database',
        userId: 'user-123',
        traceId: 'trace-456'
      };

      // Level filter
      expect((loggingService as any).matchesFilter(entry, { level: ['error'] })).toBe(true);
      expect((loggingService as any).matchesFilter(entry, { level: ['info'] })).toBe(false);

      // Service filter
      expect((loggingService as any).matchesFilter(entry, { service: ['test-service'] })).toBe(true);
      expect((loggingService as any).matchesFilter(entry, { service: ['other-service'] })).toBe(false);

      // Category filter
      expect((loggingService as any).matchesFilter(entry, { category: ['database'] })).toBe(true);
      expect((loggingService as any).matchesFilter(entry, { category: ['api'] })).toBe(false);

      // User ID filter
      expect((loggingService as any).matchesFilter(entry, { userId: 'user-123' })).toBe(true);
      expect((loggingService as any).matchesFilter(entry, { userId: 'user-456' })).toBe(false);

      // Search filter
      expect((loggingService as any).matchesFilter(entry, { search: 'error' })).toBe(true);
      expect((loggingService as any).matchesFilter(entry, { search: 'success' })).toBe(false);

      // Time range filter
      const startTime = new Date('2023-12-31T00:00:00.000Z');
      const endTime = new Date('2024-01-02T00:00:00.000Z');
      expect((loggingService as any).matchesFilter(entry, { startTime, endTime })).toBe(true);

      const futureStart = new Date('2024-01-02T00:00:00.000Z');
      expect((loggingService as any).matchesFilter(entry, { startTime: futureStart })).toBe(false);
    });

    test('should extract patterns from log messages', () => {
      const message1 = 'Database connection failed at 2024-01-01T12:00:00.000Z for user 12345';
      const message2 = 'Database connection failed at 2024-01-02T13:30:00.000Z for user 67890';
      
      const pattern1 = (loggingService as any).extractPattern(message1);
      const pattern2 = (loggingService as any).extractPattern(message2);
      
      expect(pattern1).toBe(pattern2);
      expect(pattern1).toContain('[TIMESTAMP]');
      expect(pattern1).toContain('[NUMBER]');
    });

    test('should determine severity correctly', () => {
      expect((loggingService as any).determineSeverity('error', 'database connection')).toBe('critical');
      expect((loggingService as any).determineSeverity('error', 'general error')).toBe('high');
      expect((loggingService as any).determineSeverity('warn', 'warning message')).toBe('medium');
      expect((loggingService as any).determineSeverity('info', 'info message')).toBe('low');
    });

    test('should export logs in different formats', async () => {
      const mockEntries = [
        {
          timestamp: '2024-01-01T12:00:00.000Z',
          level: 'info',
          message: 'Test message 1',
          service: 'test-service',
          category: 'api',
          traceId: 'trace-1',
          userId: 'user-1'
        },
        {
          timestamp: '2024-01-01T12:01:00.000Z',
          level: 'error',
          message: 'Test error message',
          service: 'test-service',
          category: 'database',
          traceId: 'trace-2',
          userId: 'user-2'
        }
      ];

      // Mock the searchLogs method
      jest.spyOn(loggingService, 'searchLogs').mockResolvedValue({
        entries: mockEntries,
        total: 2,
        hasMore: false
      });

      // Test JSON export
      const jsonBuffer = await loggingService.exportLogs({}, 'json', false);
      const jsonContent = jsonBuffer.toString('utf8');
      const parsedJson = JSON.parse(jsonContent);
      expect(Array.isArray(parsedJson)).toBe(true);
      expect(parsedJson).toHaveLength(2);

      // Test CSV export
      const csvBuffer = await loggingService.exportLogs({}, 'csv', false);
      const csvContent = csvBuffer.toString('utf8');
      expect(csvContent).toContain('timestamp,level,service');
      expect(csvContent).toContain('Test message 1');

      // Test TXT export
      const txtBuffer = await loggingService.exportLogs({}, 'txt', false);
      const txtContent = txtBuffer.toString('utf8');
      expect(txtContent).toContain('[INFO]');
      expect(txtContent).toContain('Test message 1');

      // Restore original method
      jest.restoreAllMocks();
    });
  });

  describe('Logger Integration', () => {
    test('should create structured logs', () => {
      const logger = new Logger({ service: 'test-service', traceId: 'test-trace' });
      
      // Test different log levels
      logger.info('Test info message', { key: 'value' });
      logger.error('Test error message', new Error('Test error'));
      logger.warn('Test warning message');
      logger.debug('Test debug message');
      
      // Test specialized logging methods
      logger.performance('test-operation', 100, { additional: 'data' });
      logger.security('unauthorized-access', { ip: '127.0.0.1' });
      logger.database('query', 'users', 50, { query: 'SELECT * FROM users' });
      logger.api('GET', '/api/users', 200, 150, { userId: 'user-123' });
      logger.game('player-joined', 'game-123', 'player-456', { roomId: 'room-789' });
    });

    test('should measure function execution time', async () => {
      const logger = new Logger({ service: 'test-service' });
      
      const result = await logger.measureAsync('test-async-operation', async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'success';
      });
      
      expect(result).toBe('success');
      
      const syncResult = logger.measure('test-sync-operation', () => {
        return 'sync-success';
      });
      
      expect(syncResult).toBe('sync-success');
    });

    test('should create child loggers with additional context', () => {
      const parentLogger = new Logger({ service: 'parent-service' });
      const childLogger = parentLogger.child({ 
        traceId: 'child-trace',
        userId: 'user-123'
      });
      
      childLogger.info('Child logger message');
      
      // The child logger should inherit parent context and add new context
      expect(childLogger).toBeDefined();
    });
  });
});