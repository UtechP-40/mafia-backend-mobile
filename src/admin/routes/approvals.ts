import { Router, Request, Response } from 'express';
import { EmailApproval, ApprovalType, ApprovalStatus, Priority } from '../models/EmailApproval';
import { SuperUser, Permission } from '../models/SuperUser';
import { AdminEmailService } from '../services/AdminEmailService';
import { adminAsyncHandler, AdminOperationalError } from '../middleware/errorHandler';
import { adminLogger } from '../config/logger';
import { AuthenticatedAdminRequest, requireAdminPermission } from '../middleware/auth';
import { AdminLog, ActionType, LogLevel } from '../models/AdminLog';
import { Types } from 'mongoose';

const router = Router();

// Rate limiting for approval endpoints
import rateLimit from 'express-rate-limit';

const approvalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per 15 minutes
  message: {
    error: 'Too many approval requests from this IP, please try again later.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * POST /admin/approvals
 * Create a new approval request
 */
router.post('/',
  approvalRateLimit,
  requireAdminPermission(Permission.ADMIN_CREATE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const {
      type,
      title,
      description,
      approvers,
      data,
      priority = Priority.MEDIUM,
      requiredApprovals,
      expirationHours = 72
    } = req.body;

    const requestedBy = req.adminUser?.id;

    if (!requestedBy) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    // Validation
    if (!type || !Object.values(ApprovalType).includes(type)) {
      res.status(400).json({
        success: false,
        message: 'Valid approval type is required',
        validTypes: Object.values(ApprovalType)
      });
      return;
    }

    if (!title || typeof title !== 'string' || title.length < 5 || title.length > 200) {
      res.status(400).json({
        success: false,
        message: 'Title must be between 5 and 200 characters'
      });
      return;
    }

    if (!description || typeof description !== 'string' || description.length < 10 || description.length > 1000) {
      res.status(400).json({
        success: false,
        message: 'Description must be between 10 and 1000 characters'
      });
      return;
    }

    if (!Array.isArray(approvers) || approvers.length === 0) {
      res.status(400).json({
        success: false,
        message: 'At least one approver is required'
      });
      return;
    }

    // Validate approvers exist and have appropriate permissions
    const approverUsers = await SuperUser.find({
      _id: { $in: approvers },
      status: 'active',
      permissions: { $in: [Permission.ADMIN_APPROVE, Permission.SUPER_ADMIN] }
    });

    if (approverUsers.length !== approvers.length) {
      res.status(400).json({
        success: false,
        message: 'One or more approvers are invalid or do not have approval permissions'
      });
      return;
    }

    // Create approval request
    const approval = await EmailApproval.createApproval(
      type,
      title,
      description,
      new Types.ObjectId(requestedBy),
      approvers.map((id: string) => new Types.ObjectId(id)),
      data || {},
      {
        requiredApprovals: requiredApprovals || Math.ceil(approvers.length / 2),
        priority: priority || Priority.MEDIUM,
        expirationHours: expirationHours || 72
      }
    );

    // Send approval request emails
    const emailIds = await AdminEmailService.sendApprovalRequestEmails(approval);

    // Log the approval creation
    await AdminLog.createLog({
      userId: new Types.ObjectId(requestedBy),
      level: LogLevel.INFO,
      action: ActionType.ADMIN_CREATE,
      message: `Created approval request: ${title}`,
      success: true,
      details: {
        approvalId: approval._id,
        type,
        approversCount: approvers.length,
        emailIds
      }
    });

    res.status(201).json({
      success: true,
      message: 'Approval request created successfully',
      data: {
        approval: {
          id: approval._id,
          type: approval.type,
          title: approval.title,
          status: approval.status,
          priority: approval.priority,
          approvalToken: approval.approvalToken,
          expiresAt: approval.expiresAt,
          emailsSent: emailIds.length
        }
      }
    });
  })
);

/**
 * GET /admin/approvals
 * Get approval requests (with filtering and pagination)
 */
router.get('/',
  requireAdminPermission(Permission.ADMIN_VIEW),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const {
      status,
      type,
      priority,
      requestedBy,
      assignedToMe,
      limit = 50,
      skip = 0,
      startDate,
      endDate
    } = req.query;

    const userId = req.adminUser?.id;
    const filter: any = {};

    // Apply filters
    if (status && Object.values(ApprovalStatus).includes(status as ApprovalStatus)) {
      filter.status = status;
    }

    if (type && Object.values(ApprovalType).includes(type as ApprovalType)) {
      filter.type = type;
    }

    if (priority && Object.values(Priority).includes(priority as Priority)) {
      filter.priority = priority;
    }

    if (requestedBy) {
      filter.requestedBy = requestedBy;
    }

    if (assignedToMe === 'true' && userId) {
      filter.approvers = new Types.ObjectId(userId);
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate as string);
      if (endDate) filter.createdAt.$lte = new Date(endDate as string);
    }

    const approvals = await EmailApproval.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(skip as string))
      .populate('requestedBy', 'username email firstName lastName')
      .populate('approvers', 'username email firstName lastName')
      .populate('approvedBy', 'username email firstName lastName')
      .populate('rejectedBy', 'username email firstName lastName');

    const total = await EmailApproval.countDocuments(filter);

    res.status(200).json({
      success: true,
      message: 'Approval requests retrieved successfully',
      data: {
        approvals,
        pagination: {
          total,
          limit: parseInt(limit as string),
          skip: parseInt(skip as string),
          hasMore: total > parseInt(skip as string) + parseInt(limit as string)
        }
      }
    });
  })
);

/**
 * GET /admin/approvals/:token
 * Get approval request by token (for email links)
 */
router.get('/:token',
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Approval token is required'
      });
      return;
    }

    const approval = await EmailApproval.findByToken(token);

    if (!approval) {
      res.status(404).json({
        success: false,
        message: 'Approval request not found or token is invalid'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Approval request retrieved successfully',
      data: {
        approval
      }
    });
  })
);

/**
 * POST /admin/approvals/:token/approve
 * Approve an approval request
 */
router.post('/:token/approve',
  approvalRateLimit,
  requireAdminPermission(Permission.ADMIN_APPROVE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const { token } = req.params;
    const { comment } = req.body;
    const userId = req.adminUser?.id;

    if (!userId) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Approval token is required'
      });
      return;
    }

    const approval = await EmailApproval.findByToken(token);

    if (!approval) {
      res.status(404).json({
        success: false,
        message: 'Approval request not found or token is invalid'
      });
      return;
    }

    // Check if user can approve this request
    if (!approval.canUserApprove(new Types.ObjectId(userId))) {
      res.status(403).json({
        success: false,
        message: 'You are not authorized to approve this request or have already approved it'
      });
      return;
    }

    // Approve the request
    await approval.approve(new Types.ObjectId(userId), comment);

    // Get approver details for logging
    const approver = await SuperUser.findById(userId);

    // Send status notification if approval is complete
    if (approval.status === ApprovalStatus.APPROVED) {
      await AdminEmailService.sendApprovalStatusNotification(approval, 'approved', approver);
    }

    // Log the approval action
    await AdminLog.createLog({
      userId: new Types.ObjectId(userId),
      level: LogLevel.INFO,
      action: ActionType.ADMIN_APPROVE,
      message: `Approved request: ${approval.title}`,
      success: true,
      details: {
        approvalId: approval._id,
        approvalTitle: approval.title,
        comment,
        isComplete: approval.status === ApprovalStatus.APPROVED
      }
    });

    res.status(200).json({
      success: true,
      message: approval.status === ApprovalStatus.APPROVED 
        ? 'Approval request has been fully approved' 
        : 'Your approval has been recorded',
      data: {
        approval: {
          id: approval._id,
          status: approval.status,
          currentApprovals: approval.currentApprovals,
          requiredApprovals: approval.requiredApprovals,
          isComplete: approval.status === ApprovalStatus.APPROVED
        }
      }
    });
  })
);

/**
 * POST /admin/approvals/:token/reject
 * Reject an approval request
 */
router.post('/:token/reject',
  approvalRateLimit,
  requireAdminPermission(Permission.ADMIN_APPROVE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const { token } = req.params;
    const { comment } = req.body;
    const userId = req.adminUser?.id;

    if (!userId) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    if (!token || typeof token !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Approval token is required'
      });
      return;
    }

    if (!comment || typeof comment !== 'string' || comment.length < 5) {
      res.status(400).json({
        success: false,
        message: 'Rejection comment is required (minimum 5 characters)'
      });
      return;
    }

    const approval = await EmailApproval.findByToken(token);

    if (!approval) {
      res.status(404).json({
        success: false,
        message: 'Approval request not found or token is invalid'
      });
      return;
    }

    // Check if user can approve this request (same permission needed for rejection)
    if (!approval.canUserApprove(new Types.ObjectId(userId))) {
      res.status(403).json({
        success: false,
        message: 'You are not authorized to reject this request'
      });
      return;
    }

    // Reject the request
    await approval.reject(new Types.ObjectId(userId), comment);

    // Get rejector details for logging
    const rejector = await SuperUser.findById(userId);

    // Send status notification
    await AdminEmailService.sendApprovalStatusNotification(approval, 'rejected', rejector);

    // Log the rejection action
    await AdminLog.createLog({
      userId: new Types.ObjectId(userId),
      level: LogLevel.INFO,
      action: ActionType.ADMIN_REJECT,
      message: `Rejected request: ${approval.title}`,
      success: true,
      details: {
        approvalId: approval._id,
        approvalTitle: approval.title,
        comment
      }
    });

    res.status(200).json({
      success: true,
      message: 'Approval request has been rejected',
      data: {
        approval: {
          id: approval._id,
          status: approval.status,
          rejectedAt: approval.rejectedAt,
          rejectedBy: approval.rejectedBy
        }
      }
    });
  })
);

/**
 * POST /admin/approvals/:id/cancel
 * Cancel an approval request (only by requester or super admin)
 */
router.post('/:id/cancel',
  approvalRateLimit,
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.adminUser?.id;
    const userPermissions = req.adminUser?.permissions || [];

    if (!userId) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid approval ID'
      });
      return;
    }

    const approval = await EmailApproval.findById(id);

    if (!approval) {
      res.status(404).json({
        success: false,
        message: 'Approval request not found'
      });
      return;
    }

    // Check if user can cancel (must be requester or super admin)
    const canCancel = approval.requestedBy.equals(new Types.ObjectId(userId)) || 
                     userPermissions.includes(Permission.SUPER_ADMIN);

    if (!canCancel) {
      res.status(403).json({
        success: false,
        message: 'You can only cancel your own approval requests'
      });
      return;
    }

    // Cancel the request
    await approval.cancel(new Types.ObjectId(userId), reason);

    // Log the cancellation
    await AdminLog.createLog({
      userId: new Types.ObjectId(userId),
      level: LogLevel.INFO,
      action: ActionType.ADMIN_UPDATE,
      message: `Cancelled approval request: ${approval.title}`,
      success: true,
      details: {
        approvalId: approval._id,
        approvalTitle: approval.title,
        reason
      }
    });

    res.status(200).json({
      success: true,
      message: 'Approval request has been cancelled',
      data: {
        approval: {
          id: approval._id,
          status: approval.status,
          completedAt: approval.completedAt
        }
      }
    });
  })
);

/**
 * GET /admin/approvals/statistics
 * Get approval statistics
 */
router.get('/statistics',
  requireAdminPermission(Permission.ADMIN_VIEW),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const statistics = await EmailApproval.getApprovalStatistics(start, end);

    res.status(200).json({
      success: true,
      message: 'Approval statistics retrieved successfully',
      data: {
        statistics: statistics[0] || {
          totalApprovals: 0,
          pendingApprovals: 0,
          approvedApprovals: 0,
          rejectedApprovals: 0,
          expiredApprovals: 0,
          averageApprovalTime: 0
        }
      }
    });
  })
);

/**
 * POST /admin/approvals/send-reminders
 * Send reminder emails for pending approvals
 */
router.post('/send-reminders',
  requireAdminPermission(Permission.ADMIN_APPROVE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response): Promise<void> => {
    const { hoursBeforeExpiry = 24 } = req.body;
    const userId = req.adminUser?.id;

    if (!userId) {
      throw new AdminOperationalError('Authentication required', 401, 'ADMIN_AUTH_REQUIRED');
    }

    const remindersSent = await AdminEmailService.sendReminderEmails(
      parseInt(hoursBeforeExpiry as string) || 24
    );

    // Log the reminder action
    await AdminLog.createLog({
      userId: new Types.ObjectId(userId),
      level: LogLevel.INFO,
      action: ActionType.ADMIN_UPDATE,
      message: `Sent ${remindersSent} approval reminder emails`,
      success: true,
      details: {
        remindersSent,
        hoursBeforeExpiry
      }
    });

    res.status(200).json({
      success: true,
      message: `Sent ${remindersSent} reminder emails`,
      data: {
        remindersSent
      }
    });
  })
);

/**
 * GET /admin/approvals/email-status/:emailId
 * Get email delivery status
 */
router.get('/email-status/:emailId',
  requireAdminPermission(Permission.ADMIN_VIEW),
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { emailId } = req.params;

    if (!emailId || typeof emailId !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Email ID is required'
      });
      return;
    }

    const status = AdminEmailService.getDeliveryStatus(emailId);

    if (!status) {
      res.status(404).json({
        success: false,
        message: 'Email status not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Email status retrieved successfully',
      data: {
        status
      }
    });
  })
);

/**
 * GET /admin/approvals/email-queue/statistics
 * Get email queue statistics
 */
router.get('/email-queue/statistics',
  requireAdminPermission(Permission.ADMIN_VIEW),
  adminAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    const statistics = AdminEmailService.getQueueStatistics();

    res.status(200).json({
      success: true,
      message: 'Email queue statistics retrieved successfully',
      data: {
        statistics
      }
    });
  })
);

export default router;