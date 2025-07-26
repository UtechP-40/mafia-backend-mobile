import winston from 'winston';
import path from 'path';

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs', 'admin');

// Custom format for admin logs
const adminLogFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const logEntry = {
      timestamp,
      level,
      service: 'admin-portal',
      message,
      ...meta
    };
    return JSON.stringify(logEntry);
  })
);

// Create admin logger instance
export const adminLogger = winston.createLogger({
  level: process.env.ADMIN_LOG_LEVEL || 'info',
  format: adminLogFormat,
  defaultMeta: {
    service: 'admin-portal',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
          return `${timestamp} [ADMIN] ${level}: ${message} ${metaStr}`;
        })
      )
    }),

    // File transport for all admin logs
    new winston.transports.File({
      filename: path.join(logsDir, 'admin.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      tailable: true
    }),

    // Separate file for admin errors
    new winston.transports.File({
      filename: path.join(logsDir, 'admin-error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),

    // Separate file for admin security events
    new winston.transports.File({
      filename: path.join(logsDir, 'admin-security.log'),
      level: 'warn',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      tailable: true,
      format: winston.format.combine(
        adminLogFormat,
        winston.format.printf((info) => {
          // Only log security-related events
          if (info.security || info.auth || info.ip || info.userAgent) {
            return JSON.stringify(info);
          }
          return '';
        })
      )
    })
  ],

  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'admin-exceptions.log'),
      maxsize: 5242880,
      maxFiles: 3
    })
  ],

  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'admin-rejections.log'),
      maxsize: 5242880,
      maxFiles: 3
    })
  ]
});

// Create specialized loggers for different admin activities
export const adminSecurityLogger = adminLogger.child({
  category: 'security',
  security: true
});

export const adminAuditLogger = adminLogger.child({
  category: 'audit',
  audit: true
});

export const adminPerformanceLogger = adminLogger.child({
  category: 'performance',
  performance: true
});

// Helper functions for structured logging
export const logAdminActivity = (activity: string, userId: string, details?: any) => {
  adminAuditLogger.info('Admin activity', {
    activity,
    userId,
    timestamp: new Date().toISOString(),
    ...details
  });
};

export const logAdminSecurity = (event: string, ip: string, userAgent?: string, details?: any) => {
  adminSecurityLogger.warn('Admin security event', {
    event,
    ip,
    userAgent,
    timestamp: new Date().toISOString(),
    ...details
  });
};

export const logAdminError = (error: Error, context?: any) => {
  adminLogger.error('Admin error', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    ...context
  });
};

// Performance monitoring helper
export const logAdminPerformance = (operation: string, duration: number, details?: any) => {
  adminPerformanceLogger.info('Admin performance', {
    operation,
    duration,
    timestamp: new Date().toISOString(),
    ...details
  });
};