import { Types } from 'mongoose';
import { Room, IRoom, RoomStatus, RoomSettings } from '../models/Room';
import { Player } from '../models/Player';
import { logger } from '../utils/logger';

export interface CreateRoomOptions {
  hostId: string;
  settings: Partial<RoomSettings>;
}

export interface JoinRoomResult {
  success: boolean;
  message: string;
  room?: IRoom;
}

export interface RoomFilters {
  maxPlayers?: number;
  hasVoiceChat?: boolean;
  allowSpectators?: boolean;
  search?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export class RoomManager {
  /**
   * Create a new room with the specified host and settings
   */
  async createRoom(options: CreateRoomOptions): Promise<IRoom> {
    try {
      const { hostId, settings } = options;

      // Validate host exists
      const host = await Player.findById(hostId);
      if (!host) {
        throw new Error('Host player not found');
      }

      // Generate unique room code
      let roomCode: string;
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 10;

      do {
        roomCode = this.generateRoomCode();
        const existingRoom = await Room.findOne({ code: roomCode });
        isUnique = !existingRoom;
        attempts++;
      } while (!isUnique && attempts < maxAttempts);

      if (!isUnique) {
        throw new Error('Failed to generate unique room code');
      }

      // Create room with default settings merged with provided settings
      const room = new Room({
        code: roomCode!,
        hostId: new Types.ObjectId(hostId),
        players: [new Types.ObjectId(hostId)],
        settings: {
          isPublic: true,
          maxPlayers: 8,
          gameSettings: {
            maxPlayers: 8,
            enableVoiceChat: true,
            dayPhaseDuration: 300000, // 5 minutes
            nightPhaseDuration: 120000, // 2 minutes
            votingDuration: 60000, // 1 minute
            roles: []
          },
          allowSpectators: false,
          requireInvite: false,
          ...settings
        },
        status: RoomStatus.WAITING
      });

      await room.save();
      await room.populate('hostId', 'username avatar');
      await room.populate('players', 'username avatar');

      logger.info(`Room created: ${room.code} by host ${hostId}`);
      return room;
    } catch (error) {
      logger.error('Error creating room:', error);
      throw error;
    }
  }

  /**
   * Join a room by room code or ID
   */
  async joinRoom(roomIdentifier: string, playerId: string): Promise<JoinRoomResult> {
    try {
      // Find room by code or ID
      let room: IRoom | null;
      if (Types.ObjectId.isValid(roomIdentifier)) {
        room = await Room.findById(roomIdentifier)
          .populate('hostId', 'username avatar')
          .populate('players', 'username avatar');
      } else {
        room = await Room.findByCode(roomIdentifier);
      }

      if (!room) {
        return {
          success: false,
          message: 'Room not found'
        };
      }

      // Check if room is joinable
      if (room.status !== RoomStatus.WAITING) {
        return {
          success: false,
          message: 'Room is not accepting new players'
        };
      }

      if (room.isFull) {
        return {
          success: false,
          message: 'Room is full'
        };
      }

      // Check if player is already in room
      const playerObjectId = new Types.ObjectId(playerId);
      if (room.players.some((p: any) => p._id.equals(playerObjectId))) {
        return {
          success: true,
          message: 'Already in room',
          room
        };
      }

      // Check if room requires invite
      if (room.settings.requireInvite && !room.hostId.equals(playerObjectId)) {
        return {
          success: false,
          message: 'Room requires invitation'
        };
      }

      // Validate player exists
      const player = await Player.findById(playerId);
      if (!player) {
        return {
          success: false,
          message: 'Player not found'
        };
      }

      // Add player to room
      room.players.push(playerObjectId);
      await room.save();
      await room.populate('players', 'username avatar');

      logger.info(`Player ${playerId} joined room ${room.code}`);
      return {
        success: true,
        message: 'Successfully joined room',
        room
      };
    } catch (error) {
      logger.error('Error joining room:', error);
      return {
        success: false,
        message: 'Internal server error'
      };
    }
  }

  /**
   * Leave a room
   */
  async leaveRoom(roomId: string, playerId: string): Promise<boolean> {
    try {
      const room = await Room.findById(roomId);
      if (!room) {
        return false;
      }

      const playerObjectId = new Types.ObjectId(playerId);
      const wasRemoved = room.removePlayer(playerObjectId);

      if (wasRemoved) {
        // If host left and there are other players, transfer host
        if (room.hostId.equals(playerObjectId) && room.players.length > 0) {
          room.hostId = room.players[0] as Types.ObjectId;
          logger.info(`Host transferred to ${room.players[0]} in room ${room.code}`);
        }

        // If no players left, mark room as cancelled
        if (room.players.length === 0) {
          room.status = RoomStatus.CANCELLED;
          logger.info(`Room ${room.code} cancelled - no players remaining`);
        }

        await room.save();
        logger.info(`Player ${playerId} left room ${room.code}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error leaving room:', error);
      return false;
    }
  }

  /**
   * Update room settings (host only)
   */
  async updateRoomSettings(roomId: string, hostId: string, settings: Partial<RoomSettings>): Promise<IRoom | null> {
    try {
      const room = await Room.findById(roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      // Verify host permissions
      if (!room.hostId.equals(new Types.ObjectId(hostId))) {
        throw new Error('Only the host can update room settings');
      }

      // Verify room is in waiting state
      if (room.status !== RoomStatus.WAITING) {
        throw new Error('Cannot update settings for a room that has started');
      }

      // Validate new settings
      if (settings.maxPlayers && settings.maxPlayers < room.players.length) {
        throw new Error('Cannot set max players below current player count');
      }

      // Update settings
      room.settings = {
        ...room.settings,
        ...settings
      };

      await room.save();
      await room.populate('hostId', 'username avatar');
      await room.populate('players', 'username avatar');

      logger.info(`Room settings updated for ${room.code} by host ${hostId}`);
      return room;
    } catch (error) {
      logger.error('Error updating room settings:', error);
      throw error;
    }
  }

  /**
   * Get public rooms with filtering and pagination
   */
  async getPublicRooms(filters: RoomFilters = {}, pagination: PaginationOptions = { page: 1, limit: 20 }): Promise<{
    rooms: IRoom[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const { page, limit } = pagination;
      const skip = (page - 1) * limit;

      // Build query
      const query: any = {
        'settings.isPublic': true,
        status: RoomStatus.WAITING
      };

      if (filters.maxPlayers) {
        query['settings.maxPlayers'] = { $gte: filters.maxPlayers };
      }

      if (filters.hasVoiceChat !== undefined) {
        query['settings.gameSettings.enableVoiceChat'] = filters.hasVoiceChat;
      }

      if (filters.allowSpectators !== undefined) {
        query['settings.allowSpectators'] = filters.allowSpectators;
      }

      // Search in host username if search term provided
      let rooms: IRoom[];
      let total: number;

      if (filters.search) {
        const searchRegex = new RegExp(filters.search, 'i');
        
        // First get all rooms matching other criteria
        const allRooms = await Room.find(query)
          .populate('hostId', 'username avatar')
          .populate('players', 'username avatar');

        // Filter by search term in host username
        const filteredRooms = allRooms.filter(room => 
          searchRegex.test((room.hostId as any).username)
        );

        total = filteredRooms.length;
        rooms = filteredRooms
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(skip, skip + limit);
      } else {
        total = await Room.countDocuments(query);
        rooms = await Room.find(query)
          .populate('hostId', 'username avatar')
          .populate('players', 'username avatar')
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(skip);
      }

      const totalPages = Math.ceil(total / limit);

      return {
        rooms,
        total,
        page,
        totalPages
      };
    } catch (error) {
      logger.error('Error getting public rooms:', error);
      throw error;
    }
  }

  /**
   * Get room by ID or code
   */
  async getRoomById(roomId: string): Promise<IRoom | null> {
    try {
      return await Room.findById(roomId)
        .populate('hostId', 'username avatar')
        .populate('players', 'username avatar');
    } catch (error) {
      logger.error('Error getting room by ID:', error);
      return null;
    }
  }

  /**
   * Get room by code
   */
  async getRoomByCode(code: string): Promise<IRoom | null> {
    try {
      return await Room.findByCode(code);
    } catch (error) {
      logger.error('Error getting room by code:', error);
      return null;
    }
  }

  /**
   * Transfer host privileges to another player
   */
  async transferHost(roomId: string, currentHostId: string, newHostId: string): Promise<boolean> {
    try {
      const room = await Room.findById(roomId);
      if (!room) {
        return false;
      }

      // Verify current host permissions
      if (!room.hostId.equals(new Types.ObjectId(currentHostId))) {
        throw new Error('Only the current host can transfer host privileges');
      }

      // Verify new host is in the room
      const newHostObjectId = new Types.ObjectId(newHostId);
      if (!room.players.some((p: any) => p.equals(newHostObjectId))) {
        throw new Error('New host must be a player in the room');
      }

      room.hostId = newHostObjectId;
      await room.save();

      logger.info(`Host transferred from ${currentHostId} to ${newHostId} in room ${room.code}`);
      return true;
    } catch (error) {
      logger.error('Error transferring host:', error);
      throw error;
    }
  }

  /**
   * Generate a unique 6-character room code
   */
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Clean up old cancelled or finished rooms
   */
  async cleanupOldRooms(olderThanHours: number = 24): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
      
      const result = await Room.deleteMany({
        $or: [
          { status: RoomStatus.CANCELLED },
          { status: RoomStatus.FINISHED }
        ],
        updatedAt: { $lt: cutoffDate }
      });

      logger.info(`Cleaned up ${result.deletedCount} old rooms`);
      return result.deletedCount || 0;
    } catch (error) {
      logger.error('Error cleaning up old rooms:', error);
      return 0;
    }
  }
}