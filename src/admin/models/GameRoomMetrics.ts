import mongoose, { Schema, Document } from 'mongoose';

export interface IGameRoomMetrics extends Document {
  roomId: string;
  namespace: string;
  hostId?: string;
  gameState: 'waiting' | 'starting' | 'day_phase' | 'night_phase' | 'voting' | 'ended';
  gamePhase?: string;
  playerCount: number;
  maxPlayers: number;
  isActive: boolean;
  createdAt: Date;
  gameStartedAt?: Date;
  gameEndedAt?: Date;
  gameDuration?: number; // in milliseconds
  totalMessages: number;
  totalEvents: number;
  averageLatency: number;
  peakPlayerCount: number;
  playerJoinEvents: number;
  playerLeaveEvents: number;
  disconnectionEvents: number;
  reconnectionEvents: number;
  errorEvents: number;
  bandwidthUsage: {
    incoming: number;
    outgoing: number;
  };
  playerSessions: Array<{
    playerId: string;
    joinedAt: Date;
    leftAt?: Date;
    sessionDuration?: number;
    messageCount: number;
    eventCount: number;
    disconnections: number;
    averageLatency: number;
  }>;
  gameEvents: Array<{
    eventType: string;
    timestamp: Date;
    playerId?: string;
    data?: any;
  }>;
  performanceMetrics: {
    averageResponseTime: number;
    eventThroughput: number;
    errorRate: number;
    connectionStability: number;
  };
  metadata?: any;
  updatedAt: Date;
  
  // Virtual properties
  gameDurationMinutes: number;
  activePlayerSessions: any[];
  completionRate: number;
  
  // Instance methods
  addPlayerSession(playerId: string): void;
  endPlayerSession(playerId: string): void;
  recordGameEvent(eventType: string, playerId?: string, data?: any): void;
  updatePerformanceMetrics(): void;
  startGame(): void;
  endGame(): void;
}

export interface IGameRoomMetricsModel extends mongoose.Model<IGameRoomMetrics> {
  getRoomStatsSummary(startDate: Date, endDate: Date): Promise<any>;
  getTopPerformingRooms(limit?: number): Promise<any[]>;
  getRoomCapacityAnalysis(days?: number): Promise<any[]>;
  getHourlyActivity(days?: number): Promise<any[]>;
}

const GameRoomMetricsSchema = new Schema<IGameRoomMetrics>({
  roomId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  namespace: {
    type: String,
    required: true,
    index: true
  },
  hostId: {
    type: String,
    index: true
  },
  gameState: {
    type: String,
    required: true,
    enum: ['waiting', 'starting', 'day_phase', 'night_phase', 'voting', 'ended'],
    index: true
  },
  gamePhase: {
    type: String,
    index: true
  },
  playerCount: {
    type: Number,
    required: true,
    min: 0
  },
  maxPlayers: {
    type: Number,
    required: true,
    min: 1
  },
  isActive: {
    type: Boolean,
    required: true,
    index: true
  },
  gameStartedAt: {
    type: Date,
    index: true
  },
  gameEndedAt: {
    type: Date,
    index: true
  },
  gameDuration: {
    type: Number,
    min: 0
  },
  totalMessages: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  totalEvents: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  averageLatency: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  peakPlayerCount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  playerJoinEvents: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  playerLeaveEvents: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  disconnectionEvents: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  reconnectionEvents: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  errorEvents: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  bandwidthUsage: {
    incoming: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    outgoing: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    }
  },
  playerSessions: [{
    playerId: {
      type: String,
      required: true
    },
    joinedAt: {
      type: Date,
      required: true
    },
    leftAt: {
      type: Date
    },
    sessionDuration: {
      type: Number,
      min: 0
    },
    messageCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    eventCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    disconnections: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    averageLatency: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    }
  }],
  gameEvents: [{
    eventType: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      required: true
    },
    playerId: {
      type: String
    },
    data: {
      type: Schema.Types.Mixed
    }
  }],
  performanceMetrics: {
    averageResponseTime: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    eventThroughput: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    errorRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0
    },
    connectionStability: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 100
    }
  },
  metadata: {
    type: Schema.Types.Mixed
  }
}, {
  timestamps: true,
  collection: 'game_room_metrics'
});

// Indexes for better query performance
GameRoomMetricsSchema.index({ createdAt: -1 });
GameRoomMetricsSchema.index({ gameStartedAt: -1 });
GameRoomMetricsSchema.index({ gameState: 1, isActive: 1 });
GameRoomMetricsSchema.index({ playerCount: -1 });
GameRoomMetricsSchema.index({ gameDuration: -1 });
GameRoomMetricsSchema.index({ 'performanceMetrics.errorRate': -1 });

// TTL index to automatically delete old room metrics after 90 days
GameRoomMetricsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Virtual for game duration in minutes
GameRoomMetricsSchema.virtual('gameDurationMinutes').get(function() {
  return this.gameDuration ? Math.round(this.gameDuration / (1000 * 60)) : 0;
});

// Virtual for active player sessions
GameRoomMetricsSchema.virtual('activePlayerSessions').get(function() {
  return this.playerSessions.filter(session => !session.leftAt);
});

// Virtual for completion rate
GameRoomMetricsSchema.virtual('completionRate').get(function() {
  const totalSessions = this.playerSessions.length;
  if (totalSessions === 0) return 0;
  
  const completedSessions = this.playerSessions.filter(session => 
    session.leftAt && this.gameEndedAt && session.leftAt >= this.gameEndedAt
  ).length;
  
  return (completedSessions / totalSessions) * 100;
});

// Method to add player session
GameRoomMetricsSchema.methods.addPlayerSession = function(playerId: string) {
  const existingSession = this.playerSessions.find(session => 
    session.playerId === playerId && !session.leftAt
  );
  
  if (!existingSession) {
    this.playerSessions.push({
      playerId,
      joinedAt: new Date(),
      messageCount: 0,
      eventCount: 0,
      disconnections: 0,
      averageLatency: 0
    });
    
    this.playerJoinEvents++;
    this.playerCount = this.activePlayerSessions.length;
    this.peakPlayerCount = Math.max(this.peakPlayerCount, this.playerCount);
  }
};

// Method to end player session
GameRoomMetricsSchema.methods.endPlayerSession = function(playerId: string) {
  const session = this.playerSessions.find(session => 
    session.playerId === playerId && !session.leftAt
  );
  
  if (session) {
    session.leftAt = new Date();
    session.sessionDuration = session.leftAt.getTime() - session.joinedAt.getTime();
    this.playerLeaveEvents++;
    this.playerCount = this.activePlayerSessions.length;
  }
};

// Method to record game event
GameRoomMetricsSchema.methods.recordGameEvent = function(eventType: string, playerId?: string, data?: any) {
  this.gameEvents.push({
    eventType,
    timestamp: new Date(),
    playerId,
    data
  });
  
  this.totalEvents++;
  
  // Update player session event count
  if (playerId) {
    const session = this.playerSessions.find(s => s.playerId === playerId && !s.leftAt);
    if (session) {
      session.eventCount++;
    }
  }
};

// Method to update performance metrics
GameRoomMetricsSchema.methods.updatePerformanceMetrics = function() {
  const now = new Date();
  const timeWindow = 5 * 60 * 1000; // 5 minutes
  const recentEvents = this.gameEvents.filter(event => 
    now.getTime() - event.timestamp.getTime() < timeWindow
  );
  
  // Calculate event throughput (events per minute)
  this.performanceMetrics.eventThroughput = (recentEvents.length / 5) || 0;
  
  // Calculate error rate
  const totalEvents = this.totalEvents || 1;
  this.performanceMetrics.errorRate = (this.errorEvents / totalEvents) * 100;
  
  // Calculate connection stability
  const totalConnectionEvents = this.playerJoinEvents + this.playerLeaveEvents;
  if (totalConnectionEvents > 0) {
    this.performanceMetrics.connectionStability = 
      Math.max(0, 100 - ((this.disconnectionEvents / totalConnectionEvents) * 100));
  }
};

// Method to start game
GameRoomMetricsSchema.methods.startGame = function() {
  this.gameState = 'starting';
  this.gameStartedAt = new Date();
  this.recordGameEvent('game_started');
};

// Method to end game
GameRoomMetricsSchema.methods.endGame = function() {
  this.gameState = 'ended';
  this.gameEndedAt = new Date();
  this.isActive = false;
  
  if (this.gameStartedAt) {
    this.gameDuration = this.gameEndedAt.getTime() - this.gameStartedAt.getTime();
  }
  
  this.recordGameEvent('game_ended');
  
  // End all active player sessions
  this.playerSessions.forEach(session => {
    if (!session.leftAt) {
      session.leftAt = this.gameEndedAt;
      session.sessionDuration = session.leftAt!.getTime() - session.joinedAt.getTime();
    }
  });
};

// Static method to get room statistics summary
GameRoomMetricsSchema.statics.getRoomStatsSummary = async function(startDate: Date, endDate: Date) {
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalRooms: { $sum: 1 },
        activeRooms: {
          $sum: { $cond: ['$isActive', 1, 0] }
        },
        completedGames: {
          $sum: { $cond: [{ $eq: ['$gameState', 'ended'] }, 1, 0] }
        },
        avgPlayerCount: { $avg: '$playerCount' },
        avgGameDuration: { $avg: '$gameDuration' },
        totalMessages: { $sum: '$totalMessages' },
        totalEvents: { $sum: '$totalEvents' },
        avgLatency: { $avg: '$averageLatency' },
        avgErrorRate: { $avg: '$performanceMetrics.errorRate' }
      }
    }
  ];

  const result = await this.aggregate(pipeline);
  return result[0] || null;
};

// Static method to get top performing rooms
GameRoomMetricsSchema.statics.getTopPerformingRooms = async function(limit: number = 10) {
  return await this.find({ gameState: 'ended' })
    .sort({ 
      'performanceMetrics.connectionStability': -1,
      'performanceMetrics.errorRate': 1,
      gameDuration: -1
    })
    .limit(limit)
    .select('roomId playerCount gameDuration performanceMetrics createdAt')
    .lean();
};

// Static method to get room capacity analysis
GameRoomMetricsSchema.statics.getRoomCapacityAnalysis = async function(days: number = 7) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$maxPlayers',
        roomCount: { $sum: 1 },
        avgPlayerCount: { $avg: '$playerCount' },
        avgGameDuration: { $avg: '$gameDuration' },
        completionRate: {
          $avg: {
            $cond: [{ $eq: ['$gameState', 'ended'] }, 100, 0]
          }
        }
      }
    },
    {
      $sort: { _id: 1 as 1 }
    }
  ];

  return await this.aggregate(pipeline);
};

// Static method to get hourly room activity
GameRoomMetricsSchema.statics.getHourlyActivity = async function(days: number = 7) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: { $hour: '$createdAt' },
        roomCount: { $sum: 1 },
        avgPlayerCount: { $avg: '$playerCount' },
        avgDuration: { $avg: '$gameDuration' }
      }
    },
    {
      $sort: { _id: 1 as 1 }
    }
  ];

  return await this.aggregate(pipeline);
};

export const GameRoomMetrics = mongoose.model<IGameRoomMetrics, IGameRoomMetricsModel>('GameRoomMetrics', GameRoomMetricsSchema);