import request from 'supertest';
import { app } from '../index';
import { Player, Game, ChatMessage } from '../models';
import { connectDatabase, disconnectDatabase } from '../utils/database';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

// Mock the AI Service to avoid actual API calls during tests
jest.mock('../services/AIService', () => ({
  __esModule: true,
  default: {
    moderateContent: jest.fn().mockResolvedValue({
      isAppropriate: true,
      severity: 'low',
      reason: undefined,
      suggestedAction: undefined
    }),
    moderateGame: jest.fn().mockResolvedValue({
      message: 'Game situation looks normal. Continue playing!',
      action: undefined,
      confidence: 0.8
    }),
    analyzePlayerBehavior: jest.fn().mockResolvedValue({
      playerId: 'test-player-id',
      suspiciousPatterns: [],
      riskLevel: 'low',
      recommendations: []
    }),
    provideGameplayTips: jest.fn().mockResolvedValue([
      {
        message: 'Pay attention to voting patterns.',
        relevance: 0.8,
        timing: 'immediate'
      }
    ]),
    healthCheck: jest.fn().mockResolvedValue(true)
  }
}));

describe('AI API Endpoints', () => {
  let authToken: string;
  let testPlayer: any;
  let testGame: any;
  let testMessage: any;

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Clean up test data
    await Player.deleteMany({});
    await Game.deleteMany({});
    await ChatMessage.deleteMany({});

    // Create test player
    testPlayer = await Player.create({
      username: 'testplayer',
      email: 'test@example.com',
      password: 'hashedpassword',
      statistics: {
        gamesPlayed: 5,
        gamesWon: 3,
        winRate: 60,
        eloRating: 1300
      }
    });

    // Create test game
    testGame = await Game.create({
      roomId: new Types.ObjectId(),
      players: [testPlayer._id],
      phase: 'day',
      dayNumber: 1,
      eliminatedPlayers: [],
      votes: [],
      timeRemaining: 300000,
      settings: {
        maxPlayers: 8,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 180000,
        votingDuration: 120000
      },
      history: []
    });

    // Create test chat message
    testMessage = await ChatMessage.create({
      roomId: new Types.ObjectId(),
      playerId: testPlayer._id,
      content: 'Hello everyone!',
      type: 'player_chat'
    });

    // Generate auth token
    authToken = jwt.sign(
      { userId: testPlayer._id.toString(), username: testPlayer.username },
      process.env.JWT_ACCESS_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  describe('POST /api/ai/moderate-content', () => {
    it('should moderate content successfully', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-content')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'This is a test message',
          context: { roomId: 'test-room' }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('isAppropriate');
      expect(response.body.data).toHaveProperty('severity');
    });

    it('should return 400 for missing content', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-content')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Content is required');
    });

    it('should return 401 for missing auth token', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-content')
        .send({
          content: 'Test message'
        });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/ai/moderate-game', () => {
    it('should provide game moderation successfully', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-game')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gameId: testGame._id.toString(),
          context: 'Players are arguing about voting',
          issue: 'Dispute over game rules'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('message');
      expect(response.body.data).toHaveProperty('confidence');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-game')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gameId: testGame._id.toString()
          // Missing context
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('context are required');
    });

    it('should return 404 for non-existent game', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-game')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gameId: new Types.ObjectId().toString(),
          context: 'Test context'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Game not found');
    });
  });

  describe('POST /api/ai/analyze-behavior', () => {
    it('should analyze player behavior successfully', async () => {
      const response = await request(app)
        .post('/api/ai/analyze-behavior')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          playerId: testPlayer._id.toString(),
          gameId: testGame._id.toString()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('playerId');
      expect(response.body.data).toHaveProperty('suspiciousPatterns');
      expect(response.body.data).toHaveProperty('riskLevel');
      expect(response.body.data).toHaveProperty('recommendations');
    });

    it('should return 400 for missing player ID', async () => {
      const response = await request(app)
        .post('/api/ai/analyze-behavior')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Player ID is required');
    });

    it('should return 404 for non-existent player', async () => {
      const response = await request(app)
        .post('/api/ai/analyze-behavior')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          playerId: new Types.ObjectId().toString()
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Player not found');
    });
  });

  describe('POST /api/ai/gameplay-tips', () => {
    it('should provide gameplay tips successfully', async () => {
      const response = await request(app)
        .post('/api/ai/gameplay-tips')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gameId: testGame._id.toString(),
          experience: 'beginner'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      
      if (response.body.data.length > 0) {
        expect(response.body.data[0]).toHaveProperty('message');
        expect(response.body.data[0]).toHaveProperty('relevance');
        expect(response.body.data[0]).toHaveProperty('timing');
      }
    });

    it('should return 400 for missing game ID', async () => {
      const response = await request(app)
        .post('/api/ai/gameplay-tips')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Game ID is required');
    });

    it('should return 404 for non-existent game', async () => {
      const response = await request(app)
        .post('/api/ai/gameplay-tips')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gameId: new Types.ObjectId().toString()
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Game not found');
    });

    it('should return 403 for player not in game', async () => {
      // Create a game without the test player
      const otherGame = await Game.create({
        roomId: new Types.ObjectId(),
        players: [new Types.ObjectId()], // Different player
        phase: 'day',
        dayNumber: 1,
        eliminatedPlayers: [],
        votes: [],
        timeRemaining: 300000,
        settings: {
          maxPlayers: 8,
          dayPhaseDuration: 300000,
          nightPhaseDuration: 180000,
          votingDuration: 120000
        },
        history: []
      });

      const response = await request(app)
        .post('/api/ai/gameplay-tips')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gameId: otherGame._id.toString()
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Player is not in this game');
    });
  });

  describe('GET /api/ai/health', () => {
    it('should return AI service health status', async () => {
      const response = await request(app)
        .get('/api/ai/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('healthy');
      expect(response.body.data).toHaveProperty('timestamp');
    });
  });

  describe('POST /api/ai/chat-assistance', () => {
    it('should provide chat assistance successfully', async () => {
      const response = await request(app)
        .post('/api/ai/chat-assistance')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          roomId: testMessage.roomId.toString(),
          messageId: testMessage._id.toString(),
          action: 'moderate'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('moderation');
      expect(response.body.data).toHaveProperty('message');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/ai/chat-assistance')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          roomId: testMessage.roomId.toString()
          // Missing messageId
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Room ID and message ID are required');
    });

    it('should return 404 for non-existent message', async () => {
      const response = await request(app)
        .post('/api/ai/chat-assistance')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          roomId: testMessage.roomId.toString(),
          messageId: new Types.ObjectId().toString()
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Message not found');
    });
  });

  describe('Error Handling', () => {
    it('should handle AI service errors gracefully', async () => {
      // Mock AI service to throw an error
      const AIService = require('../services/AIService').default;
      AIService.moderateContent.mockRejectedValueOnce(new Error('AI service unavailable'));

      const response = await request(app)
        .post('/api/ai/moderate-content')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Test message'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to moderate content');
      expect(response.body.details).toBe('AI service unavailable');
    });

    it('should handle database errors gracefully', async () => {
      // Use an invalid ObjectId format
      const response = await request(app)
        .post('/api/ai/moderate-game')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gameId: 'invalid-id',
          context: 'Test context'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to moderate game');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without authentication token', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-content')
        .send({
          content: 'Test message'
        });

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid authentication token', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-content')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          content: 'Test message'
        });

      expect(response.status).toBe(401);
    });

    it('should accept requests with valid authentication token', async () => {
      const response = await request(app)
        .post('/api/ai/moderate-content')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Test message'
        });

      expect(response.status).toBe(200);
    });
  });
});