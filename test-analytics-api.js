const { adminAnalyticsService } = require('./dist/admin/services/AnalyticsService');
const { loggingService } = require('./dist/admin/services/LoggingService');

async function testAnalyticsAPI() {
  console.log('Testing Analytics API implementation...');
  
  try {
    // Test 1: Dashboard metrics with date range
    console.log('\n1. Testing dashboard metrics...');
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    
    const dashboardMetrics = await adminAnalyticsService.getDashboardMetrics({
      startDate,
      endDate,
      granularity: 'day'
    });
    
    console.log('✓ Dashboard metrics generated successfully');
    console.log('  - Overview keys:', Object.keys(dashboardMetrics.overview || {}));
    console.log('  - Time range:', dashboardMetrics.timeRange);
    
    // Test 2: Custom query execution
    console.log('\n2. Testing custom query execution...');
    const customQuery = {
      collection: 'analytics_events',
      filters: {
        timestamp: { $gte: startDate, $lte: endDate }
      },
      limit: 10
    };
    
    const queryResult = await adminAnalyticsService.executeCustomQuery(customQuery);
    console.log('✓ Custom query executed successfully');
    console.log('  - Result count:', Array.isArray(queryResult) ? queryResult.length : 1);
    
    // Test 3: Time-based aggregation
    console.log('\n3. Testing time-based aggregation...');
    const timeAggregation = await adminAnalyticsService.getTimeBasedAggregation(
      'analytics_events',
      'count',
      startDate,
      endDate,
      'day',
      true // compare with previous period
    );
    
    console.log('✓ Time-based aggregation completed successfully');
    console.log('  - Current period data points:', timeAggregation.current?.length || 0);
    console.log('  - Previous period data points:', timeAggregation.previous?.length || 0);
    console.log('  - Comparison available:', !!timeAggregation.comparison);
    
    // Test 4: Cache functionality
    console.log('\n4. Testing cache functionality...');
    adminAnalyticsService.clearCache('test');
    console.log('✓ Cache cleared successfully');
    
    // Test 5: Logging service
    console.log('\n5. Testing logging service...');
    const logEntry = await loggingService.createLogEntry(
      'info',
      'Test log entry for analytics API',
      { testData: 'analytics-test' },
      {
        category: 'test',
        tags: ['analytics', 'api-test']
      }
    );
    
    console.log('✓ Log entry created successfully');
    console.log('  - Log ID:', logEntry.id);
    console.log('  - Correlation ID:', logEntry.correlationId);
    
    // Test 6: Log retrieval
    console.log('\n6. Testing log retrieval...');
    const logs = await loggingService.getLogs({
      category: 'test',
      startTime: new Date(Date.now() - 60 * 1000), // Last minute
      endTime: new Date()
    });
    
    console.log('✓ Logs retrieved successfully');
    console.log('  - Retrieved logs count:', logs.logs.length);
    
    console.log('\n✅ All analytics API tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Analytics API test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testAnalyticsAPI().then(() => {
    console.log('\nTest completed. Exiting...');
    process.exit(0);
  }).catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = { testAnalyticsAPI };