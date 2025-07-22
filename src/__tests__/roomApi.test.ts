import request from 'supertest';
import { app } from '../index';
import { Player } from '../models/Player';
import { Room, RoomStatus } from '../models/Room';
import { connectDB, disconnectDB, clearDB } from './setup';
import jwt from 'jsonwebtoken';

describe('Room API Endpoints', () => {
  let testPlayer1: any;
  let testPlayer2: any;
  let testPlayer3: any;
  let authToken1: string;
  let authToken2: string;
  let authToken3: string;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDB();

    // Create test players
    testPlayer1 = await Player.create({
      username: 'testhost',
      email: 'host@test.com',
      passwordHash: 'hashedpassword',
      avatar: 'avatar1.png'
    });

    testPlayer2 = await Player.create({
      username: 'testplayer2',
      email: 'player2@test.com',
      passwordHash: 'hashedpassword',
      avatar: 'avatar2.png'
    });

    testPlayer3 = await Player.create({
      username: 'testplayer3',
      email: 'player3@test.com',
      passwordHash: 'hashedpassword',
      avatar: 'avatar3.png'
    });

    // Generate auth tokens
    authToken1 = jwt.sign(
      { userId: testPlayer1._id.toString(), username: testPlayer1.username },
      process.env.JWT_ACCESS_SECRET || 'test-access-secret',
      { expiresIn: '1h' }
    );

    authToken2 = jwt.sign(
      { userId: testPlayer2._id.toString(), username: testPlayer2.username },
      process.env.JWT_ACCESS_SECRET || 'test-access-secret',
      { expiresIn: '1h' }
    );

    authToken3 = jwt.sign(
      { userId: testPlayer3._id.toString(), username: testPlayer3.username },
      process.env.JWT_ACCESS_SECRET || 'test-access-secret',
      { expiresIn: '1h' }
    );
  });

  afterEach(async () => {
    await clearDB();
  });

  describe('POST /api/rooms', () => {
    it('should create a room with default settings', async () => {
      const response = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(response.body.data.hostId._id).toBe(testPlayer1._id.toString());
      expect(response.body.data.players).toHaveLength(1);
      expect(response.body.data.settings.isPublic).toBe(true);
      expect(response.body.data.settings.maxPlayers).toBe(8);
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

      const response = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({ settings: customSettings });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.settings.isPublic).toBe(false);
      expect(response.body.data.settings.maxPlayers).toBe(12);
      expect(response.body.data.settings.gameSettings.enableVoiceChat).toBe(false);
      expect(response.body.data.settings.allowSpectators).toBe(true);
      expect(response.body.data.settings.requireInvite).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/rooms')
        .send({});

      expect(response.status).toBe(401);
    });

    it('should validate settings', async () => {
      const response = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          settings: {
            maxPlayers: 25 // Invalid - too high
          }
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/rooms/public', () => {
    beforeEach(async () => {
      // Create test rooms
      await Room.create({
        code: 'PUB001',
        hostId: testPlayer1._id,
        players: [testPlayer1._id],
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
        status: RoomStatus.WAITING
      });

      await Room.create({
        code: 'PUB002',
        hostId: testPlayer2._id,
        players: [testPlayer2._id],
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
          },
          allowSpectators: true,
          requireInvite: false
        },
        status: RoomStatus.WAITING
      });

      await Room.create({
        code: 'PRIV01',
        hostId: testPlayer3._id,
        players: [testPlayer3._id],
        settings: {
          isPublic: false,
          maxPlayers: 6,
          gameSettings: { 
            maxPlayers: 6,
            enableVoiceChat: true,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: []
          },
          allowSpectators: false,
          requireInvite: true
        },
        status: RoomStatus.WAITING
      });
    });

    it('should return public rooms only', async () => {
      const response = await request(app)
        .get('/api/rooms/public');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.rooms).toHaveLength(2);
      expect(response.body.data.total).toBe(2);
      expect(response.body.data.page).toBe(1);
      expect(response.body.data.totalPages).toBe(1);
    });

    it('should filter by max players', async () => {
      const response = await request(app)
        .get('/api/rooms/public?maxPlayers=10');

      expect(response.status).toBe(200);
      expect(response.body.data.rooms).toHaveLength(1);
      expect(response.body.data.rooms[0].settings.maxPlayers).toBe(12);
    });

    it('should filter by voice chat setting', async () => {
      const response = await request(app)
        .get('/api/rooms/public?hasVoiceChat=false');

      expect(response.status).toBe(200);
      expect(response.body.data.rooms).toHaveLength(1);
      expect(response.body.data.rooms[0].settings.gameSettings.enableVoiceChat).toBe(false);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/rooms/public?page=1&limit=1');

      expect(response.status).toBe(200);
      expect(response.body.data.rooms).toHaveLength(1);
      expect(response.body.data.total).toBe(2);
      expect(response.body.data.totalPages).toBe(2);
    });

    it('should validate query parameters', async () => {
      const response = await request(app)
        .get('/api/rooms/public?page=0'); // Invalid page

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/rooms/join', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await Room.create({
        code: 'JOIN01',
        hostId: testPlayer1._id,
        players: [testPlayer1._id],
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
        status: RoomStatus.WAITING
      });
    });

    it('should allow joining room by code', async () => {
      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({ roomIdentifier: 'JOIN01' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.players).toHaveLength(2);
    });

    it('should allow joining room by ID', async () => {
      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({ roomIdentifier: testRoom._id.toString() });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.players).toHaveLength(2);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/rooms/join')
        .send({ roomIdentifier: 'JOIN01' });

      expect(response.status).toBe(401);
    });

    it('should handle non-existent room', async () => {
      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({ roomIdentifier: 'NONEXIST' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Room not found');
    });

    it('should validate request body', async () => {
      const response = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({}); // Missing roomIdentifier

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/rooms/:roomId/leave', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await Room.create({
        code: 'LEAVE1',
        hostId: testPlayer1._id,
        players: [testPlayer1._id, testPlayer2._id],
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
        status: RoomStatus.WAITING
      });
    });

    it('should allow player to leave room', async () => {
      const response = await request(app)
        .post(`/api/rooms/${testRoom._id}/leave`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Left room successfully');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/rooms/${testRoom._id}/leave`);

      expect(response.status).toBe(401);
    });

    it('should validate room ID', async () => {
      const response = await request(app)
        .post('/api/rooms/invalid-id/leave')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/rooms/:roomId/settings', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await Room.create({
        code: 'UPDATE',
        hostId: testPlayer1._id,
        players: [testPlayer1._id],
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
        status: RoomStatus.WAITING
      });
    });

    it('should allow host to update room settings', async () => {
      const newSettings = {
        isPublic: false,
        maxPlayers: 10,
        allowSpectators: true
      };

      const response = await request(app)
        .put(`/api/rooms/${testRoom._id}/settings`)
        .set('Authorization', `Bearer ${authToken1}`)
        .send({ settings: newSettings });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.settings.isPublic).toBe(false);
      expect(response.body.data.settings.maxPlayers).toBe(10);
      expect(response.body.data.settings.allowSpectators).toBe(true);
    });

    it('should not allow non-host to update settings', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRoom._id}/settings`)
        .set('Authorization', `Bearer ${authToken2}`)
        .send({ settings: { isPublic: false } });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRoom._id}/settings`)
        .send({ settings: { isPublic: false } });

      expect(response.status).toBe(401);
    });

    it('should validate settings', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRoom._id}/settings`)
        .set('Authorization', `Bearer ${authToken1}`)
        .send({ settings: { maxPlayers: 25 } }); // Invalid

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/rooms/:roomId', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await Room.create({
        code: 'GET001',
        hostId: testPlayer1._id,
        players: [testPlayer1._id],
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
        status: RoomStatus.WAITING
      });
    });

    it('should return room details', async () => {
      const response = await request(app)
        .get(`/api/rooms/${testRoom._id}`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.code).toBe('GET001');
      expect(response.body.data.hostId._id).toBe(testPlayer1._id.toString());
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get(`/api/rooms/${testRoom._id}`);

      expect(response.status).toBe(401);
    });

    it('should handle non-existent room', async () => {
      const response = await request(app)
        .get('/api/rooms/507f1f77bcf86cd799439011')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should validate room ID', async () => {
      const response = await request(app)
        .get('/api/rooms/invalid-id')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/rooms/code/:code', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await Room.create({
        code: 'CODE01',
        hostId: testPlayer1._id,
        players: [testPlayer1._id],
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
        status: RoomStatus.WAITING
      });
    });

    it('should return room by code', async () => {
      const response = await request(app)
        .get('/api/rooms/code/CODE01');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.code).toBe('CODE01');
    });

    it('should handle non-existent room', async () => {
      const response = await request(app)
        .get('/api/rooms/code/NONE01');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });

    it('should validate room code format', async () => {
      const response = await request(app)
        .get('/api/rooms/code/invalid');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/rooms/:roomId/transfer-host', () => {
    let testRoom: any;

    beforeEach(async () => {
      testRoom = await Room.create({
        code: 'TRANS1',
        hostId: testPlayer1._id,
        players: [testPlayer1._id, testPlayer2._id],
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
        status: RoomStatus.WAITING
      });
    });

    it('should allow host to transfer privileges', async () => {
      const response = await request(app)
        .post(`/api/rooms/${testRoom._id}/transfer-host`)
        .set('Authorization', `Bearer ${authToken1}`)
        .send({ newHostId: testPlayer2._id.toString() });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Host transferred successfully');
    });

    it('should not allow non-host to transfer privileges', async () => {
      const response = await request(app)
        .post(`/api/rooms/${testRoom._id}/transfer-host`)
        .set('Authorization', `Bearer ${authToken2}`)
        .send({ newHostId: testPlayer3._id.toString() });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/rooms/${testRoom._id}/transfer-host`)
        .send({ newHostId: testPlayer2._id.toString() });

      expect(response.status).toBe(401);
    });

    it('should validate request body', async () => {
      const response = await request(app)
        .post(`/api/rooms/${testRoom._id}/transfer-host`)
        .set('Authorization', `Bearer ${authToken1}`)
        .send({ newHostId: 'invalid-id' });

      expect(response.status).toBe(400);
    });
  });
});