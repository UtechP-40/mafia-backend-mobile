import { Schema, model, Document, Types } from 'mongoose';

// Enums and interfaces
export enum GameRole {
  VILLAGER = 'villager',
  MAFIA = 'mafia',
  DETECTIVE = 'detective',
  DOCTOR = 'doctor',
  MAYOR = 'mayor'
}

export interface PlayerStats {
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  favoriteRole: GameRole;
  averageGameDuration: number;
  eloRating: number;
}

export interface IPlayer extends Document {
  _id: Types.ObjectId;
  username: string;
  email?: string;
  password?: string;
  avatar: string;
  role?: GameRole;
  isAlive: boolean;
  isHost: boolean;
  statistics: PlayerStats;
  friends: Types.ObjectId[];
  refreshTokens: string[];
  createdAt: Date;
  lastActive: Date;
  updatedAt: Date;
}

// Player statistics sub-schema
const PlayerStatsSchema = new Schema<PlayerStats>({
  gamesPlayed: { type: Number, default: 0, min: 0 },
  gamesWon: { type: Number, default: 0, min: 0 },
  winRate: { type: Number, default: 0, min: 0, max: 100 },
  favoriteRole: { 
    type: String, 
    enum: Object.values(GameRole),
    default: GameRole.VILLAGER 
  },
  averageGameDuration: { type: Number, default: 0, min: 0 },
  eloRating: { type: Number, default: 1200, min: 0, max: 3000 }
}, { _id: false });

// Main Player schema
const PlayerSchema = new Schema<IPlayer>({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20,
    match: /^[a-zA-Z0-9_]+$/
  },
  email: { 
    type: String, 
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    type: String,
    select: false // Don't include password in queries by default
  },
  avatar: { 
    type: String, 
    default: 'default-avatar.png',
    trim: true
  },
  role: { 
    type: String, 
    enum: Object.values(GameRole),
    default: undefined
  },
  isAlive: { type: Boolean, default: true },
  isHost: { type: Boolean, default: false },
  statistics: { 
    type: PlayerStatsSchema, 
    default: () => ({}) 
  },
  friends: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Player' 
  }],
  refreshTokens: [{
    type: String,
    select: false // Don't include refresh tokens in queries by default
  }],
  lastActive: { type: Date, default: Date.now }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
PlayerSchema.index({ username: 1 });
PlayerSchema.index({ email: 1 });
PlayerSchema.index({ 'statistics.eloRating': -1 });
PlayerSchema.index({ lastActive: -1 });
PlayerSchema.index({ friends: 1 });

// Note: Win rate is calculated in pre-save middleware instead of virtual
// to avoid conflicts with the schema field

// Pre-save middleware to update win rate
PlayerSchema.pre('save', function(next) {
  if (this.statistics.gamesPlayed > 0) {
    this.statistics.winRate = Math.round((this.statistics.gamesWon / this.statistics.gamesPlayed) * 100);
  }
  next();
});

// Instance methods
PlayerSchema.methods.addFriend = function(friendId: Types.ObjectId) {
  if (!this.friends.includes(friendId)) {
    this.friends.push(friendId);
  }
};

PlayerSchema.methods.removeFriend = function(friendId: Types.ObjectId) {
  this.friends = this.friends.filter((id: any) => !id.equals(friendId));
};

PlayerSchema.methods.updateLastActive = function() {
  this.lastActive = new Date();
  return this.save();
};

export const Player = model<IPlayer>('Player', PlayerSchema);