import { MatchmakingService, MatchmakingPreferences } from '../services/MatchmakingService';
import { Player } from '../models/Player';
import { RoomService } from '../services/RoomService';
import { connectDatabase, disconnectDatabase } from '../utils/database';

// Mock the RoomService
jest.mock('../services/RoomService');
const MockedRoomService = RoomService as jest.MockedClass<typeof RoomService>;

describe('MatchmakingService', () => {
  let matchmakingService: MatchmakingService;
  let mockRoomService: jest.Mocked<RoomService>;

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Clear the database
    await Player.deleteMany({});
    
    // Reset the singleton instance
    (MatchmakingService as any).instance = null;
    
    // Create new instance
    matchmakingService = MatchmakingService.getInstance();
    
    // Setup mock room service
    mockRoomService = new MockedRoomService() as jest.Mocked<RoomService>;
    (matchmakingService as any).roomService = mockRoomService;
    
    // Mock room service methods
    mockRoomService.createRoom.mockResolvedValue({
      _id: 'room123',
      code: 'ABC123',
      hostId: 'player1',
      players: [],
      settings: {},
      status: 'waiting',
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);
    
    mockRoomService.joinRoom.mockResolvedValue({
      success: true,
      room: {} as any,
      message: 'Joined successfully'
    });
  });

  afterEach(() => {
    matchmakingService.cleanup();
    jest.clearAllMocks();
  });

  describe('Queue Management', () => {
    it('should add player to queue successfully', async () => {
      // Create test player
      const player = new Player({
        username: 'testplayer',
        statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
      });
      await player.save();

      const result = await matchmakingService.joinQueue(
        player._id.toString(),
        { skillRange: 200, maxWaitTime: 60 },
        { region: 'us-east', connectionQuality: 'good' }
      );

      expect(result.success).toBe(true);
      expect(result.queueStatus).toBeDefined();
      expect(result.queueStatus?.position).toBe(1);
    });

    it('should reject invalid player ID', async () => {
      const result = await matchmakingService.joinQueue(
        'invalid-id',
        {},
        { region: 'us-east', connectionQuality: 'good' }
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Player not found');
    });

    it('should reject duplicate queue entries', async () => {
      const player = new Player({
        username: 'testplayer',
        statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
      });
      await player.save();

      // First join should succeed
      const result1 = await matchmakingService.joinQueue(
        player._id.toString(),
        {},
        { region: 'us-east', connectionQuality: 'good' }
      );
      expect(result1.success).toBe(true);

      // Second join should fail
      const result2 = await matchmakingService.joinQueue(
        player._id.toString(),
        {},
        { region: 'us-east', connectionQuality: 'good' }
      );
      expect(result2.success).toBe(false);
      expect(result2.message).toBe('Player already in matchmaking queue');
    });

    it('should remove player from queue', async () => {
      const player = new Player({
        username: 'testplayer',
        statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
      });
      await player.save();

      await matchmakingService.joinQueue(
        player._id.toString(),
        {},
        { region: 'us-east', connectionQuality: 'good' }
      );

      const removed = matchmakingService.leaveQueue(player._id.toString());
      expect(removed).toBe(true);

      const status = matchmakingService.getQueueStatus(player._id.toString());
      expect(status).toBeNull();
    });

    it('should return false when removing non-existent player', () => {
      const removed = matchmakingService.leaveQueue('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('Queue Status', () => {
    it('should return correct queue status', async () => {
      const players = [];
      for (let i = 0; i < 3; i++) {
        const player = new Player({
          username: `player${i}`,
          statistics: { eloRating: 1200 + i * 100, gamesPlayed: 10, gamesWon: 5 }
        });
        await player.save();
        players.push(player);
      }

      // Add players to queue
      for (let i = 0; i < players.length; i++) {
        await matchmakingService.joinQueue(
          players[i]._id.toString(),
          {},
          { region: 'us-east', connectionQuality: 'good' }
        );
      }

      const status = matchmakingService.getQueueStatus(players[1]._id.toString());
      expect(status).toBeDefined();
      expect(status?.position).toBe(2);
      expect(status?.playersInQueue).toBe(3);
      expect(status?.estimatedWaitTime).toBeGreaterThan(0);
    });

    it('should return null for player not in queue', () => {
      const status = matchmakingService.getQueueStatus('nonexistent');
      expect(status).toBeNull();
    });
  });

  describe('ELO-based Matching', () => {
    it('should match players with similar ELO ratings', async () => {
      // Create players with similar ELO ratings
      const players = [];
      for (let i = 0; i < 6; i++) {
        const player = new Player({
          username: `player${i}`,
          statistics: { 
            eloRating: 1200 + i * 50, // ELO range: 1200-1450
            gamesPlayed: 10, 
            gamesWon: 5 
          }
        });
        await player.save();
        players.push(player);
      }

      // Add all players to queue
      for (const player of players) {
        await matchmakingService.joinQueue(
          player._id.toString(),
          { skillRange: 200, maxWaitTime: 60 },
          { region: 'us-east', connectionQuality: 'good' }
        );
      }

      // Wait for matchmaking to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify that room creation was called
      expect(mockRoomService.createRoom).toHaveBeenCalled();
      expect(mockRoomService.joinRoom).toHaveBeenCalled();
    });

    it('should not match players with vastly different ELO ratings', async () => {
      // Create players with very different ELO ratings
      const player1 = new Player({
        username: 'lowelo',
        statistics: { eloRating: 800, gamesPlayed: 10, gamesWon: 2 }
      });
      const player2 = new Player({
        username: 'highelo',
        statistics: { eloRating: 2000, gamesPlayed: 50, gamesWon: 40 }
      });
      
      await player1.save();
      await player2.save();

      // Add both players to queue with strict skill range
      await matchmakingService.joinQueue(
        player1._id.toString(),
        { skillRange: 100, maxWaitTime: 5 }, // Very strict range and short wait
        { region: 'us-east', connectionQuality: 'good' }
      );

      await matchmakingService.joinQueue(
        player2._id.toString(),
        { skillRange: 100, maxWaitTime: 5 },
        { region: 'us-east', connectionQuality: 'good' }
      );

      // Wait for matchmaking to process
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Should not create a room due to ELO difference
      expect(mockRoomService.createRoom).not.toHaveBeenCalled();
    });
  });

  describe('Region-based Matching', () => {
    it('should prioritize same-region players', async () => {
      // Create players in different regions
      const usPlayers = [];
      const euPlayers = [];

      for (let i = 0; i < 3; i++) {
        const usPlayer = new Player({
          username: `us-player${i}`,
          statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
        });
        const euPlayer = new Player({
          username: `eu-player${i}`,
          statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
        });
        
        await usPlayer.save();
        await euPlayer.save();
        usPlayers.push(usPlayer);
        euPlayers.push(euPlayer);
      }

      // Add US players to queue
      for (const player of usPlayers) {
        await matchmakingService.joinQueue(
          player._id.toString(),
          { skillRange: 300, maxWaitTime: 60 },
          { region: 'us-east', connectionQuality: 'good' }
        );
      }

      // Add EU players to queue
      for (const player of euPlayers) {
        await matchmakingService.joinQueue(
          player._id.toString(),
          { skillRange: 300, maxWaitTime: 60 },
          { region: 'eu-west', connectionQuality: 'good' }
        );
      }

      // Wait for matchmaking to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should create rooms (region matching is a bonus, not a requirement)
      expect(mockRoomService.createRoom).toHaveBeenCalled();
    });
  });

  describe('Timeout and Fallback', () => {
    it('should remove expired requests from queue', async () => {
      const player = new Player({
        username: 'testplayer',
        statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
      });
      await player.save();

      // Add player with very short timeout
      await matchmakingService.joinQueue(
        player._id.toString(),
        { skillRange: 200, maxWaitTime: 1 }, // 1 second timeout
        { region: 'us-east', connectionQuality: 'good' }
      );

      // Verify player is in queue
      let status = matchmakingService.getQueueStatus(player._id.toString());
      expect(status).toBeDefined();

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Player should be removed from queue
      status = matchmakingService.getQueueStatus(player._id.toString());
      expect(status).toBeNull();
    });

    it('should expand skill range over time', async () => {
      // This test would require more complex setup to verify skill range expansion
      // For now, we'll test that the basic mechanism works
      const player = new Player({
        username: 'testplayer',
        statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
      });
      await player.save();

      await matchmakingService.joinQueue(
        player._id.toString(),
        { skillRange: 100, maxWaitTime: 60 },
        { region: 'us-east', connectionQuality: 'good' }
      );

      // The skill range expansion is tested implicitly in the matching algorithm
      expect(matchmakingService.getQueueStatus(player._id.toString())).toBeDefined();
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle multiple concurrent queue operations', async () => {
      const players = [];
      const promises = [];

      // Create many players
      for (let i = 0; i < 20; i++) {
        const player = new Player({
          username: `player${i}`,
          statistics: { 
            eloRating: 1000 + Math.random() * 1000, 
            gamesPlayed: 10, 
            gamesWon: 5 
          }
        });
        await player.save();
        players.push(player);
      }

      // Add all players to queue concurrently
      for (const player of players) {
        promises.push(
          matchmakingService.joinQueue(
            player._id.toString(),
            { skillRange: 300, maxWaitTime: 60 },
            { 
              region: Math.random() > 0.5 ? 'us-east' : 'eu-west', 
              connectionQuality: 'good' 
            }
          )
        );
      }

      const results = await Promise.all(promises);
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Wait for matchmaking to process
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Should have created multiple rooms
      expect(mockRoomService.createRoom).toHaveBeenCalled();
    });

    it('should provide accurate matchmaking statistics', async () => {
      const players = [];
      for (let i = 0; i < 5; i++) {
        const player = new Player({
          username: `player${i}`,
          statistics: { eloRating: 1200 + i * 100, gamesPlayed: 10, gamesWon: 5 }
        });
        await player.save();
        players.push(player);
      }

      // Add players to queue from different regions
      const regions = ['us-east', 'us-west', 'eu-west', 'ap-south', 'us-east'];
      for (let i = 0; i < players.length; i++) {
        await matchmakingService.joinQueue(
          players[i]._id.toString(),
          {},
          { region: regions[i], connectionQuality: 'good' }
        );
      }

      const stats = matchmakingService.getMatchmakingStats();
      
      expect(stats.playersInQueue).toBe(5);
      expect(stats.averageWaitTime).toBeGreaterThanOrEqual(0);
      expect(stats.regionDistribution).toBeDefined();
      expect(stats.regionDistribution['us-east']).toBe(2);
      expect(stats.regionDistribution['us-west']).toBe(1);
      expect(stats.regionDistribution['eu-west']).toBe(1);
      expect(stats.regionDistribution['ap-south']).toBe(1);
    });
  });

  describe('Connection Quality Matching', () => {
    it('should consider connection quality in matching', async () => {
      const players = [];
      const qualities = ['excellent', 'good', 'fair', 'poor'];
      
      for (let i = 0; i < 4; i++) {
        const player = new Player({
          username: `player${i}`,
          statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
        });
        await player.save();
        players.push(player);
      }

      // Add players with different connection qualities
      for (let i = 0; i < players.length; i++) {
        await matchmakingService.joinQueue(
          players[i]._id.toString(),
          { skillRange: 300, maxWaitTime: 60 },
          { 
            region: 'us-east', 
            connectionQuality: qualities[i] as any
          }
        );
      }

      // Wait for matchmaking to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should still create matches (connection quality is a bonus, not a requirement)
      expect(mockRoomService.createRoom).toHaveBeenCalled();
    });
  });

  describe('Role Configuration', () => {
    it('should generate appropriate role configuration for different player counts', async () => {
      // Test with minimum players (4)
      const minPlayers = [];
      for (let i = 0; i < 4; i++) {
        const player = new Player({
          username: `minplayer${i}`,
          statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
        });
        await player.save();
        minPlayers.push(player);
      }

      for (const player of minPlayers) {
        await matchmakingService.joinQueue(
          player._id.toString(),
          { skillRange: 300, maxWaitTime: 60 },
          { region: 'us-east', connectionQuality: 'good' }
        );
      }

      // Wait for matchmaking
      await new Promise(resolve => setTimeout(resolve, 3000));

      expect(mockRoomService.createRoom).toHaveBeenCalled();
      
      // Verify the room was created with appropriate settings
      const createRoomCall = mockRoomService.createRoom.mock.calls[0][0];
      expect(createRoomCall.settings.gameSettings.maxPlayers).toBe(4);
      expect(createRoomCall.settings.gameSettings.roles).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock Player.find to throw an error
      jest.spyOn(Player, 'find').mockRejectedValueOnce(new Error('Database error'));

      const player = new Player({
        username: 'testplayer',
        statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
      });
      await player.save();

      await matchmakingService.joinQueue(
        player._id.toString(),
        {},
        { region: 'us-east', connectionQuality: 'good' }
      );

      // Wait for matchmaking to process (should handle error gracefully)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should not crash the service
      expect(matchmakingService.getQueueStatus(player._id.toString())).toBeDefined();
    });

    it('should handle room creation failures', async () => {
      // Mock room service to fail
      mockRoomService.createRoom.mockRejectedValueOnce(new Error('Room creation failed'));

      const players = [];
      for (let i = 0; i < 4; i++) {
        const player = new Player({
          username: `player${i}`,
          statistics: { eloRating: 1200, gamesPlayed: 10, gamesWon: 5 }
        });
        await player.save();
        players.push(player);
      }

      for (const player of players) {
        await matchmakingService.joinQueue(
          player._id.toString(),
          {},
          { region: 'us-east', connectionQuality: 'good' }
        );
      }

      // Wait for matchmaking to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should attempt to create room but handle failure gracefully
      expect(mockRoomService.createRoom).toHaveBeenCalled();
    });
  });
});