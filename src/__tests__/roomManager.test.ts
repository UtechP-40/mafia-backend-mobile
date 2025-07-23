import { RoomManager } from '../game/roomManager';
import { Room, RoomStatus } from '../models/Room';
import { Player } from '../models/Player';
import { connectDB, disconnectDB, clearDB } from './setup';

describe('RoomManager', () => {
  let roomManager: RoomManager;
  let testPlayer1: any;
  let testPlayer2: any;
  let testPlayer3: any;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDB();
    roomManager = new RoomManager();

    // Create test players
    testPlayer1 = await Player.create({
      username: 'testhost',
      email: 'host@test.com',
      password: 'hashedpassword',
      avatar: 'avatar1.png'
    });

    testPlayer2 = await Player.create({
      username: 'testplayer2',
      email: 'player2@test.com',
      password: 'hashedpassword',
      avatar: 'avatar2.png'
    });

    testPlayer3 = await Player.create({
      username: 'testplayer3',
      email: 'player3@test.com',
      password: 'hashedpassword',
      avatar: 'avatar3.png'
    });
  });

  afterEach(async () => {
    await clearDB();
  });

  describe('createRoom', () => {
    it('should create a room with default settings', async () => {
      const room = await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: {}
      });

      expect(room).toBeDefined();
      expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(room.hostId._id.toString()).toBe(testPlayer1._id.toString());
      expect(room.players).toHaveLength(1);
      expect(room.players[0]._id.toString()).toBe(testPlayer1._id.toString());
      expect(room.status).toBe(RoomStatus.WAITING);
      expect(room.settings.isPublic).toBe(true);
      expect(room.settings.maxPlayers).toBe(8);
    });

    it('should create a room with custom settings', async () => {
      const customSettings = {
        isPublic: false,
        maxPlayers: 12,
        gameSettings: {
          maxPlayers: 12,
          enableVoiceChat: false,
          dayPhaseDuration: 600000,
          nightPhaseDuration: 120000,
          votingDuration: 60000,
          roles: []
        },
        allowSpectators: true,
        requireInvite: true
      };

      const room = await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: customSettings
      });

      expect(room.settings.isPublic).toBe(false);
      expect(room.settings.maxPlayers).toBe(12);
      expect(room.settings.gameSettings.enableVoiceChat).toBe(false);
      expect(room.settings.gameSettings.dayPhaseDuration).toBe(600000);
      expect(room.settings.allowSpectators).toBe(true);
      expect(room.settings.requireInvite).toBe(true);
    });

    it('should throw error for non-existent host', async () => {
      await expect(roomManager.createRoom({
        hostId: '507f1f77bcf86cd799439011',
        settings: {}
      })).rejects.toThrow('Host player not found');
    });

    it('should generate unique room codes', async () => {
      const room1 = await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: {}
      });

      const room2 = await roomManager.createRoom({
        hostId: testPlayer2._id.toString(),
        settings: {}
      });

      expect(room1.code).not.toBe(room2.code);
    });
  });

  describe('joinRoom', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: {}
      });
    });

    it('should allow player to join room by code', async () => {
      const result = await roomManager.joinRoom(testRoom.code, testPlayer2._id.toString());

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully joined room');
      expect(result.room).toBeDefined();
      expect(result.room!.players).toHaveLength(2);
    });

    it('should allow player to join room by ID', async () => {
      const result = await roomManager.joinRoom(testRoom._id.toString(), testPlayer2._id.toString());

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully joined room');
      expect(result.room!.players).toHaveLength(2);
    });

    it('should not allow joining non-existent room', async () => {
      const result = await roomManager.joinRoom('NONEXIST', testPlayer2._id.toString());

      expect(result.success).toBe(false);
      expect(result.message).toBe('Room not found');
    });

    it('should not allow joining full room', async () => {
      // Set room to max 4 players and fill it
      testRoom.settings.maxPlayers = 4;
      testRoom.players.push(testPlayer2._id);
      testRoom.players.push(testPlayer3._id);
      
      // Create a fourth player to fill the room
      const testPlayer4 = await Player.create({
        username: 'testplayer4',
        email: 'player4@test.com',
        password: 'hashedpassword',
        avatar: 'avatar4.png'
      });
      testRoom.players.push(testPlayer4._id);
      await testRoom.save();

      // Try to add a fifth player
      const testPlayer5 = await Player.create({
        username: 'testplayer5',
        email: 'player5@test.com',
        password: 'hashedpassword',
        avatar: 'avatar5.png'
      });

      const result = await roomManager.joinRoom(testRoom.code, testPlayer5._id.toString());

      expect(result.success).toBe(false);
      expect(result.message).toBe('Room is full');
    });

    it('should not allow joining room in progress', async () => {
      testRoom.status = RoomStatus.IN_PROGRESS;
      await testRoom.save();

      const result = await roomManager.joinRoom(testRoom.code, testPlayer2._id.toString());

      expect(result.success).toBe(false);
      expect(result.message).toBe('Room is not accepting new players');
    });

    it('should handle player already in room', async () => {
      const result = await roomManager.joinRoom(testRoom.code, testPlayer1._id.toString());

      expect(result.success).toBe(true);
      expect(result.message).toBe('Already in room');
      expect(result.room!.players).toHaveLength(1);
    });

    it('should not allow joining invite-only room without being host', async () => {
      testRoom.settings.requireInvite = true;
      await testRoom.save();

      const result = await roomManager.joinRoom(testRoom.code, testPlayer2._id.toString());

      expect(result.success).toBe(false);
      expect(result.message).toBe('Room requires invitation');
    });

    it('should not allow non-existent player to join', async () => {
      const result = await roomManager.joinRoom(testRoom.code, '507f1f77bcf86cd799439011');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Player not found');
    });
  });

  describe('leaveRoom', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: {}
      });
      await roomManager.joinRoom(testRoom.code, testPlayer2._id.toString());
      await roomManager.joinRoom(testRoom.code, testPlayer3._id.toString());
    });

    it('should allow player to leave room', async () => {
      const success = await roomManager.leaveRoom(testRoom._id.toString(), testPlayer2._id.toString());

      expect(success).toBe(true);

      const updatedRoom = await Room.findById(testRoom._id);
      expect(updatedRoom!.players).toHaveLength(2);
      expect(updatedRoom!.players.map(p => p.toString())).not.toContain(testPlayer2._id.toString());
    });

    it('should transfer host when host leaves', async () => {
      const success = await roomManager.leaveRoom(testRoom._id.toString(), testPlayer1._id.toString());

      expect(success).toBe(true);

      const updatedRoom = await Room.findById(testRoom._id);
      expect(updatedRoom!.hostId.toString()).toBe(testPlayer2._id.toString());
      expect(updatedRoom!.players).toHaveLength(2);
    });

    it('should cancel room when last player leaves', async () => {
      // Remove all players except host
      await roomManager.leaveRoom(testRoom._id.toString(), testPlayer2._id.toString());
      await roomManager.leaveRoom(testRoom._id.toString(), testPlayer3._id.toString());
      
      const success = await roomManager.leaveRoom(testRoom._id.toString(), testPlayer1._id.toString());

      expect(success).toBe(true);

      const updatedRoom = await Room.findById(testRoom._id);
      expect(updatedRoom!.status).toBe(RoomStatus.CANCELLED);
      expect(updatedRoom!.players).toHaveLength(0);
    });

    it('should return false for non-existent room', async () => {
      const success = await roomManager.leaveRoom('507f1f77bcf86cd799439011', testPlayer1._id.toString());

      expect(success).toBe(false);
    });

    it('should return false when player not in room', async () => {
      const newPlayer = await Player.create({
        username: 'newplayer',
        email: 'new@test.com',
        password: 'hashedpassword',
        avatar: 'avatar.png'
      });

      const success = await roomManager.leaveRoom(testRoom._id.toString(), newPlayer._id.toString());

      expect(success).toBe(false);
    });
  });

  describe('updateRoomSettings', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: {}
      });
    });

    it('should allow host to update room settings', async () => {
      const newSettings = {
        isPublic: false,
        maxPlayers: 10,
        allowSpectators: true
      };

      const updatedRoom = await roomManager.updateRoomSettings(
        testRoom._id.toString(),
        testPlayer1._id.toString(),
        newSettings
      );

      expect(updatedRoom).toBeDefined();
      expect(updatedRoom!.settings.isPublic).toBe(false);
      expect(updatedRoom!.settings.maxPlayers).toBe(10);
      expect(updatedRoom!.settings.allowSpectators).toBe(true);
    });

    it('should not allow non-host to update settings', async () => {
      await expect(roomManager.updateRoomSettings(
        testRoom._id.toString(),
        testPlayer2._id.toString(),
        { isPublic: false }
      )).rejects.toThrow('Only the host can update room settings');
    });

    it('should not allow updating settings for non-existent room', async () => {
      await expect(roomManager.updateRoomSettings(
        '507f1f77bcf86cd799439011',
        testPlayer1._id.toString(),
        { isPublic: false }
      )).rejects.toThrow('Room not found');
    });

    it('should not allow updating settings for room in progress', async () => {
      testRoom.status = RoomStatus.IN_PROGRESS;
      await testRoom.save();

      await expect(roomManager.updateRoomSettings(
        testRoom._id.toString(),
        testPlayer1._id.toString(),
        { isPublic: false }
      )).rejects.toThrow('Cannot update settings for a room that has started');
    });

    it('should not allow setting max players below current player count', async () => {
      await roomManager.joinRoom(testRoom.code, testPlayer2._id.toString());
      await roomManager.joinRoom(testRoom.code, testPlayer3._id.toString());

      await expect(roomManager.updateRoomSettings(
        testRoom._id.toString(),
        testPlayer1._id.toString(),
        { maxPlayers: 2 }
      )).rejects.toThrow('Cannot set max players below current player count');
    });
  });

  describe('getPublicRooms', () => {
    beforeEach(async () => {
      // Create multiple test rooms
      await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: { isPublic: true, maxPlayers: 8 }
      });

      await roomManager.createRoom({
        hostId: testPlayer2._id.toString(),
        settings: { 
          isPublic: true, 
          maxPlayers: 12, 
          gameSettings: { 
            maxPlayers: 12,
            enableVoiceChat: false,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: []
          } 
        }
      });

      await roomManager.createRoom({
        hostId: testPlayer3._id.toString(),
        settings: { isPublic: false, maxPlayers: 6 }
      });
    });

    it('should return public rooms only', async () => {
      const result = await roomManager.getPublicRooms();

      expect(result.rooms).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by max players', async () => {
      const result = await roomManager.getPublicRooms({ maxPlayers: 10 });

      expect(result.rooms).toHaveLength(1);
      expect(result.rooms[0].settings.maxPlayers).toBe(12);
    });

    it('should filter by voice chat setting', async () => {
      const result = await roomManager.getPublicRooms({ hasVoiceChat: false });

      expect(result.rooms).toHaveLength(1);
      expect(result.rooms[0].settings.gameSettings.enableVoiceChat).toBe(false);
    });

    it('should support pagination', async () => {
      const result = await roomManager.getPublicRooms({}, { page: 1, limit: 1 });

      expect(result.rooms).toHaveLength(1);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(2);
    });

    it('should search by host username', async () => {
      const result = await roomManager.getPublicRooms({ search: 'testplayer2' });

      expect(result.rooms).toHaveLength(1);
      expect((result.rooms[0].hostId as any).username).toBe('testplayer2');
    });
  });

  describe('transferHost', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await roomManager.createRoom({
        hostId: testPlayer1._id.toString(),
        settings: {}
      });
      await roomManager.joinRoom(testRoom.code, testPlayer2._id.toString());
    });

    it('should transfer host to another player in room', async () => {
      const success = await roomManager.transferHost(
        testRoom._id.toString(),
        testPlayer1._id.toString(),
        testPlayer2._id.toString()
      );

      expect(success).toBe(true);

      const updatedRoom = await Room.findById(testRoom._id);
      expect(updatedRoom!.hostId.toString()).toBe(testPlayer2._id.toString());
    });

    it('should not allow non-host to transfer host', async () => {
      await expect(roomManager.transferHost(
        testRoom._id.toString(),
        testPlayer2._id.toString(),
        testPlayer3._id.toString()
      )).rejects.toThrow('Only the current host can transfer host privileges');
    });

    it('should not allow transferring to player not in room', async () => {
      await expect(roomManager.transferHost(
        testRoom._id.toString(),
        testPlayer1._id.toString(),
        testPlayer3._id.toString()
      )).rejects.toThrow('New host must be a player in the room');
    });

    it('should return false for non-existent room', async () => {
      const success = await roomManager.transferHost(
        '507f1f77bcf86cd799439011',
        testPlayer1._id.toString(),
        testPlayer2._id.toString()
      );

      expect(success).toBe(false);
    });
  });

  describe('cleanupOldRooms', () => {
    beforeEach(async () => {
      // Create rooms with different statuses and ages
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

      const cancelledRoom = await Room.create({
        code: 'CANCEL',
        hostId: testPlayer1._id,
        players: [],
        settings: { 
          isPublic: true, 
          maxPlayers: 8, 
          gameSettings: {
            maxPlayers: 8,
            enableVoiceChat: true,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: []
          }, 
          allowSpectators: false, 
          requireInvite: false 
        },
        status: RoomStatus.CANCELLED,
        createdAt: oldDate,
        updatedAt: oldDate
      });

      const finishedRoom = await Room.create({
        code: 'FINISH',
        hostId: testPlayer2._id,
        players: [],
        settings: { 
          isPublic: true, 
          maxPlayers: 8, 
          gameSettings: {
            maxPlayers: 8,
            enableVoiceChat: true,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: []
          }, 
          allowSpectators: false, 
          requireInvite: false 
        },
        status: RoomStatus.FINISHED,
        createdAt: oldDate,
        updatedAt: oldDate
      });

      const waitingRoom = await Room.create({
        code: 'WAIT01',
        hostId: testPlayer3._id,
        players: [testPlayer3._id],
        settings: { 
          isPublic: true, 
          maxPlayers: 8, 
          gameSettings: {
            maxPlayers: 8,
            enableVoiceChat: true,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: []
          }, 
          allowSpectators: false, 
          requireInvite: false 
        },
        status: RoomStatus.WAITING,
        createdAt: oldDate,
        updatedAt: oldDate
      });
    });

    it('should clean up old cancelled and finished rooms', async () => {
      const deletedCount = await roomManager.cleanupOldRooms(24);

      expect(deletedCount).toBe(2);

      const remainingRooms = await Room.find({});
      expect(remainingRooms).toHaveLength(1);
      expect(remainingRooms[0].status).toBe(RoomStatus.WAITING);
    });

    it('should not clean up recent rooms', async () => {
      const deletedCount = await roomManager.cleanupOldRooms(48);

      expect(deletedCount).toBe(0);

      const remainingRooms = await Room.find({});
      expect(remainingRooms).toHaveLength(3);
    });
  });
});