import mongoose, { Types, Document, Model, FilterQuery, UpdateQuery, PipelineStage } from 'mongoose';
import { Player, Game, Room, ChatMessage } from '../models';
import { logger } from './logger';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mafia-game';

export const connectDatabase = async (): Promise<void> => {
  try {
    const options = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds
    };

    await mongoose.connect(MONGODB_URI, options);
    
    logger.info('Connected to MongoDB successfully');
    
    // Handle connection events
    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    
    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (error) {
        logger.error('Error during MongoDB disconnection:', error);
        process.exit(1);
      }
    });
    
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection:', error);
    throw error;
  }
};

// Generic CRUD Operations
export class DatabaseUtils {
  /**
   * Generic create operation
   */
  static async create<T extends Document>(
    model: Model<T>,
    data: Partial<T>
  ): Promise<T> {
    try {
      const document = new model(data);
      return await document.save();
    } catch (error) {
      logger.error(`Error creating document in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic find by ID operation
   */
  static async findById<T extends Document>(
    model: Model<T>,
    id: string | Types.ObjectId,
    populate?: string | string[]
  ): Promise<T | null> {
    try {
      let query = model.findById(id);
      if (populate) {
        query = query.populate(populate);
      }
      return await query.exec();
    } catch (error) {
      logger.error(`Error finding document by ID in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic find operation with filtering
   */
  static async find<T extends Document>(
    model: Model<T>,
    filter: FilterQuery<T> = {},
    options: {
      populate?: string | string[];
      sort?: any;
      limit?: number;
      skip?: number;
      select?: string;
    } = {}
  ): Promise<T[]> {
    try {
      let query = model.find(filter);
      
      if (options.populate) {
        query = query.populate(options.populate);
      }
      if (options.sort) {
        query = query.sort(options.sort);
      }
      if (options.limit) {
        query = query.limit(options.limit);
      }
      if (options.skip) {
        query = query.skip(options.skip);
      }
      if (options.select) {
        query = query.select(options.select) as any;
      }
      
      return await query.exec();
    } catch (error) {
      logger.error(`Error finding documents in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic find one operation
   */
  static async findOne<T extends Document>(
    model: Model<T>,
    filter: FilterQuery<T>,
    populate?: string | string[]
  ): Promise<T | null> {
    try {
      let query = model.findOne(filter);
      if (populate) {
        query = query.populate(populate);
      }
      return await query.exec();
    } catch (error) {
      logger.error(`Error finding document in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic update by ID operation
   */
  static async updateById<T extends Document>(
    model: Model<T>,
    id: string | Types.ObjectId,
    update: UpdateQuery<T>,
    options: { new?: boolean; runValidators?: boolean } = { new: true, runValidators: true }
  ): Promise<T | null> {
    try {
      return await model.findByIdAndUpdate(id, update, options).exec();
    } catch (error) {
      logger.error(`Error updating document by ID in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic update operation
   */
  static async updateOne<T extends Document>(
    model: Model<T>,
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: { new?: boolean; runValidators?: boolean } = { new: true, runValidators: true }
  ): Promise<T | null> {
    try {
      return await model.findOneAndUpdate(filter, update, options).exec();
    } catch (error) {
      logger.error(`Error updating document in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic delete by ID operation
   */
  static async deleteById<T extends Document>(
    model: Model<T>,
    id: string | Types.ObjectId
  ): Promise<T | null> {
    try {
      return await model.findByIdAndDelete(id).exec();
    } catch (error) {
      logger.error(`Error deleting document by ID in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic delete operation
   */
  static async deleteOne<T extends Document>(
    model: Model<T>,
    filter: FilterQuery<T>
  ): Promise<T | null> {
    try {
      return await model.findOneAndDelete(filter).exec();
    } catch (error) {
      logger.error(`Error deleting document in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic count operation
   */
  static async count<T extends Document>(
    model: Model<T>,
    filter: FilterQuery<T> = {}
  ): Promise<number> {
    try {
      return await model.countDocuments(filter).exec();
    } catch (error) {
      logger.error(`Error counting documents in ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Generic aggregation operation
   */
  static async aggregate<T extends Document, R = any>(
    model: Model<T>,
    pipeline: PipelineStage[]
  ): Promise<R[]> {
    try {
      return await model.aggregate(pipeline).exec();
    } catch (error) {
      logger.error(`Error in aggregation for ${model.modelName}:`, error);
      throw error;
    }
  }

  /**
   * Bulk write operation
   */
  static async bulkWrite<T extends Document>(
    model: Model<T>,
    operations: any[]
  ): Promise<any> {
    try {
      return await model.bulkWrite(operations);
    } catch (error) {
      logger.error(`Error in bulk write for ${model.modelName}:`, error);
      throw error;
    }
  }
}

// Specialized Player Operations
export class PlayerOperations {
  /**
   * Find players by username pattern
   */
  static async findByUsernamePattern(pattern: string, limit = 10) {
    return DatabaseUtils.find(Player, {
      username: { $regex: pattern, $options: 'i' }
    }, { limit, select: 'username avatar statistics.eloRating' });
  }

  /**
   * Get player leaderboard by ELO rating
   */
  static async getLeaderboard(limit = 50) {
    return DatabaseUtils.find(Player, {}, {
      sort: { 'statistics.eloRating': -1 },
      limit,
      select: 'username avatar statistics'
    });
  }

  /**
   * Update player statistics after game
   */
  static async updateGameStats(
    playerId: Types.ObjectId,
    won: boolean,
    gameDuration: number,
    role: string
  ) {
    const player = await Player.findById(playerId);
    if (!player) throw new Error('Player not found');

    player.statistics.gamesPlayed += 1;
    if (won) {
      player.statistics.gamesWon += 1;
    }
    
    // Update average game duration
    const totalDuration = player.statistics.averageGameDuration * (player.statistics.gamesPlayed - 1);
    player.statistics.averageGameDuration = (totalDuration + gameDuration) / player.statistics.gamesPlayed;
    
    // Update favorite role (simplified logic)
    player.statistics.favoriteRole = role as any;
    
    return await player.save();
  }

  /**
   * Get player's friend list with online status
   */
  static async getFriendsWithStatus(playerId: Types.ObjectId) {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    return DatabaseUtils.aggregate(Player, [
      { $match: { _id: playerId } },
      {
        $lookup: {
          from: 'players',
          localField: 'friends',
          foreignField: '_id',
          as: 'friendsList'
        }
      },
      { $unwind: '$friendsList' },
      {
        $project: {
          _id: '$friendsList._id',
          username: '$friendsList.username',
          avatar: '$friendsList.avatar',
          isOnline: { $gte: ['$friendsList.lastActive', fiveMinutesAgo] },
          lastActive: '$friendsList.lastActive'
        }
      },
      { $sort: { isOnline: -1, lastActive: -1 } }
    ]);
  }
}

// Specialized Game Operations
export class GameOperations {
  /**
   * Get active games count
   */
  static async getActiveGamesCount() {
    return DatabaseUtils.count(Game, {
      phase: { $ne: 'finished' }
    });
  }

  /**
   * Get game statistics for analytics
   */
  static async getGameAnalytics(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return DatabaseUtils.aggregate(Game, [
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
          },
          totalGames: { $sum: 1 },
          completedGames: {
            $sum: { $cond: [{ $eq: ['$phase', 'finished'] }, 1, 0] }
          },
          averageDuration: {
            $avg: {
              $subtract: ['$updatedAt', '$createdAt']
            }
          }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);
  }

  /**
   * Get player performance in recent games
   */
  static async getPlayerPerformance(playerId: Types.ObjectId, limit = 10) {
    return DatabaseUtils.aggregate(Game, [
      { $match: { players: playerId, phase: 'finished' } },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          dayNumber: 1,
          winResult: 1,
          duration: { $subtract: ['$updatedAt', '$createdAt'] },
          playerWon: {
            $in: [playerId, '$winResult.winningPlayers']
          }
        }
      }
    ]);
  }
}

// Specialized Room Operations
export class RoomOperations {
  /**
   * Find available public rooms
   */
  static async findAvailableRooms(maxPlayers?: number) {
    const filter: any = {
      'settings.isPublic': true,
      status: 'waiting'
    };

    if (maxPlayers) {
      filter['settings.maxPlayers'] = { $lte: maxPlayers };
    }

    return DatabaseUtils.find(Room, filter, {
      populate: ['hostId', 'players'],
      sort: { createdAt: -1 },
      limit: 20
    });
  }

  /**
   * Get room statistics
   */
  static async getRoomStats() {
    return DatabaseUtils.aggregate(Room, [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          averagePlayerCount: { $avg: { $size: '$players' } }
        }
      }
    ]);
  }

  /**
   * Cleanup old finished rooms
   */
  static async cleanupOldRooms(hoursOld = 24) {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hoursOld);

    return Room.deleteMany({
      status: { $in: ['finished', 'cancelled'] },
      updatedAt: { $lt: cutoffDate }
    });
  }
}

// Specialized Chat Operations
export class ChatOperations {
  /**
   * Get recent messages for a room
   */
  static async getRoomMessages(
    roomId: Types.ObjectId,
    limit = 50,
    before?: Date
  ) {
    const filter: any = { roomId };
    if (before) {
      filter.timestamp = { $lt: before };
    }

    return DatabaseUtils.find(ChatMessage, filter, {
      populate: 'playerId',
      sort: { timestamp: -1 },
      limit
    });
  }

  /**
   * Get moderation statistics
   */
  static async getModerationStats(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return DatabaseUtils.aggregate(ChatMessage, [
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          moderatedMessages: {
            $sum: { $cond: ['$isModerated', 1, 0] }
          },
          messagesByType: {
            $push: '$type'
          }
        }
      },
      {
        $project: {
          totalMessages: 1,
          moderatedMessages: 1,
          moderationRate: {
            $multiply: [
              { $divide: ['$moderatedMessages', '$totalMessages'] },
              100
            ]
          },
          messagesByType: 1
        }
      }
    ]);
  }

  /**
   * Bulk moderate messages
   */
  static async bulkModerateMessages(
    messageIds: Types.ObjectId[],
    reason: string
  ) {
    return ChatMessage.updateMany(
      { _id: { $in: messageIds } },
      {
        $set: {
          isModerated: true,
          moderationReason: reason,
          content: '[Message moderated]'
        }
      }
    );
  }
}

// Database Health and Maintenance
export class DatabaseMaintenance {
  /**
   * Check database connection health
   */
  static async checkHealth(): Promise<{
    connected: boolean;
    readyState: number;
    collections: string[];
  }> {
    try {
      const isConnected = mongoose.connection.readyState === 1;
      const collections = await mongoose.connection.db?.listCollections().toArray() || [];
      
      return {
        connected: isConnected,
        readyState: mongoose.connection.readyState,
        collections: collections.map(col => col.name)
      };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return {
        connected: false,
        readyState: mongoose.connection.readyState,
        collections: []
      };
    }
  }

  /**
   * Get database statistics
   */
  static async getStats() {
    try {
      const [playerCount, gameCount, roomCount, messageCount] = await Promise.all([
        DatabaseUtils.count(Player),
        DatabaseUtils.count(Game),
        DatabaseUtils.count(Room),
        DatabaseUtils.count(ChatMessage)
      ]);

      return {
        players: playerCount,
        games: gameCount,
        rooms: roomCount,
        messages: messageCount,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error getting database stats:', error);
      throw error;
    }
  }

  /**
   * Perform routine cleanup
   */
  static async performCleanup() {
    try {
      logger.info('Starting database cleanup...');
      
      // Cleanup old finished rooms
      const roomsDeleted = await RoomOperations.cleanupOldRooms(24);
      logger.info(`Cleaned up ${roomsDeleted.deletedCount} old rooms`);
      
      // Cleanup old chat messages
      const messagesDeleted = await (ChatMessage as any).cleanupOldMessages(30);
      logger.info(`Cleaned up ${messagesDeleted.deletedCount} old messages`);
      
      // Update player last active status for inactive players
      const inactiveThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
      const inactivePlayersUpdated = await Player.updateMany(
        { lastActive: { $lt: inactiveThreshold } },
        { $set: { lastActive: inactiveThreshold } }
      );
      logger.info(`Updated ${inactivePlayersUpdated.modifiedCount} inactive players`);
      
      logger.info('Database cleanup completed successfully');
      
      return {
        roomsDeleted: roomsDeleted.deletedCount,
        messagesDeleted: messagesDeleted.deletedCount,
        inactivePlayersUpdated: inactivePlayersUpdated.modifiedCount
      };
    } catch (error) {
      logger.error('Database cleanup failed:', error);
      throw error;
    }
  }
}