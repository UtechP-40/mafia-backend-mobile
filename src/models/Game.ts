import { Schema, model, Document, Types } from 'mongoose';
import { GameRole } from './Player';
import { GameSettings } from './Room';

// Enums and interfaces
export enum GamePhase {
  DAY = 'day',
  NIGHT = 'night',
  VOTING = 'voting',
  FINISHED = 'finished'
}

export enum GameEventType {
  GAME_START = 'game_start',
  PHASE_CHANGE = 'phase_change',
  PLAYER_ELIMINATION = 'player_elimination',
  PLAYER_VOTE = 'player_vote',
  ROLE_ACTION = 'role_action',
  GAME_END = 'game_end'
}

export enum WinCondition {
  MAFIA_WIN = 'mafia_win',
  VILLAGER_WIN = 'villager_win',
  DRAW = 'draw'
}

export interface Vote {
  voterId: Types.ObjectId;
  targetId: Types.ObjectId;
  timestamp: Date;
}

export interface GameEvent {
  type: GameEventType;
  playerId?: Types.ObjectId;
  targetId?: Types.ObjectId;
  data?: any;
  timestamp: Date;
  phase: GamePhase;
  dayNumber: number;
}

export interface WinResult {
  condition: WinCondition;
  winningTeam: 'mafia' | 'villagers';
  winningPlayers: Types.ObjectId[];
  reason: string;
}

export interface IGame extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  phase: GamePhase;
  dayNumber: number;
  players: Types.ObjectId[];
  eliminatedPlayers: Types.ObjectId[];
  votes: Vote[];
  timeRemaining: number;
  settings: GameSettings;
  history: GameEvent[];
  winResult?: WinResult;
  createdAt: Date;
  updatedAt: Date;
}

// Vote sub-schema
const VoteSchema = new Schema<Vote>({
  voterId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Player',
    required: true 
  },
  targetId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Player',
    required: true 
  },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

// Game event sub-schema
const GameEventSchema = new Schema<GameEvent>({
  type: { 
    type: String, 
    enum: Object.values(GameEventType),
    required: true 
  },
  playerId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Player' 
  },
  targetId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Player' 
  },
  data: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
  phase: { 
    type: String, 
    enum: Object.values(GamePhase),
    required: true 
  },
  dayNumber: { type: Number, required: true, min: 1 }
}, { _id: false });

// Win result sub-schema
const WinResultSchema = new Schema<WinResult>({
  condition: { 
    type: String, 
    enum: Object.values(WinCondition),
    required: true 
  },
  winningTeam: { 
    type: String, 
    enum: ['mafia', 'villagers'],
    required: true 
  },
  winningPlayers: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Player' 
  }],
  reason: { type: String, required: true }
}, { _id: false });

// Main Game schema
const GameSchema = new Schema<IGame>({
  roomId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Room',
    required: true,
    unique: true
  },
  phase: { 
    type: String, 
    enum: Object.values(GamePhase),
    default: GamePhase.DAY 
  },
  dayNumber: { 
    type: Number, 
    default: 1, 
    min: 1 
  },
  players: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Player',
    required: true
  }],
  eliminatedPlayers: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Player' 
  }],
  votes: [VoteSchema],
  timeRemaining: { 
    type: Number, 
    default: 300000, // 5 minutes in milliseconds
    min: 0 
  },
  settings: { 
    type: Schema.Types.Mixed,
    required: true 
  },
  history: [GameEventSchema],
  winResult: WinResultSchema
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
GameSchema.index({ roomId: 1 });
GameSchema.index({ phase: 1 });
GameSchema.index({ players: 1 });
GameSchema.index({ createdAt: -1 });
GameSchema.index({ 'winResult.condition': 1 });

// Virtual for alive players
GameSchema.virtual('alivePlayers').get(function() {
  return this.players.filter(playerId => 
    !this.eliminatedPlayers.some(eliminatedId => eliminatedId.equals(playerId))
  );
});

// Virtual for checking if game is active
GameSchema.virtual('isActive').get(function() {
  return this.phase !== GamePhase.FINISHED;
});

// Virtual for current vote count
GameSchema.virtual('currentVoteCount').get(function() {
  return this.votes.length;
});

// Virtual for required votes to proceed
GameSchema.virtual('requiredVotes').get(function() {
  return Math.ceil((this as any).alivePlayers.length / 2);
});

// Instance methods
GameSchema.methods.addVote = function(voterId: Types.ObjectId, targetId: Types.ObjectId) {
  // Remove existing vote from this voter
  this.votes = this.votes.filter((vote: any) => !vote.voterId.equals(voterId));
  
  // Add new vote
  this.votes.push({
    voterId,
    targetId,
    timestamp: new Date()
  });
  
  // Add to history
  this.addEvent(GameEventType.PLAYER_VOTE, voterId, targetId);
};

GameSchema.methods.removeVote = function(voterId: Types.ObjectId) {
  const initialLength = this.votes.length;
  this.votes = this.votes.filter((vote: any) => !vote.voterId.equals(voterId));
  return this.votes.length < initialLength;
};

GameSchema.methods.eliminatePlayer = function(playerId: Types.ObjectId, reason: string = 'Voted out') {
  if (!this.eliminatedPlayers.includes(playerId)) {
    this.eliminatedPlayers.push(playerId);
    this.addEvent(GameEventType.PLAYER_ELIMINATION, playerId, undefined, { reason });
    return true;
  }
  return false;
};

GameSchema.methods.advancePhase = function() {
  const previousPhase = this.phase;
  
  switch (this.phase) {
    case GamePhase.DAY:
      this.phase = GamePhase.VOTING;
      this.timeRemaining = this.settings.votingDuration;
      break;
    case GamePhase.VOTING:
      this.phase = GamePhase.NIGHT;
      this.timeRemaining = this.settings.nightPhaseDuration;
      break;
    case GamePhase.NIGHT:
      this.phase = GamePhase.DAY;
      this.dayNumber += 1;
      this.timeRemaining = this.settings.dayPhaseDuration;
      break;
    case GamePhase.FINISHED:
      return false; // Cannot advance from finished state
  }
  
  // Clear votes when advancing phases
  this.votes = [];
  
  this.addEvent(GameEventType.PHASE_CHANGE, undefined, undefined, {
    from: previousPhase,
    to: this.phase,
    dayNumber: this.dayNumber
  });
  
  return true;
};

GameSchema.methods.addEvent = function(
  type: GameEventType, 
  playerId?: Types.ObjectId, 
  targetId?: Types.ObjectId, 
  data?: any
) {
  this.history.push({
    type,
    playerId,
    targetId,
    data,
    timestamp: new Date(),
    phase: this.phase,
    dayNumber: this.dayNumber
  });
};

GameSchema.methods.checkWinConditions = function(): WinResult | null {
  const alivePlayers = this.alivePlayers;
  
  if (alivePlayers.length === 0) {
    return {
      condition: WinCondition.DRAW,
      winningTeam: 'villagers', // Default to villagers in case of draw
      winningPlayers: [],
      reason: 'All players eliminated'
    };
  }
  
  // Note: This is a simplified win condition check
  // In a real implementation, we'd need to check actual player roles
  // For now, we'll implement basic logic that can be extended
  
  const totalPlayers = this.players.length;
  const aliveCount = alivePlayers.length;
  const eliminatedCount = this.eliminatedPlayers.length;
  
  // If more than half the players are eliminated, villagers might win
  if (eliminatedCount >= Math.floor(totalPlayers / 2)) {
    return {
      condition: WinCondition.VILLAGER_WIN,
      winningTeam: 'villagers',
      winningPlayers: alivePlayers,
      reason: 'Majority of players eliminated'
    };
  }
  
  return null; // No win condition met
};

GameSchema.methods.endGame = function(winResult: WinResult) {
  this.phase = GamePhase.FINISHED;
  this.winResult = winResult;
  this.timeRemaining = 0;
  this.addEvent(GameEventType.GAME_END, undefined, undefined, winResult);
};

// Static methods
GameSchema.statics.findActiveGames = function() {
  return this.find({ 
    phase: { $ne: GamePhase.FINISHED } 
  })
  .populate('players', 'username avatar role')
  .populate('roomId', 'code settings');
};

GameSchema.statics.findByRoomId = function(roomId: Types.ObjectId) {
  return this.findOne({ roomId })
    .populate('players', 'username avatar role')
    .populate('eliminatedPlayers', 'username avatar role');
};

GameSchema.statics.getGameHistory = function(playerId: Types.ObjectId, limit = 10) {
  return this.find({ 
    players: playerId,
    phase: GamePhase.FINISHED 
  })
  .populate('players', 'username avatar')
  .sort({ createdAt: -1 })
  .limit(limit);
};

export const Game = model<IGame>('Game', GameSchema);