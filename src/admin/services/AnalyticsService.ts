import { Types } from 'mongoose';
import { AnalyticsEvent, PerformanceMetric, ErrorLog, IAnalyticsEvent, IPerformanceMetric, IErrorLog } from '../../models';
import { adminLogger, adminPerformanceLogger } from '../config/logger';
import fs from 'fs/promises';
import path from 'path';
import { Parser } from 'json2csv';
import * as XLSX from 'xlsx';

export interface DashboardMetricsOptions {
  startDate: Date;
  endDate: Date;
  granularity?: 'hour' | 'day' | 'week' | 'month';
  timezone?: string;
}

export interface AnalyticsQueryBuilder {
  collection: string;
  filters: Record<string, any>;
  aggregation?: any[];
  groupBy?: string[];
  sortBy?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

export interface ExportOptions {
  format: 'json' | 'csv' | 'xlsx';
  filename?: string;
  includeMetadata?: boolean;
  compression?: boolean;
}

export interface LogStreamOptions {
  level?: string;
  category?: string;
  startTime?: Date;
  endTime?: Date;
  follow?: boolean;
  maxLines?: number;
}

export interface RetentionPolicy {
  collection: string;
  retentionDays: number;
  archiveBeforeDelete?: boolean;
  conditions?: Record<string, any>;
}

export interface AnalyticsCache {
  key: string;
  data: any;
  expiry: Date;
  tags: string[];
}

export class AdminAnalyticsService {
  private cache = new Map<string, AnalyticsCache>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes default TTL

  /**
   * Get real-time dashboard metrics with caching
   */
  async getDashboardMetrics(options: DashboardMetricsOptions): Promise<any> {
    const cacheKey = `dashboard_${options.startDate.getTime()}_${options.endDate.getTime()}_${options.granularity || 'day'}`;
    
    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const startTime = Date.now();
    
    try {
      const [
        totalEvents,
        uniqueUsers,
        activeUsers,
        gameMetrics,
        errorMetrics,
        performanceMetrics,
        userEngagement,
        systemHealth
      ] = await Promise.all([
        this.getTotalEvents(options.startDate, options.endDate),
        this.getUniqueUsers(options.startDate, options.endDate),
        this.getActiveUsers(options.startDate, options.endDate),
        this.getGameMetrics(options.startDate, options.endDate),
        this.getErrorMetrics(options.startDate, options.endDate),
        this.getPerformanceMetrics(options.startDate, options.endDate),
        this.getUserEngagementMetrics(options.startDate, options.endDate),
        this.getSystemHealthMetrics(options.startDate, options.endDate)
      ]);

      const metrics = {
        overview: {
          totalEvents,
          uniqueUsers,
          activeUsers,
          errorRate: totalEvents > 0 ? (errorMetrics.totalErrors / totalEvents) * 100 : 0,
          avgResponseTime: performanceMetrics.avgResponseTime,
          systemUptime: systemHealth.uptime
        },
        games: gameMetrics,
        errors: errorMetrics,
        performance: performanceMetrics,
        engagement: userEngagement,
        system: systemHealth,
        timeRange: {
          startDate: options.startDate,
          endDate: options.endDate,
          granularity: options.granularity || 'day'
        },
        generatedAt: new Date()
      };

      // Cache the result
      this.setCache(cacheKey, metrics, ['dashboard', 'metrics']);

      const duration = Date.now() - startTime;
      adminPerformanceLogger.info('Dashboard metrics generated', {
        duration,
        cacheKey,
        metricsCount: Object.keys(metrics).length
      });

      return metrics;
    } catch (error) {
      adminLogger.error('Failed to generate dashboard metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        options,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Execute custom analytics query with aggregation pipeline
   */
  async executeCustomQuery(queryBuilder: AnalyticsQueryBuilder): Promise<any> {
    const startTime = Date.now();
    
    try {
      let model;
      switch (queryBuilder.collection) {
        case 'analytics_events':
          model = AnalyticsEvent;
          break;
        case 'performance_metrics':
          model = PerformanceMetric;
          break;
        case 'error_logs':
          model = ErrorLog;
          break;
        default:
          throw new Error(`Unsupported collection: ${queryBuilder.collection}`);
      }

      let query = model.find(queryBuilder.filters);

      // Apply aggregation pipeline if provided
      if (queryBuilder.aggregation && queryBuilder.aggregation.length > 0) {
        const pipeline = [
          { $match: queryBuilder.filters },
          ...queryBuilder.aggregation
        ];
        
        if (queryBuilder.sortBy) {
          pipeline.push({ $sort: queryBuilder.sortBy });
        }
        
        if (queryBuilder.skip) {
          pipeline.push({ $skip: queryBuilder.skip });
        }
        
        if (queryBuilder.limit) {
          pipeline.push({ $limit: queryBuilder.limit });
        }

        const result = await model.aggregate(pipeline);
        
        adminPerformanceLogger.info('Custom aggregation query executed', {
          collection: queryBuilder.collection,
          duration: Date.now() - startTime,
          resultCount: result.length,
          pipeline: pipeline.length
        });

        return result;
      }

      // Apply sorting, pagination for regular queries
      if (queryBuilder.sortBy) {
        query = query.sort(queryBuilder.sortBy);
      }
      
      if (queryBuilder.skip) {
        query = query.skip(queryBuilder.skip);
      }
      
      if (queryBuilder.limit) {
        query = query.limit(queryBuilder.limit);
      }

      const result = await query.exec();
      
      adminPerformanceLogger.info('Custom query executed', {
        collection: queryBuilder.collection,
        duration: Date.now() - startTime,
        resultCount: result.length
      });

      return result;
    } catch (error) {
      adminLogger.error('Failed to execute custom query', {
        error: error instanceof Error ? error.message : 'Unknown error',
        queryBuilder,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get time-based data aggregation with period-over-period comparison
   */
  async getTimeBasedAggregation(
    collection: string,
    metric: string,
    startDate: Date,
    endDate: Date,
    granularity: 'hour' | 'day' | 'week' | 'month' = 'day',
    compareWithPrevious: boolean = false
  ): Promise<any> {
    const startTime = Date.now();
    
    try {
      let model;
      switch (collection) {
        case 'analytics_events':
          model = AnalyticsEvent;
          break;
        case 'performance_metrics':
          model = PerformanceMetric;
          break;
        case 'error_logs':
          model = ErrorLog;
          break;
        default:
          throw new Error(`Unsupported collection: ${collection}`);
      }

      // Build aggregation pipeline based on granularity
      const dateFormat = this.getDateFormat(granularity);
      const pipeline = [
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: dateFormat,
                date: '$timestamp'
              }
            },
            count: { $sum: 1 },
            ...(metric === 'value' && { avgValue: { $avg: '$value' }, maxValue: { $max: '$value' }, minValue: { $min: '$value' } })
          }
        },
        { $sort: { '_id': 1 } }
      ];

      const currentPeriodData = await model.aggregate(pipeline);

      let result: any = {
        current: currentPeriodData,
        period: {
          startDate,
          endDate,
          granularity
        }
      };

      // Add previous period comparison if requested
      if (compareWithPrevious) {
        const periodDuration = endDate.getTime() - startDate.getTime();
        const previousStartDate = new Date(startDate.getTime() - periodDuration);
        const previousEndDate = new Date(startDate.getTime());

        const previousPipeline = [
          {
            $match: {
              timestamp: { $gte: previousStartDate, $lte: previousEndDate }
            }
          },
          ...pipeline.slice(1) // Reuse the same grouping and sorting
        ];

        const previousPeriodData = await model.aggregate(previousPipeline);
        
        result.previous = previousPeriodData;
        result.comparison = this.calculatePeriodComparison(currentPeriodData, previousPeriodData);
      }

      adminPerformanceLogger.info('Time-based aggregation completed', {
        collection,
        metric,
        granularity,
        duration: Date.now() - startTime,
        currentDataPoints: currentPeriodData.length,
        compareWithPrevious
      });

      return result;
    } catch (error) {
      adminLogger.error('Failed to get time-based aggregation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        collection,
        metric,
        granularity,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Export analytics data in various formats
   */
  async exportAnalyticsData(
    collection: string,
    filters: Record<string, any>,
    options: ExportOptions
  ): Promise<{ filePath: string; metadata: any }> {
    const startTime = Date.now();
    
    try {
      let model;
      switch (collection) {
        case 'analytics_events':
          model = AnalyticsEvent;
          break;
        case 'performance_metrics':
          model = PerformanceMetric;
          break;
        case 'error_logs':
          model = ErrorLog;
          break;
        default:
          throw new Error(`Unsupported collection: ${collection}`);
      }

      // Fetch data with population for related fields
      const data = await model.find(filters)
        .populate('userId', 'username email')
        .populate('gameId', 'phase dayNumber')
        .populate('roomId', 'code')
        .lean();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = options.filename || `${collection}_export_${timestamp}`;
      const exportDir = path.join(process.cwd(), 'exports');
      
      // Ensure export directory exists
      await fs.mkdir(exportDir, { recursive: true });

      let filePath: string;
      let metadata = {
        collection,
        recordCount: data.length,
        exportedAt: new Date(),
        filters,
        format: options.format
      };

      switch (options.format) {
        case 'json':
          filePath = path.join(exportDir, `${filename}.json`);
          const jsonData = options.includeMetadata ? { metadata, data } : data;
          await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2));
          break;

        case 'csv':
          filePath = path.join(exportDir, `${filename}.csv`);
          const flattenedData = this.flattenDataForCSV(data);
          const parser = new Parser();
          const csv = parser.parse(flattenedData);
          await fs.writeFile(filePath, csv);
          break;

        case 'xlsx':
          filePath = path.join(exportDir, `${filename}.xlsx`);
          const workbook = XLSX.utils.book_new();
          const worksheet = XLSX.utils.json_to_sheet(this.flattenDataForCSV(data));
          XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
          
          if (options.includeMetadata) {
            const metadataSheet = XLSX.utils.json_to_sheet([metadata]);
            XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Metadata');
          }
          
          XLSX.writeFile(workbook, filePath);
          break;

        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

      adminLogger.info('Analytics data exported', {
        collection,
        format: options.format,
        recordCount: data.length,
        filePath,
        duration: Date.now() - startTime
      });

      return { filePath, metadata };
    } catch (error) {
      adminLogger.error('Failed to export analytics data', {
        error: error instanceof Error ? error.message : 'Unknown error',
        collection,
        options,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Get comprehensive log data with filtering and search
   */
  async getLogs(options: LogStreamOptions): Promise<any[]> {
    const startTime = Date.now();
    
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      const adminLogsDir = path.join(logsDir, 'admin');
      
      // Determine which log files to read based on category
      let logFiles: string[] = [];
      
      if (options.category) {
        switch (options.category) {
          case 'admin':
            logFiles = ['admin.log'];
            break;
          case 'security':
            logFiles = ['admin-security.log'];
            break;
          case 'error':
            logFiles = ['admin-error.log'];
            break;
          case 'performance':
            logFiles = ['admin.log']; // Performance logs are in main admin log
            break;
          default:
            logFiles = ['admin.log', 'admin-error.log', 'admin-security.log'];
        }
      } else {
        logFiles = ['admin.log', 'admin-error.log', 'admin-security.log'];
      }

      const logs: any[] = [];
      
      for (const logFile of logFiles) {
        const logPath = path.join(adminLogsDir, logFile);
        
        try {
          const content = await fs.readFile(logPath, 'utf-8');
          const lines = content.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const logEntry = JSON.parse(line);
              
              // Apply filters
              if (options.level && logEntry.level !== options.level) continue;
              if (options.startTime && new Date(logEntry.timestamp) < options.startTime) continue;
              if (options.endTime && new Date(logEntry.timestamp) > options.endTime) continue;
              
              logs.push({
                ...logEntry,
                source: logFile
              });
            } catch (parseError) {
              // Skip invalid JSON lines
              continue;
            }
          }
        } catch (fileError) {
          // Log file might not exist, continue with others
          continue;
        }
      }

      // Sort by timestamp (newest first)
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply limit
      const limitedLogs = options.maxLines ? logs.slice(0, options.maxLines) : logs;

      adminPerformanceLogger.info('Logs retrieved', {
        category: options.category,
        level: options.level,
        totalLogs: limitedLogs.length,
        duration: Date.now() - startTime
      });

      return limitedLogs;
    } catch (error) {
      adminLogger.error('Failed to get logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
        options,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Download log files with optional compression
   */
  async downloadLogFile(filename: string, compress: boolean = false): Promise<string> {
    try {
      const logsDir = path.join(process.cwd(), 'logs', 'admin');
      const logPath = path.join(logsDir, filename);
      
      // Verify file exists and is within logs directory
      const resolvedPath = path.resolve(logPath);
      const resolvedLogsDir = path.resolve(logsDir);
      
      if (!resolvedPath.startsWith(resolvedLogsDir)) {
        throw new Error('Invalid file path');
      }

      await fs.access(logPath);

      if (compress) {
        // TODO: Implement compression if needed
        // For now, return the original file path
      }

      adminLogger.info('Log file download requested', {
        filename,
        compress,
        filePath: logPath
      });

      return logPath;
    } catch (error) {
      adminLogger.error('Failed to download log file', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filename,
        compress
      });
      throw error;
    }
  }

  /**
   * Implement log retention policies with automated cleanup
   */
  async applyRetentionPolicies(policies: RetentionPolicy[]): Promise<void> {
    const startTime = Date.now();
    let totalDeleted = 0;
    
    try {
      for (const policy of policies) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

        let model;
        switch (policy.collection) {
          case 'analytics_events':
            model = AnalyticsEvent;
            break;
          case 'performance_metrics':
            model = PerformanceMetric;
            break;
          case 'error_logs':
            model = ErrorLog;
            break;
          default:
            continue;
        }

        const deleteFilter = {
          timestamp: { $lt: cutoffDate },
          ...policy.conditions
        };

        if (policy.archiveBeforeDelete) {
          // Archive data before deletion
          const dataToArchive = await model.find(deleteFilter).lean();
          if (dataToArchive.length > 0) {
            await this.archiveData(policy.collection, dataToArchive);
          }
        }

        const deleteResult = await model.deleteMany(deleteFilter);
        totalDeleted += deleteResult.deletedCount || 0;

        adminLogger.info('Retention policy applied', {
          collection: policy.collection,
          retentionDays: policy.retentionDays,
          deletedCount: deleteResult.deletedCount,
          cutoffDate
        });
      }

      adminLogger.info('All retention policies applied', {
        totalPolicies: policies.length,
        totalDeleted,
        duration: Date.now() - startTime
      });
    } catch (error) {
      adminLogger.error('Failed to apply retention policies', {
        error: error instanceof Error ? error.message : 'Unknown error',
        policies: policies.length,
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Cache management methods
   */
  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiry > new Date()) {
      return cached.data;
    }
    
    if (cached) {
      this.cache.delete(key);
    }
    
    return null;
  }

  private setCache(key: string, data: any, tags: string[] = [], ttl: number = this.CACHE_TTL): void {
    const expiry = new Date(Date.now() + ttl);
    this.cache.set(key, { key, data, expiry, tags });
  }

  public clearCache(tag?: string): void {
    if (tag) {
      for (const [key, cached] of this.cache.entries()) {
        if (cached.tags.includes(tag)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Helper methods for data processing
   */
  private async getTotalEvents(startDate: Date, endDate: Date): Promise<number> {
    return await AnalyticsEvent.countDocuments({
      timestamp: { $gte: startDate, $lte: endDate }
    });
  }

  private async getUniqueUsers(startDate: Date, endDate: Date): Promise<number> {
    const users = await AnalyticsEvent.distinct('userId', {
      timestamp: { $gte: startDate, $lte: endDate },
      userId: { $exists: true }
    });
    return users.length;
  }

  private async getActiveUsers(startDate: Date, endDate: Date): Promise<number> {
    // Users who had activity in the last 24 hours of the period
    const last24Hours = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    const users = await AnalyticsEvent.distinct('userId', {
      timestamp: { $gte: Math.max(startDate.getTime(), last24Hours.getTime()), $lte: endDate },
      userId: { $exists: true }
    });
    return users.length;
  }

  private async getGameMetrics(startDate: Date, endDate: Date): Promise<any> {
    const gameStats = await AnalyticsEvent.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate, $lte: endDate },
          eventType: { $in: ['GAME_START', 'GAME_END', 'PLAYER_JOIN', 'PLAYER_LEAVE'] }
        }
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 }
        }
      }
    ]);

    return gameStats.reduce((acc: any, stat: any) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});
  }

  private async getErrorMetrics(startDate: Date, endDate: Date): Promise<any> {
    const [totalErrors, errorsByType, errorsBySeverity] = await Promise.all([
      ErrorLog.countDocuments({
        timestamp: { $gte: startDate, $lte: endDate }
      }),
      ErrorLog.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$errorType',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),
      ErrorLog.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$severity',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    return {
      totalErrors,
      byType: errorsByType,
      bySeverity: errorsBySeverity
    };
  }

  private async getPerformanceMetrics(startDate: Date, endDate: Date): Promise<any> {
    const performanceStats = await PerformanceMetric.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$metricName',
          avg: { $avg: '$value' },
          min: { $min: '$value' },
          max: { $max: '$value' },
          count: { $sum: 1 }
        }
      }
    ]);

    const responseTimeMetric = performanceStats.find(stat => stat._id === 'response_time');
    
    return {
      avgResponseTime: responseTimeMetric ? responseTimeMetric.avg : 0,
      metrics: performanceStats
    };
  }

  private async getUserEngagementMetrics(startDate: Date, endDate: Date): Promise<any> {
    const engagement = await AnalyticsEvent.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate, $lte: endDate },
          userId: { $exists: true }
        }
      },
      {
        $group: {
          _id: '$userId',
          eventCount: { $sum: 1 },
          firstEvent: { $min: '$timestamp' },
          lastEvent: { $max: '$timestamp' }
        }
      },
      {
        $project: {
          eventCount: 1,
          sessionDuration: {
            $divide: [
              { $subtract: ['$lastEvent', '$firstEvent'] },
              1000 // Convert to seconds
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgEventsPerUser: { $avg: '$eventCount' },
          avgSessionDuration: { $avg: '$sessionDuration' },
          totalUsers: { $sum: 1 }
        }
      }
    ]);

    return engagement[0] || {
      avgEventsPerUser: 0,
      avgSessionDuration: 0,
      totalUsers: 0
    };
  }

  private async getSystemHealthMetrics(startDate: Date, endDate: Date): Promise<any> {
    return {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      nodeVersion: process.version,
      platform: process.platform
    };
  }

  private getDateFormat(granularity: string): string {
    switch (granularity) {
      case 'hour':
        return '%Y-%m-%d %H:00:00';
      case 'day':
        return '%Y-%m-%d';
      case 'week':
        return '%Y-W%U';
      case 'month':
        return '%Y-%m';
      default:
        return '%Y-%m-%d';
    }
  }

  private calculatePeriodComparison(current: any[], previous: any[]): any {
    const currentTotal = current.reduce((sum, item) => sum + item.count, 0);
    const previousTotal = previous.reduce((sum, item) => sum + item.count, 0);
    
    const change = currentTotal - previousTotal;
    const percentChange = previousTotal > 0 ? (change / previousTotal) * 100 : 0;

    return {
      change,
      percentChange: Math.round(percentChange * 100) / 100,
      trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable'
    };
  }

  private flattenDataForCSV(data: any[]): any[] {
    return data.map(item => {
      const flattened: any = {};
      
      const flatten = (obj: any, prefix = '') => {
        for (const key in obj) {
          if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)) {
            flatten(obj[key], prefix + key + '_');
          } else {
            flattened[prefix + key] = obj[key];
          }
        }
      };
      
      flatten(item);
      return flattened;
    });
  }

  private async archiveData(collection: string, data: any[]): Promise<void> {
    const archiveDir = path.join(process.cwd(), 'archives');
    await fs.mkdir(archiveDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(archiveDir, `${collection}_archive_${timestamp}.json`);
    
    await fs.writeFile(archivePath, JSON.stringify(data, null, 2));
    
    adminLogger.info('Data archived', {
      collection,
      recordCount: data.length,
      archivePath
    });
  }
}

export const adminAnalyticsService = new AdminAnalyticsService();