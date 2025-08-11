import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for AdminSession
export enum SessionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
  SUSPENDED = 'suspended'
}

export interface SessionActivity {
  action: string;
  timestamp: Date;
  ip: string;
  userAgent?: string;
  details?: Record<string, any>;
}

export interface IAdminSession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  sessionToken: string;
  refreshToken: string;
  status: SessionStatus;
  ipAddress: string;
  userAgent?: string;
  deviceInfo?: {
    browser?: string;
    os?: string;
    device?: string;
    isMobile?: boolean;
  };
  location?: {
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
  };
  loginTime: Date;
  lastActivity: Date;
  expiresAt: Date;
  activities: SessionActivity[];
  permissions: string[];
  metadata?: Record<string, any>;
  terminatedBy?: Types.ObjectId;
  terminatedAt?: Date;
  terminationReason?: string;
  createdAt: Date;
  updatedAt: Date;
  
  // Virtual properties
  duration: number;
  formattedDuration: string;
  isActive: boolean;
  isExpired: boolean;
  activityCount: number;
  
  // Instance methods
  updateActivity(action: string, ip: string, userAgent?: string, details?: Record<string, any>): Promise<IAdminSession>;
  terminate(terminatedBy?: Types.ObjectId, reason?: string): Promise<IAdminSession>;
  suspend(reason?: string): Promise<IAdminSession>;
  extend(additionalMinutes?: number): Promise<IAdminSession>;
  isFromSameDevice(userAgent: string, ip: string): boolean;
  getRecentActivities(limit?: number): SessionActivity[];
}

// AdminSession schema
const AdminSessionSchema = new Schema<IAdminSession>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true,
    index: true
  },
  sessionToken: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  refreshToken: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: Object.values(SessionStatus),
    default: SessionStatus.ACTIVE,
    index: true
  },
  ipAddress: {
    type: String,
    required: true,
    maxlength: 45, // IPv6 max length
    index: true
  },
  userAgent: {
    type: String,
    maxlength: 500
  },
  deviceInfo: {
    browser: { type: String, maxlength: 100 },
    os: { type: String, maxlength: 100 },
    device: { type: String, maxlength: 100 },
    isMobile: { type: Boolean, default: false }
  },
  location: {
    country: { type: String, maxlength: 100 },
    region: { type: String, maxlength: 100 },
    city: { type: String, maxlength: 100 },
    timezone: { type: String, maxlength: 50 }
  },
  loginTime: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  lastActivity: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  activities: [{
    action: { type: String, required: true, maxlength: 100 },
    timestamp: { type: Date, required: true, default: Date.now },
    ip: { type: String, required: true, maxlength: 45 },
    userAgent: { type: String, maxlength: 500 },
    details: { type: Schema.Types.Mixed }
  }],
  permissions: [{
    type: String,
    maxlength: 100
  }],
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  terminatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser'
  },
  terminatedAt: {
    type: Date
  },
  terminationReason: {
    type: String,
    maxlength: 500
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.sessionToken;
      delete ret.refreshToken;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
AdminSessionSchema.index({ userId: 1, status: 1 });
AdminSessionSchema.index({ status: 1, expiresAt: 1 });
AdminSessionSchema.index({ lastActivity: -1 });
AdminSessionSchema.index({ loginTime: -1 });
AdminSessionSchema.index({ ipAddress: 1, loginTime: -1 });

// TTL index to automatically remove expired sessions
AdminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for session duration
AdminSessionSchema.virtual('duration').get(function() {
  const endTime = this.terminatedAt || this.lastActivity || new Date();
  return endTime.getTime() - this.loginTime.getTime();
});

// Virtual for formatted duration
AdminSessionSchema.virtual('formattedDuration').get(function() {
  const duration = this.duration;
  const hours = Math.floor(duration / (1000 * 60 * 60));
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((duration % (1000 * 60)) / 1000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
});

// Virtual for is active
AdminSessionSchema.virtual('isActive').get(function() {
  return this.status === SessionStatus.ACTIVE && this.expiresAt > new Date();
});

// Virtual for is expired
AdminSessionSchema.virtual('isExpired').get(function() {
  return this.expiresAt <= new Date() || this.status === SessionStatus.EXPIRED;
});

// Virtual for activity count
AdminSessionSchema.virtual('activityCount').get(function() {
  return this.activities.length;
});

// Instance methods
AdminSessionSchema.methods.updateActivity = function(
  action: string,
  ip: string,
  userAgent?: string,
  details?: Record<string, any>
) {
  this.lastActivity = new Date();
  this.activities.push({
    action,
    timestamp: new Date(),
    ip,
    userAgent,
    details
  });
  
  // Keep only last 100 activities to prevent document from growing too large
  if (this.activities.length > 100) {
    this.activities = this.activities.slice(-100);
  }
  
  return this.save();
};

AdminSessionSchema.methods.terminate = function(
  terminatedBy?: Types.ObjectId,
  reason?: string
) {
  this.status = SessionStatus.TERMINATED;
  this.terminatedAt = new Date();
  if (terminatedBy) {
    this.terminatedBy = terminatedBy;
  }
  if (reason) {
    this.terminationReason = reason;
  }
  return this.save();
};

AdminSessionSchema.methods.suspend = function(reason?: string) {
  this.status = SessionStatus.SUSPENDED;
  if (reason) {
    this.terminationReason = reason;
  }
  return this.save();
};

AdminSessionSchema.methods.extend = function(additionalMinutes: number = 60) {
  const newExpiryTime = new Date(this.expiresAt.getTime() + (additionalMinutes * 60 * 1000));
  this.expiresAt = newExpiryTime;
  this.lastActivity = new Date();
  return this.save();
};

AdminSessionSchema.methods.isFromSameDevice = function(userAgent: string, ip: string): boolean {
  return this.userAgent === userAgent && this.ipAddress === ip;
};

AdminSessionSchema.methods.getRecentActivities = function(limit: number = 10): SessionActivity[] {
  return this.activities
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
};

// Static methods
AdminSessionSchema.statics.createSession = function(
  userId: Types.ObjectId,
  sessionToken: string,
  refreshToken: string,
  options: {
    ipAddress: string;
    userAgent?: string;
    deviceInfo?: any;
    location?: any;
    permissions?: string[];
    expirationMinutes?: number;
  }
) {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + (options.expirationMinutes || 480)); // 8 hours default
  
  return this.create({
    userId,
    sessionToken,
    refreshToken,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    deviceInfo: options.deviceInfo,
    location: options.location,
    permissions: options.permissions || [],
    expiresAt,
    activities: [{
      action: 'login',
      timestamp: new Date(),
      ip: options.ipAddress,
      userAgent: options.userAgent
    }]
  });
};

AdminSessionSchema.statics.findActiveSession = function(sessionToken: string) {
  return this.findOne({
    sessionToken,
    status: SessionStatus.ACTIVE,
    expiresAt: { $gt: new Date() }
  }).populate('userId', 'username email permissions');
};

AdminSessionSchema.statics.findUserSessions = function(
  userId: Types.ObjectId,
  activeOnly: boolean = false
) {
  const filter: any = { userId };
  
  if (activeOnly) {
    filter.status = SessionStatus.ACTIVE;
    filter.expiresAt = { $gt: new Date() };
  }
  
  return this.find(filter)
    .sort({ lastActivity: -1 })
    .populate('userId', 'username email')
    .populate('terminatedBy', 'username email');
};

AdminSessionSchema.statics.terminateUserSessions = function(
  userId: Types.ObjectId,
  excludeSessionId?: Types.ObjectId,
  terminatedBy?: Types.ObjectId,
  reason?: string
) {
  const filter: any = {
    userId,
    status: SessionStatus.ACTIVE
  };
  
  if (excludeSessionId) {
    filter._id = { $ne: excludeSessionId };
  }
  
  return this.updateMany(filter, {
    $set: {
      status: SessionStatus.TERMINATED,
      terminatedAt: new Date(),
      terminatedBy,
      terminationReason: reason || 'Terminated by admin'
    }
  });
};

AdminSessionSchema.statics.cleanupExpiredSessions = function() {
  return this.updateMany(
    {
      status: SessionStatus.ACTIVE,
      expiresAt: { $lte: new Date() }
    },
    {
      $set: {
        status: SessionStatus.EXPIRED
      }
    }
  );
};

AdminSessionSchema.statics.getSessionStatistics = function(
  startDate?: Date,
  endDate?: Date
) {
  const matchStage: any = {};
  
  if (startDate || endDate) {
    matchStage.loginTime = {};
    if (startDate) matchStage.loginTime.$gte = startDate;
    if (endDate) matchStage.loginTime.$lte = endDate;
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        activeSessions: {
          $sum: {
            $cond: [
              { $eq: ['$status', SessionStatus.ACTIVE] },
              1,
              0
            ]
          }
        },
        expiredSessions: {
          $sum: {
            $cond: [
              { $eq: ['$status', SessionStatus.EXPIRED] },
              1,
              0
            ]
          }
        },
        terminatedSessions: {
          $sum: {
            $cond: [
              { $eq: ['$status', SessionStatus.TERMINATED] },
              1,
              0
            ]
          }
        },
        averageDuration: {
          $avg: {
            $subtract: [
              { $ifNull: ['$terminatedAt', '$lastActivity'] },
              '$loginTime'
            ]
          }
        },
        uniqueUsers: { $addToSet: '$userId' },
        uniqueIPs: { $addToSet: '$ipAddress' }
      }
    },
    {
      $project: {
        totalSessions: 1,
        activeSessions: 1,
        expiredSessions: 1,
        terminatedSessions: 1,
        averageDuration: 1,
        uniqueUserCount: { $size: '$uniqueUsers' },
        uniqueIPCount: { $size: '$uniqueIPs' }
      }
    }
  ]);
};

AdminSessionSchema.statics.getSuspiciousActivities = function(
  options: {
    limit?: number;
    startDate?: Date;
    endDate?: Date;
  } = {}
) {
  const matchStage: any = {};
  
  if (options.startDate || options.endDate) {
    matchStage.loginTime = {};
    if (options.startDate) matchStage.loginTime.$gte = options.startDate;
    if (options.endDate) matchStage.loginTime.$lte = options.endDate;
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$ipAddress',
        sessionCount: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
        sessions: { $push: '$$ROOT' }
      }
    },
    {
      $match: {
        $or: [
          { sessionCount: { $gte: 10 } }, // Many sessions from same IP
          { 'uniqueUsers.1': { $exists: true } } // Multiple users from same IP
        ]
      }
    },
    {
      $project: {
        ipAddress: '$_id',
        sessionCount: 1,
        uniqueUserCount: { $size: '$uniqueUsers' },
        sessions: 1
      }
    },
    { $sort: { sessionCount: -1 } },
    { $limit: options.limit || 50 }
  ]);
};

// Pre-save middleware
AdminSessionSchema.pre('save', function(next) {
  // Update last activity timestamp
  if (this.isModified() && !this.isModified('lastActivity')) {
    this.lastActivity = new Date();
  }
  
  next();
});

// Interface for static methods
interface IAdminSessionModel extends mongoose.Model<IAdminSession> {
  createSession(userId: Types.ObjectId, sessionToken: string, refreshToken: string, options: any): Promise<IAdminSession>;
  findActiveSession(sessionToken: string): Promise<IAdminSession | null>;
  findUserSessions(userId: Types.ObjectId, activeOnly?: boolean): Promise<IAdminSession[]>;
  terminateUserSessions(userId: Types.ObjectId, excludeSessionId?: Types.ObjectId, terminatedBy?: Types.ObjectId, reason?: string): Promise<any>;
  cleanupExpiredSessions(): Promise<any>;
  getSessionStatistics(startDate?: Date, endDate?: Date): Promise<any[]>;
  getSuspiciousActivities(options?: any): Promise<any[]>;
}

// Create and export the model using admin connection (lazy initialization)
let _AdminSession: mongoose.Model<IAdminSession, IAdminSessionModel> | null = null;

export const getAdminSessionModel = (): mongoose.Model<IAdminSession, IAdminSessionModel> => {
  if (!_AdminSession) {
    const connection = getAdminConnection();
    _AdminSession = connection.model<IAdminSession, IAdminSessionModel>('AdminSession', AdminSessionSchema);
  }
  return _AdminSession;
};

// Export a proxy that delegates to the actual model
export const AdminSession = {
  findOne: (...args: any[]) => getAdminSessionModel().findOne(...args),
  find: (...args: any[]) => getAdminSessionModel().find(...args),
  findById: (...args: any[]) => getAdminSessionModel().findById(...args),
  findByIdAndUpdate: (...args: any[]) => getAdminSessionModel().findByIdAndUpdate(...args),
  findByIdAndDelete: (...args: any[]) => getAdminSessionModel().findByIdAndDelete(...args),
  create: (...args: any[]) => getAdminSessionModel().create(...args),
  insertMany: (...args: any[]) => getAdminSessionModel().insertMany(...args),
  updateOne: (...args: any[]) => getAdminSessionModel().updateOne(...args),
  updateMany: (...args: any[]) => getAdminSessionModel().updateMany(...args),
  deleteOne: (...args: any[]) => getAdminSessionModel().deleteOne(...args),
  deleteMany: (...args: any[]) => getAdminSessionModel().deleteMany(...args),
  countDocuments: (...args: any[]) => getAdminSessionModel().countDocuments(...args),
  aggregate: (...args: any[]) => getAdminSessionModel().aggregate(...args),
  distinct: (...args: any[]) => getAdminSessionModel().distinct(...args),
  exists: (...args: any[]) => getAdminSessionModel().exists(...args),
  // Static methods
  createSession: (...args: any[]) => getAdminSessionModel().createSession(...args),
  findActiveSession: (...args: any[]) => getAdminSessionModel().findActiveSession(...args),
  findUserSessions: (...args: any[]) => getAdminSessionModel().findUserSessions(...args),
  terminateUserSessions: (...args: any[]) => getAdminSessionModel().terminateUserSessions(...args),
  cleanupExpiredSessions: (...args: any[]) => getAdminSessionModel().cleanupExpiredSessions(...args),
  getSessionStatistics: (...args: any[]) => getAdminSessionModel().getSessionStatistics(...args),
  getSuspiciousActivities: (...args: any[]) => getAdminSessionModel().getSuspiciousActivities(...args),
} as mongoose.Model<IAdminSession, IAdminSessionModel>;