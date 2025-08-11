#!/usr/bin/env node

/**
 * Simple script to create an admin user
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

async function createAdminUser() {
  try {
    console.log('🚀 Creating admin user...');
    
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
    
    // Get the superusers collection
    const db = mongoose.connection.db;
    const superUsersCollection = db.collection('superusers');
    
    // Check if admin user already exists
    const existingAdmin = await superUsersCollection.findOne({
      $or: [
        { username: 'superadmin' },
        { email: 'admin@mafia-game.com' }
      ]
    });
    
    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      console.log('🔑 Admin Credentials:');
      console.log('   Username: superadmin');
      console.log('   Email: admin@mafia-game.com');
      console.log('   Password: admin123!');
      return;
    }
    
    // Create admin user
    console.log('👤 Creating admin user...');
    const hashedPassword = await bcrypt.hash('admin123!', 12);
    
    await superUsersCollection.insertOne({
      username: 'superadmin',
      email: 'admin@mafia-game.com',
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
    
    console.log('✅ Admin user created successfully!');
    console.log('🔑 Admin Credentials:');
    console.log('   Username: superadmin');
    console.log('   Email: admin@mafia-game.com');
    console.log('   Password: admin123!');
    console.log('💡 You can now log into the admin portal at http://localhost:5173');
    
  } catch (error) {
    console.error('❌ Failed to create admin user:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('📡 Database connection closed');
  }
}

// Run the script if this file is executed directly
if (require.main === module) {
  createAdminUser()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { createAdminUser };