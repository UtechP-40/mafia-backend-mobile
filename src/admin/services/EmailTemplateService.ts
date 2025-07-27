import { adminLogger } from '../config/logger';
import { IEmailApproval, Priority } from '../models/EmailApproval';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlTemplate: string;
  variables: string[];
  description: string;
  category: 'approval' | 'notification' | 'reminder' | 'status';
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateVariables {
  [key: string]: any;
}

export class EmailTemplateService {
  private static templates: Map<string, EmailTemplate> = new Map();
  private static initialized = false;

  // Initialize default templates
  public static initialize() {
    if (this.initialized) return;

    this.loadDefaultTemplates();
    this.initialized = true;
    adminLogger.info('EmailTemplateService initialized with default templates');
  }

  // Load default email templates
  private static loadDefaultTemplates() {
    const defaultTemplates: EmailTemplate[] = [
      {
        id: 'approval_request',
        name: 'Approval Request',
        subject: '🔐 Approval Required: {{title}}',
        htmlTemplate: this.getDefaultApprovalTemplate(),
        variables: ['approverName', 'title', 'description', 'priority', 'approvalUrl', 'expiresAt', 'requesterName'],
        description: 'Template for approval request emails',
        category: 'approval',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'approval_approved',
        name: 'Approval Approved',
        subject: '✅ Your approval request has been approved: {{title}}',
        htmlTemplate: this.getDefaultStatusTemplate('approved'),
        variables: ['requesterName', 'title', 'approvedBy', 'completedAt'],
        description: 'Template for approval approved notifications',
        category: 'status',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'approval_rejected',
        name: 'Approval Rejected',
        subject: '❌ Your approval request has been rejected: {{title}}',
        htmlTemplate: this.getDefaultStatusTemplate('rejected'),
        variables: ['requesterName', 'title', 'rejectedBy', 'completedAt', 'comment'],
        description: 'Template for approval rejected notifications',
        category: 'status',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'approval_reminder',
        name: 'Approval Reminder',
        subject: '⏰ Reminder: Approval Required - {{title}}',
        htmlTemplate: this.getDefaultReminderTemplate(),
        variables: ['approverName', 'title', 'description', 'priority', 'approvalUrl', 'expiresAt', 'timeRemaining'],
        description: 'Template for approval reminder emails',
        category: 'reminder',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    defaultTemplates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  // Get template by ID
  public static getTemplate(templateId: string): EmailTemplate | null {
    return this.templates.get(templateId) || null;
  }

  // Get all templates
  public static getAllTemplates(): EmailTemplate[] {
    return Array.from(this.templates.values());
  }

  // Get templates by category
  public static getTemplatesByCategory(category: EmailTemplate['category']): EmailTemplate[] {
    return Array.from(this.templates.values()).filter(template => template.category === category);
  }

  // Render template with variables
  public static renderTemplate(templateId: string, variables: TemplateVariables): { subject: string; html: string } | null {
    const template = this.getTemplate(templateId);
    if (!template) return null;

    const subject = this.replaceVariables(template.subject, variables);
    const html = this.replaceVariables(template.htmlTemplate, variables);

    return { subject, html };
  }

  // Replace template variables
  private static replaceVariables(template: string, variables: TemplateVariables): string {
    let result = template;
    
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(variables[key] || ''));
    });

    return result;
  }

  // Add or update custom template
  public static setTemplate(template: EmailTemplate): void {
    template.updatedAt = new Date();
    this.templates.set(template.id, template);
    adminLogger.info(`Email template ${template.id} updated`);
  }

  // Remove template
  public static removeTemplate(templateId: string): boolean {
    const template = this.templates.get(templateId);
    if (!template) return false;
    
    if (template.isDefault) {
      throw new Error('Cannot remove default templates');
    }

    this.templates.delete(templateId);
    adminLogger.info(`Email template ${templateId} removed`);
    return true;
  }

  // Default approval request template
  private static getDefaultApprovalTemplate(): string {
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
          background: {{priorityColor}};
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
            <h1>🔐 Approval Request</h1>
          </div>
          <div class="content">
            <div class="priority-badge">{{priority}} Priority</div>
            
            <h2>Hello {{approverName}},</h2>
            <p>You have received a new approval request that requires your attention.</p>
            
            <div class="approval-details">
              <h3>{{title}}</h3>
              <p><strong>Description:</strong> {{description}}</p>
              <p><strong>Requested by:</strong> {{requesterName}}</p>
              <p><strong>Expires:</strong> {{expiresAt}}</p>
            </div>

            <p>Please review this request and take appropriate action:</p>
            
            <a href="{{approvalUrl}}?action=approve" class="button">✅ Approve</a>
            <a href="{{approvalUrl}}?action=reject" class="button reject">❌ Reject</a>
            <a href="{{approvalUrl}}" class="button" style="background: #6c757d;">👁️ View Details</a>
          </div>
          <div class="footer">
            <p>This is an automated message from the Admin Portal.<br>
            Please do not reply to this email.</p>
          </div>
        </div>
      </body>
    `;
  }

  // Default status template (approved/rejected)
  private static getDefaultStatusTemplate(status: 'approved' | 'rejected'): string {
    const statusColor = status === 'approved' ? '#28a745' : '#dc3545';
    const statusIcon = status === 'approved' ? '✅' : '❌';
    const statusText = status === 'approved' ? 'APPROVED' : 'REJECTED';

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
            
            <h2>Hello {{requesterName}},</h2>
            <p>Your approval request has been <strong>${status}</strong>.</p>
            
            <div class="approval-details">
              <h3>{{title}}</h3>
              <p><strong>Status:</strong> ${statusText}</p>
              <p><strong>Action by:</strong> {{${status}By}}</p>
              <p><strong>Completed at:</strong> {{completedAt}}</p>
              ${status === 'rejected' ? '<p><strong>Comment:</strong> {{comment}}</p>' : ''}
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
  }

  // Default reminder template
  private static getDefaultReminderTemplate(): string {
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
          background: linear-gradient(135deg, #ffc107 0%, #e0a800 100%);
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
        .reminder-badge {
          display: inline-block;
          background: #ffc107;
          color: #212529;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 20px;
        }
        .approval-details {
          background: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 20px;
          margin: 20px 0;
          border-radius: 0 5px 5px 0;
        }
        .approval-details h3 {
          margin-top: 0;
          color: #856404;
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
            <h1>⏰ Approval Reminder</h1>
          </div>
          <div class="content">
            <div class="reminder-badge">REMINDER</div>
            
            <h2>Hello {{approverName}},</h2>
            <p>This is a reminder that you have a pending approval request that expires soon.</p>
            
            <div class="approval-details">
              <h3>{{title}}</h3>
              <p><strong>Description:</strong> {{description}}</p>
              <p><strong>Priority:</strong> {{priority}}</p>
              <p><strong>Time Remaining:</strong> {{timeRemaining}}</p>
              <p><strong>Expires:</strong> {{expiresAt}}</p>
            </div>

            <p>Please take action before the deadline:</p>
            
            <a href="{{approvalUrl}}?action=approve" class="button">✅ Approve</a>
            <a href="{{approvalUrl}}?action=reject" class="button reject">❌ Reject</a>
            <a href="{{approvalUrl}}" class="button" style="background: #6c757d;">👁️ View Details</a>
          </div>
          <div class="footer">
            <p>This is an automated message from the Admin Portal.<br>
            Please do not reply to this email.</p>
          </div>
        </div>
      </body>
    `;
  }
}