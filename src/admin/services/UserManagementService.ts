import { Types } from 'mongoose';
import { SuperUser, ISuperUser, Permission, SuperUserStatus } from '../models/SuperUser';
import { AdminLog, ActionType, LogLevel } from '../models/AdminLog';
import { Player } from '../../models/Player';
import bcrypt from 'bcrypt';
import { adminLogger } from '../config/logger';

export interface UserSearchFilters {
  username?: string;
  email?: string;
  status?: SuperUserStatus;
  permissions?: Permission[];
  createdAfter?: Date;
  createdBefore?: Date;
  lastLoginAfter?: Date;
  lastLoginBefore?: Date;
}

export interface UserUpdateData {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  permissions?: Permission[];
  status?: SuperUserStatus;
  twoFactorEnabled?: boolean;
}

export interface RoleTemplate {
  name: string;
  description: string;
  permissions: Permission[];
  isDefault: boolean;
}

export class UserManagementService {
  private static instance: UserManagementService;

  public static getInstance(): UserManagementService {
    if (!UserManagementService.instance) {
      UserManagementService.instance = new UserManagementService();
    }
    return UserManagementService.instance;
  }

  // User CRUD operations
  async createUser(
    userData: {
      username: string;
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      permissions: Permission[];
    },
    createdBy: Types.ObjectId
  ): Promise<ISuperUser> {
    try {
      // Check if user already exists
      const existingUser = await SuperUser.findOne({
        $or: [
          { username: userData.username },
          { email: userData.email }
        ]
      });

      if (existingUser) {
        throw new Error('User with this username or email already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 12);

      // Create user
      const user = new SuperUser({
        ...userData,
        password: hashedPassword,
        createdBy,
        updatedBy: createdBy,
        status: SuperUserStatus.APPROVED // Direct creation by admin
      });

      await user.save();

      // Log the action
      await AdminLog.create({
        userId: createdBy,
        level: LogLevel.INFO,
        action: ActionType.ADMIN_CREATE,
        message: `Created new admin user: ${userData.username}`,
        details: {
          targetUserId: user._id,
          targetUsername: userData.username,
          permissions: userData.permissions
        },
        success: true
      });

      adminLogger.info('Admin user created', {
        createdBy,
        targetUserId: user._id,
        username: userData.username
      });

      return user;
    } catch (error) {
      adminLogger.error('Failed to create admin user', {
        error: error instanceof Error ? error.message : 'Unknown error',
        createdBy,
        username: userData.username
      });
      throw error;
    }
  }

  async updateUser(
    userId: Types.ObjectId,
    updateData: UserUpdateData,
    updatedBy: Types.ObjectId
  ): Promise<ISuperUser> {
    try {
      const user = await SuperUser.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const oldData = {
        username: user.username,
        email: user.email,
        permissions: user.permissions,
        status: user.status
      };

      // Update user fields
      Object.assign(user, updateData);
      user.updatedBy = updatedBy;

      await user.save();

      // Log the action
      await AdminLog.create({
        userId: updatedBy,
        level: LogLevel.INFO,
        action: ActionType.ADMIN_UPDATE,
        message: `Updated admin user: ${user.username}`,
        details: {
          targetUserId: userId,
          targetUsername: user.username,
          oldData,
          newData: updateData
        },
        success: true
      });

      adminLogger.info('Admin user updated', {
        updatedBy,
        targetUserId: userId,
        username: user.username,
        changes: updateData
      });

      return user;
    } catch (error) {
      adminLogger.error('Failed to update admin user', {
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedBy,
        targetUserId: userId
      });
      throw error;
    }
  }

  async deleteUser(
    userId: Types.ObjectId,
    deletedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const user = await SuperUser.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Prevent self-deletion
      if (userId.equals(deletedBy)) {
        throw new Error('Cannot delete your own account');
      }

      const username = user.username;
      await SuperUser.findByIdAndDelete(userId);

      // Log the action
      await AdminLog.create({
        userId: deletedBy,
        level: LogLevel.WARN,
        action: ActionType.ADMIN_DELETE,
        message: `Deleted admin user: ${username}`,
        details: {
          targetUserId: userId,
          targetUsername: username
        },
        success: true
      });

      adminLogger.warn('Admin user deleted', {
        deletedBy,
        targetUserId: userId,
        username
      });
    } catch (error) {
      adminLogger.error('Failed to delete admin user', {
        error: error instanceof Error ? error.message : 'Unknown error',
        deletedBy,
        targetUserId: userId
      });
      throw error;
    }
  }

  async getUsers(
    filters: UserSearchFilters = {},
    page: number = 1,
    limit: number = 20
  ): Promise<{
    users: ISuperUser[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const query: any = {};

      // Apply filters
      if (filters.username) {
        query.username = { $regex: filters.username, $options: 'i' };
      }
      if (filters.email) {
        query.email = { $regex: filters.email, $options: 'i' };
      }
      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.permissions && filters.permissions.length > 0) {
        query.permissions = { $in: filters.permissions };
      }
      if (filters.createdAfter || filters.createdBefore) {
        query.createdAt = {};
        if (filters.createdAfter) query.createdAt.$gte = filters.createdAfter;
        if (filters.createdBefore) query.createdAt.$lte = filters.createdBefore;
      }
      if (filters.lastLoginAfter || filters.lastLoginBefore) {
        query.lastLogin = {};
        if (filters.lastLoginAfter) query.lastLogin.$gte = filters.lastLoginAfter;
        if (filters.lastLoginBefore) query.lastLogin.$lte = filters.lastLoginBefore;
      }

      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        SuperUser.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('createdBy', 'username')
          .populate('updatedBy', 'username'),
        SuperUser.countDocuments(query)
      ]);

      return {
        users,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      adminLogger.error('Failed to get users', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filters,
        page,
        limit
      });
      throw error;
    }
  }

  async getUserById(userId: Types.ObjectId): Promise<ISuperUser | null> {
    try {
      return await SuperUser.findById(userId)
        .populate('createdBy', 'username')
        .populate('updatedBy', 'username');
    } catch (error) {
      adminLogger.error('Failed to get user by ID', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw error;
    }
  }

  // Permission management
  async assignPermissions(
    userId: Types.ObjectId,
    permissions: Permission[],
    assignedBy: Types.ObjectId
  ): Promise<ISuperUser> {
    try {
      const user = await SuperUser.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const oldPermissions = [...user.permissions];
      user.permissions = permissions;
      user.updatedBy = assignedBy;

      await user.save();

      // Log the action
      await AdminLog.create({
        userId: assignedBy,
        level: LogLevel.INFO,
        action: ActionType.ADMIN_UPDATE,
        message: `Updated permissions for user: ${user.username}`,
        details: {
          targetUserId: userId,
          targetUsername: user.username,
          oldPermissions,
          newPermissions: permissions
        },
        success: true
      });

      adminLogger.info('User permissions updated', {
        assignedBy,
        targetUserId: userId,
        username: user.username,
        oldPermissions,
        newPermissions: permissions
      });

      return user;
    } catch (error) {
      adminLogger.error('Failed to assign permissions', {
        error: error instanceof Error ? error.message : 'Unknown error',
        assignedBy,
        targetUserId: userId,
        permissions
      });
      throw error;
    }
  }

  async revokePermissions(
    userId: Types.ObjectId,
    permissions: Permission[],
    revokedBy: Types.ObjectId
  ): Promise<ISuperUser> {
    try {
      const user = await SuperUser.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const oldPermissions = [...user.permissions];
      user.permissions = user.permissions.filter(p => !permissions.includes(p));
      user.updatedBy = revokedBy;

      await user.save();

      // Log the action
      await AdminLog.create({
        userId: revokedBy,
        level: LogLevel.INFO,
        action: ActionType.ADMIN_UPDATE,
        message: `Revoked permissions from user: ${user.username}`,
        details: {
          targetUserId: userId,
          targetUsername: user.username,
          oldPermissions,
          revokedPermissions: permissions,
          newPermissions: user.permissions
        },
        success: true
      });

      adminLogger.info('User permissions revoked', {
        revokedBy,
        targetUserId: userId,
        username: user.username,
        revokedPermissions: permissions
      });

      return user;
    } catch (error) {
      adminLogger.error('Failed to revoke permissions', {
        error: error instanceof Error ? error.message : 'Unknown error',
        revokedBy,
        targetUserId: userId,
        permissions
      });
      throw error;
    }
  }

  // Role templates
  async createRoleTemplate(
    template: RoleTemplate,
    createdBy: Types.ObjectId
  ): Promise<void> {
    try {
      // Store role templates in system configuration
      // This is a simplified implementation - in production, you might want a separate collection
      const roleTemplates = await this.getRoleTemplates();
      roleTemplates.push({
        ...template,
        id: new Types.ObjectId().toString(),
        createdBy: createdBy.toString(),
        createdAt: new Date()
      });

      // Save to system configuration or dedicated collection
      // Implementation depends on your configuration storage strategy

      adminLogger.info('Role template created', {
        createdBy,
        templateName: template.name,
        permissions: template.permissions
      });
    } catch (error) {
      adminLogger.error('Failed to create role template', {
        error: error instanceof Error ? error.message : 'Unknown error',
        createdBy,
        template
      });
      throw error;
    }
  }

  async getRoleTemplates(): Promise<any[]> {
    // Return predefined role templates
    return [
      {
        id: 'super_admin',
        name: 'Super Administrator',
        description: 'Full system access with all permissions',
        permissions: [Permission.SUPER_ADMIN],
        isDefault: true
      },
      {
        id: 'database_admin',
        name: 'Database Administrator',
        description: 'Full database management access',
        permissions: [
          Permission.DATABASE_READ,
          Permission.DATABASE_WRITE,
          Permission.DATABASE_DELETE,
          Permission.DATABASE_BACKUP,
          Permission.DATABASE_RESTORE
        ],
        isDefault: true
      },
      {
        id: 'user_manager',
        name: 'User Manager',
        description: 'User management and analytics access',
        permissions: [
          Permission.USER_READ,
          Permission.USER_WRITE,
          Permission.USER_DELETE,
          Permission.ANALYTICS_READ
        ],
        isDefault: true
      },
      {
        id: 'system_monitor',
        name: 'System Monitor',
        description: 'System monitoring and analytics access',
        permissions: [
          Permission.SYSTEM_MONITOR,
          Permission.ANALYTICS_READ,
          Permission.API_MONITOR,
          Permission.SOCKET_MONITOR
        ],
        isDefault: true
      },
      {
        id: 'security_analyst',
        name: 'Security Analyst',
        description: 'Security monitoring and incident response',
        permissions: [
          Permission.SYSTEM_MONITOR,
          Permission.ANALYTICS_READ,
          Permission.USER_READ
        ],
        isDefault: true
      }
    ];
  }

  // User statistics
  async getUserStatistics(): Promise<{
    totalUsers: number;
    activeUsers: number;
    usersByStatus: Record<SuperUserStatus, number>;
    usersByPermission: Record<Permission, number>;
    recentLogins: number;
  }> {
    try {
      const [
        totalUsers,
        usersByStatus,
        recentLogins
      ] = await Promise.all([
        SuperUser.countDocuments(),
        SuperUser.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]),
        SuperUser.countDocuments({
          lastLogin: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
      ]);

      const statusCounts = usersByStatus.reduce((acc, item) => {
        acc[item._id as SuperUserStatus] = item.count;
        return acc;
      }, {} as Record<SuperUserStatus, number>);

      // Get permission statistics
      const users = await SuperUser.find({}, 'permissions');
      const permissionCounts = {} as Record<Permission, number>;
      
      users.forEach(user => {
        user.permissions.forEach(permission => {
          permissionCounts[permission] = (permissionCounts[permission] || 0) + 1;
        });
      });

      return {
        totalUsers,
        activeUsers: recentLogins,
        usersByStatus: statusCounts,
        usersByPermission: permissionCounts,
        recentLogins
      };
    } catch (error) {
      adminLogger.error('Failed to get user statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // Game user management
  async getGameUsers(
    filters: {
      username?: string;
      email?: string;
      isActive?: boolean;
      createdAfter?: Date;
      createdBefore?: Date;
    } = {},
    page: number = 1,
    limit: number = 20
  ): Promise<{
    users: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const query: any = {};

      if (filters.username) {
        query.username = { $regex: filters.username, $options: 'i' };
      }
      if (filters.email) {
        query.email = { $regex: filters.email, $options: 'i' };
      }
      if (typeof filters.isActive === 'boolean') {
        query.isActive = filters.isActive;
      }
      if (filters.createdAfter || filters.createdBefore) {
        query.createdAt = {};
        if (filters.createdAfter) query.createdAt.$gte = filters.createdAfter;
        if (filters.createdBefore) query.createdAt.$lte = filters.createdBefore;
      }

      const skip = (page - 1) * limit;
      const [users, total] = await Promise.all([
        Player.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select('-password'),
        Player.countDocuments(query)
      ]);

      return {
        users,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      adminLogger.error('Failed to get game users', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filters,
        page,
        limit
      });
      throw error;
    }
  }

  async banGameUser(
    userId: Types.ObjectId,
    reason: string,
    bannedBy: Types.ObjectId,
    duration?: number // hours
  ): Promise<void> {
    try {
      const user = await Player.findById(userId);
      if (!user) {
        throw new Error('Game user not found');
      }

      const banExpiry = duration ? new Date(Date.now() + duration * 60 * 60 * 1000) : undefined;
      
      await Player.findByIdAndUpdate(userId, {
        isBanned: true,
        banReason: reason,
        bannedBy,
        bannedAt: new Date(),
        banExpiry
      });

      // Log the action
      await AdminLog.create({
        userId: bannedBy,
        level: LogLevel.WARN,
        action: ActionType.USER_BAN,
        message: `Banned game user: ${user.username}`,
        details: {
          targetUserId: userId,
          targetUsername: user.username,
          reason,
          duration,
          banExpiry
        },
        success: true
      });

      adminLogger.warn('Game user banned', {
        bannedBy,
        targetUserId: userId,
        username: user.username,
        reason,
        duration
      });
    } catch (error) {
      adminLogger.error('Failed to ban game user', {
        error: error instanceof Error ? error.message : 'Unknown error',
        bannedBy,
        targetUserId: userId,
        reason
      });
      throw error;
    }
  }

  async unbanGameUser(
    userId: Types.ObjectId,
    unbannedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const user = await Player.findById(userId);
      if (!user) {
        throw new Error('Game user not found');
      }

      await Player.findByIdAndUpdate(userId, {
        isBanned: false,
        banReason: undefined,
        bannedBy: undefined,
        bannedAt: undefined,
        banExpiry: undefined
      });

      // Log the action
      await AdminLog.create({
        userId: unbannedBy,
        level: LogLevel.INFO,
        action: ActionType.USER_UNBAN,
        message: `Unbanned game user: ${user.username}`,
        details: {
          targetUserId: userId,
          targetUsername: user.username
        },
        success: true
      });

      adminLogger.info('Game user unbanned', {
        unbannedBy,
        targetUserId: userId,
        username: user.username
      });
    } catch (error) {
      adminLogger.error('Failed to unban game user', {
        error: error instanceof Error ? error.message : 'Unknown error',
        unbannedBy,
        targetUserId: userId
      });
      throw error;
    }
  }
}

export default UserManagementService;