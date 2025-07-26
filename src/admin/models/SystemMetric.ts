import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for SystemMetric
export enum MetricType {
  // System performance metrics
  CPU_USAGE = 'system:cpu_usage',
  MEMORY_USAGE = 'system:memory_usage',
  DISK_USAGE = 'system:disk_usage',
  NETWORK_IO = 'system:network_io',
  
  // Database metrics
  DB_CONNECTIONS = 'database:connections',
  DB_QUERY_TIME = 'database:query_time',
  DB_OPERATIONS = 'database:operations',
  DB_SIZE = 'database:size',
  DB_INDEX_USAGE = 'database:index_usage',
  
  // Application metrics
  ACTIVE_USERS = 'app:active_users',
  CONCURRENT_GAMES = 'app:concurrent_games',
  API_REQUESTS = 'app:api_requests',
  API_RESPONSE_TIME = 'app:api_response_time',
  API_ERROR_RATE = 'app:api_error_rate',
  
  // Socket metrics
  SOCKET_CONNECTIONS = 'socket:connections',
  SOCKET_EVENTS = 'socket:events',
  SOCKET_ROOMS = 'socket:rooms',
  SOCKET_LATENCY = 'socket:latency',
  
  // Game metrics
  GAMES_CREATED = 'game:created',
  GAMES_COMPLETED = 'game:completed',
  AVERAGE_GAME_DURATION = 'game:avg_duration',
  PLAYER_RETENTION = 'game:player_retention',
  
  // Security metrics
  FAILED_LOGINS = 'security:failed_logins',
  BLOCKED_IPS = 'security:blocked_ips',
  SUSPICIOUS_ACTIVITY = 'security:suspicious_activity',
  
  // Business metrics
  NEW_REGISTRATIONS = 'business:new_registrations',
  DAILY_ACTIVE_USERS = 'business:daily_active_users',
  USER_ENGAGEMENT = 'business:user_engagement',
  
  // Infrastructure metrics
  SERVER_UPTIME = 'infra:server_uptime',
  LOAD_BALANCER = 'infra:load_balancer',
  CDN_PERFORMANCE = 'infra:cdn_performance',
  
  // Custom metrics
  CUSTOM = 'custom'
}

export enum MetricUnit {
  // Percentage
  PERCENTAGE = 'percentage',
  
  // Time units
  MILLISECONDS = 'milliseconds',
  SECONDS = 'seconds',
  MINUTES = 'minutes',
  HOURS = 'hours',
  
  // Data units
  BYTES = 'bytes',
  KILOBYTES = 'kilobytes',
  MEGABYTES = 'megabytes',
  GIGABYTES = 'gigabytes',
  
  // Count units
  COUNT = 'count',
  RATE = 'rate',
  
  // Network units
  REQUESTS_PER_SECOND = 'requests_per_second',
  BYTES_PER_SECOND = 'bytes_per_second',
  
  // Custom units
  CUSTOM = 'custom'
}

export interface MetricValue {
  value: number;
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface AlertThreshold {
  warning: number;
  critical: number;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
}

export interface ISystemMetric extends Document {
  _id: Types.ObjectId;
  name: string;
  type: MetricType;
  description?: string;
  unit: MetricUnit;
  value: number;
  previousValue?: number;
  tags: Record<string, string>;
  source: string;
  alertThresholds?: AlertThreshold;
  isActive: boolean;
  metadata?: Record<string, any>;
  aggregationPeriod?: number; // in seconds
  retentionPeriod?: number; // in days
  createdAt: Date;
  updatedAt: Date;
  
  // Virtual properties
  changePercentage: number | null;
  alertStatus: string;
  
  // Instance methods
  updateValue(newValue: number, tags?: Record<string, string>): Promise<ISystemMetric>;
  isInAlert(): boolean;
  getFormattedValue(): string;
}

// SystemMetric schema
const SystemMetricSchema = new Schema<ISystemMetric>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    index: true
  },
  type: {
    type: String,
    enum: Object.values(MetricType),
    required: true,
    index: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  unit: {
    type: String,
    enum: Object.values(MetricUnit),
    required: true
  },
  value: {
    type: Number,
    required: true,
    index: true
  },
  previousValue: {
    type: Number
  },
  tags: {
    type: Schema.Types.Mixed,
    default: {},
    index: true
  },
  source: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    index: true
  },
  alertThresholds: {
    warning: { type: Number },
    critical: { type: Number },
    operator: {
      type: String,
      enum: ['gt', 'lt', 'eq', 'gte', 'lte'],
      default: 'gt'
    }
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  aggregationPeriod: {
    type: Number,
    default: 60, // 1 minute
    min: 1
  },
  retentionPeriod: {
    type: Number,
    default: 30, // 30 days
    min: 1
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
SystemMetricSchema.index({ name: 1, createdAt: -1 });
SystemMetricSchema.index({ type: 1, createdAt: -1 });
SystemMetricSchema.index({ source: 1, createdAt: -1 });
SystemMetricSchema.index({ isActive: 1, createdAt: -1 });
SystemMetricSchema.index({ 'tags.environment': 1, createdAt: -1 });
SystemMetricSchema.index({ 'tags.service': 1, createdAt: -1 });

// Compound indexes for common queries
SystemMetricSchema.index({ type: 1, source: 1, createdAt: -1 });
SystemMetricSchema.index({ name: 1, source: 1, createdAt: -1 });
SystemMetricSchema.index({ isActive: 1, type: 1, createdAt: -1 });

// TTL index based on retention period (handled by cleanup job)
SystemMetricSchema.index({ createdAt: 1 });

// Virtual for change percentage
SystemMetricSchema.virtual('changePercentage').get(function() {
  if (!this.previousValue || this.previousValue === 0) {
    return null;
  }
  return ((this.value - this.previousValue) / this.previousValue) * 100;
});

// Virtual for alert status
SystemMetricSchema.virtual('alertStatus').get(function() {
  if (!this.alertThresholds) {
    return 'none';
  }
  
  const { warning, critical, operator } = this.alertThresholds;
  const value = this.value;
  
  const checkThreshold = (threshold: number) => {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'eq': return value === threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  };
  
  if (critical && checkThreshold(critical)) {
    return 'critical';
  }
  if (warning && checkThreshold(warning)) {
    return 'warning';
  }
  
  return 'normal';
});

// Instance methods
SystemMetricSchema.methods.updateValue = function(newValue: number, tags?: Record<string, string>) {
  this.previousValue = this.value;
  this.value = newValue;
  if (tags) {
    this.tags = { ...this.tags, ...tags };
  }
  this.updatedAt = new Date();
  return this.save();
};

SystemMetricSchema.methods.isInAlert = function(): boolean {
  return this.alertStatus === 'warning' || this.alertStatus === 'critical';
};

SystemMetricSchema.methods.getFormattedValue = function(): string {
  const value = this.value;
  const unit = this.unit;
  
  switch (unit) {
    case MetricUnit.PERCENTAGE:
      return `${value.toFixed(2)}%`;
    case MetricUnit.BYTES:
      return `${value} B`;
    case MetricUnit.KILOBYTES:
      return `${(value / 1024).toFixed(2)} KB`;
    case MetricUnit.MEGABYTES:
      return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    case MetricUnit.GIGABYTES:
      return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    case MetricUnit.MILLISECONDS:
      return `${value} ms`;
    case MetricUnit.SECONDS:
      return `${value} s`;
    case MetricUnit.MINUTES:
      return `${value} min`;
    case MetricUnit.HOURS:
      return `${value} h`;
    case MetricUnit.REQUESTS_PER_SECOND:
      return `${value} req/s`;
    case MetricUnit.BYTES_PER_SECOND:
      return `${value} B/s`;
    case MetricUnit.COUNT:
      return value.toString();
    case MetricUnit.RATE:
      return `${value.toFixed(2)}/s`;
    default:
      return value.toString();
  }
};

// Static methods
SystemMetricSchema.statics.recordMetric = function(
  name: string,
  type: MetricType,
  value: number,
  options: {
    unit?: MetricUnit;
    source?: string;
    tags?: Record<string, string>;
    description?: string;
    alertThresholds?: AlertThreshold;
  } = {}
) {
  const metricData = {
    name,
    type,
    value,
    unit: options.unit || MetricUnit.COUNT,
    source: options.source || 'system',
    tags: options.tags || {},
    description: options.description,
    alertThresholds: options.alertThresholds
  };
  
  return this.findOneAndUpdate(
    { name, source: metricData.source },
    { $set: metricData },
    { upsert: true, new: true }
  );
};

SystemMetricSchema.statics.getMetricsByType = function(
  type: MetricType,
  options: {
    limit?: number;
    skip?: number;
    startDate?: Date;
    endDate?: Date;
    source?: string;
    tags?: Record<string, string>;
  } = {}
) {
  const filter: any = { type, isActive: true };
  
  if (options.startDate || options.endDate) {
    filter.createdAt = {};
    if (options.startDate) filter.createdAt.$gte = options.startDate;
    if (options.endDate) filter.createdAt.$lte = options.endDate;
  }
  
  if (options.source) {
    filter.source = options.source;
  }
  
  if (options.tags) {
    Object.entries(options.tags).forEach(([key, value]) => {
      filter[`tags.${key}`] = value;
    });
  }
  
  return this.find(filter)
    .sort({ createdAt: -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0);
};

SystemMetricSchema.statics.getAlertsMetrics = function() {
  return this.find({
    isActive: true,
    alertThresholds: { $exists: true }
  }).sort({ createdAt: -1 });
};

SystemMetricSchema.statics.getMetricStatistics = function(
  type?: MetricType,
  startDate?: Date,
  endDate?: Date
) {
  const matchStage: any = { isActive: true };
  
  if (type) {
    matchStage.type = type;
  }
  
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = startDate;
    if (endDate) matchStage.createdAt.$lte = endDate;
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        averageValue: { $avg: '$value' },
        minValue: { $min: '$value' },
        maxValue: { $max: '$value' },
        sources: { $addToSet: '$source' },
        alertingMetrics: {
          $sum: {
            $cond: [
              { $exists: ['$alertThresholds'] },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

SystemMetricSchema.statics.cleanupOldMetrics = function() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90); // Keep 90 days by default
  
  return this.deleteMany({
    createdAt: { $lt: cutoffDate },
    isActive: false
  });
};

// Pre-save middleware
SystemMetricSchema.pre('save', function(next) {
  // Ensure tags is always an object
  if (!this.tags) {
    this.tags = {};
  }
  
  // Add default tags
  if (!this.tags.environment) {
    this.tags.environment = process.env.NODE_ENV || 'development';
  }
  
  if (!this.tags.service) {
    this.tags.service = 'mafia-game';
  }
  
  next();
});

// Interface for static methods
interface ISystemMetricModel extends mongoose.Model<ISystemMetric> {
  recordMetric(name: string, type: MetricType, value: number, options?: any): Promise<ISystemMetric>;
  getMetricsByType(type: MetricType, options?: any): Promise<ISystemMetric[]>;
  getAlertsMetrics(): Promise<ISystemMetric[]>;
  getMetricStatistics(type?: MetricType, startDate?: Date, endDate?: Date): Promise<any[]>;
  cleanupOldMetrics(): Promise<any>;
}

// Create and export the model using admin connection (lazy initialization)
let _SystemMetric: mongoose.Model<ISystemMetric, ISystemMetricModel>;
export const SystemMetric = new Proxy({} as mongoose.Model<ISystemMetric, ISystemMetricModel>, {
  get(target, prop) {
    if (!_SystemMetric) {
      _SystemMetric = getAdminConnection().model<ISystemMetric, ISystemMetricModel>('SystemMetric', SystemMetricSchema);
    }
    return (_SystemMetric as any)[prop];
  }
});