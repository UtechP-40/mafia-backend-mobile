import { Schema, model, Document, Types } from 'mongoose';

// Enums and interfaces
export enum MessageType {
  PLAYER_CHAT = 'player_chat',
  SYSTEM_MESSAGE = 'system_message',
  GAME_EVENT = 'game_event',
  AI_ASSISTANCE = 'ai_assistance'
}

export interface IChatMessage extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  playerId?: Types.ObjectId;
  content: string;
  type: MessageType;
  timestamp: Date;
  isModerated: boolean;
  moderationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Main ChatMessage schema
const ChatMessageSchema = new Schema<IChatMessage>({
  roomId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Room',
    required: true,
    index: true
  },
  playerId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Player',
    required: function() {
      return this.type === MessageType.PLAYER_CHAT;
    }
  },
  content: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 500
  },
  type: { 
    type: String, 
    enum: Object.values(MessageType),
    default: MessageType.PLAYER_CHAT 
  },
  timestamp: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  isModerated: { 
    type: Boolean, 
    default: false 
  },
  moderationReason: { 
    type: String,
    trim: true,
    maxlength: 200
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
ChatMessageSchema.index({ roomId: 1, timestamp: -1 });
ChatMessageSchema.index({ playerId: 1, timestamp: -1 });
ChatMessageSchema.index({ type: 1 });
ChatMessageSchema.index({ isModerated: 1 });
ChatMessageSchema.index({ createdAt: -1 });

// Compound index for efficient room message queries
ChatMessageSchema.index({ roomId: 1, type: 1, timestamp: -1 });

// Virtual for checking if message is from system
ChatMessageSchema.virtual('isSystemMessage').get(function() {
  return this.type !== MessageType.PLAYER_CHAT;
});

// Virtual for checking if message needs moderation
ChatMessageSchema.virtual('needsModeration').get(function() {
  return this.type === MessageType.PLAYER_CHAT && !this.isModerated;
});

// Pre-save middleware for content validation and moderation
ChatMessageSchema.pre('save', function(next) {
  // Basic content filtering for inappropriate content
  const inappropriateWords = ['spam', 'cheat', 'hack']; // This would be more comprehensive in production
  const lowerContent = this.content.toLowerCase();
  
  if (this.type === MessageType.PLAYER_CHAT) {
    // Check for inappropriate content
    const hasInappropriateContent = inappropriateWords.some(word => 
      lowerContent.includes(word)
    );
    
    if (hasInappropriateContent) {
      this.isModerated = true;
      this.moderationReason = 'Inappropriate content detected';
      this.content = '[Message moderated]';
    }
    
    // Trim excessive whitespace
    this.content = this.content.replace(/\s+/g, ' ').trim();
  }
  
  next();
});

// Instance methods
ChatMessageSchema.methods.moderate = function(reason: string) {
  this.isModerated = true;
  this.moderationReason = reason;
  this.content = '[Message moderated]';
  return this.save();
};

ChatMessageSchema.methods.unmoderate = function() {
  this.isModerated = false;
  this.moderationReason = undefined;
  return this.save();
};

// Static methods
ChatMessageSchema.statics.findRoomMessages = function(
  roomId: Types.ObjectId, 
  limit = 50, 
  before?: Date
) {
  const query: any = { roomId };
  
  if (before) {
    query.timestamp = { $lt: before };
  }
  
  return this.find(query)
    .populate('playerId', 'username avatar')
    .sort({ timestamp: -1 })
    .limit(limit);
};

ChatMessageSchema.statics.findPlayerMessages = function(
  playerId: Types.ObjectId, 
  limit = 100
) {
  return this.find({ 
    playerId,
    type: MessageType.PLAYER_CHAT 
  })
  .populate('roomId', 'code')
  .sort({ timestamp: -1 })
  .limit(limit);
};

ChatMessageSchema.statics.findModeratedMessages = function(limit = 50) {
  return this.find({ isModerated: true })
    .populate('playerId', 'username avatar')
    .populate('roomId', 'code')
    .sort({ timestamp: -1 })
    .limit(limit);
};

ChatMessageSchema.statics.createSystemMessage = function(
  roomId: Types.ObjectId, 
  content: string, 
  type: MessageType = MessageType.SYSTEM_MESSAGE
) {
  return this.create({
    roomId,
    content,
    type,
    timestamp: new Date()
  });
};

ChatMessageSchema.statics.createGameEventMessage = function(
  roomId: Types.ObjectId, 
  content: string
) {
  return (this as any).createSystemMessage(roomId, content, MessageType.GAME_EVENT);
};

ChatMessageSchema.statics.createAIMessage = function(
  roomId: Types.ObjectId, 
  content: string
) {
  return (this as any).createSystemMessage(roomId, content, MessageType.AI_ASSISTANCE);
};

ChatMessageSchema.statics.getMessageStats = function(roomId: Types.ObjectId) {
  return this.aggregate([
    { $match: { roomId } },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        moderatedCount: {
          $sum: { $cond: ['$isModerated', 1, 0] }
        }
      }
    }
  ]);
};

ChatMessageSchema.statics.cleanupOldMessages = function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  return this.deleteMany({
    createdAt: { $lt: cutoffDate },
    type: { $ne: MessageType.GAME_EVENT } // Keep game events for history
  });
};

export const ChatMessage = model<IChatMessage>('ChatMessage', ChatMessageSchema);