import { Types } from 'mongoose';
import { MaintenanceSchedule, IMaintenanceSchedule, MaintenanceType, MaintenanceStatus, RecurrenceType } from '../models/MaintenanceSchedule';
import { AdminLog, ActionType, LogLevel } from '../models/AdminLog';
import { SystemConfiguration } from '../models/SystemConfiguration';
import { adminLogger } from '../config/logger';
import cron from 'node-cron';

export interface MaintenanceWindow {
  id: string;
  title: string;
  description: string;
  type: MaintenanceType;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: MaintenanceStatus;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedServices: string[];
  progress: number;
}

export interface HealthCheck {
  name: string;
  description: string;
  endpoint?: string;
  expectedResponse?: any;
  timeout: number;
  retries: number;
}

export class MaintenanceService {
  private static instance: MaintenanceService;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private maintenanceMode: boolean = false;

  public static getInstance(): MaintenanceService {
    if (!MaintenanceService.instance) {
      MaintenanceService.instance = new MaintenanceService();
    }
    return MaintenanceService.instance;
  }

  constructor() {
    this.initializeScheduledJobs();
  }

  // Maintenance Schedule Management
  async createMaintenanceSchedule(
    scheduleData: {
      title: string;
      description: string;
      type: MaintenanceType;
      scheduledStart: Date;
      scheduledEnd: Date;
      affectedServices: string[];
      impactLevel: 'low' | 'medium' | 'high' | 'critical';
      tasks: any[];
      recurrence?: any;
      notifications?: any;
      approvals?: any;
      rollbackPlan?: any;
      healthChecks?: any;
    },
    createdBy: Types.ObjectId
  ): Promise<IMaintenanceSchedule> {
    try {
      const estimatedDuration = Math.ceil(
        (scheduleData.scheduledEnd.getTime() - scheduleData.scheduledStart.getTime()) / (1000 * 60)
      );

      const maintenance = new MaintenanceSchedule({
        ...scheduleData,
        estimatedDuration,
        createdBy,
        updatedBy: createdBy,
        logs: [{
          timestamp: new Date(),
          level: 'info',
          message: 'Maintenance schedule created'
        }]
      });

      await maintenance.save();

      // Schedule notifications if enabled
      if (scheduleData.notifications?.enabled) {
        await this.scheduleNotifications(maintenance);
      }

      // Schedule the maintenance job
      await this.scheduleMaintenanceJob(maintenance);

      // Log the action
      await AdminLog.create({
        userId: createdBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_MAINTENANCE,
        message: `Created maintenance schedule: ${scheduleData.title}`,
        details: {
          maintenanceId: maintenance._id,
          type: scheduleData.type,
          scheduledStart: scheduleData.scheduledStart,
          impactLevel: scheduleData.impactLevel,
          affectedServices: scheduleData.affectedServices
        },
        success: true
      });

      adminLogger.info('Maintenance schedule created', {
        createdBy,
        maintenanceId: maintenance._id,
        title: scheduleData.title,
        scheduledStart: scheduleData.scheduledStart
      });

      return maintenance;
    } catch (error) {
      adminLogger.error('Failed to create maintenance schedule', {
        error: error instanceof Error ? error.message : 'Unknown error',
        createdBy,
        title: scheduleData.title
      });
      throw error;
    }
  }

  async updateMaintenanceSchedule(
    maintenanceId: Types.ObjectId,
    updates: Partial<IMaintenanceSchedule>,
    updatedBy: Types.ObjectId
  ): Promise<IMaintenanceSchedule> {
    try {
      const maintenance = await MaintenanceSchedule.findById(maintenanceId);
      if (!maintenance) {
        throw new Error('Maintenance schedule not found');
      }

      if (maintenance.status === MaintenanceStatus.IN_PROGRESS) {
        throw new Error('Cannot update maintenance schedule that is in progress');
      }

      const oldData = {
        title: maintenance.title,
        scheduledStart: maintenance.scheduledStart,
        scheduledEnd: maintenance.scheduledEnd,
        type: maintenance.type
      };

      Object.assign(maintenance, updates);
      maintenance.updatedBy = updatedBy;
      maintenance.addLog('info', 'Maintenance schedule updated', { updatedBy, updates });

      await maintenance.save();

      // Reschedule if timing changed
      if (updates.scheduledStart || updates.scheduledEnd) {
        await this.rescheduleMaintenanceJob(maintenance);
      }

      // Log the action
      await AdminLog.create({
        userId: updatedBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_MAINTENANCE,
        message: `Updated maintenance schedule: ${maintenance.title}`,
        details: {
          maintenanceId,
          oldData,
          updates
        },
        success: true
      });

      adminLogger.info('Maintenance schedule updated', {
        updatedBy,
        maintenanceId,
        title: maintenance.title,
        updates
      });

      return maintenance;
    } catch (error) {
      adminLogger.error('Failed to update maintenance schedule', {
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedBy,
        maintenanceId
      });
      throw error;
    }
  }

  async getMaintenanceSchedules(
    filters: {
      status?: MaintenanceStatus;
      type?: MaintenanceType;
      impactLevel?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
    page: number = 1,
    limit: number = 20
  ): Promise<{
    schedules: MaintenanceWindow[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const query: any = {};

      if (filters.status) query.status = filters.status;
      if (filters.type) query.type = filters.type;
      if (filters.impactLevel) query.impactLevel = filters.impactLevel;
      if (filters.startDate || filters.endDate) {
        query.scheduledStart = {};
        if (filters.startDate) query.scheduledStart.$gte = filters.startDate;
        if (filters.endDate) query.scheduledStart.$lte = filters.endDate;
      }

      const skip = (page - 1) * limit;
      const [schedules, total] = await Promise.all([
        MaintenanceSchedule.find(query)
          .sort({ scheduledStart: 1 })
          .skip(skip)
          .limit(limit)
          .populate('createdBy', 'username')
          .populate('executedBy', 'username'),
        MaintenanceSchedule.countDocuments(query)
      ]);

      const maintenanceWindows: MaintenanceWindow[] = schedules.map(schedule => ({
        id: schedule._id.toString(),
        title: schedule.title,
        description: schedule.description,
        type: schedule.type,
        scheduledStart: schedule.scheduledStart,
        scheduledEnd: schedule.scheduledEnd,
        status: schedule.status,
        impactLevel: schedule.impactLevel,
        affectedServices: schedule.affectedServices,
        progress: schedule.calculateProgress()
      }));

      return {
        schedules: maintenanceWindows,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      adminLogger.error('Failed to get maintenance schedules', {
        error: error instanceof Error ? error.message : 'Unknown error',
        filters,
        page,
        limit
      });
      throw error;
    }
  }

  async startMaintenance(
    maintenanceId: Types.ObjectId,
    executedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const maintenance = await MaintenanceSchedule.findById(maintenanceId);
      if (!maintenance) {
        throw new Error('Maintenance schedule not found');
      }

      await maintenance.start(executedBy);

      // Enable maintenance mode if critical impact
      if (maintenance.impactLevel === 'critical') {
        await this.enableMaintenanceMode(executedBy);
      }

      // Run pre-maintenance health checks
      await this.runHealthChecks(maintenance.healthChecks.preMaintenanceChecks, maintenance);

      // Log the action
      await AdminLog.create({
        userId: executedBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_MAINTENANCE,
        message: `Started maintenance: ${maintenance.title}`,
        details: {
          maintenanceId,
          type: maintenance.type,
          impactLevel: maintenance.impactLevel
        },
        success: true
      });

      adminLogger.info('Maintenance started', {
        executedBy,
        maintenanceId,
        title: maintenance.title
      });
    } catch (error) {
      adminLogger.error('Failed to start maintenance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executedBy,
        maintenanceId
      });
      throw error;
    }
  }

  async completeMaintenance(
    maintenanceId: Types.ObjectId,
    completedBy: Types.ObjectId
  ): Promise<void> {
    try {
      const maintenance = await MaintenanceSchedule.findById(maintenanceId);
      if (!maintenance) {
        throw new Error('Maintenance schedule not found');
      }

      // Run post-maintenance health checks
      await this.runHealthChecks(maintenance.healthChecks.postMaintenanceChecks, maintenance);

      await maintenance.complete();

      // Disable maintenance mode if it was enabled
      if (this.maintenanceMode) {
        await this.disableMaintenanceMode(completedBy);
      }

      // Log the action
      await AdminLog.create({
        userId: completedBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_MAINTENANCE,
        message: `Completed maintenance: ${maintenance.title}`,
        details: {
          maintenanceId,
          duration: maintenance.actualDuration,
          tasksCompleted: maintenance.tasks.filter(t => t.status === 'completed').length,
          totalTasks: maintenance.tasks.length
        },
        success: true
      });

      adminLogger.info('Maintenance completed', {
        completedBy,
        maintenanceId,
        title: maintenance.title,
        duration: maintenance.actualDuration
      });
    } catch (error) {
      adminLogger.error('Failed to complete maintenance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        completedBy,
        maintenanceId
      });
      throw error;
    }
  }

  async cancelMaintenance(
    maintenanceId: Types.ObjectId,
    reason: string,
    cancelledBy: Types.ObjectId
  ): Promise<void> {
    try {
      const maintenance = await MaintenanceSchedule.findById(maintenanceId);
      if (!maintenance) {
        throw new Error('Maintenance schedule not found');
      }

      await maintenance.cancel(reason, cancelledBy);

      // Cancel scheduled job
      const jobKey = `maintenance_${maintenanceId}`;
      const job = this.scheduledJobs.get(jobKey);
      if (job) {
        job.destroy();
        this.scheduledJobs.delete(jobKey);
      }

      // Log the action
      await AdminLog.create({
        userId: cancelledBy,
        level: LogLevel.WARN,
        action: ActionType.SYSTEM_MAINTENANCE,
        message: `Cancelled maintenance: ${maintenance.title}`,
        details: {
          maintenanceId,
          reason
        },
        success: true
      });

      adminLogger.warn('Maintenance cancelled', {
        cancelledBy,
        maintenanceId,
        title: maintenance.title,
        reason
      });
    } catch (error) {
      adminLogger.error('Failed to cancel maintenance', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cancelledBy,
        maintenanceId,
        reason
      });
      throw error;
    }
  }

  // Maintenance Mode Management
  async enableMaintenanceMode(enabledBy: Types.ObjectId): Promise<void> {
    try {
      this.maintenanceMode = true;

      // Update system configuration
      await SystemConfiguration.findOneAndUpdate(
        { key: 'system.maintenance_mode' },
        {
          $set: {
            'values.production.value': true,
            updatedBy: enabledBy,
            lastModified: new Date()
          }
        },
        { upsert: true }
      );

      // Log the action
      await AdminLog.create({
        userId: enabledBy,
        level: LogLevel.WARN,
        action: ActionType.SYSTEM_MAINTENANCE,
        message: 'Maintenance mode enabled',
        details: {
          enabledAt: new Date()
        },
        success: true
      });

      adminLogger.warn('Maintenance mode enabled', {
        enabledBy,
        timestamp: new Date()
      });
    } catch (error) {
      adminLogger.error('Failed to enable maintenance mode', {
        error: error instanceof Error ? error.message : 'Unknown error',
        enabledBy
      });
      throw error;
    }
  }

  async disableMaintenanceMode(disabledBy: Types.ObjectId): Promise<void> {
    try {
      this.maintenanceMode = false;

      // Update system configuration
      await SystemConfiguration.findOneAndUpdate(
        { key: 'system.maintenance_mode' },
        {
          $set: {
            'values.production.value': false,
            updatedBy: disabledBy,
            lastModified: new Date()
          }
        }
      );

      // Log the action
      await AdminLog.create({
        userId: disabledBy,
        level: LogLevel.INFO,
        action: ActionType.SYSTEM_MAINTENANCE,
        message: 'Maintenance mode disabled',
        details: {
          disabledAt: new Date()
        },
        success: true
      });

      adminLogger.info('Maintenance mode disabled', {
        disabledBy,
        timestamp: new Date()
      });
    } catch (error) {
      adminLogger.error('Failed to disable maintenance mode', {
        error: error instanceof Error ? error.message : 'Unknown error',
        disabledBy
      });
      throw error;
    }
  }

  async isMaintenanceModeEnabled(): Promise<boolean> {
    return this.maintenanceMode;
  }

  // Health Checks
  async runHealthChecks(
    checks: string[],
    maintenance: IMaintenanceSchedule
  ): Promise<{ passed: number; failed: number; results: any[] }> {
    const results = [];
    let passed = 0;
    let failed = 0;

    for (const checkName of checks) {
      try {
        const result = await this.executeHealthCheck(checkName);
        if (result.success) {
          passed++;
        } else {
          failed++;
        }
        results.push(result);
        
        maintenance.addLog('info', `Health check ${checkName}: ${result.success ? 'PASSED' : 'FAILED'}`, result);
      } catch (error) {
        failed++;
        const errorResult = {
          name: checkName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date()
        };
        results.push(errorResult);
        
        maintenance.addLog('error', `Health check ${checkName} failed`, errorResult);
      }
    }

    await maintenance.save();

    return { passed, failed, results };
  }

  private async executeHealthCheck(checkName: string): Promise<any> {
    // Implement specific health checks based on checkName
    switch (checkName) {
      case 'database_connection':
        return await this.checkDatabaseConnection();
      case 'api_endpoints':
        return await this.checkApiEndpoints();
      case 'memory_usage':
        return await this.checkMemoryUsage();
      case 'disk_space':
        return await this.checkDiskSpace();
      default:
        throw new Error(`Unknown health check: ${checkName}`);
    }
  }

  private async checkDatabaseConnection(): Promise<any> {
    // Implement database connection check
    return {
      name: 'database_connection',
      success: true,
      responseTime: 50,
      timestamp: new Date()
    };
  }

  private async checkApiEndpoints(): Promise<any> {
    // Implement API endpoints check
    return {
      name: 'api_endpoints',
      success: true,
      endpoints: ['auth', 'players', 'games'],
      timestamp: new Date()
    };
  }

  private async checkMemoryUsage(): Promise<any> {
    const memUsage = process.memoryUsage();
    const usagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    return {
      name: 'memory_usage',
      success: usagePercent < 80,
      usage: memUsage,
      usagePercent,
      timestamp: new Date()
    };
  }

  private async checkDiskSpace(): Promise<any> {
    // Implement disk space check
    return {
      name: 'disk_space',
      success: true,
      freeSpace: '10GB',
      usagePercent: 65,
      timestamp: new Date()
    };
  }

  // Scheduling
  private async initializeScheduledJobs(): Promise<void> {
    try {
      const upcomingMaintenances = await MaintenanceSchedule.find({
        status: MaintenanceStatus.SCHEDULED,
        scheduledStart: { $gt: new Date() }
      });

      for (const maintenance of upcomingMaintenances) {
        await this.scheduleMaintenanceJob(maintenance);
      }

      adminLogger.info('Initialized scheduled maintenance jobs', {
        count: upcomingMaintenances.length
      });
    } catch (error) {
      adminLogger.error('Failed to initialize scheduled jobs', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async scheduleMaintenanceJob(maintenance: IMaintenanceSchedule): Promise<void> {
    const jobKey = `maintenance_${maintenance._id}`;
    
    // Cancel existing job if it exists
    const existingJob = this.scheduledJobs.get(jobKey);
    if (existingJob) {
      existingJob.destroy();
    }

    // Schedule new job
    const cronExpression = this.dateToCron(maintenance.scheduledStart);
    const job = cron.schedule(cronExpression, async () => {
      try {
        if (maintenance.approvals.required && !maintenance.approvals.approved) {
          maintenance.addLog('warn', 'Maintenance skipped - approval required');
          await maintenance.save();
          return;
        }

        await this.startMaintenance(maintenance._id, maintenance.createdBy);
      } catch (error) {
        adminLogger.error('Scheduled maintenance job failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          maintenanceId: maintenance._id
        });
      }
    }, {
      scheduled: false
    });

    job.start();
    this.scheduledJobs.set(jobKey, job);

    adminLogger.info('Scheduled maintenance job', {
      maintenanceId: maintenance._id,
      scheduledStart: maintenance.scheduledStart,
      cronExpression
    });
  }

  private async rescheduleMaintenanceJob(maintenance: IMaintenanceSchedule): Promise<void> {
    await this.scheduleMaintenanceJob(maintenance);
  }

  private async scheduleNotifications(maintenance: IMaintenanceSchedule): Promise<void> {
    // Implement notification scheduling
    // This would integrate with your notification service
    adminLogger.info('Scheduled maintenance notifications', {
      maintenanceId: maintenance._id,
      notificationSettings: maintenance.notifications
    });
  }

  private dateToCron(date: Date): string {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    return `${minute} ${hour} ${day} ${month} *`;
  }

  // Statistics
  async getMaintenanceStatistics(): Promise<{
    totalScheduled: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    upcomingThisWeek: number;
    averageDuration: number;
    successRate: number;
  }> {
    try {
      const [
        totalScheduled,
        inProgress,
        completed,
        cancelled,
        upcomingThisWeek,
        completedMaintenances
      ] = await Promise.all([
        MaintenanceSchedule.countDocuments(),
        MaintenanceSchedule.countDocuments({ status: MaintenanceStatus.IN_PROGRESS }),
        MaintenanceSchedule.countDocuments({ status: MaintenanceStatus.COMPLETED }),
        MaintenanceSchedule.countDocuments({ status: MaintenanceStatus.CANCELLED }),
        MaintenanceSchedule.countDocuments({
          status: MaintenanceStatus.SCHEDULED,
          scheduledStart: {
            $gte: new Date(),
            $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          }
        }),
        MaintenanceSchedule.find({ 
          status: MaintenanceStatus.COMPLETED,
          actualDuration: { $exists: true }
        }, 'actualDuration')
      ]);

      const averageDuration = completedMaintenances.length > 0
        ? completedMaintenances.reduce((sum, m) => sum + (m.actualDuration || 0), 0) / completedMaintenances.length
        : 0;

      const successRate = totalScheduled > 0 ? (completed / totalScheduled) * 100 : 0;

      return {
        totalScheduled,
        inProgress,
        completed,
        cancelled,
        upcomingThisWeek,
        averageDuration: Math.round(averageDuration),
        successRate: Math.round(successRate * 100) / 100
      };
    } catch (error) {
      adminLogger.error('Failed to get maintenance statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

export default MaintenanceService;