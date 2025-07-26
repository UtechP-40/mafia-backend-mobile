import { connectAdminDatabase, closeAdminDatabase } from '../config/database';
import { SuperUser, AdminLog, SystemMetric, AdminSession, EmailApproval } from '../models';
import { Permission, SuperUserStatus } from '../models/SuperUser';
import { LogLevel, ActionType } from '../models/AdminLog';
import { MetricType, MetricUnit } from '../models/SystemMetric';
import { SessionStatus } from '../models/AdminSession';
import { ApprovalType, ApprovalStatus, Priority } from '../models/EmailApproval';

describe('Admin Models', () => {
  beforeAll(async () => {
    await connectAdminDatabase();
  });

  afterAll(async () => {
    await closeAdminDatabase();
  });

  beforeEach(async () => {
    // Clean up collections before each test
    await SuperUser.deleteMany({});
    await AdminLog.deleteMany({});
    await SystemMetric.deleteMany({});
    await AdminSession.deleteMany({});
    await EmailApproval.deleteMany({});
  });

  describe('SuperUser Model', () => {
    it('should create a super user with valid data', async () => {
      const userData = {
        username: 'testadmin',
        email: 'test@admin.com',
        password: 'hashedpassword123',
        firstName: 'Test',
        lastName: 'Admin',
        permissions: [Permission.DATABASE_READ, Permission.USER_READ]
      };

      const superUser = new SuperUser(userData);
      await superUser.save();

      expect(superUser._id).toBeDefined();
      expect(superUser.username).toBe('testadmin');
      expect(superUser.status).toBe(SuperUserStatus.PENDING);
      expect(superUser.permissions).toContain(Permission.DATABASE_READ);
      expect(superUser.fullName).toBe('Test Admin');
    });

    it('should validate permission methods', async () => {
      const superUser = new SuperUser({
        username: 'testadmin',
        email: 'test@admin.com',
        password: 'hashedpassword123',
        firstName: 'Test',
        lastName: 'Admin',
        permissions: [Permission.DATABASE_READ, Permission.USER_READ]
      });

      expect(superUser.hasPermission(Permission.DATABASE_READ)).toBe(true);
      expect(superUser.hasPermission(Permission.DATABASE_WRITE)).toBe(false);
      expect(superUser.hasAnyPermission([Permission.DATABASE_READ, Permission.DATABASE_WRITE])).toBe(true);
    });

    it('should handle super admin permissions', async () => {
      const superUser = new SuperUser({
        username: 'superadmin',
        email: 'super@admin.com',
        password: 'hashedpassword123',
        firstName: 'Super',
        lastName: 'Admin',
        permissions: [Permission.SUPER_ADMIN]
      });

      await superUser.save();

      expect(superUser.hasPermission(Permission.DATABASE_READ)).toBe(true);
      expect(superUser.hasPermission(Permission.USER_DELETE)).toBe(true);
      expect(superUser.permissions).toEqual([Permission.SUPER_ADMIN]);
    });
  });

  describe('AdminLog Model', () => {
    it('should create an admin log entry', async () => {
      const logData = {
        level: LogLevel.INFO,
        action: ActionType.LOGIN,
        message: 'User logged in successfully',
        success: true,
        requestInfo: {
          method: 'POST',
          url: '/admin/login',
          ip: '127.0.0.1'
        },
        responseInfo: {
          statusCode: 200,
          responseTime: 150
        }
      };

      const adminLog = new AdminLog(logData);
      await adminLog.save();

      expect(adminLog._id).toBeDefined();
      expect(adminLog.level).toBe(LogLevel.INFO);
      expect(adminLog.action).toBe(ActionType.LOGIN);
      expect(adminLog.success).toBe(true);
      expect(adminLog.severityScore).toBe(2); // INFO level
    });

    it('should create log using static method', async () => {
      const logData = {
        level: LogLevel.ERROR,
        action: ActionType.DATABASE_DELETE,
        message: 'Failed to delete record',
        success: false
      };

      const adminLog = await AdminLog.createLog(logData);

      expect(adminLog._id).toBeDefined();
      expect(adminLog.level).toBe(LogLevel.ERROR);
      expect(adminLog.success).toBe(false);
    });
  });

  describe('SystemMetric Model', () => {
    it('should create a system metric', async () => {
      const metricData = {
        name: 'cpu_usage',
        type: MetricType.CPU_USAGE,
        description: 'CPU usage percentage',
        unit: MetricUnit.PERCENTAGE,
        value: 75.5,
        source: 'test-system',
        tags: {
          environment: 'test',
          service: 'admin'
        }
      };

      const metric = new SystemMetric(metricData);
      await metric.save();

      expect(metric._id).toBeDefined();
      expect(metric.name).toBe('cpu_usage');
      expect(metric.value).toBe(75.5);
      expect(metric.getFormattedValue()).toBe('75.50%');
      expect(metric.tags.environment).toBe('test');
    });

    it('should update metric value', async () => {
      const metric = new SystemMetric({
        name: 'memory_usage',
        type: MetricType.MEMORY_USAGE,
        unit: MetricUnit.PERCENTAGE,
        value: 60,
        source: 'test-system'
      });

      await metric.save();
      await metric.updateValue(80, { status: 'high' });

      expect(metric.value).toBe(80);
      expect(metric.previousValue).toBe(60);
      expect(metric.tags.status).toBe('high');
    });

    it('should record metric using static method', async () => {
      const metric = await SystemMetric.recordMetric(
        'db_connections',
        MetricType.DB_CONNECTIONS,
        25,
        {
          unit: MetricUnit.COUNT,
          source: 'database',
          tags: { pool: 'main' }
        }
      );

      expect(metric.name).toBe('db_connections');
      expect(metric.value).toBe(25);
      expect(metric.tags.pool).toBe('main');
    });
  });

  describe('AdminSession Model', () => {
    let testUserId: any;

    beforeEach(async () => {
      const superUser = new SuperUser({
        username: 'sessionuser',
        email: 'session@test.com',
        password: 'hashedpassword123',
        firstName: 'Session',
        lastName: 'User',
        permissions: [Permission.DATABASE_READ]
      });
      await superUser.save();
      testUserId = superUser._id;
    });

    it('should create an admin session', async () => {
      const sessionData = {
        userId: testUserId,
        sessionToken: 'test-session-token',
        refreshToken: 'test-refresh-token',
        ipAddress: '127.0.0.1',
        userAgent: 'Test Browser',
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
        permissions: [Permission.DATABASE_READ]
      };

      const session = new AdminSession(sessionData);
      await session.save();

      expect(session._id).toBeDefined();
      expect(session.userId).toEqual(testUserId);
      expect(session.status).toBe(SessionStatus.ACTIVE);
      expect(session.isActive).toBe(true);
      expect(session.activities).toHaveLength(0);
    });

    it('should create session using static method', async () => {
      const session = await AdminSession.createSession(
        testUserId,
        'static-session-token',
        'static-refresh-token',
        {
          ipAddress: '192.168.1.1',
          userAgent: 'Chrome/91.0',
          permissions: [Permission.DATABASE_READ],
          expirationMinutes: 480
        }
      );

      expect(session.userId).toEqual(testUserId);
      expect(session.ipAddress).toBe('192.168.1.1');
      expect(session.activities).toHaveLength(1);
      expect(session.activities[0].action).toBe('login');
    });

    it('should update session activity', async () => {
      const session = new AdminSession({
        userId: testUserId,
        sessionToken: 'activity-test-token',
        refreshToken: 'activity-refresh-token',
        ipAddress: '127.0.0.1',
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000)
      });

      await session.save();
      await session.updateActivity('database_query', '127.0.0.1', 'Chrome', { query: 'SELECT * FROM users' });

      expect(session.activities).toHaveLength(1);
      expect(session.activities[0].action).toBe('database_query');
      expect(session.activities[0].details?.query).toBe('SELECT * FROM users');
    });

    it('should terminate session', async () => {
      const session = new AdminSession({
        userId: testUserId,
        sessionToken: 'terminate-test-token',
        refreshToken: 'terminate-refresh-token',
        ipAddress: '127.0.0.1',
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000)
      });

      await session.save();
      await session.terminate(testUserId, 'Manual termination');

      expect(session.status).toBe(SessionStatus.TERMINATED);
      expect(session.terminatedBy).toEqual(testUserId);
      expect(session.terminationReason).toBe('Manual termination');
      expect(session.isActive).toBe(false);
    });
  });

  describe('EmailApproval Model', () => {
    let testUserId: any;
    let approverIds: any[];

    beforeEach(async () => {
      const requester = new SuperUser({
        username: 'requester',
        email: 'requester@test.com',
        password: 'hashedpassword123',
        firstName: 'Request',
        lastName: 'User',
        permissions: [Permission.DATABASE_READ]
      });
      await requester.save();
      testUserId = requester._id;

      const approver1 = new SuperUser({
        username: 'approver1',
        email: 'approver1@test.com',
        password: 'hashedpassword123',
        firstName: 'Approver',
        lastName: 'One',
        permissions: [Permission.ADMIN_APPROVE]
      });
      await approver1.save();

      const approver2 = new SuperUser({
        username: 'approver2',
        email: 'approver2@test.com',
        password: 'hashedpassword123',
        firstName: 'Approver',
        lastName: 'Two',
        permissions: [Permission.ADMIN_APPROVE]
      });
      await approver2.save();

      approverIds = [approver1._id, approver2._id];
    });

    it('should create an email approval', async () => {
      const approvalData = {
        type: ApprovalType.SUPER_USER_REGISTRATION,
        title: 'New Super User Registration',
        description: 'Request to register a new super user',
        requestedBy: testUserId,
        approvers: approverIds,
        requiredApprovals: 1,
        priority: Priority.MEDIUM,
        data: {
          userData: {
            username: 'newuser',
            email: 'newuser@test.com',
            firstName: 'New',
            lastName: 'User',
            requestedPermissions: [Permission.DATABASE_READ]
          }
        },
        approvalToken: 'test-approval-token',
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) // 72 hours
      };

      const approval = new EmailApproval(approvalData);
      await approval.save();

      expect(approval._id).toBeDefined();
      expect(approval.type).toBe(ApprovalType.SUPER_USER_REGISTRATION);
      expect(approval.status).toBe(ApprovalStatus.PENDING);
      expect(approval.isCompleted).toBe(false);
      expect(approval.approvalProgress.current).toBe(0);
      expect(approval.approvalProgress.required).toBe(1);
    });

    it('should create approval using static method', async () => {
      const approval = await EmailApproval.createApproval(
        ApprovalType.PERMISSION_CHANGE,
        'Permission Change Request',
        'Request to change user permissions',
        testUserId,
        approverIds,
        {
          permissionData: {
            userId: testUserId,
            currentPermissions: [Permission.DATABASE_READ],
            requestedPermissions: [Permission.DATABASE_READ, Permission.DATABASE_WRITE],
            reason: 'Need write access for admin tasks'
          }
        },
        {
          requiredApprovals: 2,
          priority: Priority.HIGH,
          expirationHours: 48
        }
      );

      expect(approval.type).toBe(ApprovalType.PERMISSION_CHANGE);
      expect(approval.requiredApprovals).toBe(2);
      expect(approval.priority).toBe(Priority.HIGH);
      expect(approval.approvalToken).toBeDefined();
    });

    it('should approve request', async () => {
      const approval = new EmailApproval({
        type: ApprovalType.SUPER_USER_REGISTRATION,
        title: 'Test Approval',
        description: 'Test approval request',
        requestedBy: testUserId,
        approvers: approverIds,
        requiredApprovals: 1,
        data: {},
        approvalToken: 'approve-test-token',
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
      });

      await approval.save();
      await approval.approve(approverIds[0], 'Looks good to me');

      expect(approval.status).toBe(ApprovalStatus.APPROVED);
      expect(approval.currentApprovals).toBe(1);
      expect(approval.approvedBy).toContain(approverIds[0]);
      expect(approval.actions).toHaveLength(1);
      expect(approval.actions[0].actionType).toBe('approve');
      expect(approval.isCompleted).toBe(true);
    });

    it('should reject request', async () => {
      const approval = new EmailApproval({
        type: ApprovalType.SUPER_USER_REGISTRATION,
        title: 'Test Rejection',
        description: 'Test rejection request',
        requestedBy: testUserId,
        approvers: approverIds,
        requiredApprovals: 1,
        data: {},
        approvalToken: 'reject-test-token',
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
      });

      await approval.save();
      await approval.reject(approverIds[0], 'Not sufficient justification');

      expect(approval.status).toBe(ApprovalStatus.REJECTED);
      expect(approval.rejectedBy).toContain(approverIds[0]);
      expect(approval.actions).toHaveLength(1);
      expect(approval.actions[0].actionType).toBe('reject');
      expect(approval.isCompleted).toBe(true);
    });

    it('should check if user can approve', async () => {
      const approval = new EmailApproval({
        type: ApprovalType.SUPER_USER_REGISTRATION,
        title: 'Test Can Approve',
        description: 'Test can approve check',
        requestedBy: testUserId,
        approvers: approverIds,
        requiredApprovals: 1,
        data: {},
        approvalToken: 'can-approve-test-token',
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000)
      });

      await approval.save();

      expect(approval.canUserApprove(approverIds[0])).toBe(true);
      expect(approval.canUserApprove(testUserId)).toBe(false); // Can't approve own request

      await approval.approve(approverIds[0], 'Approved');
      expect(approval.canUserApprove(approverIds[0])).toBe(false); // Already approved
    });
  });
});