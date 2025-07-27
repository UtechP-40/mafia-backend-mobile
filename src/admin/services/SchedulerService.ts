import { AdminEmailService } from './AdminEmailService';
import { EmailApproval } from '../models/EmailApproval';
import { adminLogger } from '../config/logger';

export class SchedulerService {
  private static reminderInterval: NodeJS.Timeout | null = null;
  private static cleanupInterval: NodeJS.Timeout | null = null;
  private static expirationInterval: NodeJS.Timeout | null = null;

  // Initialize all scheduled tasks
  public static initialize() {
    this.startReminderScheduler();
    this.startCleanupScheduler();
    this.startExpirationScheduler();
    adminLogger.info('SchedulerService initialized');
  }

  // Start reminder email scheduler (runs every hour)
  private static startReminderScheduler() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
    }

    this.reminderInterval = setInterval(async () => {
      try {
        // Send reminders for approvals expiring in 24 hours
        const remindersSent = await AdminEmailService.sendReminderEmails(24);
        
        if (remindersSent > 0) {
          adminLogger.info(`Sent ${remindersSent} approval reminder emails`);
        }
      } catch (error) {
        adminLogger.error('Error sending reminder emails', { error });
      }
    }, 60 * 60 * 1000); // Every hour
  }

  // Start cleanup scheduler (runs daily)
  private static startCleanupScheduler() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        // Clean up old email delivery statuses
        AdminEmailService.cleanupOldStatuses();
        
        adminLogger.info('Cleaned up old email delivery statuses');
      } catch (error) {
        adminLogger.error('Error during cleanup', { error });
      }
    }, 24 * 60 * 60 * 1000); // Every 24 hours
  }

  // Start expiration scheduler (runs every 30 minutes)
  private static startExpirationScheduler() {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
    }

    this.expirationInterval = setInterval(async () => {
      try {
        // Expire old pending approvals
        const result = await EmailApproval.expireOldApprovals();
        
        if (result.modifiedCount > 0) {
          adminLogger.info(`Expired ${result.modifiedCount} old approval requests`);
        }
      } catch (error) {
        adminLogger.error('Error expiring old approvals', { error });
      }
    }, 30 * 60 * 1000); // Every 30 minutes
  }

  // Shutdown all schedulers
  public static shutdown() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
      this.expirationInterval = null;
    }

    adminLogger.info('SchedulerService shutdown complete');
  }

  // Manual trigger for reminder emails (for testing or manual execution)
  public static async sendRemindersNow(hoursBeforeExpiry: number = 24): Promise<number> {
    try {
      const remindersSent = await AdminEmailService.sendReminderEmails(hoursBeforeExpiry);
      adminLogger.info(`Manually sent ${remindersSent} approval reminder emails`);
      return remindersSent;
    } catch (error) {
      adminLogger.error('Error manually sending reminder emails', { error });
      throw error;
    }
  }

  // Manual trigger for expiring old approvals
  public static async expireApprovalsNow(): Promise<number> {
    try {
      const result = await EmailApproval.expireOldApprovals();
      adminLogger.info(`Manually expired ${result.modifiedCount} old approval requests`);
      return result.modifiedCount;
    } catch (error) {
      adminLogger.error('Error manually expiring approvals', { error });
      throw error;
    }
  }

  // Manual trigger for cleanup
  public static cleanupNow(): void {
    try {
      AdminEmailService.cleanupOldStatuses();
      adminLogger.info('Manual cleanup completed');
    } catch (error) {
      adminLogger.error('Error during manual cleanup', { error });
      throw error;
    }
  }
}