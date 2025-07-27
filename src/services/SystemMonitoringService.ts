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

    this.logger.info('Starting s