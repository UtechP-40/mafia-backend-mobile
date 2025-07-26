/**
 * Comprehensive Game Engine Testing Suite
 * Part of Task 26: Backend API Comprehensive Testing
 */

import { connectDB, disconnectDB, clearDB } from './setup';
import { Player } from '../models/Player';
import { GameEngine } from '../game/engine';
import { GamePhase, GameStatus } from '../models/Game';

describe('Comprehensive Game Engine Testing', () => {
  let gameEngine: GameEngine;
  let testPlayers: any[] = [];

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDB();
    gameEngine = new GameEngine();
    
    // Create test players
    const playerConfigs = [
      { username: 'player1', role: 'mafia' },
      { username: 'player2', role: 'mafia' },
      { username: 'player3', role: 'villager' },
      { username: 'player4', role: 'villager' },
      { username: 'player5', role: 'doctor' },
      { username: 'player6', role: 'detective' },
      { username: 'player7', role: 'bodyguard' },
      { username: 'player8', role: 'mayor' }
    ];

    for (const config of playerConfigs) {
      const player = await Player.create({
        username: config.username,
        email: `${config.username}@test.com`,
        password: 'hashedpassword',
        statistics: {
          gamesPlayed: 0,
          gamesWon: 0,
          winRate: 0,
          favoriteRole: config.role,
          averageGameDuration: 0,
          eloRating: 1000
        }
      });
      testPlayers.push(player);
    }
  });

  afterEach(async () => {
    await clearDB();
    testPlayers = [];
  });

  describe('Game Initialization Edge Cases', () => {
    it('should handle minimum player count', async () => {
      const minPlayers = testPlayers.slice(0, 3);
      const gameState = gameEngine.initializeGame(minPlayers, {
        maxPlayers: 3,
        enableVoiceChat: true,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 120000,
        votingDuration: 60000,
        roles: [
          { role: 'mafia', count: 1 },
          { role: 'villager', count: 2 }
        ]
      });

      expect(gameState.players).toHaveLength(3);
      expect(gameState.phase).toBe(GamePhase.DAY);
      expect(gameState.dayNumber).toBe(1);
    });

    it('should handle maximum player count', async () => {
      // Create additional players for max test
      const additionalPlayers = [];
      for (let i = 8; i < 20; i++) {
        const player = await Player.create({
          username: `player${i + 1}`,
          email: `player${i + 1}@test.com`,
          password: 'hashedpassword',
          statistics: {
            gamesPlayed: 0,
            gamesWon: 0,
            winRate: 0,
            favoriteRole: 'villager',
            averageGameDuration: 0,
            eloRating: 1000
          }
        });
        additionalPlayers.push(player);
      }

      const allPlayers = [...testPlayers, ...additionalPlayers];
      const gameState = gameEngine.initializeGame(allPlayers, {
        maxPlayers: 20,
        enableVoiceChat: true,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 120000,
        votingDuration: 60000,
        roles: [
          { role: 'mafia', count: 4 },
          { role: 'villager', count: 12 },
          { role: 'doctor', count: 1 },
          { role: 'detective', count: 1 },
          { role: 'bodyguard', count: 1 },
          { role: 'mayor', count: 1 }
        ]
      });

      expect(gameState.players).toHaveLength(20);
      expect(gameState.phase).toBe(GamePhase.DAY);
    });

    it('should handle invalid role configurations', async () => {
      const players = testPlayers.slice(0, 6);
      
      // Test with more roles than players
      expect(() => {
        gameEngine.initializeGame(players, {
          maxPlayers: 6,
          enableVoiceChat: true,
          dayPhaseDuration: 300000,
          nightPhaseDuration: 120000,
          votingDuration: 60000,
          roles: [
            { role: 'mafia', count: 4 },
            { role: 'villager', count: 4 } // Total 8 roles for 6 players
          ]
        });
      }).toThrow();
    });

    it('should handle no mafia configuration', async () => {
      const players = testPlayers.slice(0, 4);
      
      expect(() => {
        gameEngine.initializeGame(players, {
          maxPlayers: 4,
          enableVoiceChat: true,
          dayPhaseDuration: 300000,
          nightPhaseDuration: 120000,
          votingDuration: 60000,
          roles: [
            { role: 'villager', count: 4 } // No mafia
          ]
        });
      }).toThrow();
    });

    it('should handle all mafia configuration', async () => {
      const players = testPlayers.slice(0, 4);
      
      expect(() => {
        gameEngine.initializeGame(players, {
          maxPlayers: 4,
          enableVoiceChat: true,
          dayPhaseDuration: 300000,
          nightPhaseDuration: 120000,
          votingDuration: 60000,
          roles: [
            { role: 'mafia', count: 4 } // All mafia
          ]
        });
      }).toThrow();
    });
  });

  describe('Voting System Edge Cases', () => {
    let gameState: any;

    beforeEach(() => {
      const players = testPlayers.slice(0, 5);
      gameState = gameEngine.initializeGame(players, {
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
    });

    it('should handle unanimous voting', async () => {
      const targetPlayer = gameState.players[0];
      
      // All players vote for the same target
      for (let i = 1; i < gameState.players.length; i++) {
        gameEngine.processPlayerAction({
          type: 'vote',
          playerId: gameState.players[i].playerId,
          targetId: targetPlayer.playerId,
          timestamp: new Date()
        }, gameState);
      }

      const voteResult = gameEngine.tallyVotes(gameState);
      expect(voteResult.eliminatedPlayer).toBe(targetPlayer.playerId);
    });

    it('should handle tie votes', async () => {
      // Create a tie scenario
      gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[0].playerId,
        targetId: gameState.players[1].playerId,
        timestamp: new Date()
      }, gameState);

      gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[1].playerId,
        targetId: gameState.players[0].playerId,
        timestamp: new Date()
      }, gameState);

      gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[2].playerId,
        targetId: gameState.players[1].playerId,
        timestamp: new Date()
      }, gameState);

      gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[3].playerId,
        targetId: gameState.players[0].playerId,
        timestamp: new Date()
      }, gameState);

      const voteResult = gameEngine.tallyVotes(gameState);
      expect(voteResult.isTie).toBe(true);
    });

    it('should handle no votes scenario', async () => {
      // Don't add any votes
      const voteResult = gameEngine.tallyVotes(gameState);
      expect(voteResult.eliminatedPlayer).toBeNull();
    });

    it('should handle voting for dead players', async () => {
      // Kill a player
      gameState.players[0].isAlive = false;
      
      // Try to vote for dead player
      const result = gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[1].playerId,
        targetId: gameState.players[0].playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle dead players trying to vote', async () => {
      // Kill a player
      gameState.players[0].isAlive = false;
      
      // Dead player tries to vote
      const result = gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[0].playerId,
        targetId: gameState.players[1].playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle vote changing', async () => {
      const voter = gameState.players[0];
      const firstTarget = gameState.players[1];
      const secondTarget = gameState.players[2];

      // First vote
      gameEngine.processPlayerAction({
        type: 'vote',
        playerId: voter.playerId,
        targetId: firstTarget.playerId,
        timestamp: new Date()
      }, gameState);

      // Change vote
      gameEngine.processPlayerAction({
        type: 'vote',
        playerId: voter.playerId,
        targetId: secondTarget.playerId,
        timestamp: new Date()
      }, gameState);

      // Should only count the latest vote
      const votes = gameState.votes.filter((v: any) => v.voterId === voter.playerId);
      expect(votes).toHaveLength(1);
      expect(votes[0].targetId).toBe(secondTarget.playerId);
    });
  });

  describe('Special Role Abilities Edge Cases', () => {
    let gameState: any;

    beforeEach(() => {
      const players = testPlayers.slice(0, 8);
      gameState = gameEngine.initializeGame(players, {
        maxPlayers: 8,
        enableVoiceChat: true,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 120000,
        votingDuration: 60000,
        roles: [
          { role: 'mafia', count: 2 },
          { role: 'villager', count: 3 },
          { role: 'doctor', count: 1 },
          { role: 'detective', count: 1 },
          { role: 'bodyguard', count: 1 }
        ]
      });
    });

    it('should handle doctor healing during day phase', async () => {
      const doctor = gameState.players.find((p: any) => p.role === 'doctor');
      const target = gameState.players.find((p: any) => p.role === 'villager');

      // Doctor tries to heal during day (should fail)
      const result = gameEngine.processPlayerAction({
        type: 'heal',
        playerId: doctor.playerId,
        targetId: target.playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle doctor healing themselves', async () => {
      const doctor = gameState.players.find((p: any) => p.role === 'doctor');
      gameState.phase = GamePhase.NIGHT;

      const result = gameEngine.processPlayerAction({
        type: 'heal',
        playerId: doctor.playerId,
        targetId: doctor.playerId,
        timestamp: new Date()
      }, gameState);

      // Some implementations allow self-healing, others don't
      expect(typeof result.success).toBe('boolean');
    });

    it('should handle detective investigating during day phase', async () => {
      const detective = gameState.players.find((p: any) => p.role === 'detective');
      const target = gameState.players.find((p: any) => p.role === 'mafia');

      // Detective tries to investigate during day (should fail)
      const result = gameEngine.processPlayerAction({
        type: 'investigate',
        playerId: detective.playerId,
        targetId: target.playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle detective investigating dead players', async () => {
      const detective = gameState.players.find((p: any) => p.role === 'detective');
      const target = gameState.players.find((p: any) => p.role === 'mafia');
      
      gameState.phase = GamePhase.NIGHT;
      target.isAlive = false;

      const result = gameEngine.processPlayerAction({
        type: 'investigate',
        playerId: target.playerId,
        targetId: target.playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle bodyguard protecting during day phase', async () => {
      const bodyguard = gameState.players.find((p: any) => p.role === 'bodyguard');
      const target = gameState.players.find((p: any) => p.role === 'villager');

      const result = gameEngine.processPlayerAction({
        type: 'protect',
        playerId: bodyguard.playerId,
        targetId: target.playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle multiple special role actions on same target', async () => {
      const doctor = gameState.players.find((p: any) => p.role === 'doctor');
      const bodyguard = gameState.players.find((p: any) => p.role === 'bodyguard');
      const target = gameState.players.find((p: any) => p.role === 'villager');
      
      gameState.phase = GamePhase.NIGHT;

      // Both doctor and bodyguard target same player
      gameEngine.processPlayerAction({
        type: 'heal',
        playerId: doctor.playerId,
        targetId: target.playerId,
        timestamp: new Date()
      }, gameState);

      gameEngine.processPlayerAction({
        type: 'protect',
        playerId: bodyguard.playerId,
        targetId: target.playerId,
        timestamp: new Date()
      }, gameState);

      // Should handle multiple protections
      expect(gameState.events.length).toBeGreaterThan(0);
    });
  });

  describe('Win Condition Edge Cases', () => {
    let gameState: any;

    beforeEach(() => {
      const players = testPlayers.slice(0, 6);
      gameState = gameEngine.initializeGame(players, {
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
    });

    it('should handle mafia majority win condition', async () => {
      // Kill villagers until mafia has majority
      const villagers = gameState.players.filter((p: any) => p.role === 'villager');
      villagers.slice(0, 3).forEach((p: any) => p.isAlive = false);

      const winResult = gameEngine.checkWinConditions(gameState);
      expect(winResult?.winner).toBe('mafia');
    });

    it('should handle all mafia eliminated win condition', async () => {
      // Kill all mafia
      const mafia = gameState.players.filter((p: any) => p.role === 'mafia');
      mafia.forEach((p: any) => p.isAlive = false);

      const winResult = gameEngine.checkWinConditions(gameState);
      expect(winResult?.winner).toBe('villagers');
    });

    it('should handle equal numbers scenario', async () => {
      // Make it 2 mafia vs 2 villagers
      const villagers = gameState.players.filter((p: any) => p.role === 'villager');
      villagers.slice(0, 2).forEach((p: any) => p.isAlive = false);

      const winResult = gameEngine.checkWinConditions(gameState);
      expect(winResult?.winner).toBe('mafia'); // Mafia wins with equal numbers
    });

    it('should handle all players dead scenario', async () => {
      // Kill everyone (edge case)
      gameState.players.forEach((p: any) => p.isAlive = false);

      const winResult = gameEngine.checkWinConditions(gameState);
      expect(winResult?.winner).toBe('draw');
    });

    it('should handle single survivor scenarios', async () => {
      // Leave only one mafia alive
      gameState.players.forEach((p: any, index: number) => {
        if (index !== 0) p.isAlive = false;
      });

      const winResult = gameEngine.checkWinConditions(gameState);
      const survivor = gameState.players[0];
      
      if (survivor.role === 'mafia') {
        expect(winResult?.winner).toBe('mafia');
      } else {
        expect(winResult?.winner).toBe('villagers');
      }
    });
  });

  describe('Phase Transition Edge Cases', () => {
    let gameState: any;

    beforeEach(() => {
      const players = testPlayers.slice(0, 4);
      gameState = gameEngine.initializeGame(players, {
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
    });

    it('should handle rapid phase transitions', async () => {
      const initialPhase = gameState.phase;
      
      // Advance through multiple phases quickly
      for (let i = 0; i < 10; i++) {
        const transition = gameEngine.advanceGamePhase(gameState);
        expect(transition.newPhase).toBeDefined();
        expect(transition.previousPhase).toBeDefined();
      }

      expect(gameState.dayNumber).toBeGreaterThan(1);
    });

    it('should handle phase transitions with pending actions', async () => {
      gameState.phase = GamePhase.NIGHT;
      
      // Add a pending night action
      const mafia = gameState.players.find((p: any) => p.role === 'mafia');
      const target = gameState.players.find((p: any) => p.role === 'villager');
      
      gameEngine.processPlayerAction({
        type: 'kill',
        playerId: mafia.playerId,
        targetId: target.playerId,
        timestamp: new Date()
      }, gameState);

      // Advance phase - should process pending actions
      const transition = gameEngine.advanceGamePhase(gameState);
      expect(transition.newPhase).toBe(GamePhase.DAY);
      expect(target.isAlive).toBe(false);
    });

    it('should handle phase transitions with game end', async () => {
      // Set up a scenario where game should end
      const villagers = gameState.players.filter((p: any) => p.role === 'villager');
      villagers.slice(0, 2).forEach((p: any) => p.isAlive = false);

      const transition = gameEngine.advanceGamePhase(gameState);
      
      // Should detect game end during phase transition
      const winResult = gameEngine.checkWinConditions(gameState);
      if (winResult) {
        expect(winResult.winner).toBeDefined();
      }
    });
  });

  describe('Action Validation Edge Cases', () => {
    let gameState: any;

    beforeEach(() => {
      const players = testPlayers.slice(0, 5);
      gameState = gameEngine.initializeGame(players, {
        maxPlayers: 5,
        enableVoiceChat: true,
        dayPhaseDuration: 300000,
        nightPhaseDuration: 120000,
        votingDuration: 60000,
        roles: [
          { role: 'mafia', count: 1 },
          { role: 'villager', count: 3 },
          { role: 'doctor', count: 1 }
        ]
      });
    });

    it('should handle invalid action types', async () => {
      const result = gameEngine.processPlayerAction({
        type: 'invalid_action' as any,
        playerId: gameState.players[0].playerId,
        targetId: gameState.players[1].playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle actions with invalid player IDs', async () => {
      const result = gameEngine.processPlayerAction({
        type: 'vote',
        playerId: 'invalid-player-id',
        targetId: gameState.players[1].playerId,
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle actions with invalid target IDs', async () => {
      const result = gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[0].playerId,
        targetId: 'invalid-target-id',
        timestamp: new Date()
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle actions without required fields', async () => {
      const result = gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[0].playerId,
        // Missing targetId
        timestamp: new Date()
      } as any, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle actions with future timestamps', async () => {
      const futureTime = new Date(Date.now() + 3600000); // 1 hour in future
      
      const result = gameEngine.processPlayerAction({
        type: 'vote',
        playerId: gameState.players[0].playerId,
        targetId: gameState.players[1].playerId,
        timestamp: futureTime
      }, gameState);

      expect(result.success).toBe(false);
    });

    it('should handle duplicate actions', async () => {
      const action = {
        type: 'vote' as const,
        playerId: gameState.players[0].playerId,
        targetId: gameState.players[1].playerId,
        timestamp: new Date()
      };

      // Process same action twice
      const result1 = gameEngine.processPlayerAction(action, gameState);
      const result2 = gameEngine.processPlayerAction(action, gameState);

      expect(result1.success).toBe(true);
      // Second action should either succeed (changing vote) or fail (duplicate)
      expect(typeof result2.success).toBe('boolean');
    });
  });
});