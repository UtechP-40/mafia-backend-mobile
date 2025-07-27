import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { connectAdminDatabase } from './config/database';
import { adminLogger } from './config/logger';
import { adminErrorHandler } from './middleware/errorHandler';
import { adminAuthMiddleware } from './middleware/auth';
import { AdminEmailService } from './services/AdminEmailService';
import { SchedulerService } from './services/SchedulerService';
import { initializeAdminWebSocket } from './services/WebSocketService';
import adminRoutes from './routes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.ADMIN_PORT || 4000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration for React frontend
app.use(cors({
  origin: process.env.ADMIN_FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Rate limiting for admin endpoints
const adminRateLimit = rateLimit({
  windowMs: parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS || '50'), // Lower limit for admin
  message: {
    error: 'Too many admin requests from this IP, please try again later.',
    retryAfter: Math.ceil(parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '900000') / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    adminLogger.warn('Admin rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method
    });
    res.status(429).json({
      error: 'Too many admin requests from this IP, please try again later.',
      retryAfter: Math.ceil(parseInt(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || '900000') / 1000)
    });
  }
});

app.use(adminRateLimit);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message: string) => {
      adminLogger.info(message.trim());
    }
  }
}));

// Health check endpoint (no auth required)
app.get('/admin/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'admin-portal',
    version: '1.0.0'
  });
});

// Admin routes (auth routes don't require authentication, others do)
app.use('/admin/api', adminRoutes);

// Error handling middleware (must be last)
app.use(adminErrorHandler);

// 404 handler
app.use((req, res) => {
  adminLogger.warn('Admin 404 - Route not found', {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip
  });
  res.status(404).json({
    error: 'Admin endpoint not found',
    path: req.originalUrl
  });
});

// Start server
async function startAdminServer() {
  try {
    // Connect to admin database
    await connectAdminDatabase();
    
    // Initialize email service
    AdminEmailService.initialize();
    
    // Initialize scheduler service
    SchedulerService.initialize();
    
    const server = app.listen(PORT, () => {
      adminLogger.info(`Admin portal server running on port ${PORT}`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
    });

    // Initialize WebSocket service
    const webSocketService = initializeAdminWebSocket(server);
    adminLogger.info('Admin WebSocket service initialized');

    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      adminLogger.info('SIGTERM received, shutting down admin server gracefully');
      AdminEmailService.shutdown();
      SchedulerService.shutdown();
      server.close(() => {
        adminLogger.info('Admin server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      adminLogger.info('SIGINT received, shutting down admin server gracefully');
      AdminEmailService.shutdown();
      SchedulerService.shutdown();
      server.close(() => {
        adminLogger.info('Admin server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    adminLogger.error('Failed to start admin server', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startAdminServer();
}

export default app;