import { Router, Request, Response } from 'express';
import { MatchmakingService, MatchmakingPreferences } from '../services/MatchmakingService';
import { authMiddleware } from '../middleware/authMiddleware';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();
const matchmakingService = MatchmakingService.getInstance();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Apply rate limiting to prevent abuse
router.use(rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: 'Too many matchmaking requests, please try again later'
}));

/**
 * Join matchmaking queue
 * POST /api/matchmaking/join
 */
router.post('/join', async (req: Request, res: Response) => {
  try {
    const playerId = req.user?.id;
    if (!playerId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { preferences = {}, connectionInfo } = req.body;

    // Validate connection info
    if (!connectionInfo || !connectionInfo.region || !connectionInfo.connectionQuality) {
      return res.status(400).json({
        success: false,
        message: 'Connection info (region and connectionQuality) is required'
      });
    }

    // Validate connection quality
    const validQualities = ['excellent', 'good', 'fair', 'poor'];
    if (!validQualities.includes(connectionInfo.connectionQuality)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid connection quality. Must be one of: excellent, good, fair, poor'
      });
    }

    // Validate preferences if provided
    if (preferences.skillRange && (preferences.skillRange < 50 || preferences.skillRange > 1000)) {
      return res.status(400).json({
        success: false,
        message: 'Skill range must be between 50 and 1000'
      });
    }

    if (preferences.maxWaitTime && (preferences.maxWaitTime < 10 || preferences.maxWaitTime > 300)) {
      return res.status(400).json({
        success: false,
        message: 'Max wait time must be between 10 and 300 seconds'
      });
    }

    const result = await matchmakingService.joinQueue(
      playerId,
      preferences as Partial<MatchmakingPreferences>,
      {
        region: connectionInfo.region,
        latency: connectionInfo.latency,
        connectionQuality: connectionInfo.connectionQuality
      }
    );

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Join matchmaking queue error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Leave matchmaking queue
 * POST /api/matchmaking/leave
 */
router.post('/leave', async (req: Request, res: Response) => {
  try {
    const playerId = req.user?.id;
    if (!playerId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const success = matchmakingService.leaveQueue(playerId);

    res.status(200).json({
      success,
      message: success ? 'Successfully left matchmaking queue' : 'Player was not in queue'
    });
  } catch (error) {
    console.error('Leave matchmaking queue error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get queue status
 * GET /api/matchmaking/status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const playerId = req.user?.id;
    if (!playerId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const queueStatus = matchmakingService.getQueueStatus(playerId);

    if (queueStatus) {
      res.status(200).json({
        success: true,
        data: queueStatus
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Player not in matchmaking queue'
      });
    }
  } catch (error) {
    console.error('Get queue status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get matchmaking statistics (admin/debug endpoint)
 * GET /api/matchmaking/stats
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    // In a production environment, you might want to restrict this to admin users
    const stats = matchmakingService.getMatchmakingStats();

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get matchmaking stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Quick match endpoint (simplified matchmaking)
 * POST /api/matchmaking/quick-match
 */
router.post('/quick-match', async (req: Request, res: Response) => {
  try {
    const playerId = req.user?.id;
    if (!playerId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { connectionInfo } = req.body;

    // Validate connection info
    if (!connectionInfo || !connectionInfo.region || !connectionInfo.connectionQuality) {
      return res.status(400).json({
        success: false,
        message: 'Connection info (region and connectionQuality) is required'
      });
    }

    // Use default preferences for quick match
    const defaultPreferences: Partial<MatchmakingPreferences> = {
      skillRange: 300, // Wider skill range for faster matching
      maxWaitTime: 45, // Shorter wait time
      preferredRegion: connectionInfo.region,
      gameMode: 'classic'
    };

    const result = await matchmakingService.joinQueue(
      playerId,
      defaultPreferences,
      {
        region: connectionInfo.region,
        latency: connectionInfo.latency,
        connectionQuality: connectionInfo.connectionQuality
      }
    );

    if (result.success) {
      res.status(200).json({
        ...result,
        message: 'Joined quick match queue'
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Quick match error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;