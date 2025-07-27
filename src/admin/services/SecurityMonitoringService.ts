import { Types } from 'mongoose';
import { SecurityAlert, ISecurityAlert, AlertSeverity, AlertStatus, AlertCategory, ThreatLevel } from '../models/SecurityAlert';
import { AdminLog, ActionType, LogLevel } from '../models/AdminLog';
import { adminLogger } from '../config/logger';

export interface SecurityEvent {
  type: string;
  source: string;
  timestamp: Date;
  severity: AlertSeverity;
  data: Record<string, any>;
  userId?: string;
  ip?: string;
  userAgent?: string;
}

export interface ThreatIntelligence {
  indicators: {
    ips: string[];
    domains: string[];
    hashes: string[];
    patterns: string[];
  };
  lastUpdated: Date;
  source: string;
}

export interface SecurityMetrics {
  totalAlerts: number;
  openAlerts: number;
  criticalAlerts: number;
  resolvedToday: number;
  averageResolutionTime: number;
  topCategories: { category: string; count: number }[];
  threatTrends: { date: string; count: number }[];
}

export class SecurityMonitoringService {
  private static instance: SecurityMonitoringService;
  private threatIntelligence: ThreatIntelligence | null = null;
  private activeMonitors: Map<string, any> = new Map();

  public static getInstance(): SecurityMonitoringService {
    if (!SecurityMonitoringService.instance) {
      SecurityMonitoringService.instance = new SecurityMonitoringService();
    }
    return SecurityMonitoringService.instance;
  }

  constructor() {
    this.initializeMonitoring();
  }

  // Alert Management
  async createSecurityAlert(
    alertData: {
      title: string;
      description: string;
      category: AlertCategory;
      severity: AlertSeverity;
      threatLevel: ThreatLevel;
      source: {
        system: string;
        component: string;
        detector: string;
        version?: string;
      };
      affectedAssets?: any[];
      threatIndicators?: any[];
      evidence?: any[];
      mitigationActions?: any[];
    }
  ): Promise<ISecurityAlert> {
    try {
      const alert = new SecurityAlert({
        ...alertData,
        confidence: this.calculateConfidence(alertData),
        timeline: [{
          timestamp: new Date(),
          event: 'Alert created',
          details: { source: alertData.source }
        }],
        sla: this.calculateSLA(alertData.severity, alertData.threatLevel)
      });

      await alert.save();

      // Auto-assign based on category and severity
      await this.autoAssignAlert(alert);

      // Execute automated mitigations if available
      await this.executeAutomatedMitigations(alert);

      // Send notifications
      await this.sendAlertNotifications(alert);

      adminLogger.warn('Security alert created', {
        alertId: alert._id,
        title: alertData.title,
        category: alertData.category,
        severity: alertData.severity,
        threatLevel: alertData.threatLevel
      });

      return alert;
    } catch (error) {
      adminLogger.error('Failed to create security alert', {
        error: error instanceof Error ? error.message : 'Unknown error',
        alertData
      });
      throw error;
    }
  }

  async getSecurityAlerts(
    filters: {
      status?: AlertStatus;
      severity?: AlertSeverity;
      category?: AlertCategory;
      assignedTo?: Types.ObjectId;
      startDate?: Date;
      endDate?: Date;
      riskScoreMin?: number;
      riskScoreMax?: number;
    } = {},
    page: number = 1,
    limit: number = 20
  ): Promise<{
    alerts: ISecurityAlert[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const query: any = {};

      if (filters.status) query.status = filters.status;
      if (filters.severity) query.severity = filters.severity;
      if (filters.category) query.category = filters.category;
      if (filters.assignedTo) query.assignedTo = filters.assignedTo;
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = filters.startDate;
        if (filters.endDate) query.createdAt.$lte = filters.endDate;
      }
      if (filters.riskScoreMin !== undefined || filters.riskScoreMax !== undefined) {
        query.riskScore = {};
        if (filters.riskScoreMin !== undefined) query.riskScore.$gte = filters.riskScoreMin;
        if (filters.riskScoreMax !== undefined) query.riskScore.$lte = filters.riskScoreMax;
      }

      const skip = (page - 1) * limit;
      const [alerts, total] = await Promise.all([
        SecurityAlert.find(query)
          .sort({ createdAt: -1, riskScore: -1 })
          .skip(skip)
          .limit(limit)
          .populate('assignedTo', 'username')
          .populate('resolvedBy', 'username'),
        SecurityAlert.countDocuments(query)
      ]);

      return {
        alerts,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      adminLogger.error('Failed to get security alerts', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filters,
        page,
        limit
      });
      throw error;
    }
  }

  async assignAlert(
    alertId: Types.ObjectId,
    assignedTo: Types.ObjectId,
    assignedBy: Types.ObjectId
  ): Promise<ISecurityAlert> {
    try {
      const alert = await SecurityAlert.findById(alertId);
      if (!alert) {
        throw new Error('Security alert not found');
      }

      await alert.assign(assignedTo);

      // Log the action
      await AdminLog.create({
        userId: assignedBy,
        level: LogLevel.INFO,
        action: ActionType.SECURITY_ALERT,
        message: `Assigned security alert: ${alert.title}`,
        details: {
          alertId,
          assignedTo,
          category: alert.category,
          severity: alert.severity
        },
        success: true
      });

      adminLogger.info('Security alert assigned', {
        assignedBy,
        alertId,
        assignedTo,
        title: alert.title
      });

      return alert;
    } catch (error) {
      adminLogger.error('Failed to assign security alert', {
        error: error instanceof Error ? error.message : 'Unknown error',
        assignedBy,
        alertId,
        assignedTo
      });
      throw error;
    }
  }

  async resolveAlert(
    alertId: Types.ObjectId,
    resolutionNotes: string,
    resolvedBy: Types.ObjectId
  ): Promise<ISecurityAlert> {
    try {
      const alert = await SecurityAlert.findById(alertId);
      if (!alert) {
        throw new Error('Security alert not found');
      }

      await alert.resolve(resolvedBy, resolutionNotes);

      // Log the action
      await AdminLog.create({
        userId: resolvedBy,
        level: LogLevel.INFO,
        action: ActionType.SECURITY_ALERT,
        message: `Resolved security alert: ${alert.title}`,
        details: {
          alertId,
          resolutionNotes,
          category: alert.category,
          severity: alert.severity,
          resolutionTime: alert.resolvedAt ? 
            (alert.resolvedAt.getTime() - alert.createdAt.getTime()) / (1000 * 60) : 0
        },
        success: true
      });

      adminLogger.info('Security alert resolved', {
        resolvedBy,
        alertId,
        title: alert.title,
        resolutionNotes
      });

      return alert;
    } catch (error) {
      adminLogger.error('Failed to resolve security alert', {
        error: error instanceof Error ? error.message : 'Unknown error',
        resolvedBy,
        alertId
      });
      throw error;
    }
  }

  // Intrusion Detection
  async analyzeSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Check against threat intelligence
      const isThreat = await this.checkThreatIntelligence(event);
      
      // Analyze patterns
      const patterns = await this.analyzePatterns(event);
      
      // Check for anomalies
      const anomalies = await this.detectAnomalies(event);

      // Create alert if threat detected
      if (isThreat || patterns.length > 0 || anomalies.length > 0) {
        await this.createThreatAlert(event, { isThreat, patterns, anomalies });
      }

      // Update monitoring metrics
      await this.updateMonitoringMetrics(event);

    } catch (error) {
      adminLogger.error('Failed to analyze security event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event
      });
    }
  }

  private async checkThreatIntelligence(event: SecurityEvent): Promise<boolean> {
    if (!this.threatIntelligence) {
      await this.updateThreatIntelligence();
    }

    if (!this.threatIntelligence) return false;

    const { indicators } = this.threatIntelligence;

    // Check IP addresses
    if (event.ip && indicators.ips.includes(event.ip)) {
      return true;
    }

    // Check domains
    if (event.data.domain && indicators.domains.some(domain => 
      event.data.domain.includes(domain)
    )) {
      return true;
    }

    // Check file hashes
    if (event.data.hash && indicators.hashes.includes(event.data.hash)) {
      return true;
    }

    // Check patterns
    const eventString = JSON.stringify(event.data);
    if (indicators.patterns.some(pattern => {
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(eventString);
      } catch {
        return false;
      }
    })) {
      return true;
    }

    return false;
  }

  private async analyzePatterns(event: SecurityEvent): Promise<string[]> {
    const patterns: string[] = [];

    // Check for brute force patterns
    if (event.type === 'login_failed' && event.userId) {
      const recentFailures = await this.getRecentFailedLogins(event.userId, 15); // 15 minutes
      if (recentFailures >= 5) {
        patterns.push('brute_force_attack');
      }
    }

    // Check for suspicious user agent patterns
    if (event.userAgent) {
      const suspiciousPatterns = [
        /bot/i,
        /crawler/i,
        /scanner/i,
        /sqlmap/i,
        /nikto/i
      ];
      
      if (suspiciousPatterns.some(pattern => pattern.test(event.userAgent!))) {
        patterns.push('suspicious_user_agent');
      }
    }

    // Check for unusual access patterns
    if (event.type === 'api_access' && event.ip) {
      const recentRequests = await this.getRecentRequestsByIP(event.ip, 5); // 5 minutes
      if (recentRequests >= 100) {
        patterns.push('high_frequency_requests');
      }
    }

    return patterns;
  }

  private async detectAnomalies(event: SecurityEvent): Promise<string[]> {
    const anomalies: string[] = [];

    // Check for geographical anomalies
    if (event.userId && event.data.country) {
      const userCountries = await this.getUserCountryHistory(event.userId);
      if (userCountries.length > 0 && !userCountries.includes(event.data.country)) {
        anomalies.push('geographical_anomaly');
      }
    }

    // Check for time-based anomalies
    const hour = event.timestamp.getHours();
    if (hour < 6 || hour > 22) { // Outside normal hours
      const userActivity = await this.getUserActivityPattern(event.userId);
      if (userActivity && !userActivity.nightActivity) {
        anomalies.push('unusual_time_access');
      }
    }

    return anomalies;
  }

  private async createThreatAlert(
    event: SecurityEvent,
    analysis: { isThreat: boolean; patterns: string[]; anomalies: string[] }
  ): Promise<void> {
    let severity = AlertSeverity.LOW;
    let threatLevel = ThreatLevel.LOW;

    // Determine severity based on analysis
    if (analysis.isThreat) {
      severity = AlertSeverity.HIGH;
      threatLevel = ThreatLevel.HIGH;
    } else if (analysis.patterns.includes('brute_force_attack')) {
      severity = AlertSeverity.MEDIUM;
      threatLevel = ThreatLevel.MEDIUM;
    } else if (analysis.patterns.length > 0 || analysis.anomalies.length > 0) {
      severity = AlertSeverity.LOW;
      threatLevel = ThreatLevel.LOW;
    }

    await this.createSecurityAlert({
      title: `Security Event: ${event.type}`,
      description: `Suspicious activity detected: ${[...analysis.patterns, ...analysis.anomalies].join(', ')}`,
      category: this.mapEventToCategory(event.type),
      severity,
      threatLevel,
      source: {
        system: 'security_monitoring',
        component: 'intrusion_detection',
        detector: 'pattern_analyzer',
        version: '1.0'
      },
      threatIndicators: [{
        type: 'ip',
        value: event.ip || 'unknown',
        confidence: analysis.isThreat ? 90 : 60,
        source: 'internal_analysis',
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        occurrences: 1
      }],
      evidence: [{
        type: 'log',
        source: event.source,
        timestamp: event.timestamp,
        data: event.data
      }]
    });
  }

  // Automated Response
  private async autoAssignAlert(alert: ISecurityAlert): Promise<void> {
    // Auto-assign based on category and severity
    const assignmentRules = {
      [AlertCategory.AUTHENTICATION]: 'security_team',
      [AlertCategory.INTRUSION]: 'incident_response',
      [AlertCategory.DDOS]: 'network_team',
      [AlertCategory.MALWARE]: 'security_team'
    };

    const team = assignmentRules[alert.category];
    if (team) {
      // In a real implementation, you would look up team members
      // For now, we'll just log the auto-assignment
      adminLogger.info('Auto-assigned alert', {
        alertId: alert._id,
        category: alert.category,
        assignedTeam: team
      });
    }
  }

  private async executeAutomatedMitigations(alert: ISecurityAlert): Promise<void> {
    for (const action of alert.mitigationActions.filter(a => a.automated)) {
      try {
        await this.executeMitigationAction(action, alert);
        
        action.executed = true;
        action.executedAt = new Date();
        action.result = 'Automated execution successful';
        
        await alert.save();
        
        adminLogger.info('Automated mitigation executed', {
          alertId: alert._id,
          actionType: action.type,
          actionId: action.id
        });
      } catch (error) {
        action.error = error instanceof Error ? error.message : 'Unknown error';
        await alert.save();
        
        adminLogger.error('Automated mitigation failed', {
          alertId: alert._id,
          actionType: action.type,
          actionId: action.id,
          error: action.error
        });
      }
    }
  }

  private async executeMitigationAction(action: any, alert: ISecurityAlert): Promise<void> {
    switch (action.type) {
      case 'block_ip':
        await this.blockIP(action.description);
        break;
      case 'disable_user':
        await this.disableUser(action.description);
        break;
      case 'quarantine_file':
        await this.quarantineFile(action.description);
        break;
      case 'restart_service':
        await this.restartService(action.description);
        break;
      default:
        throw new Error(`Unknown mitigation action type: ${action.type}`);
    }
  }

  // Threat Intelligence
  private async updateThreatIntelligence(): Promise<void> {
    try {
      // In a real implementation, this would fetch from external threat intelligence feeds
      this.threatIntelligence = {
        indicators: {
          ips: [
            '192.168.1.100', // Example malicious IP
            '10.0.0.50'
          ],
          domains: [
            'malicious-domain.com',
            'phishing-site.net'
          ],
          hashes: [
            'a1b2c3d4e5f6',
            '1234567890abcdef'
          ],
          patterns: [
            'union.*select',
            'script.*alert',
            'eval\\(',
            'base64_decode'
          ]
        },
        lastUpdated: new Date(),
        source: 'internal_feeds'
      };

      adminLogger.info('Threat intelligence updated', {
        indicatorCounts: {
          ips: this.threatIntelligence.indicators.ips.length,
          domains: this.threatIntelligence.indicators.domains.length,
          hashes: this.threatIntelligence.indicators.hashes.length,
          patterns: this.threatIntelligence.indicators.patterns.length
        }
      });
    } catch (error) {
      adminLogger.error('Failed to update threat intelligence', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Security Metrics
  async getSecurityMetrics(
    startDate?: Date,
    endDate?: Date
  ): Promise<SecurityMetrics> {
    try {
      const dateFilter: any = {};
      if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate) dateFilter.createdAt.$gte = startDate;
        if (endDate) dateFilter.createdAt.$lte = endDate;
      }

      const [
        totalAlerts,
        openAlerts,
        criticalAlerts,
        resolvedToday,
        categoryStats,
        resolutionTimes
      ] = await Promise.all([
        SecurityAlert.countDocuments(dateFilter),
        SecurityAlert.countDocuments({ ...dateFilter, status: AlertStatus.OPEN }),
        SecurityAlert.countDocuments({ ...dateFilter, severity: AlertSeverity.CRITICAL }),
        SecurityAlert.countDocuments({
          ...dateFilter,
          status: AlertStatus.RESOLVED,
          resolvedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }),
        SecurityAlert.aggregate([
          { $match: dateFilter },
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]),
        SecurityAlert.find({
          ...dateFilter,
          status: AlertStatus.RESOLVED,
          resolvedAt: { $exists: true }
        }, 'createdAt resolvedAt')
      ]);

      const averageResolutionTime = resolutionTimes.length > 0
        ? resolutionTimes.reduce((sum, alert) => {
            const resolutionTime = (alert.resolvedAt!.getTime() - alert.createdAt.getTime()) / (1000 * 60);
            return sum + resolutionTime;
          }, 0) / resolutionTimes.length
        : 0;

      const topCategories = categoryStats.map((stat: any) => ({
        category: stat._id,
        count: stat.count
      }));

      // Generate threat trends (simplified)
      const threatTrends = await this.generateThreatTrends(startDate, endDate);

      return {
        totalAlerts,
        openAlerts,
        criticalAlerts,
        resolvedToday,
        averageResolutionTime: Math.round(averageResolutionTime),
        topCategories,
        threatTrends
      };
    } catch (error) {
      adminLogger.error('Failed to get security metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        startDate,
        endDate
      });
      throw error;
    }
  }

  private async generateThreatTrends(startDate?: Date, endDate?: Date): Promise<{ date: string; count: number }[]> {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const end = endDate || new Date();

    const trends = await SecurityAlert.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return trends.map(trend => ({
      date: trend._id,
      count: trend.count
    }));
  }

  // Monitoring Setup
  private async initializeMonitoring(): Promise<void> {
    try {
      // Initialize real-time monitoring
      await this.setupLogMonitoring();
      await this.setupNetworkMonitoring();
      await this.setupFileIntegrityMonitoring();
      
      // Update threat intelligence
      await this.updateThreatIntelligence();
      
      // Schedule periodic updates
      setInterval(() => {
        this.updateThreatIntelligence();
      }, 60 * 60 * 1000); // Update every hour

      adminLogger.info('Security monitoring initialized');
    } catch (error) {
      adminLogger.error('Failed to initialize security monitoring', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async setupLogMonitoring(): Promise<void> {
    // Setup log file monitoring
    adminLogger.info('Log monitoring setup completed');
  }

  private async setupNetworkMonitoring(): Promise<void> {
    // Setup network traffic monitoring
    adminLogger.info('Network monitoring setup completed');
  }

  private async setupFileIntegrityMonitoring(): Promise<void> {
    // Setup file integrity monitoring
    adminLogger.info('File integrity monitoring setup completed');
  }

  // Helper methods
  private calculateConfidence(alertData: any): number {
    let confidence = 50; // Base confidence

    // Increase confidence based on multiple indicators
    if (alertData.threatIndicators && alertData.threatIndicators.length > 1) {
      confidence += 20;
    }

    // Increase confidence based on evidence
    if (alertData.evidence && alertData.evidence.length > 0) {
      confidence += 15;
    }

    // Increase confidence based on severity
    if (alertData.severity === AlertSeverity.CRITICAL) {
      confidence += 15;
    } else if (alertData.severity === AlertSeverity.HIGH) {
      confidence += 10;
    }

    return Math.min(confidence, 100);
  }

  private calculateSLA(severity: AlertSeverity, threatLevel: ThreatLevel): any {
    const slaMatrix = {
      [AlertSeverity.CRITICAL]: { response: 15, resolution: 240, escalation: 30 },
      [AlertSeverity.HIGH]: { response: 30, resolution: 480, escalation: 60 },
      [AlertSeverity.MEDIUM]: { response: 60, resolution: 1440, escalation: 120 },
      [AlertSeverity.LOW]: { response: 240, resolution: 2880, escalation: 480 }
    };

    const sla = slaMatrix[severity];
    
    // Adjust based on threat level
    if (threatLevel === ThreatLevel.CRITICAL) {
      sla.response = Math.floor(sla.response * 0.5);
      sla.resolution = Math.floor(sla.resolution * 0.7);
    }

    return {
      responseTime: sla.response,
      resolutionTime: sla.resolution,
      escalationTime: sla.escalation,
      breached: false
    };
  }

  private mapEventToCategory(eventType: string): AlertCategory {
    const categoryMap: Record<string, AlertCategory> = {
      'login_failed': AlertCategory.AUTHENTICATION,
      'unauthorized_access': AlertCategory.AUTHORIZATION,
      'malware_detected': AlertCategory.MALWARE,
      'intrusion_detected': AlertCategory.INTRUSION,
      'ddos_attack': AlertCategory.DDOS,
      'suspicious_activity': AlertCategory.SUSPICIOUS_ACTIVITY,
      'policy_violation': AlertCategory.POLICY_VIOLATION,
      'system_compromise': AlertCategory.SYSTEM_COMPROMISE,
      'network_anomaly': AlertCategory.NETWORK_ANOMALY
    };

    return categoryMap[eventType] || AlertCategory.SUSPICIOUS_ACTIVITY;
  }

  // Placeholder methods for mitigation actions
  private async blockIP(ip: string): Promise<void> {
    adminLogger.info('IP blocked', { ip });
  }

  private async disableUser(userId: string): Promise<void> {
    adminLogger.info('User disabled', { userId });
  }

  private async quarantineFile(filePath: string): Promise<void> {
    adminLogger.info('File quarantined', { filePath });
  }

  private async restartService(serviceName: string): Promise<void> {
    adminLogger.info('Service restarted', { serviceName });
  }

  // Placeholder methods for pattern analysis
  private async getRecentFailedLogins(userId: string, minutes: number): Promise<number> {
    // Implementation would query actual logs
    return 0;
  }

  private async getRecentRequestsByIP(ip: string, minutes: number): Promise<number> {
    // Implementation would query actual logs
    return 0;
  }

  private async getUserCountryHistory(userId?: string): Promise<string[]> {
    // Implementation would query user location history
    return [];
  }

  private async getUserActivityPattern(userId?: string): Promise<any> {
    // Implementation would analyze user activity patterns
    return null;
  }

  private async sendAlertNotifications(alert: ISecurityAlert): Promise<void> {
    // Implementation would send notifications via configured channels
    adminLogger.info('Alert notifications sent', {
      alertId: alert._id,
      severity: alert.severity
    });
  }
}

export default SecurityMonitoringService;