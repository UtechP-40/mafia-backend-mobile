import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { Permission } from '../models/SuperUser';
import MaintenanceService from '../services/MaintenanceService';
import { MaintenanceType, MaintenanceStatus, RecurrenceType } from '../models/MaintenanceSchedule';
import { Types } from 'mongoose';

const router = Router();
const maintenanceService = MaintenanceService.getInstance();

// Get maintenance schedules
router.get('/schedules',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      status,
      type,
      impactLevel,
      startDate,
      endDate,
      page = '1',
      limit = '20'
    } = req.query;

    const filters: any = {};
    if (status) filters.status = status as MaintenanceStatus;
    if (type) filters.type = type as MaintenanceType;
    if (impactLevel) filters.impactLevel = impactLevel as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const result = await maintenanceService.getMaintenanceSchedules(
      filters,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.json({
      success: true,
      data: result
    });
  })
);

// Create maintenance schedule
router.post('/schedules',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      title,
      description,
      type,
      scheduledStart,
      scheduledEnd,
      affectedServices,
      impactLevel,
      tasks,
      recurrence,
      notifications,
      approvals,
      rollbackPlan,
      healthChecks
    } = req.body;

    // Validate required fields
    if (!title || !description || !type || !scheduledStart || !scheduledEnd || !impactLevel) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Validate dates
    const startDate = new Date(scheduledStart);
    const endDate = new Date(scheduledEnd);
    
    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        error: 'Scheduled end must be after scheduled start'
      });
    }

    if (startDate <= new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Scheduled start must be in the future'
      });
    }

    const maintenance = await maintenanceService.createMaintenanceSchedule(
      {
        title,
        description,
        type: type as MaintenanceType,
        scheduledStart: startDate,
        scheduledEnd: endDate,
        affectedServices: affectedServices || [],
        impactLevel,
        tasks: tasks || [],
        recurrence,
        notifications,
        approvals,
        rollbackPlan,
        healthChecks
      },
      req.adminUser._id
    );

    res.status(201).json({
      success: true,
      data: maintenance
    });
  })
);

// Update maintenance schedule
router.put('/schedules/:id',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid maintenance ID'
      });
    }

    const updates = req.body;
    
    // Validate dates if provided
    if (updates.scheduledStart && updates.scheduledEnd) {
      const startDate = new Date(updates.scheduledStart);
      const endDate = new Date(updates.scheduledEnd);
      
      if (startDate >= endDate) {
        return res.status(400).json({
          success: false,
          error: 'Scheduled end must be after scheduled start'
        });
      }
    }

    const maintenance = await maintenanceService.updateMaintenanceSchedule(
      new Types.ObjectId(id),
      updates,
      req.adminUser._id
    );

    res.json({
      success: true,
      data: maintenance
    });
  })
);

// Start maintenance
router.post('/schedules/:id/start',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid maintenance ID'
      });
    }

    await maintenanceService.startMaintenance(
      new Types.ObjectId(id),
      req.adminUser._id
    );

    res.json({
      success: true,
      message: 'Maintenance started successfully'
    });
  })
);

// Complete maintenance
router.post('/schedules/:id/complete',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid maintenance ID'
      });
    }

    await maintenanceService.completeMaintenance(
      new Types.ObjectId(id),
      req.adminUser._id
    );

    res.json({
      success: true,
      message: 'Maintenance completed successfully'
    });
  })
);

// Cancel maintenance
router.post('/schedules/:id/cancel',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid maintenance ID'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Cancellation reason is required'
      });
    }

    await maintenanceService.cancelMaintenance(
      new Types.ObjectId(id),
      reason,
      req.adminUser._id
    );

    res.json({
      success: true,
      message: 'Maintenance cancelled successfully'
    });
  })
);

// Maintenance mode management
router.get('/mode',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const isEnabled = await maintenanceService.isMaintenanceModeEnabled();

    res.json({
      success: true,
      data: { enabled: isEnabled }
    });
  })
);

router.post('/mode/enable',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    await maintenanceService.enableMaintenanceMode(req.adminUser._id);

    res.json({
      success: true,
      message: 'Maintenance mode enabled'
    });
  })
);

router.post('/mode/disable',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    await maintenanceService.disableMaintenanceMode(req.adminUser._id);

    res.json({
      success: true,
      message: 'Maintenance mode disabled'
    });
  })
);

// Health checks
router.post('/health-checks',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { checks } = req.body;

    if (!Array.isArray(checks)) {
      return res.status(400).json({
        success: false,
        error: 'Checks must be an array'
      });
    }

    // Create a temporary maintenance object for health checks
    const tempMaintenance = {
      _id: new Types.ObjectId(),
      logs: [],
      addLog: function(level: string, message: string, details?: any) {
        this.logs.push({
          timestamp: new Date(),
          level,
          message,
          details
        });
      },
      save: async function() {
        // No-op for temporary object
      }
    } as any;

    const results = await maintenanceService.runHealthChecks(checks, tempMaintenance);

    res.json({
      success: true,
      data: {
        ...results,
        logs: tempMaintenance.logs
      }
    });
  })
);

// Maintenance statistics
router.get('/statistics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const statistics = await maintenanceService.getMaintenanceStatistics();

    res.json({
      success: true,
      data: statistics
    });
  })
);

// Maintenance types
router.get('/types',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const types = Object.values(MaintenanceType);

    res.json({
      success: true,
      data: types
    });
  })
);

// Maintenance statuses
router.get('/statuses',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const statuses = Object.values(MaintenanceStatus);

    res.json({
      success: true,
      data: statuses
    });
  })
);

// Recurrence types
router.get('/recurrence-types',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const recurrenceTypes = Object.values(RecurrenceType);

    res.json({
      success: true,
      data: recurrenceTypes
    });
  })
);

// Impact levels
router.get('/impact-levels',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const impactLevels = ['low', 'medium', 'high', 'critical'];

    res.json({
      success: true,
      data: impactLevels
    });
  })
);

// Predefined health checks
router.get('/health-checks/available',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const availableChecks = [
      {
        name: 'database_connection',
        description: 'Check database connectivity and response time',
        category: 'database'
      },
      {
        name: 'api_endpoints',
        description: 'Verify all API endpoints are responding',
        category: 'api'
      },
      {
        name: 'memory_usage',
        description: 'Check system memory usage',
        category: 'system'
      },
      {
        name: 'disk_space',
        description: 'Check available disk space',
        category: 'system'
      },
      {
        name: 'redis_connection',
        description: 'Check Redis cache connectivity',
        category: 'cache'
      },
      {
        name: 'external_services',
        description: 'Check external service dependencies',
        category: 'external'
      }
    ];

    res.json({
      success: true,
      data: availableChecks
    });
  })
);

// Maintenance templates
router.get('/templates',
  requireAdminPermission(Permission.SYSTEM_MAINTENANCE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const templates = [
      {
        id: 'database_maintenance',
        name: 'Database Maintenance',
        description: 'Standard database maintenance and optimization',
        type: MaintenanceType.SCHEDULED,
        impactLevel: 'medium',
        estimatedDuration: 120,
        tasks: [
          {
            id: 'backup_database',
            name: 'Create Database Backup',
            description: 'Create full database backup before maintenance',
            estimatedDuration: 30,
            dependencies: []
          },
          {
            id: 'optimize_indexes',
            name: 'Optimize Database Indexes',
            description: 'Rebuild and optimize database indexes',
            estimatedDuration: 60,
            dependencies: ['backup_database']
          },
          {
            id: 'cleanup_logs',
            name: 'Clean Up Old Logs',
            description: 'Remove old log entries to free up space',
            estimatedDuration: 30,
            dependencies: ['optimize_indexes']
          }
        ],
        healthChecks: {
          preMaintenanceChecks: ['database_connection', 'disk_space'],
          postMaintenanceChecks: ['database_connection', 'api_endpoints'],
          rollbackChecks: ['database_connection']
        }
      },
      {
        id: 'security_update',
        name: 'Security Update',
        description: 'Apply security patches and updates',
        type: MaintenanceType.EMERGENCY,
        impactLevel: 'high',
        estimatedDuration: 60,
        tasks: [
          {
            id: 'apply_patches',
            name: 'Apply Security Patches',
            description: 'Install critical security updates',
            estimatedDuration: 30,
            dependencies: []
          },
          {
            id: 'restart_services',
            name: 'Restart Services',
            description: 'Restart affected services',
            estimatedDuration: 15,
            dependencies: ['apply_patches']
          },
          {
            id: 'verify_security',
            name: 'Verify Security',
            description: 'Run security verification tests',
            estimatedDuration: 15,
            dependencies: ['restart_services']
          }
        ],
        healthChecks: {
          preMaintenanceChecks: ['api_endpoints', 'external_services'],
          postMaintenanceChecks: ['api_endpoints', 'external_services', 'memory_usage'],
          rollbackChecks: ['api_endpoints']
        }
      },
      {
        id: 'system_upgrade',
        name: 'System Upgrade',
        description: 'Major system upgrade with new features',
        type: MaintenanceType.SCHEDULED,
        impactLevel: 'critical',
        estimatedDuration: 240,
        tasks: [
          {
            id: 'full_backup',
            name: 'Full System Backup',
            description: 'Create complete system backup',
            estimatedDuration: 60,
            dependencies: []
          },
          {
            id: 'deploy_upgrade',
            name: 'Deploy Upgrade',
            description: 'Deploy new system version',
            estimatedDuration: 120,
            dependencies: ['full_backup']
          },
          {
            id: 'migrate_data',
            name: 'Migrate Data',
            description: 'Run data migration scripts',
            estimatedDuration: 30,
            dependencies: ['deploy_upgrade']
          },
          {
            id: 'verify_upgrade',
            name: 'Verify Upgrade',
            description: 'Run comprehensive system tests',
            estimatedDuration: 30,
            dependencies: ['migrate_data']
          }
        ],
        healthChecks: {
          preMaintenanceChecks: ['database_connection', 'api_endpoints', 'disk_space', 'memory_usage'],
          postMaintenanceChecks: ['database_connection', 'api_endpoints', 'external_services', 'memory_usage'],
          rollbackChecks: ['database_connection', 'api_endpoints']
        }
      }
    ];

    res.json({
      success: true,
      data: templates
    });
  })
);

export default router;