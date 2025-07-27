import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { performance } from 'perf_hooks';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, traceId, userId, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      service: service || 'mafia-game-backend',
      traceId,
      userId,
      ...meta
    });
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, service, traceId, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    const traceStr = traceId ? `[${traceId}]` : '';
    return `${timestamp} ${level} ${traceStr} ${message} ${metaStr}`;
  })
);

// Create Winston logger instance
const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: structuredFormat,
  defaultMeta: {
    service: 'mafia-game-backend',
    hostname: require('os').hostname(),
    pid: process.pid
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development' ? consoleFormat : structuredFormat,
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'info'
    }),

    // Daily rotate file for all logs
    new DailyRotateFile({
      filename: path.join(logsDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: structuredFormat
    }),

    // Separate file for errors
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
      format: structuredFormat
    }),

    // Performance logs
    new DailyRotateFile({
      filename: path.join(logsDir, 'performance-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '7d',
      format: structuredFormat
    }),

    // Security logs
    new DailyRotateFile({
      filename: path.join(logsDir, 'security-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '90d',
      format: structuredFormat
    })
  ],
  
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'rejections.log') })
  ]
});

// Log correlation and tracing
class LogContext {
  private static contexts = new Map<string, any>();
  
  static setContext(traceId: string, context: any) {
    this.contexts.set(traceId, context);
  }
  
  static getContext(traceId: string) {
    return this.contexts.get(traceId) || {};
  }
  
  static clearContext(traceId: string) {
    this.contexts.delete(traceId);
  }
  
  static generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Enhanced logger with additional functionality
export class Logger {
  private traceId?: string;
  private userId?: string;
  private service?: string;

  constructor(options: { traceId?: string; userId?: string; service?: string } = {}) {
    this.traceId = options.traceId;
    this.userId = options.userId;
    this.service = options.service;
  }

  private log(level: string, message: string, meta: any = {}) {
    const logData = {
      ...meta,
      traceId: this.traceId,
      userId: this.userId,
      service: this.service,
      timestamp: new Date().toISOString()
    };

    winstonLogger.log(level, message, logData);
  }

  info(message: string, meta?: any) {
    this.log('info', message, meta);
  }

  error(message: string, error?: Error | any, meta?: any) {
    const errorMeta = error instanceof Error ? {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    } : { error };

    this.log('error', message, { ...errorMeta, ...meta });
  }

  warn(message: string, meta?: any) {
    this.log('warn', message, meta);
  }

  debug(message: string, meta?: any) {
    this.log('debug', message, meta);
  }

  // Performance logging
  performance(operation: string, duration: number, meta?: any) {
    this.log('info', `Performance: ${operation}`, {
      category: 'performance',
      operation,
      duration,
      ...meta
    });
  }

  // Security logging
  security(event: string, meta?: any) {
    this.log('warn', `Security: ${event}`, {
      category: 'security',
      event,
      ...meta
    });
  }

  // Database operation logging
  database(operation: string, collection: string, duration?: number, meta?: any) {
    this.log('info', `Database: ${operation} on ${collection}`, {
      category: 'database',
      operation,
      collection,
      duration,
      ...meta
    });
  }

  // API request logging
  api(method: string, path: string, statusCode: number, duration: number, meta?: any) {
    this.log('info', `API: ${method} ${path} - ${statusCode}`, {
      category: 'api',
      method,
      path,
      statusCode,
      duration,
      ...meta
    });
  }

  // Game event logging
  game(event: string, gameId: string, playerId?: string, meta?: any) {
    this.log('info', `Game: ${event}`, {
      category: 'game',
      event,
      gameId,
      playerId,
      ...meta
    });
  }

  // Create child logger with additional context
  child(context: { traceId?: string; userId?: string; service?: string }) {
    return new Logger({
      traceId: context.traceId || this.traceId,
      userId: context.userId || this.userId,
      service: context.service || this.service
    });
  }

  // Measure and log function execution time
  async measureAsync<T>(operation: string, fn: () => Promise<T>, meta?: any): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.performance(operation, duration, { ...meta, success: true });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.performance(operation, duration, { ...meta, success: false });
      this.error(`Operation failed: ${operation}`, error);
      throw error;
    }
  }

  measure<T>(operation: string, fn: () => T, meta?: any): T {
    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      this.performance(operation, duration, { ...meta, success: true });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.performance(operation, duration, { ...meta, success: false });
      this.error(`Operation failed: ${operation}`, error);
      throw error;
    }
  }
}

// Default logger instance
export const logger = new Logger();

// Log context utilities
export { LogContext };

// Middleware for request logging and tracing
export const loggingMiddleware = (req: any, res: any, next: any) => {
  const traceId = LogContext.generateTraceId();
  const startTime = performance.now();
  
  // Add trace ID to request
  req.traceId = traceId;
  req.logger = new Logger({ traceId, userId: req.user?.id });
  
  // Log request start
  req.logger.api(req.method, req.path, 0, 0, {
    event: 'request_start',
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    body: req.method !== 'GET' ? req.body : undefined
  });

  // Log response
  res.on('finish', () => {
    const duration = performance.now() - startTime;
    req.logger.api(req.method, req.path, res.statusCode, duration, {
      event: 'request_end',
      responseSize: res.get('Content-Length')
    });
  });

  next();
};

// Error logging middleware
export const errorLoggingMiddleware = (error: any, req: any, res: any, next: any) => {
  const logger = req.logger || new Logger();
  
  logger.error('Unhandled error in request', error, {
    method: req.method,
    path: req.path,
    body: req.body,
    params: req.params,
    query: req.query,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  next(error);
};

// Log aggregation utilities
export class LogAggregator {
  static async getLogsByLevel(level: string, startTime?: Date, endTime?: Date) {
    // This would typically query a log aggregation service
    // For now, we'll return a placeholder
    return {
      level,
      count: 0,
      logs: [],
      timeRange: { start: startTime, end: endTime }
    };
  }

  static async getLogsByCategory(category: string, startTime?: Date, endTime?: Date) {
    return {
      category,
      count: 0,
      logs: [],
      timeRange: { start: startTime, end: endTime }
    };
  }

  static async searchLogs(query: string, startTime?: Date, endTime?: Date) {
    return {
      query,
      count: 0,
      logs: [],
      timeRange: { start: startTime, end: endTime }
    };
  }
}

// Log analytics
export class LogAnalytics {
  static async getErrorPatterns(timeRange: { start: Date; end: Date }) {
    return {
      patterns: [],
      anomalies: [],
      trends: []
    };
  }

  static async getPerformanceInsights(timeRange: { start: Date; end: Date }) {
    return {
      slowOperations: [],
      performanceTrends: [],
      bottlenecks: []
    };
  }
}

export default logger;