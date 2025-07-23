import { Types } from 'mongoose';
import { Player, IPlayer } from '../models/Player';
import { RoomService } from './RoomService';
import { CreateRoomOptions } from '../game/roomManager';

// Interfaces for matchmaking
export interface MatchmakingPreferences {
  skillRange: number; // ELO range tolerance (default: 200)
  maxWaitTime: number; // Maximum wait time in seconds (default: 60)
  preferredRegion?: string; // Preferred region for connection quality
  gameMode?: string; // Game mode preference
}

export interface MatchmakingRequest {
  playerId: string;
  preferences: MatchmakingPreferences;
  timestamp: Date;
  connectionInfo: {
    region: string;
    latency?: number;
    connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
  };
}

export interface MatchResult {
  success: boolean;
  roomId?: string;
  roomCode?: string;
  players?: string[];
  message?: string;
  estimatedWaitTime?: number;
}

export interface QueueStatus {
  position: number;
  estimatedWaitTime: number;
  playersInQueue: number;
  averageElo: number;
}

/**
 * Matchmaking Service for skill-based and region-based player matching
 */
export class MatchmakingService {
  private static instance: MatchmakingService;
  private matchmakingQueue: Map<string, MatchmakingRequest> = new Map();
  private roomService: RoomService;
  private matchmakingInterval: NodeJS.Timeout | null = null;
  
  // Configuration constants
  private readonly DEFAULT_SKILL_RANGE = 200;
  private readonly DEFAULT_MAX_WAIT_TIME = 60;
  private readonly MATCHMAKING_INTERVAL = 2000; // 2 seconds
  private readonly MIN_PLAYERS_PER_GAME = 4;
  private readonly MAX_PLAYERS_PER_GAME = 10;
  private readonly SKILL_RANGE_EXPANSION_RATE = 50; // ELO points per 10 seconds
  private readonly REGION_BONUS = 100; // ELO bonus for same region matching

  constructor() {
    this.roomService = new RoomService();
    this.startMatchmakingLoop();
  }

  /**
   * Singleton pattern for matchmaking service
   */
  static getInstance(): MatchmakingService {
    if (!MatchmakingService.instance) {
      MatchmakingService.instance = new MatchmakingService();
    }
    return MatchmakingService.instance;
  }

  /**
   * Add player to matchmaking queue
   */
  async joinQueue(
    playerId: string, 
    preferences: Partial<MatchmakingPreferences> = {},
    connectionInfo: MatchmakingRequest['connectionInfo']
  ): Promise<{ success: boolean; message?: string; queueStatus?: QueueStatus }> {
    try {
      // Validate ObjectId format first
      if (!Types.ObjectId.isValid(playerId)) {
        return { success: false, message: 'Player not found' };
      }

      // Validate player exists and get their stats
      const player = await Player.findById(playerId).select('username statistics').lean();
      if (!player) {
        return { success: false, message: 'Player not found' };
      }

      // Check if player is already in queue
      if (this.matchmakingQueue.has(playerId)) {
        return { success: false, message: 'Player already in matchmaking queue' };
      }

      // Create matchmaking request with defaults
      const matchmakingRequest: MatchmakingRequest = {
        playerId,
        preferences: {
          skillRange: preferences.skillRange || this.DEFAULT_SKILL_RANGE,
          maxWaitTime: preferences.maxWaitTime || this.DEFAULT_MAX_WAIT_TIME,
          preferredRegion: preferences.preferredRegion || connectionInfo.region,
          gameMode: preferences.gameMode || 'classic'
        },
        timestamp: new Date(),
        connectionInfo
      };

      // Add to queue
      this.matchmakingQueue.set(playerId, matchmakingRequest);

      // Get queue status
      const queueStatus = this.getQueueStatus(playerId);

      return { 
        success: true, 
        message: 'Successfully joined matchmaking queue',
        queueStatus: queueStatus || undefined
      };
    } catch (error) {
      console.error('Join queue error:', error);
      return { success: false, message: 'Failed to join matchmaking queue' };
    }
  }

  /**
   * Remove player from matchmaking queue
   */
  leaveQueue(playerId: string): boolean {
    return this.matchmakingQueue.delete(playerId);
  }

  /**
   * Get current queue status for a player
   */
  getQueueStatus(playerId: string): QueueStatus | null {
    const request = this.matchmakingQueue.get(playerId);
    if (!request) {
      return null;
    }

    const queueArray = Array.from(this.matchmakingQueue.values());
    const position = queueArray.findIndex(req => req.playerId === playerId) + 1;
    const averageElo = queueArray.reduce((sum, req) => sum, 0) / queueArray.length;
    
    // Estimate wait time based on queue position and historical data
    const estimatedWaitTime = Math.max(5, position * 3); // Rough estimate

    return {
      position,
      estimatedWaitTime,
      playersInQueue: this.matchmakingQueue.size,
      averageElo: Math.round(averageElo)
    };
  }

  /**
   * Start the matchmaking loop
   */
  private startMatchmakingLoop(): void {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
    }

    this.matchmakingInterval = setInterval(async () => {
      await this.processMatchmaking();
    }, this.MATCHMAKING_INTERVAL);
  }

  /**
   * Stop the matchmaking loop
   */
  stopMatchmakingLoop(): void {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
      this.matchmakingInterval = null;
    }
  }

  /**
   * Main matchmaking processing logic
   */
  private async processMatchmaking(): Promise<void> {
    try {
      // Remove expired requests
      this.removeExpiredRequests();

      if (this.matchmakingQueue.size < this.MIN_PLAYERS_PER_GAME) {
        return;
      }

      // Get all players with their ELO ratings
      const playerIds = Array.from(this.matchmakingQueue.keys());
      const players = await Player.find({ 
        _id: { $in: playerIds } 
      }).select('_id username statistics').lean();

      if (players.length < this.MIN_PLAYERS_PER_GAME) {
        return;
      }

      // Create player data map for efficient lookup
      const playerDataMap = new Map(
        players.map(p => [p._id.toString(), p])
      );

      // Find potential matches
      const matches = this.findMatches(playerDataMap);

      // Create rooms for successful matches
      for (const match of matches) {
        await this.createMatchRoom(match);
      }
    } catch (error) {
      console.error('Matchmaking processing error:', error);
    }
  }

  /**
   * Remove expired matchmaking requests
   */
  private removeExpiredRequests(): void {
    const now = new Date();
    const expiredPlayers: string[] = [];

    for (const [playerId, request] of this.matchmakingQueue.entries()) {
      const waitTime = (now.getTime() - request.timestamp.getTime()) / 1000;
      if (waitTime > request.preferences.maxWaitTime) {
        expiredPlayers.push(playerId);
      }
    }

    expiredPlayers.forEach(playerId => {
      this.matchmakingQueue.delete(playerId);
    });
  }

  /**
   * Find potential matches using ELO-based algorithm
   */
  private findMatches(playerDataMap: Map<string, any>): string[][] {
    const matches: string[][] = [];
    const availablePlayers = Array.from(this.matchmakingQueue.keys());
    const usedPlayers = new Set<string>();

    // Sort players by wait time (longest waiting first)
    availablePlayers.sort((a, b) => {
      const requestA = this.matchmakingQueue.get(a)!;
      const requestB = this.matchmakingQueue.get(b)!;
      return requestA.timestamp.getTime() - requestB.timestamp.getTime();
    });

    for (const playerId of availablePlayers) {
      if (usedPlayers.has(playerId)) continue;

      const playerData = playerDataMap.get(playerId);
      if (!playerData) continue;

      const request = this.matchmakingQueue.get(playerId)!;
      const potentialMatch = this.findBestMatch(
        playerId, 
        playerData, 
        request, 
        availablePlayers.filter(id => !usedPlayers.has(id)),
        playerDataMap
      );

      if (potentialMatch.length >= this.MIN_PLAYERS_PER_GAME) {
        matches.push(potentialMatch);
        potentialMatch.forEach(id => usedPlayers.add(id));
      }
    }

    return matches;
  }

  /**
   * Find the best match for a player using ELO and region-based scoring
   */
  private findBestMatch(
    targetPlayerId: string,
    targetPlayerData: any,
    targetRequest: MatchmakingRequest,
    availablePlayers: string[],
    playerDataMap: Map<string, any>
  ): string[] {
    const targetElo = targetPlayerData.statistics.eloRating;
    const waitTime = (Date.now() - targetRequest.timestamp.getTime()) / 1000;
    
    // Expand skill range based on wait time
    const expandedSkillRange = targetRequest.preferences.skillRange + 
      Math.floor(waitTime / 10) * this.SKILL_RANGE_EXPANSION_RATE;

    // Score all available players
    const scoredPlayers = availablePlayers
      .filter(playerId => playerId !== targetPlayerId)
      .map(playerId => {
        const playerData = playerDataMap.get(playerId);
        const request = this.matchmakingQueue.get(playerId);
        
        if (!playerData || !request) return null;

        const score = this.calculateMatchScore(
          targetElo,
          targetRequest,
          playerData.statistics.eloRating,
          request,
          expandedSkillRange
        );

        return { playerId, score, playerData, request };
      })
      .filter(item => item !== null && item.score > 0)
      .sort((a, b) => b!.score - a!.score);

    // Select best matches up to max players
    const selectedPlayers = [targetPlayerId];
    const maxAdditionalPlayers = this.MAX_PLAYERS_PER_GAME - 1;

    for (let i = 0; i < Math.min(scoredPlayers.length, maxAdditionalPlayers); i++) {
      selectedPlayers.push(scoredPlayers[i]!.playerId);
    }

    return selectedPlayers;
  }

  /**
   * Calculate match score between two players
   */
  private calculateMatchScore(
    targetElo: number,
    targetRequest: MatchmakingRequest,
    candidateElo: number,
    candidateRequest: MatchmakingRequest,
    skillRange: number
  ): number {
    // Base score starts at 100
    let score = 100;

    // ELO difference penalty
    const eloDifference = Math.abs(targetElo - candidateElo);
    if (eloDifference > skillRange) {
      return 0; // Outside acceptable skill range
    }
    
    // Closer ELO = higher score
    const eloScore = Math.max(0, 100 - (eloDifference / skillRange) * 50);
    score += eloScore;

    // Region matching bonus
    if (targetRequest.connectionInfo.region === candidateRequest.connectionInfo.region) {
      score += this.REGION_BONUS;
    }

    // Connection quality bonus
    const connectionQualityScore = this.getConnectionQualityScore(
      targetRequest.connectionInfo.connectionQuality,
      candidateRequest.connectionInfo.connectionQuality
    );
    score += connectionQualityScore;

    // Wait time bonus (prioritize players who have been waiting longer)
    const targetWaitTime = (Date.now() - targetRequest.timestamp.getTime()) / 1000;
    const candidateWaitTime = (Date.now() - candidateRequest.timestamp.getTime()) / 1000;
    const avgWaitTime = (targetWaitTime + candidateWaitTime) / 2;
    const waitTimeBonus = Math.min(50, avgWaitTime * 2); // Max 50 points for wait time
    score += waitTimeBonus;

    return Math.round(score);
  }

  /**
   * Get connection quality score for matching
   */
  private getConnectionQualityScore(quality1: string, quality2: string): number {
    const qualityScores = {
      'excellent': 40,
      'good': 30,
      'fair': 20,
      'poor': 10
    };

    const score1 = qualityScores[quality1 as keyof typeof qualityScores] || 0;
    const score2 = qualityScores[quality2 as keyof typeof qualityScores] || 0;
    
    return (score1 + score2) / 2;
  }

  /**
   * Create a room for matched players
   */
  private async createMatchRoom(playerIds: string[]): Promise<void> {
    try {
      // Remove players from queue
      playerIds.forEach(playerId => {
        this.matchmakingQueue.delete(playerId);
      });

      // Get host (first player in the match)
      const hostId = playerIds[0];

      // Create room options
      const roomOptions: CreateRoomOptions = {
        hostId,
        settings: {
          isPublic: false,
          maxPlayers: playerIds.length,
          gameSettings: {
            maxPlayers: playerIds.length,
            enableVoiceChat: true,
            dayPhaseDuration: 300, // 5 minutes
            nightPhaseDuration: 120, // 2 minutes
            votingDuration: 60, // 1 minute
            roles: this.generateRoleConfiguration(playerIds.length)
          },
          allowSpectators: false,
          requireInvite: false
        }
      };

      // Create the room
      const room = await this.roomService.createRoom(roomOptions);

      // Add all other players to the room
      for (let i = 1; i < playerIds.length; i++) {
        await this.roomService.joinRoom(room._id.toString(), playerIds[i]);
      }

      console.log(`Created matchmade room ${room.code} with players:`, playerIds);
    } catch (error) {
      console.error('Error creating match room:', error);
      // Re-add players to queue if room creation fails
      // This would need more sophisticated error handling in production
    }
  }

  /**
   * Generate role configuration based on player count
   */
  private generateRoleConfiguration(playerCount: number): any[] {
    // Simple role distribution logic
    const mafiaCount = Math.floor(playerCount / 3);
    const specialRoleCount = Math.min(2, Math.floor(playerCount / 4));
    const villagerCount = playerCount - mafiaCount - specialRoleCount;

    const roles = [];
    
    // Add mafia roles
    for (let i = 0; i < mafiaCount; i++) {
      roles.push({ role: 'mafia', count: 1 });
    }
    
    // Add special roles
    if (specialRoleCount >= 1) {
      roles.push({ role: 'detective', count: 1 });
    }
    if (specialRoleCount >= 2) {
      roles.push({ role: 'doctor', count: 1 });
    }
    
    // Add villagers
    if (villagerCount > 0) {
      roles.push({ role: 'villager', count: villagerCount });
    }

    return roles;
  }

  /**
   * Get matchmaking statistics
   */
  getMatchmakingStats(): {
    playersInQueue: number;
    averageWaitTime: number;
    regionDistribution: Record<string, number>;
    eloDistribution: { min: number; max: number; average: number };
  } {
    const requests = Array.from(this.matchmakingQueue.values());
    const now = Date.now();

    if (requests.length === 0) {
      return {
        playersInQueue: 0,
        averageWaitTime: 0,
        regionDistribution: {},
        eloDistribution: { min: 0, max: 0, average: 0 }
      };
    }

    // Calculate average wait time
    const totalWaitTime = requests.reduce((sum, req) => {
      return sum + (now - req.timestamp.getTime()) / 1000;
    }, 0);
    const averageWaitTime = totalWaitTime / requests.length;

    // Calculate region distribution
    const regionDistribution: Record<string, number> = {};
    requests.forEach(req => {
      const region = req.connectionInfo.region;
      regionDistribution[region] = (regionDistribution[region] || 0) + 1;
    });

    return {
      playersInQueue: requests.length,
      averageWaitTime: Math.round(averageWaitTime),
      regionDistribution,
      eloDistribution: { min: 0, max: 0, average: 0 } // Would need player data to calculate
    };
  }

  /**
   * Cleanup method for graceful shutdown
   */
  cleanup(): void {
    this.stopMatchmakingLoop();
    this.matchmakingQueue.clear();
  }
}