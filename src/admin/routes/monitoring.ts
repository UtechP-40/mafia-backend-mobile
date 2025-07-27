import express from 'express';
import { adminAuthMiddleware } from '../middleware/auth';
import { SystemMonitoringService } from '../../services/SystemMonitoringService';
import { Logger, LogAggregator, LogAnalytics } from '../../utils/logger';
import { adminLogger } from '../config/logger';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { promisify } from 'util';

const router = express.Router();
const monitoringService = SystemMonitoringService.getInstance();
const logger = new Logger({ service: 'admin-monitoring' });

// Apply authentication middleware to all routes
router.use(adminAuthMiddleware);

// Real-time system metrics
router.get('/metrics/current', async (req, res) => {
  try {
    const metrics = monitoringService.getLatestMetrics();
    if (!metrics) {
      return res.status(404).json({ error: 'No metrics available' });
    }

    res.json({
      success: true,
      data: metrics,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('Failed to get current metrics', error);
    res.status(500).json({ error: 'Failed to retrieve current metrics' });
  }
});

// Historical metrics with pagination
router.get('/metrics/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const allMetrics = monitoringService.getMetricsHistory();
    const paginatedMetrics = allMetrics.slice(offset, offset + limit);

    res.json({
      success: true,
      data: paginatedMetrics,
      pagination: {
        total: allMetrics.length,
        limit,
        offset,
        hasMore: offset + limit < allMetrics.length
      }
    });
  } catch (error) {
    logger.error('Failed to get metrics history', error);
    res.status(500).json({ error: 'Failed to retrieve metrics history' });
  }
});

// System health summary
router.get('/health/summary', async (req, res) => {
  try {
    const metrics = monitoringService.getLatestMetrics();
    const alerts = monitoringService.getActiveAlerts();
    
    if (!metrics) {
      return res.status(404).json({ error: 'No metrics available' });
    }

    const healthStatus = {
      overall: 'healthy' as 'healthy' | 'warning' | 'critical',
      components: {
        cpu: {
          status: metrics.cpu.usage > 80 ? 'warning' : metrics.cpu.usage > 90 ? 'critical' : 'healthy',
          value: metrics.cpu.usage,
          unit: '%'
        },
        memory: {
          status: metrics.memory.percentage > 80 ? 'warning' : metrics.memory.percentage > 90 ? 'critical' : 'healthy',
          value: metrics.memory.percentage,
          unit: '%'
        },
        disk: {
          status: metrics.disk.percentage > 80 ? 'warning' : metrics.disk.percentage > 90 ? 'critical' : 'healthy',
          value: metrics.disk.percentage,
          unit: '%'
        },
        database: {
          status: metrics.database.connections > 0 ? 'healthy' : 'critical',
          value: metrics.database.connections,
          unit: 'connections'
        }
      },
      alerts: {
        total: alerts.length,
        critical: alerts.filter(a => a.severity === 'critical').length,
        high: alerts.filter(a => a.severity === 'high').length,
        medium: alerts.filter(a => a.severity === 'medium').length,
        low: alerts.filter(a => a.severity === 'low').length
      },
      uptime: process.uptime(),
      timestamp: Date.now()
    };

    // Determine overall health
    const componentStatuses = Object.values(healthStatus.components).map(c => c.status);
    if (componentStatuses.includes('critical') || alerts.some(a => a.severity === 'critical')) {
      healthStatus.overall = 'critical';
    } else if (componentStatuses.includes('warning') || alerts.some(a => a.severity === 'high')) {
      healthStatus.overall = 'warning';
    }

    res.json({
      success: true,
      data: healthStatus
    });
  } catch (error) {
    logger.error('Failed to get health summary', error);
    res.status(500).json({ error: 'Failed to retrieve health summary' });
  }
});

// Active alerts
router.get('/alerts', async (req, res) => {
  try {
    const alerts = monitoringService.getActiveAlerts();
    
    res.json({
      success: true,
      data: alerts,
      count: alerts.length
    });
  } catch (error) {
    logger.error('Failed to get active alerts', error);
    res.status(500).json({ error: 'Failed to retrieve active alerts' });
  }
});

// Alert rules management
router.get('/alerts/rules', async (req, res) => {
  try {
    const rules = monitoringService.getAlertRules();
    
    res.json({
      success: true,
      data: rules,
      count: rules.length
    });
  } catch (error) {
    logger.error('Failed to get alert rules', error);
    res.status(500).json({ error: 'Failed to retrieve alert rules' });
  }
});

router.post('/alerts/rules', async (req, res) => {
  try {
    const rule = req.body;
    
    // Validate required fields
    if (!rule.id || !rule.name || !rule.metric || !rule.operator || rule.threshold === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    monitoringService.addAlertRule(rule);
    
    res.json({
      success: true,
      message: 'Alert rule created successfully',
      data: rule
    });
  } catch (error) {
    logger.error('Failed to create alert rule', error);
    res.status(500).json({ error: 'Failed to create alert rule' });
  }
});

router.put('/alerts/rules/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    const updates = req.body;
    
    const success = monitoringService.updateAlertRule(ruleId, updates);
    
    if (!success) {
      return res.status(404).json({ error: 'Alert rule not found' });
    }

    res.json({
      success: true,
      message: 'Alert rule updated successfully'
    });
  } catch (error) {
    logger.error('Failed to update alert rule', error);
    res.status(500).json({ error: 'Failed to update alert rule' });
  }
});

router.delete('/alerts/rules/:ruleId', async (req, res) => {
  try {
    const { ruleId } = req.params;
    
    const success = monitoringService.removeAlertRule(ruleId);
    
    if (!success) {
      return res.status(404).json({ error: 'Alert rule not found' });
    }

    res.json({
      success: true,
      message: 'Alert rule deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete alert rule', error);
    res.status(500).json({ error: 'Failed to delete alert rule' });
  }
});

// Capacity planning and recommendations
router.get('/capacity/report', async (req, res) => {
  try {
    const report = await monitoringService.generateCapacityReport();
    
    if (!report) {
      return res.status(404).json({ error: 'No capacity data available' });
    }

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Failed to generate capacity report', error);
    res.status(500).json({ error: 'Failed to generate capacity report' });
  }
});

// Maintenance mode management
router.post('/maintenance/enable', async (req, res) => {
  try {
    await monitoringService.enableMaintenanceMode();
    
    res.json({
      success: true,
      message: 'Maintenance mode enabled'
    });
  } catch (error) {
    logger.error('Failed to enable maintenance mode', error);
    res.status(500).json({ error: 'Failed to enable maintenance mode' });
  }
});

router.post('/maintenance/disable', async (req, res) => {
  try {
    await monitoringService.disableMaintenanceMode();
    
    res.json({
      success: true,
      message: 'Maintenance mode disabled'
    });
  } catch (error) {
    logger.error('Failed to disable maintenance mode', error);
    res.status(500).json({ error: 'Failed to disable maintenance mode' });
  }
});

router.get('/maintenance/status', async (req, res) => {
  try {
    const isInMaintenance = monitoringService.isInMaintenanceMode();
    
    res.json({
      success: true,
      data: {
        maintenanceMode: isInMaintenance,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    logger.error('Failed to get maintenance status', error);
    res.status(500).json({ error: 'Failed to get maintenance status' });
  }
});

// Log management endpoints
router.get('/logs/files', async (req, res) => {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    const files = await promisify(fs.readdir)(logsDir);
    
    const logFiles = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(logsDir, file);
        const stats = await promisify(fs.stat)(filePath);
        
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime,
          created: stats.birthtime,
          type: path.extname(file).substring(1) || 'log'
        };
      })
    );

    res.json({
      success: true,
      data: logFiles.sort((a, b) => b.modified.getTime() - a.modified.getTime())
    });
  } catch (error) {
    logger.error('Failed to list log files', error);
    res.status(500).json({ error: 'Failed to list log files' });
  }
});

router.get('/logs/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const compress = req.query.compress === 'true';
    
    // Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const logsDir = path.join(process.cwd(), 'logs');
    const filePath = path.join(logsDir, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }

    if (compress) {
      // Create compressed archive
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);
      
      archive.pipe(res);
      archive.file(filePath, { name: filename });
      await archive.finalize();
    } else {
      // Send file directly
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    }
  } catch (error) {
    logger.error('Failed to download log file', error);
    res.status(500).json({ error: 'Failed to download log file' });
  }
});

router.get('/logs/search', async (req, res) => {
  try {
    const { query, level, category, startTime, endTime, limit = 100 } = req.query;
    
    const searchParams = {
      query: query as string,
      level: level as string,
      category: category as string,
      startTime: startTime ? new Date(startTime as string) : undefined,
      endTime: endTime ? new Date(endTime as string) : undefined,
      limit: parseInt(limit as string)
    };

    // This would typically use a log aggregation service like ELK stack
    const results = await LogAggregator.searchLogs(
      searchParams.query,
      searchParams.startTime,
      searchParams.endTime
    );

    res.json({
      success: true,
      data: results,
      searchParams
    });
  } catch (error) {
    logger.error('Failed to search logs', error);
    res.status(500).json({ error: 'Failed to search logs' });
  }
});

router.get('/logs/analytics/patterns', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    
    const timeRange = {
      start: startTime ? new Date(startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: endTime ? new Date(endTime as string) : new Date()
    };

    const patterns = await LogAnalytics.getErrorPatterns(timeRange);

    res.json({
      success: true,
      data: patterns,
      timeRange
    });
  } catch (error) {
    logger.error('Failed to get log patterns', error);
    res.status(500).json({ error: 'Failed to get log patterns' });
  }
});

router.get('/logs/analytics/performance', async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    
    const timeRange = {
      start: startTime ? new Date(startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: endTime ? new Date(endTime as string) : new Date()
    };

    const insights = await LogAnalytics.getPerformanceInsights(timeRange);

    res.json({
      success: true,
      data: insights,
      timeRange
    });
  } catch (error) {
    logger.error('Failed to get performance insights', error);
    res.status(500).json({ error: 'Failed to get performance insights' });
  }
});

// Start/stop monitoring
router.post('/monitoring/start', async (req, res) => {
  try {
    const { intervalMs = 5000 } = req.body;
    
    await monitoringService.startMonitoring(intervalMs);
    
    res.json({
      success: true,
      message: 'System monitoring started',
      intervalMs
    });
  } catch (error) {
    logger.error('Failed to start monitoring', error);
    res.status(500).json({ error: 'Failed to start monitoring' });
  }
});

router.post('/monitoring/stop', async (req, res) => {
  try {
    await monitoringService.stopMonitoring();
    
    res.json({
      success: true,
      message: 'System monitoring stopped'
    });
  } catch (error) {
    logger.error('Failed to stop monitoring', error);
    res.status(500).json({ error: 'Failed to stop monitoring' });
  }
});

export default router;