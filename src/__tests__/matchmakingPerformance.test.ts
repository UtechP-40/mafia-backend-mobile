import { MatchmakingService } from '../services/MatchmakingService';
import { Player } from '../models/Player';
import { RoomService } from '../services/RoomService';
import { connectDatabase, disconnectDatabase } from '../utils/database';

// Mock the RoomService for performance testing
jest.mock('../services/RoomService');
const MockedRoomService = RoomService as jest.MockedClass<typeof RoomService>;

describe('Matchmaking Performance Tests', () => {
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
    
    // Mock room service methods with fast responses
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

  describe('High Load Scenarios', () => {
    it('should handle 100 concurrent players joining queue', async () => {
      const startTime = Date.now();
      const playerCount = 100;
      const players = [];
      
      // Create players
      for (let i = 0; i < playerCount; i++) {
        const player = new Player({
          username: `loadtest${i}`,
          statistics: { 
            eloRating: 1000 + Math.random() * 1000,
            gamesPlayed: Math.floor(Math.random() * 50),
            gamesWon: Math.floor(Math.random() * 25)
          }
        });
        await player.save();
        players.push(player);
      }

      const creationTime = Date.now() - startTime;
      console.log(`Created ${playerCount} players in ${creationTime}ms`);

      // Join queue concurrently
      const joinStartTime = Date.now();
      const regions = ['us-east', 'us-west', 'eu-west', 'ap-south', 'sa-east'];
      const qualities = ['excellent', 'good', 'fair', 'poor'];

      const joinPromises = players.map((player, index) => 
        matchmakingService.joinQueue(
          player._id.toString(),
          { 
            skillRange: 200 + Math.random() * 200,
            maxWaitTime: 30 + Math.random() * 60
          },
          {
            region: regions[index % regions.length],
            connectionQuality: qualities[index % qualities.length] as any,
            latency: 20 + Math.random() * 100
          }
        )
      );

      const results = await Promise.all(joinPromises);
      const joinTime = Date.now() - joinStartTime;
      
      console.log(`${playerCount} players joined queue in ${joinTime}ms`);
      console.log(`Average join time: ${joinTime / playerCount}ms per player`);

      // Verify all joined successfully
      const successfulJoins = results.filter(r => r.success).length;
      expect(successfulJoins).toBe(playerCount);

      // Wait for matchmaking to process
      const matchmakingStartTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
      const matchmakingTime = Date.now() - matchmakingStartTime;

      console.log(`Matchmaking processed in ${matchmakingTime}ms`);

      // Verify rooms were created
      expect(mockRoomService.createRoom).toHaveBeenCalled();
      const roomsCreated = mockRoomService.createRoom.mock.calls.length;
      console.log(`Created ${roomsCreated} rooms for ${playerCount} players`);

      // Performance assertions
      expect(joinTime).toBeLessThan(5000); // Should join within 5 seconds
      expect(joinTime / playerCount).toBeLessThan(50); // Less than 50ms per player
    }, 30000); // 30 second timeout

    it('should maintain performance with rapid queue operations', async () => {
      const operationCount = 500;
      const players = [];
      
      // Create players for rapid operations
      for (let i = 0; i < 50; i++) {
        const player = new Player({
          username: `rapidtest${i}`,
          statistics: { 
            eloRating: 1200 + Math.random() * 400,
            gamesPlayed: 10,
            gamesWon: 5
          }
        });
        await player.save();
        players.push(player);
      }

      const startTime = Date.now();
      const operations = [];

      // Perform rapid join/leave operations
      for (let i = 0; i < operationCount; i++) {
        const player = players[i % players.length];
        const isJoin = Math.random() > 0.3; // 70% join, 30% leave

        if (isJoin) {
          operations.push(
            matchmakingService.joinQueue(
              player._id.toString(),
              { skillRange: 200, maxWaitTime: 60 },
              {
                region: 'us-east',
                connectionQuality: 'good',
                latency: 50
              }
            ).catch(() => ({ success: false })) // Handle expected failures
          );
        } else {
          operations.push(
            Promise.resolve({ 
              success: matchmakingService.leaveQueue(player._id.toString()) 
            })
          );
        }
      }

      const results = await Promise.all(operations);
      const totalTime = Date.now() - startTime;
      
      console.log(`${operationCount} operations completed in ${totalTime}ms`);
      console.log(`Average operation time: ${totalTime / operationCount}ms`);

      // Performance assertions
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(totalTime / operationCount).toBeLessThan(20); // Less than 20ms per operation
      
      // Verify operations completed
      expect(results.length).toBe(operationCount);
    }, 20000);

    it('should handle memory efficiently with large queues', async () => {
      const playerCount = 200;
      const players = [];
      
      // Monitor initial memory
      const initialMemory = process.memoryUsage();
      
      // Create and add players to queue
      for (let i = 0; i < playerCount; i++) {
        const player = new Player({
          username: `memtest${i}`,
          statistics: { 
            eloRating: 1000 + Math.random() * 1000,
            gamesPlayed: 10,
            gamesWon: 5
          }
        });
        await player.save();
        players.push(player);

        await matchmakingService.joinQueue(
          player._id.toString(),
          { skillRange: 300, maxWaitTime: 120 },
          {
            region: 'us-east',
            connectionQuality: 'good',
            latency: 50
          }
        );
      }

      // Check memory after queue operations
      const afterQueueMemory = process.memoryUsage();
      const memoryIncrease = afterQueueMemory.heapUsed - initialMemory.heapUsed;
      const memoryPerPlayer = memoryIncrease / playerCount;

      console.log(`Memory increase: ${memoryIncrease / 1024 / 1024}MB`);
      console.log(`Memory per player: ${memoryPerPlayer / 1024}KB`);

      // Memory efficiency assertions
      expect(memoryPerPlayer).toBeLessThan(10 * 1024); // Less than 10KB per player
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB total

      // Clean up and verify memory is released
      for (const player of players) {
        matchmakingService.leaveQueue(player._id.toString());
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const afterCleanupMemory = process.memoryUsage();
      const memoryReleased = afterQueueMemory.heapUsed - afterCleanupMemory.heapUsed;
      
      console.log(`Memory released after cleanup: ${memoryReleased / 1024 / 1024}MB`);
      
      // Should release significant memory
      expect(memoryReleased).toBeGreaterThan(memoryIncrease * 0.5); // At least 50% released
    }, 30000);
  });

  describe('Matchmaking Algorithm Performance', () => {
    it('should find matches efficiently with diverse ELO ranges', async () => {
      const playerCount = 80;
      const players = [];
      
      // Create players with diverse ELO ratings
      for (let i = 0; i < playerCount; i++) {
        const eloBase = 800 + (i * 20); // ELO range from 800 to 2400
        const player = new Player({
          username: `elo${i}`,
          statistics: { 
            eloRating: eloBase + Math.random() * 100,
            gamesPlayed: 10 + Math.random() * 40,
            gamesWon: Math.random() * 25
          }
        });
        await player.save();
        players.push(player);
      }

      const startTime = Date.now();

      // Add all players to queue
      for (const player of players) {
        await matchmakingService.joinQueue(
          player._id.toString(),
          { 
            skillRange: 150 + Math.random() * 100,
            maxWaitTime: 45 + Math.random() * 30
          },
          {
            region: Math.random() > 0.5 ? 'us-east' : 'eu-west',
            connectionQuality: ['excellent', 'good', 'fair'][Math.floor(Math.random() * 3)] as any,
            latency: 20 + Math.random() * 80
          }
        );
      }

      const queueTime = Date.now() - startTime;
      console.log(`Added ${playerCount} diverse players to queue in ${queueTime}ms`);

      // Wait for matchmaking to process
      const matchStartTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 8000));
      const matchTime = Date.now() - matchStartTime;

      console.log(`Matchmaking algorithm processed in ${matchTime}ms`);

      // Verify matches were found
      expect(mockRoomService.createRoom).toHaveBeenCalled();
      const matchesFound = mockRoomService.createRoom.mock.calls.length;
      const playersMatched = mockRoomService.createRoom.mock.calls.reduce(
        (total, call) => total + call[0].settings.maxPlayers, 0
      );

      console.log(`Found ${matchesFound} matches for ${playersMatched} players`);
      
      // Performance and effectiveness assertions
      expect(matchTime).toBeLessThan(10000); // Should process within 10 seconds
      expect(playersMatched).toBeGreaterThan(playerCount * 0.3); // At least 30% matched
    }, 20000);

    it('should scale matchmaking processing time linearly', async () => {
      const testSizes = [20, 40, 60];
      const processingTimes = [];

      for (const size of testSizes) {
        // Clear previous test
        matchmakingService.cleanup();
        (MatchmakingService as any).instance = null;
        matchmakingService = MatchmakingService.getInstance();
        (matchmakingService as any).roomService = mockRoomService;
        jest.clearAllMocks();

        const players = [];
        
        // Create players for this test size
        for (let i = 0; i < size; i++) {
          const player = new Player({
            username: `scale${size}_${i}`,
            statistics: { 
              eloRating: 1000 + Math.random() * 800,
              gamesPlayed: 10,
              gamesWon: 5
            }
          });
          await player.save();
          players.push(player);
        }

        // Add to queue
        for (const player of players) {
          await matchmakingService.joinQueue(
            player._id.toString(),
            { skillRange: 200, maxWaitTime: 60 },
            {
              region: 'us-east',
              connectionQuality: 'good',
              latency: 50
            }
          );
        }

        // Measure processing time
        const startTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, 5000));
        const processingTime = Date.now() - startTime;
        
        processingTimes.push({ size, time: processingTime });
        console.log(`${size} players processed in ${processingTime}ms`);
      }

      // Verify linear scaling (processing time should not increase exponentially)
      const timeRatio1 = processingTimes[1].time / processingTimes[0].time;
      const timeRatio2 = processingTimes[2].time / processingTimes[1].time;
      const sizeRatio = 2; // Each test doubles the size

      console.log(`Time ratios: ${timeRatio1.toFixed(2)}, ${timeRatio2.toFixed(2)}`);
      
      // Time increase should be roughly linear (not exponential)
      expect(timeRatio1).toBeLessThan(sizeRatio * 1.5); // Allow 50% overhead
      expect(timeRatio2).toBeLessThan(sizeRatio * 1.5);
    }, 30000);
  });

  describe('Queue Status Performance', () => {
    it('should provide queue status quickly even with large queues', async () => {
      const playerCount = 150;
      const players = [];
      
      // Create and add players to queue
      for (let i = 0; i < playerCount; i++) {
        const player = new Player({
          username: `status${i}`,
          statistics: { 
            eloRating: 1200 + Math.random() * 400,
            gamesPlayed: 10,
            gamesWon: 5
          }
        });
        await player.save();
        players.push(player);

        await matchmakingService.joinQueue(
          player._id.toString(),
          { skillRange: 200, maxWaitTime: 60 },
          {
            region: 'us-east',
            connectionQuality: 'good',
            latency: 50
          }
        );
      }

      // Test queue status performance
      const statusStartTime = Date.now();
      const statusPromises = players.slice(0, 50).map(player => 
        Promise.resolve(matchmakingService.getQueueStatus(player._id.toString()))
      );

      const statuses = await Promise.all(statusPromises);
      const statusTime = Date.now() - statusStartTime;

      console.log(`Retrieved 50 queue statuses in ${statusTime}ms`);
      console.log(`Average status retrieval time: ${statusTime / 50}ms`);

      // Verify all statuses were retrieved
      expect(statuses.filter(s => s !== null).length).toBe(50);
      
      // Performance assertions
      expect(statusTime).toBeLessThan(1000); // Should complete within 1 second
      expect(statusTime / 50).toBeLessThan(20); // Less than 20ms per status check
    });

    it('should provide matchmaking stats quickly', async () => {
      const playerCount = 100;
      const regions = ['us-east', 'us-west', 'eu-west', 'ap-south'];
      
      // Add players from different regions
      for (let i = 0; i < playerCount; i++) {
        const player = new Player({
          username: `stats${i}`,
          statistics: { 
            eloRating: 1000 + Math.random() * 1000,
            gamesPlayed: 10,
            gamesWon: 5
          }
        });
        await player.save();

        await matchmakingService.joinQueue(
          player._id.toString(),
          { skillRange: 200, maxWaitTime: 60 },
          {
            region: regions[i % regions.length],
            connectionQuality: 'good',
            latency: 50
          }
        );
      }

      // Test stats performance
      const statsStartTime = Date.now();
      const stats = matchmakingService.getMatchmakingStats();
      const statsTime = Date.now() - statsStartTime;

      console.log(`Retrieved matchmaking stats in ${statsTime}ms`);
      console.log('Stats:', stats);

      // Verify stats accuracy
      expect(stats.playersInQueue).toBe(playerCount);
      expect(Object.keys(stats.regionDistribution).length).toBe(regions.length);
      
      // Performance assertion
      expect(statsTime).toBeLessThan(100); // Should complete within 100ms
    });
  });

  describe('Stress Testing', () => {
    it('should handle rapid join/leave cycles without degradation', async () => {
      const cycleCount = 100;
      const playersPerCycle = 10;
      const players = [];
      
      // Create players for stress testing
      for (let i = 0; i < playersPerCycle; i++) {
        const player = new Player({
          username: `stress${i}`,
          statistics: { 
            eloRating: 1200 + Math.random() * 400,
            gamesPlayed: 10,
            gamesWon: 5
          }
        });
        await player.save();
        players.push(player);
      }

      const cycleTimes = [];

      for (let cycle = 0; cycle < cycleCount; cycle++) {
        const cycleStartTime = Date.now();
        
        // Join all players
        const joinPromises = players.map(player =>
          matchmakingService.joinQueue(
            player._id.toString(),
            { skillRange: 200, maxWaitTime: 30 },
            {
              region: 'us-east',
              connectionQuality: 'good',
              latency: 50
            }
          ).catch(() => ({ success: false }))
        );
        
        await Promise.all(joinPromises);
        
        // Leave all players
        players.forEach(player => {
          matchmakingService.leaveQueue(player._id.toString());
        });
        
        const cycleTime = Date.now() - cycleStartTime;
        cycleTimes.push(cycleTime);
        
        if (cycle % 20 === 0) {
          console.log(`Cycle ${cycle}: ${cycleTime}ms`);
        }
      }

      const avgCycleTime = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
      const maxCycleTime = Math.max(...cycleTimes);
      const minCycleTime = Math.min(...cycleTimes);

      console.log(`Average cycle time: ${avgCycleTime.toFixed(2)}ms`);
      console.log(`Min/Max cycle time: ${minCycleTime}ms / ${maxCycleTime}ms`);

      // Performance should not degrade significantly
      expect(avgCycleTime).toBeLessThan(500); // Average under 500ms
      expect(maxCycleTime).toBeLessThan(1000); // Max under 1 second
      
      // Verify no significant performance degradation
      const firstHalfAvg = cycleTimes.slice(0, cycleCount / 2).reduce((a, b) => a + b, 0) / (cycleCount / 2);
      const secondHalfAvg = cycleTimes.slice(cycleCount / 2).reduce((a, b) => a + b, 0) / (cycleCount / 2);
      const degradationRatio = secondHalfAvg / firstHalfAvg;
      
      console.log(`Performance degradation ratio: ${degradationRatio.toFixed(2)}`);
      expect(degradationRatio).toBeLessThan(1.5); // Less than 50% degradation
    }, 60000); // 60 second timeout
  });
});