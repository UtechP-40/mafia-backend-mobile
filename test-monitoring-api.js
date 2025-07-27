const axios = require('axios');

const BASE_URL = 'http://localhost:4000/admin/api';

// Mock admin token (in real implementation, this would be obtained through login)
const ADMIN_TOKEN = 'mock-admin-token';

const headers = {
  'Authorization': `Bearer ${ADMIN_TOKEN}`,
  'Content-Type': 'application/json'
};

async function testMonitoringEndpoints() {
  console.log('🔍 Testing System Monitoring API Endpoints...\n');

  try {
    // Test current metrics endpoint
    console.log('1. Testing current metrics endpoint...');
    try {
      const metricsResponse = await axios.get(`${BASE_URL}/monitoring/metrics/current`, { headers });
      console.log('✅ Current metrics endpoint working');
      console.log('   Sample data:', JSON.stringify(metricsResponse.data.data?.cpu, null, 2));
    } catch (error) {
      console.log('❌ Current metrics endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test health summary endpoint
    console.log('\n2. Testing health summary endpoint...');
    try {
      const healthResponse = await axios.get(`${BASE_URL}/monitoring/health/summary`, { headers });
      console.log('✅ Health summary endpoint working');
      console.log('   Overall status:', healthResponse.data.data?.overall);
    } catch (error) {
      console.log('❌ Health summary endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test alerts endpoint
    console.log('\n3. Testing alerts endpoint...');
    try {
      const alertsResponse = await axios.get(`${BASE_URL}/monitoring/alerts`, { headers });
      console.log('✅ Alerts endpoint working');
      console.log('   Active alerts count:', alertsResponse.data.count);
    } catch (error) {
      console.log('❌ Alerts endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test alert rules endpoint
    console.log('\n4. Testing alert rules endpoint...');
    try {
      const rulesResponse = await axios.get(`${BASE_URL}/monitoring/alerts/rules`, { headers });
      console.log('✅ Alert rules endpoint working');
      console.log('   Rules count:', rulesResponse.data.count);
    } catch (error) {
      console.log('❌ Alert rules endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test capacity report endpoint
    console.log('\n5. Testing capacity report endpoint...');
    try {
      const capacityResponse = await axios.get(`${BASE_URL}/monitoring/capacity/report`, { headers });
      console.log('✅ Capacity report endpoint working');
      console.log('   Current CPU usage:', capacityResponse.data.data?.current?.cpu, '%');
    } catch (error) {
      console.log('❌ Capacity report endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test log files endpoint
    console.log('\n6. Testing log files endpoint...');
    try {
      const logFilesResponse = await axios.get(`${BASE_URL}/monitoring/logs/files`, { headers });
      console.log('✅ Log files endpoint working');
      console.log('   Log files count:', logFilesResponse.data.data?.length);
    } catch (error) {
      console.log('❌ Log files endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test log search endpoint
    console.log('\n7. Testing log search endpoint...');
    try {
      const searchResponse = await axios.get(`${BASE_URL}/monitoring/logs/search?query=info&limit=5`, { headers });
      console.log('✅ Log search endpoint working');
      console.log('   Search results count:', searchResponse.data.data?.logs?.length || 0);
    } catch (error) {
      console.log('❌ Log search endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test maintenance mode endpoints
    console.log('\n8. Testing maintenance mode endpoints...');
    try {
      const statusResponse = await axios.get(`${BASE_URL}/monitoring/maintenance/status`, { headers });
      console.log('✅ Maintenance status endpoint working');
      console.log('   Maintenance mode:', statusResponse.data.data?.maintenanceMode);
    } catch (error) {
      console.log('❌ Maintenance status endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    // Test start monitoring endpoint
    console.log('\n9. Testing start monitoring endpoint...');
    try {
      const startResponse = await axios.post(`${BASE_URL}/monitoring/monitoring/start`, 
        { intervalMs: 10000 }, 
        { headers }
      );
      console.log('✅ Start monitoring endpoint working');
      console.log('   Message:', startResponse.data.message);
    } catch (error) {
      console.log('❌ Start monitoring endpoint failed:', error.response?.status, error.response?.data?.error);
    }

    console.log('\n🎉 Monitoring API testing completed!');

  } catch (error) {
    console.error('❌ General error during testing:', error.message);
  }
}

// Test logging functionality
async function testLoggingFeatures() {
  console.log('\n📝 Testing Logging Features...\n');

  const { Logger } = require('./dist/utils/logger');
  const { loggingService } = require('./dist/admin/services/LoggingService');

  // Create test logger
  const testLogger = new Logger({ service: 'monitoring-test', traceId: 'test-trace-123' });

  // Generate various log entries
  console.log('1. Generating test log entries...');
  testLogger.info('Test monitoring system initialization', { component: 'monitoring-test' });
  testLogger.warn('Test warning for monitoring', { level: 'warning' });
  testLogger.error('Test error for monitoring', new Error('Test monitoring error'));
  testLogger.performance('test-operation', 150, { operation: 'monitoring-test' });
  testLogger.security('test-security-event', { ip: '192.168.1.100' });
  testLogger.database('query', 'monitoring_logs', 75, { query: 'SELECT * FROM logs' });
  testLogger.api('GET', '/api/monitoring/test', 200, 120, { userId: 'test-user' });
  testLogger.game('monitoring-test-event', 'game-123', 'player-456', { action: 'test' });

  console.log('✅ Test log entries generated');

  // Wait a bit for logs to be processed
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test log search functionality
  console.log('\n2. Testing log search functionality...');
  try {
    const searchResults = await loggingService.searchLogs({
      search: 'monitoring',
      limit: 10
    });
    console.log('✅ Log search working');
    console.log('   Found entries:', searchResults.entries.length);
    console.log('   Total entries:', searchResults.total);
  } catch (error) {
    console.log('❌ Log search failed:', error.message);
  }

  // Test log filtering
  console.log('\n3. Testing log filtering...');
  try {
    const filterResults = await loggingService.searchLogs({
      level: ['error', 'warn'],
      service: ['monitoring-test'],
      limit: 5
    });
    console.log('✅ Log filtering working');
    console.log('   Filtered entries:', filterResults.entries.length);
  } catch (error) {
    console.log('❌ Log filtering failed:', error.message);
  }

  // Test log export
  console.log('\n4. Testing log export...');
  try {
    const exportBuffer = await loggingService.exportLogs(
      { service: ['monitoring-test'], limit: 10 },
      'json',
      false
    );
    console.log('✅ Log export working');
    console.log('   Export size:', exportBuffer.length, 'bytes');
  } catch (error) {
    console.log('❌ Log export failed:', error.message);
  }

  console.log('\n🎉 Logging features testing completed!');
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Monitoring System Tests\n');
  console.log('=' .repeat(50));

  // Test logging features first (doesn't require server)
  await testLoggingFeatures();

  console.log('\n' + '=' .repeat(50));

  // Test API endpoints (requires admin server to be running)
  console.log('\n⚠️  Note: API endpoint tests require the admin server to be running on port 4000');
  console.log('   Start the admin server with: npm run admin:dev\n');

  await testMonitoringEndpoints();

  console.log('\n' + '=' .repeat(50));
  console.log('✨ All tests completed!');
}

// Run the tests
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testMonitoringEndpoints, testLoggingFeatures };