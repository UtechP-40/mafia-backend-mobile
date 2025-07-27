import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for MaintenanceSchedule
export enum MaintenanceType {
  SCHEDULED = 'scheduled',
  EMERGENCY = 'emergency',
  ROLLING = 'rolling',
  PARTIAL = 'partial'
}

export enum MaintenanceStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed'
}

export enum RecurrenceType {
  NONE = 'none',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly'
}

export interface NotificationSettings {
  enabled: boolean;
  channels: ('email' | 'sms' | 'slack' | 'webhook')[];
  recipients: string[];
  advanceNotice: number; // minutes before maintenance
  reminderIntervals: number[]; // minutes before maintenance for reminders
}

export interface MaintenanceTask {
  id: string;
  name: string;
  description: string;
  estimatedDuration: number; // minutes
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  assignedTo?: Types.ObjectId;
}

export interface IMaintenanceSchedule extends Document {
  _id: Types.ObjectId;
  title: string;
  description: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStart?: Date;
  actualEnd?: Date;
  estimatedDuration: number; // minutes
  actualDuration?: number; // minutes
  affectedServices: string[];
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  recurrence: {
    type: RecurrenceType;
    interval?: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    endDate?: Date;
  };
  notifications: NotificationSettings;
  tasks: MaintenanceTask[];
  approvals: {
    required: boolean;
    approvers: Types.ObjectId[];
    approved: boolean;
    approvedBy?: Types.ObjectId;
    approvedAt?: Date;
    rejectedBy?: Types.ObjectId;
    rejectedAt?: Date;
    rejectionReason?: string;
  };
  rollbackPlan?: {
    enabled: boolean;
    steps: string[];
    triggerConditions: string[];
    automaticRollback: boolean;
  };
  healthChecks: {
    preMaintenanceChecks: string[];
    postMaintenanceChecks: string[];
    rollbackChecks: string[];
  };
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  executedBy?: Types.ObjectId;
  logs: {
    timestamp: Date;
    level: 'info' | 'warn' | 'error';
    message: string;
    details?: Record<string, any>;
  }[];
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  canStart(): boolean;
  start(executedBy: Types.ObjectId): Promise<void>;
  complete(): Promise<void>;
  cancel(reason: string, cancelledBy: Types.ObjectId): Promise<void>;
  addLog(level: string, message: string, details?: Record<string, any>): void;
  updateTaskStatus(taskId: string, status: string, error?: string): Promise<void>;
  calculateProgress(): number;
}

// MaintenanceSchedule schema
const MaintenanceScheduleSchema = new Schema<IMaintenanceSchedule>({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  type: {
    type: String,
    enum: Object.values(MaintenanceType),
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: Object.values(MaintenanceStatus),
    default: MaintenanceStatus.SCHEDULED,
    index: true
  },
  scheduledStart: {
    type: Date,
    required: true,
    index: true
  },
  scheduledEnd: {
    type: Date,
    required: true,
    index: true
  },
  actualStart: {
    type: Date
  },
  actualEnd: {
    type: Date
  },
  estimatedDuration: {
    type: Number,
    required: true,
    min: 1
  },
  actualDuration: {
    type: Number,
    min: 0
  },
  affectedServices: [{
    type: String,
    trim: true,
    maxlength: 100
  }],
  impactLevel: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
    index: true
  },
  recurrence: {
    type: {
      type: String,
      enum: Object.values(RecurrenceType),
      default: RecurrenceType.NONE
    },
    interval: {
      type: Number,
      min: 1
    },
    daysOfWeek: [{
      type: Number,
      min: 0,
      max: 6
    }],
    dayOfMonth: {
      type: Number,
      min: 1,
      max: 31
    },
    endDate: {
      type: Date
    }
  },
  notifications: {
    enabled: {
      type: Boolean,
      default: true
    },
    channels: [{
      type: String,
      enum: ['email', 'sms', 'slack', 'webhook']
    }],
    recipients: [{
      type: String,
      trim: true
    }],
    advanceNotice: {
      type: Number,
      default: 60,
      min: 0
    },
    reminderIntervals: [{
      type: Number,
      min: 0
    }]
  },
  tasks: [{
    id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true,
      maxlength: 200
    },
    description: {
      type: String,
      maxlength: 1000
    },
    estimatedDuration: {
      type: Number,
      required: true,
      min: 1
    },
    dependencies: [{
      type: String
    }],
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'failed', 'skipped'],
      default: 'pending'
    },
    startedAt: {
      type: Date
    },
    completedAt: {
      type: Date
    },
    error: {
      type: String,
      maxlength: 1000
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser'
    }
  }],
  approvals: {
    required: {
      type: Boolean,
      default: false
    },
    approvers: [{
      type: Schema.Types.ObjectId,
      ref: 'SuperUser'
    }],
    approved: {
      type: Boolean,
      default: false
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser'
    },
    approvedAt: {
      type: Date
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser'
    },
    rejectedAt: {
      type: Date
    },
    rejectionReason: {
      type: String,
      maxlength: 500
    }
  },
  rollbackPlan: {
    enabled: {
      type: Boolean,
      default: false
    },
    steps: [{
      type: String,
      maxlength: 500
    }],
    triggerConditions: [{
      type: String,
      maxlength: 200
    }],
    automaticRollback: {
      type: Boolean,
      default: false
    }
  },
  healthChecks: {
    preMaintenanceChecks: [{
      type: String,
      maxlength: 200
    }],
    postMaintenanceChecks: [{
      type: String,
      maxlength: 200
    }],
    rollbackChecks: [{
      type: String,
      maxlength: 200
    }]
  },
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
  executedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser'
  },
  logs: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    level: {
      type: String,
      enum: ['info', 'warn', 'error'],
      required: true
    },
    message: {
      type: String,
      required: true,
      maxlength: 1000
    },
    details: {
      type: Schema.Types.Mixed
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
MaintenanceScheduleSchema.index({ scheduledStart: 1, status: 1 });
MaintenanceScheduleSchema.index({ type: 1, impactLevel: 1 });
MaintenanceScheduleSchema.index({ status: 1, scheduledStart: 1 });
MaintenanceScheduleSchema.index({ createdBy: 1, createdAt: -1 });
MaintenanceScheduleSchema.index({ affectedServices: 1 });

// Instance methods
MaintenanceScheduleSchema.methods.canStart = function(): boolean {
  if (this.status !== MaintenanceStatus.SCHEDULED) {
    return false;
  }

  if (this.approvals.required && !this.approvals.approved) {
    return false;
  }

  const now = new Date();
  const scheduledStart = new Date(this.scheduledStart);
  
  // Allow starting up to 15 minutes before scheduled time
  return now >= new Date(scheduledStart.getTime() - 15 * 60 * 1000);
};

MaintenanceScheduleSchema.methods.start = async function(executedBy: Types.ObjectId): Promise<void> {
  if (!this.canStart()) {
    throw new Error('Maintenance cannot be started at this time');
  }

  this.status = MaintenanceStatus.IN_PROGRESS;
  this.actualStart = new Date();
  this.executedBy = executedBy;
  
  this.addLog('info', 'Maintenance started', { executedBy });
  
  await this.save();
};

MaintenanceScheduleSchema.methods.complete = async function(): Promise<void> {
  if (this.status !== MaintenanceStatus.IN_PROGRESS) {
    throw new Error('Maintenance is not in progress');
  }

  const now = new Date();
  this.status = MaintenanceStatus.COMPLETED;
  this.actualEnd = now;
  
  if (this.actualStart) {
    this.actualDuration = Math.floor((now.getTime() - this.actualStart.getTime()) / (1000 * 60));
  }
  
  this.addLog('info', 'Maintenance completed successfully');
  
  await this.save();
};

MaintenanceScheduleSchema.methods.cancel = async function(
  reason: string, 
  cancelledBy: Types.ObjectId
): Promise<void> {
  if (this.status === MaintenanceStatus.COMPLETED) {
    throw new Error('Cannot cancel completed maintenance');
  }

  this.status = MaintenanceStatus.CANCELLED;
  this.addLog('warn', `Maintenance cancelled: ${reason}`, { cancelledBy });
  
  await this.save();
};

MaintenanceScheduleSchema.methods.addLog = function(
  level: string, 
  message: string, 
  details?: Record<string, any>
): void {
  this.logs.push({
    timestamp: new Date(),
    level: level as 'info' | 'warn' | 'error',
    message,
    details
  });
};

MaintenanceScheduleSchema.methods.updateTaskStatus = async function(
  taskId: string, 
  status: string, 
  error?: string
): Promise<void> {
  const task = this.tasks.find(t => t.id === taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  const oldStatus = task.status;
  task.status = status as any;
  
  if (status === 'in_progress') {
    task.startedAt = new Date();
  } else if (status === 'completed' || status === 'failed' || status === 'skipped') {
    task.completedAt = new Date();
    if (error) {
      task.error = error;
    }
  }

  this.addLog('info', `Task ${task.name} status changed from ${oldStatus} to ${status}`, {
    taskId,
    taskName: task.name,
    error
  });

  await this.save();
};

MaintenanceScheduleSchema.methods.calculateProgress = function(): number {
  if (this.tasks.length === 0) return 0;

  const completedTasks = this.tasks.filter(t => 
    t.status === 'completed' || t.status === 'skipped'
  ).length;

  return Math.round((completedTasks / this.tasks.length) * 100);
};

// Create and export the model using admin connection (lazy initialization)
let _MaintenanceSchedule: mongoose.Model<IMaintenanceSchedule>;
export const MaintenanceSchedule = new Proxy({} as mongoose.Model<IMaintenanceSchedule>, {
  get(target, prop) {
    if (!_MaintenanceSchedule) {
      _MaintenanceSchedule = getAdminConnection().model<IMaintenanceSchedule>('MaintenanceSchedule', MaintenanceScheduleSchema);
    }
    return (_MaintenanceSchedule as any)[prop];
  }
});