import winston from 'winston';
import { adminLogger, adminPerformanceLogger, adminSecurityLogger, adminAuditLogger } from '../config/logger';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: string;
  message: string;
  service: string;
  category?: string;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
  metadata?: Record<string, any>;
  source?: string;
  tags?: string[];
}

export interface LogFilter {
  level?: string;
  category?: string;
  service?: string;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
  startTime?: Date;
  endTime?: Date;
  search?: string;
  tags?: string[];
}

export interface LogRetentionConfig {
  maxAge: number; // days
  maxSize: number; // bytes
  maxFiles: number;
  compress: boolean;
  archivePath?: string;
}

export interface LogCorrelation {
  correlationId: string;
  entries: LogEntry[];
  startTime: Date;
  endTime?: Date;
  services: string[];
  users: string[];
  tags: string[];
}

export class LoggingService extends EventEmitter {
  private correlationMap = new Map<string, LogCorrelation>();
  private logBuffer: LogEntry[] = [];
  private readonly BUFFER_SIZE = 1000;
  private readonly CORRELATION_TTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    super();
    this.setupCleanupInterval();
  }

  /**
   * Create structured log entry with correlation tracking
   */
  async createLogEntry(
    level: string,
    message: string,
    metadata: Record<string, any> = {},
    options: {
      category?: string;
      userId?: string;
      sessionId?: string;
      correlationId?: string;
      tags?: string[];
    } = {}
  ): Promise<LogEntry> {
    const logEntry: LogEntry = {
      id: this.generateLogId(),
      timestamp: new Date(),
      level,
      message,
      service: 'admin-portal',
      category: options.category,
      userId: options.userId,
      sessionId: options.sessionId,
      correlationId: options.correlationId || this.generateCorrelationId(),
      metadata,
      tags: options.tags || []
    };

    // Add to correlation tracking
    if (logEntry.correlationId) {
      this.addToCorrelation(logEntry);
    }

    // Add to buffer for real-time streaming
    this.addToBuffer(logEntry);

    // Log to appropriate logger
    await this.writeToLogger(logEntry);

    // Emit event for real-time subscribers
    this.emit('logEntry', logEntry);

    return logEntry;
  }

  /**
   * Get logs with advanced filtering and search
   */
  async getLogs(
    filter: LogFilter,
    options: {
      limit?: number;
      offset?: number;
      sortBy?: 'timestamp' | 'level' | 'service';
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{ logs: LogEntry[]; total: number; hasMore: boolean }> {
    const { limit = 100, offset = 0, sortBy = 'timestamp', sortOrder = 'desc' } = options;

    try {
      // Read from log files
      const logs = await this.readLogsFromFiles(filter);

      // Apply additional filtering
      let filteredLogs = this.applyFilters(logs, filter);

      // Apply sorting
      filteredLogs = this.sortLogs(filteredLogs, sortBy, sortOrder);

      const total = filteredLogs.length;
      const paginatedLogs = filteredLogs.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return {
        logs: paginatedLogs,
        total,
        hasMore
      };
    } catch (error) {
      adminLogger.error('Failed to get logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filter
      });
      throw error;
    }
  }

  /**
   * Get log correlation by correlation ID
   */
  async getLogCorrelation(correlationId: string): Promise<LogCorrelation | null> {
    // Check in-memory correlation first
    const memoryCorrelation = this.correlationMap.get(correlationId);
    if (memoryCorrelation) {
      return memoryCorrelation;
    }

    // Search in log files for correlation
    try {
      const logs = await this.readLogsFromFiles({ correlationId });
      if (logs.length === 0) {
        return null;
      }

      const correlation: LogCorrelation = {
        correlationId,
        entries: logs,
        startTime: new Date(Math.min(...logs.map(log => log.timestamp.getTime()))),
        endTime: new Date(Math.max(...logs.map(log => log.timestamp.getTime()))),
        services: [...new Set(logs.map(log => log.service))],
        users: [...new Set(logs.map(log => log.userId).filter(Boolean))],
        tags: [...new Set(logs.flatMap(log => log.tags || []))]
      };

      return correlation;
    } catch (error) {
      adminLogger.error('Failed to get log correlation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        correlationId
      });
      return null;
    }
  }

  /**
   * Stream logs in real-time
   */
  streamLogs(filter: LogFilter, callback: (log: LogEntry) => void): () => void {
    const listener = (log: LogEntry) => {
      if (this.matchesFilter(log, filter)) {
        callback(log);
      }
    };

    this.on('logEntry', listener);

    // Return unsubscribe function
    return () => {
      this.off('logEntry', listener);
    };
  }

  /**
   * Analyze log patterns and trends
   */
  async analyzeLogPatterns(
    startTime: Date,
    endTime: Date,
    options: {
      groupBy?: 'level' | 'category' | 'service' | 'hour' | 'day';
      includeAnomalies?: boolean;
    } = {}
  ): Promise<any> {
    const { groupBy = 'level', includeAnomalies = false } = options;

    try {
      const logs = await this.readLogsFromFiles({
        startTime,
        endTime
      });

      const analysis: any = {
        totalLogs: logs.length,
        timeRange: { startTime, endTime },
        patterns: {},
        trends: {},
        summary: {}
      };

      // Group logs by specified criteria
      const grouped = this.groupLogs(logs, groupBy);
      analysis.patterns = grouped;

      // Calculate trends
      if (groupBy === 'hour' || groupBy === 'day') {
        analysis.trends = this.calculateTrends(grouped);
      }

      // Generate summary statistics
      analysis.summary = {
        errorRate: this.calculateErrorRate(logs),
        topCategories: this.getTopCategories(logs),
        topServices: this.getTopServices(logs),
        averageLogsPerHour: logs.length / ((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60))
      };

      // Detect anomalies if requested
      if (includeAnomalies) {
        analysis.anomalies = await this.detectAnomalies(logs);
      }

      return analysis;
    } catch (error) {
      adminLogger.error('Failed to analyze log patterns', {
        error: error instanceof Error ? error.message : 'Unknown error',
        startTime,
        endTime
      });
      throw error;
    }
  }

  /**
   * Apply log retention policies
   */
  async applyRetentionPolicy(config: LogRetentionConfig): Promise<void> {
    try {
      const logsDir = path.join(process.cwd(), 'logs', 'admin');
      const files = await fs.readdir(logsDir);

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(logsDir, file);
        const stats = await fs.stat(filePath);

        // Check age
        const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
        if (ageInDays > config.maxAge) {
          if (config.archivePath) {
            await this.archiveLogFile(filePath, config.archivePath);
          }
          await fs.unlink(filePath);
          adminLogger.info('Log file deleted due to retention policy', {
            file,
            ageInDays,
            maxAge: config.maxAge
          });
          continue;
        }

        // Check size
        if (stats.size > config.maxSize) {
          await this.rotateLogFile(filePath, config);
        }
      }

      // Clean up old rotated files
      await this.cleanupRotatedFiles(logsDir, config.maxFiles);

    } catch (error) {
      adminLogger.error('Failed to apply retention policy', {
        error: error instanceof Error ? error.message : 'Unknown error',
        config
      });
      throw error;
    }
  }

  /**
   * Export logs in various formats
   */
  async exportLogs(
    filter: LogFilter,
    format: 'json' | 'csv' | 'txt',
    outputPath?: string
  ): Promise<string> {
    try {
      const logs = await this.readLogsFromFiles(filter);
      const filteredLogs = this.applyFilters(logs, filter);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = outputPath || path.join(process.cwd(), 'exports', `logs_export_${timestamp}.${format}`);

      // Ensure export directory exists
      await fs.mkdir(path.dirname(filename), { recursive: true });

      switch (format) {
        case 'json':
          await fs.writeFile(filename, JSON.stringify(filteredLogs, null, 2));
          break;

        case 'csv':
          const csvContent = this.convertLogsToCSV(filteredLogs);
          await fs.writeFile(filename, csvContent);
          break;

        case 'txt':
          const txtContent = filteredLogs
            .map(log => `${log.timestamp.toISOString()} [${log.level.toUpperCase()}] ${log.service}: ${log.message}`)
            .join('\n');
          await fs.writeFile(filename, txtContent);
          break;

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      adminLogger.info('Logs exported', {
        format,
        filename,
        logCount: filteredLogs.length
      });

      return filename;
    } catch (error) {
      adminLogger.error('Failed to export logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filter,
        format
      });
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private addToCorrelation(logEntry: LogEntry): void {
    if (!logEntry.correlationId) return;

    let correlation = this.correlationMap.get(logEntry.correlationId);
    if (!correlation) {
      correlation = {
        correlationId: logEntry.correlationId,
        entries: [],
        startTime: logEntry.timestamp,
        services: [],
        users: [],
        tags: []
      };
      this.correlationMap.set(logEntry.correlationId, correlation);
    }

    correlation.entries.push(logEntry);
    correlation.endTime = logEntry.timestamp;
    
    if (logEntry.service && !correlation.services.includes(logEntry.service)) {
      correlation.services.push(logEntry.service);
    }
    
    if (logEntry.userId && !correlation.users.includes(logEntry.userId)) {
      correlation.users.push(logEntry.userId);
    }
    
    if (logEntry.tags) {
      for (const tag of logEntry.tags) {
        if (!correlation.tags.includes(tag)) {
          correlation.tags.push(tag);
        }
      }
    }
  }

  private addToBuffer(logEntry: LogEntry): void {
    this.logBuffer.push(logEntry);
    if (this.logBuffer.length > this.BUFFER_SIZE) {
      this.logBuffer.shift(); // Remove oldest entry
    }
  }

  private async writeToLogger(logEntry: LogEntry): Promise<void> {
    const logData = {
      timestamp: logEntry.timestamp,
      level: logEntry.level,
      message: logEntry.message,
      service: logEntry.service,
      category: logEntry.category,
      userId: logEntry.userId,
      sessionId: logEntry.sessionId,
      correlationId: logEntry.correlationId,
      ...logEntry.metadata
    };

    switch (logEntry.category) {
      case 'security':
        adminSecurityLogger.log(logEntry.level, logEntry.message, logData);
        break;
      case 'audit':
        adminAuditLogger.log(logEntry.level, logEntry.message, logData);
        break;
      case 'performance':
        adminPerformanceLogger.log(logEntry.level, logEntry.message, logData);
        break;
      default:
        adminLogger.log(logEntry.level, logEntry.message, logData);
    }
  }

  private async readLogsFromFiles(filter: LogFilter): Promise<LogEntry[]> {
    const logsDir = path.join(process.cwd(), 'logs', 'admin');
    const files = await fs.readdir(logsDir);
    const logFiles = files.filter(file => file.endsWith('.log'));

    const allLogs: LogEntry[] = [];

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const logData = JSON.parse(line);
            const logEntry: LogEntry = {
              id: logData.id || this.generateLogId(),
              timestamp: new Date(logData.timestamp),
              level: logData.level,
              message: logData.message,
              service: logData.service || 'admin-portal',
              category: logData.category,
              userId: logData.userId,
              sessionId: logData.sessionId,
              correlationId: logData.correlationId,
              metadata: logData,
              source: file,
              tags: logData.tags || []
            };

            allLogs.push(logEntry);
          } catch (parseError) {
            // Skip invalid JSON lines
            continue;
          }
        }
      } catch (fileError) {
        // Skip files that can't be read
        continue;
      }
    }

    return allLogs;
  }

  private applyFilters(logs: LogEntry[], filter: LogFilter): LogEntry[] {
    return logs.filter(log => this.matchesFilter(log, filter));
  }

  private matchesFilter(log: LogEntry, filter: LogFilter): boolean {
    if (filter.level && log.level !== filter.level) return false;
    if (filter.category && log.category !== filter.category) return false;
    if (filter.service && log.service !== filter.service) return false;
    if (filter.userId && log.userId !== filter.userId) return false;
    if (filter.sessionId && log.sessionId !== filter.sessionId) return false;
    if (filter.correlationId && log.correlationId !== filter.correlationId) return false;
    if (filter.startTime && log.timestamp < filter.startTime) return false;
    if (filter.endTime && log.timestamp > filter.endTime) return false;
    
    if (filter.search) {
      const searchTerm = filter.search.toLowerCase();
      const searchableText = `${log.message} ${JSON.stringify(log.metadata)}`.toLowerCase();
      if (!searchableText.includes(searchTerm)) return false;
    }

    if (filter.tags && filter.tags.length > 0) {
      const logTags = log.tags || [];
      if (!filter.tags.some(tag => logTags.includes(tag))) return false;
    }

    return true;
  }

  private sortLogs(logs: LogEntry[], sortBy: string, sortOrder: string): LogEntry[] {
    return logs.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'timestamp':
          comparison = a.timestamp.getTime() - b.timestamp.getTime();
          break;
        case 'level':
          comparison = a.level.localeCompare(b.level);
          break;
        case 'service':
          comparison = a.service.localeCompare(b.service);
          break;
        default:
          comparison = a.timestamp.getTime() - b.timestamp.getTime();
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }

  private groupLogs(logs: LogEntry[], groupBy: string): Record<string, any> {
    const grouped: Record<string, any> = {};

    for (const log of logs) {
      let key: string;
      
      switch (groupBy) {
        case 'level':
          key = log.level;
          break;
        case 'category':
          key = log.category || 'uncategorized';
          break;
        case 'service':
          key = log.service;
          break;
        case 'hour':
          key = log.timestamp.toISOString().substr(0, 13) + ':00:00';
          break;
        case 'day':
          key = log.timestamp.toISOString().substr(0, 10);
          break;
        default:
          key = log.level;
      }

      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(log);
    }

    // Convert to count-based grouping for analysis
    const result: Record<string, any> = {};
    for (const [key, entries] of Object.entries(grouped)) {
      result[key] = {
        count: entries.length,
        entries: entries.slice(0, 10) // Include sample entries
      };
    }

    return result;
  }

  private calculateTrends(grouped: Record<string, any>): any {
    const sortedKeys = Object.keys(grouped).sort();
    const trends: any = {
      growth: {},
      patterns: {}
    };

    // Calculate growth rates
    for (let i = 1; i < sortedKeys.length; i++) {
      const current = grouped[sortedKeys[i]].count;
      const previous = grouped[sortedKeys[i - 1]].count;
      const growth = previous > 0 ? ((current - previous) / previous) * 100 : 0;
      
      trends.growth[sortedKeys[i]] = {
        current,
        previous,
        growth: Math.round(growth * 100) / 100
      };
    }

    return trends;
  }

  private calculateErrorRate(logs: LogEntry[]): number {
    const errorLogs = logs.filter(log => log.level === 'error').length;
    return logs.length > 0 ? (errorLogs / logs.length) * 100 : 0;
  }

  private getTopCategories(logs: LogEntry[]): Array<{ category: string; count: number }> {
    const categories: Record<string, number> = {};
    
    for (const log of logs) {
      const category = log.category || 'uncategorized';
      categories[category] = (categories[category] || 0) + 1;
    }

    return Object.entries(categories)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private getTopServices(logs: LogEntry[]): Array<{ service: string; count: number }> {
    const services: Record<string, number> = {};
    
    for (const log of logs) {
      services[log.service] = (services[log.service] || 0) + 1;
    }

    return Object.entries(services)
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private async detectAnomalies(logs: LogEntry[]): Promise<any[]> {
    // Simple anomaly detection based on log frequency
    const hourlyGroups = this.groupLogs(logs, 'hour');
    const counts = Object.values(hourlyGroups).map((group: any) => group.count);
    
    if (counts.length < 3) return [];

    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + (2 * stdDev); // 2 standard deviations

    const anomalies: any[] = [];
    for (const [hour, group] of Object.entries(hourlyGroups)) {
      const count = (group as any).count;
      if (count > threshold) {
        anomalies.push({
          timestamp: hour,
          count,
          threshold,
          severity: count > (mean + 3 * stdDev) ? 'high' : 'medium',
          type: 'high_frequency'
        });
      }
    }

    return anomalies;
  }

  private convertLogsToCSV(logs: LogEntry[]): string {
    const headers = ['timestamp', 'level', 'service', 'category', 'message', 'userId', 'sessionId', 'correlationId'];
    const csvRows = [headers.join(',')];

    for (const log of logs) {
      const row = [
        log.timestamp.toISOString(),
        log.level,
        log.service,
        log.category || '',
        `"${log.message.replace(/"/g, '""')}"`,
        log.userId || '',
        log.sessionId || '',
        log.correlationId || ''
      ];
      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  private async archiveLogFile(filePath: string, archivePath: string): Promise<void> {
    await fs.mkdir(archivePath, { recursive: true });
    const filename = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFilename = `${timestamp}_${filename}`;
    const archiveFullPath = path.join(archivePath, archiveFilename);
    
    await fs.copyFile(filePath, archiveFullPath);
    adminLogger.info('Log file archived', { filePath, archiveFullPath });
  }

  private async rotateLogFile(filePath: string, config: LogRetentionConfig): Promise<void> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = path.join(dir, `${basename}_${timestamp}${ext}`);
    
    await fs.rename(filePath, rotatedPath);
    adminLogger.info('Log file rotated', { filePath, rotatedPath });
  }

  private async cleanupRotatedFiles(logsDir: string, maxFiles: number): Promise<void> {
    const files = await fs.readdir(logsDir);
    const rotatedFiles = files
      .filter(file => file.includes('_') && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(logsDir, file),
        mtime: 0
      }));

    // Get file stats
    for (const file of rotatedFiles) {
      try {
        const stats = await fs.stat(file.path);
        file.mtime = stats.mtime.getTime();
      } catch (error) {
        // Skip files that can't be accessed
        continue;
      }
    }

    // Sort by modification time (oldest first)
    rotatedFiles.sort((a, b) => a.mtime - b.mtime);

    // Delete excess files
    if (rotatedFiles.length > maxFiles) {
      const filesToDelete = rotatedFiles.slice(0, rotatedFiles.length - maxFiles);
      for (const file of filesToDelete) {
        try {
          await fs.unlink(file.path);
          adminLogger.info('Rotated log file deleted', { file: file.name });
        } catch (error) {
          adminLogger.error('Failed to delete rotated log file', {
            file: file.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
  }

  private setupCleanupInterval(): void {
    // Clean up old correlations every hour
    setInterval(() => {
      const now = Date.now();
      for (const [correlationId, correlation] of this.correlationMap.entries()) {
        if (now - correlation.startTime.getTime() > this.CORRELATION_TTL) {
          this.correlationMap.delete(correlationId);
        }
      }
    }, 60 * 60 * 1000); // 1 hour
  }
}

export const loggingService = new LoggingService();