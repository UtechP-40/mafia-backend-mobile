import { performanceMonitor } from '../performanceMonitor';
import { cacheManager } from '../cacheManager';

describe('Performance Utilities', () => {
  afterEach(() => {
    performanceMonitor.clearMetrics();
    cacheManager.clearAllCaches();
  });

  describe('Performance Monitor', () => {
    it('should track metrics correctly', () => {
      const result = performanceMonitor.measure('test-operation', () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
      
      const metrics = performanceMonitor.getMetrics('test-operation');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].name).toBe('test-operation');
      expect(metrics[0].duration).toBeGreaterThan(0);
    });

    it('should calculate metric statistics', () => {
      // Record multiple metrics
      for (let i = 0; i < 10; i++) {
        performanceMonitor.measure('repeated-operation', () => {
          // Simulate some work
          let sum = 0;
          for (let j = 0; j < 1000; j++) {
            sum += j;
          }
          return sum;
        });
      }

      const stats = performanceMonitor.getMetricStats('repeated-operation');
      expect(stats).toBeDefined();
      expect(stats!.count).toBe(10);
      expect(stats!.average).toBeGreaterThan(0);
      expect(stats!.min).toBeGreaterThan(0);
      expect(stats!.max).toBeGreaterThan(0);
    });
  });

  describe('Cache Manager', () => {
    it('should create and manage caches', () => {
      const cache = cacheManager.createCache('test-cache', { maxSize: 100 });
      
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.getSize()).toBe(2);
    });

    it('should handle cache expiration', (done) => {
      const cache = cacheManager.createCache('expiry-test', { ttl: 0.1 }); // 100ms TTL
      
      cache.set('expiring-key', 'expiring-value');
      expect(cache.get('expiring-key')).toBe('expiring-value');
      
      setTimeout(() => {
        expect(cache.get('expiring-key')).toBeUndefined();
        done();
      }, 150);
    });

    it('should provide cache statistics', () => {
      const cache = cacheManager.createCache('stats-test', { enableStats: true });
      
      // Generate some cache activity
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.get('key1'); // hit
      cache.get('key3'); // miss
      
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.sets).toBe(2);
      expect(stats.size).toBe(2);
    });
  });

  describe('Integration', () => {
    it('should work together for performance monitoring', () => {
      const cache = cacheManager.createCache('integration-test');
      
      const result = performanceMonitor.measure('cache-operation', () => {
        cache.set('test-key', { data: 'test-value', timestamp: Date.now() });
        return cache.get('test-key');
      });
      
      expect(result).toBeDefined();
      expect(result.data).toBe('test-value');
      
      const metrics = performanceMonitor.getMetrics('cache-operation');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].duration).toBeGreaterThan(0);
    });
  });
});