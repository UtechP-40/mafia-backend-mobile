import mongoose, { Schema, Document } from 'mongoose';

export interface ISocketEvent extends Document {
  socketId: string;
  playerId?: string;
  eventName: string;
  eventData?: any;
  direction: 'incoming' | 'outgoing';
  timestamp: Date;
  namespace: string;
  roomId?: string;
  ipAddress?: string;
  userAgent?: string;
  latency?: number;
  dataSize?: number;
  error?: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  isError(): boolean;
  getSummary(): any;
}

export interface ISocketEventModel extends mongoose.Model<ISocketEvent> {
  getEventStatistics(startDate: Date, endDate: Date, filters?: any): Promise<any[]>;
  getTopActivePlayers(startDate: Date, endDate: Date, limit?: number): Promise<any[]>;
  getRoomActivityStats(startDate: Date, endDate: Date): Promise<any[]>;
  getErrorAnalysis(startDate: Date, endDate: Date): Promise<any[]>;
  getRealtimeEvents(limit?: number, filters?: any): Promise<any[]>;
  searchEvents(searchTerm: string, filters?: any, limit?: number): Promise<any[]>;
}

const SocketEventSchema = new Schema<ISocketEvent>({
  socketId: {
    type: String,
    required: true,
    index: true
  },
  playerId: {
    type: String,
    index: true
  },
  eventName: {
    type: String,
    required: true,
    index: true
  },
  eventData: {
    type: Schema.Types.Mixed
  },
  direction: {
    type: String,
    required: true,
    enum: ['incoming', 'outgoing'],
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  namespace: {
    type: String,
    required: true,
    index: true
  },
  roomId: {
    type: String,
    index: true
  },
  ipAddress: {
    type: String,
    index: true
  },
  userAgent: {
    type: String
  },
  latency: {
    type: Number,
    min: 0
  },
  dataSize: {
    type: Number,
    min: 0
  },
  error: {
    type: String
  },
  metadata: {
    type: Schema.Types.Mixed
  }
}, {
  timestamps: true,
  collection: 'socket_events'
});

// Compound indexes for common queries
SocketEventSchema.index({ timestamp: -1, eventName: 1 });
SocketEventSchema.index({ playerId: 1, timestamp: -1 });
SocketEventSchema.index({ roomId: 1, timestamp: -1 });
SocketEventSchema.index({ namespace: 1, timestamp: -1 });
SocketEventSchema.index({ socketId: 1, timestamp: -1 });

// TTL index to automatically delete old events after 7 days
SocketEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

// Virtual for formatted timestamp
SocketEventSchema.virtual('formattedTimestamp').get(function() {
  return this.timestamp.toISOString();
});

// Method to check if event is an error
SocketEventSchema.methods.isError = function() {
  return !!this.error || this.eventName.toLowerCase().includes('error');
};

// Method to get event summary
SocketEventSchema.methods.getSummary = function() {
  return {
    id: this._id,
    socketId: this.socketId,
    playerId: this.playerId,
    eventName: this.eventName,
    direction: this.direction,
    timestamp: this.timestamp,
    namespace: this.namespace,
    roomId: this.roomId,
    hasError: this.isError(),
    dataSize: this.dataSize
  };
};

// Static method to get event statistics for a time range
SocketEventSchema.statics.getEventStatistics = async function(startDate: Date, endDate: Date, filters: any = {}) {
  const matchStage = {
    timestamp: { $gte: startDate, $lte: endDate },
    ...filters
  };

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: {
          eventName: '$eventName',
          direction: '$direction'
        },
        count: { $sum: 1 },
        avgLatency: { $avg: '$latency' },
        totalDataSize: { $sum: '$dataSize' },
        errorCount: {
          $sum: {
            $cond: [{ $ne: ['$error', null] }, 1, 0]
          }
        }
      }
    },
    {
      $sort: { count: -1 as -1 }
    }
  ];

  return await this.aggregate(pipeline);
};

// Static method to get top active players by event count
SocketEventSchema.statics.getTopActivePlayers = async function(startDate: Date, endDate: Date, limit: number = 10) {
  const pipeline = [
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate },
        playerId: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$playerId',
        eventCount: { $sum: 1 },
        uniqueEvents: { $addToSet: '$eventName' },
        lastActivity: { $max: '$timestamp' },
        avgLatency: { $avg: '$latency' },
        totalDataSize: { $sum: '$dataSize' }
      }
    },
    {
      $addFields: {
        uniqueEventCount: { $size: '$uniqueEvents' }
      }
    },
    {
      $sort: { eventCount: -1 as -1 }
    },
    {
      $limit: limit
    }
  ];

  return await this.aggregate(pipeline);
};

// Static method to get room activity statistics
SocketEventSchema.statics.getRoomActivityStats = async function(startDate: Date, endDate: Date) {
  const pipeline = [
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate },
        roomId: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: '$roomId',
        eventCount: { $sum: 1 },
        uniquePlayers: { $addToSet: '$playerId' },
        eventTypes: { $addToSet: '$eventName' },
        firstActivity: { $min: '$timestamp' },
        lastActivity: { $max: '$timestamp' },
        avgLatency: { $avg: '$latency' },
        totalDataSize: { $sum: '$dataSize' }
      }
    },
    {
      $addFields: {
        uniquePlayerCount: { $size: '$uniquePlayers' },
        uniqueEventTypeCount: { $size: '$eventTypes' },
        duration: { $subtract: ['$lastActivity', '$firstActivity'] }
      }
    },
    {
      $sort: { eventCount: -1 as -1 }
    }
  ];

  return await this.aggregate(pipeline);
};

// Static method to get error analysis
SocketEventSchema.statics.getErrorAnalysis = async function(startDate: Date, endDate: Date) {
  const pipeline = [
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate },
        error: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: {
          eventName: '$eventName',
          error: '$error'
        },
        count: { $sum: 1 },
        affectedPlayers: { $addToSet: '$playerId' },
        affectedRooms: { $addToSet: '$roomId' },
        firstOccurrence: { $min: '$timestamp' },
        lastOccurrence: { $max: '$timestamp' }
      }
    },
    {
      $addFields: {
        affectedPlayerCount: { $size: '$affectedPlayers' },
        affectedRoomCount: { $size: '$affectedRooms' }
      }
    },
    {
      $sort: { count: -1 as -1 }
    }
  ];

  return await this.aggregate(pipeline);
};

// Static method to get real-time event stream (for live monitoring)
SocketEventSchema.statics.getRealtimeEvents = async function(limit: number = 100, filters: any = {}) {
  return await this.find(filters)
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('socketId playerId eventName direction timestamp namespace roomId error')
    .lean();
};

// Static method to search events
SocketEventSchema.statics.searchEvents = async function(searchTerm: string, filters: any = {}, limit: number = 100) {
  const searchRegex = new RegExp(searchTerm, 'i');
  
  const searchFilters = {
    ...filters,
    $or: [
      { eventName: searchRegex },
      { 'eventData.message': searchRegex },
      { error: searchRegex },
      { playerId: searchRegex },
      { roomId: searchRegex }
    ]
  };

  return await this.find(searchFilters)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

export const SocketEvent = mongoose.model<ISocketEvent, ISocketEventModel>('SocketEvent', SocketEventSchema);