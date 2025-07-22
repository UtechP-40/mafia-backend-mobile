import { RoomManager, CreateRoomOptions, JoinRoomResult, RoomFilters, PaginationOptions } from '../game/roomManager';
import { IRoom, RoomSettings } from '../models/Room';

/**
 * Service layer for room management operations
 * Provides a clean interface between API routes and the RoomManager
 */
export class RoomService {
  private roomManager: RoomManager;

  constructor() {
    this.roomManager = new RoomManager();
  }

  /**
   * Create a new room
   */
  async createRoom(options: CreateRoomOptions): Promise<IRoom> {
    return await this.roomManager.createRoom(options);
  }

  /**
   * Join a room by code or ID
   */
  async joinRoom(roomIdentifier: string, playerId: string): Promise<JoinRoomResult> {
    return await this.roomManager.joinRoom(roomIdentifier, playerId);
  }

  /**
   * Leave a room
   */
  async leaveRoom(roomId: string, playerId: string): Promise<boolean> {
    return await this.roomManager.leaveRoom(roomId, playerId);
  }

  /**
   * Update room settings (host only)
   */
  async updateRoomSettings(roomId: string, hostId: string, settings: Partial<RoomSettings>): Promise<IRoom | null> {
    return await this.roomManager.updateRoomSettings(roomId, hostId, settings);
  }

  /**
   * Get public rooms with filtering and pagination
   */
  async getPublicRooms(filters: RoomFilters = {}, pagination: PaginationOptions = { page: 1, limit: 20 }) {
    return await this.roomManager.getPublicRooms(filters, pagination);
  }

  /**
   * Get room by ID
   */
  async getRoomById(roomId: string): Promise<IRoom | null> {
    return await this.roomManager.getRoomById(roomId);
  }

  /**
   * Get room by code
   */
  async getRoomByCode(code: string): Promise<IRoom | null> {
    return await this.roomManager.getRoomByCode(code);
  }

  /**
   * Transfer host privileges
   */
  async transferHost(roomId: string, currentHostId: string, newHostId: string): Promise<boolean> {
    return await this.roomManager.transferHost(roomId, currentHostId, newHostId);
  }

  /**
   * Clean up old rooms
   */
  async cleanupOldRooms(olderThanHours: number = 24): Promise<number> {
    return await this.roomManager.cleanupOldRooms(olderThanHours);
  }
}