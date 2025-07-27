import { Router, Request, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest, adminAuthMiddleware } from '../middleware/auth';
import { adminLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';
import authRoutes from './auth';
import approvalRoutes from './approvals';

const router = Router();

// Mount auth routes (no authentication required for these)
router.use('/auth', authRoutes);

// Mount approval routes (authentication required)
router.use('/approvals', adminAuthMiddleware, approvalRoutes);

// Admin dashboard endpoint (requires authentication)
router.get('/dashboard', adminAuthMiddleware, adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
  const adminUser = req.adminUser;
  
  adminLogger.info('Admin dashboard accessed', {
    userId: adminUser.id,
    username: adminUser.username,
    permissions: adminUser.permissions
  });

  res.json({
    message: 'Admin dashboard data',
    user: {
      id: adminUser.id,
      username: adminUser.username,
      permissions: adminUser.permissions,
      status: adminUser.status
    },
    timestamp: new Date().toISOString(),
    stats: {
      // TODO: Implement actual stats
      totalUsers: 0,
      activeGames: 0,
      systemHealth: 'healthy'
    }
  });
}));

// Admin system info endpoint (requires system monitoring permission)
router.get('/system', 
  adminAuthMiddleware,
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('Admin system info accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    res.json({
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
      },
      database: {
        // TODO: Add database connection status
        status: 'connected'
      },
      timestamp: new Date().toISOString()
    });
  })
);

// Admin users management endpoint (requires user management permission)
router.get('/users',
  adminAuthMiddleware,
  requireAdminPermission(Permission.USER_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('Admin users list accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    // TODO: Implement actual user fetching from database
    res.json({
      users: [],
      total: 0,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 10,
      timestamp: new Date().toISOString()
    });
  })
);

// Admin logs endpoint (requires analytics read permission)
router.get('/logs',
  adminAuthMiddleware,
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('Admin logs accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      logType: req.query.type || 'all'
    });

    // TODO: Implement actual log fetching
    res.json({
      logs: [],
      total: 0,
      type: req.query.type || 'all',
      timestamp: new Date().toISOString()
    });
  })
);

export default router;