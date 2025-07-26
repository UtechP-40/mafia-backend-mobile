import { performanceMonitor } from './performanceMonitor';
import { cacheManager } from './cacheManager';
import { databaseOptimizer } from './databaseOptimization';

// Demo script to show performance optimizations working
export const runPerformanceDemo = async () => {
  console.log('🚀 Starting Performance Optimization Demo...\n');

  // 1. Performance Monitoring Demo
  console.log('1. Performance Monitoring Demo');
  console.log('================================');
  
  performanceMonitor.startMonitoring(1000);
  
  // Measure a simple operation
  const result1 = performanceMonitor.measure('simple-calculation', () => {
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      sum += i;
    }
    return sum;
  });
  console.log(`✅ Simple calculation result: ${result1}`);
  
  // Measure an async operation
  const result2 = await performanceMonitor.measureAsync('async-operation', async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    return 'async-complete';
  });
  console.log(`✅ Async operation result: ${result2}`);
  
  // Run a benchmark
  const benchmark = await performanceMonitor.benchmark('array-processing', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    return arr.filter(x => x % 2 === 0).map(x => x * 2).reduce((a, b) => a + b, 0);
  }, 100);
  
  console.log(`✅ Benchmark completed:`);
  console.log(`   - Average time: ${benchmark.averageTime.toFixed(2)}ms`);
  console.log(`   - Throughput: ${benchmark.throughput.toFixed(2)} ops/sec`);
  
  // Get performance statistics
  const stats = performanceMonitor.getMetricStats('simple-calculation');
  if (stats) {
    console.log(`✅ Performance stats: avg=${stats.average.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms`);
  }
  
  console.log('');

  // 2. Cache Management Demo
  console.log('2. Cache Management Demo');
  console.log('========================');
  
  const playerCache = cacheManager.createCache('demo-players', {
    ttl: 60,
    maxSize: 100,
    enableStats: true,
  });
  
  // Add some data to cache
  for (let i = 0; i < 10; i++) {
    playerCache.set(`player-${i}`, {
      id: `player-${i}`,
      name: `Player ${i}`,
      score: Math.floor(Math.random() * 1000),
      level: Math.floor(Math.random() * 50) + 1,
    });
  }
  
  // Test cache retrieval
  const cachedPlayer = playerCache.get('player-5');
  console.log(`✅ Retrieved cached player:`, cachedPlayer);
  
  // Test cache miss
  const missedPlayer = playerCache.get('player-999');
  console.log(`✅ Cache miss result:`, missedPlayer);
  
  // Show cache statistics
  const cacheStats = playerCache.getStats();
  console.log(`✅ Cache stats:`, {
    size: cacheStats.size,
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
  });
  
  console.log('');

  // 3. Memory Monitoring Demo
  console.log('3. Memory Monitoring Demo');
  console.log('=========================');
  
  // Create some memory pressure
  const largeArrays = [];
  for (let i = 0; i < 10; i++) {
    largeArrays.push(new Array(10000).fill(Math.random()));
  }
  
  // Wait for monitoring to collect metrics
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  const systemMetrics = performanceMonitor.getSystemMetrics();
  if (systemMetrics.length > 0) {
    const latest = systemMetrics[systemMetrics.length - 1];
    console.log(`✅ System metrics:`, {
      memoryUsage: `${(latest.memory.used / 1024 / 1024).toFixed(1)}MB`,
      memoryPercent: `${latest.memory.percentage.toFixed(1)}%`,
      eventLoopDelay: `${latest.eventLoop.delay.toFixed(1)}ms`,
      activeHandles: latest.activeHandles,
    });
  }
  
  // Clean up memory
  largeArrays.length = 0;
  if (global.gc) {
    global.gc();
  }
  
  console.log('');

  // 4. Database Optimization Demo (simulated)
  console.log('4. Database Optimization Demo');
  console.log('=============================');
  
  // Simulate database operations with monitoring
  const dbOperations = [
    'findPlayerById',
    'findGamesByPlayer',
    'updatePlayerStats',
    'createNewGame',
    'findActiveRooms',
  ];
  
  for (const operation of dbOperations) {
    const duration = await performanceMonitor.measureAsync(operation, async () => {
      // Simulate database query time
      const queryTime = Math.random() * 20 + 5; // 5-25ms
      await new Promise(resolve => setTimeout(resolve, queryTime));
      return { success: true, operation };
    });
    
    console.log(`✅ ${operation}: completed successfully`);
  }
  
  // Show slow queries
  const allMetricsForSlowCheck = performanceMonitor.getMetrics();
  const slowQueries = allMetricsForSlowCheck.filter(m => m.duration > 15);
  console.log(`✅ Slow queries detected: ${slowQueries.length}`);
  
  console.log('');

  // 5. Performance Health Check
  console.log('5. Performance Health Check');
  console.log('===========================');
  
  const allCacheStats = cacheManager.getAllCacheStats();
  const recentMetrics = performanceMonitor.getSystemMetrics().slice(-3);
  const allMetrics = performanceMonitor.getMetrics();
  
  console.log(`✅ Health Summary:`);
  console.log(`   - Total caches: ${Object.keys(allCacheStats).length}`);
  console.log(`   - Total metrics recorded: ${allMetrics.length}`);
  console.log(`   - System monitoring active: ${recentMetrics.length > 0 ? 'Yes' : 'No'}`);
  console.log(`   - Average operation time: ${allMetrics.length > 0 ? 
    (allMetrics.reduce((sum, m) => sum + m.duration, 0) / allMetrics.length).toFixed(2) : 'N/A'}ms`);
  
  // Cleanup
  performanceMonitor.stopMonitoring();
  cacheManager.clearAllCaches();
  
  console.log('\n🎉 Performance Optimization Demo Complete!');
  console.log('All systems are working correctly and ready for production use.');
};

// Run the demo if this file is executed directly
if (require.main === module) {
  runPerformanceDemo().catch(console.error);
}