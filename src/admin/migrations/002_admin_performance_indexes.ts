import { getAdminConnection } from '../config/database';
import { adminLogger } from '../config/logger';

/**
 * Migration: Admin Performance Indexes
 * Creates additional performance-optimized indexes for admin collections
 */
export async function up(): Promise<void> {
  try {
    adminLogger.info('Starting admin performance indexes migration...');
    
    const connection = getAdminConnection();
    const db = connection.db;
    
    // Additional SuperUsers performance indexes
    adminLogger.info('Creating additional SuperUsers performance indexes...');
    const superUsersCollection = db.collection('superusers');
    
    await superUsersCollection.createIndexes([
      // Compound index for permission-based queries with status
      { key: { permissions: 1, status: 1, lastLogin: -1 } },
      // Index for approval workflow queries
      { key: { status: 1, approvedBy: 1, createdAt: -1 } },
      // Text index for search functionality
      { key: { username: 'text', email: 'text', firstName: 'text', lastName: 'text' } },
      // Index for security queries (locked accounts)
      { key: { lockUntil: 1, loginAttempts: 1 } }
    ]);
    
    // Additional AdminLogs performance indexes
    adminLogger.info('Creating additional AdminLogs performance indexes...');
    const adminLogsCollection = db.collection('adminlogs');
    
    await adminLogsCollection.createIndexes([
      // Compound index for user activity analysis
      { key: { userId: 1, level: 1, success: 1, createdAt: -1 } },
      // Index for resource-based queries
      { key: { resourceType: 1, resourceId: 1, action: 1, createdAt: -1 } },
      // Index for session-based log analysis
      { key: { sessionId: 1, action: 1, createdAt: -1 } },
      // Index for IP-based security analysis
      { key: { 'requestInfo.ip': 1, success: 1, createdAt: -1 } },
      // Index for response time analysis
      { key: { 'responseInfo.statusCode': 1, 'responseInfo.responseTime': 1 } },
      // Compound index for error analysis
      { key: { level: 1, success: 1, action: 1, createdAt: -1 } },
      // Text index for log message search
      { key: { message: 'text' } }
    ]);
    
    // Additional SystemMetrics performance indexes
    adminLogger.info('Creating additional SystemMetrics performance indexes...');
    const systemMetricsCollection = db.collection('systemmetrics');
    
    await systemMetricsCollection.createIndexes([
      // Compound index for time-series queries
      { key: { type: 1, name: 1, source: 1, createdAt: -1 } },
      // Index for alert threshold queries
      { key: { isActive: 1, 'alertThresholds.warning': 1, 'alertThresholds.critical': 1 } },
      // Index for value-based queries and sorting
      { key: { type: 1, value: -1, createdAt: -1 } },
      // Index for tag-based filtering
      { key: { 'tags.environment': 1, 'tags.service': 1, type: 1 } },
      // Index for aggregation period queries
      { key: { aggregationPeriod: 1, type: 1, createdAt: -1 } },
      // Compound index for metric comparison queries
      { key: { name: 1, source: 1, value: 1, previousValue: 1 } }
    ]);
    
    // Additional AdminSessions performance indexes
    adminLogger.info('Creating additional AdminSessions performance indexes...');
    const adminSessionsCollection = db.collection('adminsessions');
    
    await adminSessionsCollection.createIndexes([
      // Compound index for user session analysis
      { key: { userId: 1, status: 1, lastActivity: -1 } },
      // Index for security analysis (IP and device tracking)
      { key: { ipAddress: 1, 'deviceInfo.browser': 1, loginTime: -1 } },
      // Index for session duration analysis
      { key: { loginTime: 1, lastActivity: 1, status: 1 } },
      // Index for location-based analysis
      { key: { 'location.country': 1, 'location.city': 1, loginTime: -1 } },
      // Index for permission-based queries
      { key: { permissions: 1, status: 1 } },
      // Index for termination analysis
      { key: { terminatedBy: 1, terminatedAt: -1, terminationReason: 1 } },
      // Compound index for suspicious activity detection
      { key: { ipAddress: 1, userId: 1, loginTime: -1 } }
    ]);
    
    // Additional EmailApprovals performance indexes
    adminLogger.info('Creating additional EmailApprovals performance indexes...');
    const emailApprovalsCollection = db.collection('emailapprovals');
    
    await emailApprovalsCollection.createIndexes([
      // Compound index for approval workflow queries
      { key: { status: 1, type: 1, priority: -1, createdAt: -1 } },
      // Index for approver workload analysis
      { key: { approvers: 1, status: 1, priority: -1 } },
      // Index for approval progress tracking
      { key: { currentApprovals: 1, requiredApprovals: 1, status: 1 } },
      // Index for expiration management
      { key: { expiresAt: 1, status: 1 } },
      // Index for approval history and analytics
      { key: { completedAt: -1, status: 1, type: 1 } },
      // Index for email tracking
      { key: { 'emailsSent.to': 1, 'emailsSent.type': 1, 'emailsSent.sentAt': -1 } },
      // Text index for approval search
      { key: { title: 'text', description: 'text' } },
      // Compound index for user-specific approval queries
      { key: { requestedBy: 1, status: 1, type: 1, createdAt: -1 } }
    ]);
    
    // Create partial indexes for better performance on specific queries
    adminLogger.info('Creating partial indexes for optimized queries...');
    
    // Partial index for active sessions only
    await adminSessionsCollection.createIndex(
      { userId: 1, lastActivity: -1 },
      { 
        partialFilterExpression: { 
          status: 'active',
          expiresAt: { $gt: new Date() }
        },
        name: 'active_sessions_by_user'
      }
    );
    
    // Partial index for pending approvals only
    await emailApprovalsCollection.createIndex(
      { approvers: 1, priority: -1, createdAt: -1 },
      {
        partialFilterExpression: { status: 'pending' },
        name: 'pending_approvals_by_approver'
      }
    );
    
    // Partial index for failed login attempts
    await adminLogsCollection.createIndex(
      { 'requestInfo.ip': 1, createdAt: -1 },
      {
        partialFilterExpression: { 
          action: 'auth:login_failed',
          success: false
        },
        name: 'failed_logins_by_ip'
      }
    );
    
    // Partial index for critical system metrics
    await systemMetricsCollection.createIndex(
      { type: 1, value: -1, createdAt: -1 },
      {
        partialFilterExpression: { 
          isActive: true,
          alertThresholds: { $exists: true }
        },
        name: 'critical_metrics_with_alerts'
      }
    );
    
    // Log migration completion
    await adminLogsCollection.insertOne({
      level: 'info',
      action: 'system:maintenance',
      message: 'Admin performance indexes migration completed successfully',
      details: {
        migration: '002_admin_performance_indexes',
        indexesCreated: {
          superUsers: 4,
          adminLogs: 7,
          systemMetrics: 6,
          adminSessions: 7,
          emailApprovals: 8,
          partialIndexes: 4
        }
      },
      success: true,
      createdAt: new Date()
    });
    
    adminLogger.info('Admin performance indexes migration completed successfully');
    
  } catch (error) {
    adminLogger.error('Admin performance indexes migration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Rollback migration
 */
export async function down(): Promise<void> {
  try {
    adminLogger.info('Rolling back admin performance indexes migration...');
    
    const connection = getAdminConnection();
    const db = connection.db;
    
    // List of indexes to drop (by name)
    const indexesToDrop = [
      // SuperUsers indexes
      'permissions_1_status_1_lastLogin_-1',
      'status_1_approvedBy_1_createdAt_-1',
      'username_text_email_text_firstName_text_lastName_text',
      'lockUntil_1_loginAttempts_1',
      
      // AdminLogs indexes
      'userId_1_level_1_success_1_createdAt_-1',
      'resourceType_1_resourceId_1_action_1_createdAt_-1',
      'sessionId_1_action_1_createdAt_-1',
      'requestInfo.ip_1_success_1_createdAt_-1',
      'responseInfo.statusCode_1_responseInfo.responseTime_1',
      'level_1_success_1_action_1_createdAt_-1',
      'message_text',
      'failed_logins_by_ip',
      
      // SystemMetrics indexes
      'type_1_name_1_source_1_createdAt_-1',
      'isActive_1_alertThresholds.warning_1_alertThresholds.critical_1',
      'type_1_value_-1_createdAt_-1',
      'tags.environment_1_tags.service_1_type_1',
      'aggregationPeriod_1_type_1_createdAt_-1',
      'name_1_source_1_value_1_previousValue_1',
      'critical_metrics_with_alerts',
      
      // AdminSessions indexes
      'userId_1_status_1_lastActivity_-1',
      'ipAddress_1_deviceInfo.browser_1_loginTime_-1',
      'loginTime_1_lastActivity_1_status_1',
      'location.country_1_location.city_1_loginTime_-1',
      'permissions_1_status_1',
      'terminatedBy_1_terminatedAt_-1_terminationReason_1',
      'ipAddress_1_userId_1_loginTime_-1',
      'active_sessions_by_user',
      
      // EmailApprovals indexes
      'status_1_type_1_priority_-1_createdAt_-1',
      'approvers_1_status_1_priority_-1',
      'currentApprovals_1_requiredApprovals_1_status_1',
      'expiresAt_1_status_1',
      'completedAt_-1_status_1_type_1',
      'emailsSent.to_1_emailsSent.type_1_emailsSent.sentAt_-1',
      'title_text_description_text',
      'requestedBy_1_status_1_type_1_createdAt_-1',
      'pending_approvals_by_approver'
    ];
    
    const collections = [
      'superusers',
      'adminlogs',
      'systemmetrics',
      'adminsessions',
      'emailapprovals'
    ];
    
    for (const collectionName of collections) {
      const collection = db.collection(collectionName);
      
      // Get existing indexes
      const indexes = await collection.indexes();
      
      for (const indexName of indexesToDrop) {
        try {
          const indexExists = indexes.some(index => index.name === indexName);
          if (indexExists) {
            await collection.dropIndex(indexName);
            adminLogger.info(`Dropped index: ${indexName} from ${collectionName}`);
          }
        } catch (error) {
          // Index might not exist, which is fine
          adminLogger.warn(`Could not drop index ${indexName} from ${collectionName}`, {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
    
    adminLogger.info('Admin performance indexes migration rollback completed');
    
  } catch (error) {
    adminLogger.error('Admin performance indexes migration rollback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

export const migrationInfo = {
  version: '002',
  name: 'admin_performance_indexes',
  description: 'Creates additional performance-optimized indexes for admin collections',
  createdAt: new Date('2024-01-02')
};