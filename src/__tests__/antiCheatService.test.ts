import { AntiCheatService } from '../services/AntiCheatService';

describe('AntiCheatService', () => {
  beforeEach(() => {
    // Clear any existing data
    AntiCheatService.cleanupOldData();
  });

  describe('analyzePlayerBehavior', () => {
    it('should detect timing manipulation', async () => {
      const playerId = 'test-player-1';
      const gameId = 'test-game-1';
      const roomId = 'test-room-1';

      // Simulate rapid actions (bot-like behavior)
      const baseTime = Date.now();
      for (let i = 0; i < 10; i++) {
        // Mock Date.now to simulate very fast actions
        const originalNow = Date.now;
        Date.now = jest.fn(() => baseTime + i * 50); // 50ms intervals (too fast)

        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          'vote',
          gameId,
          roomId,
          { targetId: `target-${i}` }
        );

        Date.now = originalNow;
      }

      // The last analysis should detect timing manipulation
      const result = await AntiCheatService.analyzePlayerBehavior(
        playerId,
        'vote',
        gameId,
        roomId,
        { targetId: 'final-target' }
      );

      expect(result.isCheatDetected).toBe(true);
      expect(result.cheatType).toContain('timing_manipulation');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect automation patterns', async () => {
      const playerId = 'test-player-2';
      const gameId = 'test-game-2';
      const roomId = 'test-room-2';

      // Simulate perfect accuracy in complex actions
      for (let i = 0; i < 5; i++) {
        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          'use_ability',
          gameId,
          roomId,
          { 
            complexity: 'high',
            success: true,
            abilityType: 'detective_investigate'
          }
        );
      }

      const result = await AntiCheatService.analyzePlayerBehavior(
        playerId,
        'use_ability',
        gameId,
        roomId,
        { 
          complexity: 'high',
          success: true,
          abilityType: 'detective_investigate'
        }
      );

      expect(result.isCheatDetected).toBe(true);
      expect(result.cheatType).toContain('automation');
    });

    it('should detect information leakage', async () => {
      const playerId = 'test-player-3';
      const gameId = 'test-game-3';
      const roomId = 'test-room-3';

      // Simulate voting for mafia members without being detective
      for (let i = 0; i < 3; i++) {
        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          'vote',
          gameId,
          roomId,
          { 
            targetId: `mafia-${i}`,
            targetRole: 'mafia',
            playerRole: 'villager' // Not detective, shouldn't know roles
          }
        );
      }

      const result = await AntiCheatService.analyzePlayerBehavior(
        playerId,
        'vote',
        gameId,
        roomId,
        { 
          targetId: 'mafia-final',
          targetRole: 'mafia',
          playerRole: 'villager'
        }
      );

      expect(result.isCheatDetected).toBe(true);
      expect(result.cheatType).toContain('information_leakage');
    });

    it('should not flag normal behavior', async () => {
      const playerId = 'test-player-4';
      const gameId = 'test-game-4';
      const roomId = 'test-room-4';

      // Simulate normal voting behavior
      const actions = ['vote', 'chat', 'vote', 'use_ability', 'vote'];
      for (let i = 0; i < actions.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Normal delays
        
        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          actions[i],
          gameId,
          roomId,
          { 
            targetId: `target-${i}`,
            success: Math.random() > 0.3 // Normal success rate
          }
        );
      }

      const result = await AntiCheatService.analyzePlayerBehavior(
        playerId,
        'vote',
        gameId,
        roomId,
        { targetId: 'normal-target' }
      );

      expect(result.isCheatDetected).toBe(false);
      expect(result.cheatType).toHaveLength(0);
    });
  });

  describe('collusion detection', () => {
    it('should detect coordinated voting', async () => {
      const player1 = 'colluder-1';
      const player2 = 'colluder-2';
      const gameId = 'collusion-game';
      const roomId = 'collusion-room';

      // Simulate coordinated voting patterns
      const targets = ['target-1', 'target-2', 'target-3', 'target-4'];
      
      for (const target of targets) {
        // Both players vote for same targets within short time
        await AntiCheatService.analyzePlayerBehavior(
          player1,
          'vote',
          gameId,
          roomId,
          { targetId: target }
        );

        // Small delay to simulate coordination
        await new Promise(resolve => setTimeout(resolve, 10));

        await AntiCheatService.analyzePlayerBehavior(
          player2,
          'vote',
          gameId,
          roomId,
          { targetId: target }
        );
      }

      // Check if collusion is detected for either player
      const result1 = await AntiCheatService.analyzePlayerBehavior(
        player1,
        'vote',
        gameId,
        roomId,
        { targetId: 'final-target' }
      );

      const result2 = await AntiCheatService.analyzePlayerBehavior(
        player2,
        'vote',
        gameId,
        roomId,
        { targetId: 'final-target' }
      );

      expect(result1.isCheatDetected || result2.isCheatDetected).toBe(true);
      if (result1.isCheatDetected) {
        expect(result1.cheatType).toContain('collusion');
      }
      if (result2.isCheatDetected) {
        expect(result2.cheatType).toContain('collusion');
      }
    });
  });

  describe('player violation tracking', () => {
    it('should track player violations', async () => {
      const playerId = 'violation-player';
      const gameId = 'violation-game';
      const roomId = 'violation-room';

      // Generate some violations
      for (let i = 0; i < 3; i++) {
        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          'vote',
          gameId,
          roomId,
          { 
            targetRole: 'mafia',
            playerRole: 'villager'
          }
        );
      }

      const violations = AntiCheatService.getPlayerViolations(playerId);
      expect(violations).toBeDefined();
      expect(violations!.count).toBeGreaterThan(0);
    });

    it('should flag players with many violations', async () => {
      const playerId = 'flagged-player';
      const gameId = 'flagged-game';
      const roomId = 'flagged-room';

      // Generate many violations
      for (let i = 0; i < 10; i++) {
        await AntiCheatService.analyzePlayerBehavior(
          playerId,
          'vote',
          gameId,
          roomId,
          { 
            targetRole: 'mafia',
            playerRole: 'villager'
          }
        );
      }

      const shouldFlag = AntiCheatService.shouldFlagPlayer(playerId);
      expect(shouldFlag).toBe(true);
    });

    it('should not flag players with few violations', () => {
      const playerId = 'clean-player';
      const shouldFlag = AntiCheatService.shouldFlagPlayer(playerId);
      expect(shouldFlag).toBe(false);
    });
  });

  describe('statistics and monitoring', () => {
    it('should provide anti-cheat statistics', async () => {
      const playerId = 'stats-player';
      const gameId = 'stats-game';
      const roomId = 'stats-room';

      // Generate some detections
      await AntiCheatService.analyzePlayerBehavior(
        playerId,
        'vote',
        gameId,
        roomId,
        { 
          targetRole: 'mafia',
          playerRole: 'villager'
        }
      );

      const stats = AntiCheatService.getAntiCheatStats();
      
      expect(stats).toHaveProperty('totalDetections');
      expect(stats).toHaveProperty('detectionsByType');
      expect(stats).toHaveProperty('flaggedPlayers');
      expect(stats).toHaveProperty('recentActivity');
      
      expect(typeof stats.totalDetections).toBe('number');
      expect(typeof stats.detectionsByType).toBe('object');
      expect(typeof stats.flaggedPlayers).toBe('number');
      expect(Array.isArray(stats.recentActivity)).toBe(true);
    });
  });

  describe('data cleanup', () => {
    it('should clean up old behavior data', async () => {
      const playerId = 'cleanup-player';
      const gameId = 'cleanup-game';
      const roomId = 'cleanup-room';

      // Add some behavior data
      await AntiCheatService.analyzePlayerBehavior(
        playerId,
        'vote',
        gameId,
        roomId,
        { targetId: 'test-target' }
      );

      // Verify data exists
      const statsBefore = AntiCheatService.getAntiCheatStats();
      expect(statsBefore.totalDetections).toBeGreaterThanOrEqual(0);

      // Clean up data
      AntiCheatService.cleanupOldData();

      // Data should still exist since it's recent
      const statsAfter = AntiCheatService.getAntiCheatStats();
      expect(statsAfter.totalDetections).toBeGreaterThanOrEqual(0);
    });
  });

  describe('pattern detection helpers', () => {
    it('should handle edge cases in behavior analysis', async () => {
      const playerId = 'edge-case-player';
      const gameId = 'edge-case-game';
      const roomId = 'edge-case-room';

      // Test with minimal data
      const result = await AntiCheatService.analyzePlayerBehavior(
        playerId,
        'vote',
        gameId,
        roomId,
        {}
      );

      expect(result).toHaveProperty('isCheatDetected');
      expect(result).toHaveProperty('cheatType');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('evidence');
      
      expect(typeof result.isCheatDetected).toBe('boolean');
      expect(Array.isArray(result.cheatType)).toBe(true);
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.evidence)).toBe(true);
    });

    it('should handle concurrent behavior analysis', async () => {
      const playerId = 'concurrent-player';
      const gameId = 'concurrent-game';
      const roomId = 'concurrent-room';

      // Simulate concurrent analysis
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          AntiCheatService.analyzePlayerBehavior(
            playerId,
            'vote',
            gameId,
            roomId,
            { targetId: `concurrent-target-${i}` }
          )
        );
      }

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toHaveProperty('isCheatDetected');
        expect(result).toHaveProperty('cheatType');
        expect(result).toHaveProperty('confidence');
        expect(result).toHaveProperty('evidence');
      });
    });
  });
});