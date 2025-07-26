import request from 'supertest';
import { app } from '../index';
import { Game } from '../models/Game';
import { Player } from '../models/Player';
import { Achievement, PlayerAchievement } from '../models/Achievement';
import { AchievementService } from '../services/AchievementService';
import { connectDB, disconnectDB } from './setup';

describe('Game Results API', () => {
  let authToken: string;
  let testPlayer: any;
  let testGame: any;

  beforeAll(async () => {
    await connectDB();
    
    // Create test player and get auth token
    const playerData = {
      username: 'testplayer',
      email: 'test@example.com',
      password: 'password123'
    };

    const registerResponse = await request(app)
      .post('/api/auth/register')
      .send(playerData);

    authToken = registerResponse.body.data.accessToken;
    testPlayer = registerResponse.body.data.player;

    // Create test game
    testGame = await Game.create({
      roomId: testPlayer._id, // Using player ID as room ID for test
      phase: 'finished',
      dayNumber: 3,
      players: [testPlayer._id],
      eliminatedPlayers: [],
      votes: [],
      timeRemaining: 0,
      settings: {
        maxPlayers: 8,
        enableVoiceChat: true,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 180000,
        votingDuration: 120000,
        roles: []
      },
      history: [
        {
          type: 'game_start',
          timestamp: new Date(),
          phase: 'day',
          dayNumber: 1
        },
        {
          type: 'player_vote',
          playerId: testPlayer._id,
          targetId: testPlayer._id,
          timestamp: new Date(),
          phase: 'voting',
          dayNumber: 1
        }
      ],
      winResult: {
        condition: 'villager_win',
        winningTeam: 'villagers',
        winningPlayers: [testPlayer._id],
        reason: 'All mafia eliminated'
      }
    });
  });

  afterAll(async () => {
    await Game.deleteMany({});
    await Player.deleteMany({});
    await Achievement.deleteMany({});
    await PlayerAchievement.deleteMany({});
    await disconnectDB();
  });

  describe('GET /api/games/history', () => {
    it('should return game history for authenticated player', async () => {
      const response = await request(app)
        .get('/api/games/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.games).toBeDefined();
      expect(response.body.pagination).toBeDefined();
      expect(response.body.games.length).toBeGreaterThan(0);
      expect(response.body.games[0].id).toBe(testGame._id.toString());
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/games/history?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(5);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/games/history')
        .expect(401);
    });
  });

  describe('GET /api/games/:gameId/results', () => {
    it('should return detailed game results', async () => {
      const response = await request(app)
        .get(`/api/games/${testGame._id}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.game).toBeDefined();
      expect(response.body.matchStats).toBeDefined();
      expect(response.body.playerPerformance).toBeDefined();
      expect(response.body.gameEvents).toBeDefined();

      // Check match stats
      expect(response.body.matchStats.totalPlayers).toBe(1);
      expect(response.body.matchStats.daysCycled).toBe(3);
      expect(response.body.matchStats.winResult).toBeDefined();

      // Check player performance
      expect(response.body.playerPerformance).toHaveLength(1);
      expect(response.body.playerPerformance[0].player.id).toBe(testPlayer._id);
      expect(response.body.playerPerformance[0].votesCast).toBe(1);
    });

    it('should return 404 for non-existent game', async () => {
      const fakeGameId = '507f1f77bcf86cd799439011';
      await request(app)
        .get(`/api/games/${fakeGameId}/results`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should return 403 if player was not in the game', async () => {
      // Create another player
      const otherPlayerData = {
        username: 'otherplayer',
        email: 'other@example.com',
        password: 'password123'
      };

      const otherPlayerResponse = await request(app)
        .post('/api/auth/register')
        .send(otherPlayerData);

      const otherAuthToken = otherPlayerResponse.body.data.accessToken;

      await request(app)
        .get(`/api/games/${testGame._id}/results`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(403);
    });
  });

  describe('GET /api/games/stats/:playerId?', () => {
    beforeEach(async () => {
      // Update player statistics
      await Player.findByIdAndUpdate(testPlayer._id, {
        'statistics.gamesPlayed': 5,
        'statistics.gamesWon': 3,
        'statistics.winRate': 60,
        'statistics.eloRating': 1350
      });
    });

    it('should return player statistics', async () => {
      const response = await request(app)
        .get('/api/games/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.player).toBeDefined();
      expect(response.body.roleStats).toBeDefined();
      expect(response.body.streaks).toBeDefined();
      expect(response.body.recentPerformance).toBeDefined();

      expect(response.body.player.statistics.gamesPlayed).toBe(5);
      expect(response.body.player.statistics.gamesWon).toBe(3);
      expect(response.body.player.statistics.winRate).toBe(60);
    });

    it('should return statistics for specific player if they are friends', async () => {
      // Create friend relationship
      await Player.findByIdAndUpdate(testPlayer._id, {
        $push: { friends: testPlayer._id } // Self-friend for test
      });

      const response = await request(app)
        .get(`/api/games/stats/${testPlayer._id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.player.id).toBe(testPlayer._id);
    });

    it('should return 403 for non-friend player statistics', async () => {
      const otherPlayerData = {
        username: 'stranger',
        email: 'stranger@example.com',
        password: 'password123'
      };

      const otherPlayerResponse = await request(app)
        .post('/api/auth/register')
        .send(otherPlayerData);

      const otherPlayerId = otherPlayerResponse.body.data.player._id;

      await request(app)
        .get(`/api/games/stats/${otherPlayerId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('Achievement System', () => {
    beforeAll(async () => {
      // Initialize achievements
      await AchievementService.initializeAchievements();
    });

    describe('GET /api/games/achievements', () => {
      it('should return player achievements', async () => {
        const response = await request(app)
          .get('/api/games/achievements')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.unlocked).toBeDefined();
        expect(response.body.inProgress).toBeDefined();
        expect(response.body.available).toBeDefined();
        expect(response.body.totalUnlocked).toBeDefined();
        expect(response.body.totalAvailable).toBeDefined();

        expect(Array.isArray(response.body.unlocked)).toBe(true);
        expect(Array.isArray(response.body.inProgress)).toBe(true);
        expect(Array.isArray(response.body.available)).toBe(true);
      });
    });

    describe('GET /api/games/achievements/recent', () => {
      it('should return recent achievement unlocks', async () => {
        const response = await request(app)
          .get('/api/games/achievements/recent')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.recentUnlocks).toBeDefined();
        expect(Array.isArray(response.body.recentUnlocks)).toBe(true);
      });

      it('should not allow viewing other players recent achievements', async () => {
        const otherPlayerData = {
          username: 'other2',
          email: 'other2@example.com',
          password: 'password123'
        };

        const otherPlayerResponse = await request(app)
          .post('/api/auth/register')
          .send(otherPlayerData);

        const otherPlayerId = otherPlayerResponse.body.data.player._id;

        await request(app)
          .get(`/api/games/achievements/recent/${otherPlayerId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(403);
      });
    });

    describe('POST /api/games/achievements/mark-read', () => {
      it('should mark achievement notifications as read', async () => {
        const response = await request(app)
          .post('/api/games/achievements/mark-read')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ achievementIds: [] })
          .expect(200);

        expect(response.body.message).toBe('Notifications marked as read');
      });

      it('should validate achievement IDs format', async () => {
        await request(app)
          .post('/api/games/achievements/mark-read')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ achievementIds: 'invalid' })
          .expect(400);
      });
    });
  });

  describe('Achievement Service', () => {
    it('should initialize default achievements', async () => {
      await AchievementService.initializeAchievements();
      
      const achievements = await Achievement.find({ isActive: true });
      expect(achievements.length).toBeGreaterThan(0);
      
      // Check for specific achievements
      const firstGameAchievement = achievements.find(a => a.key === 'first_game');
      expect(firstGameAchievement).toBeDefined();
      expect(firstGameAchievement?.name).toBe('First Steps');
    });

    it('should update player achievements after game', async () => {
      const gameResult = {
        won: true,
        votesReceived: 0,
        survived: true
      };

      await AchievementService.updatePlayerAchievements(testPlayer._id, gameResult);
      
      // Check if achievements were created/updated
      const playerAchievements = await PlayerAchievement.find({ 
        playerId: testPlayer._id 
      });
      
      expect(playerAchievements.length).toBeGreaterThan(0);
    });
  });
});