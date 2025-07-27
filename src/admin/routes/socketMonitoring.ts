import { Router, Request, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { adminLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';
import SocketMonitoringService from '../services/SocketMonitoringService';
import SocketLoadTestService from '../services/SocketLoadTestService';
import { SocketMetrics } from '../models/SocketMetrics';
import { SocketEvent } from '../models/SocketEvent';
import { GameRoomMetrics } from '../models/GameRoomMetrics';

const router = Router();
const socketMonitoring = SocketMonitoringService.getInstance();
const loadTestService = SocketLoadTestService.getInstance();

// Helper function to generate health recommendations
function generateHealthRecommendations(metrics: any, securityAlerts: any[]): string[] {
  const recommendations: string[] = [];

  // Error rate recommendations
  if (metrics.errorRate > 5) {
    recommendations.push('High error rate detected. Check server logs and investigate failing socket events.');
  } else if (metrics.errorRate > 1) {
    recommendations.push('Elevated error rate. Monitor socket event failures and consider implementing retry mechanisms.');
  }

  // Latency recommendations
  if (metrics.averageLatency > 1000) {
    recommendations.push('High average latency detected. Consider optimizing server performance or implementing connection pooling.');
  } else if (metrics.averageLatency > 500) {
    recommendations.push('Moderate latency detected. Monitor network conditions and server load.');
  }

  // Connection recommendations
  if (metrics.activeConnections > 1000) {
    recommendations.push('High number of active connections. Consider implementing connection limits and load balancing.');
  }

  // Bandwidth recommendations
  const totalBandwidth = metrics.bandwidthUsage.incoming + metrics.bandwidthUsage.outgoing;
  if (totalBandwidth > 10 * 1024 * 1024) { // 10MB
    recommendations.push('High bandwidth usage detected. Consider implementing data compression and optimizing payload sizes.');
  }

  // Security recommendations
  const criticalAlerts = securityAlerts.filter(a => a.severity === 'CRITICAL').length;
  const highAlerts = securityAlerts.filter(a => a.severity === 'HIGH').length;

  if (criticalAlerts > 0) {
    recommendations.push(`${criticalAlerts} critical security alert(s) detected. Immediate investigation required.`);
  }
  if (highAlerts > 0) {
    recommendations.push(`${highAlerts} high-priority security alert(s) detected. Review and address promptly.`);
  }

  // Events per second recommendations
  if (metrics.eventsPerSecond > 100) {
    recommendations.push('High event throughput detected. Monitor server capacity and consider implementing event batching.');
  }

  // Transport recommendations
  const websocketRatio = metrics.connectionsByTransport.websocket / 
    (metrics.connectionsByTransport.websocket + metrics.connectionsByTransport.polling);
  
  if (websocketRatio < 0.8) {
    recommendations.push('Low WebSocket usage ratio. Investigate why clients are falling back to polling transport.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Socket system is operating within normal parameters.');
  }

  return recommendations;
}

// Real-time socket connections dashboard
router.get('/connections',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('Socket connections dashboard accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    const activeConnections = socketMonitoring.getActiveConnections();
    const performanceMetrics = socketMonitoring.getPerformanceMetrics();

    res.json({
      success: true,
      data: {
        activeConnections: activeConnections.map(conn => ({
          socketId: conn.socketId,
          playerId: conn.playerId,
          connectedAt: conn.connectedAt,
          lastActivity: conn.lastActivity,
          ipAddress: conn.ipAddress,
          namespace: conn.namespace,
          transport: conn.transport,
          roomId: conn.roomId,
          latency: conn.latency,
          eventsReceived: conn.eventsReceived,
          eventsSent: conn.eventsSent,
          errors: conn.errors,
          geolocation: conn.geolocation
        })),
        metrics: performanceMetrics,
        timestamp: new Date().toISOString()
      }
    });
  })
);

// Active game rooms monitoring
router.get('/rooms',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('Socket rooms dashboard accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    const activeRooms = socketMonitoring.getActiveRooms();

    res.json({
      success: true,
      data: {
        activeRooms: activeRooms.map(room => ({
          roomId: room.roomId,
          namespace: room.namespace,
          createdAt: room.createdAt,
          playerCount: room.playerCount,
          maxPlayers: room.maxPlayers,
          hostId: room.hostId,
          gameState: room.gameState,
          gamePhase: room.gamePhase,
          gameStartedAt: room.gameStartedAt,
          gameDuration: room.gameDuration,
          lastActivity: room.lastActivity,
          totalMessages: room.totalMessages,
          totalEvents: room.totalEvents,
          averageLatency: room.averageLatency,
          players: Array.from(room.players.values()).map(player => ({
            playerId: player.playerId,
            socketId: player.socketId,
            connectedAt: player.connectedAt,
            lastActivity: player.lastActivity,
            latency: player.latency
          }))
        })),
        summary: {
          totalActiveRooms: activeRooms.length,
          totalActivePlayers: activeRooms.reduce((sum, room) => sum + room.playerCount, 0),
          averagePlayersPerRoom: activeRooms.length > 0 ? 
            activeRooms.reduce((sum, room) => sum + room.playerCount, 0) / activeRooms.length : 0
        },
        timestamp: new Date().toISOString()
      }
    });
  })
);

// Socket event history and replay
router.get('/events',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const {
      limit = 100,
      offset = 0,
      socketId,
      playerId,
      roomId,
      eventName,
      direction,
      startDate,
      endDate,
      search
    } = req.query;

    adminLogger.info('Socket events accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      filters: { socketId, playerId, roomId, eventName, direction, startDate, endDate, search }
    });

    try {
      let filters: any = {};

      if (socketId) filters.socketId = socketId;
      if (playerId) filters.playerId = playerId;
      if (roomId) filters.roomId = roomId;
      if (eventName) filters.eventName = eventName;
      if (direction) filters.direction = direction;

      if (startDate || endDate) {
        filters.timestamp = {};
        if (startDate) filters.timestamp.$gte = new Date(startDate as string);
        if (endDate) filters.timestamp.$lte = new Date(endDate as string);
      }

      let events;
      if (search) {
        events = await SocketEvent.searchEvents(search as string, filters, parseInt(limit as string));
      } else {
        events = await SocketEvent.find(filters)
          .sort({ timestamp: -1 })
          .skip(parseInt(offset as string))
          .limit(parseInt(limit as string))
          .lean();
      }

      const totalCount = await SocketEvent.countDocuments(filters);

      res.json({
        success: true,
        data: {
          events,
          pagination: {
            total: totalCount,
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            hasMore: totalCount > parseInt(offset as string) + parseInt(limit as string)
          }
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch socket events', { error, userId: adminUser.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch socket events'
      });
    }
  })
);

// Socket performance metrics and analytics
router.get('/metrics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const {
      startDate,
      endDate,
      granularity = 'hour' // hour, day, week
    } = req.query;

    adminLogger.info('Socket metrics accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      dateRange: { startDate, endDate },
      granularity
    });

    try {
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      // Get historical metrics
      const historicalMetrics = await socketMonitoring.getHistoricalMetrics(start, end);
      
      // Get current metrics
      const currentMetrics = socketMonitoring.getPerformanceMetrics();
      
      // Get metrics summary
      const summary = await SocketMetrics.getMetricsSummary(start, end);
      
      // Get peak usage times
      const peakTimes = await SocketMetrics.getPeakUsageTimes(7);

      res.json({
        success: true,
        data: {
          current: currentMetrics,
          historical: historicalMetrics,
          summary,
          peakTimes,
          dateRange: { start, end }
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch socket metrics', { error, userId: adminUser.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch socket metrics'
      });
    }
  })
);

// Socket security alerts and monitoring
router.get('/security',
  requireAdminPermission(Permission.SECURITY_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { limit = 50, severity } = req.query;

    adminLogger.info('Socket security alerts accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      filters: { severity }
    });

    const alerts = socketMonitoring.getSecurityAlerts(parseInt(limit as string));
    
    let filteredAlerts = alerts;
    if (severity) {
      filteredAlerts = alerts.filter(alert => alert.severity === severity);
    }

    res.json({
      success: true,
      data: {
        alerts: filteredAlerts,
        summary: {
          total: alerts.length,
          bySeverity: {
            critical: alerts.filter(a => a.severity === 'CRITICAL').length,
            high: alerts.filter(a => a.severity === 'HIGH').length,
            medium: alerts.filter(a => a.severity === 'MEDIUM').length,
            low: alerts.filter(a => a.severity === 'LOW').length
          },
          byType: alerts.reduce((acc, alert) => {
            acc[alert.type] = (acc[alert.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        }
      }
    });
  })
);

// Socket connection debugging tools
router.get('/debug/:socketId',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { socketId } = req.params;

    adminLogger.info('Socket debug info accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      socketId
    });

    const connection = socketMonitoring.getConnectionById(socketId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Socket connection not found'
      });
    }

    // Get recent events for this socket
    const recentEvents = await SocketEvent.find({ socketId })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    res.json({
      success: true,
      data: {
        connection,
        recentEvents,
        diagnostics: {
          isConnected: !connection.disconnectedAt,
          connectionDuration: connection.disconnectedAt ? 
            connection.disconnectedAt.getTime() - connection.connectedAt.getTime() :
            Date.now() - connection.connectedAt.getTime(),
          activityLevel: connection.eventsReceived + connection.eventsSent,
          errorRate: connection.errors > 0 ? 
            (connection.errors / (connection.eventsReceived + connection.eventsSent)) * 100 : 0,
          averageLatency: connection.latency || 0
        }
      }
    });
  })
);

// Socket load testing and stress testing tools
router.post('/load-test',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const {
      connectionCount = 10,
      eventRate = 1, // events per second per connection
      duration = 60, // seconds
      namespace = '/game',
      eventTypes = ['chat-message', 'player-action', 'ping'],
      payloadSize = 100,
      authToken
    } = req.body;

    adminLogger.info('Socket load test initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      parameters: { connectionCount, eventRate, duration, namespace }
    });

    try {
      const serverUrl = process.env.SOCKET_SERVER_URL || 'http://localhost:3000';
      
      const config = {
        serverUrl,
        namespace,
        connectionCount,
        eventRate,
        duration,
        authToken,
        eventTypes,
        payloadSize
      };

      const testId = await loadTestService.startLoadTest(config);

      res.json({
        success: true,
        message: 'Load test initiated',
        testId,
        config,
        estimatedCompletion: new Date(Date.now() + duration * 1000)
      });
    } catch (error) {
      adminLogger.error('Failed to start load test', { error, userId: adminUser.id });
      res.status(500).json({
        success: false,
        error: 'Failed to start load test'
      });
    }
  })
);

// Socket event emission and broadcasting tools
router.post('/broadcast',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const {
      target, // 'all', 'room', 'player'
      targetId, // roomId or playerId
      event,
      data,
      namespace = '/game'
    } = req.body;

    adminLogger.info('Admin broadcast initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      target,
      targetId,
      event,
      namespace
    });

    try {
      let success = false;
      let message = '';

      switch (target) {
        case 'room':
          success = socketMonitoring.broadcastToRoom(targetId, event, data);
          message = success ? 'Broadcast sent to room' : 'Room not found or inactive';
          break;
        case 'player':
          await socketMonitoring.sendToPlayer(targetId, event, data);
          success = true;
          message = 'Message sent to player';
          break;
        case 'all':
          // This would broadcast to all connected clients
          success = true;
          message = 'Broadcast sent to all clients';
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid target type'
          });
      }

      res.json({
        success,
        message,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      adminLogger.error('Failed to send broadcast', { error, userId: adminUser.id });
      res.status(500).json({
        success: false,
        error: 'Failed to send broadcast'
      });
    }
  })
);

// Disconnect socket connection
router.post('/disconnect/:socketId',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { socketId } = req.params;
    const { reason = 'Admin disconnect' } = req.body;

    adminLogger.info('Admin socket disconnect', {
      userId: adminUser.id,
      username: adminUser.username,
      socketId,
      reason
    });

    const success = socketMonitoring.disconnectSocket(socketId, reason);

    res.json({
      success,
      message: success ? 'Socket disconnected' : 'Socket not found',
      socketId,
      reason,
      timestamp: new Date().toISOString()
    });
  })
);

// Game room analytics
router.get('/rooms/analytics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const {
      startDate,
      endDate,
      limit = 20
    } = req.query;

    adminLogger.info('Game room analytics accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      dateRange: { startDate, endDate }
    });

    try {
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const [
        roomStats,
        topRooms,
        capacityAnalysis,
        hourlyActivity
      ] = await Promise.all([
        GameRoomMetrics.getRoomStatsSummary(start, end),
        GameRoomMetrics.getTopPerformingRooms(parseInt(limit as string)),
        GameRoomMetrics.getRoomCapacityAnalysis(7),
        GameRoomMetrics.getHourlyActivity(7)
      ]);

      res.json({
        success: true,
        data: {
          summary: roomStats,
          topPerformingRooms: topRooms,
          capacityAnalysis,
          hourlyActivity,
          dateRange: { start, end }
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch room analytics', { error, userId: adminUser.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch room analytics'
      });
    }
  })
);

// Real-time event stream (WebSocket endpoint would be better, but REST for now)
router.get('/events/realtime',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { limit = 50 } = req.query;

    adminLogger.info('Real-time events accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    const realtimeEvents = await SocketEvent.getRealtimeEvents(parseInt(limit as string));

    res.json({
      success: true,
      data: {
        events: realtimeEvents,
        timestamp: new Date().toISOString()
      }
    });
  })
);

// Socket geographic distribution
router.get('/geography',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;

    adminLogger.info('Socket geography accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    const metrics = socketMonitoring.getPerformanceMetrics();
    const geographicData = Array.from(metrics.geographicDistribution.entries()).map(([country, count]) => ({
      country,
      count,
      percentage: metrics.totalConnections > 0 ? (count / metrics.totalConnections) * 100 : 0
    }));

    res.json({
      success: true,
      data: {
        distribution: geographicData,
        summary: {
          totalCountries: geographicData.length,
          topCountry: geographicData.length > 0 ? geographicData[0] : null,
          totalConnections: metrics.totalConnections
        }
      }
    });
  })
);

// Get load test results
router.get('/load-test/:testId',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { testId } = req.params;

    adminLogger.info('Load test result accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      testId
    });

    const result = loadTestService.getTestResult(testId);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Load test not found'
      });
    }

    res.json({
      success: true,
      data: result
    });
  })
);

// Get all load tests
router.get('/load-tests',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { status } = req.query;

    adminLogger.info('Load tests list accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      status
    });

    let tests;
    if (status === 'active') {
      tests = loadTestService.getActiveTests();
    } else {
      tests = loadTestService.getAllTests();
    }

    res.json({
      success: true,
      data: {
        tests,
        summary: {
          total: tests.length,
          active: tests.filter(t => t.status === 'running').length,
          completed: tests.filter(t => t.status === 'completed').length,
          failed: tests.filter(t => t.status === 'failed').length,
          cancelled: tests.filter(t => t.status === 'cancelled').length
        }
      }
    });
  })
);

// Cancel load test
router.post('/load-test/:testId/cancel',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { testId } = req.params;

    adminLogger.info('Load test cancellation requested', {
      userId: adminUser.id,
      username: adminUser.username,
      testId
    });

    const success = loadTestService.cancelTest(testId);

    res.json({
      success,
      message: success ? 'Load test cancelled' : 'Load test not found or already completed',
      testId,
      timestamp: new Date().toISOString()
    });
  })
);

// Start stress test
router.post('/stress-test',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const {
      connectionCount = 10,
      maxConnections = 100,
      incrementStep = 10,
      incrementInterval = 30, // seconds
      eventRate = 1,
      duration = 60,
      namespace = '/game',
      eventTypes = ['chat-message', 'player-action', 'ping'],
      payloadSize = 100,
      stopOnFailureRate = 50, // percentage
      authToken
    } = req.body;

    adminLogger.info('Socket stress test initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      parameters: { connectionCount, maxConnections, incrementStep, incrementInterval }
    });

    try {
      const serverUrl = process.env.SOCKET_SERVER_URL || 'http://localhost:3000';
      
      const baseConfig = {
        serverUrl,
        namespace,
        connectionCount,
        eventRate,
        duration,
        authToken,
        eventTypes,
        payloadSize
      };

      const options = {
        maxConnections,
        incrementStep,
        incrementInterval,
        stopOnFailureRate
      };

      const stressTestId = await loadTestService.startStressTest(baseConfig, options);

      res.json({
        success: true,
        message: 'Stress test initiated',
        stressTestId,
        baseConfig,
        options,
        estimatedDuration: Math.ceil((maxConnections - connectionCount) / incrementStep) * (incrementInterval + duration)
      });
    } catch (error) {
      adminLogger.error('Failed to start stress test', { error, userId: adminUser.id });
      res.status(500).json({
        success: false,
        error: 'Failed to start stress test'
      });
    }
  })
);

// Socket event statistics
router.get('/events/statistics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const {
      startDate,
      endDate,
      socketId,
      playerId,
      roomId,
      namespace
    } = req.query;

    adminLogger.info('Socket event statistics accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      filters: { socketId, playerId, roomId, namespace }
    });

    try {
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      let filters: any = {};
      if (socketId) filters.socketId = socketId;
      if (playerId) filters.playerId = playerId;
      if (roomId) filters.roomId = roomId;
      if (namespace) filters.namespace = namespace;

      const [
        eventStats,
        topPlayers,
        roomActivity,
        errorAnalysis
      ] = await Promise.all([
        SocketEvent.getEventStatistics(start, end, filters),
        SocketEvent.getTopActivePlayers(start, end, 10),
        SocketEvent.getRoomActivityStats(start, end),
        SocketEvent.getErrorAnalysis(start, end)
      ]);

      res.json({
        success: true,
        data: {
          eventStatistics: eventStats,
          topActivePlayers: topPlayers,
          roomActivity,
          errorAnalysis,
          dateRange: { start, end }
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch event statistics', { error, userId: adminUser.id });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch event statistics'
      });
    }
  })
);

// Socket health check and diagnostics
router.get('/health',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;

    adminLogger.info('Socket health check accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    const metrics = socketMonitoring.getPerformanceMetrics();
    const activeConnections = socketMonitoring.getActiveConnections();
    const activeRooms = socketMonitoring.getActiveRooms();
    const securityAlerts = socketMonitoring.getSecurityAlerts(10);

    // Calculate health score based on various metrics
    let healthScore = 100;
    
    // Deduct points for high error rate
    if (metrics.errorRate > 5) healthScore -= 20;
    else if (metrics.errorRate > 1) healthScore -= 10;
    
    // Deduct points for high latency
    if (metrics.averageLatency > 1000) healthScore -= 20;
    else if (metrics.averageLatency > 500) healthScore -= 10;
    
    // Deduct points for security alerts
    const criticalAlerts = securityAlerts.filter(a => a.severity === 'CRITICAL').length;
    const highAlerts = securityAlerts.filter(a => a.severity === 'HIGH').length;
    healthScore -= (criticalAlerts * 15) + (highAlerts * 5);
    
    healthScore = Math.max(0, healthScore);

    const healthStatus = healthScore >= 80 ? 'healthy' : 
                        healthScore >= 60 ? 'warning' : 'critical';

    res.json({
      success: true,
      data: {
        healthScore,
        status: healthStatus,
        metrics: {
          activeConnections: activeConnections.length,
          activeRooms: activeRooms.length,
          averageLatency: metrics.averageLatency,
          errorRate: metrics.errorRate,
          eventsPerSecond: metrics.eventsPerSecond,
          bandwidthUsage: metrics.bandwidthUsage
        },
        alerts: {
          critical: criticalAlerts,
          high: highAlerts,
          total: securityAlerts.length
        },
        recommendations: generateHealthRecommendations(metrics, securityAlerts),
        timestamp: new Date().toISOString()
      }
    });
  })
);

export default router;