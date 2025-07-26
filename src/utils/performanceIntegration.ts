import { performanceMonitor } from './performanceMonitor';
import { cacheManager } from './cacheManager';
import { databaseOptimizer } from './databaseOptimization';

// Initialize performance optimization systems
export const initializePerformanceOptimizations = async () => {
  console.log('🚀 Initializing performance optimizations...');

  try {
    // Start performance monitoring
    performanceMonitor.startMonitoring(5000);
    console.log('✅ Performance monitoring started');

    // Set up database indexes
    await databaseOptimizer.setupIndexes();
    console.log('✅ Database indexes created');

    // Initialize caches
    const playerCache = cacheManager.createCache('players', {
      ttl: 300, // 5 minutes
      maxSize: 1000,
    });

    const gameCache = cacheManager.createCache('games', {
      ttl: 60, // 1 minute
      maxSize: 500,
    });

    const roomCache = cacheManager.createCache('rooms', {
      ttl: 30, // 30 seconds
      maxSize: 200,
    });

    console.log('✅ Caches initialized');

    // Set up performance warning handlers
    performanceMonitor.on('performance-warning', (warning) => {
      console.warn('⚠️ Performance warning:', warning.warnings.join(', '));
    });

    performanceMonitor.on('slow-operation', (metric) => {
      console.warn(`🐌 Slow operation detected: ${metric.name} took ${metric.duration.toFixed(2)}ms`);
    });

    console.log('✅ Performance optimization initialization complete');

    return {
      performanceMonitor,
      cacheManager,
      databaseOptimizer,
      caches: {
        players: playerCache,
        games: gameCache,
        rooms: roomCache,
      }
    };
  } catch (error) {
    console.error('❌ Failed to initialize performance optimizations:', error);
    throw error;
  }
};

// Performance health check
export const getPerformanceHealth = () => {
  const cacheStats = cacheManager.getAllCacheStats();
  const recentMetrics = performanceMonitor.getSystemMetrics().slice(-5);
  const slowQueries = performanceMonitor.getSlowQueries(100); // Queries slower than 100ms

  return {
    status: 'healthy',
    caches: cacheStats,
    systemMetrics: recentMetrics,
    slowQueries: slowQueries.length,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  };
};

// Cleanup function
export const cleanupPerformanceOptimizations = () => {
  console.log('🧹 Cleaning up performance optimizations...');
  
  performanceMonitor.stopMonitoring();
  cacheManager.destroyAllCaches();
  
  console.log('✅ Performance optimization cleanup complete');
};