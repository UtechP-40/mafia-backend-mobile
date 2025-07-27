import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { adminLogger, logAdminSecurity } from '../config/logger';
import { createAdminAuthError, AdminOperationalError } from './errorHandler';
import { AdminAuthService, AdminJWTPayload } from '../services/AdminAuthService';
import { Permission, SuperUserStatus } from '../models/SuperUser';

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  permissions: Permission[];
  status: SuperUserStatus;
  isActive: boolean;
  lastLogin?: Date;
}

export interface AuthenticatedAdminRequest extends Request {
  adminUser: AdminUser;
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
      logAdminSecurity('Admin auth attempt without token', req.ip || 'unknown', req.get('User-Agent'), {
        path: req.path,
        method: req.method
      });
      throw createAdminAuthError('Admin authentication token required');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token using AdminAuthService
    const decoded = AdminAuthService.verifyAccessToken(token);
    if (!decoded) {
      logAdminSecurity('Admin invalid token attempt', req.ip || 'unknown', req.get('User-Agent'), {
        path: req.path,
        method: req.method
      });
      throw new AdminOperationalError('Invalid or expired admin token', 401, 'ADMIN_INVALID_TOKEN');
    }

    // Validate token payload
    if (!decoded.userId || !decoded.isAdmin) {
      logAdminSecurity('Admin token with invalid payload', req.ip || 'unknown', req.get('User-Agent'), {
        path: req.path,
        method: req.method,
        tokenPayload: decoded
      });
      throw createAdminAuthError('Invalid admin token payload');
    }

    // Fetch current user from database to ensure account is still valid
    const dbUser = await AdminAuthService.getAdminUserById(decoded.userId);
    if (!dbUser) {
      logAdminSecurity('Admin token for non-existent user', req.ip || 'unknown', req.get('User-Agent'), {
        userId: decoded.userId,
        path: req.path,
        method: req.method
      });
      throw createAdminAuthError('Admin user not found');
    }

    // Check if admin user account is approved and active
    if (dbUser.status !== SuperUserStatus.APPROVED) {
      logAdminSecurity('Admin access attempt with non-approved account', req.ip || 'unknown', req.get('User-Agent'), {
        userId: dbUser._id.toString(),
        username: dbUser.username,
        status: dbUser.status,
        path: req.path,
        method: req.method
      });
      throw createAdminAuthError('Admin account is not approved');
    }

    // Check if account is locked
    if (dbUser.isLocked) {
      logAdminSecurity('Admin access attempt on locked account', req.ip || 'unknown', req.get('User-Agent'), {
        userId: dbUser._id.toString(),
        username: dbUser.username,
        lockUntil: dbUser.lockUntil,
        path: req.path,
        method: req.method
      });
      throw createAdminAuthError('Admin account is locked');
    }

    // Create admin user object for request
    const adminUser: AdminUser = {
      id: dbUser._id.toString(),
      username: dbUser.username,
      email: dbUser.email,
      permissions: dbUser.permissions,
      status: dbUser.status,
      isActive: dbUser.status === SuperUserStatus.APPROVED,
      lastLogin: dbUser.lastLogin
    };

    // Attach admin user to request
    (req as AuthenticatedAdminRequest).adminUser = adminUser;

    // Log successful admin authentication
    adminLogger.info('Admin authenticated successfully', {
      userId: adminUser.id,
      username: adminUser.username,
      permissions: adminUser.permissions,
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
export const requireAdminPermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const adminUser = (req as AuthenticatedAdminRequest).adminUser;
      
      if (!adminUser) {
        throw createAdminAuthError('Admin authentication required');
      }

      // Super admins have all permissions
      if (adminUser.permissions.includes(Permission.SUPER_ADMIN)) {
        return next();
      }

      // Check if user has the required permission
      if (!adminUser.permissions.includes(permission)) {
        logAdminSecurity('Admin insufficient permissions', req.ip || 'unknown', req.get('User-Agent'), {
          userId: adminUser.id,
          username: adminUser.username,
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

// Multiple permissions checking middleware factory
export const requireAnyAdminPermission = (permissions: Permission[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const adminUser = (req as AuthenticatedAdminRequest).adminUser;
      
      if (!adminUser) {
        throw createAdminAuthError('Admin authentication required');
      }

      // Super admins have all permissions
      if (adminUser.permissions.includes(Permission.SUPER_ADMIN)) {
        return next();
      }

      // Check if user has any of the required permissions
      const hasPermission = permissions.some(permission => adminUser.permissions.includes(permission));
      
      if (!hasPermission) {
        logAdminSecurity('Admin insufficient permissions (any)', req.ip || 'unknown', req.get('User-Agent'), {
          userId: adminUser.id,
          username: adminUser.username,
          requiredPermissions: permissions,
          userPermissions: adminUser.permissions,
          path: req.path,
          method: req.method
        });
        throw new AdminOperationalError(
          `Admin requires one of the following permissions: ${permissions.join(', ')}`,
          403,
          'ADMIN_INSUFFICIENT_PERMISSIONS',
          { requiredPermissions: permissions }
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

// All permissions checking middleware factory
export const requireAllAdminPermissions = (permissions: Permission[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const adminUser = (req as AuthenticatedAdminRequest).adminUser;
      
      if (!adminUser) {
        throw createAdminAuthError('Admin authentication required');
      }

      // Super admins have all permissions
      if (adminUser.permissions.includes(Permission.SUPER_ADMIN)) {
        return next();
      }

      // Check if user has all required permissions
      const missingPermissions = permissions.filter(permission => !adminUser.permissions.includes(permission));
      
      if (missingPermissions.length > 0) {
        logAdminSecurity('Admin insufficient permissions (all)', req.ip || 'unknown', req.get('User-Agent'), {
          userId: adminUser.id,
          username: adminUser.username,
          requiredPermissions: permissions,
          missingPermissions: missingPermissions,
          userPermissions: adminUser.permissions,
          path: req.path,
          method: req.method
        });
        throw new AdminOperationalError(
          `Admin missing required permissions: ${missingPermissions.join(', ')}`,
          403,
          'ADMIN_INSUFFICIENT_PERMISSIONS',
          { requiredPermissions: permissions, missingPermissions }
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};