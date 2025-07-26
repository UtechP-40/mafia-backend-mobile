import mongoose from 'mongoose';
import { adminLogger } from './logger';

// Admin-specific database connection
let adminConnection: mongoose.Connection | null = null;

export async function connectAdminDatabase(): Promise<mongoose.Connection> {
  try {
    if (adminConnection && adminConnection.readyState === 1) {
      return adminConnection;
    }

    const adminDbUri = process.env.ADMIN_MONGODB_URI || 
                      process.env.MONGODB_URI?.replace('/mafia-game', '/mafia-game-admin') ||
                      'mongodb://localhost:27017/mafia-game-admin';

    adminLogger.info('Connecting to admin database', { uri: adminDbUri.replace(/\/\/.*@/, '//***:***@') });

    // Create separate connection for admin database
    adminConnection = mongoose.createConnection(adminDbUri, {
      maxPoolSize: parseInt(process.env.ADMIN_DB_MAX_POOL_SIZE || '5'),
      serverSelectionTimeoutMS: parseInt(process.env.ADMIN_DB_TIMEOUT || '5000'),
      socketTimeoutMS: parseInt(process.env.ADMIN_DB_SOCKET_TIMEOUT || '45000'),
      bufferCommands: false,
      bufferMaxEntries: 0,
    });

    adminConnection.on('connected', () => {
      adminLogger.info('Admin database connected successfully');
    });

    adminConnection.on('error', (error) => {
      adminLogger.error('Admin database connection error', {
        error: error.message,
        stack: error.stack
      });
    });

    adminConnection.on('disconnected', () => {
      adminLogger.warn('Admin database disconnected');
    });

    // Wait for connection to be established
    await new Promise<void>((resolve, reject) => {
      if (!adminConnection) {
        reject(new Error('Admin connection not initialized'));
        return;
      }

      adminConnection.once('open', resolve);
      adminConnection.once('error', reject);
    });

    return adminConnection;

  } catch (error) {
    adminLogger.error('Failed to connect to admin database', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

export function getAdminConnection(): mongoose.Connection {
  if (!adminConnection || adminConnection.readyState !== 1) {
    throw new Error('Admin database not connected');
  }
  return adminConnection;
}

export async function closeAdminDatabase(): Promise<void> {
  if (adminConnection) {
    await adminConnection.close();
    adminConnection = null;
    adminLogger.info('Admin database connection closed');
  }
}