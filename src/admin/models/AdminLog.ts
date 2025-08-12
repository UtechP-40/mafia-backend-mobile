import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for AdminLog
export enum LogLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug',
  CRITICAL = 'critical'
}

export enum ActionType {
  // Authentication actions
  LOGIN = 'auth:login',
  LOGOUT = 'auth:logout',
  LOGIN_FAILED = 'auth:login_failed',
  PASSWORD_RESET = 'auth:password_reset',
  TOKEN_REFRESH = 'auth:token_refresh',
  
  // Database actions
  DATABASE_READ = 'database:read',
  DATABASE_WRITE = 'database:write',
  DATABASE_DELETE = 'database:delete',
  DATABASE_BACKUP = 'database:backup',
  DATABASE_RESTORE = 'database:restore',
  DATABASE_QUERY = 'database:query',
  
  // User management actions
  USER_CREATE = 'user:create',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  USER_BAN = 'user:ban',
  USER_UNBAN = 'user:unban',
  USER_VIEW = 'user:view',
  
  // Admin management actions
  ADMIN_CREATE = 'admin:create',
  ADMIN_UPDATE = 'admin:update',
  ADMIN_DELETE = 'admin:delete',
  ADMIN_APPROVE = 'admin:approve',
  ADMIN_REJECT = 'admin:reject',
  ADMIN_SUSPEND = 'admin:suspend',
  
  // System actions
  SYSTEM_CONFIG_UPDATE = 'system:config_update',
  SYSTEM_MAINTENANCE = 'system:maintenance',
  SYSTEM_BACKUP = 'system:backup',
  SYSTEM_RESTORE = 'system:restore',
  
  // API actions
  API_TEST = 'api:test',
  API_CALL = 'api:call',
  
  // Socket actions
  SOCKET_MONITOR = 'socket:monitor',
  SOCKET_DISCONNECT = 'socket:disconnect',
  SOCKET_BROADCAST = 'socket:broadcast',
  
  // Analytics actions
  ANALYTICS_VIEW = 'analytics:view',
  ANALYTICS_EXPORT = 'analytics:export',
  
  // Security actions
  SECURITY_ALERT = 'security:alert',
  SECURITY_SCAN = 'security:scan',
  
  // General actions
  VIEW = 'general:view',
  EXPORT = 'general:export',
  IMPORT = 'general:import'
}

export interface RequestInfo {
  method: string;
  url: string;
  userAgent?: string;
  ip: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
  params?: Record<string, any>;
}

export interface ResponseInfo {
  statusCode: number;
  responseTime: number;
  size?: number;
  error?: string;
}

export interface IAdminLog extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  username?: string;
  level: LogLevel;
  action: ActionType;
  message: string;
  details?: Record<string, any>;
  requestInfo?: RequestInfo;
  responseInfo?: ResponseInfo;
  resourceType?: string;
  resourceId?: string;
  sessionId?: string;
  success: boolean;
  duration?: number;
  metadata?: Record<string, any>;
  tags?: string[];
  createdAt: Date;
  
  // Virtual properties
  formattedTimestamp: string;
  severityScore: number;
}

// AdminLog schema
const AdminLogSchema = new Schema<IAdminLog>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    index: true
  },
  username: {
    type: String,
    trim: true,
    maxlength: 100
  },
  level: {
    type: String,
    enum: Object.values(LogLevel),
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: Object.values(ActionType),
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true,
    maxlength: 1000
  },
  details: {
    type: Schema.Types.Mixed,
    default: {}
  },
  requestInfo: {
    method: { type: String, maxlength: 10 },
    url: { type: String, maxlength: 500 },
    userAgent: { type: String, maxlength: 500 },
    ip: { type: String, maxlength: 45 },
    headers: { type: Schema.Types.Mixed },
    body: { type: Schema.Types.Mixed },
    query: { type: Schema.Types.Mixed },
    params: { type: Schema.Types.Mixed }
  },
  responseInfo: {
    statusCode: { type: Number, min: 100, max: 599 },
    responseTime: { type: Number, min: 0 },
    size: { type: Number, min: 0 },
    error: { type: String, maxlength: 1000 }
  },
  resourceType: {
    type: String,
    trim: true,
    maxlength: 50,
    index: true
  },
  resourceId: {
    type: String,
    trim: true,
    maxlength: 100,
    index: true
  },
  sessionId: {
    type: String,
    trim: true,
    maxlength: 100,
    index: true
  },
  success: {
    type: Boolean,
    required: true,
    default: true,
    index: true
  },
  duration: {
    type: Number,
    min: 0
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }]
}, {
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
AdminLogSchema.index({ createdAt: -1 });
AdminLogSchema.index({ userId: 1, createdAt: -1 });
AdminLogSchema.index({ level: 1, createdAt: -1 });
AdminLogSchema.index({ action: 1, createdAt: -1 });
AdminLogSchema.index({ success: 1, createdAt: -1 });
AdminLogSchema.index({ resourceType: 1, resourceId: 1 });
AdminLogSchema.index({ sessionId: 1, createdAt: -1 });
AdminLogSchema.index({ tags: 1 });

// Compound indexes for common queries
AdminLogSchema.index({ userId: 1, action: 1, createdAt: -1 });
AdminLogSchema.index({ level: 1, success: 1, createdAt: -1 });
AdminLogSchema.index({ action: 1, success: 1, createdAt: -1 });

// TTL index to automatically delete old logs (90 days)
AdminLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Virtual for formatted timestamp
AdminLogSchema.virtual('formattedTimestamp').get(function() {
  return this.createdAt.toISOString();
});

// Virtual for log severity score (for sorting/filtering)
AdminLogSchema.virtual('severityScore').get(function() {
  const scores = {
    [LogLevel.DEBUG]: 1,
    [LogLevel.INFO]: 2,
    [LogLevel.WARN]: 3,
    [LogLevel.ERROR]: 4,
    [LogLevel.CRITICAL]: 5
  };
  return scores[this.level] || 0;
});

// Static methods
AdminLogSchema.statics.createLog = function(logData: Partial<IAdminLog>) {
  return this.create({
    ...logData,
    createdAt: new Date()
  });
};

AdminLogSchema.statics.getLogsByUser = function(
  userId: Types.ObjectId,
  options: {
    limit?: number;
    skip?: number;
    startDate?: Date;
    endDate?: Date;
    level?: LogLevel;
    action?: ActionType;
  } = {}
) {
  const filter: any = { userId };
  
  if (options.startDate || options.endDate) {
    filter.createdAt = {};
    if (options.startDate) filter.createdAt.$gte = options.startDate;
    if (options.endDate) filter.createdAt.$lte = options.endDate;
  }
  
  if (options.level) filter.level = options.level;
  if (options.action) filter.action = options.action;
  
  return this.find(filter)
    .sort({ createdAt: -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0)
    .populate('userId', 'username email');
};

AdminLogSchema.statics.getLogsByAction = function(
  action: ActionType,
  options: {
    limit?: number;
    skip?: number;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
  } = {}
) {
  const filter: any = { action };
  
  if (options.startDate || options.endDate) {
    filter.createdAt = {};
    if (options.startDate) filter.createdAt.$gte = options.startDate;
    if (options.endDate) filter.createdAt.$lte = options.endDate;
  }
  
  if (typeof options.success === 'boolean') {
    filter.success = options.success;
  }
  
  return this.find(filter)
    .sort({ createdAt: -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0)
    .populate('userId', 'username email');
};

AdminLogSchema.statics.getSecurityLogs = function(
  options: {
    limit?: number;
    skip?: number;
    startDate?: Date;
    endDate?: Date;
  } = {}
) {
  const securityActions = [
    ActionType.LOGIN_FAILED,
    ActionType.SECURITY_ALERT,
    ActionType.SECURITY_SCAN
  ];
  
  const filter: any = {
    $or: [
      { action: { $in: securityActions } },
      { level: LogLevel.CRITICAL },
      { success: false, level: { $in: [LogLevel.ERROR, LogLevel.WARN] } }
    ]
  };
  
  if (options.startDate || options.endDate) {
    filter.createdAt = {};
    if (options.startDate) filter.createdAt.$gte = options.startDate;
    if (options.endDate) filter.createdAt.$lte = options.endDate;
  }
  
  return this.find(filter)
    .sort({ createdAt: -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0)
    .populate('userId', 'username email');
};

AdminLogSchema.statics.getLogStatistics = function(
  startDate?: Date,
  endDate?: Date
) {
  const matchStage: any = {};
  
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = startDate;
    if (endDate) matchStage.createdAt.$lte = endDate;
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalLogs: { $sum: 1 },
        successfulActions: { $sum: { $cond: ['$success', 1, 0] } },
        failedActions: { $sum: { $cond: ['$success', 0, 1] } },
        logsByLevel: {
          $push: '$level'
        },
        logsByAction: {
          $push: '$action'
        },
        averageResponseTime: {
          $avg: '$responseInfo.responseTime'
        }
      }
    },
    {
      $project: {
        totalLogs: 1,
        successfulActions: 1,
        failedActions: 1,
        successRate: {
          $multiply: [
            { $divide: ['$successfulActions', '$totalLogs'] },
            100
          ]
        },
        logsByLevel: 1,
        logsByAction: 1,
        averageResponseTime: 1
      }
    }
  ]);
};

// Interface for static methods
interface IAdminLogModel extends mongoose.Model<IAdminLog> {
  createLog(logData: Partial<IAdminLog>): Promise<IAdminLog>;
  getLogsByUser(userId: Types.ObjectId, options?: any): Promise<IAdminLog[]>;
  getLogsByAction(action: ActionType, options?: any): Promise<IAdminLog[]>;
  getSecurityLogs(options?: any): Promise<IAdminLog[]>;
  getLogStatistics(startDate?: Date, endDate?: Date): Promise<any[]>;
}

// Type assertion for the proxy
type AdminLogModelType = IAdminLogModel;

// Create and export the model using admin connection (lazy initialization)
let _AdminLog: mongoose.Model<IAdminLog, IAdminLogModel> | null = null;

export const getAdminLogModel = (): mongoose.Model<IAdminLog, IAdminLogModel> => {
  if (!_AdminLog) {
    const connection = getAdminConnection();
    _AdminLog = connection.model<IAdminLog, IAdminLogModel>('AdminLog', AdminLogSchema);
  }
  return _AdminLog;
};

// Export a proxy that delegates to the actual model
export const AdminLog = {
  findOne: (...args: any[]) => getAdminLogModel().findOne(...args),
  find: (...args: any[]) => getAdminLogModel().find(...args),
  findById: (...args: any[]) => getAdminLogModel().findById(...args),
  findByIdAndUpdate: (...args: any[]) => getAdminLogModel().findByIdAndUpdate(...args),
  findByIdAndDelete: (...args: any[]) => getAdminLogModel().findByIdAndDelete(...args),
  create: (...args: any[]) => getAdminLogModel().create(...args),
  insertMany: (...args: any[]) => getAdminLogModel().insertMany(...args),
  updateOne: (...args: any[]) => getAdminLogModel().updateOne(...args),
  updateMany: (...args: any[]) => getAdminLogModel().updateMany(...args),
  deleteOne: (...args: any[]) => getAdminLogModel().deleteOne(...args),
  deleteMany: (...args: any[]) => getAdminLogModel().deleteMany(...args),
  countDocuments: (...args: any[]) => getAdminLogModel().countDocuments(...args),
  aggregate: (...args: any[]) => getAdminLogModel().aggregate(...args),
  distinct: (...args: any[]) => getAdminLogModel().distinct(...args),
  exists: (...args: any[]) => getAdminLogModel().exists(...args),
  // Static methods
  findByUser: (...args: any[]) => getAdminLogModel().findByUser(...args),
  findByAction: (...args: any[]) => getAdminLogModel().findByAction(...args),
  findByLevel: (...args: any[]) => getAdminLogModel().findByLevel(...args),
  findByDateRange: (...args: any[]) => getAdminLogModel().findByDateRange(...args),
  findSecurityEvents: (...args: any[]) => getAdminLogModel().findSecurityEvents(...args),
  getLogStatistics: (...args: any[]) => getAdminLogModel().getLogStatistics(...args),
  cleanupOldLogs: (...args: any[]) => getAdminLogModel().cleanupOldLogs(...args),
  exportLogs: (...args: any[]) => getAdminLogModel().exportLogs(...args),
  searchLogs: (...args: any[]) => getAdminLogModel().searchLogs(...args),
  getAuditTrail: (...args: any[]) => getAdminLogModel().getAuditTrail(...args),
} as mongoose.Model<IAdminLog, IAdminLogModel>;