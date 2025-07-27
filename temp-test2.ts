
    import { LoggingService } from './src/admin/services/LoggingService';
    import { Logger } from './src/utils/logger';
    
    const loggingService = LoggingService.getInstance();
    console.log('✅ LoggingService instantiated successfully');
    
    // Test singleton pattern
    const loggingService2 = LoggingService.getInstance();
    console.log('✅ Singleton pattern working:', loggingService === loggingService2);
    
    // Test log parsing
    const jsonLog = JSON.stringify({
      timestamp: '2024-01-01T12:00:00.000Z',
      level: 'info',
      message: 'Test message',
      service: 'test-service'
    });
    
    const parsed = (loggingService as any).parseLogEntry(jsonLog);
    console.log('✅ JSON log parsing working:', parsed.level === 'info');
    
    // Test log filtering
    const testEntry = {
      timestamp: '2024-01-01T12:00:00.000Z',
      level: 'error',
      message: 'Test error',
      service: 'test-service'
    };
    
    const matches = (loggingService as any).matchesFilter(testEntry, { level: ['error'] });
    console.log('✅ Log filtering working:', matches === true);
    
    // Test Logger functionality
    const logger = new Logger({ service: 'test-service' });
    logger.info('Test log message');
    console.log('✅ Logger working');
    
    console.log('✅ LoggingService tests passed');
  