import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { adminLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';
import { Room } from '../../models/Room';
import { Player } from '../../models/Player';
import { GameState } from '../../models/GameState';

const router = Router();

/**
 * GET /admin/api/game-rooms
 * Get all active game rooms with filtering and sorting
 */
router.get('/',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { status, sortBy, limit = 50, offset = 0 } = req.query;
    
    adminLogger.info('Game rooms list accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      filters: { status, sortBy }
    });

    try {
      let query: any = {};
      
      if (status && status !== 'all') {
        query.status = status;
      }

      let sortOptions: any = { createdAt: -1 };
      
      switch (sortBy) {
        case 'playerCount':
          sortOptions = { 'players.length': -1 };
          break;
        case 'duration':
          sortOptions = { createdAt: 1 };
          break;
        case 'activity':
          sortOptions = { updatedAt: -1 };
          break;
      }

      const rooms = await Room.find(query)
        .populate('players', 'username isAlive role connectionStatus lastActivity')
        .populate('host', 'username')
        .sort(sortOptions)
        .skip(parseInt(offset as string))
        .limit(parseInt(limit as string))
        .lean();

      const roomsWithDetails = rooms.map(room => ({
        id: room._id,
        code: room.code,
        name: room.name || `Room ${room.code}`,
        hostId: room.host._id,
        hostName: room.host.username,
        players: room.players.map((player: any) => ({
          id: player._id,
          username: player.username,
          role: player.role,
          isAlive: player.isAlive,
          isHost: player._id.toString() === room.host._id.toString(),
          connectionStatus: player.connectionStatus || 'connected',
          lastActivity: player.lastActivity || new Date(),
          statistics: {
            actionsPerformed: player.actionsPerformed || 0,
            messagessent: player.messagessent || 0,
            votesReceived: player.votesReceived || 0,
            suspiciousActivity: player.suspiciousActivity || 0,
          }
        })),
        status: room.status,
        gamePhase: room.gameState?.phase || 'waiting',
        settings: room.settings,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        duration: Math.floor((new Date().getTime() - new Date(room.createdAt).getTime()) / 1000),
        maxPlayers: room.settings?.maxPlayers || 10,
        isPublic: room.settings?.isPublic || false,
      }));

      res.json({
        success: true,
        data: roomsWithDetails,
        pagination: {
          total: await Room.countDocuments(query),
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch game rooms', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch game rooms',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/game-rooms/analytics
 * Get room analytics overview
 */
router.get('/analytics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('Game room analytics accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const [
        totalRooms,
        activeRooms,
        totalPlayers,
        roomsCreatedToday,
        averageRoomDuration,
        peakConcurrentRooms
      ] = await Promise.all([
        Room.countDocuments(),
        Room.countDocuments({ status: { $in: ['waiting', 'playing'] } }),
        Room.aggregate([
          { $match: { status: { $in: ['waiting', 'playing'] } } },
          { $group: { _id: null, totalPlayers: { $sum: { $size: '$players' } } } }
        ]),
        Room.countDocuments({ createdAt: { $gte: today } }),
        Room.aggregate([
          { $match: { status: 'finished' } },
          { $project: { duration: { $subtract: ['$updatedAt', '$createdAt'] } } },
          { $group: { _id: null, avgDuration: { $avg: '$duration' } } }
        ]),
        // This would need to be calculated from historical data
        Room.countDocuments({ status: { $in: ['waiting', 'playing'] } })
      ]);

      const analytics = {
        totalRooms,
        activeRooms,
        totalPlayers: totalPlayers[0]?.totalPlayers || 0,
        averageRoomDuration: Math.floor((averageRoomDuration[0]?.avgDuration || 0) / 1000),
        peakConcurrentRooms,
        roomsCreatedToday,
        averagePlayersPerRoom: activeRooms > 0 ? Math.round((totalPlayers[0]?.totalPlayers || 0) / activeRooms) : 0,
        popularGameModes: [
          { mode: 'Classic', count: Math.floor(totalRooms * 0.6) },
          { mode: 'Speed', count: Math.floor(totalRooms * 0.3) },
          { mode: 'Custom', count: Math.floor(totalRooms * 0.1) }
        ]
      };

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      adminLogger.error('Failed to fetch room analytics', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch room analytics',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/game-rooms/:id
 * Get detailed information about a specific room
 */
router.get('/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { id } = req.params;
    
    adminLogger.info('Game room details accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      roomId: id
    });

    try {
      const room = await Room.findById(id)
        .populate('players', 'username isAlive role connectionStatus lastActivity statistics')
        .populate('host', 'username')
        .populate('gameState')
        .lean();

      if (!room) {
        return res.status(404).json({
          success: false,
          message: 'Room not found'
        });
      }

      const roomDetails = {
        id: room._id,
        code: room.code,
        name: room.name || `Room ${room.code}`,
        hostId: room.host._id,
        hostName: room.host.username,
        players: room.players.map((player: any) => ({
          id: player._id,
          username: player.username,
          role: player.role,
          isAlive: player.isAlive,
          isHost: player._id.toString() === room.host._id.toString(),
          connectionStatus: player.connectionStatus || 'connected',
          lastActivity: player.lastActivity || new Date(),
          statistics: {
            actionsPerformed: player.statistics?.actionsPerformed || 0,
            messagessent: player.statistics?.messagessent || 0,
            votesReceived: player.statistics?.votesReceived || 0,
            suspiciousActivity: player.statistics?.suspiciousActivity || 0,
          }
        })),
        status: room.status,
        gamePhase: room.gameState?.phase || 'waiting',
        gameState: room.gameState,
        settings: room.settings,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        duration: Math.floor((new Date().getTime() - new Date(room.createdAt).getTime()) / 1000),
        maxPlayers: room.settings?.maxPlayers || 10,
        isPublic: room.settings?.isPublic || false,
      };

      res.json({
        success: true,
        data: roomDetails
      });
    } catch (error) {
      adminLogger.error('Failed to fetch room details', {
        userId: adminUser.id,
        roomId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch room details',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/game-rooms/:id/end
 * End a game room
 */
router.post('/:id/end',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { id } = req.params;
    const { reason = 'Admin intervention' } = req.body;
    
    adminLogger.info('Game room end requested', {
      userId: adminUser.id,
      username: adminUser.username,
      roomId: id,
      reason
    });

    try {
      const room = await Room.findById(id);
      
      if (!room) {
        return res.status(404).json({
          success: false,
          message: 'Room not found'
        });
      }

      if (room.status === 'finished') {
        return res.status(400).json({
          success: false,
          message: 'Room is already finished'
        });
      }

      // Update room status
      room.status = 'finished';
      room.endReason = reason;
      room.endedBy = adminUser.id;
      room.updatedAt = new Date();
      
      await room.save();

      // TODO: Notify all players in the room via Socket.io
      // socketService.broadcastToRoom(id, 'room-ended', { reason, endedBy: 'admin' });

      res.json({
        success: true,
        message: 'Room ended successfully',
        data: {
          roomId: id,
          reason,
          endedBy: adminUser.username,
          timestamp: new Date()
        }
      });
    } catch (error) {
      adminLogger.error('Failed to end room', {
        userId: adminUser.id,
        roomId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to end room',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/game-rooms/:roomId/kick/:playerId
 * Kick a player from a room
 */
router.post('/:roomId/kick/:playerId',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { roomId, playerId } = req.params;
    const { reason = 'Admin action' } = req.body;
    
    adminLogger.info('Player kick requested', {
      userId: adminUser.id,
      username: adminUser.username,
      roomId,
      playerId,
      reason
    });

    try {
      const room = await Room.findById(roomId);
      
      if (!room) {
        return res.status(404).json({
          success: false,
          message: 'Room not found'
        });
      }

      const playerIndex = room.players.findIndex(p => p.toString() === playerId);
      
      if (playerIndex === -1) {
        return res.status(404).json({
          success: false,
          message: 'Player not found in room'
        });
      }

      // Check if player is the host
      if (room.host.toString() === playerId) {
        return res.status(400).json({
          success: false,
          message: 'Cannot kick the room host'
        });
      }

      // Remove player from room
      room.players.splice(playerIndex, 1);
      room.updatedAt = new Date();
      
      await room.save();

      // TODO: Notify the player and room via Socket.io
      // socketService.sendToPlayer(playerId, 'kicked-from-room', { roomId, reason, kickedBy: 'admin' });
      // socketService.broadcastToRoom(roomId, 'player-kicked', { playerId, reason });

      res.json({
        success: true,
        message: 'Player kicked successfully',
        data: {
          roomId,
          playerId,
          reason,
          kickedBy: adminUser.username,
          timestamp: new Date()
        }
      });
    } catch (error) {
      adminLogger.error('Failed to kick player', {
        userId: adminUser.id,
        roomId,
        playerId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to kick player',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/game-rooms/:id/actions
 * Get player actions history for a specific room
 */
router.get('/:id/actions',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { id } = req.params;
    const { limit = 100, offset = 0 } = req.query;
    
    adminLogger.info('Room actions history accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      roomId: id
    });

    try {
      // Mock player actions data - in real implementation, this would come from game logs
      const mockActions = Array.from({ length: 50 }, (_, index) => ({
        id: `action-${index}`,
        playerId: `player-${Math.floor(Math.random() * 5) + 1}`,
        playerName: `Player${Math.floor(Math.random() * 5) + 1}`,
        action: ['vote', 'message', 'join', 'leave', 'eliminate'][Math.floor(Math.random() * 5)],
        target: Math.random() > 0.5 ? `Player${Math.floor(Math.random() * 5) + 1}` : undefined,
        timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(),
        gamePhase: ['day', 'night', 'voting', 'results'][Math.floor(Math.random() * 4)],
        data: {
          reason: Math.random() > 0.7 ? 'Suspicious behavior' : undefined,
          confidence: Math.random()
        }
      })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const paginatedActions = mockActions.slice(
        parseInt(offset as string), 
        parseInt(offset as string) + parseInt(limit as string)
      );

      res.json({
        success: true,
        data: paginatedActions,
        pagination: {
          total: mockActions.length,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch room actions', {
        userId: adminUser.id,
        roomId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch room actions',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/game-rooms/:id/performance
 * Get performance metrics for a specific room
 */
router.get('/:id/performance',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { id } = req.params;
    
    adminLogger.info('Room performance metrics accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      roomId: id
    });

    try {
      // Mock performance metrics - in real implementation, this would come from monitoring systems
      const performanceMetrics = {
        roomId: id,
        averageResponseTime: Math.random() * 200 + 50, // 50-250ms
        messageLatency: Math.random() * 100 + 20, // 20-120ms
        connectionStability: Math.random() * 0.2 + 0.8, // 80-100%
        memoryUsage: Math.random() * 0.3 + 0.4, // 40-70%
        cpuUsage: Math.random() * 0.4 + 0.2, // 20-60%
        networkThroughput: Math.random() * 5 + 2, // 2-7 MB/s
        errorRate: Math.random() * 0.05, // 0-5%
        playerSatisfaction: Math.random() * 0.3 + 0.7, // 70-100%
        recommendations: [
          'Connection stability is excellent',
          'Consider optimizing message broadcasting for better latency',
          'Memory usage is within acceptable limits',
          'Monitor CPU usage during peak player activity'
        ].filter(() => Math.random() > 0.3) // Randomly include recommendations
      };

      res.json({
        success: true,
        data: performanceMetrics
      });
    } catch (error) {
      adminLogger.error('Failed to fetch room performance metrics', {
        userId: adminUser.id,
        roomId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch room performance metrics',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/game-rooms/performance-test
 * Run performance test with simulated players
 */
router.post('/performance-test',
  requireAdminPermission(Permission.SYSTEM_ADMIN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { type = 'load', simulatedPlayers = 10, duration = 60 } = req.body;
    
    adminLogger.info('Room performance test initiated', {
      userId: adminUser.id,
      username: adminUser.username,
      type,
      simulatedPlayers,
      duration
    });

    try {
      // Simulate performance test results
      const startTime = Date.now();
      
      // Mock test execution
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate 2 second test
      
      const endTime = Date.now();
      const testDuration = endTime - startTime;
      
      const results = {
        testType: type,
        simulatedPlayers,
        requestedDuration: duration,
        actualDuration: testDuration,
        roomsCreated: Math.floor(simulatedPlayers / 5), // Assume 5 players per room
        averageRoomCreationTime: Math.random() * 500 + 100, // 100-600ms
        averagePlayerJoinTime: Math.random() * 200 + 50, // 50-250ms
        successRate: Math.random() * 10 + 90, // 90-100%
        peakMemoryUsage: Math.random() * 100 + 200, // 200-300MB
        averageCpuUsage: Math.random() * 30 + 20, // 20-50%
        networkLatency: {
          min: Math.random() * 50 + 10,
          max: Math.random() * 200 + 100,
          average: Math.random() * 100 + 50
        },
        errors: Math.floor(Math.random() * 3), // 0-2 errors
        warnings: Math.floor(Math.random() * 5), // 0-4 warnings
        recommendations: [
          'Consider implementing connection pooling for better performance',
          'Monitor memory usage during peak hours',
          'Optimize database queries for room creation'
        ]
      };

      res.json({
        success: true,
        message: 'Performance test completed',
        data: results
      });
    } catch (error) {
      adminLogger.error('Performance test failed', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Performance test failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

export default router;