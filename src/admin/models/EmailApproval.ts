import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for EmailApproval
export enum ApprovalType {
  SUPER_USER_REGISTRATION = 'super_user_registration',
  PERMISSION_CHANGE = 'permission_change',
  ACCOUNT_SUSPENSION = 'account_suspension',
  ACCOUNT_DELETION = 'account_deletion',
  SYSTEM_MAINTENANCE = 'system_maintenance',
  DATA_EXPORT = 'data_export',
  SECURITY_ALERT = 'security_alert',
  CUSTOM = 'custom'
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled'
}

export enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ApprovalData {
  // For super user registration
  userData?: {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    requestedPermissions: string[];
  };
  
  // For permission changes
  permissionData?: {
    userId: Types.ObjectId;
    currentPermissions: string[];
    requestedPermissions: string[];
    reason: string;
  };
  
  // For account actions
  accountData?: {
    userId: Types.ObjectId;
    action: string;
    reason: string;
    duration?: number;
  };
  
  // For system maintenance
  maintenanceData?: {
    type: string;
    scheduledTime: Date;
    estimatedDuration: number;
    affectedServices: string[];
    reason: string;
  };
  
  // For data export
  exportData?: {
    dataType: string;
    dateRange: {
      start: Date;
      end: Date;
    };
    format: string;
    reason: string;
  };
  
  // Custom data
  customData?: Record<string, any>;
}

export interface ApprovalAction {
  actionType: 'approve' | 'reject' | 'request_info' | 'escalate';
  performedBy: Types.ObjectId;
  timestamp: Date;
  comment?: string;
  metadata?: Record<string, any>;
}

export interface IEmailApproval extends Document {
  _id: Types.ObjectId;
  type: ApprovalType;
  title: string;
  description: string;
  requestedBy: Types.ObjectId;
  approvers: Types.ObjectId[];
  requiredApprovals: number;
  currentApprovals: number;
  status: ApprovalStatus;
  priority: Priority;
  data: ApprovalData;
  actions: ApprovalAction[];
  approvalToken: string;
  emailsSent: {
    to: string;
    sentAt: Date;
    type: 'request' | 'reminder' | 'approved' | 'rejected';
    messageId?: string;
  }[];
  expiresAt: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  approvedBy?: Types.ObjectId[];
  rejectedBy?: Types.ObjectId[];
  completedAt?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  
  // Virtual properties
  isExpired: boolean;
  isCompleted: boolean;
  approvalProgress: {
    current: number;
    required: number;
    percentage: number;
  };
  timeRemaining: number;
  formattedTimeRemaining: string;
  
  // Instance methods
  addAction(actionType: 'approve' | 'reject' | 'request_info' | 'escalate', performedBy: Types.ObjectId, comment?: string, metadata?: Record<string, any>): Promise<IEmailApproval>;
  approve(approvedBy: Types.ObjectId, comment?: string): Promise<IEmailApproval>;
  reject(rejectedBy: Types.ObjectId, comment?: string): Promise<IEmailApproval>;
  cancel(cancelledBy: Types.ObjectId, reason?: string): Promise<IEmailApproval>;
  recordEmailSent(to: string, type: 'request' | 'reminder' | 'approved' | 'rejected', messageId?: string): Promise<IEmailApproval>;
  canUserApprove(userId: Types.ObjectId): boolean;
  getApprovalUrl(baseUrl: string): string;
}

// EmailApproval schema
const EmailApprovalSchema = new Schema<IEmailApproval>({
  type: {
    type: String,
    enum: Object.values(ApprovalType),
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  requestedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true,
    index: true
  },
  approvers: [{
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true
  }],
  requiredApprovals: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  currentApprovals: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: Object.values(ApprovalStatus),
    default: ApprovalStatus.PENDING,
    index: true
  },
  priority: {
    type: String,
    enum: Object.values(Priority),
    default: Priority.MEDIUM,
    index: true
  },
  data: {
    userData: {
      username: String,
      email: String,
      firstName: String,
      lastName: String,
      requestedPermissions: [String]
    },
    permissionData: {
      userId: { type: Schema.Types.ObjectId, ref: 'SuperUser' },
      currentPermissions: [String],
      requestedPermissions: [String],
      reason: String
    },
    accountData: {
      userId: { type: Schema.Types.ObjectId, ref: 'SuperUser' },
      action: String,
      reason: String,
      duration: Number
    },
    maintenanceData: {
      type: String,
      scheduledTime: Date,
      estimatedDuration: Number,
      affectedServices: [String],
      reason: String
    },
    exportData: {
      dataType: String,
      dateRange: {
        start: Date,
        end: Date
      },
      format: String,
      reason: String
    },
    customData: Schema.Types.Mixed
  },
  actions: [{
    actionType: {
      type: String,
      enum: ['approve', 'reject', 'request_info', 'escalate'],
      required: true
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser',
      required: true
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now
    },
    comment: {
      type: String,
      maxlength: 500
    },
    metadata: Schema.Types.Mixed
  }],
  approvalToken: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  emailsSent: [{
    to: {
      type: String,
      required: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    sentAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['request', 'reminder', 'approved', 'rejected'],
      required: true
    },
    messageId: String
  }],
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  approvedAt: Date,
  rejectedAt: Date,
  approvedBy: [{
    type: Schema.Types.ObjectId,
    ref: 'SuperUser'
  }],
  rejectedBy: [{
    type: Schema.Types.ObjectId,
    ref: 'SuperUser'
  }],
  completedAt: Date,
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
EmailApprovalSchema.index({ status: 1, createdAt: -1 });
EmailApprovalSchema.index({ type: 1, status: 1 });
EmailApprovalSchema.index({ requestedBy: 1, createdAt: -1 });
EmailApprovalSchema.index({ approvers: 1, status: 1 });
EmailApprovalSchema.index({ priority: 1, status: 1 });
EmailApprovalSchema.index({ expiresAt: 1 });

// TTL index to automatically remove old completed approvals (90 days)
EmailApprovalSchema.index({ completedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Virtual for is expired
EmailApprovalSchema.virtual('isExpired').get(function() {
  return this.expiresAt <= new Date() && this.status === ApprovalStatus.PENDING;
});

// Virtual for is completed
EmailApprovalSchema.virtual('isCompleted').get(function() {
  return [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.EXPIRED, ApprovalStatus.CANCELLED].includes(this.status);
});

// Virtual for approval progress
EmailApprovalSchema.virtual('approvalProgress').get(function() {
  return {
    current: this.currentApprovals,
    required: this.requiredApprovals,
    percentage: Math.round((this.currentApprovals / this.requiredApprovals) * 100)
  };
});

// Virtual for time remaining
EmailApprovalSchema.virtual('timeRemaining').get(function() {
  if (this.isCompleted) return 0;
  return Math.max(0, this.expiresAt.getTime() - new Date().getTime());
});

// Virtual for formatted time remaining
EmailApprovalSchema.virtual('formattedTimeRemaining').get(function() {
  const remaining = this.timeRemaining;
  if (remaining <= 0) return 'Expired';
  
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
});

// Instance methods
EmailApprovalSchema.methods.addAction = function(
  actionType: 'approve' | 'reject' | 'request_info' | 'escalate',
  performedBy: Types.ObjectId,
  comment?: string,
  metadata?: Record<string, any>
) {
  this.actions.push({
    actionType,
    performedBy,
    timestamp: new Date(),
    comment,
    metadata
  });
  
  return this.save();
};

EmailApprovalSchema.methods.approve = function(
  approvedBy: Types.ObjectId,
  comment?: string
) {
  if (this.status !== ApprovalStatus.PENDING) {
    throw new Error('Approval request is not in pending status');
  }
  
  if (!this.approvedBy) {
    this.approvedBy = [];
  }
  
  if (!this.approvedBy.includes(approvedBy)) {
    this.approvedBy.push(approvedBy);
    this.currentApprovals += 1;
  }
  
  this.addAction('approve', approvedBy, comment);
  
  if (this.currentApprovals >= this.requiredApprovals) {
    this.status = ApprovalStatus.APPROVED;
    this.approvedAt = new Date();
    this.completedAt = new Date();
  }
  
  return this.save();
};

EmailApprovalSchema.methods.reject = function(
  rejectedBy: Types.ObjectId,
  comment?: string
) {
  if (this.status !== ApprovalStatus.PENDING) {
    throw new Error('Approval request is not in pending status');
  }
  
  if (!this.rejectedBy) {
    this.rejectedBy = [];
  }
  
  if (!this.rejectedBy.includes(rejectedBy)) {
    this.rejectedBy.push(rejectedBy);
  }
  
  this.addAction('reject', rejectedBy, comment);
  
  this.status = ApprovalStatus.REJECTED;
  this.rejectedAt = new Date();
  this.completedAt = new Date();
  
  return this.save();
};

EmailApprovalSchema.methods.cancel = function(
  cancelledBy: Types.ObjectId,
  reason?: string
) {
  if (this.isCompleted) {
    throw new Error('Cannot cancel completed approval request');
  }
  
  this.status = ApprovalStatus.CANCELLED;
  this.completedAt = new Date();
  this.addAction('escalate', cancelledBy, reason);
  
  return this.save();
};

EmailApprovalSchema.methods.recordEmailSent = function(
  to: string,
  type: 'request' | 'reminder' | 'approved' | 'rejected',
  messageId?: string
) {
  this.emailsSent.push({
    to,
    sentAt: new Date(),
    type,
    messageId
  });
  
  return this.save();
};

EmailApprovalSchema.methods.canUserApprove = function(userId: Types.ObjectId): boolean {
  if (this.status !== ApprovalStatus.PENDING) return false;
  if (this.requestedBy.equals(userId)) return false; // Can't approve own request
  if (this.approvedBy && this.approvedBy.some(id => id.equals(userId))) return false; // Already approved
  
  return this.approvers.some(id => id.equals(userId));
};

EmailApprovalSchema.methods.getApprovalUrl = function(baseUrl: string): string {
  return `${baseUrl}/admin/approvals/${this.approvalToken}`;
};

// Static methods
EmailApprovalSchema.statics.createApproval = function(
  type: ApprovalType,
  title: string,
  description: string,
  requestedBy: Types.ObjectId,
  approvers: Types.ObjectId[],
  data: ApprovalData,
  options: {
    requiredApprovals?: number;
    priority?: Priority;
    expirationHours?: number;
    metadata?: Record<string, any>;
  } = {}
) {
  const crypto = require('crypto');
  const approvalToken = crypto.randomBytes(32).toString('hex');
  
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + (options.expirationHours || 72)); // 3 days default
  
  return this.create({
    type,
    title,
    description,
    requestedBy,
    approvers,
    requiredApprovals: options.requiredApprovals || Math.ceil(approvers.length / 2), // Majority by default
    priority: options.priority || Priority.MEDIUM,
    data,
    approvalToken,
    expiresAt,
    metadata: options.metadata || {}
  });
};

EmailApprovalSchema.statics.findByToken = function(token: string) {
  return this.findOne({ approvalToken: token })
    .populate('requestedBy', 'username email firstName lastName')
    .populate('approvers', 'username email firstName lastName')
    .populate('approvedBy', 'username email firstName lastName')
    .populate('rejectedBy', 'username email firstName lastName');
};

EmailApprovalSchema.statics.getPendingApprovals = function(
  userId?: Types.ObjectId,
  options: {
    limit?: number;
    skip?: number;
    priority?: Priority;
    type?: ApprovalType;
  } = {}
) {
  const filter: any = { status: ApprovalStatus.PENDING };
  
  if (userId) {
    filter.approvers = userId;
  }
  
  if (options.priority) {
    filter.priority = options.priority;
  }
  
  if (options.type) {
    filter.type = options.type;
  }
  
  return this.find(filter)
    .sort({ priority: -1, createdAt: -1 })
    .limit(options.limit || 50)
    .skip(options.skip || 0)
    .populate('requestedBy', 'username email firstName lastName')
    .populate('approvers', 'username email firstName lastName');
};

EmailApprovalSchema.statics.getApprovalHistory = function(
  userId?: Types.ObjectId,
  options: {
    limit?: number;
    skip?: number;
    startDate?: Date;
    endDate?: Date;
    status?: ApprovalStatus;
  } = {}
) {
  const filter: any = {};
  
  if (userId) {
    filter.$or = [
      { requestedBy: userId },
      { approvers: userId },
      { approvedBy: userId },
      { rejectedBy: userId }
    ];
  }
  
  if (options.status) {
    filter.status = options.status;
  }
  
  if (options.startDate || options.endDate) {
    filter.createdAt = {};
    if (options.startDate) filter.createdAt.$gte = options.startDate;
    if (options.endDate) filter.createdAt.$lte = options.endDate;
  }
  
  return this.find(filter)
    .sort({ createdAt: -1 })
    .limit(options.limit || 100)
    .skip(options.skip || 0)
    .populate('requestedBy', 'username email firstName lastName')
    .populate('approvers', 'username email firstName lastName')
    .populate('approvedBy', 'username email firstName lastName')
    .populate('rejectedBy', 'username email firstName lastName');
};

EmailApprovalSchema.statics.expireOldApprovals = function() {
  return this.updateMany(
    {
      status: ApprovalStatus.PENDING,
      expiresAt: { $lte: new Date() }
    },
    {
      $set: {
        status: ApprovalStatus.EXPIRED,
        completedAt: new Date()
      }
    }
  );
};

EmailApprovalSchema.statics.getApprovalStatistics = function(
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
        totalApprovals: { $sum: 1 },
        pendingApprovals: {
          $sum: { $cond: [{ $eq: ['$status', ApprovalStatus.PENDING] }, 1, 0] }
        },
        approvedApprovals: {
          $sum: { $cond: [{ $eq: ['$status', ApprovalStatus.APPROVED] }, 1, 0] }
        },
        rejectedApprovals: {
          $sum: { $cond: [{ $eq: ['$status', ApprovalStatus.REJECTED] }, 1, 0] }
        },
        expiredApprovals: {
          $sum: { $cond: [{ $eq: ['$status', ApprovalStatus.EXPIRED] }, 1, 0] }
        },
        averageApprovalTime: {
          $avg: {
            $subtract: [
              { $ifNull: ['$completedAt', new Date()] },
              '$createdAt'
            ]
          }
        },
        approvalsByType: { $push: '$type' },
        approvalsByPriority: { $push: '$priority' }
      }
    }
  ]);
};

// Pre-save middleware
EmailApprovalSchema.pre('save', function(next) {
  // Check if approval should be expired
  if (this.status === ApprovalStatus.PENDING && this.expiresAt <= new Date()) {
    this.status = ApprovalStatus.EXPIRED;
    this.completedAt = new Date();
  }
  
  next();
});

// Interface for static methods
interface IEmailApprovalModel extends mongoose.Model<IEmailApproval> {
  createApproval(type: ApprovalType, title: string, description: string, requestedBy: Types.ObjectId, approvers: Types.ObjectId[], data: ApprovalData, options?: any): Promise<IEmailApproval>;
  findByToken(token: string): Promise<IEmailApproval | null>;
  getPendingApprovals(userId?: Types.ObjectId, options?: any): Promise<IEmailApproval[]>;
  getApprovalHistory(userId?: Types.ObjectId, options?: any): Promise<IEmailApproval[]>;
  expireOldApprovals(): Promise<any>;
  getApprovalStatistics(startDate?: Date, endDate?: Date): Promise<any[]>;
}

// Create and export the model using admin connection (lazy initialization)
let _EmailApproval: mongoose.Model<IEmailApproval, IEmailApprovalModel>;
export const EmailApproval = new Proxy({} as mongoose.Model<IEmailApproval, IEmailApprovalModel>, {
  get(target, prop) {
    if (!_EmailApproval) {
      _EmailApproval = getAdminConnection().model<IEmailApproval, IEmailApprovalModel>('EmailApproval', EmailApprovalSchema);
    }
    return (_EmailApproval as any)[prop];
  }
});