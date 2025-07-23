import { Schema, model, Document, Types } from 'mongoose';

// Enums for analytics events
export enum EventType {
  // User events
  USER_LOGIN = 'user_login',
  USER_LOGOUT = 'user_logout',
  USER_REGISTER = 'user_register',
  USER_PROFILE_UPDATE = 'user_profile_update',
  
  // Game events
  GAME_START = 'game_start',
  GAME_END = 'game_end',
  GAME_JOIN = 'game_join',
  GAME_LEAVE = 'game_leave',
  GAME_ACTION = 'game_action',
  
  // Room events
  ROOM_CREATE = 'room_create',
  ROOM_JOIN = 'room_join',
  ROOM_LEAVE = 'room_leave',
  
  // Social events
  FRIEND_ADD = 'friend_add',
  FRIEND_REMOVE = 'friend_remove',
  CHAT_MESSAGE = 'chat_message',
  
  // Performance events
  ERROR_OCCURRED = 'error_occurred',
  PERFORMANCE_METRIC = 'performance_metric',
  
  // A/B Testing events
  EXPERIMENT_VIEW = 'experiment_view',
  EXPERIMENT_CONVERSION = 'experiment_conversion'
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  TIMER = 'timer'
}

// Analytics Event interface
export interface IAnalyticsEvent extends Document {
  _id: Types.ObjectId;
  eventType: EventType;
  userId?: Types.ObjectId;
  sessionId?: string;
  gameId?: Types.ObjectId;
  roomId?: Types.ObjectId;
  properties: Record<string, any>;
  timestamp: Date;
  userAgent?: string;
  ipAddress?: string;
  platform?: string;
  version?: string;
}

// Performance Metric interface
export interface IPerformanceMetric extends Document {
  _id: Types.ObjectId;
  metricName: string;
  metricType: MetricType;
  value: number;
  tags: Record<string, string>;
  timestamp: Date;
  source: string;
}

// Error Log interface
export interface IErrorLog extends Document {
  _id: Types.ObjectId;
  errorType: string;
  message: string;
  stack?: string;
  userId?: Types.ObjectId;
  sessionId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  userAgent?: string;
  timestamp: Date;
  resolved: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// A/B Test Experiment interface
export interface IExperiment extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  variants: {
    name: string;
    weight: number;
    config: Record<string, any>;
  }[];
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  targetAudience: {
    userSegments?: string[];
    percentage?: number;
    conditions?: Record<string, any>;
  };
  metrics: {
    primary: string;
    secondary: string[];
  };
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// User Experiment Assignment interface
export interface IUserExperiment extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  experimentId: Types.ObjectId;
  variant: string;
  assignedAt: Date;
  convertedAt?: Date;
  conversionValue?: number;
}

// Analytics Event Schema
const AnalyticsEventSchema = new Schema<IAnalyticsEvent>({
  eventType: {
    type: String,
    enum: Object.values(EventType),
    required: true,
    index: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Player',
    index: true
  },
  sessionId: {
    type: String,
    index: true
  },
  gameId: {
    type: Schema.Types.ObjectId,
    ref: 'Game',
    index: true
  },
  roomId: {
    type: Schema.Types.ObjectId,
    ref: 'Room',
    index: true
  },
  properties: {
    type: Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  userAgent: String,
  ipAddress: String,
  platform: String,
  version: String
}, {
  timestamps: false, // We use our own timestamp field
  collection: 'analytics_events'
});

// Performance Metric Schema
const PerformanceMetricSchema = new Schema<IPerformanceMetric>({
  metricName: {
    type: String,
    required: true,
    index: true
  },
  metricType: {
    type: String,
    enum: Object.values(MetricType),
    required: true
  },
  value: {
    type: Number,
    required: true
  },
  tags: {
    type: Map,
    of: String,
    default: new Map()
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  source: {
    type: String,
    required: true
  }
}, {
  timestamps: false,
  collection: 'performance_metrics'
});

// Error Log Schema
const ErrorLogSchema = new Schema<IErrorLog>({
  errorType: {
    type: String,
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  stack: String,
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Player',
    index: true
  },
  sessionId: {
    type: String,
    index: true
  },
  endpoint: String,
  method: String,
  statusCode: Number,
  userAgent: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  resolved: {
    type: Boolean,
    default: false,
    index: true
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    index: true
  }
}, {
  timestamps: false,
  collection: 'error_logs'
});

// Experiment Schema
const ExperimentSchema = new Schema<IExperiment>({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  variants: [{
    name: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 100 },
    config: { type: Schema.Types.Mixed, default: {} }
  }],
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date,
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  targetAudience: {
    userSegments: [String],
    percentage: { type: Number, min: 0, max: 100 },
    conditions: { type: Schema.Types.Mixed, default: {} }
  },
  metrics: {
    primary: { type: String, required: true },
    secondary: [String]
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'Player',
    required: true
  }
}, {
  timestamps: true,
  collection: 'experiments'
});

// User Experiment Assignment Schema
const UserExperimentSchema = new Schema<IUserExperiment>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Player',
    required: true,
    index: true
  },
  experimentId: {
    type: Schema.Types.ObjectId,
    ref: 'Experiment',
    required: true,
    index: true
  },
  variant: {
    type: String,
    required: true
  },
  assignedAt: {
    type: Date,
    default: Date.now
  },
  convertedAt: Date,
  conversionValue: Number
}, {
  timestamps: false,
  collection: 'user_experiments'
});

// Indexes for optimal query performance
AnalyticsEventSchema.index({ eventType: 1, timestamp: -1 });
AnalyticsEventSchema.index({ userId: 1, timestamp: -1 });
AnalyticsEventSchema.index({ gameId: 1, eventType: 1 });
AnalyticsEventSchema.index({ timestamp: -1 }); // For time-based queries

PerformanceMetricSchema.index({ metricName: 1, timestamp: -1 });
PerformanceMetricSchema.index({ source: 1, timestamp: -1 });

ErrorLogSchema.index({ errorType: 1, timestamp: -1 });
ErrorLogSchema.index({ severity: 1, resolved: 1, timestamp: -1 });

ExperimentSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

UserExperimentSchema.index({ userId: 1, experimentId: 1 }, { unique: true });
UserExperimentSchema.index({ experimentId: 1, variant: 1 });

// Static methods for analytics aggregation
AnalyticsEventSchema.statics.getEventCounts = function(
  startDate: Date,
  endDate: Date,
  eventTypes?: EventType[]
) {
  const match: any = {
    timestamp: { $gte: startDate, $lte: endDate }
  };
  
  if (eventTypes && eventTypes.length > 0) {
    match.eventType = { $in: eventTypes };
  }
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

AnalyticsEventSchema.statics.getUserActivity = function(
  startDate: Date,
  endDate: Date
) {
  return this.aggregate([
    {
      $match: {
        timestamp: { $gte: startDate, $lte: endDate },
        userId: { $exists: true }
      }
    },
    {
      $group: {
        _id: {
          userId: '$userId',
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
        },
        eventCount: { $sum: 1 },
        uniqueEvents: { $addToSet: '$eventType' }
      }
    },
    {
      $group: {
        _id: '$_id.date',
        activeUsers: { $sum: 1 },
        totalEvents: { $sum: '$eventCount' },
        avgEventsPerUser: { $avg: '$eventCount' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

PerformanceMetricSchema.statics.getMetricStats = function(
  metricName: string,
  startDate: Date,
  endDate: Date
) {
  return this.aggregate([
    {
      $match: {
        metricName,
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        avg: { $avg: '$value' },
        min: { $min: '$value' },
        max: { $max: '$value' },
        count: { $sum: 1 },
        sum: { $sum: '$value' }
      }
    }
  ]);
};

export const AnalyticsEvent = model<IAnalyticsEvent>('AnalyticsEvent', AnalyticsEventSchema);
export const PerformanceMetric = model<IPerformanceMetric>('PerformanceMetric', PerformanceMetricSchema);
export const ErrorLog = model<IErrorLog>('ErrorLog', ErrorLogSchema);
export const Experiment = model<IExperiment>('Experiment', ExperimentSchema);
export const UserExperiment = model<IUserExperiment>('UserExperiment', UserExperimentSchema);