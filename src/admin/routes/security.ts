import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { adminLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';

const router = Router();

// Mock security alerts data
const mockSecurityAlerts = [
  {
    id: '1',
    roomId: 'room-123',
    playerId: 'player-456',
    type: 'suspicious_activity',
    severity: 'medium',
    description: 'Player performing unusual voting patterns',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    resolved: false,
  },
  {
    id: '2',
    roomId: 'room-789',
    playerId: 'player-101',
    type: 'inappropriate_content',
    severity: 'high',
    description: 'Inappropriate language detected in chat messages',
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    resolved: false,
  },
  {
    id: '3',
    roomId: 'room-456',
    playerId: 'player-789',
    type: 'connection_abuse',
    severity: 'low',
    description: 'Multiple rapid reconnection attempts detected',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
    resolved: true,
  },
  {
    id: '4',
    roomId: 'room-321',
    playerId: 'player-654',
    type: 'cheating_detected',
    severity: 'critical',
    description: 'Potential game state manipulation detected',
    timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
    resolved: false,
  },
];

/**
 * GET /admin/api/security/alerts
 * Get security alerts with filtering
 */
router.get('/alerts',
  requireAdminPermission(Permission.SECURITY_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { severity, type, resolved, limit = 50 } = req.query;
    
    adminLogger.info('Security alerts accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      filters: { severity, type, resolved }
    });

    try {
      let filteredAlerts = [...mockSecurityAlerts];
      
      if (severity) {
        filteredAlerts = filteredAlerts.filter(alert => alert.severity === severity);
      }
      
      if (type) {
        filteredAlerts = filteredAlerts.filter(alert => alert.type === type);
      }
      
      if (resolved !== undefined) {
        const isResolved = resolved === 'true';
        filteredAlerts = filteredAlerts.filter(alert => alert.resolved === isResolved);
      }
      
      // Sort by timestamp (newest first)
      filteredAlerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      // Apply limit
      filteredAlerts = filteredAlerts.slice(0, parseInt(limit as string));

      res.json({
        success: true,
        data: filteredAlerts,
        summary: {
          total: filteredAlerts.length,
          unresolved: filteredAlerts.filter(a => !a.resolved).length,
          bySeverity: {
            critical: filteredAlerts.filter(a => a.severity === 'critical').length,
            high: filteredAlerts.filter(a => a.severity === 'high').length,
            medium: filteredAlerts.filter(a => a.severity === 'medium').length,
            low: filteredAlerts.filter(a => a.severity === 'low').length,
          }
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch security alerts', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch security alerts',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/security/alerts/:id/resolve
 * Resolve a security alert
 */
router.post('/alerts/:id/resolve',
  requireAdminPermission(Permission.SECURITY_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { id } = req.params;
    const { resolution, notes } = req.body;
    
    adminLogger.info('Security alert resolution', {
      userId: adminUser.id,
      username: adminUser.username,
      alertId: id,
      resolution,
      notes
    });

    try {
      const alertIndex = mockSecurityAlerts.findIndex(alert => alert.id === id);
      
      if (alertIndex === -1) {
        return res.status(404).json({
          success: false,
          message: 'Security alert not found'
        });
      }

      // Mark alert as resolved
      mockSecurityAlerts[alertIndex].resolved = true;
      mockSecurityAlerts[alertIndex].resolvedBy = adminUser.username;
      mockSecurityAlerts[alertIndex].resolvedAt = new Date().toISOString();
      mockSecurityAlerts[alertIndex].resolution = resolution;
      mockSecurityAlerts[alertIndex].notes = notes;

      res.json({
        success: true,
        message: 'Security alert resolved successfully',
        data: {
          alertId: id,
          resolvedBy: adminUser.username,
          resolvedAt: new Date(),
          resolution,
          notes
        }
      });
    } catch (error) {
      adminLogger.error('Failed to resolve security alert', {
        userId: adminUser.id,
        alertId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to resolve security alert',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/security/analytics
 * Get security analytics and trends
 */
router.get('/analytics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { days = 7 } = req.query;
    
    adminLogger.info('Security analytics accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      days
    });

    try {
      const daysCount = parseInt(days as string);
      const now = new Date();
      const startDate = new Date(now.getTime() - daysCount * 24 * 60 * 60 * 1000);
      
      // Filter alerts within the date range
      const recentAlerts = mockSecurityAlerts.filter(alert => 
        new Date(alert.timestamp) >= startDate
      );

      const analytics = {
        totalAlerts: recentAlerts.length,
        resolvedAlerts: recentAlerts.filter(a => a.resolved).length,
        unresolvedAlerts: recentAlerts.filter(a => !a.resolved).length,
        alertsByType: recentAlerts.reduce((acc, alert) => {
          acc[alert.type] = (acc[alert.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        alertsBySeverity: recentAlerts.reduce((acc, alert) => {
          acc[alert.severity] = (acc[alert.severity] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        dailyTrend: Array.from({ length: daysCount }, (_, i) => {
          const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
          const dayAlerts = recentAlerts.filter(alert => {
            const alertDate = new Date(alert.timestamp);
            return alertDate.toDateString() === date.toDateString();
          });
          
          return {
            date: date.toISOString().split('T')[0],
            count: dayAlerts.length,
            resolved: dayAlerts.filter(a => a.resolved).length
          };
        }),
        topRiskyRooms: Object.entries(
          recentAlerts.reduce((acc, alert) => {
            acc[alert.roomId] = (acc[alert.roomId] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([roomId, count]) => ({ roomId, alertCount: count })),
        
        topRiskyPlayers: Object.entries(
          recentAlerts.reduce((acc, alert) => {
            acc[alert.playerId] = (acc[alert.playerId] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([playerId, count]) => ({ playerId, alertCount: count }))
      };

      res.json({
        success: true,
        data: analytics,
        dateRange: {
          start: startDate.toISOString(),
          end: now.toISOString(),
          days: daysCount
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch security analytics', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch security analytics',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

export default router;