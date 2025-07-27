import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { Permission } from '../models/SuperUser';
import SecurityMonitoringService from '../services/SecurityMonitoringService';
import { AlertSeverity, AlertStatus, AlertCategory, ThreatLevel } from '../models/SecurityAlert';
import { Types } from 'mongoose';

const router = Router();
const securityService = SecurityMonitoringService.getInstance();

// Get security alerts
router.get('/alerts',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      status,
      severity,
      category,
      assignedTo,
      startDate,
      endDate,
      riskScoreMin,
      riskScoreMax,
      page = '1',
      limit = '20'
    } = req.query;

    const filters: any = {};
    if (status) filters.status = status as AlertStatus;
    if (severity) filters.severity = severity as AlertSeverity;
    if (category) filters.category = category as AlertCategory;
    if (assignedTo && Types.ObjectId.isValid(assignedTo as string)) {
      filters.assignedTo = new Types.ObjectId(assignedTo as string);
    }
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);
    if (riskScoreMin) filters.riskScoreMin = parseInt(riskScoreMin as string);
    if (riskScoreMax) filters.riskScoreMax = parseInt(riskScoreMax as string);

    const result = await securityService.getSecurityAlerts(
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

// Create security alert
router.post('/alerts',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      title,
      description,
      category,
      severity,
      threatLevel,
      source,
      affectedAssets,
      threatIndicators,
      evidence,
      mitigationActions
    } = req.body;

    // Validate required fields
    if (!title || !description || !category || !severity || !threatLevel || !source) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Validate source structure
    if (!source.system || !source.component || !source.detector) {
      return res.status(400).json({
        success: false,
        error: 'Source must include system, component, and detector'
      });
    }

    const alert = await securityService.createSecurityAlert({
      title,
      description,
      category: category as AlertCategory,
      severity: severity as AlertSeverity,
      threatLevel: threatLevel as ThreatLevel,
      source,
      affectedAssets: affectedAssets || [],
      threatIndicators: threatIndicators || [],
      evidence: evidence || [],
      mitigationActions: mitigationActions || []
    });

    res.status(201).json({
      success: true,
      data: alert
    });
  })
);

// Assign alert
router.post('/alerts/:id/assign',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { assignedTo } = req.body;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid alert ID'
      });
    }

    if (!assignedTo || !Types.ObjectId.isValid(assignedTo)) {
      return res.status(400).json({
        success: false,
        error: 'Valid assignedTo user ID is required'
      });
    }

    const alert = await securityService.assignAlert(
      new Types.ObjectId(id),
      new Types.ObjectId(assignedTo),
      req.adminUser._id
    );

    res.json({
      success: true,
      data: alert
    });
  })
);

// Resolve alert
router.post('/alerts/:id/resolve',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { resolutionNotes } = req.body;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid alert ID'
      });
    }

    if (!resolutionNotes) {
      return res.status(400).json({
        success: false,
        error: 'Resolution notes are required'
      });
    }

    const alert = await securityService.resolveAlert(
      new Types.ObjectId(id),
      resolutionNotes,
      req.adminUser._id
    );

    res.json({
      success: true,
      data: alert
    });
  })
);

// Analyze security event
router.post('/events/analyze',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      type,
      source,
      severity,
      data,
      userId,
      ip,
      userAgent
    } = req.body;

    if (!type || !source || !severity || !data) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, source, severity, data'
      });
    }

    const event = {
      type,
      source,
      timestamp: new Date(),
      severity: severity as AlertSeverity,
      data,
      userId,
      ip,
      userAgent
    };

    await securityService.analyzeSecurityEvent(event);

    res.json({
      success: true,
      message: 'Security event analyzed successfully'
    });
  })
);

// Get security metrics
router.get('/metrics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    const filters: any = {};
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const metrics = await securityService.getSecurityMetrics(
      filters.startDate,
      filters.endDate
    );

    res.json({
      success: true,
      data: metrics
    });
  })
);

// Get alert categories
router.get('/categories',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const categories = Object.values(AlertCategory);

    res.json({
      success: true,
      data: categories
    });
  })
);

// Get alert severities
router.get('/severities',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const severities = Object.values(AlertSeverity);

    res.json({
      success: true,
      data: severities
    });
  })
);

// Get alert statuses
router.get('/statuses',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const statuses = Object.values(AlertStatus);

    res.json({
      success: true,
      data: statuses
    });
  })
);

// Get threat levels
router.get('/threat-levels',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const threatLevels = Object.values(ThreatLevel);

    res.json({
      success: true,
      data: threatLevels
    });
  })
);

// Bulk alert operations
router.post('/alerts/bulk-assign',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { alertIds, assignedTo } = req.body;

    if (!Array.isArray(alertIds) || !assignedTo || !Types.ObjectId.isValid(assignedTo)) {
      return res.status(400).json({
        success: false,
        error: 'Valid alert IDs array and assignedTo user ID are required'
      });
    }

    const results = [];
    const errors = [];

    for (const alertId of alertIds) {
      try {
        if (!Types.ObjectId.isValid(alertId)) {
          errors.push({ alertId, error: 'Invalid alert ID' });
          continue;
        }

        const alert = await securityService.assignAlert(
          new Types.ObjectId(alertId),
          new Types.ObjectId(assignedTo),
          req.adminUser._id
        );
        results.push({ alertId, success: true, data: alert });
      } catch (error) {
        errors.push({
          alertId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.json({
      success: errors.length === 0,
      data: {
        successful: results,
        failed: errors,
        summary: {
          total: alertIds.length,
          successful: results.length,
          failed: errors.length
        }
      }
    });
  })
);

router.post('/alerts/bulk-resolve',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { alertIds, resolutionNotes } = req.body;

    if (!Array.isArray(alertIds) || !resolutionNotes) {
      return res.status(400).json({
        success: false,
        error: 'Valid alert IDs array and resolution notes are required'
      });
    }

    const results = [];
    const errors = [];

    for (const alertId of alertIds) {
      try {
        if (!Types.ObjectId.isValid(alertId)) {
          errors.push({ alertId, error: 'Invalid alert ID' });
          continue;
        }

        const alert = await securityService.resolveAlert(
          new Types.ObjectId(alertId),
          resolutionNotes,
          req.adminUser._id
        );
        results.push({ alertId, success: true, data: alert });
      } catch (error) {
        errors.push({
          alertId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.json({
      success: errors.length === 0,
      data: {
        successful: results,
        failed: errors,
        summary: {
          total: alertIds.length,
          successful: results.length,
          failed: errors.length
        }
      }
    });
  })
);

// Security dashboard data
router.get('/dashboard',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { timeRange = '24h' } = req.query;

    let startDate: Date;
    const endDate = new Date();

    switch (timeRange) {
      case '1h':
        startDate = new Date(Date.now() - 60 * 60 * 1000);
        break;
      case '24h':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }

    const [metrics, recentAlerts] = await Promise.all([
      securityService.getSecurityMetrics(startDate, endDate),
      securityService.getSecurityAlerts(
        { startDate, endDate },
        1,
        10
      )
    ]);

    res.json({
      success: true,
      data: {
        metrics,
        recentAlerts: recentAlerts.alerts,
        timeRange,
        generatedAt: new Date()
      }
    });
  })
);

// Security event types
router.get('/event-types',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const eventTypes = [
      {
        type: 'login_failed',
        description: 'Failed login attempt',
        category: 'authentication',
        severity: 'medium'
      },
      {
        type: 'unauthorized_access',
        description: 'Unauthorized access attempt',
        category: 'authorization',
        severity: 'high'
      },
      {
        type: 'malware_detected',
        description: 'Malware or suspicious file detected',
        category: 'malware',
        severity: 'critical'
      },
      {
        type: 'intrusion_detected',
        description: 'System intrusion detected',
        category: 'intrusion',
        severity: 'critical'
      },
      {
        type: 'ddos_attack',
        description: 'DDoS attack detected',
        category: 'ddos',
        severity: 'high'
      },
      {
        type: 'suspicious_activity',
        description: 'Suspicious user activity',
        category: 'suspicious_activity',
        severity: 'medium'
      },
      {
        type: 'policy_violation',
        description: 'Security policy violation',
        category: 'policy_violation',
        severity: 'low'
      },
      {
        type: 'system_compromise',
        description: 'System compromise detected',
        category: 'system_compromise',
        severity: 'critical'
      },
      {
        type: 'network_anomaly',
        description: 'Network traffic anomaly',
        category: 'network_anomaly',
        severity: 'medium'
      }
    ];

    res.json({
      success: true,
      data: eventTypes
    });
  })
);

// Threat indicators
router.get('/threat-indicators',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const indicatorTypes = [
      {
        type: 'ip',
        description: 'IP Address',
        examples: ['192.168.1.100', '10.0.0.50']
      },
      {
        type: 'domain',
        description: 'Domain Name',
        examples: ['malicious-domain.com', 'phishing-site.net']
      },
      {
        type: 'hash',
        description: 'File Hash',
        examples: ['a1b2c3d4e5f6', '1234567890abcdef']
      },
      {
        type: 'email',
        description: 'Email Address',
        examples: ['attacker@malicious.com', 'phishing@fake.net']
      },
      {
        type: 'user_agent',
        description: 'User Agent String',
        examples: ['Suspicious Bot 1.0', 'Malware Scanner']
      },
      {
        type: 'pattern',
        description: 'Pattern/Regex',
        examples: ['union.*select', 'script.*alert']
      }
    ];

    res.json({
      success: true,
      data: indicatorTypes
    });
  })
);

// Mitigation actions
router.get('/mitigation-actions',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const mitigationActions = [
      {
        type: 'block_ip',
        description: 'Block IP Address',
        automated: true,
        category: 'network'
      },
      {
        type: 'disable_user',
        description: 'Disable User Account',
        automated: true,
        category: 'user'
      },
      {
        type: 'quarantine_file',
        description: 'Quarantine Suspicious File',
        automated: true,
        category: 'file'
      },
      {
        type: 'restart_service',
        description: 'Restart Affected Service',
        automated: false,
        category: 'system'
      },
      {
        type: 'custom',
        description: 'Custom Action',
        automated: false,
        category: 'custom'
      }
    ];

    res.json({
      success: true,
      data: mitigationActions
    });
  })
);

export default router;