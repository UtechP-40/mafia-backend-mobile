import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { adminLogger, adminSecurityLogger } from '../config/logger';
import { loggingService, LogFilter } from './LoggingService';
import { adminAnalyticsService } from './AnalyticsService';
import jwt from 'jsonwebtoken';
import { SuperUser } from '../models/SuperUser';

export interface WebSocketClient {
  id: string;
  userId: string;
  username: string;
  permissions: string[];
  connectedAt: Date;
  lastActivity: Date;
  subscriptions: Set<string>;
}

export interface LogStreamSubscription {
  clientId: string;
  filter: LogFilter;
  active: boolean;
  createdAt: Date;
}

export interface AnalyticsStreamSubscription {
  clientId: string;
  metrics: string[];
  interval: number;
  active: boolean;
  createdAt: Date;
}

export class AdminWebSocketService {
  private io: SocketIOServer;
  private clients = new Map<string, WebSocketClient>();
  private logSubscriptions = new Map<string, LogStreamSubscription>();
  private analyticsSubscriptions = new Map<string, AnalyticsStreamSubscription>();
  private logUnsubscribers = new Map<string, () => void>();

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      path: '/admin/socket.io',
      cors: {
        origin: process.env.ADMIN_FRONTEND_URL || 'http://localhost:3000',
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupSocketHandlers();
    this.setupCleanupInterval();
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', async (socket) => {
      try {
        // Authenticate the connection
        const token = socket.handshake.auth.token;
        if (!token) {
          socket.emit('error', { message: 'Authentication token required' });
          socket.disconnect();
          return;
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        const adminUser = await SuperUser.findById(decoded.id);
        
        if (!adminUser || adminUser.status !== 'active') {
          socket.emit('error', { message: 'Invalid or inactive admin user' });
          socket.disconnect();
          return;
        }

        // Create client record
        const client: WebSocketClient = {
          id: socket.id,
          userId: adminUser._id.toString(),
          username: adminUser.username,
          permissions: adminUser.permissions,
          connectedAt: new Date(),
          lastActivity: new Date(),
          subscriptions: new Set()
        };

        this.clients.set(socket.id, client);

        adminSecurityLogger.info('Admin WebSocket connection established', {
          clientId: socket.id,
          userId: adminUser._id,
          username: adminUser.username,
          ip: socket.handshake.address
        });

        socket.emit('connected', {
          clientId: socket.id,
          user: {
            id: adminUser._id,
            username: adminUser.username,
            permissions: adminUser.permissions
          }
        });

        // Set up event handlers
        this.setupClientHandlers(socket, client);

      } catch (error) {
        adminLogger.error('WebSocket authentication failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          socketId: socket.id
        });
        socket.emit('error', { message: 'Authentication failed' });
        socket.disconnect();
      }
    });
  }

  private setupClientHandlers(socket: any, client: WebSocketClient): void {
    // Update last activity on any message
    socket.use((packet: any, next: any) => {
      client.lastActivity = new Date();
      next();
    });

    // Subscribe to log stream
    socket.on('subscribe_logs', (data: { filter: LogFilter }) => {
      if (!this.hasPermission(client, 'ANALYTICS_READ')) {
        socket.emit('error', { message: 'Insufficient permissions for log streaming' });
        return;
      }

      try {
        const subscriptionId = `logs_${socket.id}_${Date.now()}`;
        
        // Create subscription
        const subscription: LogStreamSubscription = {
          clientId: socket.id,
          filter: data.filter,
          active: true,
          createdAt: new Date()
        };

        this.logSubscriptions.set(subscriptionId, subscription);
        client.subscriptions.add(subscriptionId);

        // Set up log streaming
        const unsubscribe = loggingService.streamLogs(data.filter, (logEntry) => {
          if (subscription.active) {
            socket.emit('log_entry', logEntry);
          }
        });

        this.logUnsubscribers.set(subscriptionId, unsubscribe);

        socket.emit('subscription_created', {
          subscriptionId,
          type: 'logs',
          filter: data.filter
        });

        adminLogger.info('Log stream subscription created', {
          clientId: socket.id,
          userId: client.userId,
          subscriptionId,
          filter: data.filter
        });

      } catch (error) {
        adminLogger.error('Failed to create log subscription', {
          error: error instanceof Error ? error.message : 'Unknown error',
          clientId: socket.id
        });
        socket.emit('error', { message: 'Failed to create log subscription' });
      }
    });

    // Unsubscribe from log stream
    socket.on('unsubscribe_logs', (data: { subscriptionId: string }) => {
      this.unsubscribeFromLogs(data.subscriptionId, client);
      socket.emit('unsubscribed', { subscriptionId: data.subscriptionId, type: 'logs' });
    });

    // Subscribe to analytics stream
    socket.on('subscribe_analytics', (data: { metrics: string[]; interval: number }) => {
      if (!this.hasPermission(client, 'ANALYTICS_READ')) {
        socket.emit('error', { message: 'Insufficient permissions for analytics streaming' });
        return;
      }

      try {
        const subscriptionId = `analytics_${socket.id}_${Date.now()}`;
        
        // Validate interval (minimum 5 seconds, maximum 5 minutes)
        const interval = Math.max(5000, Math.min(data.interval || 30000, 300000));

        const subscription: AnalyticsStreamSubscription = {
          clientId: socket.id,
          metrics: data.metrics,
          interval,
          active: true,
          createdAt: new Date()
        };

        this.analyticsSubscriptions.set(subscriptionId, subscription);
        client.subscriptions.add(subscriptionId);

        // Start streaming analytics
        this.startAnalyticsStream(subscriptionId, socket, subscription);

        socket.emit('subscription_created', {
          subscriptionId,
          type: 'analytics',
          metrics: data.metrics,
          interval
        });

        adminLogger.info('Analytics stream subscription created', {
          clientId: socket.id,
          userId: client.userId,
          subscriptionId,
          metrics: data.metrics,
          interval
        });

      } catch (error) {
        adminLogger.error('Failed to create analytics subscription', {
          error: error instanceof Error ? error.message : 'Unknown error',
          clientId: socket.id
        });
        socket.emit('error', { message: 'Failed to create analytics subscription' });
      }
    });

    // Unsubscribe from analytics stream
    socket.on('unsubscribe_analytics', (data: { subscriptionId: string }) => {
      this.unsubscribeFromAnalytics(data.subscriptionId, client);
      socket.emit('unsubscribed', { subscriptionId: data.subscriptionId, type: 'analytics' });
    });

    // Get real-time system metrics
    socket.on('get_system_metrics', () => {
      if (!this.hasPermission(client, 'SYSTEM_MONITOR')) {
        socket.emit('error', { message: 'Insufficient permissions for system metrics' });
        return;
      }

      const metrics = {
        timestamp: new Date(),
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage()
        },
        connections: {
          total: this.clients.size,
          active: Array.from(this.clients.values()).filter(c => 
            Date.now() - c.lastActivity.getTime() < 60000
          ).length
        },
        subscriptions: {
          logs: this.logSubscriptions.size,
          analytics: this.analyticsSubscriptions.size
        }
      };

      socket.emit('system_metrics', metrics);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleClientDisconnect(socket.id, reason);
    });

    // Handle errors
    socket.on('error', (error) => {
      adminLogger.error('WebSocket client error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        clientId: socket.id,
        userId: client.userId
      });
    });
  }

  private startAnalyticsStream(
    subscriptionId: string, 
    socket: any, 
    subscription: AnalyticsStreamSubscription
  ): void {
    const streamData = async () => {
      if (!subscription.active) return;

      try {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 60 * 60 * 1000); // Last hour

        const metrics = await adminAnalyticsService.getDashboardMetrics({
          startDate,
          endDate,
          granularity: 'hour'
        });

        // Filter metrics based on subscription
        const filteredMetrics: any = { timestamp: new Date() };
        for (const metric of subscription.metrics) {
          if (metrics[metric]) {
            filteredMetrics[metric] = metrics[metric];
          }
        }

        socket.emit('analytics_data', {
          subscriptionId,
          data: filteredMetrics
        });

      } catch (error) {
        adminLogger.error('Failed to stream analytics data', {
          error: error instanceof Error ? error.message : 'Unknown error',
          subscriptionId
        });
      }
    };

    // Initial data send
    streamData();

    // Set up interval
    const intervalId = setInterval(streamData, subscription.interval);

    // Store interval ID for cleanup
    (subscription as any).intervalId = intervalId;
  }

  private unsubscribeFromLogs(subscriptionId: string, client: WebSocketClient): void {
    const subscription = this.logSubscriptions.get(subscriptionId);
    if (subscription && subscription.clientId === client.id) {
      subscription.active = false;
      
      // Clean up unsubscriber
      const unsubscribe = this.logUnsubscribers.get(subscriptionId);
      if (unsubscribe) {
        unsubscribe();
        this.logUnsubscribers.delete(subscriptionId);
      }

      this.logSubscriptions.delete(subscriptionId);
      client.subscriptions.delete(subscriptionId);

      adminLogger.info('Log subscription removed', {
        subscriptionId,
        clientId: client.id,
        userId: client.userId
      });
    }
  }

  private unsubscribeFromAnalytics(subscriptionId: string, client: WebSocketClient): void {
    const subscription = this.analyticsSubscriptions.get(subscriptionId);
    if (subscription && subscription.clientId === client.id) {
      subscription.active = false;

      // Clear interval
      if ((subscription as any).intervalId) {
        clearInterval((subscription as any).intervalId);
      }

      this.analyticsSubscriptions.delete(subscriptionId);
      client.subscriptions.delete(subscriptionId);

      adminLogger.info('Analytics subscription removed', {
        subscriptionId,
        clientId: client.id,
        userId: client.userId
      });
    }
  }

  private handleClientDisconnect(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Clean up all subscriptions
    for (const subscriptionId of client.subscriptions) {
      if (subscriptionId.startsWith('logs_')) {
        this.unsubscribeFromLogs(subscriptionId, client);
      } else if (subscriptionId.startsWith('analytics_')) {
        this.unsubscribeFromAnalytics(subscriptionId, client);
      }
    }

    this.clients.delete(clientId);

    adminLogger.info('Admin WebSocket client disconnected', {
      clientId,
      userId: client.userId,
      username: client.username,
      reason,
      connectionDuration: Date.now() - client.connectedAt.getTime()
    });
  }

  private hasPermission(client: WebSocketClient, permission: string): boolean {
    return client.permissions.includes(permission) || client.permissions.includes('SUPER_ADMIN');
  }

  private setupCleanupInterval(): void {
    // Clean up inactive subscriptions every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      // Clean up old log subscriptions
      for (const [subscriptionId, subscription] of this.logSubscriptions.entries()) {
        if (now - subscription.createdAt.getTime() > maxAge || !subscription.active) {
          const client = this.clients.get(subscription.clientId);
          if (client) {
            this.unsubscribeFromLogs(subscriptionId, client);
          } else {
            this.logSubscriptions.delete(subscriptionId);
            const unsubscribe = this.logUnsubscribers.get(subscriptionId);
            if (unsubscribe) {
              unsubscribe();
              this.logUnsubscribers.delete(subscriptionId);
            }
          }
        }
      }

      // Clean up old analytics subscriptions
      for (const [subscriptionId, subscription] of this.analyticsSubscriptions.entries()) {
        if (now - subscription.createdAt.getTime() > maxAge || !subscription.active) {
          const client = this.clients.get(subscription.clientId);
          if (client) {
            this.unsubscribeFromAnalytics(subscriptionId, client);
          } else {
            if ((subscription as any).intervalId) {
              clearInterval((subscription as any).intervalId);
            }
            this.analyticsSubscriptions.delete(subscriptionId);
          }
        }
      }

    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Broadcast system alert to all connected admin clients
   */
  public broadcastSystemAlert(alert: {
    type: 'error' | 'warning' | 'info';
    title: string;
    message: string;
    data?: any;
  }): void {
    this.io.emit('system_alert', {
      ...alert,
      timestamp: new Date()
    });

    adminLogger.info('System alert broadcasted', {
      type: alert.type,
      title: alert.title,
      connectedClients: this.clients.size
    });
  }

  /**
   * Get connected clients information
   */
  public getConnectedClients(): WebSocketClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get subscription statistics
   */
  public getSubscriptionStats(): {
    totalClients: number;
    activeClients: number;
    logSubscriptions: number;
    analyticsSubscriptions: number;
  } {
    const now = Date.now();
    const activeClients = Array.from(this.clients.values()).filter(
      client => now - client.lastActivity.getTime() < 60000
    ).length;

    return {
      totalClients: this.clients.size,
      activeClients,
      logSubscriptions: this.logSubscriptions.size,
      analyticsSubscriptions: this.analyticsSubscriptions.size
    };
  }

  /**
   * Disconnect client by user ID
   */
  public disconnectUser(userId: string, reason: string = 'Admin action'): boolean {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.userId === userId) {
        const socket = this.io.sockets.sockets.get(clientId);
        if (socket) {
          socket.emit('force_disconnect', { reason });
          socket.disconnect(true);
          return true;
        }
      }
    }
    return false;
  }
}

export let adminWebSocketService: AdminWebSocketService;

export function initializeAdminWebSocket(server: HttpServer): AdminWebSocketService {
  adminWebSocketService = new AdminWebSocketService(server);
  return adminWebSocketService;
}