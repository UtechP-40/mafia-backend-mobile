import mongoose from 'mongoose';
import { DatabaseUtils, PlayerOperations, GameOperations, RoomOperations, ChatOperations } from './database';
import { Player, Game, Room, ChatMessage, GameRole, RoomStatus, GamePhase, MessageType } from '../models';

// Mock logger to avoid console output during tests
jest.mock('./logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Database Models and Utilities', () => {
  beforeAll(async () => {
    // Connect to test database
    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/mafia-game-test';
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    // Clean up and disconnect
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Clear all collections before each test
    await Player.deleteMany({});
    await Game.deleteMany({});
    await Room.deleteMany({});
    await ChatMessage.deleteMany({});
  });

  describe('Player Model', () => {
    it('should create a player with valid data', async () => {
      const playerData = {
        username: 'testuser',
        email: 'test@example.com',
        avatar: 'avatar.png'
      };

      const player = await DatabaseUtils.create(Player, playerData);
      
      expect(player.username).toBe('testuser');
      expect(player.email).toBe('test@example.com');
      expect(player.statistics.gamesPlayed).toBe(0);
      expect(player.statistics.eloRating).toBe(1200);
    });

    it('should validate username format', async () => {
      const invalidPlayerData = {
        username: 'ab', // Too short
        email: 'test@example.com'
      };

      await expect(DatabaseUtils.create(Player, invalidPlayerData)).rejects.toThrow();
    });

    it('should calculate win rate correctly', async () => {
      const player = new Player({
        username: 'testuser',
        statistics: {
          gamesPlayed: 10,
          gamesWon: 7
        }
      });

      await player.save();
      expect(player.statistics.winRate).toBe(70);
    });
  });

  describe('Room Model', () => {
    it('should create a room with valid settings', async () => {
      const player = await DatabaseUtils.create(Player, { username: 'host' });
      
      const roomData = {
        code: 'ROOM01',
        hostId: player._id,
        settings: {
          isPublic: true,
          maxPlayers: 6,
          gameSettings: {
            maxPlayers: 6,
            enableVoiceChat: true,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: [
              { role: GameRole.MAFIA, count: 2 },
              { role: GameRole.VILLAGER, count: 4 }
            ]
          }
        }
      };

      const room = await DatabaseUtils.create(Room, roomData);
      
      expect(room.code).toBe('ROOM01');
      expect(room.hostId.toString()).toBe(player._id.toString());
      expect(room.settings.maxPlayers).toBe(6);
    });

    it('should validate role configuration matches max players', async () => {
      const player = await DatabaseUtils.create(Player, { username: 'host' });
      
      const roomData = {
        code: 'ROOM02',
        hostId: player._id,
        settings: {
          maxPlayers: 6,
          gameSettings: {
            maxPlayers: 6,
            roles: [
              { role: GameRole.MAFIA, count: 2 },
              { role: GameRole.VILLAGER, count: 3 } // Only 5 total, should be 6
            ]
          }
        }
      };

      await expect(DatabaseUtils.create(Room, roomData)).rejects.toThrow();
    });
  });

  describe('Game Model', () => {
    it('should create a game with valid data', async () => {
      const player = await DatabaseUtils.create(Player, { username: 'host' });
      const room = await DatabaseUtils.create(Room, {
        code: 'ROOM01',
        hostId: player._id,
        settings: { maxPlayers: 4 }
      });

      const gameData = {
        roomId: room._id,
        players: [player._id],
        settings: {
          maxPlayers: 4,
          dayPhaseDuration: 300000,
          nightPhaseDuration: 120000,
          votingDuration: 60000
        }
      };

      const game = await DatabaseUtils.create(Game, gameData);
      
      expect(game.roomId.toString()).toBe(room._id.toString());
      expect(game.phase).toBe(GamePhase.DAY);
      expect(game.dayNumber).toBe(1);
    });

    it('should handle voting correctly', async () => {
      const players = await Promise.all([
        DatabaseUtils.create(Player, { username: 'player1' }),
        DatabaseUtils.create(Player, { username: 'player2' })
      ]);

      const room = await DatabaseUtils.create(Room, {
        code: 'ROOM01',
        hostId: players[0]._id,
        settings: { maxPlayers: 4 }
      });

      const game = await DatabaseUtils.create(Game, {
        roomId: room._id,
        players: players.map(p => p._id),
        settings: { maxPlayers: 4 }
      });

      // Add a vote
      game.addVote(players[0]._id, players[1]._id);
      await game.save();

      expect(game.votes).toHaveLength(1);
      expect(game.votes[0].voterId.toString()).toBe(players[0]._id.toString());
      expect(game.votes[0].targetId.toString()).toBe(players[1]._id.toString());
    });
  });

  describe('ChatMessage Model', () => {
    it('should create a chat message', async () => {
      const player = await DatabaseUtils.create(Player, { username: 'chatter' });
      const room = await DatabaseUtils.create(Room, {
        code: 'ROOM01',
        hostId: player._id,
        settings: { maxPlayers: 4 }
      });

      const messageData = {
        roomId: room._id,
        playerId: player._id,
        content: 'Hello everyone!',
        type: MessageType.PLAYER_CHAT
      };

      const message = await DatabaseUtils.create(ChatMessage, messageData);
      
      expect(message.content).toBe('Hello everyone!');
      expect(message.type).toBe(MessageType.PLAYER_CHAT);
      expect(message.isModerated).toBe(false);
    });

    it('should moderate inappropriate content', async () => {
      const player = await DatabaseUtils.create(Player, { username: 'chatter' });
      const room = await DatabaseUtils.create(Room, {
        code: 'ROOM01',
        hostId: player._id,
        settings: { maxPlayers: 4 }
      });

      const messageData = {
        roomId: room._id,
        playerId: player._id,
        content: 'This is spam content',
        type: MessageType.PLAYER_CHAT
      };

      const message = await DatabaseUtils.create(ChatMessage, messageData);
      
      expect(message.isModerated).toBe(true);
      expect(message.content).toBe('[Message moderated]');
    });
  });

  describe('Database Utilities', () => {
    it('should perform CRUD operations', async () => {
      // Create
      const player = await DatabaseUtils.create(Player, { username: 'testuser' });
      expect(player.username).toBe('testuser');

      // Read
      const foundPlayer = await DatabaseUtils.findById(Player, player._id);
      expect(foundPlayer?.username).toBe('testuser');

      // Update
      const updatedPlayer = await DatabaseUtils.updateById(Player, player._id, {
        avatar: 'new-avatar.png'
      });
      expect(updatedPlayer?.avatar).toBe('new-avatar.png');

      // Delete
      const deletedPlayer = await DatabaseUtils.deleteById(Player, player._id);
      expect(deletedPlayer?.username).toBe('testuser');

      // Verify deletion
      const notFound = await DatabaseUtils.findById(Player, player._id);
      expect(notFound).toBeNull();
    });

    it('should perform aggregation queries', async () => {
      // Create test data
      await Promise.all([
        DatabaseUtils.create(Player, { username: 'user1', statistics: { eloRating: 1500 } }),
        DatabaseUtils.create(Player, { username: 'user2', statistics: { eloRating: 1300 } }),
        DatabaseUtils.create(Player, { username: 'user3', statistics: { eloRating: 1700 } })
      ]);

      const pipeline = [
        { $group: { _id: null, avgRating: { $avg: '$statistics.eloRating' } } }
      ];

      const result = await DatabaseUtils.aggregate(Player, pipeline);
      expect(result[0].avgRating).toBe(1500);
    });
  });

  describe('Specialized Operations', () => {
    it('should find players by username pattern', async () => {
      await Promise.all([
        DatabaseUtils.create(Player, { username: 'alice123' }),
        DatabaseUtils.create(Player, { username: 'bob456' }),
        DatabaseUtils.create(Player, { username: 'alice789' })
      ]);

      const results = await PlayerOperations.findByUsernamePattern('alice');
      expect(results).toHaveLength(2);
      expect(results.every(p => p.username.includes('alice'))).toBe(true);
    });

    it('should get player leaderboard', async () => {
      await Promise.all([
        DatabaseUtils.create(Player, { username: 'player1', statistics: { eloRating: 1600 } }),
        DatabaseUtils.create(Player, { username: 'player2', statistics: { eloRating: 1400 } }),
        DatabaseUtils.create(Player, { username: 'player3', statistics: { eloRating: 1800 } })
      ]);

      const leaderboard = await PlayerOperations.getLeaderboard(10);
      expect(leaderboard).toHaveLength(3);
      expect(leaderboard[0].statistics.eloRating).toBe(1800);
      expect(leaderboard[1].statistics.eloRating).toBe(1600);
      expect(leaderboard[2].statistics.eloRating).toBe(1400);
    });

    it('should find available public rooms', async () => {
      const host = await DatabaseUtils.create(Player, { username: 'host' });
      
      await Promise.all([
        DatabaseUtils.create(Room, {
          code: 'PUB001',
          hostId: host._id,
          settings: { isPublic: true, maxPlayers: 6 },
          status: RoomStatus.WAITING
        }),
        DatabaseUtils.create(Room, {
          code: 'PRI001',
          hostId: host._id,
          settings: { isPublic: false, maxPlayers: 6 },
          status: RoomStatus.WAITING
        }),
        DatabaseUtils.create(Room, {
          code: 'PUB002',
          hostId: host._id,
          settings: { isPublic: true, maxPlayers: 6 },
          status: RoomStatus.IN_PROGRESS
        })
      ]);

      const availableRooms = await RoomOperations.findAvailableRooms();
      expect(availableRooms).toHaveLength(1);
      expect(availableRooms[0].code).toBe('PUB001');
    });
  });
});