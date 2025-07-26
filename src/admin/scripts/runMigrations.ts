#!/usr/bin/env node

/**
 * Admin Database Migration Runner
 * 
 * This script runs admin database migrations.
 * 
 * Usage:
 *   npm run admin:migrate              - Run all pending migrations
 *   npm run admin:migrate:rollback     - Rollback last migration
 *   npm run admin:migrate:status       - Show migration status
 *   npm run admin:migrate:reset        - Reset all migrations (dangerous!)
 */

import dotenv from 'dotenv';
import { connectAdminDatabase, closeAdminDatabase } from '../config/database';
import { adminLogger } from '../config/logger';
import {
  runMigrations,
  rollbackLastMigration,
  rollbackToVersion,
  getMigrationStatus,
  resetMigrations
} from '../migrations';

// Load environment variables
dotenv.config();

async function main() {
  try {
    // Connect to admin database
    await connectAdminDatabase();
    adminLogger.info('Connected to admin database for migrations');
    
    const command = process.argv[2] || 'up';
    
    switch (command) {
      case 'up':
      case 'migrate':
        await runMigrations();
        break;
        
      case 'down':
      case 'rollback':
        await rollbackLastMigration();
        break;
        
      case 'rollback-to':
        const targetVersion = process.argv[3];
        if (!targetVersion) {
          throw new Error('Target version required for rollback-to command');
        }
        await rollbackToVersion(targetVersion);
        break;
        
      case 'status':
        const status = await getMigrationStatus();
        console.log('\n=== Admin Database Migration Status ===');
        console.log(`Total migrations: ${status.totalMigrations}`);
        console.log(`Applied migrations: ${status.appliedMigrations}`);
        console.log(`Pending migrations: ${status.pendingMigrations}`);
        console.log('\nMigration Details:');
        
        status.migrations.forEach(migration => {
          const statusIcon = migration.status === 'applied' ? '✅' : 
                           migration.status === 'rolled_back' ? '🔄' : '⏳';
          console.log(`${statusIcon} ${migration.version} - ${migration.name} (${migration.status})`);
          if (migration.appliedAt) {
            console.log(`    Applied: ${migration.appliedAt.toISOString()}`);
          }
          if (migration.rollbackAt) {
            console.log(`    Rolled back: ${migration.rollbackAt.toISOString()}`);
          }
        });
        console.log('');
        break;
        
      case 'reset':
        const confirmReset = process.argv[3];
        if (confirmReset !== '--confirm') {
          console.log('⚠️  WARNING: This will reset ALL admin database migrations!');
          console.log('This is a destructive operation that will drop all admin collections.');
          console.log('To confirm, run: npm run admin:migrate reset --confirm');
          process.exit(1);
        }
        await resetMigrations();
        break;
        
      default:
        console.log('Unknown command:', command);
        console.log('Available commands:');
        console.log('  up, migrate          - Run all pending migrations');
        console.log('  down, rollback       - Rollback last migration');
        console.log('  rollback-to <version> - Rollback to specific version');
        console.log('  status               - Show migration status');
        console.log('  reset --confirm      - Reset all migrations (dangerous!)');
        process.exit(1);
    }
    
  } catch (error) {
    adminLogger.error('Migration script failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('❌ Migration failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  } finally {
    // Close database connection
    await closeAdminDatabase();
    adminLogger.info('Closed admin database connection');
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  adminLogger.error('Unhandled Rejection at:', { promise, reason });
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  adminLogger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

// Run the main function
if (require.main === module) {
  main();
}