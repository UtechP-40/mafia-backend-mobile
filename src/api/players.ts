import { Router, Request, Response } from 'express';
import { PlayerService, ProfileUpdateData } from '../services/PlayerService';
import { authenticateToken } from '../middleware/authMiddleware';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * GET /api/players/profile
 * Get current player's profile
 */
router.get('/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const playerId = req.userId!;
    const result = await PlayerService.getPlayerProfile(playerId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get profile endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * PUT /api/players/profile
 * Update current player's profile
 */
router.put('/profile', rateLimiter({ maxRequests: 10, windowMs: 15 * 60 * 1000 }), async (req: Request, res: Response): Promise<void> => {
  try {
    const playerId = req.userId!;
    const updateData: ProfileUpdateData = req.body;

    // Validate request body
    if (!updateData || (updateData.username === undefined && updateData.avatar === undefined)) {
      return res.status(400).json({
        success: false,
        message: 'At least one field (username or avatar) must be provided'
      });
    }

    const result = await PlayerService.updatePlayerProfile(playerId, updateData);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: result.data,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update profile endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/players/stats
 * Get current player's statistics
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const playerId = req.userId!;
    const result = await PlayerService.getPlayerStatistics(playerId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get stats endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/players/search
 * Search for players by username
 */
router.get('/search', rateLimiter({ maxRequests: 20, windowMs: 60 * 1000 }), async (req: Request, res: Response): Promise<void> => {
  try {
    const { q: query, limit } = req.query;
    const playerId = req.userId!;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const searchLimit = limit ? Math.min(parseInt(limit as string, 10), 50) : 10;
    const result = await PlayerService.searchPlayers(query, playerId, searchLimit);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Search players endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/players/friends
 * Get current player's friends list
 */
router.get('/friends', async (req: Request, res: Response): Promise<void> => {
  try {
    const playerId = req.userId!;
    const result = await PlayerService.getFriendsList(playerId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get friends endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/players/friends
 * Add a friend
 */
router.post('/friends', rateLimiter({ maxRequests: 10, windowMs: 60 * 1000 }), async (req: Request, res: Response): Promise<void> => {
  try {
    const playerId = req.userId!;
    const { friendId } = req.body;

    if (!friendId || typeof friendId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Friend ID is required'
      });
    }

    const result = await PlayerService.addFriend(playerId, friendId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.status(201).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Add friend endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/players/friends/:friendId
 * Remove a friend
 */
router.delete('/friends/:friendId', rateLimiter({ maxRequests: 10, windowMs: 60 * 1000 }), async (req: Request, res: Response): Promise<void> => {
  try {
    const playerId = req.userId!;
    const { friendId } = req.params;

    if (!friendId) {
      return res.status(400).json({
        success: false,
        message: 'Friend ID is required'
      });
    }

    const result = await PlayerService.removeFriend(playerId, friendId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Remove friend endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/players/leaderboard
 * Get leaderboard (top players by ELO rating)
 */
router.get('/leaderboard', async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit } = req.query;
    const leaderboardLimit = limit ? Math.min(parseInt(limit as string, 10), 100) : 50;
    
    const result = await PlayerService.getLeaderboard(leaderboardLimit);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    console.error('Get leaderboard endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/players/activity
 * Update player's last active timestamp
 */
router.post('/activity', async (req: Request, res: Response): Promise<void> => {
  try {
    const playerId = req.userId!;
    const result = await PlayerService.updateLastActive(playerId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }

    res.json({
      success: true,
      message: 'Activity updated successfully'
    });
  } catch (error) {
    console.error('Update activity endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export { router as playerRoutes };