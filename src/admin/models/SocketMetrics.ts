import mongoose, { Schema, Document } from 'mongoose';

export interface ISocketMetrics extends Document {
  timestamp: Date;
  totalConnections: number;
  activeConnections: number;
  totalRooms: number;
  activeRooms: number;
  totalEvents: number;
  eventsPerSecond: number;
  averageLatency: number;
  errorRate: number;
  bandwidthUsage: {
    incoming: number;
    outgoing: number;
  };
  connectionsByTransport: {
    websocket: number;
    polling: number;
  };
  connectionsByNamespace: Record<string, number>;
  geographicDistribution: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  getConnectionEfficiency(): number;
  getBandwidthPerConnection(): { incoming: number; outgoing: number };
}

export interface ISocketMetricsModel extends mongoose.Model<ISocketMetrics> {
  getMetricsSummary(startDate: Date, endDate: Date): Promise<any>;
  getPeakUsageTimes(days?: number): Promise<any[]>;
}

const SocketMetricsSchema = new Schema<ISocketMetrics>({
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  totalConnections: {
    type: Number,
    required: true,
    min: 0
  },
  activeConnections: {
    type: Number,
    required: true,
    min: 0
  },
  totalRooms: {
    type: Number,
    required: true,
    min: 0
  },
  activeRooms: {
    type: Number,
    required: true,
    min: 0
  },
  totalEvents: {
    type: Number,
    required: true,
    min: 0
  },
  eventsPerSecond: {
    type: Number,
    required: true,
    min: 0
  },
  averageLatency: {
    type: Number,
    required: true,
    min: 0
  },
  errorRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  bandwidthUsage: {
    incoming: {
      type: Number,
      required: true,
      min: 0
    },
    outgoing: {
      type: Number,
      required: true,
      min: 0
    }
  },
  connectionsByTransport: {
    websocket: {
      type: Number,
      required: true,
      min: 0
    },
    polling: {
      type: Number,
      required: true,
      min: 0
    }
  },
  connectionsByNamespace: {
    type: Map,
    of: Number,
    default: new Map()
  },
  geographicDistribution: {
    type: Map,
    of: Number,
    default: new Map()
  }
}, {
  timestamps: true,
  collection: 'socket_metrics'
});

// Indexes for better query performance
SocketMetricsSchema.index({ timestamp: -1 });
SocketMetricsSchema.index({ timestamp: 1, activeConnections: -1 });
SocketMetricsSchema.index({ timestamp: 1, eventsPerSecond: -1 });

// TTL index to automatically delete old metrics after 30 days
SocketMetricsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Virtual for formatted timestamp
SocketMetricsSchema.virtual('formattedTimestamp').get(function() {
  return this.timestamp.toISOString();
});

// Method to calculate connection efficiency
SocketMetricsSchema.methods.getConnectionEfficiency = function() {
  return this.totalConnections > 0 ? (this.activeConnections / this.totalConnections) * 100 : 0;
};

// Method to calculate bandwidth per connection
SocketMetricsSchema.methods.getBandwidthPerConnection = function() {
  if (this.activeConnections === 0) return { incoming: 0, outgoing: 0 };
  
  return {
    incoming: this.bandwidthUsage.incoming / this.activeConnections,
    outgoing: this.bandwidthUsage.outgoing / this.activeConnections
  };
};

// Static method to get metrics summary for a time range
SocketMetricsSchema.statics.getMetricsSummary = async function(startDate: Date, endDate: Date) {
  const pipeline = [
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        avgActiveConnections: { $avg: '$activeConnections' },
        maxActiveConnections: { $max: '$activeConnections' },
        avgEventsPerSecond: { $avg: '$eventsPerSecond' },
        maxEventsPerSecond: { $max: '$eventsPerSecond' },
        avgLatency: { $avg: '$averageLatency' },
        maxLatency: { $max: '$averageLatency' },
        avgErrorRate: { $avg: '$errorRate' },
        maxErrorRate: { $max: '$errorRate' },
        totalBandwidthIncoming: { $sum: '$bandwidthUsage.incoming' },
        totalBandwidthOutgoing: { $sum: '$bandwidthUsage.outgoing' },
        count: { $sum: 1 }
      }
    }
  ];

  const result = await this.aggregate(pipeline);
  return result[0] || null;
};

// Static method to get peak usage times
SocketMetricsSchema.statics.getPeakUsageTimes = async function(days: number = 7) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const pipeline = [
    {
      $match: {
        timestamp: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          hour: { $hour: '$timestamp' },
          dayOfWeek: { $dayOfWeek: '$timestamp' }
        },
        avgActiveConnections: { $avg: '$activeConnections' },
        avgEventsPerSecond: { $avg: '$eventsPerSecond' }
      }
    },
    {
      $sort: { avgActiveConnections: -1 as -1 }
    },
    {
      $limit: 24
    }
  ];

  return await this.aggregate(pipeline);
};

export const SocketMetrics = mongoose.model<ISocketMetrics, ISocketMetricsModel>('SocketMetrics', SocketMetricsSchema);