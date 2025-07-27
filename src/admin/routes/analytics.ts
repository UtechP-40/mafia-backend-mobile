import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest, adminAuthMiddleware } from '../middleware/auth';
import { adminLogger, adminPerformanceLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';
import { adminAnalyticsService } from '../services/AnalyticsService';
import { EventType, MetricType } from '../../models';
import { Types } from 'mongoose';

const router = Router();

// All analytics routes require authentication
router.use(adminAuthMiddleware);

/**
 * Get real-time dashboard metrics
 * GET /admin/api/analytics/dashboard
 */
router.get('/dashboard', 
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { startDate, endDate, granularity, timezone } = req.query;
    
    // Default to last 7 days if no dates provided
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Validate date range (max 90 days)
    const maxRange = 90 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxRange) {
      return res.status(400).json({
        success: false,
        message: 'Date range cannot exceed 90 days'
      });
    }

    const metrics = await adminAnalyticsService.getDashboardMetrics({
      startDate: start,
      endDate: end,
      granularity: (granularity as 'hour' | 'day' | 'week' | 'month') || 'day',
      timezone: timezone as string
    });

    adminLogger.info('Dashboard metrics accessed', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      dateRange: { startDate: start, endDate: end },
      granularity
    });

    res.json({
      success: true,
      data: metrics
    });
  })
);

/**
 * Execute custom analytics query
 * POST /admin/api/analytics/query
 */
router.post('/query',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { collection, filters, aggregation, groupBy, sortBy, limit, skip } = req.body;

    // Validate required fields
    if (!collection || !filters) {
      return res.status(400).json({
        success: false,
        message: 'Collection and filters are required'
      });
    }

    // Validate collection
    const allowedCollections = ['analytics_events', 'performance_metrics', 'error_logs'];
    if (!allowedCollections.includes(collection)) {
      return res.status(400).json({
        success: false,
        message: `Invalid collection. Allowed: ${allowedCollections.join(', ')}`
      });
    }

    const queryBuilder = {
      collection,
      filters,
      aggregation,
      groupBy,
      sortBy,
      limit: Math.min(limit || 1000, 10000), // Cap at 10k records
      skip
    };

    const result = await adminAnalyticsService.executeCustomQuery(queryBuilder);

    adminLogger.info('Custom analytics query executed', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      collection,
      resultCount: Array.isArray(result) ? result.length : 1
    });

    res.json({
      success: true,
      data: result,
      query: queryBuilder
    });
  })
);

/**
 * Get time-based data aggregation with period comparison
 * GET /admin/api/analytics/time-series
 */
router.get('/time-series',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { 
      collection, 
      metric, 
      startDate, 
      endDate, 
      granularity = 'day',
      compareWithPrevious = 'false'
    } = req.query;

    // Validate required fields
    if (!collection || !metric) {
      return res.status(400).json({
        success: false,
        message: 'Collection and metric are required'
      });
    }

    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const result = await adminAnalyticsService.getTimeBasedAggregation(
      collection as string,
      metric as string,
      start,
      end,
      granularity as 'hour' | 'day' | 'week' | 'month',
      compareWithPrevious === 'true'
    );

    adminLogger.info('Time-series data retrieved', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      collection,
      metric,
      granularity,
      compareWithPrevious
    });

    res.json({
      success: true,
      data: result
    });
  })
);

/**
 * Export analytics data
 * POST /admin/api/analytics/export
 */
router.post('/export',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { collection, filters, format = 'json', filename, includeMetadata = true } = req.body;

    // Validate required fields
    if (!collection || !filters) {
      return res.status(400).json({
        success: false,
        message: 'Collection and filters are required'
      });
    }

    // Validate format
    const allowedFormats = ['json', 'csv', 'xlsx'];
    if (!allowedFormats.includes(format)) {
      return res.status(400).json({
        success: false,
        message: `Invalid format. Allowed: ${allowedFormats.join(', ')}`
      });
    }

    const exportOptions = {
      format,
      filename,
      includeMetadata,
      compression: false
    };

    const result = await adminAnalyticsService.exportAnalyticsData(
      collection,
      filters,
      exportOptions
    );

    adminLogger.info('Analytics data exported', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      collection,
      format,
      recordCount: result.metadata.recordCount
    });

    res.json({
      success: true,
      data: {
        downloadUrl: `/admin/api/analytics/download/${encodeURIComponent(result.filePath.split('/').pop() || '')}`,
        metadata: result.metadata
      }
    });
  })
);

/**
 * Download exported file
 * GET /admin/api/analytics/download/:filename
 */
router.get('/download/:filename',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { filename } = req.params;
    const { compress = 'false' } = req.query;

    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      });
    }

    const filePath = await adminAnalyticsService.downloadLogFile(filename, compress === 'true');

    adminLogger.info('File download requested', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      filename,
      compress
    });

    res.download(filePath, filename);
  })
);

/**
 * Get comprehensive logs with filtering
 * GET /admin/api/analytics/logs
 */
router.get('/logs',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { 
      level, 
      category, 
      startTime, 
      endTime, 
      maxLines = '1000',
      search
    } = req.query;

    const options = {
      level: level as string,
      category: category as string,
      startTime: startTime ? new Date(startTime as string) : undefined,
      endTime: endTime ? new Date(endTime as string) : undefined,
      maxLines: Math.min(parseInt(maxLines as string), 10000) // Cap at 10k lines
    };

    let logs = await adminAnalyticsService.getLogs(options);

    // Apply search filter if provided
    if (search) {
      const searchTerm = (search as string).toLowerCase();
      logs = logs.filter(log => 
        log.message?.toLowerCase().includes(searchTerm) ||
        log.level?.toLowerCase().includes(searchTerm) ||
        JSON.stringify(log).toLowerCase().includes(searchTerm)
      );
    }

    adminLogger.info('Logs retrieved', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      level,
      category,
      logCount: logs.length,
      search: search ? 'applied' : 'none'
    });

    res.json({
      success: true,
      data: logs,
      filters: options,
      totalCount: logs.length
    });
  })
);

/**
 * Stream live logs via WebSocket (placeholder for WebSocket implementation)
 * GET /admin/api/analytics/logs/stream
 */
router.get('/logs/stream',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    // This would typically be implemented with WebSocket
    // For now, return information about WebSocket endpoint
    res.json({
      success: true,
      message: 'Live log streaming available via WebSocket',
      websocketUrl: `/admin/ws/logs`,
      supportedFilters: ['level', 'category', 'follow']
    });
  })
);

/**
 * Get log file list
 * GET /admin/api/analytics/logs/files
 */
router.get('/logs/files',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const fs = require('fs/promises');
    const path = require('path');
    
    try {
      const logsDir = path.join(process.cwd(), 'logs', 'admin');
      const files = await fs.readdir(logsDir);
      
      const logFiles = [];
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(logsDir, file);
          const stats = await fs.stat(filePath);
          
          logFiles.push({
            name: file,
            size: stats.size,
            modified: stats.mtime,
            category: file.includes('error') ? 'error' : 
                     file.includes('security') ? 'security' : 
                     file.includes('performance') ? 'performance' : 'general'
          });
        }
      }

      adminLogger.info('Log files listed', {
        userId: req.adminUser.id,
        username: req.adminUser.username,
        fileCount: logFiles.length
      });

      res.json({
        success: true,
        data: logFiles
      });
    } catch (error) {
      adminLogger.error('Failed to list log files', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.adminUser.id
      });

      res.status(500).json({
        success: false,
        message: 'Failed to list log files'
      });
    }
  })
);

/**
 * Apply retention policies
 * POST /admin/api/analytics/retention
 */
router.post('/retention',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { policies } = req.body;

    if (!Array.isArray(policies) || policies.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Policies array is required'
      });
    }

    // Validate policies
    for (const policy of policies) {
      if (!policy.collection || !policy.retentionDays) {
        return res.status(400).json({
          success: false,
          message: 'Each policy must have collection and retentionDays'
        });
      }
    }

    await adminAnalyticsService.applyRetentionPolicies(policies);

    adminLogger.info('Retention policies applied', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      policiesCount: policies.length
    });

    res.json({
      success: true,
      message: 'Retention policies applied successfully',
      appliedPolicies: policies.length
    });
  })
);

/**
 * Clear analytics cache
 * DELETE /admin/api/analytics/cache
 */
router.delete('/cache',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { tag } = req.query;

    adminAnalyticsService.clearCache(tag as string);

    adminLogger.info('Analytics cache cleared', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      tag: tag || 'all'
    });

    res.json({
      success: true,
      message: `Cache cleared${tag ? ` for tag: ${tag}` : ' (all)'}`
    });
  })
);

/**
 * Get analytics health status
 * GET /admin/api/analytics/health
 */
router.get('/health',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const startTime = Date.now();
    
    try {
      // Test database connectivity and basic queries
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      const healthChecks = await Promise.all([
        // Test analytics events query
        adminAnalyticsService.executeCustomQuery({
          collection: 'analytics_events',
          filters: { timestamp: { $gte: oneHourAgo, $lte: now } },
          limit: 1
        }),
        // Test performance metrics query
        adminAnalyticsService.executeCustomQuery({
          collection: 'performance_metrics',
          filters: { timestamp: { $gte: oneHourAgo, $lte: now } },
          limit: 1
        }),
        // Test error logs query
        adminAnalyticsService.executeCustomQuery({
          collection: 'error_logs',
          filters: { timestamp: { $gte: oneHourAgo, $lte: now } },
          limit: 1
        })
      ]);

      const responseTime = Date.now() - startTime;

      res.json({
        success: true,
        status: 'healthy',
        timestamp: now,
        responseTime,
        checks: {
          database: 'connected',
          analyticsEvents: 'accessible',
          performanceMetrics: 'accessible',
          errorLogs: 'accessible'
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        }
      });
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      adminLogger.error('Analytics health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime
      });

      res.status(503).json({
        success: false,
        status: 'unhealthy',
        timestamp: new Date(),
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * Get system performance metrics
 * GET /admin/api/analytics/performance
 */
router.get('/performance',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { startDate, endDate, metric } = req.query;

    // Default to last 24 hours if no dates provided
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 24 * 60 * 60 * 1000);

    const filters: any = {
      timestamp: { $gte: start, $lte: end }
    };

    if (metric) {
      filters.metricName = metric;
    }

    const performanceData = await adminAnalyticsService.executeCustomQuery({
      collection: 'performance_metrics',
      filters,
      aggregation: [
        {
          $group: {
            _id: '$metricName',
            avg: { $avg: '$value' },
            min: { $min: '$value' },
            max: { $max: '$value' },
            count: { $sum: 1 },
            latest: { $last: '$value' }
          }
        },
        { $sort: { count: -1 } }
      ]
    });

    adminLogger.info('Performance metrics retrieved', {
      userId: req.adminUser.id,
      username: req.adminUser.username,
      dateRange: { startDate: start, endDate: end },
      metric: metric || 'all'
    });

    res.json({
      success: true,
      data: performanceData,
      dateRange: { startDate: start, endDate: end },
      system: {
        currentMemory: process.memoryUsage(),
        uptime: process.uptime(),
        cpuUsage: process.cpuUsage()
      }
    });
  })
);

export default router;