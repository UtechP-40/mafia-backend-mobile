import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest, adminAuthMiddleware } from '../middleware/auth';
import { adminLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';
import authRoutes from './auth';
import approvalRoutes from './approvals';
import databaseRoutes from './database';
import analyticsRoutes from './analytics';
import reportsRoutes from './reports';
import apiTestingRoutes from './apiTesting';
import automatedTestingRoutes from './automatedTesting';
import socketMonitoringRoutes from './socketMonitoring';
import monitoringRoutes from './monitoring';
import gameRoomsRoutes from './gameRooms';
import securityRoutes from './security';
import docsRoutes from './docs';
import userManagementRoutes from './userManagement';
import systemConfigurationRoutes from './systemConfiguration';
import maintenanceRoutes from './maintenance';
import securityMonitoringRoutes from './securityMonitoring';

const router = Router();

// Mount auth routes (no authentication required for these)
router.use('/auth', authRoutes);

// Mount approval routes (authentication required)
router.use('/approvals', adminAuthMiddleware, approvalRoutes);

// Mount database routes (authentication required)
router.use('/database', adminAuthMiddleware, databaseRoutes);

// Mount analytics routes (authentication required)
router.use('/analytics', analyticsRoutes);

// Mount reports routes (authentication required)
router.use('/reports', reportsRoutes);

// Mount API testing routes (authentication required)
router.use('/api-testing', adminAuthMiddleware, apiTestingRoutes);

// Mount automated testing routes (authentication required)
router.use('/automated-testing', adminAuthMiddleware, automatedTestingRoutes);

// Mount socket monitoring routes (authentication required)
router.use('/socket-monitoring', adminAuthMiddleware, socketMonitoringRoutes);

// Mount monitoring routes (authentication required)
router.use('/monitoring', adminAuthMiddleware, monitoringRoutes);

// Mount game rooms routes (authentication required)
router.use('/game-rooms', adminAuthMiddleware, gameRoomsRoutes);

// Mount security routes (authentication required)
router.use('/security', adminAuthMiddleware, securityRoutes);

// Mount API docs routes (authentication required)
router.use('/docs', adminAuthMiddleware, docsRoutes);

// Mount user management routes (authentication required)
router.use('/user-management', adminAuthMiddleware, userManagementRoutes);

// Mount system configuration routes (authentication required)
router.use('/system-configuration', adminAuthMiddleware, systemConfigurationRoutes);

// Mount maintenance routes (authentication required)
router.use('/maintenance', adminAuthMiddleware, maintenanceRoutes);

// Mount security monitoring routes (authentication required)
router.use('/security-monitoring', adminAuthMiddleware, securityMonitoringRoutes);

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