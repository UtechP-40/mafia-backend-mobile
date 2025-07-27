import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for SystemConfiguration
export enum ConfigurationType {
  FEATURE_FLAG = 'feature_flag',
  SYSTEM_SETTING = 'system_setting',
  ENVIRONMENT_CONFIG = 'environment_config',
  MAINTENANCE_CONFIG = 'maintenance_config',
  SECURITY_CONFIG = 'security_config',
  PERFORMANCE_CONFIG = 'performance_config'
}

export enum Environment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
  TESTING = 'testing'
}

export enum DataType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  OBJECT = 'object',
  ARRAY = 'array'
}

export interface ConfigValue {
  value: any;
  dataType: DataType;
  encrypted?: boolean;
}

export interface ISystemConfiguration extends Document {
  _id: Types.ObjectId;
  key: string;
  name: string;
  description: string;
  type: ConfigurationType;
  environment: Environment;
  values: Map<Environment, ConfigValue>;
  defaultValue: ConfigValue;
  isActive: boolean;
  isReadOnly: boolean;
  category: string;
  tags: string[];
  validationRules?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
  };
  dependencies?: string[];
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  lastModified: Date;
  version: number;
  changeHistory: {
    version: number;
    changedBy: Types.ObjectId;
    changedAt: Date;
    changes: Record<string, any>;
    reason?: string;
  }[];
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  getValue(environment?: Environment): any;
  setValue(value: any, environment: Environment, changedBy: Types.ObjectId, reason?: string): Promise<void>;
  validateValue(value: any): boolean;
  rollback(version: number, changedBy: Types.ObjectId): Promise<void>;
}

// SystemConfiguration schema
const SystemConfigurationSchema = new Schema<ISystemConfiguration>({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 100,
    match: /^[a-zA-Z0-9_.-]+$/
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000
  },
  type: {
    type: String,
    enum: Object.values(ConfigurationType),
    required: true,
    index: true
  },
  environment: {
    type: String,
    enum: Object.values(Environment),
    required: true,
    index: true
  },
  values: {
    type: Map,
    of: {
      value: Schema.Types.Mixed,
      dataType: {
        type: String,
        enum: Object.values(DataType),
        required: true
      },
      encrypted: {
        type: Boolean,
        default: false
      }
    },
    default: new Map()
  },
  defaultValue: {
    value: Schema.Types.Mixed,
    dataType: {
      type: String,
      enum: Object.values(DataType),
      required: true
    },
    encrypted: {
      type: Boolean,
      default: false
    }
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isReadOnly: {
    type: Boolean,
    default: false
  },
  category: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
    index: true
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 30
  }],
  validationRules: {
    required: Boolean,
    min: Number,
    max: Number,
    pattern: String,
    enum: [Schema.Types.Mixed]
  },
  dependencies: [{
    type: String,
    trim: true,
    maxlength: 100
  }],
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true
  },
  lastModified: {
    type: Date,
    default: Date.now
  },
  version: {
    type: Number,
    default: 1,
    min: 1
  },
  changeHistory: [{
    version: {
      type: Number,
      required: true
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser',
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    changes: {
      type: Schema.Types.Mixed,
      required: true
    },
    reason: {
      type: String,
      maxlength: 500
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
SystemConfigurationSchema.index({ key: 1 });
SystemConfigurationSchema.index({ type: 1, environment: 1 });
SystemConfigurationSchema.index({ category: 1, isActive: 1 });
SystemConfigurationSchema.index({ tags: 1 });
SystemConfigurationSchema.index({ createdBy: 1, updatedAt: -1 });
SystemConfigurationSchema.index({ lastModified: -1 });

// Instance methods
SystemConfigurationSchema.methods.getValue = function(environment?: Environment): any {
  const env = environment || this.environment;
  const envValue = this.values.get(env);
  
  if (envValue) {
    return envValue.encrypted ? decrypt(envValue.value) : envValue.value;
  }
  
  return this.defaultValue.encrypted ? decrypt(this.defaultValue.value) : this.defaultValue.value;
};

SystemConfigurationSchema.methods.setValue = async function(
  value: any, 
  environment: Environment, 
  changedBy: Types.ObjectId, 
  reason?: string
): Promise<void> {
  if (this.isReadOnly) {
    throw new Error('Configuration is read-only');
  }

  if (!this.validateValue(value)) {
    throw new Error('Invalid value for configuration');
  }

  const oldValue = this.getValue(environment);
  const configValue: ConfigValue = {
    value: this.defaultValue.encrypted ? encrypt(value) : value,
    dataType: this.defaultValue.dataType,
    encrypted: this.defaultValue.encrypted
  };

  this.values.set(environment, configValue);
  this.updatedBy = changedBy;
  this.lastModified = new Date();
  this.version += 1;

  // Add to change history
  this.changeHistory.push({
    version: this.version,
    changedBy,
    changedAt: new Date(),
    changes: {
      environment,
      oldValue,
      newValue: value
    },
    reason
  });

  await this.save();
};

SystemConfigurationSchema.methods.validateValue = function(value: any): boolean {
  if (!this.validationRules) return true;

  const rules = this.validationRules;

  if (rules.required && (value === null || value === undefined)) {
    return false;
  }

  if (rules.enum && !rules.enum.includes(value)) {
    return false;
  }

  if (typeof value === 'number') {
    if (rules.min !== undefined && value < rules.min) return false;
    if (rules.max !== undefined && value > rules.max) return false;
  }

  if (typeof value === 'string' && rules.pattern) {
    const regex = new RegExp(rules.pattern);
    if (!regex.test(value)) return false;
  }

  return true;
};

SystemConfigurationSchema.methods.rollback = async function(
  version: number, 
  changedBy: Types.ObjectId
): Promise<void> {
  if (this.isReadOnly) {
    throw new Error('Configuration is read-only');
  }

  const historyEntry = this.changeHistory.find(h => h.version === version);
  if (!historyEntry) {
    throw new Error('Version not found in history');
  }

  const { oldValue, environment } = historyEntry.changes;
  await this.setValue(oldValue, environment, changedBy, `Rollback to version ${version}`);
};

// Helper functions for encryption (implement based on your security requirements)
function encrypt(value: any): string {
  // Implement encryption logic
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

function decrypt(encryptedValue: string): any {
  // Implement decryption logic
  return JSON.parse(Buffer.from(encryptedValue, 'base64').toString());
}

// Create and export the model using admin connection (lazy initialization)
let _SystemConfiguration: mongoose.Model<ISystemConfiguration>;
export const SystemConfiguration = new Proxy({} as mongoose.Model<ISystemConfiguration>, {
  get(target, prop) {
    if (!_SystemConfiguration) {
      _SystemConfiguration = getAdminConnection().model<ISystemConfiguration>('SystemConfiguration', SystemConfigurationSchema);
    }
    return (_SystemConfiguration as any)[prop];
  }
});