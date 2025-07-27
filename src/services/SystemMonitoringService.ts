import { EventEmitter } from 'events';
import * as si from 'systeminformation';
import { performance } from 'perf_hooks';
import mongoose from 'mongoose';
import { Logger } from '../utils/logger';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    cores: number;
    speed: number;
    temperature?: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
    swap: {
      total: number;
      used: number;
      free: number;
    };
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percentage: number;
    io: {
      reads: number;
      writes: number;
      readSpeed: number;
      writeSpeed: number;
    };
  };
  network: {
    interfaces: Array<{
      name: string;
      rx: number;
      tx: number;
      rxSpeed: number;
      txSpeed: number;
      latency?: number;
    }>;
    connections: number;
  };
  process: {
    pid: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    activeHandles: number;
    activeRequests: number;
    eventLoopDelay: number;
  };
  database: {
    connections: number;
    operations: {
      queries: number;
      inserts: number;
      updates: number;
      deletes: number;
    };
    performance: {
      avgQueryTime: number;
      slowQueries: number;
    };
  };
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  duration: number; // seconds
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  notifications: {
    email?: string[];
    sms?: string[];
    webhook?: string;
  };
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  resolved: boolean;
  resolvedAt?: number;
  message: string;
}

export interface PerformanceBottleneck {
  type: 'cpu' | 'memory' | 'disk' | 'network' | 'database';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metrics: any;
  recommendations: string[];
  timestamp: number;
}

export class SystemMonitoringService extends EventEmitter {
  private static instance: SystemMonitoringService;
  private logger: Logger;
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private metricsHistory: SystemMetrics[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertStates: Map<string, { count: number; firstTriggered: number }> = new Map();
  private maxHistorySize = 1000;
  private monitoringIntervalMs = 5000;
  private previousNetworkStats: any = {};
  private previousDiskStats: any = {};

  private constructor() {
    super();
    this.logger = new Logger({ service: 'system-monitoring' });
    this.setupDefaultAlertRules();
  }

  static getInstance(): SystemMonitoringService {
    if (!SystemMonitoringService.instance) {
      SystemMonitoringService.instance = new SystemMonitoringService();
    }
    return SystemMonitoringService.instance;
  }

  private setupDefaultAlertRules() {
    const defaultRules: AlertRule[] = [
      {
        id: 'cpu-high',
        name: 'High CPU Usage',
        metric: 'cpu.usage',
        operator: 'gt',
        threshold: 80,
        duration: 60,
        severity: 'high',
        enabled: true,
        notifications: { email: [] }
      },
      {
        id: 'memory-high',
        name: 'High Memory Usage',
        metric: 'memory.percentage',
        operator: 'gt',
        threshold: 85,
        duration: 30,
        severity: 'high',
        enabled: true,
        notifications: { email: [] }
      },
      {
        id: 'disk-full',
        name: 'Disk Space Critical',
        metric: 'disk.percentage',
        operator: 'gt',
        threshold: 90,
        duration: 0,
        severity: 'critical',
        enabled: true,
        notifications: { email: [] }
      },
      {
        id: 'event-loop-delay',
        name: 'High Event Loop Delay',
        metric: 'process.eventLoopDelay',
        operator: 'gt',
        threshold: 100,
        duration: 30,
        severity: 'medium',
        enabled: true,
        notifications: { email: [] }
      }
    ];

    defaultRules.forEach(rule => this.alertRules.set(rule.id, rule));
  }

  async startMonitoring(intervalMs: number = 5000): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('System monitoring is already running');
      return;
    }

    this.monitoringIntervalMs = intervalMs;
    this.isMonitoring = true;

    this.logger.info('Starting system monitoring', { intervalMs });

    // Initial metrics collection
    await this.collectMetrics();

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        this.logger.error('Error collecting metrics', { error });
      }
    }, intervalMs);

    this.emit('monitoring-started', { intervalMs });
  }

  async stopMonitoring(): Promise<void> {
    if (!this.isMonitoring) {
      this.logger.warn('System monitoring is not running');
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.logger.info('System monitoring stopped');
    this.emit('monitoring-stopped');
  }

  private async collectMetrics(): Promise<void> {
    const startTime = performance.now();
    
    try {
      const [cpuInfo, memInfo, diskInfo, networkInfo, processInfo, dbInfo] = await Promise.all([
        this.getCpuMetrics(),
        this.getMemoryMetrics(),
        this.getDiskMetrics(),
        this.getNetworkMetrics(),
        this.getProcessMetrics(),
        this.getDatabaseMetrics()
      ]);

      const metrics: SystemMetrics = {
        timestamp: Date.now(),
        cpu: cpuInfo,
        memory: memInfo,
        disk: diskInfo,
        network: networkInfo,
        process: processInfo,
        database: dbInfo
      };

      // Store metrics in history
      this.metricsHistory.push(metrics);
      if (this.metricsHistory.length > this.maxHistorySize) {
        this.metricsHistory.shift();
      }

      // Check alert rules
      await this.checkAlertRules(metrics);

      // Detect performance bottlenecks
      const bottlenecks = this.detectBottlenecks(metrics);
      if (bottlenecks.length > 0) {
        this.emit('bottlenecks-detected', bottlenecks);
      }

      // Emit metrics event
      this.emit('metrics-collected', metrics);

      const collectionTime = performance.now() - startTime;
      this.logger.debug('Metrics collected', { 
        collectionTime: `${collectionTime.toFixed(2)}ms`,
        metricsCount: this.metricsHistory.length
      });

    } catch (error) {
      this.logger.error('Failed to collect system metrics', { error });
    }
  }

  private async getCpuMetrics(): Promise<SystemMetrics['cpu']> {
    try {
      const cpuData = await si.cpu();
      const cpuCurrentSpeed = await si.cpuCurrentSpeed();
      const cpuTemperature = await si.cpuTemperature();
      const currentLoad = await si.currentLoad();

      return {
        usage: currentLoad.currentLoad || 0,
        cores: cpuData.cores || os.cpus().length,
        speed: cpuCurrentSpeed.avg || 0,
        temperature: cpuTemperature.main || undefined
      };
    } catch (error) {
      this.logger.warn('Failed to get detailed CPU metrics, using fallback', { error });
      return {
        usage: 0,
        cores: os.cpus().length,
        speed: 0,
        temperature: undefined
      };
    }
  }

  private async getMemoryMetrics(): Promise<SystemMetrics['memory']> {
    try {
      const memData = await si.mem();
      
      return {
        total: memData.total || 0,
        used: memData.used || 0,
        free: memData.free || 0,
        percentage: memData.total ? (memData.used / memData.total) * 100 : 0,
        swap: {
          total: memData.swaptotal || 0,
          used: memData.swapused || 0,
          free: memData.swapfree || 0
        }
      };
    } catch (error) {
      this.logger.warn('Failed to get detailed memory metrics, using fallback', { error });
      const memUsage = process.memoryUsage();
      return {
        total: os.totalmem(),
        used: os.totalmem() - os.freemem(),
        free: os.freemem(),
        percentage: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
        swap: {
          total: 0,
          used: 0,
          free: 0
        }
      };
    }
  }

  private async getDiskMetrics(): Promise<SystemMetrics['disk']> {
    try {
      const diskLayout = await si.diskLayout();
      const fsSize = await si.fsSize();
      const disksIO = await si.disksIO();

      const totalSize = fsSize.reduce((acc, fs) => acc + (fs.size || 0), 0);
      const totalUsed = fsSize.reduce((acc, fs) => acc + (fs.used || 0), 0);
      const totalFree = totalSize - totalUsed;

      // Calculate IO speeds
      let readSpeed = 0;
      let writeSpeed = 0;
      
      if (this.previousDiskStats.rIO && this.previousDiskStats.wIO && disksIO.rIO && disksIO.wIO) {
        const timeDiff = (Date.now() - this.previousDiskStats.timestamp) / 1000;
        readSpeed = (disksIO.rIO - this.previousDiskStats.rIO) / timeDiff;
        writeSpeed = (disksIO.wIO - this.previousDiskStats.wIO) / timeDiff;
      }

      this.previousDiskStats = {
        rIO: disksIO.rIO || 0,
        wIO: disksIO.wIO || 0,
        timestamp: Date.now()
      };

      return {
        total: totalSize || 1, // Avoid division by zero
        used: totalUsed || 0,
        free: totalFree || 0,
        percentage: totalSize ? (totalUsed / totalSize) * 100 : 0,
        io: {
          reads: disksIO.rIO || 0,
          writes: disksIO.wIO || 0,
          readSpeed: Math.max(0, readSpeed),
          writeSpeed: Math.max(0, writeSpeed)
        }
      };
    } catch (error) {
      this.logger.warn('Failed to get detailed disk metrics, using fallback', { error });
      return {
        total: 1000000000000, // 1TB fallback
        used: 500000000000,   // 500GB fallback
        free: 500000000000,   // 500GB fallback
        percentage: 50,
        io: {
          reads: 0,
          writes: 0,
          readSpeed: 0,
          writeSpeed: 0
        }
      };
    }
  }

  private async getNetworkMetrics(): Promise<SystemMetrics['network']> {
    try {
      const networkInterfaces = await si.networkInterfaces();
      const networkStats = await si.networkStats();
      const networkConnections = await si.networkConnections();

      const interfaces = networkInterfaces.map((iface, index) => {
        const stats = networkStats[index] || {};
        let rxSpeed = 0;
        let txSpeed = 0;

        // Calculate network speeds
        const key = `${iface.iface}_${index}`;
        if (this.previousNetworkStats[key] && stats.rx_bytes && stats.tx_bytes) {
          const timeDiff = (Date.now() - this.previousNetworkStats[key].timestamp) / 1000;
          rxSpeed = Math.max(0, (stats.rx_bytes - this.previousNetworkStats[key].rx_bytes) / timeDiff);
          txSpeed = Math.max(0, (stats.tx_bytes - this.previousNetworkStats[key].tx_bytes) / timeDiff);
        }

        this.previousNetworkStats[key] = {
          rx_bytes: stats.rx_bytes || 0,
          tx_bytes: stats.tx_bytes || 0,
          timestamp: Date.now()
        };

        return {
          name: iface.iface || `interface_${index}`,
          rx: stats.rx_bytes || 0,
          tx: stats.tx_bytes || 0,
          rxSpeed,
          txSpeed
        };
      });

      return {
        interfaces,
        connections: networkConnections.length || 0
      };
    } catch (error) {
      this.logger.warn('Failed to get detailed network metrics, using fallback', { error });
      return {
        interfaces: [{
          name: 'fallback',
          rx: 0,
          tx: 0,
          rxSpeed: 0,
          txSpeed: 0
        }],
        connections: 0
      };
    }
  }

  private getProcessMetrics(): SystemMetrics['process'] {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Measure event loop delay
    const start = performance.now();
    setImmediate(() => {
      const delay = performance.now() - start;
      this.emit('event-loop-delay', delay);
    });

    return {
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: memUsage,
      cpuUsage,
      activeHandles: (process as any)._getActiveHandles().length,
      activeRequests: (process as any)._getActiveRequests().length,
      eventLoopDelay: 0 // Will be updated by setImmediate callback
    };
  }

  private async getDatabaseMetrics(): Promise<SystemMetrics['database']> {
    try {
      const connections = mongoose.connections.length;
      const dbStats = await mongoose.connection.db?.stats();
      
      // Get connection pool stats if available
      const poolStats = (mongoose.connection as any).client?.topology?.s?.pool?.stats || {};

      return {
        connections,
        operations: {
          queries: poolStats.commandsSucceeded || 0,
          inserts: 0, // Would need to track these separately
          updates: 0,
          deletes: 0
        },
        performance: {
          avgQueryTime: 0, // Would need to implement query time tracking
          slowQueries: 0
        }
      };
    } catch (error) {
      this.logger.error('Failed to get database metrics', { error });
      return {
        connections: 0,
        operations: { queries: 0, inserts: 0, updates: 0, deletes: 0 },
        performance: { avgQueryTime: 0, slowQueries: 0 }
      };
    }
  }

  private async checkAlertRules(metrics: SystemMetrics): Promise<void> {
    for (const [ruleId, rule] of this.alertRules) {
      if (!rule.enabled) continue;

      const value = this.getMetricValue(metrics, rule.metric);
      if (value === undefined) continue;

      const isTriggered = this.evaluateCondition(value, rule.operator, rule.threshold);
      const alertKey = `${ruleId}_${rule.metric}`;

      if (isTriggered) {
        if (!this.alertStates.has(alertKey)) {
          this.alertStates.set(alertKey, {
            count: 1,
            firstTriggered: Date.now()
          });
        } else {
          const state = this.alertStates.get(alertKey)!;
          state.count++;
        }

        const state = this.alertStates.get(alertKey)!;
        const duration = (Date.now() - state.firstTriggered) / 1000;

        if (duration >= rule.duration && !this.activeAlerts.has(alertKey)) {
          const alert: Alert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ruleId,
            ruleName: rule.name,
            metric: rule.metric,
            value,
            threshold: rule.threshold,
            severity: rule.severity,
            timestamp: Date.now(),
            resolved: false,
            message: `${rule.name}: ${rule.metric} is ${value} (threshold: ${rule.threshold})`
          };

          this.activeAlerts.set(alertKey, alert);
          this.emit('alert-triggered', alert);
          await this.sendNotifications(alert, rule);
        }
      } else {
        // Condition not met, clear state and resolve alert if active
        this.alertStates.delete(alertKey);
        
        if (this.activeAlerts.has(alertKey)) {
          const alert = this.activeAlerts.get(alertKey)!;
          alert.resolved = true;
          alert.resolvedAt = Date.now();
          
          this.activeAlerts.delete(alertKey);
          this.emit('alert-resolved', alert);
        }
      }
    }
  }

  private getMetricValue(metrics: SystemMetrics, metricPath: string): number | undefined {
    const parts = metricPath.split('.');
    let value: any = metrics;
    
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return typeof value === 'number' ? value : undefined;
  }

  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private async sendNotifications(alert: Alert, rule: AlertRule): Promise<void> {
    try {
      // Email notifications
      if (rule.notifications.email && rule.notifications.email.length > 0) {
        // Would integrate with email service
        this.logger.info('Sending email alert', { 
          alert: alert.id, 
          recipients: rule.notifications.email 
        });
      }

      // SMS notifications
      if (rule.notifications.sms && rule.notifications.sms.length > 0) {
        // Would integrate with SMS service
        this.logger.info('Sending SMS alert', { 
          alert: alert.id, 
          recipients: rule.notifications.sms 
        });
      }

      // Webhook notifications
      if (rule.notifications.webhook) {
        // Would send HTTP POST to webhook URL
        this.logger.info('Sending webhook alert', { 
          alert: alert.id, 
          webhook: rule.notifications.webhook 
        });
      }
    } catch (error) {
      this.logger.error('Failed to send notifications', { error, alertId: alert.id });
    }
  }

  private detectBottlenecks(metrics: SystemMetrics): PerformanceBottleneck[] {
    const bottlenecks: PerformanceBottleneck[] = [];

    // CPU bottleneck detection
    if (metrics.cpu.usage > 90) {
      bottlenecks.push({
        type: 'cpu',
        severity: 'critical',
        description: 'CPU usage is critically high',
        metrics: { usage: metrics.cpu.usage },
        recommendations: [
          'Consider scaling horizontally',
          'Optimize CPU-intensive operations',
          'Review application profiling data'
        ],
        timestamp: Date.now()
      });
    }

    // Memory bottleneck detection
    if (metrics.memory.percentage > 95) {
      bottlenecks.push({
        type: 'memory',
        severity: 'critical',
        description: 'Memory usage is critically high',
        metrics: { percentage: metrics.memory.percentage },
        recommendations: [
          'Increase available memory',
          'Optimize memory usage in application',
          'Check for memory leaks'
        ],
        timestamp: Date.now()
      });
    }

    // Disk bottleneck detection
    if (metrics.disk.percentage > 95) {
      bottlenecks.push({
        type: 'disk',
        severity: 'critical',
        description: 'Disk space is critically low',
        metrics: { percentage: metrics.disk.percentage },
        recommendations: [
          'Clean up unnecessary files',
          'Increase disk capacity',
          'Implement log rotation'
        ],
        timestamp: Date.now()
      });
    }

    // Database bottleneck detection
    if (metrics.database.performance.avgQueryTime > 1000) {
      bottlenecks.push({
        type: 'database',
        severity: 'high',
        description: 'Database queries are slow',
        metrics: { avgQueryTime: metrics.database.performance.avgQueryTime },
        recommendations: [
          'Optimize slow queries',
          'Add database indexes',
          'Consider database scaling'
        ],
        timestamp: Date.now()
      });
    }

    return bottlenecks;
  }

  // Public API methods
  getLatestMetrics(): SystemMetrics | null {
    return this.metricsHistory[this.metricsHistory.length - 1] || null;
  }

  getMetricsHistory(limit?: number): SystemMetrics[] {
    if (limit) {
      return this.metricsHistory.slice(-limit);
    }
    return [...this.metricsHistory];
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.logger.info('Alert rule added', { ruleId: rule.id, ruleName: rule.name });
  }

  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    if (removed) {
      this.logger.info('Alert rule removed', { ruleId });
    }
    return removed;
  }

  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): boolean {
    const rule = this.alertRules.get(ruleId);
    if (!rule) return false;

    const updatedRule = { ...rule, ...updates };
    this.alertRules.set(ruleId, updatedRule);
    this.logger.info('Alert rule updated', { ruleId, updates });
    return true;
  }

  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  async generateCapacityReport(): Promise<any> {
    const metrics = this.getLatestMetrics();
    if (!metrics) return null;

    const history = this.getMetricsHistory(100); // Last 100 data points
    
    return {
      current: {
        cpu: metrics.cpu.usage,
        memory: metrics.memory.percentage,
        disk: metrics.disk.percentage
      },
      trends: {
        cpu: this.calculateTrend(history.map(m => m.cpu.usage)),
        memory: this.calculateTrend(history.map(m => m.memory.percentage)),
        disk: this.calculateTrend(history.map(m => m.disk.percentage))
      },
      recommendations: this.generateScalingRecommendations(metrics, history),
      timestamp: Date.now()
    };
  }

  private calculateTrend(values: number[]): { direction: 'up' | 'down' | 'stable', rate: number } {
    if (values.length < 2) return { direction: 'stable', rate: 0 };

    const recent = values.slice(-10);
    const older = values.slice(-20, -10);
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    const rate = recentAvg - olderAvg;
    
    return {
      direction: rate > 1 ? 'up' : rate < -1 ? 'down' : 'stable',
      rate: Math.abs(rate)
    };
  }

  private generateScalingRecommendations(current: SystemMetrics, history: SystemMetrics[]): string[] {
    const recommendations: string[] = [];

    // CPU recommendations
    if (current.cpu.usage > 70) {
      recommendations.push('Consider horizontal scaling due to high CPU usage');
    }

    // Memory recommendations
    if (current.memory.percentage > 80) {
      recommendations.push('Increase memory allocation or optimize memory usage');
    }

    // Disk recommendations
    if (current.disk.percentage > 80) {
      recommendations.push('Increase disk capacity or implement data archival');
    }

    // Database recommendations
    if (current.database.connections > 80) {
      recommendations.push('Consider database connection pooling optimization');
    }

    return recommendations;
  }

  async enableMaintenanceMode(): Promise<void> {
    this.emit('maintenance-mode-enabled');
    this.logger.info('Maintenance mode enabled');
  }

  async disableMaintenanceMode(): Promise<void> {
    this.emit('maintenance-mode-disabled');
    this.logger.info('Maintenance mode disabled');
  }

  isInMaintenanceMode(): boolean {
    // This would be stored in a persistent store in a real implementation
    return false;
  }
}