import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { connectDatabase } from "./utils/database";
import { errorHandler } from "./middleware/errorHandler";
import {
  analyticsMiddleware,
  requestTrackingMiddleware,
  performanceTrackingMiddleware,
  errorTrackingMiddleware,
  sessionTrackingMiddleware,
} from "./middleware/analyticsMiddleware";
import {
  createRateLimit,
  sanitizeInput,
  securityHeaders,
  suspiciousActivityDetection,
  requestSizeLimit
} from "./middleware/securityMiddleware";
import { authRoutes } from "./api/auth";
import { playerRoutes } from "./api/players";
import { roomRoutes } from "./api/rooms";
import { gameRoutes } from "./api/games";
import matchmakingRoutes from "./api/matchmaking";
import aiRoutes from "./api/ai";
import analyticsRoutes from "./api/analytics";
import { gdprRoutes } from "./api/gdpr";
import { securityRoutes } from "./api/security";
import { SocketService } from "./services/SocketService";
import { analyticsService } from "./services/AnalyticsService";
import { AntiCheatService } from "./services/AntiCheatService";
import { GDPRService } from "./services/GDPRService";

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// Security middleware (applied first)
app.use(securityHeaders);
app.use(suspiciousActivityDetection);
app.use(requestSizeLimit(5 * 1024 * 1024)); // 5MB limit

// Enhanced helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS with enhanced security
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.FRONTEND_URL 
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Session-Token'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
  })
);

// Request logging with security context
app.use(morgan('combined', {
  skip: (req) => req.url === '/health'
}));

// Global rate limiting
app.use(createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 1000, // per IP
  keyGenerator: (req) => req.ip || 'unknown'
}));

// Body parsing with size limits
app.use(express.json({ 
  limit: "1mb",
  verify: (req, res, buf) => {
    // Store raw body for signature verification if needed
    (req as any).rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Input sanitization
app.use(sanitizeInput);

// Analytics middleware
app.use(analyticsMiddleware);
app.use(requestTrackingMiddleware);
app.use(performanceTrackingMiddleware);
app.use(sessionTrackingMiddleware);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/matchmaking", matchmakingRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/gdpr", gdprRoutes);
app.use("/api/security", securityRoutes);

// Initialize Socket.io service
const socketService = new SocketService(io);

// Set up session cleanup interval (every 5 minutes)
setInterval(() => {
  socketService.cleanupInactiveSessions(30); // 30 minute timeout
}, 5 * 60 * 1000);

// Set up analytics data cleanup interval (daily at 2 AM)
const scheduleAnalyticsCleanup = () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(2, 0, 0, 0); // 2 AM tomorrow

  const msUntilTomorrow = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    // Run cleanup and then schedule for every 24 hours
    analyticsService.cleanupOldData(90).catch((error) => {
      console.error("Analytics cleanup failed:", error);
    });

    setInterval(() => {
      analyticsService.cleanupOldData(90).catch((error) => {
        console.error("Analytics cleanup failed:", error);
      });
    }, 24 * 60 * 60 * 1000); // Every 24 hours
  }, msUntilTomorrow);
};

scheduleAnalyticsCleanup();

// Set up security cleanup intervals
setInterval(() => {
  AntiCheatService.cleanupOldData();
  GDPRService.cleanupExpiredRequests();
}, 60 * 60 * 1000); // Every hour

// Error handling middleware (must be last)
app.use(errorTrackingMiddleware);
app.use(errorHandler);

// Start server
async function startServer() {
  try {
    await connectDatabase();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export { app, server, io, socketService };
