import { Router, Request, Response } from 'express';
import { AdminAuthService, AdminLoginCredentials, AdminRegistrationData, PasswordResetData, PasswordResetConfirmData } from '../services/AdminAuthService';
import { adminAsyncHandler, AdminOperationalError } from '../middleware/errorHandler';
import { adminLogger, logAdminSecurity } from '../config/logger';
import { AuthenticatedAdminRequest, requireAdminPermission, adminAuthMiddleware } from '../middleware/auth';
import { Permission } from '../models/SuperUser';

const router = Router();

// Rate limiting for admin auth endpoints
import rateLimit from 'express-rate-limit';

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Very strict for admin endpoints
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
    retryAfter: 900 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logAdminSecurity('Admin auth rate limit exceeded', req.ip || 'unknown', req.get('User-Agent'), {
      path: req.path,
      method: req.method
    });
    res.status(429).json({
      error: 'Too many authentication attempts from this IP, please try again later.',
      retryAfter: 900
    });
  }
});

const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 2, // Only 2 registration attempts per hour
  message: {
    error: 'Too many registration attempts from this IP, please try again later.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Input validation middleware
const validateRegistrationInput = (req: Request, res: Response, next: any) => {
  const { username, email, password, firstName, lastName, requestedPermissions, justification } = req.body;

  const errors: string[] = [];

  if (!username || typeof username !== 'string' || username.length < 3 || username.length > 30) {
    errors.push('Username must be between 3 and 30 characters');
  }

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Valid email address is required');
  }

  if (!password || typeof password !== 'string') {
    errors.push('Password is required');
  }

  if (!firstName || typeof firstName !== 'string' || firstName.length < 1 || firstName.length > 50) {
    errors.push('First name must be between 1 and 50 characters');
  }

  if (!lastName || typeof lastName !== 'string' || lastName.length < 1 || lastName.length > 50) {
    errors.push('Last name must be between 1 and 50 characters');
  }

  if (!Array.isArray(requestedPermissions) || requestedPermissions.length === 0) {
    errors.push('At least one permission must be requested');
  }

  if (!justification || typeof justification !== 'string' || justification.length < 10) {
    errors.push('Justification must be at least 10 characters long');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

const validateLoginInput = (req: Request, res: Response, next: any) => {
  const { username, email, password } = req.body;

  const errors: string[] = [];

  if (!password || typeof password !== 'string') {
    errors.push('Password is required');
  }

  if ((!username || typeof username !== 'string') && (!email || typeof email !== 'string')) {
    errors.push('Username or email is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};

/**
 * POST /admin/auth/register
 * Register a new admin user (requires approval)
 */
router.post('/register', 
  registrationRateLimit,
  validateRegistrationInput,
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { username, email, password, firstName, lastName, requestedPermissions, justification }: AdminRegistrationData = req.body;

    // Validate requested permissions
    const validPermissions = Object.values(Permission);
    const invalidPermissions = requestedPermissions.filter(p => !validPermissions.includes(p));
    
    if (invalidPermissions.length > 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid permissions requested',
        invalidPermissions
      });
      return;
    }

    // Prevent direct super admin registration
    if (requestedPermissions.includes(Permission.SUPER_ADMIN)) {
      logAdminSecurity('Admin registration attempt with super admin permission', req.ip || 'unknown', req.get('User-Agent'), {
        username,
        email,
        requestedPermissions
      });
      res.status(400).json({
        success: false,
        message: 'Super admin permission cannot be requested directly'
      });
      return;
    }

    const result = await AdminAuthService.register({
      username,
      email,
      password,
      firstName,
      lastName,
      requestedPermissions,
      justification
    }, req.ip);

    if (result.success) {
      res.status(201).json({
        success: true,
        message: result.message,
        requiresApproval: result.requiresApproval
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  })
);

/**
 * POST /admin/auth/login
 * Login with username/email and password
 */
router.post('/login', 
  authRateLimit,
  validateLoginInput,
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { username, email, password, twoFactorCode }: AdminLoginCredentials = req.body;

    const result = await AdminAuthService.login({
      username,
      email,
      password,
      twoFactorCode
    }, req.ip, req.get('User-Agent'));

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: result.message
      });
    }
  })
);

/**
 * POST /admin/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', 
  authRateLimit,
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
      return;
    }

    const result = await AdminAuthService.refreshToken(refreshToken, req.ip);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        }
      });
    } else {
      res.status(401).json({
        success: false,
        message: result.message
      });
    }
  })
);

/**
 * POST /admin/auth/logout
 * Logout and invalidate refresh token
 */
router.post('/logout', 
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
      return;
    }

    const result = await AdminAuthService.logout(refreshToken, req.ip);

    res.status(200).json({
      success: result.success,
      message: result.message
    });
  })
);

/**
 * POST /admin/auth/logout-all
 * Logout from all devices (invalidate all refresh tokens)
 */
router.post('/logout-all', 
  // This endpoint requires authentication
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const userId = req.adminUser?.id;

    if (!userId) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    const result = await AdminAuthService.logoutAll(userId, req.ip);

    res.status(200).json({
      success: result.success,
      message: result.message
    });
  })
);

/**
 * POST /admin/auth/password-reset
 * Initiate password reset
 */
router.post('/password-reset', 
  authRateLimit,
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email }: PasswordResetData = req.body;

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        success: false,
        message: 'Valid email address is required'
      });
      return;
    }

    const result = await AdminAuthService.initiatePasswordReset({ email }, req.ip);

    res.status(200).json({
      success: result.success,
      message: result.message
    });
  })
);

/**
 * POST /admin/auth/password-reset/confirm
 * Confirm password reset with token
 */
router.post('/password-reset/confirm', 
  authRateLimit,
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { token, newPassword }: PasswordResetConfirmData = req.body;

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Reset token is required'
      });
      return;
    }

    if (!newPassword || typeof newPassword !== 'string') {
      res.status(400).json({
        success: false,
        message: 'New password is required'
      });
      return;
    }

    const result = await AdminAuthService.confirmPasswordReset({ token, newPassword }, req.ip);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  })
);

/**
 * GET /admin/auth/me
 * Get current authenticated admin user profile
 */
router.get('/me', 
  adminAuthMiddleware,
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const adminUser = req.adminUser;

    if (!adminUser) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    // Get full user details from database
    const fullUser = await AdminAuthService.getAdminUserById(adminUser.id);
    
    if (!fullUser) {
      throw new AdminOperationalError('Admin user not found', 404, 'ADMIN_USER_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      message: 'Admin profile retrieved successfully',
      data: {
        user: fullUser
      }
    });
  })
);

/**
 * POST /admin/auth/verify-token
 * Verify if access token is valid
 */
router.post('/verify-token', 
  adminAuthMiddleware,
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const adminUser = req.adminUser;

    if (!adminUser) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    res.status(200).json({
      success: true,
      message: 'Token is valid',
      data: {
        userId: adminUser.id,
        username: adminUser.username,
        role: adminUser.role,
        permissions: adminUser.permissions
      }
    });
  })
);

/**
 * POST /admin/auth/approve-registration
 * Approve a pending admin registration (super admin only)
 */
router.post('/approve-registration',
  requireAdminPermission(Permission.ADMIN_APPROVE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const { userId } = req.body;
    const approverId = req.adminUser?.id;

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
      return;
    }

    if (!approverId) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    const result = await AdminAuthService.approveRegistration(userId, approverId, req.ip);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  })
);

/**
 * POST /admin/auth/reject-registration
 * Reject a pending admin registration (super admin only)
 */
router.post('/reject-registration',
  requireAdminPermission(Permission.ADMIN_APPROVE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const { userId, reason } = req.body;
    const approverId = req.adminUser?.id;

    if (!userId || typeof userId !== 'string') {
      res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
      return;
    }

    if (!reason || typeof reason !== 'string' || reason.length < 5) {
      res.status(400).json({
        success: false,
        message: 'Rejection reason is required (minimum 5 characters)'
      });
      return;
    }

    if (!approverId) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    const result = await AdminAuthService.rejectRegistration(userId, approverId, reason, req.ip);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  })
);

/**
 * GET /admin/auth/password-policy
 * Get password policy requirements
 */
router.get('/password-policy', 
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      success: true,
      message: 'Password policy retrieved successfully',
      data: {
        policy: {
          minLength: 12,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialChars: true,
          forbiddenPatterns: [
            'password', 'admin', '123456', 'qwerty', 'letmein',
            'welcome', 'monkey', 'dragon', 'master', 'shadow'
          ],
          rules: [
            'Must be at least 12 characters long',
            'Must contain at least one uppercase letter',
            'Must contain at least one lowercase letter', 
            'Must contain at least one number',
            'Must contain at least one special character',
            'Cannot contain common patterns or dictionary words',
            'Cannot contain repeated characters',
            'Cannot contain sequential characters'
          ]
        }
      }
    });
  })
);

export default router;