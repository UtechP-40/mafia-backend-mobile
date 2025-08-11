import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for SuperUser
export enum Permission {
  // Database permissions
  DATABASE_READ = 'database:read',
  DATABASE_WRITE = 'database:write',
  DATABASE_DELETE = 'database:delete',
  DATABASE_BACKUP = 'database:backup',
  DATABASE_RESTORE = 'database:restore',
  
  // User management permissions
  USER_READ = 'user:read',
  USER_WRITE = 'user:write',
  USER_DELETE = 'user:delete',
  USER_BAN = 'user:ban',
  
  // Analytics permissions
  ANALYTICS_READ = 'analytics:read',
  ANALYTICS_EXPORT = 'analytics:export',
  
  // System permissions
  SYSTEM_MONITOR = 'system:monitor',
  SYSTEM_CONFIG = 'system:config',
  SYSTEM_MAINTENANCE = 'system:maintenance',
  
  // Admin management permissions
  ADMIN_READ = 'admin:read',
  ADMIN_WRITE = 'admin:write',
  ADMIN_DELETE = 'admin:delete',
  ADMIN_APPROVE = 'admin:approve',
  
  // API testing permissions
  API_TEST = 'api:test',
  API_MONITOR = 'api:monitor',
  
  // Socket monitoring permissions
  SOCKET_MONITOR = 'socket:monitor',
  SOCKET_MANAGE = 'socket:manage',
  
  // Super admin permission (all permissions)
  SUPER_ADMIN = 'super:admin'
}

export enum SuperUserStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  SUSPENDED = 'suspended',
  REJECTED = 'rejected'
}

export interface ISuperUser extends Document {
  _id: Types.ObjectId;
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  permissions: Permission[];
  status: SuperUserStatus;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  lastLogin?: Date;
  loginAttempts: number;
  lockUntil?: Date;
  refreshTokens: string[];
  twoFactorSecret?: string;
  twoFactorEnabled: boolean;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // Virtual properties
  fullName: string;
  isLocked: boolean;
  
  // Instance methods
  hasPermission(permission: Permission): boolean;
  hasAnyPermission(permissions: Permission[]): boolean;
  addPermission(permission: Permission): void;
  removePermission(permission: Permission): void;
  incrementLoginAttempts(): Promise<ISuperUser>;
  resetLoginAttempts(): Promise<ISuperUser>;
  updateLastLogin(): Promise<ISuperUser>;
}

// SuperUser schema
const SuperUserSchema = new Schema<ISuperUser>({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9_-]+$/
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    type: String,
    required: true,
    select: false,
    minlength: 8
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  permissions: [{
    type: String,
    enum: Object.values(Permission),
    required: true
  }],
  status: {
    type: String,
    enum: Object.values(SuperUserStatus),
    default: SuperUserStatus.PENDING
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser'
  },
  approvedAt: {
    type: Date
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  lockUntil: {
    type: Date
  },
  refreshTokens: [{
    type: String,
    select: false
  }],
  twoFactorSecret: {
    type: String,
    select: false
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  passwordResetToken: {
    type: String,
    select: false
  },
  passwordResetExpires: {
    type: Date,
    select: false
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete (ret as any).password;
      delete (ret as any).refreshTokens;
      delete (ret as any).twoFactorSecret;
      delete (ret as any).passwordResetToken;
      delete (ret as any).passwordResetExpires;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
SuperUserSchema.index({ username: 1 });
SuperUserSchema.index({ email: 1 });
SuperUserSchema.index({ status: 1 });
SuperUserSchema.index({ permissions: 1 });
SuperUserSchema.index({ lastLogin: -1 });
SuperUserSchema.index({ createdAt: -1 });

// Virtual for full name
SuperUserSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for account lock status
SuperUserSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > new Date());
});

// Instance methods
SuperUserSchema.methods.hasPermission = function(permission: Permission): boolean {
  return this.permissions.includes(Permission.SUPER_ADMIN) || 
         this.permissions.includes(permission);
};

SuperUserSchema.methods.hasAnyPermission = function(permissions: Permission[]): boolean {
  if (this.permissions.includes(Permission.SUPER_ADMIN)) {
    return true;
  }
  return permissions.some(permission => this.permissions.includes(permission));
};

SuperUserSchema.methods.addPermission = function(permission: Permission): void {
  if (!this.permissions.includes(permission)) {
    this.permissions.push(permission);
  }
};

SuperUserSchema.methods.removePermission = function(permission: Permission): void {
  this.permissions = this.permissions.filter((p: Permission) => p !== permission);
};

SuperUserSchema.methods.incrementLoginAttempts = function(): Promise<ISuperUser> {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < new Date()) {
    return this.updateOne({
      $set: {
        loginAttempts: 1
      },
      $unset: {
        lockUntil: 1
      }
    });
  }
  
  const updates: any = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: new Date(Date.now() + 2 * 60 * 60 * 1000) }; // 2 hours
  }
  
  return this.updateOne(updates);
};

SuperUserSchema.methods.resetLoginAttempts = function(): Promise<ISuperUser> {
  return this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1
    }
  });
};

SuperUserSchema.methods.updateLastLogin = function(): Promise<ISuperUser> {
  return this.updateOne({
    $set: { lastLogin: new Date() }
  });
};

// Pre-save middleware
SuperUserSchema.pre('save', function(next) {
  // Ensure super admin has all permissions
  if (this.permissions.includes(Permission.SUPER_ADMIN)) {
    this.permissions = [Permission.SUPER_ADMIN];
  }
  
  // Set approval date when status changes to approved
  if (this.isModified('status') && this.status === SuperUserStatus.APPROVED && !this.approvedAt) {
    this.approvedAt = new Date();
  }
  
  next();
});

// Create and export the model using admin connection (lazy initialization)
let _SuperUser: mongoose.Model<ISuperUser> | null = null;

export const getSuperUserModel = (): mongoose.Model<ISuperUser> => {
  if (!_SuperUser) {
    const connection = getAdminConnection();
    _SuperUser = connection.model<ISuperUser>('SuperUser', SuperUserSchema);
  }
  return _SuperUser;
};

// Export a proxy that delegates to the actual model
export const SuperUser = {
  findOne: (...args: any[]) => getSuperUserModel().findOne(...args),
  find: (...args: any[]) => getSuperUserModel().find(...args),
  findById: (...args: any[]) => getSuperUserModel().findById(...args),
  findByIdAndUpdate: (...args: any[]) => getSuperUserModel().findByIdAndUpdate(...args),
  findByIdAndDelete: (...args: any[]) => getSuperUserModel().findByIdAndDelete(...args),
  create: (...args: any[]) => getSuperUserModel().create(...args),
  insertMany: (...args: any[]) => getSuperUserModel().insertMany(...args),
  updateOne: (...args: any[]) => getSuperUserModel().updateOne(...args),
  updateMany: (...args: any[]) => getSuperUserModel().updateMany(...args),
  deleteOne: (...args: any[]) => getSuperUserModel().deleteOne(...args),
  deleteMany: (...args: any[]) => getSuperUserModel().deleteMany(...args),
  countDocuments: (...args: any[]) => getSuperUserModel().countDocuments(...args),
  aggregate: (...args: any[]) => getSuperUserModel().aggregate(...args),
  distinct: (...args: any[]) => getSuperUserModel().distinct(...args),
  exists: (...args: any[]) => getSuperUserModel().exists(...args),
  // Add any other methods you need
} as mongoose.Model<ISuperUser>;