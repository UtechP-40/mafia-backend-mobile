import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { Permission } from '../models/SuperUser';
import SystemConfigurationService from '../services/SystemConfigurationService';
import { ConfigurationType, Environment, DataType } from '../models/SystemConfiguration';
import { Types } from 'mongoose';

const router = Router();
const configService = SystemConfigurationService.getInstance();

// Feature Flags Management
router.get('/feature-flags',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { environment } = req.query;
    
    const flags = await configService.getFeatureFlags(
      environment as Environment
    );

    res.json({
      success: true,
      data: flags
    });
  })
);

router.post('/feature-flags',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      key,
      name,
      description,
      enabled,
      environments,
      rolloutPercentage,
      targetUsers,
      conditions
    } = req.body;

    if (!key || !name || !description || !Array.isArray(environments)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const flag = await configService.createFeatureFlag(
      {
        key,
        name,
        description,
        enabled: enabled || false,
        environments,
        rolloutPercentage,
        targetUsers,
        conditions
      },
      req.adminUser._id
    );

    res.status(201).json({
      success: true,
      data: flag
    });
  })
);

router.put('/feature-flags/:key',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { key } = req.params;
    const { environment, enabled, rolloutPercentage, targetUsers, conditions } = req.body;

    if (!environment) {
      return res.status(400).json({
        success: false,
        error: 'Environment is required'
      });
    }

    const flag = await configService.updateFeatureFlag(
      key,
      environment as Environment,
      { enabled, rolloutPercentage, targetUsers, conditions },
      req.adminUser._id
    );

    res.json({
      success: true,
      data: flag
    });
  })
);

router.get('/feature-flags/:key/status',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { key } = req.params;
    const { environment, userId, userAgent, country, userType } = req.query;

    if (!environment) {
      return res.status(400).json({
        success: false,
        error: 'Environment is required'
      });
    }

    const isEnabled = await configService.isFeatureEnabled(
      key,
      environment as Environment,
      {
        userId: userId as string,
        userAgent: userAgent as string,
        country: country as string,
        userType: userType as string
      }
    );

    res.json({
      success: true,
      data: { enabled: isEnabled }
    });
  })
);

// System Settings Management
router.get('/system-settings',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { category, environment } = req.query;
    
    const settings = await configService.getSystemSettings(
      category as string,
      environment as Environment
    );

    res.json({
      success: true,
      data: settings
    });
  })
);

router.post('/system-settings',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      key,
      name,
      description,
      value,
      dataType,
      category,
      environment,
      isReadOnly,
      validationRules
    } = req.body;

    if (!key || !name || !description || value === undefined || !dataType || !category || !environment) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const setting = await configService.createSystemSetting(
      {
        key,
        name,
        description,
        value,
        dataType: dataType as DataType,
        category,
        environment: environment as Environment,
        isReadOnly,
        validationRules
      },
      req.adminUser._id
    );

    res.status(201).json({
      success: true,
      data: setting
    });
  })
);

router.put('/system-settings/:key',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { key } = req.params;
    const { environment, value } = req.body;

    if (!environment || value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Environment and value are required'
      });
    }

    const setting = await configService.updateSystemSetting(
      key,
      environment as Environment,
      value,
      req.adminUser._id
    );

    res.json({
      success: true,
      data: setting
    });
  })
);

router.get('/system-settings/:key',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { key } = req.params;
    const { environment } = req.query;

    const value = await configService.getSystemSetting(
      key,
      environment as Environment
    );

    if (value === null) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }

    res.json({
      success: true,
      data: { key, value }
    });
  })
);

// Configuration Management
router.get('/configurations',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { type, environment, category } = req.query;
    
    const configurations = await configService.getAllConfigurations(
      type as ConfigurationType,
      environment as Environment,
      category as string
    );

    res.json({
      success: true,
      data: configurations
    });
  })
);

router.delete('/configurations/:key',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { key } = req.params;

    await configService.deleteConfiguration(key, req.adminUser._id);

    res.json({
      success: true,
      message: 'Configuration deleted successfully'
    });
  })
);

router.post('/configurations/:key/rollback',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { key } = req.params;
    const { version } = req.body;

    if (!version) {
      return res.status(400).json({
        success: false,
        error: 'Version is required'
      });
    }

    const config = await configService.rollbackConfiguration(
      key,
      parseInt(version),
      req.adminUser._id
    );

    res.json({
      success: true,
      data: config
    });
  })
);

// Environment Management
router.get('/environments',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const environments = await configService.getEnvironments();

    res.json({
      success: true,
      data: environments
    });
  })
);

router.post('/configurations/:key/sync',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { key } = req.params;
    const { sourceEnvironment, targetEnvironments } = req.body;

    if (!sourceEnvironment || !Array.isArray(targetEnvironments)) {
      return res.status(400).json({
        success: false,
        error: 'Source environment and target environments are required'
      });
    }

    await configService.syncConfigurationAcrossEnvironments(
      key,
      sourceEnvironment as Environment,
      targetEnvironments as Environment[],
      req.adminUser._id
    );

    res.json({
      success: true,
      message: 'Configuration synced successfully'
    });
  })
);

// Export/Import
router.get('/export',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { environment, type } = req.query;
    
    const exportData = await configService.exportConfigurations(
      environment as Environment,
      type as ConfigurationType
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=config-export-${Date.now()}.json`);
    res.json(exportData);
  })
);

// Configuration Categories
router.get('/categories',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    // Return predefined categories
    const categories = [
      'feature_flags',
      'system_settings',
      'security',
      'performance',
      'ui_settings',
      'api_settings',
      'database',
      'cache',
      'monitoring',
      'notifications'
    ];

    res.json({
      success: true,
      data: categories
    });
  })
);

// Data Types
router.get('/data-types',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const dataTypes = Object.values(DataType);

    res.json({
      success: true,
      data: dataTypes
    });
  })
);

// Configuration Types
router.get('/types',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const types = Object.values(ConfigurationType);

    res.json({
      success: true,
      data: types
    });
  })
);

// Bulk Operations
router.post('/bulk-update',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { updates } = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'Updates must be an array'
      });
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const { key, environment, value } = update;
        const result = await configService.updateSystemSetting(
          key,
          environment as Environment,
          value,
          req.adminUser._id
        );
        results.push({ key, success: true, data: result });
      } catch (error) {
        errors.push({
          key: update.key,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.json({
      success: errors.length === 0,
      data: {
        successful: results,
        failed: errors,
        summary: {
          total: updates.length,
          successful: results.length,
          failed: errors.length
        }
      }
    });
  })
);

// Configuration Validation
router.post('/validate',
  requireAdminPermission(Permission.SYSTEM_CONFIG),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { configurations } = req.body;

    if (!Array.isArray(configurations)) {
      return res.status(400).json({
        success: false,
        error: 'Configurations must be an array'
      });
    }

    const validationResults = [];

    for (const config of configurations) {
      const result = {
        key: config.key,
        valid: true,
        errors: [] as string[]
      };

      // Basic validation
      if (!config.key) result.errors.push('Key is required');
      if (!config.name) result.errors.push('Name is required');
      if (!config.description) result.errors.push('Description is required');
      if (config.value === undefined) result.errors.push('Value is required');
      if (!config.dataType) result.errors.push('Data type is required');

      // Data type validation
      if (config.dataType && config.value !== undefined) {
        switch (config.dataType) {
          case DataType.NUMBER:
            if (typeof config.value !== 'number') {
              result.errors.push('Value must be a number');
            }
            break;
          case DataType.BOOLEAN:
            if (typeof config.value !== 'boolean') {
              result.errors.push('Value must be a boolean');
            }
            break;
          case DataType.STRING:
            if (typeof config.value !== 'string') {
              result.errors.push('Value must be a string');
            }
            break;
          case DataType.ARRAY:
            if (!Array.isArray(config.value)) {
              result.errors.push('Value must be an array');
            }
            break;
          case DataType.OBJECT:
            if (typeof config.value !== 'object' || Array.isArray(config.value)) {
              result.errors.push('Value must be an object');
            }
            break;
        }
      }

      result.valid = result.errors.length === 0;
      validationResults.push(result);
    }

    res.json({
      success: true,
      data: {
        results: validationResults,
        summary: {
          total: configurations.length,
          valid: validationResults.filter(r => r.valid).length,
          invalid: validationResults.filter(r => !r.valid).length
        }
      }
    });
  })
);

export default router;