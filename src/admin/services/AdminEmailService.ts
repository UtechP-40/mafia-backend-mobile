import * as nodemailer from 'nodemailer';
import { config } from 'dotenv';
import { EmailApproval, IEmailApproval, ApprovalStatus, Priority } from '../models/EmailApproval';
import { AdminLog, ActionType, LogLevel } from '../models/AdminLog';
import { adminLogger } from '../config/logger';
import { Types } from 'mongoose';

config();

export interface EmailQueueItem {
  id: string;
  to: string;
  subject: string;
  html: string;
  priority: 'high' | 'medium' | 'low';
  retryCount: number;
  maxRetries: number;
  scheduledAt: Date;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface EmailDeliveryStatus {
  messageId: string;
  status: 'sent' | 'failed' | 'pending' | 'retry';
  timestamp: Date;
  error?: string;
  retryCount: number;
}

export class AdminEmailService {
  private static _transporter: any = null;
  private static emailQueue: EmailQueueItem[] = [];
  private static deliveryStatuses: Map<string, EmailDeliveryStatus> = new Map();
  private static isProcessingQueue = false;
  private static queueProcessingInterval: NodeJS.Timeout | null = null;

  private static get transporter() {
    if (!this._transporter) {
      this._transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASS,
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateLimit: 14, // 14 emails per second max
      });
    }
    return this._transporter;
  }

  // Initialize the email service and start queue processing
  public static initialize() {
    this.startQueueProcessing();
    adminLogger.info('AdminEmailService initialized');
  }

  // Start processing the email queue
  private static startQueueProcessing() {
    if (this.queueProcessingInterval) {
      clearInterval(this.queueProcessingInterval);
    }

    this.queueProcessingInterval = setInterval(async () => {
      if (!this.isProcessingQueue && this.emailQueue.length > 0) {
        await this.processEmailQueue();
      }
    }, 5000); // Process queue every 5 seconds
  }

  // Process the email queue
  private static async processEmailQueue() {
    this.isProcessingQueue = true;

    try {
      // Sort by priority and scheduled time
      this.emailQueue.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.scheduledAt.getTime() - b.scheduledAt.getTime();
      });

      const now = new Date();
      const emailsToProcess = this.emailQueue.filter(email => email.scheduledAt <= now);

      for (const email of emailsToProcess.slice(0, 10)) { // Process max 10 emails at once
        try {
          await this.sendQueuedEmail(email);
          this.emailQueue = this.emailQueue.filter(e => e.id !== email.id);
        } catch (error) {
          await this.handleEmailFailure(email, error);
        }
      }
    } catch (error) {
      adminLogger.error('Error processing email queue', { error });
    } finally {
      this.isProcessingQueue = false;
    }
  }

  // Send a queued email
  private static async sendQueuedEmail(email: EmailQueueItem) {
    const mailOptions = {
      from: `"🔐 Admin Portal" <${process.env.GMAIL_USER}>`,
      to: email.to,
      subject: email.subject,
      html: email.html,
    };

    const result = await this.transporter.sendMail(mailOptions);
    
    this.deliveryStatuses.set(email.id, {
      messageId: result.messageId,
      status: 'sent',
      timestamp: new Date(),
      retryCount: email.retryCount
    });

    adminLogger.info('Email sent successfully', {
      emailId: email.id,
      to: email.to,
      subject: email.subject,
      messageId: result.messageId
    });
  }

  // Handle email sending failure
  private static async handleEmailFailure(email: EmailQueueItem, error: any) {
    email.retryCount++;

    this.deliveryStatuses.set(email.id, {
      messageId: '',
      status: email.retryCount >= email.maxRetries ? 'failed' : 'retry',
      timestamp: new Date(),
      error: error.message,
      retryCount: email.retryCount
    });

    if (email.retryCount >= email.maxRetries) {
      // Remove from queue after max retries
      this.emailQueue = this.emailQueue.filter(e => e.id !== email.id);
      adminLogger.error('Email failed after max retries', {
        emailId: email.id,
        to: email.to,
        subject: email.subject,
        error: error.message,
        retryCount: email.retryCount
      });
    } else {
      // Schedule retry with exponential backoff
      const retryDelay = Math.pow(2, email.retryCount) * 60000; // 2^n minutes
      email.scheduledAt = new Date(Date.now() + retryDelay);
      
      adminLogger.warn('Email failed, scheduling retry', {
        emailId: email.id,
        to: email.to,
        retryCount: email.retryCount,
        nextRetryAt: email.scheduledAt
      });
    }
  }

  // Add email to queue
  private static addToQueue(
    to: string,
    subject: string,
    html: string,
    priority: 'high' | 'medium' | 'low' = 'medium',
    scheduledAt: Date = new Date(),
    metadata?: Record<string, any>
  ): string {
    const emailId = `email_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    const queueItem: EmailQueueItem = {
      id: emailId,
      to,
      subject,
      html,
      priority,
      retryCount: 0,
      maxRetries: 3,
      scheduledAt,
      createdAt: new Date(),
      metadata
    };

    this.emailQueue.push(queueItem);
    
    this.deliveryStatuses.set(emailId, {
      messageId: '',
      status: 'pending',
      timestamp: new Date(),
      retryCount: 0
    });

    adminLogger.info('Email added to queue', {
      emailId,
      to,
      subject,
      priority,
      scheduledAt
    });

    return emailId;
  }

  // Get email delivery status
  public static getDeliveryStatus(emailId: string): EmailDeliveryStatus | null {
    return this.deliveryStatuses.get(emailId) || null;
  }

  // Get queue statistics
  public static getQueueStatistics() {
    const pending = this.emailQueue.length;
    const sent = Array.from(this.deliveryStatuses.values()).filter(s => s.status === 'sent').length;
    const failed = Array.from(this.deliveryStatuses.values()).filter(s => s.status === 'failed').length;
    const retrying = Array.from(this.deliveryStatuses.values()).filter(s => s.status === 'retry').length;

    return {
      pending,
      sent,
      failed,
      retrying,
      total: pending + sent + failed + retrying
    };
  }

  // Generate approval request email template
  private static generateApprovalRequestTemplate(approval: IEmailApproval, approverName: string, approvalUrl: string): string {
    const priorityColors = {
      low: '#28a745',
      medium: '#ffc107',
      high: '#fd7e14',
      critical: '#dc3545'
    };

    const priorityColor = priorityColors[approval.priority] || '#6c757d';

    return `
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          background-color: #f8f9fa;
          padding: 20px;
        }
        .email-container {
          background: white;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .header {
          background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
          padding: 30px;
          text-align: center;
          color: white;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
        }
        .content {
          padding: 30px;
        }
        .priority-badge {
          display: inline-block;
          background: ${priorityColor};
          color: white;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          margin-bottom: 20px;
        }
        .approval-details {
          background: #f8f9fa;
          border-left: 4px solid #007bff;
          padding: 20px;
          margin: 20px 0;
          border-radius: 0 5px 5px 0;
        }
        .approval-details h3 {
          margin-top: 0;
          color: #007bff;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 5px;
          font-weight: 600;
          margin: 10px 10px 10px 0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .button.reject {
          background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
        }
        .metadata {
          background: #e9ecef;
          padding: 15px;
          border-radius: 5px;
          margin: 15px 0;
          font-size: 14px;
        }
        .footer {
          background: #f8f9fa;
          padding: 20px;
          text-align: center;
          border-top: 1px solid #dee2e6;
          color: #6c757d;
          font-size: 14px;
        }
        .progress-bar {
          background: #e9ecef;
          height: 8px;
          border-radius: 4px;
          overflow: hidden;
          margin: 10px 0;
        }
        .progress-fill {
          background: #007bff;
          height: 100%;
          width: ${(approval.currentApprovals / approval.requiredApprovals) * 100}%;
          transition: width 0.3s ease;
        }
      </style>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>🔐 Approval Request</h1>
          </div>
          <div class="content">
            <div class="priority-badge">${approval.priority} Priority</div>
            
            <h2>Hello ${approverName},</h2>
            <p>You have received a new approval request that requires your attention.</p>
            
            <div class="approval-details">
              <h3>${approval.title}</h3>
              <p><strong>Type:</strong> ${approval.type.replace(/_/g, ' ').toUpperCase()}</p>
              <p><strong>Requested by:</strong> ${(approval.requestedBy as any).firstName} ${(approval.requestedBy as any).lastName} (${(approval.requestedBy as any).username})</p>
              <p><strong>Description:</strong> ${approval.description}</p>
              <p><strong>Expires:</strong> ${approval.formattedTimeRemaining}</p>
              
              <div>
                <strong>Approval Progress:</strong>
                <div class="progress-bar">
                  <div class="progress-fill"></div>
                </div>
                <small>${approval.currentApprovals} of ${approval.requiredApprovals} approvals received</small>
              </div>
            </div>

            ${approval.data ? `
            <div class="metadata">
              <strong>Additional Details:</strong><br>
              ${this.formatApprovalData(approval.data)}
            </div>
            ` : ''}

            <p>Please review this request and take appropriate action:</p>
            
            <a href="${approvalUrl}?action=approve" class="button">✅ Approve</a>
            <a href="${approvalUrl}?action=reject" class="button reject">❌ Reject</a>
            <a href="${approvalUrl}" class="button" style="background: #6c757d;">👁️ View Details</a>

            <p><small><strong>Note:</strong> This approval request will expire on ${approval.expiresAt.toLocaleString()}. Please take action before the deadline.</small></p>
          </div>
          <div class="footer">
            <p>This is an automated message from the Admin Portal.<br>
            Please do not reply to this email.</p>
          </div>
        </div>
      </body>
    `;
  }

  // Format approval data for email display
  private static formatApprovalData(data: any): string {
    let formatted = '';
    
    if (data.userData) {
      formatted += `<strong>User Registration:</strong><br>`;
      formatted += `Name: ${data.userData.firstName} ${data.userData.lastName}<br>`;
      formatted += `Email: ${data.userData.email}<br>`;
      formatted += `Username: ${data.userData.username}<br>`;
      formatted += `Requested Permissions: ${data.userData.requestedPermissions?.join(', ') || 'None'}<br>`;
    }
    
    if (data.permissionData) {
      formatted += `<strong>Permission Change:</strong><br>`;
      formatted += `Current: ${data.permissionData.currentPermissions?.join(', ') || 'None'}<br>`;
      formatted += `Requested: ${data.permissionData.requestedPermissions?.join(', ') || 'None'}<br>`;
      formatted += `Reason: ${data.permissionData.reason}<br>`;
    }
    
    if (data.accountData) {
      formatted += `<strong>Account Action:</strong><br>`;
      formatted += `Action: ${data.accountData.action}<br>`;
      formatted += `Reason: ${data.accountData.reason}<br>`;
      if (data.accountData.duration) {
        formatted += `Duration: ${data.accountData.duration} hours<br>`;
      }
    }
    
    if (data.maintenanceData) {
      formatted += `<strong>System Maintenance:</strong><br>`;
      formatted += `Type: ${data.maintenanceData.type}<br>`;
      formatted += `Scheduled: ${new Date(data.maintenanceData.scheduledTime).toLocaleString()}<br>`;
      formatted += `Duration: ${data.maintenanceData.estimatedDuration} minutes<br>`;
      formatted += `Affected Services: ${data.maintenanceData.affectedServices?.join(', ')}<br>`;
      formatted += `Reason: ${data.maintenanceData.reason}<br>`;
    }
    
    if (data.exportData) {
      formatted += `<strong>Data Export:</strong><br>`;
      formatted += `Type: ${data.exportData.dataType}<br>`;
      formatted += `Date Range: ${new Date(data.exportData.dateRange.start).toLocaleDateString()} - ${new Date(data.exportData.dateRange.end).toLocaleDateString()}<br>`;
      formatted += `Format: ${data.exportData.format}<br>`;
      formatted += `Reason: ${data.exportData.reason}<br>`;
    }
    
    return formatted || 'No additional details provided.';
  }

  // Send approval request emails
  public static async sendApprovalRequestEmails(
    approval: IEmailApproval,
    baseUrl: string = process.env.ADMIN_FRONTEND_URL || 'http://localhost:3000'
  ): Promise<string[]> {
    const approvalUrl = approval.getApprovalUrl(baseUrl);
    const emailIds: string[] = [];

    // Populate approvers if not already populated
    if (!approval.populated('approvers')) {
      await approval.populate('approvers', 'username email firstName lastName');
    }
    if (!approval.populated('requestedBy')) {
      await approval.populate('requestedBy', 'username email firstName lastName');
    }

    for (const approver of approval.approvers as any[]) {
      const emailHtml = this.generateApprovalRequestTemplate(
        approval,
        `${approver.firstName} ${approver.lastName}`,
        approvalUrl
      );

      const subject = `🔐 Approval Required: ${approval.title}`;
      const priority = approval.priority === Priority.CRITICAL ? 'high' : 
                     approval.priority === Priority.HIGH ? 'high' : 'medium';

      const emailId = this.addToQueue(
        approver.email,
        subject,
        emailHtml,
        priority,
        new Date(),
        {
          approvalId: approval._id.toString(),
          approverId: approver._id.toString(),
          type: 'approval_request'
        }
      );

      emailIds.push(emailId);

      // Record email sent in approval document
      await approval.recordEmailSent(approver.email, 'request', emailId);
    }

    // Log the approval request
    await AdminLog.createLog({
      userId: approval.requestedBy as Types.ObjectId,
      level: LogLevel.INFO,
      action: ActionType.ADMIN_APPROVE,
      message: 'Email approval request sent to approvers',
      success: true,
      details: {
        approvalId: approval._id,
        approvalType: approval.type,
        approversCount: approval.approvers.length,
        emailIds
      }
    });

    return emailIds;
  }

  // Send approval status notification (approved/rejected)
  public static async sendApprovalStatusNotification(
    approval: IEmailApproval,
    status: 'approved' | 'rejected',
    actionBy?: any
  ): Promise<string[]> {
    const emailIds: string[] = [];

    // Populate if needed
    if (!approval.populated('requestedBy')) {
      await approval.populate('requestedBy', 'username email firstName lastName');
    }

    const requester = approval.requestedBy as any;
    const actionByName = actionBy ? `${actionBy.firstName} ${actionBy.lastName}` : 'System';

    const statusColor = status === 'approved' ? '#28a745' : '#dc3545';
    const statusIcon = status === 'approved' ? '✅' : '❌';
    const statusText = status === 'approved' ? 'APPROVED' : 'REJECTED';

    const emailHtml = `
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          background-color: #f8f9fa;
          padding: 20px;
        }
        .email-container {
          background: white;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .header {
          background: ${statusColor};
          padding: 30px;
          text-align: center;
          color: white;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
        }
        .content {
          padding: 30px;
        }
        .status-badge {
          display: inline-block;
          background: ${statusColor};
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 20px;
        }
        .approval-details {
          background: #f8f9fa;
          border-left: 4px solid ${statusColor};
          padding: 20px;
          margin: 20px 0;
          border-radius: 0 5px 5px 0;
        }
        .footer {
          background: #f8f9fa;
          padding: 20px;
          text-align: center;
          border-top: 1px solid #dee2e6;
          color: #6c757d;
          font-size: 14px;
        }
      </style>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>${statusIcon} Request ${statusText}</h1>
          </div>
          <div class="content">
            <div class="status-badge">${statusText}</div>
            
            <h2>Hello ${requester.firstName} ${requester.lastName},</h2>
            <p>Your approval request has been <strong>${status}</strong>.</p>
            
            <div class="approval-details">
              <h3>${approval.title}</h3>
              <p><strong>Type:</strong> ${approval.type.replace(/_/g, ' ').toUpperCase()}</p>
              <p><strong>Status:</strong> ${statusText}</p>
              <p><strong>Action by:</strong> ${actionByName}</p>
              <p><strong>Completed at:</strong> ${approval.completedAt?.toLocaleString()}</p>
            </div>

            ${status === 'approved' ? 
              '<p>Your request has been approved and the necessary actions will be taken shortly.</p>' :
              '<p>Your request has been rejected. If you have questions, please contact the administrator.</p>'
            }
          </div>
          <div class="footer">
            <p>This is an automated message from the Admin Portal.<br>
            Please do not reply to this email.</p>
          </div>
        </div>
      </body>
    `;

    const subject = `${statusIcon} Your approval request has been ${status}: ${approval.title}`;

    const emailId = this.addToQueue(
      requester.email,
      subject,
      emailHtml,
      'high',
      new Date(),
      {
        approvalId: approval._id.toString(),
        requesterId: requester._id.toString(),
        type: 'approval_status',
        status
      }
    );

    emailIds.push(emailId);

    // Record email sent in approval document
    await approval.recordEmailSent(requester.email, status as any, emailId);

    return emailIds;
  }

  // Send reminder emails for pending approvals
  public static async sendReminderEmails(
    hoursBeforeExpiry: number = 24,
    baseUrl: string = process.env.ADMIN_FRONTEND_URL || 'http://localhost:3000'
  ): Promise<number> {
    const reminderTime = new Date();
    reminderTime.setHours(reminderTime.getHours() + hoursBeforeExpiry);

    const pendingApprovals = await EmailApproval.find({
      status: ApprovalStatus.PENDING,
      expiresAt: { $lte: reminderTime, $gt: new Date() }
    }).populate('approvers requestedBy', 'username email firstName lastName');

    let remindersSent = 0;

    for (const approval of pendingApprovals) {
      // Check if reminder was already sent in the last 12 hours
      const recentReminders = approval.emailsSent.filter(
        email => email.type === 'reminder' && 
        email.sentAt > new Date(Date.now() - 12 * 60 * 60 * 1000)
      );

      if (recentReminders.length === 0) {
        const emailIds = await this.sendApprovalRequestEmails(approval, baseUrl);
        remindersSent += emailIds.length;

        adminLogger.info('Reminder emails sent for approval', {
          approvalId: approval._id,
          title: approval.title,
          emailsSent: emailIds.length
        });
      }
    }

    return remindersSent;
  }

  // Clean up old delivery statuses (keep for 7 days)
  public static cleanupOldStatuses() {
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    for (const [emailId, status] of this.deliveryStatuses.entries()) {
      if (status.timestamp < cutoffDate) {
        this.deliveryStatuses.delete(emailId);
      }
    }
  }

  // Shutdown the service gracefully
  public static shutdown() {
    if (this.queueProcessingInterval) {
      clearInterval(this.queueProcessingInterval);
      this.queueProcessingInterval = null;
    }
    
    if (this._transporter) {
      this._transporter.close();
      this._transporter = null;
    }
    
    adminLogger.info('AdminEmailService shutdown complete');
  }
}