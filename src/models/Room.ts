import { Schema, model, Document, Types } from 'mongoose';
import { GameRole } from './Player';

// Enums and interfaces
export enum RoomStatus {
  WAITING = 'waiting',
  IN_PROGRESS = 'in_progress',
  FINISHED = 'finished',
  CANCELLED = 'cancelled'
}

export interface RoleConfiguration {
  role: GameRole;
  count: number;
}

export interface GameSettings {
  maxPlayers: number;
  enableVoiceChat: boolean;
  dayPhaseDuration: number;
  nightPhaseDuration: number;
  votingDuration: number;
  roles: RoleConfiguration[];
}

export interface RoomSettings {
  isPublic: boolean;
  maxPlayers: number;
  gameSettings: GameSettings;
  allowSpectators: boolean;
  requireInvite: boolean;
}

export interface IRoom extends Document {
  _id: Types.ObjectId;
  code: string;
  hostId: Types.ObjectId;
  players: Types.ObjectId[];
  settings: RoomSettings;
  status: RoomStatus;
  gameStateId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// Role configuration sub-schema
const RoleConfigurationSchema = new Schema<RoleConfiguration>({
  role: { 
    type: String, 
    enum: Object.values(GameRole),
    required: true 
  },
  count: { 
    type: Number, 
    required: true, 
    min: 0,
    max: 20 
  }
}, { _id: false });

// Game settings sub-schema
const GameSettingsSchema = new Schema<GameSettings>({
  maxPlayers: { 
    type: Number, 
    required: true, 
    min: 4, 
    max: 20,
    default: 8 
  },
  enableVoiceChat: { type: Boolean, default: true },
  dayPhaseDuration: { 
    type: Number, 
    default: 300000, // 5 minutes in milliseconds
    min: 60000, // 1 minute minimum
    max: 1800000 // 30 minutes maximum
  },
  nightPhaseDuration: { 
    type: Number, 
    default: 120000, // 2 minutes in milliseconds
    min: 30000, // 30 seconds minimum
    max: 600000 // 10 minutes maximum
  },
  votingDuration: { 
    type: Number, 
    default: 60000, // 1 minute in milliseconds
    min: 30000, // 30 seconds minimum
    max: 300000 // 5 minutes maximum
  },
  roles: [RoleConfigurationSchema]
}, { _id: false });

// Room settings sub-schema
const RoomSettingsSchema = new Schema<RoomSettings>({
  isPublic: { type: Boolean, default: true },
  maxPlayers: { 
    type: Number, 
    required: true, 
    min: 4, 
    max: 20,
    default: 8 
  },
  gameSettings: { 
    type: GameSettingsSchema, 
    required: true,
    default: () => ({})
  },
  allowSpectators: { type: Boolean, default: false },
  requireInvite: { type: Boolean, default: false }
}, { _id: false });

// Main Room schema
const RoomSchema = new Schema<IRoom>({
  code: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true,
    length: 6,
    match: /^[A-Z0-9]{6}$/
  },
  hostId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Player',
    required: true 
  },
  players: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Player' 
  }],
  settings: { 
    type: RoomSettingsSchema, 
    required: true,
    default: () => ({})
  },
  status: { 
    type: String, 
    enum: Object.values(RoomStatus),
    default: RoomStatus.WAITING 
  },
  gameStateId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Game',
    default: undefined
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
RoomSchema.index({ code: 1 });
RoomSchema.index({ hostId: 1 });
RoomSchema.index({ status: 1 });
RoomSchema.index({ 'settings.isPublic': 1, status: 1 });
RoomSchema.index({ createdAt: -1 });
RoomSchema.index({ players: 1 });

// Virtual for current player count
RoomSchema.virtual('currentPlayerCount').get(function() {
  return this.players.length;
});

// Virtual for checking if room is full
RoomSchema.virtual('isFull').get(function() {
  return this.players.length >= this.settings.maxPlayers;
});

// Virtual for checking if room can start
RoomSchema.virtual('canStart').get(function() {
  return this.players.length >= 4 && this.status === RoomStatus.WAITING;
});

// Pre-save middleware to validate role configuration
RoomSchema.pre('save', function(next) {
  if (this.settings.gameSettings.roles.length > 0) {
    const totalRoles = this.settings.gameSettings.roles.reduce((sum, role) => sum + role.count, 0);
    if (totalRoles !== this.settings.maxPlayers) {
      return next(new Error('Total role count must equal max players'));
    }
  }
  next();
});

// Instance methods
RoomSchema.methods.addPlayer = function(playerId: Types.ObjectId) {
  if (!this.isFull && !this.players.includes(playerId)) {
    this.players.push(playerId);
    return true;
  }
  return false;
};

RoomSchema.methods.removePlayer = function(playerId: Types.ObjectId) {
  const initialLength = this.players.length;
  this.players = this.players.filter((id: any) => !id.equals(playerId));
  return this.players.length < initialLength;
};

RoomSchema.methods.transferHost = function(newHostId: Types.ObjectId) {
  if (this.players.includes(newHostId)) {
    this.hostId = newHostId;
    return true;
  }
  return false;
};

RoomSchema.methods.generateCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  this.code = result;
};

// Static methods
RoomSchema.statics.findPublicRooms = function(limit = 20, skip = 0) {
  return this.find({ 
    'settings.isPublic': true, 
    status: RoomStatus.WAITING 
  })
  .populate('hostId', 'username avatar')
  .populate('players', 'username avatar')
  .sort({ createdAt: -1 })
  .limit(limit)
  .skip(skip);
};

RoomSchema.statics.findByCode = function(code: string) {
  return this.findOne({ code: code.toUpperCase() })
    .populate('hostId', 'username avatar')
    .populate('players', 'username avatar');
};

export const Room = model<IRoom>('Room', RoomSchema);