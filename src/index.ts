import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDatabase } from './utils/database';
import { errorHandler } from './middleware/errorHandler';
import { 
  analyticsMiddleware, 
  requestTrackingMiddleware, 
  performanceTrackingMiddleware,
  errorTrackingMiddleware,
  sessionTrackingMiddleware 
} from './middleware/analyticsMiddleware';
import { authRoutes } from './api/auth';
import { playerRoutes } from './api/players';
import { roomRoutes } from './api/rooms';
import { gameRoutes } from './api/games';
import matchmakingRoutes from './api/matchmaking';
import aiRoutes from './api/ai';
import analyticsRoutes from './api/analytics';
import { SocketService } from './services/SocketService';
import { analyticsService } from './services/AnalyticsService';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));
app.use(morgan('combined'));
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
app.use('/api/matchmaking', matchmakingRoutes);
app.use('/api/ai', aiRoutes);

// Initialize Socket.io service
const socketService = new SocketService(io);

// Set up session cleanup interval (every 5 minutes)
setInterval(() => {
  socketService.cleanupInactiveSessions(30); // 30 minute timeout
}, 5 * 60 * 1000);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
async function startServer() {
  try {
    await connectDatabase();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export { app, server, io, socketService };