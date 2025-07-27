import { Types } from 'mongoose';
import { SystemConfiguration, ISystemConfiguration, ConfigurationType, Environment, DataType } from '../models/SystemConfiguration';
import { AdminLog, ActionType, LogLevel } from '../models/AdminLog';
import { adminLogger } from '../config/logger';

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  environments: Environment[];
  rolloutPercentage?: number;
  targetUsers?: string[];
  conditions?: {
    userAgent?: string;
    country?: string;
    userType?: string;
  };
}

export interface SystemSetting {
  key: string;
  name: string;
  description: string;
  value: any;
  dataType: DataType;
  category: string;
  environment: Environment;
  isReadOnly?: boolean;
}

export class SystemConfigurationService {
  private static instance: SystemConfigurationService;

  public static getInstance(): SystemConfigurationService {
    if (!SystemConfigurationService.instance) {
      SystemConfigurationService.instance = new SystemConfigurationService();
    }
    return SystemConfigurationService.instance;
  }

  // Feature Flag Management
  async createFeatureFlag(
    flagData: {
      key: string;
      name: string;
      description: string;
      enabled: boolean;
      environments: Environment[];
      rolloutPercentage?: number;
      targetUsers?: string[];
      conditions?: any;
    },
    createdBy: Types.ObjectId
  ): Promise<ISystemConfiguration> {
    try {
      // Check if feature flag already exists
      const existing = await SystemConfiguration.findOne({ key: flagData.key });
      if (existing) {
        throw new Error('Feature flag with this key already exists');
      }

      const featureFlag = new SystemConfiguration({
        key: flagData.key,
        name: flagData.name,
        description: flagData.description,
        type: ConfigurationType.FEATURE_FLAG,
        environment: Environment.PRODUCTION, // Default environment
        defaultValue: {
          value: {
            enabled: flagData.enabled,
            rolloutPercentage: flagData.rolloutPercentage || 100,
            targetUsers: flagData.targetUsers || [],
            conditions: flagData.conditions || {}
          },
          dataType: DataType.OBJECT
        },
        category: 'feature_flags',
        tags: ['feature', 'flag'],
        createdBy,
        updatedBy: createdBy
      });

      // Set values for each environment
      flagData.environments.forEach(env => {
        featureFlag.values.set(env, {
          value: {
            enabled: flagData.enabled,
            rolloutPercentage: flagData.rolloutPercentage || 100,
            targetUsers: flagData.targetUsers || [],
            conditions: flagData.conditions || {}
          },
          dataType: DataType.OBJECT
        });
      });

      await featureFlag.save();

      // Log the action
      await AdminLog.create({
        userId: createdBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_CONFIG_UPDATE,
        message: `Created feature flag: ${flagData.key}`,
        details: {
          configKey: flagData.key,
          configType: 'feature_flag',
          environments: flagData.environments,
          enabled: flagData.enabled
        },
        success: true
      });

      adminLogger.info('Feature flag created', {
        createdBy,
        key: flagData.key,
        environments: flagData.environments
      });

      return featureFlag;
    } catch (error) {
      adminLogger.error('Failed to create feature flag', {
        error: error instanceof Error ? error.message : 'Unknown error',
        createdBy,
        key: flagData.key
      });
      throw error;
    }
  }

  async updateFeatureFlag(
    key: string,
    environment: Environment,
    updates: {
      enabled?: boolean;
      rolloutPercentage?: number;
      targetUsers?: string[];
      conditions?: any;
    },
    updatedBy: Types.ObjectId
  ): Promise<ISystemConfiguration> {
    try {
      const featureFlag = await SystemConfiguration.findOne({ 
        key, 
        type: ConfigurationType.FEATURE_FLAG 
      });
      
      if (!featureFlag) {
        throw new Error('Feature flag not found');
      }

      const currentValue = featureFlag.getValue(environment) || {};
      const newValue = { ...currentValue, ...updates };

      await featureFlag.setValue(newValue, environment, updatedBy, 'Feature flag update');

      // Log the action
      await AdminLog.create({
        userId: updatedBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_CONFIG_UPDATE,
        message: `Updated feature flag: ${key}`,
        details: {
          configKey: key,
          environment,
          oldValue: currentValue,
          newValue,
          updates
        },
        success: true
      });

      adminLogger.info('Feature flag updated', {
        updatedBy,
        key,
        environment,
        updates
      });

      return featureFlag;
    } catch (error) {
      adminLogger.error('Failed to update feature flag', {
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedBy,
        key,
        environment
      });
      throw error;
    }
  }

  async getFeatureFlags(environment?: Environment): Promise<FeatureFlag[]> {
    try {
      const flags = await SystemConfiguration.find({
        type: ConfigurationType.FEATURE_FLAG,
        isActive: true
      });

      return flags.map(flag => {
        const value = flag.getValue(environment);
        return {
          key: flag.key,
          name: flag.name,
          description: flag.description,
          enabled: value?.enabled || false,
          environments: Array.from(flag.values.keys()) as Environment[],
          rolloutPercentage: value?.rolloutPercentage,
          targetUsers: value?.targetUsers,
          conditions: value?.conditions
        };
      });
    } catch (error) {
      adminLogger.error('Failed to get feature flags', {
        error: error instanceof Error ? error.message : 'Unknown error',
        environment
      });
      throw error;
    }
  }

  async isFeatureEnabled(
    key: string,
    environment: Environment,
    context?: {
      userId?: string;
      userAgent?: string;
      country?: string;
      userType?: string;
    }
  ): Promise<boolean> {
    try {
      const flag = await SystemConfiguration.findOne({
        key,
        type: ConfigurationType.FEATURE_FLAG,
        isActive: true
      });

      if (!flag) {
        return false;
      }

      const value = flag.getValue(environment);
      if (!value || !value.enabled) {
        return false;
      }

      // Check rollout percentage
      if (value.rolloutPercentage < 100) {
        const hash = this.hashString(key + (context?.userId || ''));
        const percentage = hash % 100;
        if (percentage >= value.rolloutPercentage) {
          return false;
        }
      }

      // Check target users
      if (value.targetUsers && value.targetUsers.length > 0 && context?.userId) {
        if (!value.targetUsers.includes(context.userId)) {
          return false;
        }
      }

      // Check conditions
      if (value.conditions && context) {
        if (value.conditions.userAgent && context.userAgent) {
          if (!context.userAgent.includes(value.conditions.userAgent)) {
            return false;
          }
        }
        if (value.conditions.country && context.country) {
          if (context.country !== value.conditions.country) {
            return false;
          }
        }
        if (value.conditions.userType && context.userType) {
          if (context.userType !== value.conditions.userType) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      adminLogger.error('Failed to check feature flag', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
        environment,
        context
      });
      return false;
    }
  }

  // System Settings Management
  async createSystemSetting(
    settingData: {
      key: string;
      name: string;
      description: string;
      value: any;
      dataType: DataType;
      category: string;
      environment: Environment;
      isReadOnly?: boolean;
      validationRules?: any;
    },
    createdBy: Types.ObjectId
  ): Promise<ISystemConfiguration> {
    try {
      const setting = new SystemConfiguration({
        key: settingData.key,
        name: settingData.name,
        description: settingData.description,
        type: ConfigurationType.SYSTEM_SETTING,
        environment: settingData.environment,
        defaultValue: {
          value: settingData.value,
          dataType: settingData.dataType
        },
        category: settingData.category,
        isReadOnly: settingData.isReadOnly || false,
        validationRules: settingData.validationRules,
        createdBy,
        updatedBy: createdBy
      });

      setting.values.set(settingData.environment, {
        value: settingData.value,
        dataType: settingData.dataType
      });

      await setting.save();

      // Log the action
      await AdminLog.create({
        userId: createdBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_CONFIG_UPDATE,
        message: `Created system setting: ${settingData.key}`,
        details: {
          configKey: settingData.key,
          configType: 'system_setting',
          environment: settingData.environment,
          value: settingData.value
        },
        success: true
      });

      adminLogger.info('System setting created', {
        createdBy,
        key: settingData.key,
        environment: settingData.environment
      });

      return setting;
    } catch (error) {
      adminLogger.error('Failed to create system setting', {
        error: error instanceof Error ? error.message : 'Unknown error',
        createdBy,
        key: settingData.key
      });
      throw error;
    }
  }

  async updateSystemSetting(
    key: string,
    environment: Environment,
    value: any,
    updatedBy: Types.ObjectId
  ): Promise<ISystemConfiguration> {
    try {
      const setting = await SystemConfiguration.findOne({
        key,
        type: ConfigurationType.SYSTEM_SETTING
      });

      if (!setting) {
        throw new Error('System setting not found');
      }

      const oldValue = setting.getValue(environment);
      await setting.setValue(value, environment, updatedBy, 'System setting update');

      // Log the action
      await AdminLog.create({
        userId: updatedBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_CONFIG_UPDATE,
        message: `Updated system setting: ${key}`,
        details: {
          configKey: key,
          environment,
          oldValue,
          newValue: value
        },
        success: true
      });

      adminLogger.info('System setting updated', {
        updatedBy,
        key,
        environment,
        oldValue,
        newValue: value
      });

      return setting;
    } catch (error) {
      adminLogger.error('Failed to update system setting', {
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedBy,
        key,
        environment
      });
      throw error;
    }
  }

  async getSystemSettings(
    category?: string,
    environment?: Environment
  ): Promise<SystemSetting[]> {
    try {
      const query: any = {
        type: ConfigurationType.SYSTEM_SETTING,
        isActive: true
      };

      if (category) {
        query.category = category;
      }

      const settings = await SystemConfiguration.find(query);

      return settings.map(setting => ({
        key: setting.key,
        name: setting.name,
        description: setting.description,
        value: setting.getValue(environment),
        dataType: setting.defaultValue.dataType,
        category: setting.category,
        environment: environment || setting.environment,
        isReadOnly: setting.isReadOnly
      }));
    } catch (error) {
      adminLogger.error('Failed to get system settings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        category,
        environment
      });
      throw error;
    }
  }

  async getSystemSetting(
    key: string,
    environment?: Environment
  ): Promise<any> {
    try {
      const setting = await SystemConfiguration.findOne({
        key,
        type: ConfigurationType.SYSTEM_SETTING,
        isActive: true
      });

      if (!setting) {
        return null;
      }

      return setting.getValue(environment);
    } catch (error) {
      adminLogger.error('Failed to get system setting', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
        environment
      });
      return null;
    }
  }

  // Configuration Management
  async getAllConfigurations(
    type?: ConfigurationType,
    environment?: Environment,
    category?: string
  ): Promise<ISystemConfiguration[]> {
    try {
      const query: any = { isActive: true };

      if (type) query.type = type;
      if (category) query.category = category;

      return await SystemConfiguration.find(query)
        .populate('createdBy', 'username')
        .populate('updatedBy', 'username')
        .sort({ updatedAt: -1 });
    } catch (error) {
      adminLogger.error('Failed to get configurations', {
        error: error instanceof Error ? error.message : 'Unknown error',
        type,
        environment,
        category
      });
      throw error;
    }
  }

  async deleteConfiguration(
    key: string,
    deletedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const config = await SystemConfiguration.findOne({ key });
      if (!config) {
        throw new Error('Configuration not found');
      }

      await SystemConfiguration.findOneAndDelete({ key });

      // Log the action
      await AdminLog.create({
        userId: deletedBy,
        level: LogLevel.WARN,
        action: ActionType.SYSTEM_CONFIG_UPDATE,
        message: `Deleted configuration: ${key}`,
        details: {
          configKey: key,
          configType: config.type
        },
        success: true
      });

      adminLogger.warn('Configuration deleted', {
        deletedBy,
        key,
        type: config.type
      });
    } catch (error) {
      adminLogger.error('Failed to delete configuration', {
        error: error instanceof Error ? error.message : 'Unknown error',
        deletedBy,
        key
      });
      throw error;
    }
  }

  async rollbackConfiguration(
    key: string,
    version: number,
    rolledBackBy: Types.ObjectId
  ): Promise<ISystemConfiguration> {
    try {
      const config = await SystemConfiguration.findOne({ key });
      if (!config) {
        throw new Error('Configuration not found');
      }

      await config.rollback(version, rolledBackBy);

      // Log the action
      await AdminLog.create({
        userId: rolledBackBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_CONFIG_UPDATE,
        message: `Rolled back configuration: ${key} to version ${version}`,
        details: {
          configKey: key,
          version,
          configType: config.type
        },
        success: true
      });

      adminLogger.info('Configuration rolled back', {
        rolledBackBy,
        key,
        version
      });

      return config;
    } catch (error) {
      adminLogger.error('Failed to rollback configuration', {
        error: error instanceof Error ? error.message : 'Unknown error',
        rolledBackBy,
        key,
        version
      });
      throw error;
    }
  }

  // Environment Management
  async getEnvironments(): Promise<Environment[]> {
    return Object.values(Environment);
  }

  async syncConfigurationAcrossEnvironments(
    key: string,
    sourceEnvironment: Environment,
    targetEnvironments: Environment[],
    syncedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const config = await SystemConfiguration.findOne({ key });
      if (!config) {
        throw new Error('Configuration not found');
      }

      const sourceValue = config.getValue(sourceEnvironment);
      if (!sourceValue) {
        throw new Error('Source environment value not found');
      }

      for (const targetEnv of targetEnvironments) {
        await config.setValue(
          sourceValue,
          targetEnv,
          syncedBy,
          `Synced from ${sourceEnvironment}`
        );
      }

      // Log the action
      await AdminLog.create({
        userId: syncedBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_CONFIG_UPDATE,
        message: `Synced configuration: ${key} from ${sourceEnvironment} to ${targetEnvironments.join(', ')}`,
        details: {
          configKey: key,
          sourceEnvironment,
          targetEnvironments,
          value: sourceValue
        },
        success: true
      });

      adminLogger.info('Configuration synced across environments', {
        syncedBy,
        key,
        sourceEnvironment,
        targetEnvironments
      });
    } catch (error) {
      adminLogger.error('Failed to sync configuration', {
        error: error instanceof Error ? error.message : 'Unknown error',
        syncedBy,
        key,
        sourceEnvironment,
        targetEnvironments
      });
      throw error;
    }
  }

  // Utility methods
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  async exportConfigurations(
    environment?: Environment,
    type?: ConfigurationType
  ): Promise<any> {
    try {
      const query: any = { isActive: true };
      if (type) query.type = type;

      const configs = await SystemConfiguration.find(query);
      
      const exportData = {
        exportedAt: new Date(),
        environment,
        type,
        configurations: configs.map(config => ({
          key: config.key,
          name: config.name,
          description: config.description,
          type: config.type,
          category: config.category,
          value: environment ? config.getValue(environment) : Object.fromEntries(config.values),
          tags: config.tags,
          version: config.version
        }))
      };

      return exportData;
    } catch (error) {
      adminLogger.error('Failed to export configurations', {
        error: error instanceof Error ? error.message : 'Unknown error',
        environment,
        type
      });
      throw error;
    }
  }
}

export default SystemConfigurationService;