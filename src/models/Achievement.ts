import { Schema, model, Document, Types } from 'mongoose';

export enum AchievementType {
  GAMES_PLAYED = 'games_played',
  GAMES_WON = 'games_won',
  WIN_STREAK = 'win_streak',
  ROLE_MASTERY = 'role_mastery',
  SURVIVAL = 'survival',
  VOTING = 'voting',
  SOCIAL = 'social',
  SPECIAL = 'special'
}

export enum AchievementRarity {
  COMMON = 'common',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary'
}

export interface IAchievement extends Document {
  _id: Types.ObjectId;
  key: string;
  name: string;
  description: string;
  type: AchievementType;
  rarity: AchievementRarity;
  icon: string;
  requirement: {
    type: string;
    value: number;
    conditions?: any;
  };
  reward: {
    experience: number;
    title?: string;
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPlayerAchievement extends Document {
  _id: Types.ObjectId;
  playerId: Types.ObjectId;
  achievementId: Types.ObjectId;
  unlockedAt: Date;
  progress: number;
  isCompleted: boolean;
  notificationSent: boolean;
}

// Achievement schema
const AchievementSchema = new Schema<IAchievement>({
  key: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true
  },
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  description: { 
    type: String, 
    required: true,
    trim: true
  },
  type: { 
    type: String, 
    enum: Object.values(AchievementType),
    required: true 
  },
  rarity: { 
    type: String, 
    enum: Object.values(AchievementRarity),
    default: AchievementRarity.COMMON 
  },
  icon: { 
    type: String, 
    required: true,
    trim: true
  },
  requirement: {
    type: { type: String, required: true },
    value: { type: Number, required: true },
    conditions: { type: Schema.Types.Mixed }
  },
  reward: {
    experience: { type: Number, default: 0 },
    title: { type: String, trim: true }
  },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Player Achievement schema
const PlayerAchievementSchema = new Schema<IPlayerAchievement>({
  playerId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Player',
    required: true 
  },
  achievementId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Achievement',
    required: true 
  },
  unlockedAt: { type: Date },
  progress: { type: Number, default: 0, min: 0 },
  isCompleted: { type: Boolean, default: false },
  notificationSent: { type: Boolean, default: false }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
AchievementSchema.index({ key: 1 });
AchievementSchema.index({ type: 1 });
AchievementSchema.index({ rarity: 1 });
AchievementSchema.index({ isActive: 1 });

PlayerAchievementSchema.index({ playerId: 1 });
PlayerAchievementSchema.index({ achievementId: 1 });
PlayerAchievementSchema.index({ playerId: 1, achievementId: 1 }, { unique: true });
PlayerAchievementSchema.index({ isCompleted: 1 });
PlayerAchievementSchema.index({ unlockedAt: -1 });

// Virtual for completion percentage
PlayerAchievementSchema.virtual('completionPercentage').get(function() {
  // This would need to be calculated based on the achievement requirement
  return this.isCompleted ? 100 : 0;
});

export const Achievement = model<IAchievement>('Achievement', AchievementSchema);
export const PlayerAchievement = model<IPlayerAchievement>('PlayerAchievement', PlayerAchievementSchema);