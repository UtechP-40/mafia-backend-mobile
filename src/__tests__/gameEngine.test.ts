import { Types } from 'mongoose';
import { GameEngine, PlayerAction } from '../game/engine';
import { Game, GamePhase, GameEventType, WinCondition } from '../models/Game';
import { Player, GameRole } from '../models/Player';
import { GameSettings, RoleConfiguration } from '../models/Room';

// Mock the models
jest.mock('../models/Game');
jest.mock('../models/Player');

const MockedGame = Game as jest.MockedClass<typeof Game>;
const MockedPlayer = Player as jest.MockedClass<typeof Player>;

describe('GameEngine', () => {
  let gameEngine: GameEngine;
  let mockPlayers: any[];
  let mockGameSettings: GameSettings;

  beforeEach(() => {
    gameEngine = new GameEngine();
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock players
    mockPlayers = [
      {
        _id: new Types.ObjectId(),
        username: 'player1',
        role: GameRole.VILLAGER,
        toObject: () => ({ _id: new Types.ObjectId(), username: 'player1', role: GameRole.VILLAGER })
      },
      {
        _id: new Types.ObjectId(),
        username: 'player2',
        role: GameRole.VILLAGER,
        toObject: () => ({ _id: new Types.ObjectId(), username: 'player2', role: GameRole.VILLAGER })
      },
      {
        _id: new Types.ObjectId(),
        username: 'player3',
        role: GameRole.MAFIA,
        toObject: () => ({ _id: new Types.ObjectId(), username: 'player3', role: GameRole.MAFIA })
      },
      {
        _id: new Types.ObjectId(),
        username: 'player4',
        role: GameRole.DETECTIVE,
        toObject: () => ({ _id: new Types.ObjectId(), username: 'player4', role: GameRole.DETECTIVE })
      }
    ];

    // Mock game settings
    mockGameSettings = {
      maxPlayers: 8,
      enableVoiceChat: true,
      dayPhaseDuration: 300000,
      nightPhaseDuration: 120000,
      votingDuration: 60000,
      roles: [
        { role: GameRole.VILLAGER, count: 2 },
        { role: GameRole.MAFIA, count: 1 },
        { role: GameRole.DETECTIVE, count: 1 }
      ]
    };
  });

  describe('initializeGame', () => {
    it('should create a new game with correct initial state', async () => {
      const mockGame = {
        _id: new Types.ObjectId(),
        save: jest.fn().mockResolvedValue(true)
      };
      
      MockedGame.mockImplementation(() => mockGame as any);
      MockedPlayer.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

      const result = await gameEngine.initializeGame(mockPlayers, mockGameSettings);

      expect(MockedGame).toHaveBeenCalledWith(expect.objectContaining({
        phase: GamePhase.DAY,
        dayNumber: 1,
        players: expect.any(Array),
        eliminatedPlayers: [],
        votes: [],
        timeRemaining: mockGameSettings.dayPhaseDuration,
        settings: mockGameSettings
      }));
      
      expect(mockGame.save).toHaveBeenCalled();
      expect(MockedPlayer.findByIdAndUpdate).toHaveBeenCalledTimes(4);
    });

    it('should throw error with less than 4 players', async () => {
      const tooFewPlayers = mockPlayers.slice(0, 3);
      
      await expect(gameEngine.initializeGame(tooFewPlayers, mockGameSettings))
        .rejects.toThrow('Minimum 4 players required to start a game');
    });

    it('should throw error when exceeding max players', async () => {
      const tooManyPlayers = [...mockPlayers, ...mockPlayers, ...mockPlayers];
      
      await expect(gameEngine.initializeGame(tooManyPlayers, mockGameSettings))
        .rejects.toThrow('Maximum 8 players allowed');
    });

    it('should assign roles correctly', async () => {
      const mockGame = {
        _id: new Types.ObjectId(),
        save: jest.fn().mockResolvedValue(true)
      };
      
      MockedGame.mockImplementation(() => mockGame as any);
      MockedPlayer.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

      await gameEngine.initializeGame(mockPlayers, mockGameSettings);

      // Verify that roles were assigned (4 players should get roles from config)
      expect(MockedPlayer.findByIdAndUpdate).toHaveBeenCalledTimes(4);
      
      // Check that each player got a role assignment
      const calls = (MockedPlayer.findByIdAndUpdate as jest.Mock).mock.calls;
      calls.forEach(call => {
        expect(call[1]).toHaveProperty('role');
        expect(call[1]).toHaveProperty('isAlive', true);
      });
    });
  });

  describe('processPlayerAction', () => {
    let mockGame: any;

    beforeEach(() => {
      mockGame = {
        _id: new Types.ObjectId(),
        phase: GamePhase.VOTING,
        players: mockPlayers.map(p => p._id),
        eliminatedPlayers: [],
        votes: [],
        addVote: jest.fn(),
        removeVote: jest.fn(),
        addEvent: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
        history: []
      };

      MockedGame.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockGame)
      });
    });

    it('should process vote action correctly', async () => {
      const action: PlayerAction = {
        type: 'vote',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[1]._id
      };

      await gameEngine.processPlayerAction(action);

      expect(mockGame.addVote).toHaveBeenCalledWith(action.playerId, action.targetId);
      expect(mockGame.save).toHaveBeenCalled();
    });

    it('should process unvote action correctly', async () => {
      const action: PlayerAction = {
        type: 'unvote',
        playerId: mockPlayers[0]._id
      };

      await gameEngine.processPlayerAction(action);

      expect(mockGame.removeVote).toHaveBeenCalledWith(action.playerId);
      expect(mockGame.save).toHaveBeenCalled();
    });

    it('should process night action for mafia', async () => {
      mockGame.phase = GamePhase.NIGHT;
      
      const mockPlayer = {
        _id: mockPlayers[2]._id,
        role: GameRole.MAFIA
      };
      
      MockedPlayer.findById = jest.fn().mockResolvedValue(mockPlayer);

      const action: PlayerAction = {
        type: 'night_action',
        playerId: mockPlayers[2]._id,
        targetId: mockPlayers[0]._id
      };

      await gameEngine.processPlayerAction(action);

      expect(mockGame.addVote).toHaveBeenCalledWith(action.playerId, action.targetId);
      expect(mockGame.save).toHaveBeenCalled();
    });

    it('should process night action for detective', async () => {
      mockGame.phase = GamePhase.NIGHT;
      
      const mockPlayer = {
        _id: mockPlayers[3]._id,
        role: GameRole.DETECTIVE
      };
      
      MockedPlayer.findById = jest.fn().mockResolvedValue(mockPlayer);

      const action: PlayerAction = {
        type: 'night_action',
        playerId: mockPlayers[3]._id,
        targetId: mockPlayers[0]._id
      };

      await gameEngine.processPlayerAction(action);

      expect(mockGame.addEvent).toHaveBeenCalledWith(
        GameEventType.ROLE_ACTION,
        action.playerId,
        action.targetId,
        { role: GameRole.DETECTIVE, action: 'investigate' }
      );
      expect(mockGame.save).toHaveBeenCalled();
    });

    it('should throw error when game not found', async () => {
      MockedGame.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null)
      });

      const action: PlayerAction = {
        type: 'vote',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[1]._id
      };

      await expect(gameEngine.processPlayerAction(action))
        .rejects.toThrow('Game not found for player');
    });
  });

  describe('advanceGamePhase', () => {
    let mockGame: any;

    beforeEach(() => {
      mockGame = {
        _id: new Types.ObjectId(),
        phase: GamePhase.VOTING,
        dayNumber: 1,
        players: mockPlayers.map(p => p._id),
        eliminatedPlayers: [],
        votes: [
          { voterId: mockPlayers[0]._id, targetId: mockPlayers[1]._id },
          { voterId: mockPlayers[2]._id, targetId: mockPlayers[1]._id }
        ],
        history: [],
        eliminatePlayer: jest.fn(),
        advancePhase: jest.fn(),
        endGame: jest.fn(),
        save: jest.fn().mockResolvedValue(true)
      };

      MockedGame.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockGame)
      });
    });

    it('should advance from voting phase and eliminate player', async () => {
      const result = await gameEngine.advanceGamePhase(mockGame._id);

      expect(mockGame.eliminatePlayer).toHaveBeenCalled();
      expect(mockGame.advancePhase).toHaveBeenCalled();
      expect(mockGame.save).toHaveBeenCalled();
      expect(result.from).toBe(GamePhase.VOTING);
    });

    it('should process night phase eliminations', async () => {
      mockGame.phase = GamePhase.NIGHT;
      mockGame.votes = [
        { voterId: mockPlayers[2]._id, targetId: mockPlayers[0]._id } // Mafia vote
      ];

      MockedPlayer.findById = jest.fn().mockResolvedValue({
        role: GameRole.MAFIA
      });

      const result = await gameEngine.advanceGamePhase(mockGame._id);

      expect(mockGame.advancePhase).toHaveBeenCalled();
      expect(result.from).toBe(GamePhase.NIGHT);
    });

    it('should end game when win condition is met', async () => {
      // Mock a scenario where win condition is met
      mockGame.players = [mockPlayers[0]._id]; // Only one player left
      mockGame.eliminatedPlayers = mockPlayers.slice(1).map(p => p._id);

      // Mock checkWinConditions to return a win result
      const mockWinResult = {
        condition: WinCondition.VILLAGER_WIN,
        winningTeam: 'villagers' as const,
        winningPlayers: [mockPlayers[0]._id],
        reason: 'All mafia eliminated'
      };

      jest.spyOn(gameEngine, 'checkWinConditions').mockReturnValue(mockWinResult);

      await gameEngine.advanceGamePhase(mockGame._id);

      expect(mockGame.endGame).toHaveBeenCalledWith(mockWinResult);
    });
  });

  describe('checkWinConditions', () => {
    let mockGame: any;

    beforeEach(() => {
      mockGame = {
        players: mockPlayers.map(p => p._id),
        eliminatedPlayers: []
      };
    });

    it('should return draw when all players eliminated', () => {
      mockGame.eliminatedPlayers = mockGame.players;

      const result = gameEngine.checkWinConditions(mockGame);

      expect(result).toEqual({
        condition: WinCondition.DRAW,
        winningTeam: 'villagers',
        winningPlayers: [],
        reason: 'All players eliminated'
      });
    });

    it('should return mafia win when few players remain', () => {
      // Eliminate most players to trigger mafia win condition
      mockGame.eliminatedPlayers = mockGame.players.slice(0, 3);

      const result = gameEngine.checkWinConditions(mockGame);

      expect(result).toEqual({
        condition: WinCondition.MAFIA_WIN,
        winningTeam: 'mafia',
        winningPlayers: [mockGame.players[3]], // Remaining player
        reason: 'Mafia equals or outnumbers villagers'
      });
    });

    it('should return villager win when many players eliminated', () => {
      // Eliminate exactly 1/4 of players to trigger villager win
      mockGame.eliminatedPlayers = [mockGame.players[0]];

      const result = gameEngine.checkWinConditions(mockGame);

      expect(result).toEqual({
        condition: WinCondition.VILLAGER_WIN,
        winningTeam: 'villagers',
        winningPlayers: mockGame.players.slice(1), // Remaining players
        reason: 'All mafia members eliminated'
      });
    });

    it('should return null when no win condition is met', () => {
      // Normal game state - no win condition
      const result = gameEngine.checkWinConditions(mockGame);

      expect(result).toBeNull();
    });
  });

  describe('validateAction', () => {
    let mockGame: any;

    beforeEach(() => {
      mockGame = {
        phase: GamePhase.VOTING,
        players: mockPlayers.map(p => p._id),
        eliminatedPlayers: []
      };
    });

    it('should validate correct voting action', () => {
      const action: PlayerAction = {
        type: 'vote',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[1]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame)).not.toThrow();
    });

    it('should throw error for player not in game', () => {
      const action: PlayerAction = {
        type: 'vote',
        playerId: new Types.ObjectId(), // Random player not in game
        targetId: mockPlayers[1]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame))
        .toThrow('Player not in game');
    });

    it('should throw error for eliminated player action', () => {
      mockGame.eliminatedPlayers = [mockPlayers[0]._id];

      const action: PlayerAction = {
        type: 'vote',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[1]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame))
        .toThrow('Eliminated players cannot perform actions');
    });

    it('should throw error for voting in wrong phase', () => {
      mockGame.phase = GamePhase.DAY;

      const action: PlayerAction = {
        type: 'vote',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[1]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame))
        .toThrow('Voting only allowed during voting phase');
    });

    it('should throw error for night action in wrong phase', () => {
      mockGame.phase = GamePhase.DAY;

      const action: PlayerAction = {
        type: 'night_action',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[1]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame))
        .toThrow('Night actions only allowed during night phase');
    });

    it('should throw error for targeting eliminated player', () => {
      mockGame.eliminatedPlayers = [mockPlayers[1]._id];

      const action: PlayerAction = {
        type: 'vote',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[1]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame))
        .toThrow('Cannot target eliminated players');
    });

    it('should throw error for self-targeting in voting', () => {
      const action: PlayerAction = {
        type: 'vote',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[0]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame))
        .toThrow('Cannot target yourself');
    });

    it('should allow self-targeting in night actions', () => {
      mockGame.phase = GamePhase.NIGHT;

      const action: PlayerAction = {
        type: 'night_action',
        playerId: mockPlayers[0]._id,
        targetId: mockPlayers[0]._id
      };

      expect(() => gameEngine.validateAction(action, mockGame)).not.toThrow();
    });
  });

  describe('getGameState', () => {
    it('should return game state for room', async () => {
      const mockGame = {
        _id: new Types.ObjectId(),
        roomId: new Types.ObjectId(),
        phase: GamePhase.DAY
      };

      MockedGame.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(mockGame)
        })
      });

      const result = await gameEngine.getGameState(mockGame.roomId);

      expect(MockedGame.findOne).toHaveBeenCalledWith({ roomId: mockGame.roomId });
      expect(result).toBe(mockGame);
    });

    it('should return null when game not found', async () => {
      MockedGame.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null)
        })
      });

      const result = await gameEngine.getGameState(new Types.ObjectId());

      expect(result).toBeNull();
    });
  });

  describe('endGame', () => {
    it('should end game and update player statistics', async () => {
      const mockGame = {
        _id: new Types.ObjectId(),
        players: mockPlayers.map(p => p._id),
        endGame: jest.fn(),
        save: jest.fn().mockResolvedValue(true)
      };

      const mockWinResult = {
        condition: WinCondition.VILLAGER_WIN,
        winningTeam: 'villagers' as const,
        winningPlayers: [mockPlayers[0]._id],
        reason: 'Test win'
      };

      MockedGame.findById = jest.fn().mockResolvedValue(mockGame);
      
      // Mock player updates
      const mockPlayerUpdates = mockPlayers.map(player => ({
        ...player,
        statistics: { gamesPlayed: 0, gamesWon: 0 },
        save: jest.fn().mockResolvedValue(true)
      }));
      
      MockedPlayer.findById = jest.fn()
        .mockResolvedValueOnce(mockPlayerUpdates[0])
        .mockResolvedValueOnce(mockPlayerUpdates[1])
        .mockResolvedValueOnce(mockPlayerUpdates[2])
        .mockResolvedValueOnce(mockPlayerUpdates[3]);

      await gameEngine.endGame(mockGame._id, mockWinResult);

      expect(mockGame.endGame).toHaveBeenCalledWith(mockWinResult);
      expect(mockGame.save).toHaveBeenCalled();
      
      // Verify player statistics were updated
      mockPlayerUpdates.forEach(player => {
        expect(player.save).toHaveBeenCalled();
        expect(player.statistics.gamesPlayed).toBe(1);
      });
    });

    it('should throw error when game not found', async () => {
      MockedGame.findById = jest.fn().mockResolvedValue(null);

      const mockWinResult = {
        condition: WinCondition.VILLAGER_WIN,
        winningTeam: 'villagers' as const,
        winningPlayers: [],
        reason: 'Test'
      };

      await expect(gameEngine.endGame(new Types.ObjectId(), mockWinResult))
        .rejects.toThrow('Game not found');
    });
  });
});