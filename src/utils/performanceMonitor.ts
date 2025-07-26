import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface SystemMetrics {
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    usage: number;
  };
  eventLoop: {
    delay: number;
  };
  activeHandles: number;
  activeRequests: number;
  timestamp: number;
}

export interface PerformanceBenchmark {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  standardDeviation: number;
  throughput: number; // operations per second
}

class PerformanceMonitor extends EventEmitter {
  private static instance: PerformanceMonitor;
  private metrics: PerformanceMetric[] = [];
  private systemMetrics: SystemMetrics[] = [];
  private maxMetricsHistory = 10000;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  startMonitoring(intervalMs: number = 5000): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, intervalMs);

    console.log(`Performance monitoring started with ${intervalMs}ms interval`);
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('Performance monitoring stopped');
  }

  private collectSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Measure event loop delay
    const start = performance.now();
    setImmediate(() => {
      const delay = performance.now() - start;
      
      const metrics: SystemMetrics = {
        memory: {
          used: memoryUsage.heapUsed,
          total: memoryUsage.heapTotal,
          percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
        },
        cpu: {
          usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
        },
        eventLoop: {
          delay,
        },
        activeHandles: (process as any)._getActiveHandles().length,
        activeRequests: (process as any)._getActiveRequests().length,
        timestamp: Date.now(),
      };

      this.systemMetrics.push(metrics);
      
      // Keep metrics history manageable
      if (this.systemMetrics.length > this.maxMetricsHistory) {
        this.systemMetrics = this.systemMetrics.slice(-this.maxMetricsHistory);
      }

      // Emit warning if metrics are concerning
      this.checkMetricThresholds(metrics);
    });
  }

  private checkMetricThresholds(metrics: SystemMetrics): void {
    const warnings: string[] = [];

    if (metrics.memory.percentage > 80) {
      warnings.push(`High memory usage: ${metrics.memory.percentage.toFixed(1)}%`);
    }

    if (metrics.eventLoop.delay > 100) {
      warnings.push(`High event loop delay: ${metrics.eventLoop.delay.toFixed(1)}ms`);
    }

    if (metrics.activeHandles > 1000) {
      warnings.push(`High number of active handles: ${metrics.activeHandles}`);
    }

    if (warnings.length > 0) {
      this.emit('performance-warning', { warnings, metrics });
    }
  }

  // Method to measure function execution time
  measure<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    const start = performance.now();
    
    try {
      const result = fn();
      
      // Handle promises
      if (result && typeof (result as any).then === 'function') {
        return (result as any).then((value: any) => {
          this.recordMetric(name, performance.now() - start, metadata);
          return value;
        }).catch((error: any) => {
          this.recordMetric(name, performance.now() - start, { ...metadata, error: true });
          throw error;
        });
      }
      
      this.recordMetric(name, performance.now() - start, metadata);
      return result;
    } catch (error) {
      this.recordMetric(name, performance.now() - start, { ...metadata, error: true });
      throw error;
    }
  }

  // Method to measure async function execution time
  async measureAsync<T>(
    name: string, 
    fn: () => Promise<T>, 
    metadata?: Record<string, any>
  ): Promise<T> {
    const start = performance.now();
    
    try {
      const result = await fn();
      this.recordMetric(name, performance.now() - start, metadata);
      return result;
    } catch (error) {
      this.recordMetric(name, performance.now() - start, { ...metadata, error: true });
      throw error;
    }
  }

  private recordMetric(name: string, duration: number, metadata?: Record<string, any>): void {
    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata,
    };

    this.metrics.push(metric);
    
    // Keep metrics history manageable
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }

    // Emit slow operation warning
    if (duration > 1000) { // 1 second threshold
      this.emit('slow-operation', metric);
    }
  }

  // Benchmark a function with multiple iterations
  async benchmark(
    name: string,
    fn: () => any,
    iterations: number = 1000
  ): Promise<PerformanceBenchmark> {
    const times: number[] = [];
    
    console.log(`Starting benchmark: ${name} (${iterations} iterations)`);
    
    // Warm up
    for (let i = 0; i < Math.min(10, iterations); i++) {
      await fn();
    }
    
    // Run benchmark
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      times.push(performance.now() - start);
    }
    
    const totalTime = times.reduce((sum, time) => sum + time, 0);
    const averageTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    // Calculate standard deviation
    const variance = times.reduce((sum, time) => sum + Math.pow(time - averageTime, 2), 0) / iterations;
    const standardDeviation = Math.sqrt(variance);
    
    const throughput = 1000 / averageTime; // operations per second
    
    const benchmark: PerformanceBenchmark = {
      name,
      iterations,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      standardDeviation,
      throughput,
    };
    
    console.log(`Benchmark completed: ${name}`);
    console.log(`  Average: ${averageTime.toFixed(2)}ms`);
    console.log(`  Min: ${minTime.toFixed(2)}ms`);
    console.log(`  Max: ${maxTime.toFixed(2)}ms`);
    console.log(`  Throughput: ${throughput.toFixed(2)} ops/sec`);
    
    return benchmark;
  }

  // Get performance statistics
  getMetrics(name?: string, timeRange?: { start: number; end: number }): PerformanceMetric[] {
    let filteredMetrics = this.metrics;
    
    if (name) {
      filteredMetrics = filteredMetrics.filter(metric => metric.name === name);
    }
    
    if (timeRange) {
      filteredMetrics = filteredMetrics.filter(
        metric => metric.timestamp >= timeRange.start && metric.timestamp <= timeRange.end
      );
    }
    
    return filteredMetrics;
  }

  getSystemMetrics(timeRange?: { start: number; end: number }): SystemMetrics[] {
    if (!timeRange) {
      return this.systemMetrics;
    }
    
    return this.systemMetrics.filter(
      metric => metric.timestamp >= timeRange.start && metric.timestamp <= timeRange.end
    );
  }

  // Get aggregated statistics for a metric
  getMetricStats(name: string): {
    count: number;
    average: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const metrics = this.getMetrics(name);
    
    if (metrics.length === 0) {
      return null;
    }
    
    const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
    const count = durations.length;
    const sum = durations.reduce((acc, val) => acc + val, 0);
    
    return {
      count,
      average: sum / count,
      min: durations[0],
      max: durations[count - 1],
      p50: durations[Math.floor(count * 0.5)],
      p95: durations[Math.floor(count * 0.95)],
      p99: durations[Math.floor(count * 0.99)],
    };
  }

  // Clear all metrics
  clearMetrics(): void {
    this.metrics = [];
    this.systemMetrics = [];
  }

  // Export metrics for analysis
  exportMetrics(): {
    performance: PerformanceMetric[];
    system: SystemMetrics[];
    exportTime: number;
  } {
    return {
      performance: [...this.metrics],
      system: [...this.systemMetrics],
      exportTime: Date.now(),
    };
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance();

// Decorator for automatic performance measurement
export function measurePerformance(name?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const metricName = name || `${target.constructor.name}.${propertyName}`;

    descriptor.value = function (...args: any[]) {
      return performanceMonitor.measure(metricName, () => method.apply(this, args));
    };

    return descriptor;
  };
}

// Middleware for Express route performance monitoring
export const performanceMiddleware = (req: any, res: any, next: any) => {
  const start = performance.now();
  const route = `${req.method} ${req.route?.path || req.path}`;

  res.on('finish', () => {
    const duration = performance.now() - start;
    performanceMonitor.measure(`route:${route}`, () => {}, {
      statusCode: res.statusCode,
      method: req.method,
      path: req.path,
    });
  });

  next();
};

// Health check endpoint data
export const getHealthMetrics = () => {
  const recentMetrics = performanceMonitor.getSystemMetrics().slice(-10);
  const lastMetric = recentMetrics[recentMetrics.length - 1];

  if (!lastMetric) {
    return {
      status: 'unknown',
      message: 'No metrics available',
    };
  }

  let status = 'healthy';
  const warnings: string[] = [];

  if (lastMetric.memory.percentage > 90) {
    status = 'critical';
    warnings.push('Critical memory usage');
  } else if (lastMetric.memory.percentage > 80) {
    status = 'warning';
    warnings.push('High memory usage');
  }

  if (lastMetric.eventLoop.delay > 100) {
    status = status === 'critical' ? 'critical' : 'warning';
    warnings.push('High event loop delay');
  }

  return {
    status,
    warnings,
    metrics: lastMetric,
    uptime: process.uptime(),
  };
};