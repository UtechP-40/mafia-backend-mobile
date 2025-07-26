import { getAdminConnection } from '../config/database';
import { adminLogger } from '../config/logger';

/**
 * Migration: Admin Collections Setup
 * Creates indexes and initial data for admin collections
 */
export async function up(): Promise<void> {
  try {
    adminLogger.info('Starting admin collections setup migration...');
    
    const connection = getAdminConnection();
    const db = connection.db;
    
    // Create SuperUsers collection indexes
    adminLogger.info('Creating SuperUsers collection indexes...');
    const superUsersCollection = db.collection('superusers');
    
    await superUsersCollection.createIndexes([
      { key: { username: 1 }, unique: true },
      { key: { email: 1 }, unique: true, sparse: true },
      { key: { status: 1 } },
      { key: { permissions: 1 } },
      { key: { lastLogin: -1 } },
      { key: { createdAt: -1 } },
      { key: { approvedBy: 1 } },
      { key: { status: 1, createdAt: -1 } }
    ]);
    
    // Create AdminLogs collection indexes
    adminLogger.info('Creating AdminLogs collection indexes...');
    const adminLogsCollection = db.collection('adminlogs');
    
    await adminLogsCollection.createIndexes([
      { key: { createdAt: -1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { level: 1, createdAt: -1 } },
      { key: { action: 1, createdAt: -1 } },
      { key: { success: 1, createdAt: -1 } },
      { key: { resourceType: 1, resourceId: 1 } },
      { key: { sessionId: 1, createdAt: -1 } },
      { key: { tags: 1 } },
      { key: { userId: 1, action: 1, createdAt: -1 } },
      { key: { level: 1, success: 1, createdAt: -1 } },
      { key: { action: 1, success: 1, createdAt: -1 } },
      // TTL index to automatically delete old logs (90 days)
      { key: { createdAt: 1 }, expireAfterSeconds: 90 * 24 * 60 * 60 }
    ]);
    
    // Create SystemMetrics collection indexes
    adminLogger.info('Creating SystemMetrics collection indexes...');
    const systemMetricsCollection = db.collection('systemmetrics');
    
    await systemMetricsCollection.createIndexes([
      { key: { name: 1, createdAt: -1 } },
      { key: { type: 1, createdAt: -1 } },
      { key: { source: 1, createdAt: -1 } },
      { key: { isActive: 1, createdAt: -1 } },
      { key: { value: 1 } },
      { key: { 'tags.environment': 1, createdAt: -1 } },
      { key: { 'tags.service': 1, createdAt: -1 } },
      { key: { type: 1, source: 1, createdAt: -1 } },
      { key: { name: 1, source: 1, createdAt: -1 } },
      { key: { isActive: 1, type: 1, createdAt: -1 } },
      { key: { createdAt: 1 } } // For cleanup operations
    ]);
    
    // Create AdminSessions collection indexes
    adminLogger.info('Creating AdminSessions collection indexes...');
    const adminSessionsCollection = db.collection('adminsessions');
    
    await adminSessionsCollection.createIndexes([
      { key: { sessionToken: 1 }, unique: true },
      { key: { refreshToken: 1 }, unique: true },
      { key: { userId: 1, status: 1 } },
      { key: { status: 1, expiresAt: 1 } },
      { key: { lastActivity: -1 } },
      { key: { loginTime: -1 } },
      { key: { ipAddress: 1, loginTime: -1 } },
      { key: { userId: 1, createdAt: -1 } },
      // TTL index to automatically remove expired sessions
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 }
    ]);
    
    // Create EmailApprovals collection indexes
    adminLogger.info('Creating EmailApprovals collection indexes...');
    const emailApprovalsCollection = db.collection('emailapprovals');
    
    await emailApprovalsCollection.createIndexes([
      { key: { approvalToken: 1 }, unique: true },
      { key: { status: 1, createdAt: -1 } },
      { key: { type: 1, status: 1 } },
      { key: { requestedBy: 1, createdAt: -1 } },
      { key: { approvers: 1, status: 1 } },
      { key: { priority: 1, status: 1 } },
      { key: { expiresAt: 1 } },
      { key: { status: 1, priority: -1, createdAt: -1 } },
      // TTL index to automatically remove old completed approvals (90 days)
      { key: { completedAt: 1 }, expireAfterSeconds: 90 * 24 * 60 * 60 }
    ]);
    
    // Create initial super admin user if none exists
    adminLogger.info('Checking for initial super admin user...');
    const existingSuperAdmin = await superUsersCollection.findOne({
      permissions: 'super:admin'
    });
    
    if (!existingSuperAdmin) {
      adminLogger.info('Creating initial super admin user...');
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash(
        process.env.INITIAL_ADMIN_PASSWORD || 'admin123!',
        12
      );
      
      await superUsersCollection.insertOne({
        username: process.env.INITIAL_ADMIN_USERNAME || 'superadmin',
        email: process.env.INITIAL_ADMIN_EMAIL || 'admin@mafia-game.com',
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        permissions: ['super:admin'],
        status: 'approved',
        approvedAt: new Date(),
        lastLogin: null,
        loginAttempts: 0,
        refreshTokens: [],
        twoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      adminLogger.info('Initial super admin user created successfully');
    } else {
      adminLogger.info('Super admin user already exists, skipping creation');
    }
    
    // Create initial system metrics
    adminLogger.info('Creating initial system metrics...');
    const initialMetrics = [
      {
        name: 'system_startup',
        type: 'system:cpu_usage',
        description: 'System startup metric',
        unit: 'percentage',
        value: 0,
        tags: {
          environment: process.env.NODE_ENV || 'development',
          service: 'mafia-game-admin',
          component: 'system'
        },
        source: 'admin-migration',
        isActive: true,
        aggregationPeriod: 60,
        retentionPeriod: 30,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'admin_database_connections',
        type: 'database:connections',
        description: 'Admin database connection count',
        unit: 'count',
        value: 1,
        tags: {
          environment: process.env.NODE_ENV || 'development',
          service: 'mafia-game-admin',
          component: 'database'
        },
        source: 'admin-migration',
        isActive: true,
        aggregationPeriod: 60,
        retentionPeriod: 30,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    await systemMetricsCollection.insertMany(initialMetrics);
    
    // Log migration completion
    await adminLogsCollection.insertOne({
      level: 'info',
      action: 'system:maintenance',
      message: 'Admin collections setup migration completed successfully',
      details: {
        migration: '001_admin_collections_setup',
        collectionsCreated: [
          'superusers',
          'adminlogs',
          'systemmetrics',
          'adminsessions',
          'emailapprovals'
        ]
      },
      success: true,
      createdAt: new Date()
    });
    
    adminLogger.info('Admin collections setup migration completed successfully');
    
  } catch (error) {
    adminLogger.error('Admin collections setup migration failed', {
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
    adminLogger.info('Rolling back admin collections setup migration...');
    
    const connection = getAdminConnection();
    const db = connection.db;
    
    // Drop collections (be careful with this in production!)
    const collections = [
      'superusers',
      'adminlogs',
      'systemmetrics',
      'adminsessions',
      'emailapprovals'
    ];
    
    for (const collectionName of collections) {
      try {
        await db.collection(collectionName).drop();
        adminLogger.info(`Dropped collection: ${collectionName}`);
      } catch (error) {
        // Collection might not exist, which is fine
        adminLogger.warn(`Could not drop collection ${collectionName}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    adminLogger.info('Admin collections setup migration rollback completed');
    
  } catch (error) {
    adminLogger.error('Admin collections setup migration rollback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

export const migrationInfo = {
  version: '001',
  name: 'admin_collections_setup',
  description: 'Creates indexes and initial data for admin collections',
  createdAt: new Date('2024-01-01')
};