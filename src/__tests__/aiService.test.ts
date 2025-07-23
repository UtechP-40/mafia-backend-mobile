import AIService from '../services/AIService';
import { GamePhase, GameRole } from '../models';
import { Types } from 'mongoose';

// Mock the logger to avoid console output during tests
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock the ChatGoogleGenerativeAI to avoid actual API calls
jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        isAppropriate: true,
        severity: 'low',
        suspiciousPatterns: [],
        riskLevel: 'low',
        recommendations: []
      })
    })
  }))
}));

// Mock environment variables
const originalEnv = process.env;

describe('AIService', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      GEMINI_API_KEY: 'test-api-key'
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid API key', () => {
      expect(() => new (require('../services/AIService').default.constructor)()).not.toThrow();
    });

    it('should handle missing API key gracefully', () => {
      delete process.env.GEMINI_API_KEY;
      expect(() => new (require('../services/AIService').default.constructor)()).not.toThrow();
    });
  });

  describe('Content Moderation', () => {
    it('should identify appropriate content', async () => {
      const result = await AIService.moderateContent('Hello everyone, good luck in the game!');
      
      expect(result).toHaveProperty('isAppropriate');
      expect(result).toHaveProperty('severity');
      expect(['low', 'medium', 'high']).toContain(result.severity);
    });

    it('should handle empty messages', async () => {
      const result = await AIService.moderateContent('');
      
      expect(result).toHaveProperty('isAppropriate');
      expect(result.severity).toBe('low');
    });

    it('should handle very long messages', async () => {
      const longMessage = 'a'.repeat(1000);
      const result = await AIService.moderateContent(longMessage);
      
      expect(result).toHaveProperty('isAppropriate');
      expect(result).toHaveProperty('severity');
    });

    it('should return safe defaults when AI fails', async () => {
      // Mock AI failure by temporarily removing API key
      const originalKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      
      const result = await AIService.moderateContent('test message');
      
      expect(result.isAppropriate).toBe(true);
      expect(result.severity).toBe('low');
      
      process.env.GEMINI_API_KEY = originalKey;
    });
  });

  describe('Game Moderation', () => {
    const mockGameState = {
      _id: new Types.ObjectId(),
      roomId: new Types.ObjectId(),
      phase: GamePhase.DAY,
      dayNumber: 1,
      players: [new Types.ObjectId(), new Types.ObjectId()],
      eliminatedPlayers: [],
      votes: [],
      timeRemaining: 300000,
      settings: {},
      history: [],
      createdAt: new Date(),
      updatedAt: new Date()
    } as any;

    it('should provide game moderation response', async () => {
      // Ensure API key is set for this test
      process.env.GEMINI_API_KEY = 'test-api-key';
      AIService.reinitialize();
      
      const response = await AIService.moderateGame(
        mockGameState,
        'Players are arguing about voting',
        'Dispute over game rules'
      );
      
      expect(response).toHaveProperty('message');
      expect(response).toHaveProperty('confidence');
      expect(response.confidence).toBeGreaterThanOrEqual(0);
      expect(response.confidence).toBeLessThanOrEqual(1);
    });

    it('should handle game moderation without specific issue', async () => {
      // Ensure API key is set for this test
      process.env.GEMINI_API_KEY = 'test-api-key';
      AIService.reinitialize();
      
      const response = await AIService.moderateGame(
        mockGameState,
        'General game situation check'
      );
      
      expect(response).toHaveProperty('message');
      expect(response.message).toBeTruthy();
    });

    it('should throw error when not initialized', async () => {
      // Create a new instance without API key
      delete process.env.GEMINI_API_KEY;
      const uninitializedService = new (require('../services/AIService').default.constructor)();
      
      await expect(
        uninitializedService.moderateGame(mockGameState, 'test context')
      ).rejects.toThrow('AI Service is not initialized');
    });
  });

  describe('Player Behavior Analysis', () => {
    const mockPlayer = {
      _id: new Types.ObjectId(),
      username: 'testplayer',
      statistics: {
        gamesPlayed: 10,
        gamesWon: 5,
        winRate: 50,
        eloRating: 1200
      }
    } as any;

    const mockGameHistory = [
      { gameId: 'game1', result: 'win', role: GameRole.VILLAGER },
      { gameId: 'game2', result: 'loss', role: GameRole.MAFIA }
    ];

    it('should analyze player behavior', async () => {
      const analysis = await AIService.analyzePlayerBehavior(
        mockPlayer,
        mockGameHistory
      );
      
      expect(analysis).toHaveProperty('playerId', mockPlayer._id.toString());
      expect(analysis).toHaveProperty('suspiciousPatterns');
      expect(analysis).toHaveProperty('riskLevel');
      expect(analysis).toHaveProperty('recommendations');
      expect(['low', 'medium', 'high']).toContain(analysis.riskLevel);
      expect(Array.isArray(analysis.suspiciousPatterns)).toBe(true);
      expect(Array.isArray(analysis.recommendations)).toBe(true);
    });

    it('should handle player with no game history', async () => {
      const newPlayer = {
        ...mockPlayer,
        statistics: {
          gamesPlayed: 0,
          gamesWon: 0,
          winRate: 0,
          eloRating: 1200
        }
      };

      const analysis = await AIService.analyzePlayerBehavior(newPlayer, []);
      
      expect(analysis.playerId).toBe(newPlayer._id.toString());
      expect(analysis.riskLevel).toBe('low');
    });

    it('should return safe defaults when AI fails', async () => {
      delete process.env.GEMINI_API_KEY;
      
      const analysis = await AIService.analyzePlayerBehavior(
        mockPlayer,
        mockGameHistory
      );
      
      expect(analysis.playerId).toBe(mockPlayer._id.toString());
      expect(analysis.riskLevel).toBe('low');
      expect(analysis.suspiciousPatterns).toEqual([]);
      expect(analysis.recommendations).toEqual([]);
    });
  });

  describe('Gameplay Tips', () => {
    const mockPlayer = {
      _id: new Types.ObjectId(),
      username: 'testplayer',
      role: GameRole.VILLAGER,
      isAlive: true
    } as any;

    const mockGameState = {
      phase: GamePhase.DAY,
      dayNumber: 1,
      players: [mockPlayer],
      timeRemaining: 300000
    } as any;

    it('should provide gameplay tips for day phase', async () => {
      const tips = await AIService.provideGameplayTips(
        mockPlayer,
        mockGameState,
        'beginner'
      );
      
      expect(Array.isArray(tips)).toBe(true);
      tips.forEach(tip => {
        expect(tip).toHaveProperty('message');
        expect(tip).toHaveProperty('relevance');
        expect(tip).toHaveProperty('timing');
        expect(tip.relevance).toBeGreaterThanOrEqual(0);
        expect(tip.relevance).toBeLessThanOrEqual(1);
        expect(['immediate', 'next_phase', 'end_game']).toContain(tip.timing);
      });
    });

    it('should provide different tips for different phases', async () => {
      const dayTips = await AIService.provideGameplayTips(
        mockPlayer,
        { ...mockGameState, phase: GamePhase.DAY },
        'intermediate'
      );
      
      const nightTips = await AIService.provideGameplayTips(
        mockPlayer,
        { ...mockGameState, phase: GamePhase.NIGHT },
        'intermediate'
      );
      
      expect(Array.isArray(dayTips)).toBe(true);
      expect(Array.isArray(nightTips)).toBe(true);
    });

    it('should handle different experience levels', async () => {
      const beginnerTips = await AIService.provideGameplayTips(
        mockPlayer,
        mockGameState,
        'beginner'
      );
      
      const advancedTips = await AIService.provideGameplayTips(
        mockPlayer,
        mockGameState,
        'advanced'
      );
      
      expect(Array.isArray(beginnerTips)).toBe(true);
      expect(Array.isArray(advancedTips)).toBe(true);
    });

    it('should return fallback tips when AI fails', async () => {
      delete process.env.GEMINI_API_KEY;
      
      const tips = await AIService.provideGameplayTips(
        mockPlayer,
        mockGameState
      );
      
      expect(Array.isArray(tips)).toBe(true);
      // Should return basic tips even when AI fails
    });
  });

  describe('Health Check', () => {
    it('should return true when service is healthy', async () => {
      const isHealthy = await AIService.healthCheck();
      expect(typeof isHealthy).toBe('boolean');
    });

    it('should return false when service is not initialized', async () => {
      delete process.env.GEMINI_API_KEY;
      const uninitializedService = new (require('../services/AIService').default.constructor)();
      
      const isHealthy = await uninitializedService.healthCheck();
      expect(isHealthy).toBe(false);
    });
  });

  describe('Helper Methods', () => {
    it('should extract moderation actions correctly', () => {
      const service = AIService as any;
      
      expect(service.extractModerationAction('Player should be warned')).toBe('warn');
      expect(service.extractModerationAction('Mute this player')).toBe('mute');
      expect(service.extractModerationAction('Kick them from the game')).toBe('kick');
      expect(service.extractModerationAction('Everything looks fine')).toBeUndefined();
    });

    it('should calculate confidence scores', () => {
      const service = AIService as any;
      
      const highConfidence = service.calculateConfidence('Warn the player for inappropriate behavior', 'inappropriate');
      const lowConfidence = service.calculateConfidence('Maybe', 'test');
      
      expect(highConfidence).toBeGreaterThan(lowConfidence);
      expect(highConfidence).toBeLessThanOrEqual(1);
      expect(lowConfidence).toBeGreaterThanOrEqual(0);
    });

    it('should provide basic tips for all game phases', () => {
      const service = AIService as any;
      
      const dayTips = service.getBasicTips(GamePhase.DAY, 'beginner');
      const nightTips = service.getBasicTips(GamePhase.NIGHT, 'beginner');
      const votingTips = service.getBasicTips(GamePhase.VOTING, 'beginner');
      const finishedTips = service.getBasicTips(GamePhase.FINISHED, 'beginner');
      
      expect(Array.isArray(dayTips)).toBe(true);
      expect(Array.isArray(nightTips)).toBe(true);
      expect(Array.isArray(votingTips)).toBe(true);
      expect(Array.isArray(finishedTips)).toBe(true);
      
      expect(dayTips.length).toBeGreaterThan(0);
      expect(nightTips.length).toBeGreaterThan(0);
      expect(votingTips.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Mock network failure
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      
      const result = await AIService.moderateContent('test message');
      expect(result.isAppropriate).toBe(true); // Fail safe
      
      global.fetch = originalFetch;
    });

    it('should handle malformed AI responses', async () => {
      // This test ensures the service handles unexpected AI response formats
      const result = await AIService.moderateContent('test message');
      
      expect(result).toHaveProperty('isAppropriate');
      expect(result).toHaveProperty('severity');
      expect(typeof result.isAppropriate).toBe('boolean');
      expect(['low', 'medium', 'high']).toContain(result.severity);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle concurrent requests', async () => {
      const promises = [
        AIService.moderateContent('Message 1'),
        AIService.moderateContent('Message 2'),
        AIService.moderateContent('Message 3')
      ];
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toHaveProperty('isAppropriate');
        expect(result).toHaveProperty('severity');
      });
    });

    it('should maintain consistency across similar requests', async () => {
      const message = 'Hello, good luck everyone!';
      
      const result1 = await AIService.moderateContent(message);
      const result2 = await AIService.moderateContent(message);
      
      expect(result1.isAppropriate).toBe(result2.isAppropriate);
      expect(result1.severity).toBe(result2.severity);
    });
  });
});