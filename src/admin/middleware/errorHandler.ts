import { Request, Response, NextFunction } from 'express';
import { adminLogger, logAdminError } from '../config/logger';

export interface AdminError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
  isOperational?: boolean;
}

// Custom admin error class
export class AdminOperationalError extends Error implements AdminError {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;
  public details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'ADMIN_ERROR', details?: any) {
    super(message);
    this.name = 'AdminOperationalError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Admin-specific error handler middleware
export const adminErrorHandler = (
  error: AdminError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log the error with admin context
  logAdminError(error, {
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
    body: req.method !== 'GET' ? req.body : undefined,
    query: req.query
  });

  // Default error values
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal Admin Server Error';
  let code = error.code || 'ADMIN_INTERNAL_ERROR';

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    code = 'ADMIN_VALIDATION_ERROR';
    message = 'Admin validation failed';
  } else if (error.name === 'CastError') {
    statusCode = 400;
    code = 'ADMIN_INVALID_ID';
    message = 'Invalid admin resource ID';
  } else if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    statusCode = 500;
    code = 'ADMIN_DATABASE_ERROR';
    message = 'Admin database operation failed';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'ADMIN_INVALID_TOKEN';
    message = 'Invalid admin authentication token';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'ADMIN_TOKEN_EXPIRED';
    message = 'Admin authentication token expired';
  }

  // Prepare error response
  const errorResponse: any = {
    error: {
      message,
      code,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method
    }
  };

  // Include additional details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = error.stack;
    errorResponse.error.details = error.details;
  }

  // Include request ID if available
  if ((req as any).requestId) {
    errorResponse.error.requestId = (req as any).requestId;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

// Async error wrapper for admin routes
export const adminAsyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Admin validation error helper
export const createAdminValidationError = (message: string, field?: string): AdminOperationalError => {
  return new AdminOperationalError(message, 400, 'ADMIN_VALIDATION_ERROR', { field });
};

// Admin authorization error helper
export const createAdminAuthError = (message: string = 'Admin access denied'): AdminOperationalError => {
  return new AdminOperationalError(message, 403, 'ADMIN_ACCESS_DENIED');
};

// Admin not found error helper
export const createAdminNotFoundError = (resource: string): AdminOperationalError => {
  return new AdminOperationalError(`Admin ${resource} not found`, 404, 'ADMIN_NOT_FOUND', { resource });
};

// Admin rate limit error helper
export const createAdminRateLimitError = (): AdminOperationalError => {
  return new AdminOperationalError(
    'Too many admin requests, please try again later',
    429,
    'ADMIN_RATE_LIMIT_EXCEEDED'
  );
};