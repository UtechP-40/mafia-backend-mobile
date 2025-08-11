#!/usr/bin/env ts-node

/**
 * Admin Migration Runner Script (TypeScript)
 * This script runs the admin database migrations to set up initial collections and users
 */

import dotenv from 'dotenv';
import { connectAdminDatabase, closeAdminDatabase } from './src/admin/config/database';
import { runMigrations, getMigrationStatus } from './src/admin/migrations';
import { adminLogger } from './src/admin/config/logger';

// Load environment variables
dotenv.config();

async function runAdminMigrations(): Promise<void> {
  try {
    console.log('🚀 Starting admin database migration process...');
    
    // Connect to admin database
    console.log('📡 Connecting to admin database...');
    await connectAdminDatabase();
    console.log('✅ Connected to admin database successfully');
    
    // Check current migration status
    console.log('📊 Checking migration status...');
    const statusBefore = await getMigrationStatus();
    console.log(`Current status: ${statusBefore.appliedMigrations}/${statusBefore.totalMigrations} migrations applied`);
    
    if (statusBefore.pendingMigrations > 0) {
      console.log(`📋 Found ${statusBefore.pendingMigrations} pending migrations`);
      
      // Run migrations
      await runMigrations();
      
      // Check status after
      const statusAfter = await getMigrationStatus();
      console.log(`✅ Migration complete: ${statusAfter.appliedMigrations}/${statusAfter.totalMigrations} migrations applied`);
      
      // Show migration details
      console.log('\n📝 Migration Details:');
      statusAfter.migrations.forEach(migration => {
        const status = migration.status === 'applied' ? '✅' : '⏳';
        console.log(`  ${status} ${migration.version}: ${migration.name}`);
        if (migration.appliedAt) {
          console.log(`     Applied: ${migration.appliedAt.toISOString()}`);
        }
      });
    } else {
      console.log('✅ All migrations are already up to date');
    }
    
    console.log('\n🎉 Admin database initialization complete!');
    console.log('\n🔑 Default Admin Credentials:');
    console.log('   Username: superadmin');
    console.log('   Email: admin@mafia-game.com');
    console.log('   Password: admin123!');
    console.log('\n💡 You can now log into the admin portal at http://localhost:5173');
    
  } catch (error) {
    console.error('❌ Admin migration failed:', error);
    adminLogger.error('Admin migration script failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  } finally {
    // Close database connection
    await closeAdminDatabase();
    console.log('📡 Database connection closed');
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  runAdminMigrations()
    .then(() => {
      console.log('✅ Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

export { runAdminMigrations };