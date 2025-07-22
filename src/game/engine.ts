import { Types } from 'mongoose';
import { Game, IGame, GamePhase, GameEventType, WinCondition, WinResult, Vote } from '../models/Game';
import { Player, IPlayer, GameRole } from '../models/Player';
import { Room, IRoom, GameSettings, RoleConfiguration } from '../models/Room';

export interface PlayerAction {
  type: 'vote' | 'unvote' | 'night_action' | 'skip';
  playerId: Types.ObjectId;
  targetId?: Types.ObjectId;
  data?: any;
}

export interface GameStateUpdate {
  gameId: Types.ObjectId;
  phase: GamePhase;
  dayNumber: number;
  timeRemaining: number;
  players: any[];
  eliminatedPlayers: any[];
  votes: Vote[];
  events: any[];
}

export interface PhaseTransition {
  from: GamePhase;
  to: GamePhase;
  dayNumber: number;
  timeRemaining: number;
  eliminatedPlayers?: Types.ObjectId[];
  events: any[];
}

export class GameEngine {
  /**
   * Initialize a new game with players and settings
   */
  async initializeGame(players: IPlayer[], settings: GameSettings): Promise<IGame> {
    // Validate minimum players
    if (players.length < 4) {
      throw new Error('Minimum 4 players required to start a game');
    }

    // Validate maximum players
    if (players.length > settings.maxPlayers) {
      throw new Error(`Maximum ${settings.maxPlayers} players allowed`);
    }

    // Assign roles to players
    const playersWithRoles = await this.assignRoles(players, settings.roles);

    // Create game state
    const gameData = {
      roomId: new Types.ObjectId(), // This will be set by the calling service
      phase: GamePhase.DAY,
      dayNumber: 1,
      players: playersWithRoles.map(p => p._id),
      eliminatedPlayers: [],
      votes: [],
      timeRemaining: settings.dayPhaseDuration,
      settings,
      history: [{
        type: GameEventType.GAME_START,
        timestamp: new Date(),
        phase: GamePhase.DAY,
        dayNumber: 1,
        data: {
          playerCount: players.length,
          roles: settings.roles
        }
      }]
    };

    const game = new Game(gameData);
    await game.save();

    // Update player roles in database
    for (const player of playersWithRoles) {
      await Player.findByIdAndUpdate(player._id, { 
        role: player.role,
        isAlive: true 
      });
    }

    return game;
  }

  /**
   * Assign roles to players based on configuration
   */
  private async assignRoles(players: IPlayer[], roleConfig: RoleConfiguration[]): Promise<IPlayer[]> {
    // Validate role configuration
    const totalRoles = roleConfig.reduce((sum, config) => sum + config.count, 0);
    if (totalRoles !== players.length) {
      throw new Error('Role configuration does not match player count');
    }

    // Create role pool
    const rolePool: GameRole[] = [];
    for (const config of roleConfig) {
      for (let i = 0; i < config.count; i++) {
        rolePool.push(config.role);
      }
    }

    // Shuffle roles
    for (let i = rolePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
    }

    // Assign roles to players
    const playersWithRoles = players.map((player, index) => ({
      ...player.toObject(),
      role: rolePool[index]
    }));

    return playersWithRoles;
  }

  /**
   * Process a player action and update game state
   */
  async processPlayerAction(action: PlayerAction): Promise<GameStateUpdate> {
    const game = await Game.findOne({ players: action.playerId }).populate('players');
    if (!game) {
      throw new Error('Game not found for player');
    }

    // Validate action
    this.validateAction(action, game);

    let stateChanged = false;

    switch (action.type) {
      case 'vote':
        if (game.phase === GamePhase.VOTING && action.targetId) {
          (game as any).addVote(action.playerId, action.targetId);
          stateChanged = true;
        }
        break;

      case 'unvote':
        if (game.phase === GamePhase.VOTING) {
          (game as any).removeVote(action.playerId);
          stateChanged = true;
        }
        break;

      case 'night_action':
        if (game.phase === GamePhase.NIGHT) {
          // Handle special role actions during night phase
          await this.processNightAction(game, action);
          stateChanged = true;
        }
        break;

      case 'skip':
        // Player chooses to skip their action
        stateChanged = true;
        break;
    }

    if (stateChanged) {
      await game.save();
    }

    return this.createGameStateUpdate(game);
  }

  /**
   * Process night phase actions for special roles
   */
  private async processNightAction(game: IGame, action: PlayerAction): Promise<void> {
    const player = await Player.findById(action.playerId);
    if (!player || !player.role) {
      throw new Error('Player or role not found');
    }

    switch (player.role) {
      case GameRole.MAFIA:
        // Mafia elimination vote
        if (action.targetId) {
          (game as any).addVote(action.playerId, action.targetId);
        }
        break;

      case GameRole.DETECTIVE:
        // Detective investigation
        if (action.targetId) {
          (game as any).addEvent(GameEventType.ROLE_ACTION, action.playerId, action.targetId, {
            role: GameRole.DETECTIVE,
            action: 'investigate'
          });
        }
        break;

      case GameRole.DOCTOR:
        // Doctor protection
        if (action.targetId) {
          (game as any).addEvent(GameEventType.ROLE_ACTION, action.playerId, action.targetId, {
            role: GameRole.DOCTOR,
            action: 'protect'
          });
        }
        break;
    }
  }

  /**
   * Advance to the next game phase
   */
  async advanceGamePhase(gameId: Types.ObjectId): Promise<PhaseTransition> {
    const game = await Game.findById(gameId).populate('players');
    if (!game) {
      throw new Error('Game not found');
    }

    const previousPhase = game.phase;
    const eliminatedPlayers: Types.ObjectId[] = [];

    // Process current phase before advancing
    switch (game.phase) {
      case GamePhase.VOTING:
        // Process voting results
        const votingResults = this.tallyVotes(game);
        if (votingResults.eliminatedPlayer) {
          (game as any).eliminatePlayer(votingResults.eliminatedPlayer, 'Voted out');
          eliminatedPlayers.push(votingResults.eliminatedPlayer);
        }
        break;

      case GamePhase.NIGHT:
        // Process night actions
        const nightResults = await this.processNightPhase(game);
        eliminatedPlayers.push(...nightResults.eliminatedPlayers);
        break;
    }

    // Advance phase
    (game as any).advancePhase();
    await game.save();

    // Check win conditions after phase change
    const winResult = this.checkWinConditions(game);
    if (winResult) {
      (game as any).endGame(winResult);
      await game.save();
    }

    return {
      from: previousPhase,
      to: game.phase,
      dayNumber: game.dayNumber,
      timeRemaining: game.timeRemaining,
      eliminatedPlayers,
      events: game.history.slice(-5) // Return last 5 events
    };
  }

  /**
   * Tally votes and determine elimination
   */
  private tallyVotes(game: IGame): { eliminatedPlayer?: Types.ObjectId; voteCount: Map<string, number> } {
    const voteCount = new Map<string, number>();
    
    // Count votes
    for (const vote of game.votes) {
      const targetId = vote.targetId.toString();
      voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
    }

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedPlayer: Types.ObjectId | undefined;
    let tieCount = 0;

    for (const [playerId, votes] of voteCount.entries()) {
      if (votes > maxVotes) {
        maxVotes = votes;
        eliminatedPlayer = new Types.ObjectId(playerId);
        tieCount = 1;
      } else if (votes === maxVotes && votes > 0) {
        tieCount++;
      }
    }

    // Handle ties - no elimination if tied
    if (tieCount > 1) {
      eliminatedPlayer = undefined;
    }

    // Require majority vote for elimination
    const alivePlayers = game.players.filter(p => 
      !game.eliminatedPlayers.some(ep => ep.equals(p))
    );
    const requiredVotes = Math.ceil(alivePlayers.length / 2);
    
    if (maxVotes < requiredVotes) {
      eliminatedPlayer = undefined;
    }

    return { eliminatedPlayer, voteCount };
  }

  /**
   * Process night phase actions and determine eliminations
   */
  private async processNightPhase(game: IGame): Promise<{ eliminatedPlayers: Types.ObjectId[] }> {
    const eliminatedPlayers: Types.ObjectId[] = [];

    // Get mafia votes for elimination
    const mafiaVotes = game.votes.filter(async vote => {
      const voter = await Player.findById(vote.voterId);
      return voter?.role === GameRole.MAFIA;
    });

    // Process mafia elimination
    if (mafiaVotes.length > 0) {
      const mafiaTarget = this.getMafiaTarget(mafiaVotes);
      if (mafiaTarget && !this.isPlayerProtected(game, mafiaTarget)) {
        (game as any).eliminatePlayer(mafiaTarget, 'Eliminated by Mafia');
        eliminatedPlayers.push(mafiaTarget);
      }
    }

    return { eliminatedPlayers };
  }

  /**
   * Determine mafia target from votes
   */
  private getMafiaTarget(mafiaVotes: Vote[]): Types.ObjectId | null {
    const voteCount = new Map<string, number>();
    
    for (const vote of mafiaVotes) {
      const targetId = vote.targetId.toString();
      voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
    }

    let maxVotes = 0;
    let target: Types.ObjectId | null = null;

    for (const [playerId, votes] of voteCount.entries()) {
      if (votes > maxVotes) {
        maxVotes = votes;
        target = new Types.ObjectId(playerId);
      }
    }

    return target;
  }

  /**
   * Check if a player is protected by doctor
   */
  private isPlayerProtected(game: IGame, playerId: Types.ObjectId): boolean {
    // Check recent doctor protection events
    const recentEvents = game.history.filter(event => 
      event.type === GameEventType.ROLE_ACTION &&
      event.data?.role === GameRole.DOCTOR &&
      event.data?.action === 'protect' &&
      event.targetId?.equals(playerId) &&
      event.phase === GamePhase.NIGHT &&
      event.dayNumber === game.dayNumber
    );

    return recentEvents.length > 0;
  }

  /**
   * Check win conditions and return result if game should end
   */
  checkWinConditions(game: IGame): WinResult | null {
    const alivePlayers = game.players.filter(p => 
      !game.eliminatedPlayers.some(ep => ep.equals(p))
    );

    if (alivePlayers.length === 0) {
      return {
        condition: WinCondition.DRAW,
        winningTeam: 'villagers',
        winningPlayers: [],
        reason: 'All players eliminated'
      };
    }

    // Count alive players by role (this would need actual role data)
    // For now, we'll implement basic win conditions
    const totalPlayers = game.players.length;
    const aliveCount = alivePlayers.length;
    
    // Simplified win conditions - in real implementation, we'd check actual roles
    if (aliveCount <= totalPlayers / 3) {
      return {
        condition: WinCondition.MAFIA_WIN,
        winningTeam: 'mafia',
        winningPlayers: alivePlayers, // Would filter for actual mafia players
        reason: 'Mafia equals or outnumbers villagers'
      };
    }

    // Check if all mafia are eliminated (simplified check)
    if (game.eliminatedPlayers.length >= Math.floor(totalPlayers / 4)) {
      return {
        condition: WinCondition.VILLAGER_WIN,
        winningTeam: 'villagers',
        winningPlayers: alivePlayers,
        reason: 'All mafia members eliminated'
      };
    }

    return null;
  }

  /**
   * Validate if a player action is legal in current game state
   */
  validateAction(action: PlayerAction, gameState: IGame): boolean {
    // Check if player is in the game
    if (!gameState.players.some(p => p.equals(action.playerId))) {
      throw new Error('Player not in game');
    }

    // Check if player is alive
    if (gameState.eliminatedPlayers.some(p => p.equals(action.playerId))) {
      throw new Error('Eliminated players cannot perform actions');
    }

    // Validate action based on current phase
    switch (action.type) {
      case 'vote':
      case 'unvote':
        if (gameState.phase !== GamePhase.VOTING) {
          throw new Error('Voting only allowed during voting phase');
        }
        break;

      case 'night_action':
        if (gameState.phase !== GamePhase.NIGHT) {
          throw new Error('Night actions only allowed during night phase');
        }
        break;
    }

    // Validate target if specified
    if (action.targetId) {
      if (!gameState.players.some(p => p.equals(action.targetId))) {
        throw new Error('Target player not in game');
      }

      // Can't target eliminated players
      if (gameState.eliminatedPlayers.some(p => p.equals(action.targetId))) {
        throw new Error('Cannot target eliminated players');
      }

      // Can't target self in most cases
      if (action.targetId.equals(action.playerId) && action.type !== 'night_action') {
        throw new Error('Cannot target yourself');
      }
    }

    return true;
  }

  /**
   * Create a game state update object
   */
  private createGameStateUpdate(game: IGame): GameStateUpdate {
    return {
      gameId: game._id,
      phase: game.phase,
      dayNumber: game.dayNumber,
      timeRemaining: game.timeRemaining,
      players: game.players,
      eliminatedPlayers: game.eliminatedPlayers,
      votes: game.votes,
      events: game.history.slice(-10) // Last 10 events
    };
  }

  /**
   * Get current game state for a room
   */
  async getGameState(roomId: Types.ObjectId): Promise<IGame | null> {
    return await Game.findOne({ roomId })
      .populate('players', 'username avatar role isAlive')
      .populate('eliminatedPlayers', 'username avatar role');
  }

  /**
   * End a game with specified result
   */
  async endGame(gameId: Types.ObjectId, winResult: WinResult): Promise<void> {
    const game = await Game.findById(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    (game as any).endGame(winResult);
    await game.save();

    // Update player statistics
    await this.updatePlayerStatistics(game, winResult);
  }

  /**
   * Update player statistics after game ends
   */
  private async updatePlayerStatistics(game: IGame, winResult: WinResult): Promise<void> {
    for (const playerId of game.players) {
      const player = await Player.findById(playerId);
      if (player) {
        player.statistics.gamesPlayed += 1;
        
        if (winResult.winningPlayers.some(wp => wp.equals(playerId))) {
          player.statistics.gamesWon += 1;
        }

        // Update favorite role if this role was played more
        if (player.role) {
          // Simple logic - could be more sophisticated
          player.statistics.favoriteRole = player.role;
        }

        await player.save();
      }
    }
  }
}