import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { Permission } from '../models/SuperUser';
import UserManagementService from '../services/UserManagementService';
import { Types } from 'mongoose';

const router = Router();
const userManagementService = UserManagementService.getInstance();

// Get all admin users
router.get('/admin-users',
  requireAdminPermission(Permission.ADMIN_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      username,
      email,
      status,
      permissions,
      createdAfter,
      createdBefore,
      lastLoginAfter,
      lastLoginBefore,
      page = '1',
      limit = '20'
    } = req.query;

    const filters: any = {};
    if (username) filters.username = username as string;
    if (email) filters.email = email as string;
    if (status) filters.status = status;
    if (permissions) filters.permissions = Array.isArray(permissions) ? permissions : [permissions];
    if (createdAfter) filters.createdAfter = new Date(createdAfter as string);
    if (createdBefore) filters.createdBefore = new Date(createdBefore as string);
    if (lastLoginAfter) filters.lastLoginAfter = new Date(lastLoginAfter as string);
    if (lastLoginBefore) filters.lastLoginBefore = new Date(lastLoginBefore as string);

    const result = await userManagementService.getUsers(
      filters,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.json({
      success: true,
      data: result
    });
  })
);

// Get admin user by ID
router.get('/admin-users/:id',
  requireAdminPermission(Permission.ADMIN_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const user = await userManagementService.getUserById(new Types.ObjectId(id));
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  })
);

// Create new admin user
router.post('/admin-users',
  requireAdminPermission(Permission.ADMIN_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      permissions
    } = req.body;

    // Validate required fields
    if (!username || !email || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const user = await userManagementService.createUser(
      {
        username,
        email,
        password,
        firstName,
        lastName,
        permissions: permissions || []
      },
      req.adminUser._id
    );

    res.status(201).json({
      success: true,
      data: user
    });
  })
);

// Update admin user
router.put('/admin-users/:id',
  requireAdminPermission(Permission.ADMIN_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const updates = req.body;
    delete updates.password; // Password updates should use separate endpoint

    const user = await userManagementService.updateUser(
      new Types.ObjectId(id),
      updates,
      req.adminUser._id
    );

    res.json({
      success: true,
      data: user
    });
  })
);

// Delete admin user
router.delete('/admin-users/:id',
  requireAdminPermission(Permission.ADMIN_DELETE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    await userManagementService.deleteUser(
      new Types.ObjectId(id),
      req.adminUser._id
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  })
);

// Assign permissions to user
router.post('/admin-users/:id/permissions',
  requireAdminPermission(Permission.ADMIN_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { permissions } = req.body;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: 'Permissions must be an array'
      });
    }

    const user = await userManagementService.assignPermissions(
      new Types.ObjectId(id),
      permissions,
      req.adminUser._id
    );

    res.json({
      success: true,
      data: user
    });
  })
);

// Revoke permissions from user
router.delete('/admin-users/:id/permissions',
  requireAdminPermission(Permission.ADMIN_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { permissions } = req.body;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: 'Permissions must be an array'
      });
    }

    const user = await userManagementService.revokePermissions(
      new Types.ObjectId(id),
      permissions,
      req.adminUser._id
    );

    res.json({
      success: true,
      data: user
    });
  })
);

// Get role templates
router.get('/role-templates',
  requireAdminPermission(Permission.ADMIN_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const templates = await userManagementService.getRoleTemplates();

    res.json({
      success: true,
      data: templates
    });
  })
);

// Create role template
router.post('/role-templates',
  requireAdminPermission(Permission.ADMIN_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name, description, permissions, isDefault } = req.body;

    if (!name || !description || !Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    await userManagementService.createRoleTemplate(
      { name, description, permissions, isDefault: isDefault || false },
      req.adminUser._id
    );

    res.status(201).json({
      success: true,
      message: 'Role template created successfully'
    });
  })
);

// Get user statistics
router.get('/statistics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const statistics = await userManagementService.getUserStatistics();

    res.json({
      success: true,
      data: statistics
    });
  })
);

// Game user management
router.get('/game-users',
  requireAdminPermission(Permission.USER_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      username,
      email,
      isActive,
      createdAfter,
      createdBefore,
      page = '1',
      limit = '20'
    } = req.query;

    const filters: any = {};
    if (username) filters.username = username as string;
    if (email) filters.email = email as string;
    if (isActive !== undefined) filters.isActive = isActive === 'true';
    if (createdAfter) filters.createdAfter = new Date(createdAfter as string);
    if (createdBefore) filters.createdBefore = new Date(createdBefore as string);

    const result = await userManagementService.getGameUsers(
      filters,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.json({
      success: true,
      data: result
    });
  })
);

// Ban game user
router.post('/game-users/:id/ban',
  requireAdminPermission(Permission.USER_BAN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { reason, duration } = req.body;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Ban reason is required'
      });
    }

    await userManagementService.banGameUser(
      new Types.ObjectId(id),
      reason,
      req.adminUser._id,
      duration ? parseInt(duration) : undefined
    );

    res.json({
      success: true,
      message: 'User banned successfully'
    });
  })
);

// Unban game user
router.post('/game-users/:id/unban',
  requireAdminPermission(Permission.USER_BAN),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    await userManagementService.unbanGameUser(
      new Types.ObjectId(id),
      req.adminUser._id
    );

    res.json({
      success: true,
      message: 'User unbanned successfully'
    });
  })
);

export default router;