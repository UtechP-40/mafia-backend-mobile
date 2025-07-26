import { Types, Document, Model, FilterQuery, UpdateQuery, PipelineStage } from 'mongoose';
import { SuperUser, ISuperUser } from '../models/SuperUser';
import { AdminLog, IAdminLog, LogLevel, ActionType } from '../models/AdminLog';
import { SystemMetric, ISystemMetric, MetricType } from '../models/SystemMetric';
import { AdminSession, IAdminSession, SessionStatus } from '../models/AdminSession';
import { EmailApproval, IEmailApproval, ApprovalStatus } from '../models/EmailApproval';
import { adminLogger } from '../config/logger';

// Generic Admin Database Operations
export class AdminDatabaseUtils {
  /**
   * Generic create operation for admin models
   */
  static async create<T extends Document>(
    model: Model<T>,
    data: Partial<T>
  ): Promise<T> {
    try {
      const document = new model(data);
      const result = await document.save();
      
      adminLogger.info(`Created ${model.modelName} document`, {
        modelName: model.modelName,
        documentId: result._id
      });
      
      return result;
    } catch (error) {
      adminLogger.error(`Error creating document in ${model.modelName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        data
      });
      throw error;
    }
  }

  /**
   * Generic find by ID operation for admin models
   */
  static async findById<T extends Document>(
    model: Model<T>,
    id: string | Types.ObjectId,
    populate?: string | string[]
  ): Promise<T | null> {
    try {
      let query = model.findById(id);
      if (populate) {
        query = query.populate(populate);
      }
      return await query.exec();
    } catch (error) {
      adminLogger.error(`Error finding document by ID in ${model.modelName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        id
      });
      throw error;
    }
  }

  /**
   * Generic find operation with advanced filtering for admin models
   */
  static async find<T extends Document>(
    model: Model<T>,
    filter: FilterQuery<T> = {},
    options: {
      populate?: string | string[];
      sort?: any;
      limit?: number;
      skip?: number;
      select?: string;
    } = {}
  ): Promise<T[]> {
    try {
      let query = model.find(filter);
      
      if (options.populate) {
        query = query.populate(options.populate);
      }
      if (options.sort) {
        query = query.sort(options.sort);
      }
      if (options.limit) {
        query = query.limit(options.limit);
      }
      if (options.skip) {
        query = query.skip(options.skip);
      }
      if (options.select) {
        query = query.select(options.select) as any;
      }
      
      return await query.exec();
    } catch (error) {
      adminLogger.error(`Error finding documents in ${model.modelName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        filter
      });
      throw error;
    }
  }

  /**
   * Generic update by ID operation for admin models
   */
  static async updateById<T extends Document>(
    model: Model<T>,
    id: string | Types.ObjectId,
    update: UpdateQuery<T>,
    options: { new?: boolean; runValidators?: boolean } = { new: true, runValidators: true }
  ): Promise<T | null> {
    try {
      const result = await model.findByIdAndUpdate(id, update, options).exec();
      
      if (result) {
        adminLogger.info(`Updated ${model.modelName} document`, {
          modelName: model.modelName,
          documentId: id
        });
      }
      
      return result;
    } catch (error) {
      adminLogger.error(`Error updating document by ID in ${model.modelName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        id,
        update
      });
      throw error;
    }
  }

  /**
   * Generic delete by ID operation for admin models
   */
  static async deleteById<T extends Document>(
    model: Model<T>,
    id: string | Types.ObjectId
  ): Promise<T | null> {
    try {
      const result = await model.findByIdAndDelete(id).exec();
      
      if (result) {
        adminLogger.info(`Deleted ${model.modelName} document`, {
          modelName: model.modelName,
          documentId: id
        });
      }
      
      return result;
    } catch (error) {
      adminLogger.error(`Error deleting document by ID in ${model.modelName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        id
      });
      throw error;
    }
  }

  /**
   * Generic aggregation operation for admin models
   */
  static async aggregate<T extends Document, R = any>(
    model: Model<T>,
    pipeline: PipelineStage[]
  ): Promise<R[]> {
    try {
      return await model.aggregate(pipeline).exec();
    } catch (error) {
      adminLogger.error(`Error in aggregation for ${model.modelName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        pipeline
      });
      throw error;
    }
  }

  /**
   * Generic count operation for admin models
   */
  static async count<T extends Document>(
    model: Model<T>,
    filter: FilterQuery<T> = {}
  ): Promise<number> {
    try {
      return await model.countDocuments(filter).exec();
    } catch (error) {
      adminLogger.error(`Error counting documents in ${model.modelName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        filter
      });
      throw error;
    }
  }
}

// Specialized SuperUser Operations
export class SuperUserOperations {
  /**
   * Create a new super user with approval workflow
   */
  static async createSuperUser(userData: {
    username: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    permissions: string[];
  }): Promise<ISuperUser> {
    try {
      const superUser = await AdminDatabaseUtils.create(SuperUser, userData);
      
      // Log the creation
      await AdminLogOperations.createLog({
        level: LogLevel.INFO,
        action: ActionType.ADMIN_CREATE,
        message: `Super user created: ${userData.username}`,
        details: { username: userData.username, email: userData.email },
        success: true
      });
      
      return superUser;
    } catch (error) {
      await AdminLogOperations.createLog({
        level: LogLevel.ERROR,
        action: ActionType.ADMIN_CREATE,
        message: `Failed to create super user: ${userData.username}`,
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
        success: false
      });
      throw error;
    }
  }

  /**
   * Find super users by permission
   */
  static async findByPermission(permission: string): Promise<ISuperUser[]> {
    return AdminDatabaseUtils.find(SuperUser, {
      permissions: permission,
      status: 'approved'
    });
  }

  /**
   * Get super user statistics
   */
  static async getStatistics() {
    return AdminDatabaseUtils.aggregate(SuperUser, [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          users: { $push: { username: '$username', email: '$email' } }
        }
      }
    ]);
  }

  /**
   * Update super user permissions
   */
  static async updatePermissions(
    userId: Types.ObjectId,
    permissions: string[],
    updatedBy?: Types.ObjectId
  ): Promise<ISuperUser | null> {
    try {
      const result = await AdminDatabaseUtils.updateById(SuperUser, userId, {
        permissions,
        updatedAt: new Date()
      });
      
      if (result) {
        await AdminLogOperations.createLog({
          userId: updatedBy,
          level: LogLevel.INFO,
          action: ActionType.ADMIN_UPDATE,
          message: `Updated permissions for super user: ${result.username}`,
          details: { userId, permissions },
          success: true
        });
      }
      
      return result;
    } catch (error) {
      await AdminLogOperations.createLog({
        userId: updatedBy,
        level: LogLevel.ERROR,
        action: ActionType.ADMIN_UPDATE,
        message: `Failed to update permissions for super user`,
        details: { userId, error: error instanceof Error ? error.message : 'Unknown error' },
        success: false
      });
      throw error;
    }
  }
}

// Specialized AdminLog Operations
export class AdminLogOperations {
  /**
   * Create a new admin log entry
   */
  static async createLog(logData: Partial<IAdminLog>): Promise<IAdminLog> {
    return AdminDatabaseUtils.create(AdminLog, {
      ...logData,
      createdAt: new Date()
    });
  }

  /**
   * Get logs by user with advanced filtering
   */
  static async getLogsByUser(
    userId: Types.ObjectId,
    options: {
      limit?: number;
      skip?: number;
      startDate?: Date;
      endDate?: Date;
      level?: LogLevel;
      action?: ActionType;
      success?: boolean;
    } = {}
  ): Promise<IAdminLog[]> {
    const filter: any = { userId };
    
    if (options.startDate || options.endDate) {
      filter.createdAt = {};
      if (options.startDate) filter.createdAt.$gte = options.startDate;
      if (options.endDate) filter.createdAt.$lte = options.endDate;
    }
    
    if (options.level) filter.level = options.level;
    if (options.action) filter.action = options.action;
    if (typeof options.success === 'boolean') filter.success = options.success;
    
    return AdminDatabaseUtils.find(AdminLog, filter, {
      sort: { createdAt: -1 },
      limit: options.limit || 100,
      skip: options.skip || 0,
      populate: 'userId'
    });
  }

  /**
   * Get security-related logs
   */
  static async getSecurityLogs(options: {
    limit?: number;
    skip?: number;
    startDate?: Date;
    endDate?: Date;
  } = {}): Promise<IAdminLog[]> {
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
    
    return AdminDatabaseUtils.find(AdminLog, filter, {
      sort: { createdAt: -1 },
      limit: options.limit || 100,
      skip: options.skip || 0,
      populate: 'userId'
    });
  }

  /**
   * Get log analytics
   */
  static async getLogAnalytics(
    startDate?: Date,
    endDate?: Date
  ) {
    const matchStage: any = {};
    
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }
    
    return AdminDatabaseUtils.aggregate(AdminLog, [
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
      }
    ]);
  }
}

// Specialized SystemMetric Operations
export class SystemMetricOperations {
  /**
   * Record a new system metric
   */
  static async recordMetric(
    name: string,
    type: MetricType,
    value: number,
    options: {
      unit?: string;
      source?: string;
      tags?: Record<string, string>;
      description?: string;
    } = {}
  ): Promise<ISystemMetric> {
    const metricData = {
      name,
      type,
      value,
      unit: options.unit || 'count',
      source: options.source || 'admin-system',
      tags: options.tags || {},
      description: options.description
    };
    
    // Try to update existing metric or create new one
    const existingMetric = await SystemMetric.findOne({
      name,
      source: metricData.source
    });
    
    if (existingMetric) {
      existingMetric.previousValue = existingMetric.value;
      existingMetric.value = value;
      existingMetric.tags = { ...existingMetric.tags, ...metricData.tags };
      existingMetric.updatedAt = new Date();
      return await existingMetric.save();
    } else {
      return AdminDatabaseUtils.create(SystemMetric, metricData);
    }
  }

  /**
   * Get metrics by type with time series data
   */
  static async getMetricsByType(
    type: MetricType,
    options: {
      limit?: number;
      startDate?: Date;
      endDate?: Date;
      source?: string;
    } = {}
  ): Promise<ISystemMetric[]> {
    const filter: any = { type, isActive: true };
    
    if (options.startDate || options.endDate) {
      filter.createdAt = {};
      if (options.startDate) filter.createdAt.$gte = options.startDate;
      if (options.endDate) filter.createdAt.$lte = options.endDate;
    }
    
    if (options.source) {
      filter.source = options.source;
    }
    
    return AdminDatabaseUtils.find(SystemMetric, filter, {
      sort: { createdAt: -1 },
      limit: options.limit || 100
    });
  }

  /**
   * Get metrics in alert state
   */
  static async getAlertsMetrics(): Promise<ISystemMetric[]> {
    return AdminDatabaseUtils.find(SystemMetric, {
      isActive: true,
      alertThresholds: { $exists: true }
    });
  }

  /**
   * Get system health overview
   */
  static async getSystemHealth() {
    const [cpuMetrics, memoryMetrics, dbMetrics] = await Promise.all([
      this.getMetricsByType(MetricType.CPU_USAGE, { limit: 1 }),
      this.getMetricsByType(MetricType.MEMORY_USAGE, { limit: 1 }),
      this.getMetricsByType(MetricType.DB_CONNECTIONS, { limit: 1 })
    ]);
    
    return {
      cpu: cpuMetrics[0] || null,
      memory: memoryMetrics[0] || null,
      database: dbMetrics[0] || null,
      timestamp: new Date()
    };
  }
}

// Specialized AdminSession Operations
export class AdminSessionOperations {
  /**
   * Create a new admin session
   */
  static async createSession(
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
  ): Promise<IAdminSession> {
    const session = await AdminSession.createSession(
      userId,
      sessionToken,
      refreshToken,
      options
    );
    
    await AdminLogOperations.createLog({
      userId,
      level: LogLevel.INFO,
      action: ActionType.LOGIN,
      message: 'Admin session created',
      details: { sessionId: session._id, ipAddress: options.ipAddress },
      success: true
    });
    
    return session;
  }

  /**
   * Get active sessions for a user
   */
  static async getUserActiveSessions(userId: Types.ObjectId): Promise<IAdminSession[]> {
    return AdminDatabaseUtils.find(AdminSession, {
      userId,
      status: SessionStatus.ACTIVE,
      expiresAt: { $gt: new Date() }
    }, {
      sort: { lastActivity: -1 },
      populate: 'userId'
    });
  }

  /**
   * Terminate all sessions for a user
   */
  static async terminateUserSessions(
    userId: Types.ObjectId,
    excludeSessionId?: Types.ObjectId,
    terminatedBy?: Types.ObjectId,
    reason?: string
  ) {
    const result = await AdminSession.terminateUserSessions(
      userId,
      excludeSessionId,
      terminatedBy,
      reason
    );
    
    await AdminLogOperations.createLog({
      userId: terminatedBy,
      level: LogLevel.INFO,
      action: ActionType.LOGOUT,
      message: `Terminated ${result.modifiedCount} sessions for user`,
      details: { targetUserId: userId, reason },
      success: true
    });
    
    return result;
  }

  /**
   * Get session analytics
   */
  static async getSessionAnalytics(
    startDate?: Date,
    endDate?: Date
  ) {
    return AdminSession.getSessionStatistics(startDate, endDate);
  }
}

// Specialized EmailApproval Operations
export class EmailApprovalOperations {
  /**
   * Create a new approval request
   */
  static async createApproval(
    type: any,
    title: string,
    description: string,
    requestedBy: Types.ObjectId,
    approvers: Types.ObjectId[],
    data: any,
    options: {
      requiredApprovals?: number;
      priority?: any;
      expirationHours?: number;
    } = {}
  ): Promise<IEmailApproval> {
    const approval = await EmailApproval.createApproval(
      type,
      title,
      description,
      requestedBy,
      approvers,
      data,
      options
    );
    
    await AdminLogOperations.createLog({
      userId: requestedBy,
      level: LogLevel.INFO,
      action: ActionType.ADMIN_APPROVE,
      message: `Approval request created: ${title}`,
      details: { approvalId: approval._id, type },
      success: true
    });
    
    return approval;
  }

  /**
   * Get pending approvals for a user
   */
  static async getPendingApprovals(
    userId?: Types.ObjectId,
    options: {
      limit?: number;
      skip?: number;
      priority?: any;
      type?: any;
    } = {}
  ): Promise<IEmailApproval[]> {
    return EmailApproval.getPendingApprovals(userId, options);
  }

  /**
   * Process approval action
   */
  static async processApproval(
    approvalId: Types.ObjectId,
    action: 'approve' | 'reject',
    performedBy: Types.ObjectId,
    comment?: string
  ): Promise<IEmailApproval> {
    const approval = await AdminDatabaseUtils.findById(EmailApproval, approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }
    
    if (action === 'approve') {
      await approval.approve(performedBy, comment);
    } else {
      await approval.reject(performedBy, comment);
    }
    
    await AdminLogOperations.createLog({
      userId: performedBy,
      level: LogLevel.INFO,
      action: ActionType.ADMIN_APPROVE,
      message: `Approval ${action}ed: ${approval.title}`,
      details: { approvalId, action, comment },
      success: true
    });
    
    return approval;
  }

  /**
   * Get approval statistics
   */
  static async getApprovalStatistics(
    startDate?: Date,
    endDate?: Date
  ) {
    return EmailApproval.getApprovalStatistics(startDate, endDate);
  }
}

// Admin Database Health and Maintenance
export class AdminDatabaseMaintenance {
  /**
   * Check admin database health
   */
  static async checkHealth() {
    try {
      const [
        superUserCount,
        logCount,
        metricCount,
        sessionCount,
        approvalCount
      ] = await Promise.all([
        AdminDatabaseUtils.count(SuperUser),
        AdminDatabaseUtils.count(AdminLog),
        AdminDatabaseUtils.count(SystemMetric),
        AdminDatabaseUtils.count(AdminSession),
        AdminDatabaseUtils.count(EmailApproval)
      ]);
      
      return {
        healthy: true,
        collections: {
          superUsers: superUserCount,
          adminLogs: logCount,
          systemMetrics: metricCount,
          adminSessions: sessionCount,
          emailApprovals: approvalCount
        },
        timestamp: new Date()
      };
    } catch (error) {
      adminLogger.error('Admin database health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  /**
   * Perform admin database cleanup
   */
  static async performCleanup() {
    try {
      adminLogger.info('Starting admin database cleanup...');
      
      // Cleanup expired sessions
      const expiredSessions = await AdminSession.cleanupExpiredSessions();
      adminLogger.info(`Updated ${expiredSessions.modifiedCount} expired sessions`);
      
      // Cleanup old metrics
      const oldMetrics = await SystemMetric.cleanupOldMetrics();
      adminLogger.info(`Cleaned up ${oldMetrics.deletedCount} old metrics`);
      
      // Expire old approvals
      const expiredApprovals = await EmailApproval.expireOldApprovals();
      adminLogger.info(`Expired ${expiredApprovals.modifiedCount} old approvals`);
      
      adminLogger.info('Admin database cleanup completed successfully');
      
      return {
        expiredSessions: expiredSessions.modifiedCount,
        oldMetrics: oldMetrics.deletedCount,
        expiredApprovals: expiredApprovals.modifiedCount
      };
    } catch (error) {
      adminLogger.error('Admin database cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get admin database statistics
   */
  static async getStatistics() {
    const [
      superUserStats,
      logStats,
      metricStats,
      sessionStats,
      approvalStats
    ] = await Promise.all([
      SuperUserOperations.getStatistics(),
      AdminLogOperations.getLogAnalytics(),
      SystemMetricOperations.getSystemHealth(),
      AdminSessionOperations.getSessionAnalytics(),
      EmailApprovalOperations.getApprovalStatistics()
    ]);
    
    return {
      superUsers: superUserStats,
      logs: logStats,
      metrics: metricStats,
      sessions: sessionStats,
      approvals: approvalStats,
      timestamp: new Date()
    };
  }
}

// Export all operations
export {
  SuperUserOperations,
  AdminLogOperations,
  SystemMetricOperations,
  AdminSessionOperations,
  EmailApprovalOperations,
  AdminDatabaseMaintenance
};