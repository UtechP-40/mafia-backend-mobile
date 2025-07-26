import { Router, Request, Response } from 'express';
import { Game } from '../models/Game';
import { Player } from '../models/Player';
import { authenticateToken } from '../middleware/authMiddleware';
import { AchievementService } from '../services/AchievementService';
import { Types } from 'mongoose';

const router = Router();

// Get game history for a player
router.get('/history', authenticateToken, async (req: Request, res: Response) => {
  try {
    const playerId = req.user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const games = await Game.find({ 
      players: new Types.ObjectId(playerId),
      phase: 'finished'
    })
    .populate('players', 'username avatar role')
    .populate('eliminatedPlayers', 'username avatar role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const totalGames = await Game.countDocuments({ 
      players: new Types.ObjectId(playerId),
      phase: 'finished'
    });

    res.json({
      games,
      pagination: {
        page,
        limit,
        total: totalGames,
        pages: Math.ceil(totalGames / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ message: 'Failed to fetch game history' });
  }
});

// Get detailed game results by game ID
router.get('/:gameId/results', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { gameId } = req.params;
    const playerId = req.user?.id;

    const game = await Game.findById(gameId)
      .populate('players', 'username avatar role statistics')
      .populate('eliminatedPlayers', 'username avatar role statistics');

    if (!game) {
      res.status(404).json({ message: 'Game not found' });
      return;
    }

    // Check if player was part of this game
    const wasPlayerInGame = game.players.some((player: any) => 
      player._id.toString() === playerId
    );

    if (!wasPlayerInGame) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    // Calculate match statistics
    const matchStats = {
      duration: game.updatedAt.getTime() - game.createdAt.getTime(),
      totalPlayers: game.players.length,
      eliminatedCount: game.eliminatedPlayers.length,
      survivorCount: game.players.length - game.eliminatedPlayers.length,
      totalVotes: game.history.filter(event => event.type === 'player_vote').length,
      daysCycled: game.dayNumber,
      winResult: game.winResult
    };

    // Calculate player performance in this game
    const playerPerformance = game.players.map((player: any) => {
      const wasEliminated = game.eliminatedPlayers.some((eliminated: any) => 
        eliminated._id.toString() === player._id.toString()
      );
      
      const playerVotes = game.history.filter(event => 
        event.type === 'player_vote' && event.playerId?.toString() === player._id.toString()
      ).length;

      const votesReceived = game.history.filter(event => 
        event.type === 'player_vote' && event.targetId?.toString() === player._id.toString()
      ).length;

      return {
        player: {
          id: player._id,
          username: player.username,
          avatar: player.avatar,
          role: player.role
        },
        wasEliminated,
        eliminationDay: wasEliminated ? 
          game.history.find(event => 
            event.type === 'player_elimination' && 
            event.playerId?.toString() === player._id.toString()
          )?.dayNumber : null,
        votesCast: playerVotes,
        votesReceived,
        survived: !wasEliminated
      };
    });

    res.json({
      game: {
        id: game._id,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        settings: game.settings
      },
      matchStats,
      playerPerformance,
      gameEvents: game.history
    });
  } catch (error) {
    console.error('Error fetching game results:', error);
    res.status(500).json({ message: 'Failed to fetch game results' });
  }
});

// Get player statistics
router.get('/stats/:playerId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const targetPlayerId = req.params.playerId || req.user?.id;
    const requestingPlayerId = req.user?.id;

    // Check if requesting player can view these stats (self or friend)
    if (targetPlayerId !== requestingPlayerId) {
      const requestingPlayer = await Player.findById(requestingPlayerId);
      if (!requestingPlayer?.friends.includes(new Types.ObjectId(targetPlayerId))) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }
    }

    const player = await Player.findById(targetPlayerId);
    if (!player) {
      res.status(404).json({ message: 'Player not found' });
      return;
    }

    // Get recent games for trend analysis
    const recentGames = await Game.find({ 
      players: new Types.ObjectId(targetPlayerId),
      phase: 'finished'
    })
    .sort({ createdAt: -1 })
    .limit(20);

    // Calculate role statistics
    const roleStats = recentGames.reduce((acc: any, game) => {
      const playerInGame = game.players.find((p: any) => p.toString() === targetPlayerId);
      if (playerInGame) {
        // Note: In a real implementation, we'd need to store role info in game history
        // For now, we'll use placeholder data
        const role = 'villager'; // This should come from game data
        acc[role] = (acc[role] || 0) + 1;
      }
      return acc;
    }, {});

    // Calculate win streak
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    
    for (const game of recentGames) {
      const won = game.winResult?.winningPlayers.some((id: any) => 
        id.toString() === targetPlayerId
      );
      
      if (won) {
        tempStreak++;
        if (tempStreak === 1) currentStreak = tempStreak;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 0;
        if (currentStreak > 0) currentStreak = 0;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak);

    res.json({
      player: {
        id: player._id,
        username: player.username,
        avatar: player.avatar,
        statistics: player.statistics
      },
      roleStats,
      streaks: {
        current: currentStreak,
        longest: longestStreak
      },
      recentPerformance: recentGames.slice(0, 10).map(game => ({
        gameId: game._id,
        date: game.createdAt,
        won: game.winResult?.winningPlayers.some((id: any) => 
          id.toString() === targetPlayerId
        ),
        role: 'villager', // Placeholder
        duration: game.updatedAt.getTime() - game.createdAt.getTime()
      }))
    });
  } catch (error) {
    console.error('Error fetching player statistics:', error);
    res.status(500).json({ message: 'Failed to fetch player statistics' });
  }
});

// Get player achievements
router.get('/achievements/:playerId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const targetPlayerId = req.params.playerId || req.user?.id;
    const requestingPlayerId = req.user?.id;

    // Check if requesting player can view these achievements (self or friend)
    if (targetPlayerId !== requestingPlayerId) {
      const requestingPlayer = await Player.findById(requestingPlayerId);
      if (!requestingPlayer?.friends.includes(new Types.ObjectId(targetPlayerId))) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }
    }

    const achievements = await AchievementService.getPlayerAchievements(
      new Types.ObjectId(targetPlayerId)
    );

    res.json(achievements);
  } catch (error) {
    console.error('Error fetching player achievements:', error);
    res.status(500).json({ message: 'Failed to fetch player achievements' });
  }
});

// Get recent achievement unlocks for notifications
router.get('/achievements/recent/:playerId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const targetPlayerId = req.params.playerId || req.user?.id;
    const requestingPlayerId = req.user?.id;

    // Only allow players to view their own recent unlocks
    if (targetPlayerId !== requestingPlayerId) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    const recentUnlocks = await AchievementService.getRecentUnlocks(
      new Types.ObjectId(targetPlayerId)
    );

    res.json({ recentUnlocks });
  } catch (error) {
    console.error('Error fetching recent achievements:', error);
    res.status(500).json({ message: 'Failed to fetch recent achievements' });
  }
});

// Mark achievement notifications as read
router.post('/achievements/mark-read', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { achievementIds } = req.body;
    
    if (!Array.isArray(achievementIds)) {
      res.status(400).json({ message: 'Achievement IDs must be an array' });
      return;
    }

    const objectIds = achievementIds.map(id => new Types.ObjectId(id));
    await AchievementService.markNotificationsSent(objectIds);

    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ message: 'Failed to mark notifications as read' });
  }
});

export { router as gameRoutes };