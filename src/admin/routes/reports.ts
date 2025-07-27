import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest, adminAuthMiddleware } from '../middleware/auth';
import { adminLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';
import { scheduledReportsService } from '../services/ScheduledReportsService';

const router = Router();

// All report routes require authentication
router.use(adminAuthMiddleware);

/**
 * Get all scheduled reports
 * GET /admin/api/reports/schedules
 */
router.get('/schedules',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const schedules = scheduledReportsService.getSchedules();

    adminLogger.info('Scheduled reports listed', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      count: schedules.length
    });

    res.json({
      success: true,
      data: schedules
    });
  })
);

/**
 * Get a specific scheduled report
 * GET /admin/api/reports/schedules/:scheduleId
 */
router.get('/schedules/:scheduleId',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { scheduleId } = req.params;
    
    const schedule = scheduledReportsService.getSchedule(scheduleId);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Scheduled report not found'
      });
    }

    adminLogger.info('Scheduled report retrieved', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      scheduleId,
      reportName: schedule.name
    });

    res.json({
      success: true,
      data: schedule
    });
  })
);

/**
 * Create a new scheduled report
 * POST /admin/api/reports/schedules
 */
router.post('/schedules',
  requireAdminPermission(Permission.ANALYTICS_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      name,
      description,
      cronExpression,
      reportType,
      recipients,
      format,
      parameters,
      isActive = true
    } = req.body;

    // Validate required fields
    if (!name || !cronExpression || !reportType || !recipients || !format) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, cronExpression, reportType, recipients, format'
      });
    }

    // Validate report type
    const validReportTypes = ['dashboard', 'custom', 'logs', 'performance'];
    if (!validReportTypes.includes(reportType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid report type. Must be one of: ${validReportTypes.join(', ')}`
      });
    }

    // Validate format
    const validFormats = ['json', 'csv', 'xlsx'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        message: `Invalid format. Must be one of: ${validFormats.join(', ')}`
      });
    }

    // Validate recipients
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Recipients must be a non-empty array'
      });
    }

    const schedule = await scheduledReportsService.createSchedule({
      name,
      description: description || '',
      cronExpression,
      reportType,
      recipients,
      format,
      parameters: parameters || {},
      isActive,
      createdBy: req.adminUser.id
    });

    adminLogger.info('Scheduled report created', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      scheduleId: schedule.id,
      reportName: schedule.name
    });

    res.status(201).json({
      success: true,
      data: schedule
    });
  })
);

/**
 * Update a scheduled report
 * PUT /admin/api/reports/schedules/:scheduleId
 */
router.put('/schedules/:scheduleId',
  requireAdminPermission(Permission.ANALYTICS_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { scheduleId } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.createdAt;
    delete updates.createdBy;

    const schedule = await scheduledReportsService.updateSchedule(scheduleId, updates);

    adminLogger.info('Scheduled report updated', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      scheduleId,
      reportName: schedule.name
    });

    res.json({
      success: true,
      data: schedule
    });
  })
);

/**
 * Delete a scheduled report
 * DELETE /admin/api/reports/schedules/:scheduleId
 */
router.delete('/schedules/:scheduleId',
  requireAdminPermission(Permission.ANALYTICS_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { scheduleId } = req.params;

    await scheduledReportsService.deleteSchedule(scheduleId);

    adminLogger.info('Scheduled report deleted', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      scheduleId
    });

    res.json({
      success: true,
      message: 'Scheduled report deleted successfully'
    });
  })
);

/**
 * Execute a report manually
 * POST /admin/api/reports/schedules/:scheduleId/execute
 */
router.post('/schedules/:scheduleId/execute',
  requireAdminPermission(Permission.ANALYTICS_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { scheduleId } = req.params;

    const executionId = await scheduledReportsService.executeReportManually(
      scheduleId,
      req.adminUser.id
    );

    adminLogger.info('Report executed manually', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      scheduleId,
      executionId
    });

    res.json({
      success: true,
      data: {
        executionId,
        message: 'Report execution started'
      }
    });
  })
);

/**
 * Get execution history for a scheduled report
 * GET /admin/api/reports/schedules/:scheduleId/executions
 */
router.get('/schedules/:scheduleId/executions',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { scheduleId } = req.params;
    const { limit = '50' } = req.query;

    const executions = scheduledReportsService.getExecutionHistory(
      scheduleId,
      parseInt(limit as string)
    );

    adminLogger.info('Report execution history retrieved', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      scheduleId,
      executionCount: executions.length
    });

    res.json({
      success: true,
      data: executions
    });
  })
);

/**
 * Validate cron expression
 * POST /admin/api/reports/validate-cron
 */
router.post('/validate-cron',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { cronExpression } = req.body;

    if (!cronExpression) {
      return res.status(400).json({
        success: false,
        message: 'Cron expression is required'
      });
    }

    const cron = require('node-cron');
    const isValid = cron.validate(cronExpression);

    let nextRuns: Date[] = [];
    if (isValid) {
      try {
        const task = cron.schedule(cronExpression, () => {}, { scheduled: false });
        nextRuns = task.nextDates(5).map((date: any) => date.toDate());
        task.destroy();
      } catch (error) {
        // If we can't get next runs, that's okay
      }
    }

    res.json({
      success: true,
      data: {
        isValid,
        cronExpression,
        nextRuns: nextRuns.slice(0, 5) // Show next 5 runs
      }
    });
  })
);

/**
 * Get available report templates
 * GET /admin/api/reports/templates
 */
router.get('/templates',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const templates = [
      {
        id: 'daily_dashboard',
        name: 'Daily Dashboard Report',
        description: 'Daily summary of key metrics and system health',
        reportType: 'dashboard',
        defaultCron: '0 9 * * *', // 9 AM daily
        defaultFormat: 'xlsx',
        parameters: {
          days: 1,
          granularity: 'hour'
        }
      },
      {
        id: 'weekly_analytics',
        name: 'Weekly Analytics Report',
        description: 'Weekly analytics summary with trends',
        reportType: 'dashboard',
        defaultCron: '0 9 * * 1', // 9 AM every Monday
        defaultFormat: 'xlsx',
        parameters: {
          days: 7,
          granularity: 'day'
        }
      },
      {
        id: 'error_logs',
        name: 'Error Logs Report',
        description: 'Daily error logs summary',
        reportType: 'logs',
        defaultCron: '0 8 * * *', // 8 AM daily
        defaultFormat: 'csv',
        parameters: {
          level: 'error',
          maxLines: 1000
        }
      },
      {
        id: 'performance_metrics',
        name: 'Performance Metrics Report',
        description: 'System performance metrics analysis',
        reportType: 'performance',
        defaultCron: '0 10 * * 1', // 10 AM every Monday
        defaultFormat: 'xlsx',
        parameters: {
          days: 7,
          metrics: ['response_time', 'memory_usage', 'cpu_usage']
        }
      },
      {
        id: 'user_activity',
        name: 'User Activity Report',
        description: 'User engagement and activity analysis',
        reportType: 'custom',
        defaultCron: '0 9 1 * *', // 9 AM on 1st of every month
        defaultFormat: 'xlsx',
        parameters: {
          collection: 'analytics_events',
          filters: {
            eventType: { $in: ['USER_LOGIN', 'USER_LOGOUT', 'GAME_START', 'GAME_END'] }
          },
          aggregation: [
            {
              $group: {
                _id: '$userId',
                eventCount: { $sum: 1 },
                lastActivity: { $max: '$timestamp' }
              }
            }
          ]
        }
      }
    ];

    res.json({
      success: true,
      data: templates
    });
  })
);

/**
 * Create report from template
 * POST /admin/api/reports/templates/:templateId
 */
router.post('/templates/:templateId',
  requireAdminPermission(Permission.ANALYTICS_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { templateId } = req.params;
    const { name, recipients, customParameters } = req.body;

    if (!name || !recipients) {
      return res.status(400).json({
        success: false,
        message: 'Name and recipients are required'
      });
    }

    // Get template (this would normally come from a database or config)
    const templates = {
      daily_dashboard: {
        name: 'Daily Dashboard Report',
        description: 'Daily summary of key metrics and system health',
        reportType: 'dashboard',
        cronExpression: '0 9 * * *',
        format: 'xlsx',
        parameters: { days: 1, granularity: 'hour' }
      },
      weekly_analytics: {
        name: 'Weekly Analytics Report',
        description: 'Weekly analytics summary with trends',
        reportType: 'dashboard',
        cronExpression: '0 9 * * 1',
        format: 'xlsx',
        parameters: { days: 7, granularity: 'day' }
      },
      error_logs: {
        name: 'Error Logs Report',
        description: 'Daily error logs summary',
        reportType: 'logs',
        cronExpression: '0 8 * * *',
        format: 'csv',
        parameters: { level: 'error', maxLines: 1000 }
      },
      performance_metrics: {
        name: 'Performance Metrics Report',
        description: 'System performance metrics analysis',
        reportType: 'performance',
        cronExpression: '0 10 * * 1',
        format: 'xlsx',
        parameters: { days: 7, metrics: ['response_time', 'memory_usage', 'cpu_usage'] }
      },
      user_activity: {
        name: 'User Activity Report',
        description: 'User engagement and activity analysis',
        reportType: 'custom',
        cronExpression: '0 9 1 * *',
        format: 'xlsx',
        parameters: {
          collection: 'analytics_events',
          filters: { eventType: { $in: ['USER_LOGIN', 'USER_LOGOUT', 'GAME_START', 'GAME_END'] } },
          aggregation: [{ $group: { _id: '$userId', eventCount: { $sum: 1 }, lastActivity: { $max: '$timestamp' } } }]
        }
      }
    };

    const template = templates[templateId as keyof typeof templates];
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    // Merge custom parameters with template parameters
    const parameters = { ...template.parameters, ...customParameters };

    const schedule = await scheduledReportsService.createSchedule({
      name,
      description: template.description,
      cronExpression: template.cronExpression,
      reportType: template.reportType as any,
      recipients,
      format: template.format as any,
      parameters,
      isActive: true,
      createdBy: req.adminUser.id
    });

    adminLogger.info('Report created from template', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      templateId,
      scheduleId: schedule.id,
      reportName: schedule.name
    });

    res.status(201).json({
      success: true,
      data: schedule
    });
  })
);

export default router;