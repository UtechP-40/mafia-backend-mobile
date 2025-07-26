import { performanceMonitor } from '../utils/performanceMonitor';
import { cacheManager } from '../utils/cacheManager';

describe('Basic Performance Tests', () => {
  beforeAll(() => {
    performanceMonitor.startMonitoring(1000);
  });

  afterAll(() => {
    performanceMonitor.stopMonitoring();
    performanceMonitor.clearMetrics();
  });

  describe('Performance Monitor', () => {
    it('should measure function execution time', async () => {
      const result = await performanceMonitor.measureAsync(
        'test-function',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'test-result';
        }
      );

      expect(result).toBe('test-result');
      
      const metrics = performanceMonitor.getMetrics('test-function');
      expect(metrics.length).toBe(1);
      expect(metrics[0].duration).toBeGreaterThan(8);
      expect(metrics[0].duration).toBeLessThan(50);
    });

    it('should run benchmarks correctly', async () => {
      const benchmark = await performanceMonitor.benchmark(
        'simple-operation',
        () => {
          return Math.random() * 100;
        },
        100
      );

      expect(benchmark.name).toBe('simple-operation');
      expect(benchmark.iterations).toBe(100);
      expect(benchmark.averageTime).toBeGreaterThan(0);
      expect(benchmark.throughput).toBeGreaterThan(0);
    });
  });

  describe('Cache Performance', () => {
    it('should perform cache operations quickly', async () => {
      const cache = cacheManager.createCache('test-cache');
      
      const start = performance.now();
      
      // Set operations
      for (let i = 0; i < 100; i++) {
        cache.set(`key-${i}`, { value: i, data: `test-${i}` });
      }
      
      // Get operations
      for (let i = 0; i < 100; i++) {
        cache.get(`key-${i}`);
      }
      
      const end = performance.now();
      const totalTime = end - start;
      
      expect(totalTime).toBeLessThan(100); // Should complete in under 100ms
      expect(cache.getSize()).toBe(100);
    });
  });

  describe('Memory Operations', () => {
    it('should handle object creation and manipulation efficiently', () => {
      const start = performance.now();
      
      const objects = [];
      for (let i = 0; i < 1000; i++) {
        objects.push({
          id: i,
          data: `item-${i}`,
          timestamp: Date.now(),
          nested: {
            value: Math.random(),
            array: [1, 2, 3, 4, 5]
          }
        });
      }
      
      // Process objects
      const processed = objects
        .filter(obj => obj.nested.value > 0.5)
        .map(obj => ({
          id: obj.id,
          processedData: obj.data.toUpperCase(),
          sum: obj.nested.array.reduce((a, b) => a + b, 0)
        }));
      
      const end = performance.now();
      const duration = end - start;
      
      expect(duration).toBeLessThan(50); // Should complete in under 50ms
      expect(processed.length).toBeGreaterThan(0);
    });
  });
});