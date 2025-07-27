import cron from 'node-cron';
import { adminLogger } from '../config/logger';
import { adminAnalyticsService } from './AnalyticsService';
import { AdminEmailService } from './AdminEmailService';
import { SuperUser } from '../models/SuperUser';
import fs from 'fs/promises';
import path from 'path';

export interface ReportSchedule {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  reportType: 'dashboard' | 'custom' | 'logs' | 'performance';
  recipients: string[];
  format: 'json' | 'csv' | 'xlsx' | 'pdf';
  parameters: Record<string, any>;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
}

export interface ReportExecution {
  scheduleId: string;
  executionId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed';
  filePath?: string;
  error?: string;
  recipients: string[];
}

export class ScheduledReportsService {
  private schedules = new Map<string, ReportSchedule>();
  private cronJobs = new Map<string, cron.ScheduledTask>();
  private executions = new Map<string, ReportExecution>();
  private readonly MAX_EXECUTIONS = 1000; // Keep last 1000 executions

  constructor() {
    this.loadSchedulesFromStorage();
    this.setupCleanupInterval();
  }

  /**
   * Create a new scheduled report
   */
  async createSchedule(schedule: Omit<ReportSchedule, 'id' | 'createdAt' | 'nextRun'>): Promise<ReportSchedule> {
    try {
      // Validate cron expression
      if (!cron.validate(schedule.cronExpression)) {
        throw new Error('Invalid cron expression');
      }

      // Validate recipients
      if (schedule.recipients.length === 0) {
        throw new Error('At least one recipient is required');
      }

      const newSchedule: ReportSchedule = {
        ...schedule,
        id: this.generateScheduleId(),
        createdAt: new Date(),
        nextRun: this.getNextRunTime(schedule.cronExpression)
      };

      this.schedules.set(newSchedule.id, newSchedule);

      // Create cron job if active
      if (newSchedule.isActive) {
        await this.createCronJob(newSchedule);
      }

      // Save to storage
      await this.saveSchedulesToStorage();

      adminLogger.info('Scheduled report created', {
        scheduleId: newSchedule.id,
        name: newSchedule.name,
        cronExpression: newSchedule.cronExpression,
        createdBy: newSchedule.createdBy
      });

      return newSchedule;
    } catch (error) {
      adminLogger.error('Failed to create scheduled report', {
        error: error instanceof Error ? error.message : 'Unknown error',
        schedule: schedule.name
      });
      throw error;
    }
  }

  /**
   * Update an existing scheduled report
   */
  async updateSchedule(scheduleId: string, updates: Partial<ReportSchedule>): Promise<ReportSchedule> {
    try {
      const existingSchedule = this.schedules.get(scheduleId);
      if (!existingSchedule) {
        throw new Error('Schedule not found');
      }

      // Validate cron expression if being updated
      if (updates.cronExpression && !cron.validate(updates.cronExpression)) {
        throw new Error('Invalid cron expression');
      }

      const updatedSchedule: ReportSchedule = {
        ...existingSchedule,
        ...updates,
        nextRun: updates.cronExpression ? 
          this.getNextRunTime(updates.cronExpression) : 
          existingSchedule.nextRun
      };

      this.schedules.set(scheduleId, updatedSchedule);

      // Update cron job
      await this.destroyCronJob(scheduleId);
      if (updatedSchedule.isActive) {
        await this.createCronJob(updatedSchedule);
      }

      // Save to storage
      await this.saveSchedulesToStorage();

      adminLogger.info('Scheduled report updated', {
        scheduleId,
        name: updatedSchedule.name,
        isActive: updatedSchedule.isActive
      });

      return updatedSchedule;
    } catch (error) {
      adminLogger.error('Failed to update scheduled report', {
        error: error instanceof Error ? error.message : 'Unknown error',
        scheduleId
      });
      throw error;
    }
  }

  /**
   * Delete a scheduled report
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    try {
      const schedule = this.schedules.get(scheduleId);
      if (!schedule) {
        throw new Error('Schedule not found');
      }

      // Destroy cron job
      await this.destroyCronJob(scheduleId);

      // Remove from schedules
      this.schedules.delete(scheduleId);

      // Clean up executions
      for (const [executionId, execution] of this.executions.entries()) {
        if (execution.scheduleId === scheduleId) {
          this.executions.delete(executionId);
        }
      }

      // Save to storage
      await this.saveSchedulesToStorage();

      adminLogger.info('Scheduled report deleted', {
        scheduleId,
        name: schedule.name
      });
    } catch (error) {
      adminLogger.error('Failed to delete scheduled report', {
        error: error instanceof Error ? error.message : 'Unknown error',
        scheduleId
      });
      throw error;
    }
  }

  /**
   * Get all scheduled reports
   */
  getSchedules(): ReportSchedule[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Get a specific scheduled report
   */
  getSchedule(scheduleId: string): ReportSchedule | null {
    return this.schedules.get(scheduleId) || null;
  }

  /**
   * Get execution history for a schedule
   */
  getExecutionHistory(scheduleId: string, limit: number = 50): ReportExecution[] {
    const executions = Array.from(this.executions.values())
      .filter(execution => execution.scheduleId === scheduleId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit);

    return executions;
  }

  /**
   * Execute a report manually
   */
  async executeReportManually(scheduleId: string, userId: string): Promise<string> {
    try {
      const schedule = this.schedules.get(scheduleId);
      if (!schedule) {
        throw new Error('Schedule not found');
      }

      const executionId = await this.executeReport(schedule, true);

      adminLogger.info('Report executed manually', {
        scheduleId,
        executionId,
        userId,
        reportName: schedule.name
      });

      return executionId;
    } catch (error) {
      adminLogger.error('Failed to execute report manually', {
        error: error instanceof Error ? error.message : 'Unknown error',
        scheduleId,
        userId
      });
      throw error;
    }
  }

  /**
   * Private methods
   */
  private async createCronJob(schedule: ReportSchedule): Promise<void> {
    const task = cron.schedule(schedule.cronExpression, async () => {
      await this.executeReport(schedule);
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.cronJobs.set(schedule.id, task);
    task.start();

    adminLogger.info('Cron job created for scheduled report', {
      scheduleId: schedule.id,
      cronExpression: schedule.cronExpression
    });
  }

  private async destroyCronJob(scheduleId: string): Promise<void> {
    const task = this.cronJobs.get(scheduleId);
    if (task) {
      task.stop();
      task.destroy();
      this.cronJobs.delete(scheduleId);

      adminLogger.info('Cron job destroyed for scheduled report', {
        scheduleId
      });
    }
  }

  private async executeReport(schedule: ReportSchedule, isManual: boolean = false): Promise<string> {
    const executionId = this.generateExecutionId();
    const execution: ReportExecution = {
      scheduleId: schedule.id,
      executionId,
      startTime: new Date(),
      status: 'running',
      recipients: schedule.recipients
    };

    this.executions.set(executionId, execution);

    try {
      adminLogger.info('Starting report execution', {
        scheduleId: schedule.id,
        executionId,
        reportType: schedule.reportType,
        isManual
      });

      let filePath: string;

      switch (schedule.reportType) {
        case 'dashboard':
          filePath = await this.generateDashboardReport(schedule);
          break;
        case 'custom':
          filePath = await this.generateCustomReport(schedule);
          break;
        case 'logs':
          filePath = await this.generateLogsReport(schedule);
          break;
        case 'performance':
          filePath = await this.generatePerformanceReport(schedule);
          break;
        default:
          throw new Error(`Unsupported report type: ${schedule.reportType}`);
      }

      // Update execution status
      execution.status = 'completed';
      execution.endTime = new Date();
      execution.filePath = filePath;

      // Send email with report
      await this.sendReportEmail(schedule, execution, filePath);

      // Update schedule's last run time
      schedule.lastRun = new Date();
      schedule.nextRun = this.getNextRunTime(schedule.cronExpression);
      await this.saveSchedulesToStorage();

      adminLogger.info('Report execution completed', {
        scheduleId: schedule.id,
        executionId,
        duration: execution.endTime.getTime() - execution.startTime.getTime(),
        filePath
      });

      return executionId;

    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.error = error instanceof Error ? error.message : 'Unknown error';

      adminLogger.error('Report execution failed', {
        scheduleId: schedule.id,
        executionId,
        error: execution.error,
        duration: execution.endTime.getTime() - execution.startTime.getTime()
      });

      // Send error notification email
      await this.sendErrorNotificationEmail(schedule, execution);

      throw error;
    }
  }

  private async generateDashboardReport(schedule: ReportSchedule): Promise<string> {
    const { startDate, endDate, granularity } = this.getDateRange(schedule.parameters);

    const metrics = await adminAnalyticsService.getDashboardMetrics({
      startDate,
      endDate,
      granularity: granularity || 'day'
    });

    return await this.saveReportData(schedule, metrics);
  }

  private async generateCustomReport(schedule: ReportSchedule): Promise<string> {
    const { collection, filters, aggregation } = schedule.parameters;

    const data = await adminAnalyticsService.executeCustomQuery({
      collection,
      filters,
      aggregation,
      limit: 10000 // Limit for scheduled reports
    });

    return await this.saveReportData(schedule, data);
  }

  private async generateLogsReport(schedule: ReportSchedule): Promise<string> {
    const { level, category, startTime, endTime, maxLines } = schedule.parameters;

    const loggingService = require('./LoggingService').loggingService;
    const logs = await loggingService.getLogs({
      level,
      category,
      startTime: startTime ? new Date(startTime) : new Date(Date.now() - 24 * 60 * 60 * 1000),
      endTime: endTime ? new Date(endTime) : new Date(),
      maxLines: maxLines || 10000
    });

    return await this.saveReportData(schedule, logs);
  }

  private async generatePerformanceReport(schedule: ReportSchedule): Promise<string> {
    const { startDate, endDate, metrics } = this.getDateRange(schedule.parameters);

    const performanceData = await adminAnalyticsService.executeCustomQuery({
      collection: 'performance_metrics',
      filters: {
        timestamp: { $gte: startDate, $lte: endDate },
        ...(metrics && { metricName: { $in: metrics } })
      },
      aggregation: [
        {
          $group: {
            _id: '$metricName',
            avg: { $avg: '$value' },
            min: { $min: '$value' },
            max: { $max: '$value' },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]
    });

    return await this.saveReportData(schedule, performanceData);
  }

  private async saveReportData(schedule: ReportSchedule, data: any): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'reports');
    await fs.mkdir(reportsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${schedule.name.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.${schedule.format}`;
    const filePath = path.join(reportsDir, filename);

    switch (schedule.format) {
      case 'json':
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        break;

      case 'csv':
        const { Parser } = require('json2csv');
        const parser = new Parser();
        const csv = parser.parse(Array.isArray(data) ? data : [data]);
        await fs.writeFile(filePath, csv);
        break;

      case 'xlsx':
        const XLSX = require('xlsx');
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(Array.isArray(data) ? data : [data]);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
        XLSX.writeFile(workbook, filePath);
        break;

      default:
        throw new Error(`Unsupported format: ${schedule.format}`);
    }

    return filePath;
  }

  private async sendReportEmail(
    schedule: ReportSchedule, 
    execution: ReportExecution, 
    filePath: string
  ): Promise<void> {
    try {
      const subject = `Scheduled Report: ${schedule.name}`;
      const duration = execution.endTime!.getTime() - execution.startTime.getTime();
      
      const htmlContent = `
        <h2>Scheduled Report Completed</h2>
        <p><strong>Report Name:</strong> ${schedule.name}</p>
        <p><strong>Description:</strong> ${schedule.description}</p>
        <p><strong>Execution Time:</strong> ${execution.startTime.toISOString()}</p>
        <p><strong>Duration:</strong> ${duration}ms</p>
        <p><strong>Status:</strong> ${execution.status}</p>
        <p>Please find the report attached to this email.</p>
      `;

      for (const recipient of schedule.recipients) {
        await AdminEmailService.sendEmail({
          to: recipient,
          subject,
          html: htmlContent,
          attachments: [{
            filename: path.basename(filePath),
            path: filePath
          }]
        });
      }

      adminLogger.info('Report email sent', {
        scheduleId: schedule.id,
        executionId: execution.executionId,
        recipients: schedule.recipients.length
      });

    } catch (error) {
      adminLogger.error('Failed to send report email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        scheduleId: schedule.id,
        executionId: execution.executionId
      });
    }
  }

  private async sendErrorNotificationEmail(
    schedule: ReportSchedule, 
    execution: ReportExecution
  ): Promise<void> {
    try {
      const subject = `Report Execution Failed: ${schedule.name}`;
      const duration = execution.endTime!.getTime() - execution.startTime.getTime();
      
      const htmlContent = `
        <h2>Scheduled Report Failed</h2>
        <p><strong>Report Name:</strong> ${schedule.name}</p>
        <p><strong>Execution Time:</strong> ${execution.startTime.toISOString()}</p>
        <p><strong>Duration:</strong> ${duration}ms</p>
        <p><strong>Error:</strong> ${execution.error}</p>
        <p>Please check the system logs for more details.</p>
      `;

      for (const recipient of schedule.recipients) {
        await AdminEmailService.sendEmail({
          to: recipient,
          subject,
          html: htmlContent
        });
      }

    } catch (error) {
      adminLogger.error('Failed to send error notification email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        scheduleId: schedule.id,
        executionId: execution.executionId
      });
    }
  }

  private getDateRange(parameters: Record<string, any>): {
    startDate: Date;
    endDate: Date;
    granularity?: string;
  } {
    const endDate = parameters.endDate ? new Date(parameters.endDate) : new Date();
    const startDate = parameters.startDate ? 
      new Date(parameters.startDate) : 
      new Date(endDate.getTime() - (parameters.days || 7) * 24 * 60 * 60 * 1000);

    return {
      startDate,
      endDate,
      granularity: parameters.granularity
    };
  }

  private getNextRunTime(cronExpression: string): Date {
    const task = cron.schedule(cronExpression, () => {}, { scheduled: false });
    const nextRun = task.nextDates(1)[0];
    task.destroy();
    return nextRun.toDate();
  }

  private generateScheduleId(): string {
    return `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async loadSchedulesFromStorage(): Promise<void> {
    try {
      const storageFile = path.join(process.cwd(), 'data', 'scheduled_reports.json');
      
      try {
        const data = await fs.readFile(storageFile, 'utf-8');
        const schedules = JSON.parse(data);
        
        for (const schedule of schedules) {
          // Convert date strings back to Date objects
          schedule.createdAt = new Date(schedule.createdAt);
          if (schedule.lastRun) schedule.lastRun = new Date(schedule.lastRun);
          if (schedule.nextRun) schedule.nextRun = new Date(schedule.nextRun);
          
          this.schedules.set(schedule.id, schedule);
          
          // Recreate cron jobs for active schedules
          if (schedule.isActive) {
            await this.createCronJob(schedule);
          }
        }

        adminLogger.info('Scheduled reports loaded from storage', {
          count: schedules.length
        });

      } catch (fileError) {
        // File doesn't exist or is invalid, start with empty schedules
        adminLogger.info('No existing scheduled reports found, starting fresh');
      }

    } catch (error) {
      adminLogger.error('Failed to load scheduled reports from storage', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async saveSchedulesToStorage(): Promise<void> {
    try {
      const dataDir = path.join(process.cwd(), 'data');
      await fs.mkdir(dataDir, { recursive: true });
      
      const storageFile = path.join(dataDir, 'scheduled_reports.json');
      const schedules = Array.from(this.schedules.values());
      
      await fs.writeFile(storageFile, JSON.stringify(schedules, null, 2));

    } catch (error) {
      adminLogger.error('Failed to save scheduled reports to storage', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private setupCleanupInterval(): void {
    // Clean up old executions every hour
    setInterval(() => {
      if (this.executions.size > this.MAX_EXECUTIONS) {
        const executions = Array.from(this.executions.entries())
          .sort(([, a], [, b]) => b.startTime.getTime() - a.startTime.getTime());

        // Keep only the most recent executions
        const toKeep = executions.slice(0, this.MAX_EXECUTIONS);
        const toDelete = executions.slice(this.MAX_EXECUTIONS);

        this.executions.clear();
        for (const [id, execution] of toKeep) {
          this.executions.set(id, execution);
        }

        if (toDelete.length > 0) {
          adminLogger.info('Cleaned up old report executions', {
            deleted: toDelete.length,
            remaining: this.executions.size
          });
        }
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Initialize the service
   */
  public static initialize(): ScheduledReportsService {
    const service = new ScheduledReportsService();
    adminLogger.info('Scheduled Reports Service initialized');
    return service;
  }

  /**
   * Shutdown the service
   */
  public async shutdown(): Promise<void> {
    // Stop all cron jobs
    for (const [scheduleId, task] of this.cronJobs.entries()) {
      task.stop();
      task.destroy();
    }
    this.cronJobs.clear();

    // Save current state
    await this.saveSchedulesToStorage();

    adminLogger.info('Scheduled Reports Service shut down');
  }
}

export const scheduledReportsService = ScheduledReportsService.initialize();