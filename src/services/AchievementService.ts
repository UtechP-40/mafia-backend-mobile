import { Types } from 'mongoose';
import { Achievement, PlayerAchievement, AchievementType, AchievementRarity } from '../models/Achievement';
import { Player } from '../models/Player';
import { Game } from '../models/Game';

export class AchievementService {
  // Initialize default achievements
  static async initializeAchievements() {
    const defaultAchievements = [
      // Games Played Achievements
      {
        key: 'first_game',
        name: 'First Steps',
        description: 'Play your first game of Mafia',
        type: AchievementType.GAMES_PLAYED,
        rarity: AchievementRarity.COMMON,
        icon: '🎮',
        requirement: { type: 'games_played', value: 1 },
        reward: { experience: 50 }
      },
      {
        key: 'veteran_player',
        name: 'Veteran Player',
        description: 'Play 50 games of Mafia',
        type: AchievementType.GAMES_PLAYED,
        rarity: AchievementRarity.RARE,
        icon: '🏆',
        requirement: { type: 'games_played', value: 50 },
        reward: { experience: 500, title: 'Veteran' }
      },
      {
        key: 'mafia_master',
        name: 'Mafia Master',
        description: 'Play 200 games of Mafia',
        type: AchievementType.GAMES_PLAYED,
        rarity: AchievementRarity.LEGENDARY,
        icon: '👑',
        requirement: { type: 'games_played', value: 200 },
        reward: { experience: 2000, title: 'Master' }
      },

      // Win Achievements
      {
        key: 'first_victory',
        name: 'First Victory',
        description: 'Win your first game',
        type: AchievementType.GAMES_WON,
        rarity: AchievementRarity.COMMON,
        icon: '🥇',
        requirement: { type: 'games_won', value: 1 },
        reward: { experience: 100 }
      },
      {
        key: 'champion',
        name: 'Champion',
        description: 'Win 25 games',
        type: AchievementType.GAMES_WON,
        rarity: AchievementRarity.EPIC,
        icon: '🏅',
        requirement: { type: 'games_won', value: 25 },
        reward: { experience: 1000, title: 'Champion' }
      },

      // Win Streak Achievements
      {
        key: 'hot_streak',
        name: 'Hot Streak',
        description: 'Win 3 games in a row',
        type: AchievementType.WIN_STREAK,
        rarity: AchievementRarity.RARE,
        icon: '🔥',
        requirement: { type: 'win_streak', value: 3 },
        reward: { experience: 300 }
      },
      {
        key: 'unstoppable',
        name: 'Unstoppable',
        description: 'Win 10 games in a row',
        type: AchievementType.WIN_STREAK,
        rarity: AchievementRarity.LEGENDARY,
        icon: '⚡',
        requirement: { type: 'win_streak', value: 10 },
        reward: { experience: 1500, title: 'Unstoppable' }
      },

      // Role Mastery Achievements
      {
        key: 'mafia_expert',
        name: 'Mafia Expert',
        description: 'Win 10 games as Mafia',
        type: AchievementType.ROLE_MASTERY,
        rarity: AchievementRarity.EPIC,
        icon: '🕴️',
        requirement: { type: 'role_wins', value: 10, conditions: { role: 'mafia' } },
        reward: { experience: 800, title: 'Mafia Expert' }
      },
      {
        key: 'detective_ace',
        name: 'Detective Ace',
        description: 'Win 10 games as Detective',
        type: AchievementType.ROLE_MASTERY,
        rarity: AchievementRarity.EPIC,
        icon: '🕵️',
        requirement: { type: 'role_wins', value: 10, conditions: { role: 'detective' } },
        reward: { experience: 800, title: 'Detective Ace' }
      },

      // Survival Achievements
      {
        key: 'survivor',
        name: 'Survivor',
        description: 'Survive to the end in 20 games',
        type: AchievementType.SURVIVAL,
        rarity: AchievementRarity.RARE,
        icon: '🛡️',
        requirement: { type: 'games_survived', value: 20 },
        reward: { experience: 600 }
      },

      // Social Achievements
      {
        key: 'social_butterfly',
        name: 'Social Butterfly',
        description: 'Add 10 friends',
        type: AchievementType.SOCIAL,
        rarity: AchievementRarity.COMMON,
        icon: '🦋',
        requirement: { type: 'friends_count', value: 10 },
        reward: { experience: 200 }
      },

      // Special Achievements
      {
        key: 'perfect_game',
        name: 'Perfect Game',
        description: 'Win a game without being voted for',
        type: AchievementType.SPECIAL,
        rarity: AchievementRarity.LEGENDARY,
        icon: '💎',
        requirement: { type: 'perfect_game', value: 1 },
        reward: { experience: 1000, title: 'Perfect Player' }
      }
    ];

    for (const achievementData of defaultAchievements) {
      await Achievement.findOneAndUpdate(
        { key: achievementData.key },
        achievementData,
        { upsert: true, new: true }
      );
    }
  }

  // Check and update player achievements after a game
  static async updatePlayerAchievements(playerId: Types.ObjectId, gameResult: any) {
    try {
      const player = await Player.findById(playerId);
      if (!player) return;

      const achievements = await Achievement.find({ isActive: true });
      
      for (const achievement of achievements) {
        await this.checkAchievement(playerId, achievement, player, gameResult);
      }
    } catch (error) {
      console.error('Error updating player achievements:', error);
    }
  }

  // Check if a specific achievement should be unlocked
  private static async checkAchievement(
    playerId: Types.ObjectId, 
    achievement: any, 
    player: any, 
    gameResult?: any
  ) {
    let playerAchievement = await PlayerAchievement.findOne({
      playerId,
      achievementId: achievement._id
    });

    if (!playerAchievement) {
      playerAchievement = new PlayerAchievement({
        playerId,
        achievementId: achievement._id,
        progress: 0,
        isCompleted: false
      });
    }

    if (playerAchievement.isCompleted) return;

    let currentProgress = 0;

    // Calculate progress based on achievement type
    switch (achievement.requirement.type) {
      case 'games_played':
        currentProgress = player.statistics.gamesPlayed;
        break;
      
      case 'games_won':
        currentProgress = player.statistics.gamesWon;
        break;
      
      case 'win_streak':
        // This would need to be calculated from recent games
        currentProgress = await this.calculateWinStreak(playerId);
        break;
      
      case 'friends_count':
        currentProgress = player.friends.length;
        break;
      
      case 'games_survived':
        currentProgress = await this.calculateSurvivedGames(playerId);
        break;
      
      case 'role_wins':
        currentProgress = await this.calculateRoleWins(
          playerId, 
          achievement.requirement.conditions?.role
        );
        break;
      
      case 'perfect_game':
        if (gameResult && gameResult.votesReceived === 0 && gameResult.won) {
          currentProgress = 1;
        }
        break;
    }

    playerAchievement.progress = currentProgress;

    // Check if achievement is completed
    if (currentProgress >= achievement.requirement.value) {
      playerAchievement.isCompleted = true;
      playerAchievement.unlockedAt = new Date();
      
      // Award experience points
      if (achievement.reward.experience > 0) {
        // In a real implementation, you'd have an experience system
        console.log(`Player ${playerId} earned ${achievement.reward.experience} XP`);
      }
    }

    await playerAchievement.save();
  }

  // Helper methods for calculating specific achievement progress
  private static async calculateWinStreak(playerId: Types.ObjectId): Promise<number> {
    const recentGames = await Game.find({ 
      players: playerId,
      phase: 'finished'
    })
    .sort({ createdAt: -1 })
    .limit(20);

    let streak = 0;
    for (const game of recentGames) {
      const won = game.winResult?.winningPlayers.some((id: any) => 
        id.toString() === playerId.toString()
      );
      
      if (won) {
        streak++;
      } else {
        break;
      }
    }
    
    return streak;
  }

  private static async calculateSurvivedGames(playerId: Types.ObjectId): Promise<number> {
    const games = await Game.find({ 
      players: playerId,
      phase: 'finished'
    });

    let survivedCount = 0;
    for (const game of games) {
      const wasEliminated = game.eliminatedPlayers.some((id: any) => 
        id.toString() === playerId.toString()
      );
      if (!wasEliminated) {
        survivedCount++;
      }
    }
    
    return survivedCount;
  }

  private static async calculateRoleWins(playerId: Types.ObjectId, role: string): Promise<number> {
    // This would need to be implemented based on how role data is stored
    // For now, return 0 as placeholder
    return 0;
  }

  // Get player's achievements
  static async getPlayerAchievements(playerId: Types.ObjectId) {
    const playerAchievements = await PlayerAchievement.find({ playerId })
      .populate('achievementId')
      .sort({ unlockedAt: -1 });

    const unlockedAchievements = playerAchievements.filter(pa => pa.isCompleted);
    const inProgressAchievements = playerAchievements.filter(pa => !pa.isCompleted && pa.progress > 0);
    
    // Get available achievements not yet started
    const startedAchievementIds = playerAchievements.map(pa => pa.achievementId);
    const availableAchievements = await Achievement.find({
      _id: { $nin: startedAchievementIds },
      isActive: true
    });

    return {
      unlocked: unlockedAchievements,
      inProgress: inProgressAchievements,
      available: availableAchievements,
      totalUnlocked: unlockedAchievements.length,
      totalAvailable: await Achievement.countDocuments({ isActive: true })
    };
  }

  // Get recent achievement unlocks for notifications
  static async getRecentUnlocks(playerId: Types.ObjectId, limit = 5) {
    return await PlayerAchievement.find({
      playerId,
      isCompleted: true,
      notificationSent: false
    })
    .populate('achievementId')
    .sort({ unlockedAt: -1 })
    .limit(limit);
  }

  // Mark achievement notifications as sent
  static async markNotificationsSent(achievementIds: Types.ObjectId[]) {
    await PlayerAchievement.updateMany(
      { _id: { $in: achievementIds } },
      { notificationSent: true }
    );
  }
}