import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from '../middleware/errorHandler';
import { authRoutes } from '../api/auth';
import { playerRoutes } from '../api/players';
import { roomRoutes } from '../api/rooms';
import { gameRoutes } from '../api/games';

let mongoServer: MongoMemoryServer;

export const connectDB = async (): Promise<void> => {
  // Only connect if not already connected
  if (mongoose.connection.readyState === 0) {
    // Start in-memory MongoDB instance
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    
    // Connect to the in-memory database
    await mongoose.connect(mongoUri);
  }
};

export const disconnectDB = async (): Promise<void> => {
  // Clean up and close connections
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
};

export const clearDB = async (): Promise<void> => {
  // Clean up collections after each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
};

// Global setup removed - each test file should handle its own setup

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

/**
 * Setup test Express app with all routes and middleware
 */
export const setupTestApp = async (): Promise<Express> => {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/players', playerRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/games', gameRoutes);

  // Error handling middleware (must be last)
  app.use(errorHandler);

  return app;
};

/**
 * Clean up test database
 */
export const cleanupTestDb = async (): Promise<void> => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
};