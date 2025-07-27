import mongoose, { Schema, Document, Types } from 'mongoose';
import { getAdminConnection } from '../config/database';

// Enums and interfaces for SecurityAlert
export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum AlertStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  RESOLVED = 'resolved',
  FALSE_POSITIVE = 'false_positive',
  SUPPRESSED = 'suppressed'
}

export enum AlertCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  DATA_BREACH = 'data_breach',
  MALWARE = 'malware',
  INTRUSION = 'intrusion',
  DDOS = 'ddos',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  POLICY_VIOLATION = 'policy_violation',
  SYSTEM_COMPROMISE = 'system_compromise',
  NETWORK_ANOMALY = 'network_anomaly'
}

export enum ThreatLevel {
  INFORMATIONAL = 'informational',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ThreatIndicator {
  type: 'ip' | 'domain' | 'hash' | 'email' | 'user_agent' | 'pattern';
  value: string;
  confidence: number; // 0-100
  source: string;
  firstSeen: Date;
  lastSeen: Date;
  occurrences: number;
}

export interface AlertEvidence {
  type: 'log' | 'network' | 'file' | 'process' | 'registry' | 'memory';
  source: string;
  timestamp: Date;
  data: Record<string, any>;
  hash?: string;
}

export interface MitigationAction {
  id: string;
  type: 'block_ip' | 'disable_user' | 'quarantine_file' | 'restart_service' | 'custom';
  description: string;
  automated: boolean;
  executed: boolean;
  executedAt?: Date;
  executedBy?: Types.ObjectId;
  result?: string;
  error?: string;
}

export interface ISecurityAlert extends Document {
  _id: Types.ObjectId;
  title: string;
  description: string;
  category: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  threatLevel: ThreatLevel;
  riskScore: number; // 0-100
  confidence: number; // 0-100
  source: {
    system: string;
    component: string;
    detector: string;
    version?: string;
  };
  affectedAssets: {
    type: 'server' | 'database' | 'application' | 'user' | 'network';
    identifier: string;
    name: string;
    criticality: 'low' | 'medium' | 'high' | 'critical';
  }[];
  threatIndicators: ThreatIndicator[];
  evidence: AlertEvidence[];
  timeline: {
    timestamp: Date;
    event: string;
    details?: Record<string, any>;
    actor?: string;
  }[];
  mitigationActions: MitigationAction[];
  assignedTo?: Types.ObjectId;
  assignedAt?: Date;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  resolutionNotes?: string;
  falsePositiveReason?: string;
  suppressionRules?: {
    ruleId: string;
    reason: string;
    expiresAt?: Date;
  }[];
  relatedAlerts: Types.ObjectId[];
  parentAlert?: Types.ObjectId;
  childAlerts: Types.ObjectId[];
  tags: string[];
  customFields: Record<string, any>;
  notifications: {
    sent: boolean;
    channels: string[];
    sentAt?: Date;
    recipients: string[];
  };
  sla: {
    responseTime: number; // minutes
    resolutionTime: number; // minutes
    escalationTime: number; // minutes
    breached: boolean;
  };
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  escalate(): Promise<void>;
  assign(userId: Types.ObjectId): Promise<void>;
  resolve(resolvedBy: Types.ObjectId, notes: string): Promise<void>;
  markFalsePositive(reason: string, markedBy: Types.ObjectId): Promise<void>;
  suppress(ruleId: string, reason: string, expiresAt?: Date): Promise<void>;
  addEvidence(evidence: AlertEvidence): Promise<void>;
  executeMitigation(actionId: string, executedBy: Types.ObjectId): Promise<void>;
  calculateRiskScore(): number;
}

// SecurityAlert schema
const SecurityAlertSchema = new Schema<ISecurityAlert>({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
    index: true
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  category: {
    type: String,
    enum: Object.values(AlertCategory),
    required: true,
    index: true
  },
  severity: {
    type: String,
    enum: Object.values(AlertSeverity),
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: Object.values(AlertStatus),
    default: AlertStatus.OPEN,
    index: true
  },
  threatLevel: {
    type: String,
    enum: Object.values(ThreatLevel),
    required: true,
    index: true
  },
  riskScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    index: true
  },
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  source: {
    system: {
      type: String,
      required: true,
      maxlength: 100
    },
    component: {
      type: String,
      required: true,
      maxlength: 100
    },
    detector: {
      type: String,
      required: true,
      maxlength: 100
    },
    version: {
      type: String,
      maxlength: 50
    }
  },
  affectedAssets: [{
    type: {
      type: String,
      enum: ['server', 'database', 'application', 'user', 'network'],
      required: true
    },
    identifier: {
      type: String,
      required: true,
      maxlength: 200
    },
    name: {
      type: String,
      required: true,
      maxlength: 200
    },
    criticality: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true
    }
  }],
  threatIndicators: [{
    type: {
      type: String,
      enum: ['ip', 'domain', 'hash', 'email', 'user_agent', 'pattern'],
      required: true
    },
    value: {
      type: String,
      required: true,
      maxlength: 500
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    source: {
      type: String,
      required: true,
      maxlength: 100
    },
    firstSeen: {
      type: Date,
      required: true
    },
    lastSeen: {
      type: Date,
      required: true
    },
    occurrences: {
      type: Number,
      default: 1,
      min: 1
    }
  }],
  evidence: [{
    type: {
      type: String,
      enum: ['log', 'network', 'file', 'process', 'registry', 'memory'],
      required: true
    },
    source: {
      type: String,
      required: true,
      maxlength: 200
    },
    timestamp: {
      type: Date,
      required: true
    },
    data: {
      type: Schema.Types.Mixed,
      required: true
    },
    hash: {
      type: String,
      maxlength: 128
    }
  }],
  timeline: [{
    timestamp: {
      type: Date,
      required: true
    },
    event: {
      type: String,
      required: true,
      maxlength: 200
    },
    details: {
      type: Schema.Types.Mixed
    },
    actor: {
      type: String,
      maxlength: 100
    }
  }],
  mitigationActions: [{
    id: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['block_ip', 'disable_user', 'quarantine_file', 'restart_service', 'custom'],
      required: true
    },
    description: {
      type: String,
      required: true,
      maxlength: 500
    },
    automated: {
      type: Boolean,
      default: false
    },
    executed: {
      type: Boolean,
      default: false
    },
    executedAt: {
      type: Date
    },
    executedBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser'
    },
    result: {
      type: String,
      maxlength: 1000
    },
    error: {
      type: String,
      maxlength: 1000
    }
  }],
  assignedTo: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    index: true
  },
  assignedAt: {
    type: Date
  },
  resolvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser'
  },
  resolvedAt: {
    type: Date,
    index: true
  },
  resolutionNotes: {
    type: String,
    maxlength: 2000
  },
  falsePositiveReason: {
    type: String,
    maxlength: 1000
  },
  suppressionRules: [{
    ruleId: {
      type: String,
      required: true,
      maxlength: 100
    },
    reason: {
      type: String,
      required: true,
      maxlength: 500
    },
    expiresAt: {
      type: Date
    }
  }],
  relatedAlerts: [{
    type: Schema.Types.ObjectId,
    ref: 'SecurityAlert'
  }],
  parentAlert: {
    type: Schema.Types.ObjectId,
    ref: 'SecurityAlert'
  },
  childAlerts: [{
    type: Schema.Types.ObjectId,
    ref: 'SecurityAlert'
  }],
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  customFields: {
    type: Schema.Types.Mixed,
    default: {}
  },
  notifications: {
    sent: {
      type: Boolean,
      default: false
    },
    channels: [{
      type: String,
      maxlength: 50
    }],
    sentAt: {
      type: Date
    },
    recipients: [{
      type: String,
      maxlength: 200
    }]
  },
  sla: {
    responseTime: {
      type: Number,
      required: true,
      min: 1
    },
    resolutionTime: {
      type: Number,
      required: true,
      min: 1
    },
    escalationTime: {
      type: Number,
      required: true,
      min: 1
    },
    breached: {
      type: Boolean,
      default: false,
      index: true
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for optimal query performance
SecurityAlertSchema.index({ createdAt: -1 });
SecurityAlertSchema.index({ severity: 1, status: 1 });
SecurityAlertSchema.index({ category: 1, threatLevel: 1 });
SecurityAlertSchema.index({ assignedTo: 1, status: 1 });
SecurityAlertSchema.index({ riskScore: -1 });
SecurityAlertSchema.index({ 'source.system': 1, createdAt: -1 });
SecurityAlertSchema.index({ tags: 1 });
SecurityAlertSchema.index({ 'sla.breached': 1, status: 1 });

// Instance methods
SecurityAlertSchema.methods.escalate = async function(): Promise<void> {
  const severityOrder = [AlertSeverity.LOW, AlertSeverity.MEDIUM, AlertSeverity.HIGH, AlertSeverity.CRITICAL];
  const currentIndex = severityOrder.indexOf(this.severity);
  
  if (currentIndex < severityOrder.length - 1) {
    this.severity = severityOrder[currentIndex + 1];
    this.timeline.push({
      timestamp: new Date(),
      event: 'Alert escalated',
      details: { newSeverity: this.severity }
    });
    
    await this.save();
  }
};

SecurityAlertSchema.methods.assign = async function(userId: Types.ObjectId): Promise<void> {
  this.assignedTo = userId;
  this.assignedAt = new Date();
  this.status = AlertStatus.INVESTIGATING;
  
  this.timeline.push({
    timestamp: new Date(),
    event: 'Alert assigned',
    details: { assignedTo: userId }
  });
  
  await this.save();
};

SecurityAlertSchema.methods.resolve = async function(
  resolvedBy: Types.ObjectId, 
  notes: string
): Promise<void> {
  this.status = AlertStatus.RESOLVED;
  this.resolvedBy = resolvedBy;
  this.resolvedAt = new Date();
  this.resolutionNotes = notes;
  
  this.timeline.push({
    timestamp: new Date(),
    event: 'Alert resolved',
    details: { resolvedBy, notes }
  });
  
  await this.save();
};

SecurityAlertSchema.methods.markFalsePositive = async function(
  reason: string, 
  markedBy: Types.ObjectId
): Promise<void> {
  this.status = AlertStatus.FALSE_POSITIVE;
  this.falsePositiveReason = reason;
  this.resolvedBy = markedBy;
  this.resolvedAt = new Date();
  
  this.timeline.push({
    timestamp: new Date(),
    event: 'Marked as false positive',
    details: { markedBy, reason }
  });
  
  await this.save();
};

SecurityAlertSchema.methods.suppress = async function(
  ruleId: string, 
  reason: string, 
  expiresAt?: Date
): Promise<void> {
  this.status = AlertStatus.SUPPRESSED;
  this.suppressionRules = this.suppressionRules || [];
  this.suppressionRules.push({ ruleId, reason, expiresAt });
  
  this.timeline.push({
    timestamp: new Date(),
    event: 'Alert suppressed',
    details: { ruleId, reason, expiresAt }
  });
  
  await this.save();
};

SecurityAlertSchema.methods.addEvidence = async function(evidence: AlertEvidence): Promise<void> {
  this.evidence.push(evidence);
  
  this.timeline.push({
    timestamp: new Date(),
    event: 'Evidence added',
    details: { evidenceType: evidence.type, source: evidence.source }
  });
  
  await this.save();
};

SecurityAlertSchema.methods.executeMitigation = async function(
  actionId: string, 
  executedBy: Types.ObjectId
): Promise<void> {
  const action = this.mitigationActions.find(a => a.id === actionId);
  if (!action) {
    throw new Error('Mitigation action not found');
  }

  action.executed = true;
  action.executedAt = new Date();
  action.executedBy = executedBy;
  
  this.timeline.push({
    timestamp: new Date(),
    event: 'Mitigation action executed',
    details: { actionId, actionType: action.type, executedBy }
  });
  
  await this.save();
};

SecurityAlertSchema.methods.calculateRiskScore = function(): number {
  let score = 0;
  
  // Base score from severity
  const severityScores = {
    [AlertSeverity.LOW]: 20,
    [AlertSeverity.MEDIUM]: 40,
    [AlertSeverity.HIGH]: 70,
    [AlertSeverity.CRITICAL]: 90
  };
  score += severityScores[this.severity] || 0;
  
  // Adjust based on confidence
  score = score * (this.confidence / 100);
  
  // Adjust based on affected assets criticality
  const criticalAssets = this.affectedAssets.filter(a => a.criticality === 'critical').length;
  const highAssets = this.affectedAssets.filter(a => a.criticality === 'high').length;
  score += (criticalAssets * 10) + (highAssets * 5);
  
  // Adjust based on threat indicators
  const highConfidenceIndicators = this.threatIndicators.filter(ti => ti.confidence > 80).length;
  score += highConfidenceIndicators * 5;
  
  return Math.min(Math.round(score), 100);
};

// Pre-save middleware to calculate risk score
SecurityAlertSchema.pre('save', function(next) {
  this.riskScore = this.calculateRiskScore();
  next();
});

// Create and export the model using admin connection (lazy initialization)
let _SecurityAlert: mongoose.Model<ISecurityAlert>;
export const SecurityAlert = new Proxy({} as mongoose.Model<ISecurityAlert>, {
  get(target, prop) {
    if (!_SecurityAlert) {
      _SecurityAlert = getAdminConnection().model<ISecurityAlert>('SecurityAlert', SecurityAlertSchema);
    }
    return (_SecurityAlert as any)[prop];
  }
});