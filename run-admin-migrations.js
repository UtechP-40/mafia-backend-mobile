#!/usr/bin/env node

/**
 * Admin Migration Runner Script
 * This script runs the admin database migrations to set up initial collections and users
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import the admin migration functions
async function runAdminMigrations() {
  try {
    console.log('🚀 Starting admin database migration process...');
    
    // Connect to admin database
    const adminMongoUri = process.env.ADMIN_MONGODB_URI;
    if (!adminMongoUri) {
      throw new Error('ADMIN_MONGODB_URI environment variable is not set');
    }
    
    console.log('📡 Connecting to admin database...');
    await mongoose.connect(adminMongoUri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log('✅ Connected to admin database successfully');
    
    // Import and run migrations
    const { runMigrations, getMigrationStatus } = require('./dist/admin/migrations/index.js');
    
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
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
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

module.exports = { runAdminMigrations };