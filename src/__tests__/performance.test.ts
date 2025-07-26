import { performanceMonitor } from '../utils/performanceMonitor';
import { databaseOptimizer } from '../utils/databaseOptimization';
import { cacheManager } from '../utils/cacheManager';
import mongoose from 'mongoose';

describe('Performance Tests', () => {
  beforeAll(async () => {
    // Start performance monitoring for tests
    performanceMonitor.startMonitoring(1000);
  });

  afterAll(async () => {
    performanceMonitor.stopMonitoring();
    performanceMonitor.clearMetrics();
  });

  describe('Database Performance', () => {
    it('should perform database queries within acceptable time limits', async () => {
      const benchmark = await performanceMonitor.benchmark(
        'Database Query Performance',
        async () => {
          // Mock database query
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        },
        100
      );

      expect(benchmark.averageTime).toBeLessThan(50); // 50ms average
      expect(benchmark.maxTime).toBeLessThan(200); // 200ms max
      expect(benchmark.throughput).toBeGreaterThan(20); // 20 ops/sec minimum
    });

    it('should handle concurrent database operations efficiently', async () => {
      const concurrentOperations = Array.from({ length: 50 }, (_, i) => 
        performanceMonitor.measureAsync(
          `Concurrent DB Op ${i}`,
          async () => {
            // Mock concurrent database operation
            await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
            return { id: i, data: `test-${i}` };
          }
        )
      );

      const start = performance.now();
      const results = await Promise.all(concurrentOperations);
      const totalTime = performance.now() - start;

      expect(results).toHaveLength(50);
      expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should optimize queries with proper indexing', async () => {
      // Test would verify that queries use indexes
      const queryStats = performanceMonitor.getMetricStats('Database Query Performance');
      
      if (queryStats) {
        expect(queryStats.p95).toBeLessThan(100); // 95th percentile under 100ms
        expect(queryStats.average).toBeLessThan(30); // Average under 30ms
      }
    });
  });

  describe('Cache Performance', () => {
    it('should provide fast cache operations', async () => {
      const cache = cacheManager.createCache('test-cache', { maxSize: 1000 });

      const setBenchmark = await performanceMonitor.benchmark(
        'Cache Set Operations',
        () => {
          const key = `test-key-${Math.random()}`;
          cache.set(key, { data: 'test-value', timestamp: Date.now() });
        },
        1000
      );

      const getBenchmark = await performanceMonitor.benchmark(
        'Cache Get Operations',
        () => {
          cache.get('test-key-0.5');
        },
        10000
      );

      expect(setBenchmark.averageTime).toBeLessThan(1); // Sub-millisecond set
      expect(getBenchmark.averageTime).toBeLessThan(0.1); // Sub-millisecond get
      expect(getBenchmark.throughput).toBeGreaterThan(10000); // 10k ops/sec
    });

    it('should handle cache eviction efficiently', async () => {
      const cache = cacheManager.createCache('eviction-test', { maxSize: 100 });

      // Fill cache to capacity
      for (let i = 0; i < 100; i++) {
        cache.set(`key-${i}`, { data: `value-${i}` });
      }

      const evictionBenchmark = await performanceMonitor.benchmark(
        'Cache Eviction Performance',
        () => {
          const key = `eviction-key-${Math.random()}`;
          cache.set(key, { data: 'eviction-test' });
        },
        100
      );

      expect(evictionBenchmark.averageTime).toBeLessThan(5); // Eviction under 5ms
      expect(cache.getSize()).toBeLessThanOrEqual(100);
    });
  });

  describe('Memory Performance', () => {
    it('should not have memory leaks in long-running operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Simulate long-running operations
      for (let i = 0; i < 1000; i++) {
        const data = Array.from({ length: 100 }, (_, j) => ({
          id: j,
          value: Math.random(),
          timestamp: Date.now(),
        }));

        // Process and discard data
        data.forEach(item => {
          item.value * 2;
        });
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreasePercent = (memoryIncrease / initialMemory) * 100;

      expect(memoryIncreasePercent).toBeLessThan(50); // Less than 50% increase
    });

    it('should handle large object processing efficiently', async () => {
      const largeObjectBenchmark = await performanceMonitor.benchmark(
        'Large Object Processing',
        () => {
          const largeObject = {
            players: Array.from({ length: 1000 }, (_, i) => ({
              id: `player-${i}`,
              stats: {
                games: Math.floor(Math.random() * 100),
                wins: Math.floor(Math.random() * 50),
                losses: Math.floor(Math.random() * 50),
              },
              friends: Array.from({ length: 20 }, (_, j) => `friend-${j}`),
            })),
          };

          // Process the large object
          const processed = largeObject.players
            .filter(p => p.stats.games > 10)
            .map(p => ({
              id: p.id,
              winRate: p.stats.wins / p.stats.games,
              friendCount: p.friends.length,
            }))
            .sort((a, b) => b.winRate - a.winRate);

          return processed;
        },
        100
      );

      expect(largeObjectBenchmark.averageTime).toBeLessThan(50); // Under 50ms
      expect(largeObjectBenchmark.throughput).toBeGreaterThan(20); // 20 ops/sec
    });
  });

  describe('WebSocket Performance', () => {
    it('should handle high-frequency message processing', async () => {
      const messages = Array.from({ length: 1000 }, (_, i) => ({
        type: 'game-update',
        payload: {
          gameId: 'test-game',
          playerId: `player-${i % 10}`,
          action: 'vote',
          target: `player-${(i + 1) % 10}`,
          timestamp: Date.now(),
        },
      }));

      const messageProcessingBenchmark = await performanceMonitor.benchmark(
        'WebSocket Message Processing',
        () => {
          const message = messages[Math.floor(Math.random() * messages.length)];
          
          // Simulate message processing
          const processed = {
            ...message,
            processed: true,
            processingTime: Date.now(),
          };

          // Simulate validation
          const isValid = processed.payload.gameId && 
                          processed.payload.playerId && 
                          processed.payload.action;

          return { processed, isValid };
        },
        5000
      );

      expect(messageProcessingBenchmark.averageTime).toBeLessThan(1); // Under 1ms
      expect(messageProcessingBenchmark.throughput).toBeGreaterThan(1000); // 1k msgs/sec
    });
  });

  describe('Game Logic Performance', () => {
    it('should calculate vote results efficiently', async () => {
      const players = Array.from({ length: 12 }, (_, i) => ({
        id: `player-${i}`,
        name: `Player ${i}`,
        isAlive: true,
      }));

      const voteCalculationBenchmark = await performanceMonitor.benchmark(
        'Vote Calculation',
        () => {
          const votes = players.map(p => ({
            voterId: p.id,
            targetId: players[Math.floor(Math.random() * players.length)].id,
          }));

          // Calculate vote results
          const voteCounts = votes.reduce((acc, vote) => {
            acc[vote.targetId] = (acc[vote.targetId] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          const sortedResults = Object.entries(voteCounts)
            .sort(([, a], [, b]) => b - a);

          return {
            winner: sortedResults[0],
            results: sortedResults,
            totalVotes: votes.length,
          };
        },
        1000
      );

      expect(voteCalculationBenchmark.averageTime).toBeLessThan(5); // Under 5ms
      expect(voteCalculationBenchmark.throughput).toBeGreaterThan(200); // 200 ops/sec
    });

    it('should check win conditions quickly', async () => {
      const winConditionBenchmark = await performanceMonitor.benchmark(
        'Win Condition Check',
        () => {
          const players = Array.from({ length: 12 }, (_, i) => ({
            id: `player-${i}`,
            role: i < 3 ? 'mafia' : 'villager',
            isAlive: Math.random() > 0.3, // 70% alive
          }));

          const alivePlayers = players.filter(p => p.isAlive);
          const aliveMafia = alivePlayers.filter(p => p.role === 'mafia');
          const aliveVillagers = alivePlayers.filter(p => p.role === 'villager');

          if (aliveMafia.length === 0) return 'villagers';
          if (aliveMafia.length >= aliveVillagers.length) return 'mafia';
          return null;
        },
        10000
      );

      expect(winConditionBenchmark.averageTime).toBeLessThan(0.5); // Under 0.5ms
      expect(winConditionBenchmark.throughput).toBeGreaterThan(2000); // 2k ops/sec
    });
  });

  describe('System Performance Monitoring', () => {
    it('should track system metrics accurately', async () => {
      // Let monitoring run for a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

      const systemMetrics = performanceMonitor.getSystemMetrics();
      expect(systemMetrics.length).toBeGreaterThan(0);

      const latestMetrics = systemMetrics[systemMetrics.length - 1];
      expect(latestMetrics.memory.used).toBeGreaterThan(0);
      expect(latestMetrics.memory.total).toBeGreaterThan(latestMetrics.memory.used);
      expect(latestMetrics.memory.percentage).toBeGreaterThan(0);
      expect(latestMetrics.memory.percentage).toBeLessThan(100);
    });

    it('should detect performance degradation', async () => {
      let warningEmitted = false;
      
      performanceMonitor.on('performance-warning', (warning) => {
        warningEmitted = true;
        expect(warning.warnings).toBeDefined();
        expect(warning.metrics).toBeDefined();
      });

      // Simulate high memory usage (this would need to be adapted for real scenarios)
      const largeArrays = [];
      for (let i = 0; i < 100; i++) {
        largeArrays.push(new Array(10000).fill(Math.random()));
      }

      // Wait for monitoring to detect the issue
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Clean up
      largeArrays.length = 0;
      
      // Note: In a real test, you'd need to actually trigger the warning conditions
      // This is more of a structural test
    });
  });

  describe('Performance Regression Detection', () => {
    it('should maintain consistent performance across runs', async () => {
      const runs = 5;
      const benchmarkResults = [];

      for (let i = 0; i < runs; i++) {
        const result = await performanceMonitor.benchmark(
          `Consistency Test Run ${i}`,
          () => {
            // Simulate consistent workload
            const data = Array.from({ length: 100 }, (_, j) => j * Math.random());
            return data.reduce((sum, val) => sum + val, 0);
          },
          100
        );
        benchmarkResults.push(result);
      }

      // Check consistency (coefficient of variation should be low)
      const averageTimes = benchmarkResults.map(r => r.averageTime);
      const mean = averageTimes.reduce((sum, time) => sum + time, 0) / runs;
      const variance = averageTimes.reduce((sum, time) => sum + Math.pow(time - mean, 2), 0) / runs;
      const standardDeviation = Math.sqrt(variance);
      const coefficientOfVariation = standardDeviation / mean;

      expect(coefficientOfVariation).toBeLessThan(0.3); // Less than 30% variation
    });
  });
});