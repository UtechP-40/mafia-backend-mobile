import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { adminLogger, logAdminSecurity } from '../config/logger';
import { createAdminAuthError, AdminOperationalError } from './errorHandler';

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: 'super_admin' | 'admin' | 'moderator';
  permissions: string[];
  isActive: boolean;
  lastLogin?: Date;
}

export interface AuthenticatedAdminRequest extends Request {
  user: AdminUser;
}

// Admin authentication middleware
export const adminAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logAdminSecurity('Admin auth attempt without token', req.ip, req.get('User-Agent'), {
        path: req.path,
        method: req.method
      });
      throw createAdminAuthError('Admin authentication token required');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    const adminJwtSecret = process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET;
    if (!adminJwtSecret) {
      adminLogger.error('Admin JWT secret not configured');
      throw new AdminOperationalError('Admin authentication configuration error', 500, 'ADMIN_CONFIG_ERROR');
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, adminJwtSecret);
    } catch (jwtError) {
      logAdminSecurity('Admin invalid token attempt', req.ip, req.get('User-Agent'), {
        path: req.path,
        method: req.method,
        error: jwtError instanceof Error ? jwtError.message : 'Unknown JWT error'
      });
      
      if (jwtError instanceof jwt.TokenExpiredError) {
        throw new AdminOperationalError('Admin token expired', 401, 'ADMIN_TOKEN_EXPIRED');
      } else if (jwtError instanceof jwt.JsonWebTokenError) {
        throw new AdminOperationalError('Invalid admin token', 401, 'ADMIN_INVALID_TOKEN');
      }
      throw createAdminAuthError('Admin token verification failed');
    }

    // Validate token payload
    if (!decoded.id || !decoded.role || !decoded.isAdmin) {
      logAdminSecurity('Admin token with invalid payload', req.ip, req.get('User-Agent'), {
        path: req.path,
        method: req.method,
        tokenPayload: decoded
      });
      throw createAdminAuthError('Invalid admin token payload');
    }

    // TODO: In a real implementation, you would fetch the user from the admin database
    // For now, we'll use the token payload directly
    const adminUser: AdminUser = {
      id: decoded.id,
      username: decoded.username || 'admin',
      email: decoded.email || 'admin@example.com',
      role: decoded.role,
      permissions: decoded.permissions || [],
      isActive: decoded.isActive !== false,
      lastLogin: decoded.lastLogin ? new Date(decoded.lastLogin) : undefined
    };

    // Check if admin user is active
    if (!adminUser.isActive) {
      logAdminSecurity('Inactive admin user access attempt', req.ip, req.get('User-Agent'), {
        userId: adminUser.id,
        username: adminUser.username,
        path: req.path,
        method: req.method
      });
      throw createAdminAuthError('Admin account is inactive');
    }

    // Attach admin user to request
    (req as AuthenticatedAdminRequest).user = adminUser;

    // Log successful admin authentication
    adminLogger.info('Admin authenticated successfully', {
      userId: adminUser.id,
      username: adminUser.username,
      role: adminUser.role,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });

    next();

  } catch (error) {
    next(error);
  }
};

// Permission checking middleware factory
export const requireAdminPermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const adminUser = (req as AuthenticatedAdminRequest).user;
      
      if (!adminUser) {
        throw createAdminAuthError('Admin authentication required');
      }

      // Super admins have all permissions
      if (adminUser.role === 'super_admin') {
        return next();
      }

      // Check if user has the required permission
      if (!adminUser.permissions.includes(permission)) {
        logAdminSecurity('Admin insufficient permissions', req.ip, req.get('User-Agent'), {
          userId: adminUser.id,
          username: adminUser.username,
          role: adminUser.role,
          requiredPermission: permission,
          userPermissions: adminUser.permissions,
          path: req.path,
          method: req.method
        });
        throw new AdminOperationalError(
          `Admin permission '${permission}' required`,
          403,
          'ADMIN_INSUFFICIENT_PERMISSIONS',
          { requiredPermission: permission }
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// Role checking middleware factory
export const requireAdminRole = (roles: string | string[]) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const adminUser = (req as AuthenticatedAdminRequest).user;
      
      if (!adminUser) {
        throw createAdminAuthError('Admin authentication required');
      }

      if (!allowedRoles.includes(adminUser.role)) {
        logAdminSecurity('Admin insufficient role', req.ip, req.get('User-Agent'), {
          userId: adminUser.id,
          username: adminUser.username,
          userRole: adminUser.role,
          requiredRoles: allowedRoles,
          path: req.path,
          method: req.method
        });
        throw new AdminOperationalError(
          `Admin role must be one of: ${allowedRoles.join(', ')}`,
          403,
          'ADMIN_INSUFFICIENT_ROLE',
          { requiredRoles: allowedRoles, userRole: adminUser.role }
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};