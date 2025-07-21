import { Types } from 'mongoose';
import { Player, IPlayer, PlayerStats, GameRole } from '../models/Player';
import { validateUsername, sanitizeInput } from '../utils/validation';

// Interfaces for player operations
export interface ProfileUpdateData {
  username?: string;
  avatar?: string;
}

export interface PlayerSearchResult {
  _id: string;
  username: string;
  avatar: string;
  statistics: PlayerStats;
  isOnline?: boolean;
}

export interface FriendRequest {
  fromPlayerId: string;
  toPlayerId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
}

export interface ServiceResult<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

export class PlayerService {
  /**
   * Get player profile by ID
   */
  static async getPlayerProfile(playerId: string): Promise<ServiceResult<IPlayer>> {
    try {
      if (!Types.ObjectId.isValid(playerId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      const player = await Player.findById(playerId)
        .populate('friends', 'username avatar statistics.eloRating lastActive')
        .lean();

      if (!player) {
        return { success: false, message: 'Player not found' };
      }

      return { success: true, data: player as IPlayer };
    } catch (error) {
      console.error('Get player profile error:', error);
      return { success: false, message: 'Failed to retrieve player profile' };
    }
  }

  /**
   * Update player profile
   */
  static async updatePlayerProfile(
    playerId: string, 
    updateData: ProfileUpdateData
  ): Promise<ServiceResult<IPlayer>> {
    try {
      if (!Types.ObjectId.isValid(playerId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      // Validate and sanitize input
      const sanitizedData: Partial<ProfileUpdateData> = {};

      if (updateData.username !== undefined) {
        const sanitizedUsername = sanitizeInput(updateData.username);
        if (!validateUsername(sanitizedUsername)) {
          return { 
            success: false, 
            message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' 
          };
        }

        // Check if username is already taken
        const existingPlayer = await Player.findOne({ 
          username: sanitizedUsername,
          _id: { $ne: playerId }
        });

        if (existingPlayer) {
          return { success: false, message: 'Username already taken' };
        }

        sanitizedData.username = sanitizedUsername;
      }

      if (updateData.avatar !== undefined) {
        sanitizedData.avatar = sanitizeInput(updateData.avatar);
      }

      // Update player
      const updatedPlayer = await Player.findByIdAndUpdate(
        playerId,
        { 
          ...sanitizedData,
          updatedAt: new Date()
        },
        { new: true, runValidators: true }
      ).populate('friends', 'username avatar statistics.eloRating lastActive');

      if (!updatedPlayer) {
        return { success: false, message: 'Player not found' };
      }

      return { success: true, data: updatedPlayer };
    } catch (error) {
      console.error('Update player profile error:', error);
      if (error.code === 11000) {
        return { success: false, message: 'Username already taken' };
      }
      return { success: false, message: 'Failed to update player profile' };
    }
  }

  /**
   * Get player statistics
   */
  static async getPlayerStatistics(playerId: string): Promise<ServiceResult<PlayerStats>> {
    try {
      if (!Types.ObjectId.isValid(playerId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      const player = await Player.findById(playerId, 'statistics').lean();

      if (!player) {
        return { success: false, message: 'Player not found' };
      }

      return { success: true, data: player.statistics };
    } catch (error) {
      console.error('Get player statistics error:', error);
      return { success: false, message: 'Failed to retrieve player statistics' };
    }
  }

  /**
   * Update player statistics after a game
   */
  static async updatePlayerStatistics(
    playerId: string,
    gameResult: {
      won: boolean;
      role: GameRole;
      gameDuration: number;
      eloChange: number;
    }
  ): Promise<ServiceResult<PlayerStats>> {
    try {
      if (!Types.ObjectId.isValid(playerId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      const player = await Player.findById(playerId);
      if (!player) {
        return { success: false, message: 'Player not found' };
      }

      // Update statistics
      player.statistics.gamesPlayed += 1;
      if (gameResult.won) {
        player.statistics.gamesWon += 1;
      }

      // Update average game duration
      const totalDuration = player.statistics.averageGameDuration * (player.statistics.gamesPlayed - 1);
      player.statistics.averageGameDuration = Math.round(
        (totalDuration + gameResult.gameDuration) / player.statistics.gamesPlayed
      );

      // Update ELO rating
      player.statistics.eloRating = Math.max(0, 
        Math.min(3000, player.statistics.eloRating + gameResult.eloChange)
      );

      // Update favorite role (most played role)
      // This is a simplified approach - in a real system you'd track role counts
      player.statistics.favoriteRole = gameResult.role;

      await player.save(); // This will trigger the pre-save middleware to update win rate

      return { success: true, data: player.statistics };
    } catch (error) {
      console.error('Update player statistics error:', error);
      return { success: false, message: 'Failed to update player statistics' };
    }
  }

  /**
   * Search for players by username
   */
  static async searchPlayers(
    query: string, 
    currentPlayerId: string,
    limit: number = 10
  ): Promise<ServiceResult<PlayerSearchResult[]>> {
    try {
      if (!query || query.trim().length < 2) {
        return { success: false, message: 'Search query must be at least 2 characters long' };
      }

      const sanitizedQuery = sanitizeInput(query.trim());
      
      const players = await Player.find({
        username: { $regex: sanitizedQuery, $options: 'i' },
        _id: { $ne: currentPlayerId }
      })
      .select('username avatar statistics lastActive')
      .limit(limit)
      .lean();

      const results: PlayerSearchResult[] = players.map(player => ({
        _id: player._id.toString(),
        username: player.username,
        avatar: player.avatar,
        statistics: player.statistics,
        isOnline: player.lastActive && (Date.now() - player.lastActive.getTime()) < 5 * 60 * 1000 // 5 minutes
      }));

      return { success: true, data: results };
    } catch (error) {
      console.error('Search players error:', error);
      return { success: false, message: 'Failed to search players' };
    }
  }

  /**
   * Add a friend
   */
  static async addFriend(playerId: string, friendId: string): Promise<ServiceResult> {
    try {
      if (!Types.ObjectId.isValid(playerId) || !Types.ObjectId.isValid(friendId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      if (playerId === friendId) {
        return { success: false, message: 'Cannot add yourself as a friend' };
      }

      const [player, friend] = await Promise.all([
        Player.findById(playerId),
        Player.findById(friendId)
      ]);

      if (!player || !friend) {
        return { success: false, message: 'Player not found' };
      }

      // Check if already friends
      const friendObjectId = new Types.ObjectId(friendId);
      if (player.friends.includes(friendObjectId)) {
        return { success: false, message: 'Already friends with this player' };
      }

      // Add friend to both players
      player.addFriend(friendObjectId);
      friend.addFriend(new Types.ObjectId(playerId));

      await Promise.all([player.save(), friend.save()]);

      return { 
        success: true, 
        message: `Successfully added ${friend.username} as a friend` 
      };
    } catch (error) {
      console.error('Add friend error:', error);
      return { success: false, message: 'Failed to add friend' };
    }
  }

  /**
   * Remove a friend
   */
  static async removeFriend(playerId: string, friendId: string): Promise<ServiceResult> {
    try {
      if (!Types.ObjectId.isValid(playerId) || !Types.ObjectId.isValid(friendId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      const [player, friend] = await Promise.all([
        Player.findById(playerId),
        Player.findById(friendId)
      ]);

      if (!player || !friend) {
        return { success: false, message: 'Player not found' };
      }

      // Remove friend from both players
      const friendObjectId = new Types.ObjectId(friendId);
      const playerObjectId = new Types.ObjectId(playerId);

      player.removeFriend(friendObjectId);
      friend.removeFriend(playerObjectId);

      await Promise.all([player.save(), friend.save()]);

      return { 
        success: true, 
        message: `Successfully removed ${friend.username} from friends` 
      };
    } catch (error) {
      console.error('Remove friend error:', error);
      return { success: false, message: 'Failed to remove friend' };
    }
  }

  /**
   * Get player's friends list
   */
  static async getFriendsList(playerId: string): Promise<ServiceResult<PlayerSearchResult[]>> {
    try {
      if (!Types.ObjectId.isValid(playerId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      const player = await Player.findById(playerId)
        .populate({
          path: 'friends',
          select: 'username avatar statistics lastActive',
          options: { sort: { lastActive: -1 } }
        })
        .lean();

      if (!player) {
        return { success: false, message: 'Player not found' };
      }

      const friends: PlayerSearchResult[] = (player.friends as any[]).map(friend => ({
        _id: friend._id.toString(),
        username: friend.username,
        avatar: friend.avatar,
        statistics: friend.statistics,
        isOnline: friend.lastActive && (Date.now() - friend.lastActive.getTime()) < 5 * 60 * 1000
      }));

      return { success: true, data: friends };
    } catch (error) {
      console.error('Get friends list error:', error);
      return { success: false, message: 'Failed to retrieve friends list' };
    }
  }

  /**
   * Get leaderboard (top players by ELO rating)
   */
  static async getLeaderboard(limit: number = 50): Promise<ServiceResult<PlayerSearchResult[]>> {
    try {
      const players = await Player.find({})
        .select('username avatar statistics lastActive')
        .sort({ 'statistics.eloRating': -1 })
        .limit(limit)
        .lean();

      const leaderboard: PlayerSearchResult[] = players.map(player => ({
        _id: player._id.toString(),
        username: player.username,
        avatar: player.avatar,
        statistics: player.statistics,
        isOnline: player.lastActive && (Date.now() - player.lastActive.getTime()) < 5 * 60 * 1000
      }));

      return { success: true, data: leaderboard };
    } catch (error) {
      console.error('Get leaderboard error:', error);
      return { success: false, message: 'Failed to retrieve leaderboard' };
    }
  }

  /**
   * Update player's last active timestamp
   */
  static async updateLastActive(playerId: string): Promise<ServiceResult> {
    try {
      if (!Types.ObjectId.isValid(playerId)) {
        return { success: false, message: 'Invalid player ID' };
      }

      await Player.findByIdAndUpdate(playerId, { lastActive: new Date() });
      return { success: true };
    } catch (error) {
      console.error('Update last active error:', error);
      return { success: false, message: 'Failed to update last active' };
    }
  }
}