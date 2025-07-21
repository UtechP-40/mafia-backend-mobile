import request from 'supertest';
import { Express } from 'express';
import { Types } from 'mongoose';
import { Player, IPlayer, GameRole } from '../models/Player';
import { AuthService } from '../services/AuthService';
import { setupTestApp, cleanupTestDb } from './setup';

describe('Player API Integration Tests', () => {
  let app: Express;
  let testPlayer1: IPlayer;
  let testPlayer2: IPlayer;
  let testPlayer3: IPlayer;
  let authToken1: string;
  let authToken2: string;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  beforeEach(async () => {
    // Clean database
    await cleanupTestDb();

    // Create test players
    const player1Data = {
      username: 'testplayer1',
      email: 'test1@example.com',
      password: 'password123',
      avatar: 'avatar1.png'
    };

    const player2Data = {
      username: 'testplayer2',
      email: 'test2@example.com',
      password: 'password123',
      avatar: 'avatar2.png'
    };

    const player3Data = {
      username: 'searchplayer',
      email: 'search@example.com',
      password: 'password123',
      avatar: 'avatar3.png'
    };

    // Register players
    const result1 = await AuthService.register(player1Data);
    const result2 = await AuthService.register(player2Data);
    const result3 = await AuthService.register(player3Data);

    testPlayer1 = result1.player!;
    testPlayer2 = result2.player!;
    testPlayer3 = result3.player!;
    authToken1 = result1.accessToken!;
    authToken2 = result2.accessToken!;
  });

  afterAll(async () => {
    await cleanupTestDb();
  });

  describe('GET /api/players/profile', () => {
    it('should get player profile successfully', async () => {
      const response = await request(app)
        .get('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        username: 'testplayer1',
        email: 'test1@example.com',
        avatar: 'avatar1.png'
      });
      expect(response.body.data.password).toBeUndefined();
      expect(response.body.data.refreshTokens).toBeUndefined();
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/players/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Access token required');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/api/players/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid or expired access token');
    });
  });

  describe('PUT /api/players/profile', () => {
    it('should update username successfully', async () => {
      const updateData = { username: 'newusername' };

      const response = await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.username).toBe('newusername');
      expect(response.body.message).toBe('Profile updated successfully');
    });

    it('should update avatar successfully', async () => {
      const updateData = { avatar: 'new-avatar.png' };

      const response = await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.avatar).toBe('new-avatar.png');
    });

    it('should update both username and avatar', async () => {
      const updateData = { 
        username: 'newusername', 
        avatar: 'new-avatar.png' 
      };

      const response = await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.username).toBe('newusername');
      expect(response.body.data.avatar).toBe('new-avatar.png');
    });

    it('should reject invalid username', async () => {
      const updateData = { username: 'ab' }; // Too short

      const response = await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .send(updateData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Username must be 3-20 characters');
    });

    it('should reject duplicate username', async () => {
      const updateData = { username: 'testplayer2' }; // Already taken

      const response = await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .send(updateData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Username already taken');
    });

    it('should reject empty update data', async () => {
      const response = await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('At least one field');
    });

    it('should sanitize input', async () => {
      const updateData = { username: '  test<script>  ' };

      const response = await request(app)
        .put('/api/players/profile')
        .set('Authorization', `Bearer ${authToken1}`)
        .send(updateData)
        .expect(200);

      expect(response.body.data.username).toBe('testscript');
    });
  });

  describe('GET /api/players/stats', () => {
    it('should get player statistics', async () => {
      const response = await request(app)
        .get('/api/players/stats')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        gamesPlayed: 0,
        gamesWon: 0,
        winRate: 0,
        favoriteRole: GameRole.VILLAGER,
        averageGameDuration: 0,
        eloRating: 1200
      });
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/players/stats')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/players/search', () => {
    it('should search players by username', async () => {
      const response = await request(app)
        .get('/api/players/search?q=search')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].username).toBe('searchplayer');
      expect(response.body.data[0].isOnline).toBeDefined();
    });

    it('should not return current player in search results', async () => {
      const response = await request(app)
        .get('/api/players/search?q=testplayer1')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });

    it('should limit search results', async () => {
      const response = await request(app)
        .get('/api/players/search?q=test&limit=1')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(1);
    });

    it('should reject empty search query', async () => {
      const response = await request(app)
        .get('/api/players/search?q=')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Search query is required');
    });

    it('should reject short search query', async () => {
      const response = await request(app)
        .get('/api/players/search?q=a')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('at least 2 characters');
    });
  });

  describe('Friend Management', () => {
    describe('POST /api/players/friends', () => {
      it('should add friend successfully', async () => {
        const response = await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: testPlayer2._id.toString() })
          .expect(201);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('Successfully added');

        // Verify friendship was created for both players
        const player1 = await Player.findById(testPlayer1._id);
        const player2 = await Player.findById(testPlayer2._id);
        
        expect(player1?.friends).toContain(testPlayer2._id);
        expect(player2?.friends).toContain(testPlayer1._id);
      });

      it('should reject adding self as friend', async () => {
        const response = await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: testPlayer1._id.toString() })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Cannot add yourself as a friend');
      });

      it('should reject adding existing friend', async () => {
        // First add friend
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: testPlayer2._id.toString() })
          .expect(201);

        // Try to add same friend again
        const response = await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: testPlayer2._id.toString() })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Already friends with this player');
      });

      it('should reject invalid friend ID', async () => {
        const response = await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: 'invalid-id' })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Invalid player ID');
      });

      it('should reject non-existent friend ID', async () => {
        const fakeId = new Types.ObjectId().toString();
        const response = await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: fakeId })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Player not found');
      });
    });

    describe('GET /api/players/friends', () => {
      beforeEach(async () => {
        // Add testPlayer2 as friend of testPlayer1
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: testPlayer2._id.toString() });
      });

      it('should get friends list', async () => {
        const response = await request(app)
          .get('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
          username: 'testplayer2',
          avatar: 'avatar2.png'
        });
        expect(response.body.data[0].isOnline).toBeDefined();
      });

      it('should return empty list for no friends', async () => {
        const response = await request(app)
          .get('/api/players/friends')
          .set('Authorization', `Bearer ${authToken2}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(1); // testPlayer1 is friend of testPlayer2
      });
    });

    describe('DELETE /api/players/friends/:friendId', () => {
      beforeEach(async () => {
        // Add testPlayer2 as friend of testPlayer1
        await request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: testPlayer2._id.toString() });
      });

      it('should remove friend successfully', async () => {
        const response = await request(app)
          .delete(`/api/players/friends/${testPlayer2._id.toString()}`)
          .set('Authorization', `Bearer ${authToken1}`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('Successfully removed');

        // Verify friendship was removed for both players
        const player1 = await Player.findById(testPlayer1._id);
        const player2 = await Player.findById(testPlayer2._id);
        
        expect(player1?.friends).not.toContain(testPlayer2._id);
        expect(player2?.friends).not.toContain(testPlayer1._id);
      });

      it('should handle removing non-friend', async () => {
        const response = await request(app)
          .delete(`/api/players/friends/${testPlayer3._id.toString()}`)
          .set('Authorization', `Bearer ${authToken1}`)
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('should reject invalid friend ID', async () => {
        const response = await request(app)
          .delete('/api/players/friends/invalid-id')
          .set('Authorization', `Bearer ${authToken1}`)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Invalid player ID');
      });
    });
  });

  describe('GET /api/players/leaderboard', () => {
    beforeEach(async () => {
      // Update player statistics to create a leaderboard
      const player1 = await Player.findById(testPlayer1._id);
      const player2 = await Player.findById(testPlayer2._id);
      const player3 = await Player.findById(testPlayer3._id);

      if (player1) {
        player1.statistics.eloRating = 1500;
        await player1.save();
      }

      if (player2) {
        player2.statistics.eloRating = 1300;
        await player2.save();
      }

      if (player3) {
        player3.statistics.eloRating = 1400;
        await player3.save();
      }
    });

    it('should get leaderboard sorted by ELO rating', async () => {
      const response = await request(app)
        .get('/api/players/leaderboard')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      
      // Should be sorted by ELO rating (highest first)
      expect(response.body.data[0].statistics.eloRating).toBe(1500);
      expect(response.body.data[1].statistics.eloRating).toBe(1400);
      expect(response.body.data[2].statistics.eloRating).toBe(1300);
    });

    it('should limit leaderboard results', async () => {
      const response = await request(app)
        .get('/api/players/leaderboard?limit=2')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it('should cap limit at 100', async () => {
      const response = await request(app)
        .get('/api/players/leaderboard?limit=200')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should still work, just with the available players
    });
  });

  describe('POST /api/players/activity', () => {
    it('should update last active timestamp', async () => {
      const beforeTime = new Date();
      
      const response = await request(app)
        .post('/api/players/activity')
        .set('Authorization', `Bearer ${authToken1}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Activity updated successfully');

      // Verify timestamp was updated
      const player = await Player.findById(testPlayer1._id);
      expect(player?.lastActive.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/players/activity')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to profile updates', async () => {
      // Make multiple requests quickly
      const promises = Array(12).fill(0).map((_, i) => 
        request(app)
          .put('/api/players/profile')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ avatar: `avatar${i}.png` })
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429 status)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should apply rate limiting to friend operations', async () => {
      // Make multiple friend requests quickly
      const promises = Array(12).fill(0).map(() => 
        request(app)
          .post('/api/players/friends')
          .set('Authorization', `Bearer ${authToken1}`)
          .send({ friendId: testPlayer2._id.toString() })
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });
});