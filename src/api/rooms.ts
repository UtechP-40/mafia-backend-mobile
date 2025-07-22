import { Router, Request, Response } from 'express';
import { RoomManager } from '../game/roomManager';
import { authenticateToken } from '../middleware/authMiddleware';
import { logger } from '../utils/logger';

const router = Router();
const roomManager = new RoomManager();

// Simple validation helpers
const isValidObjectId = (id: string): boolean => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};

const isValidRoomCode = (code: string): boolean => {
  return /^[A-Z0-9]{6}$/.test(code);
};

/**
 * GET /api/rooms/public - Get public rooms with filtering and pagination
 */
router.get('/public', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const maxPlayers = req.query.maxPlayers ? parseInt(req.query.maxPlayers as string) : undefined;
    const hasVoiceChat = req.query.hasVoiceChat ? req.query.hasVoiceChat === 'true' : undefined;
    const allowSpectators = req.query.allowSpectators ? req.query.allowSpectators === 'true' : undefined;
    const search = req.query.search as string;

    const filters = {
      maxPlayers,
      hasVoiceChat,
      allowSpectators,
      search
    };

    const result = await roomManager.getPublicRooms(filters, { page, limit });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error getting public rooms:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get public rooms'
    });
  }
});

/**
 * POST /api/rooms - Create a new room
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const hostId = req.user!.id;
    const settings = req.body.settings || {};

    const room = await roomManager.createRoom({ hostId, settings });

    res.status(201).json({
      success: true,
      data: room,
      message: 'Room created successfully'
    });
  } catch (error) {
    logger.error('Error creating room:', error);
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create room'
    });
  }
});

/**
 * POST /api/rooms/join - Join a room by code or ID
 */
router.post('/join', authMiddleware, joinRoomValidation, validateRequest, async (req: Request, res: Response) => {
  try {
    const playerId = req.user!.id;
    const { roomIdentifier } = req.body;

    const result = await roomManager.joinRoom(roomIdentifier, playerId);

    if (result.success) {
      res.json({
        success: true,
        data: result.room,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Error joining room:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join room'
    });
  }
});

/**
 * POST /api/rooms/:roomId/leave - Leave a room
 */
router.post('/:roomId/leave', authMiddleware, [param('roomId').isMongoId()], validateRequest, async (req: Request, res: Response) => {
  try {
    const playerId = req.user!.id;
    const { roomId } = req.params;

    const success = await roomManager.leaveRoom(roomId, playerId);

    if (success) {
      res.json({
        success: true,
        message: 'Left room successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to leave room'
      });
    }
  } catch (error) {
    logger.error('Error leaving room:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave room'
    });
  }
});

/**
 * PUT /api/rooms/:roomId/settings - Update room settings (host only)
 */
router.put('/:roomId/settings', authMiddleware, updateRoomValidation, validateRequest, async (req: Request, res: Response) => {
  try {
    const hostId = req.user!.id;
    const { roomId } = req.params;
    const settings = req.body.settings;

    const room = await roomManager.updateRoomSettings(roomId, hostId, settings);

    if (room) {
      res.json({
        success: true,
        data: room,
        message: 'Room settings updated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
  } catch (error) {
    logger.error('Error updating room settings:', error);
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update room settings'
    });
  }
});

/**
 * GET /api/rooms/:roomId - Get room details
 */
router.get('/:roomId', authMiddleware, [param('roomId').isMongoId()], validateRequest, async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;
    const room = await roomManager.getRoomById(roomId);

    if (room) {
      res.json({
        success: true,
        data: room
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
  } catch (error) {
    logger.error('Error getting room:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get room'
    });
  }
});

/**
 * GET /api/rooms/code/:code - Get room by code
 */
router.get('/code/:code', [param('code').matches(/^[A-Z0-9]{6}$/)], validateRequest, async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const room = await roomManager.getRoomByCode(code);

    if (room) {
      res.json({
        success: true,
        data: room
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
  } catch (error) {
    logger.error('Error getting room by code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get room'
    });
  }
});

/**
 * POST /api/rooms/:roomId/transfer-host - Transfer host privileges
 */
router.post('/:roomId/transfer-host', authMiddleware, [
  param('roomId').isMongoId(),
  body('newHostId').isMongoId()
], validateRequest, async (req: Request, res: Response) => {
  try {
    const currentHostId = req.user!.id;
    const { roomId } = req.params;
    const { newHostId } = req.body;

    const success = await roomManager.transferHost(roomId, currentHostId, newHostId);

    if (success) {
      res.json({
        success: true,
        message: 'Host transferred successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to transfer host'
      });
    }
  } catch (error) {
    logger.error('Error transferring host:', error);
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to transfer host'
    });
  }
});

export { router as roomRoutes };