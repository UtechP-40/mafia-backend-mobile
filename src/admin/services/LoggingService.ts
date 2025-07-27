import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Transform } from 'stream';
import { Logger } from '../../utils/logger';
import { adminLogger } from '../config/logger';
import archiver from 'archiver';
import { promisify } from 'util';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  service?: string;
  traceId?: string;
  userId?: string;
  category?: string;
  metadata?: any;
  raw?: string;
}

export interface LogFilter {
  level?: string[];
  service?: string[];
  category?: string[];
  userId?: string;
  traceId?: string;
  startTime?: Date;
  endTime?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LogPattern {
  pattern: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  examples: LogEntry[];
}

export interface LogAnomaly {
  type: 'spike' | 'drop' | 'pattern' | 'error_rate';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  data: any;
  affectedServices: string[];
}

export interface LogStatistics {
  totalEntries: number;
  entriesByLevel: Record<string, number>;
  entriesByService: Record<string, number>;
  entriesByCategory: Record<string, number>;
  timeRange: { start: Date; end: Date };
  topErrors: Array<{ message: string; count: number }>;
  performanceMetrics: {
    avgResponseTime: number;
    slowestOperations: Array<{ operation: string; avgTime: number }>;
  };
}

export class LoggingService extends EventEmitter {
  private static instance: LoggingService;
  private logger: Logger;
  private logsDirectory: string;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private streamSubscriptions: Map<string, (entry: LogEntry) => void> = new Map();
  private logCache: Map<string, LogEntry[]> = new Map();
  private cacheMaxSize = 10000;
  private cacheMaxAge = 60 * 60 * 1000; // 1 hour

  private constructor() {
    super();
    this.logger = new Logger({ service: 'logging-service' });
    this.logsDirectory = path.join(process.cwd(), 'logs');
    this.setupLogWatchers();
    this.setupCacheCleanup();
  }

  static getInstance(): LoggingService {
    if (!LoggingService.instance) {
      LoggingService.instance = new LoggingService();
    }
    return LoggingService.instance;
  }

  private setupLogWatchers(): void {
    try {
      if (!fs.existsSync(this.logsDirectory)) {
        fs.mkdirSync(this.logsDirectory, { recursive: true });
      }

      // Watch for new log files
      const dirWatcher = fs.watch(this.logsDirectory, (eventType, filename) => {
        if (eventType === 'rename' && filename && filename.endsWith('.log')) {
          this.setupFileWatcher(filename);
        }
      });

      // Setup watchers for existing log files
      const files = fs.readdirSync(this.logsDirectory);
      files.forEach(file => {
        if (file.endsWith('.log')) {
          this.setupFileWatcher(file);
        }
      });

      this.logger.info('Log watchers initialized', { 
        directory: this.logsDirectory,
        filesWatched: files.length
      });

    } catch (error) {
      this.logger.error('Failed to setup log watchers', error);
    }
  }

  private setupFileWatcher(filename: string): void {
    const filePath = path.join(this.logsDirectory, filename);
    
    if (this.watchers.has(filename)) {
      this.watchers.get(filename)?.close();
    }

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          this.processNewLogEntries(filePath);
        }
      });

      this.watchers.set(filename, watcher);
      
      // Process existing content
      this.processNewLogEntries(filePath);

    } catch (error) {
      this.logger.error('Failed to setup file watcher', { filename, error });
    }
  }

  private async processNewLogEntries(filePath: string): Promise<void> {
    try {
      const stats = await promisify(fs.stat)(filePath);
      const filename = path.basename(filePath);
      
      // Get last processed position
      const lastPosition = (this as any)[`lastPosition_${filename}`] || 0;
      
      if (stats.size <= lastPosition) {
        return; // No new content
      }

      // Read new content
      const stream = fs.createReadStream(filePath, { 
        start: lastPosition,
        encoding: 'utf8'
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      const newEntries: LogEntry[] = [];

      for await (const line of rl) {
        if (line.trim()) {
          const entry = this.parseLogEntry(line);
          if (entry) {
            newEntries.push(entry);
            
            // Emit to stream subscribers
            this.streamSubscriptions.forEach(callback => {
              try {
                callback(entry);
              } catch (error) {
                this.logger.error('Error in stream callback', error);
              }
            });
          }
        }
      }

      // Update cache
      if (newEntries.length > 0) {
        this.updateCache(filename, newEntries);
        this.emit('new-log-entries', { filename, entries: newEntries });
      }

      // Update last position
      (this as any)[`lastPosition_${filename}`] = stats.size;

    } catch (error) {
      this.logger.error('Failed to process new log entries', { filePath, error });
    }
  }

  private parseLogEntry(line: string): LogEntry | null {
    try {
      // Try to parse as JSON first (structured logs)
      const parsed = JSON.parse(line);
      
      return {
        timestamp: parsed.timestamp || new Date().toISOString(),
        level: parsed.level || 'info',
        message: parsed.message || '',
        service: parsed.service,
        traceId: parsed.traceId,
        userId: parsed.userId,
        category: parsed.category,
        metadata: parsed,
        raw: line
      };
    } catch {
      // Fallback to regex parsing for non-JSON logs
      const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(\w+)\s+(.+)$/);
      
      if (match) {
        return {
          timestamp: match[1],
          level: match[2].toLowerCase(),
          message: match[3],
          raw: line
        };
      }
      
      // If all else fails, treat as raw message
      return {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: line,
        raw: line
      };
    }
  }

  private updateCache(filename: string, entries: LogEntry[]): void {
    const cacheKey = filename;
    let cached = this.logCache.get(cacheKey) || [];
    
    cached.push(...entries);
    
    // Limit cache size
    if (cached.length > this.cacheMaxSize) {
      cached = cached.slice(-this.cacheMaxSize);
    }
    
    this.logCache.set(cacheKey, cached);
  }

  private setupCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      
      for (const [key, entries] of this.logCache.entries()) {
        const filtered = entries.filter(entry => {
          const entryTime = new Date(entry.timestamp).getTime();
          return now - entryTime < this.cacheMaxAge;
        });
        
        if (filtered.length !== entries.length) {
          this.logCache.set(key, filtered);
        }
      }
    }, 5 * 60 * 1000); // Clean every 5 minutes
  }

  /**
   * Stream logs in real-time with filtering
   */
  public streamLogs(filter: LogFilter, callback: (entry: LogEntry) => void): () => void {
    const subscriptionId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const filteredCallback = (entry: LogEntry) => {
      if (this.matchesFilter(entry, filter)) {
        callback(entry);
      }
    };
    
    this.streamSubscriptions.set(subscriptionId, filteredCallback);
    
    // Return unsubscribe function
    return () => {
      this.streamSubscriptions.delete(subscriptionId);
    };
  }

  /**
   * Search logs with filtering and pagination
   */
  public async searchLogs(filter: LogFilter): Promise<{
    entries: LogEntry[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const allEntries: LogEntry[] = [];
      
      // Get entries from cache first
      for (const entries of this.logCache.values()) {
        allEntries.push(...entries);
      }
      
      // If cache is insufficient, read from files
      if (allEntries.length < (filter.limit || 100)) {
        const fileEntries = await this.readFromLogFiles(filter);
        allEntries.push(...fileEntries);
      }
      
      // Apply filters
      const filtered = allEntries.filter(entry => this.matchesFilter(entry, filter));
      
      // Sort by timestamp (newest first)
      filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      // Apply pagination
      const offset = filter.offset || 0;
      const limit = filter.limit || 100;
      const paginatedEntries = filtered.slice(offset, offset + limit);
      
      return {
        entries: paginatedEntries,
        total: filtered.length,
        hasMore: offset + limit < filtered.length
      };
      
    } catch (error) {
      this.logger.error('Failed to search logs', error);
      throw error;
    }
  }

  private async readFromLogFiles(filter: LogFilter): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    
    try {
      const files = await promisify(fs.readdir)(this.logsDirectory);
      const logFiles = files.filter(file => file.endsWith('.log'));
      
      for (const file of logFiles) {
        const filePath = path.join(this.logsDirectory, file);
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });
        
        for await (const line of rl) {
          if (line.trim()) {
            const entry = this.parseLogEntry(line);
            if (entry && this.matchesFilter(entry, filter)) {
              entries.push(entry);
              
              // Stop if we have enough entries
              if (entries.length >= (filter.limit || 100) * 2) {
                break;
              }
            }
          }
        }
      }
      
    } catch (error) {
      this.logger.error('Failed to read from log files', error);
    }
    
    return entries;
  }

  private matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
    // Level filter
    if (filter.level && filter.level.length > 0) {
      if (!filter.level.includes(entry.level)) {
        return false;
      }
    }
    
    // Service filter
    if (filter.service && filter.service.length > 0) {
      if (!entry.service || !filter.service.includes(entry.service)) {
        return false;
      }
    }
    
    // Category filter
    if (filter.category && filter.category.length > 0) {
      if (!entry.category || !filter.category.includes(entry.category)) {
        return false;
      }
    }
    
    // User ID filter
    if (filter.userId && entry.userId !== filter.userId) {
      return false;
    }
    
    // Trace ID filter
    if (filter.traceId && entry.traceId !== filter.traceId) {
      return false;
    }
    
    // Time range filter
    const entryTime = new Date(entry.timestamp);
    if (filter.startTime && entryTime < filter.startTime) {
      return false;
    }
    if (filter.endTime && entryTime > filter.endTime) {
      return false;
    }
    
    // Search filter
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const searchableText = `${entry.message} ${entry.service || ''} ${JSON.stringify(entry.metadata || {})}`.toLowerCase();
      if (!searchableText.includes(searchLower)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Get log statistics for a time range
   */
  public async getLogStatistics(timeRange: { start: Date; end: Date }): Promise<LogStatistics> {
    try {
      const filter: LogFilter = {
        startTime: timeRange.start,
        endTime: timeRange.end,
        limit: 50000 // Large limit for statistics
      };
      
      const { entries } = await this.searchLogs(filter);
      
      const stats: LogStatistics = {
        totalEntries: entries.length,
        entriesByLevel: {},
        entriesByService: {},
        entriesByCategory: {},
        timeRange,
        topErrors: [],
        performanceMetrics: {
          avgResponseTime: 0,
          slowestOperations: []
        }
      };
      
      const errorMessages: Map<string, number> = new Map();
      const operationTimes: Map<string, number[]> = new Map();
      
      // Process entries
      entries.forEach(entry => {
        // Count by level
        stats.entriesByLevel[entry.level] = (stats.entriesByLevel[entry.level] || 0) + 1;
        
        // Count by service
        if (entry.service) {
          stats.entriesByService[entry.service] = (stats.entriesByService[entry.service] || 0) + 1;
        }
        
        // Count by category
        if (entry.category) {
          stats.entriesByCategory[entry.category] = (stats.entriesByCategory[entry.category] || 0) + 1;
        }
        
        // Collect error messages
        if (entry.level === 'error') {
          const count = errorMessages.get(entry.message) || 0;
          errorMessages.set(entry.message, count + 1);
        }
        
        // Collect performance data
        if (entry.category === 'performance' && entry.metadata?.duration) {
          const operation = entry.metadata.operation || 'unknown';
          const times = operationTimes.get(operation) || [];
          times.push(entry.metadata.duration);
          operationTimes.set(operation, times);
        }
      });
      
      // Top errors
      stats.topErrors = Array.from(errorMessages.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([message, count]) => ({ message, count }));
      
      // Performance metrics
      const allTimes: number[] = [];
      stats.performanceMetrics.slowestOperations = Array.from(operationTimes.entries())
        .map(([operation, times]) => {
          const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
          allTimes.push(...times);
          return { operation, avgTime };
        })
        .sort((a, b) => b.avgTime - a.avgTime)
        .slice(0, 10);
      
      if (allTimes.length > 0) {
        stats.performanceMetrics.avgResponseTime = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;
      }
      
      return stats;
      
    } catch (error) {
      this.logger.error('Failed to get log statistics', error);
      throw error;
    }
  }

  /**
   * Detect patterns and anomalies in logs
   */
  public async detectPatterns(timeRange: { start: Date; end: Date }): Promise<{
    patterns: LogPattern[];
    anomalies: LogAnomaly[];
  }> {
    try {
      const filter: LogFilter = {
        startTime: timeRange.start,
        endTime: timeRange.end,
        limit: 10000
      };
      
      const { entries } = await this.searchLogs(filter);
      
      // Pattern detection
      const messagePatterns: Map<string, LogPattern> = new Map();
      
      entries.forEach(entry => {
        // Simple pattern extraction (could be enhanced with ML)
        const pattern = this.extractPattern(entry.message);
        
        if (messagePatterns.has(pattern)) {
          const existing = messagePatterns.get(pattern)!;
          existing.count++;
          existing.lastSeen = new Date(entry.timestamp);
          if (existing.examples.length < 5) {
            existing.examples.push(entry);
          }
        } else {
          messagePatterns.set(pattern, {
            pattern,
            count: 1,
            firstSeen: new Date(entry.timestamp),
            lastSeen: new Date(entry.timestamp),
            severity: this.determineSeverity(entry.level, pattern),
            examples: [entry]
          });
        }
      });
      
      // Anomaly detection
      const anomalies = await this.detectAnomalies(entries, timeRange);
      
      return {
        patterns: Array.from(messagePatterns.values())
          .filter(p => p.count > 1)
          .sort((a, b) => b.count - a.count),
        anomalies
      };
      
    } catch (error) {
      this.logger.error('Failed to detect patterns', error);
      throw error;
    }
  }

  private extractPattern(message: string): string {
    // Simple pattern extraction - replace numbers, IDs, and timestamps with placeholders
    return message
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '[TIMESTAMP]')
      .replace(/\b\d+\b/g, '[NUMBER]')
      .replace(/\b[a-f0-9]{24}\b/g, '[OBJECT_ID]')
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, '[UUID]')
      .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '[IP_ADDRESS]');
  }

  private determineSeverity(level: string, pattern: string): 'low' | 'medium' | 'high' | 'critical' {
    if (level === 'error') {
      if (pattern.includes('database') || pattern.includes('connection')) {
        return 'critical';
      }
      return 'high';
    }
    if (level === 'warn') {
      return 'medium';
    }
    return 'low';
  }

  private async detectAnomalies(entries: LogEntry[], timeRange: { start: Date; end: Date }): Promise<LogAnomaly[]> {
    const anomalies: LogAnomaly[] = [];
    
    // Error rate spike detection
    const errorsByHour: Map<string, number> = new Map();
    const totalByHour: Map<string, number> = new Map();
    
    entries.forEach(entry => {
      const hour = new Date(entry.timestamp).toISOString().substring(0, 13);
      
      totalByHour.set(hour, (totalByHour.get(hour) || 0) + 1);
      
      if (entry.level === 'error') {
        errorsByHour.set(hour, (errorsByHour.get(hour) || 0) + 1);
      }
    });
    
    // Calculate error rates and detect spikes
    const errorRates: Array<{ hour: string; rate: number }> = [];
    
    for (const [hour, total] of totalByHour.entries()) {
      const errors = errorsByHour.get(hour) || 0;
      const rate = (errors / total) * 100;
      errorRates.push({ hour, rate });
    }
    
    // Find average error rate
    const avgErrorRate = errorRates.reduce((sum, { rate }) => sum + rate, 0) / errorRates.length;
    
    // Detect spikes (rate > 2x average and > 10%)
    errorRates.forEach(({ hour, rate }) => {
      if (rate > avgErrorRate * 2 && rate > 10) {
        anomalies.push({
          type: 'error_rate',
          description: `Error rate spike detected: ${rate.toFixed(2)}% (avg: ${avgErrorRate.toFixed(2)}%)`,
          severity: rate > 50 ? 'critical' : rate > 25 ? 'high' : 'medium',
          timestamp: new Date(hour + ':00:00.000Z'),
          data: { rate, average: avgErrorRate, hour },
          affectedServices: []
        });
      }
    });
    
    return anomalies;
  }

  /**
   * Export logs to various formats
   */
  public async exportLogs(
    filter: LogFilter,
    format: 'json' | 'csv' | 'txt',
    compress: boolean = false
  ): Promise<Buffer> {
    try {
      const { entries } = await this.searchLogs({ ...filter, limit: 50000 });
      
      let content: string;
      
      switch (format) {
        case 'json':
          content = JSON.stringify(entries, null, 2);
          break;
          
        case 'csv':
          content = this.convertToCSV(entries);
          break;
          
        case 'txt':
          content = entries.map(entry => 
            `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.service || 'unknown'}: ${entry.message}`
          ).join('\n');
          break;
          
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
      
      if (compress) {
        return await this.compressContent(content);
      }
      
      return Buffer.from(content, 'utf8');
      
    } catch (error) {
      this.logger.error('Failed to export logs', error);
      throw error;
    }
  }

  private convertToCSV(entries: LogEntry[]): string {
    const headers = ['timestamp', 'level', 'service', 'category', 'message', 'traceId', 'userId'];
    const csvLines = [headers.join(',')];
    
    entries.forEach(entry => {
      const row = headers.map(header => {
        const value = (entry as any)[header] || '';
        // Escape quotes and wrap in quotes if contains comma
        const escaped = String(value).replace(/"/g, '""');
        return escaped.includes(',') ? `"${escaped}"` : escaped;
      });
      csvLines.push(row.join(','));
    });
    
    return csvLines.join('\n');
  }

  private async compressContent(content: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      
      archive.append(content, { name: 'logs.txt' });
      archive.finalize();
    });
  }

  /**
   * Clean up resources
   */
  public shutdown(): void {
    // Close all file watchers
    this.watchers.forEach(watcher => watcher.close());
    this.watchers.clear();
    
    // Clear subscriptions
    this.streamSubscriptions.clear();
    
    // Clear cache
    this.logCache.clear();
    
    this.logger.info('Logging service shut down');
  }
}

export const loggingService = LoggingService.getInstance();