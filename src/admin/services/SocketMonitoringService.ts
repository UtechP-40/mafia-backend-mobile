import { Server as SocketIOServer } from 'socket.io';
import { EventEmitter } from 'events';
import { adminLogger } from '../config/logger';
import { SocketMetrics } from '../models/SocketMetrics';
import { SocketEvent } from '../models/SocketEvent';
import { GameRoomMetrics } from '../models/GameRoomMetrics';

interface ConnectionInfo {
  socketId: string;
  playerId?: string;
  connectedAt: Date;
  lastActivity: Date;
  ipAddress: string;
  userAgent: string;
  roomId?: string;
  namespace: string;
  transport: string;
  latency?: number;
  bytesReceived: number;
  bytesSent: number;
  eventsReceived: number;
  eventsSent: number;
  errors: number;
  disconnectedAt?: Date;
  disconnectReason?: string;
  geolocation?: {
    country?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface RoomInfo {
  roomId: string;
  namespace: string;
  createdAt: Date;
  playerCount: number;
  maxPlayers: number;
  hostId?: string;
  gameState?: string;
  isActive: boolean;
  lastActivity: Date;
  totalMessages: number;
  totalEvents: number;
  averageLatency: number;
  players: Map<string, ConnectionInfo>;
  gamePhase?: string;
  gameStartedAt?: Date;
  gameDuration?: number;
}

interface SocketPerformanceMetrics {
  totalConnections: number;
  activeConnections: number;
  totalRooms: number;
  activeRooms: number;
  totalEvents: number;
  eventsPerSecond: number;
  averageLatency: number;
  errorRate: number;
  bandwidthUsage: {
    incoming: number;
    outgoing: number;
  };
  connectionsByTransport: {
    websocket: number;
    polling: number;
  };
  connectionsByNamespace: Map<string, number>;
  geographicDistribution: Map<string, number>;
}

interface SecurityAlert {
  id: string;
  type: 'SUSPICIOUS_ACTIVITY' | 'RATE_LIMIT_EXCEEDED' | 'INVALID_TOKEN' | 'MULTIPLE_CONNECTIONS' | 'GEOGRAPHIC_ANOMALY';
  socketId: string;
  playerId?: string;
  ipAddress: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: Date;
  metadata?: any;
}

export class SocketMonitoringService extends EventEmitter {
  private static instance: SocketMonitoringService;
  private connections: Map<string, ConnectionInfo> = new Map();
  private rooms: Map<string, RoomInfo> = new Map();
  private eventHistory: SocketEvent[] = [];
  private performanceMetrics: SocketPerformanceMetrics;
  private securityAlerts: SecurityAlert[] = [];
  private metricsInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private eventBuffer: any[] = [];
  private maxEventHistory = 10000;
  private maxSecurityAlerts = 1000;

  private constructor() {
    super();
    this.performanceMetrics = this.initializeMetrics();
    this.startMetricsCollection();
    this.startCleanupTasks();
  }

  public static getInstance(): SocketMonitoringService {
    if (!SocketMonitoringService.instance) {
      SocketMonitoringService.instance = new SocketMonitoringService();
    }
    return SocketMonitoringService.instance;
  }

  private initializeMetrics(): SocketPerformanceMetrics {
    return {
      totalConnections: 0,
      activeConnections: 0,
      totalRooms: 0,
      activeRooms: 0,
      totalEvents: 0,
      eventsPerSecond: 0,
      averageLatency: 0,
      errorRate: 0,
      bandwidthUsage: {
        incoming: 0,
        outgoing: 0
      },
      connectionsByTransport: {
        websocket: 0,
        polling: 0
      },
      connectionsByNamespace: new Map(),
      geographicDistribution: new Map()
    };
  }

  public attachToSocketServer(io: SocketIOServer): void {
    adminLogger.info('Attaching socket monitoring to Socket.IO server');

    // Monitor all namespaces
    io.engine.on('connection_error', (err) => {
      this.handleConnectionError(err);
    });

    // Monitor each namespace
    const namespaces = [io.sockets, io.of('/game')];
    
    namespaces.forEach(namespace => {
      namespace.on('connection', (socket) => {
        this.handleConnection(socket, namespace.name);
      });
    });

    // Monitor server-level events
    io.engine.on('initial_headers', (headers, req) => {
      this.trackGeolocation(req);
    });
  }

  private handleConnection(socket: any, namespaceName: string): void {
    const connectionInfo: ConnectionInfo = {
      socketId: socket.id,
      playerId: socket.playerId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'] || 'Unknown',
      namespace: namespaceName,
      transport: socket.conn.transport.name,
      bytesReceived: 0,
      bytesSent: 0,
      eventsReceived: 0,
      eventsSent: 0,
      errors: 0
    };

    this.connections.set(socket.id, connectionInfo);
    this.performanceMetrics.totalConnections++;
    this.performanceMetrics.activeConnections++;

    // Update transport metrics
    if (connectionInfo.transport === 'websocket') {
      this.performanceMetrics.connectionsByTransport.websocket++;
    } else {
      this.performanceMetrics.connectionsByTransport.polling++;
    }

    // Update namespace metrics
    const namespaceCount = this.performanceMetrics.connectionsByNamespace.get(namespaceName) || 0;
    this.performanceMetrics.connectionsByNamespace.set(namespaceName, namespaceCount + 1);

    adminLogger.info('Socket connection established', {
      socketId: socket.id,
      playerId: socket.playerId,
      namespace: namespaceName,
      transport: connectionInfo.transport,
      ipAddress: connectionInfo.ipAddress
    });

    // Set up event monitoring
    this.setupSocketEventMonitoring(socket, connectionInfo);

    // Check for security issues
    this.performSecurityChecks(socket, connectionInfo);

    // Emit monitoring event
    this.emit('connection', connectionInfo);
  }

  private setupSocketEventMonitoring(socket: any, connectionInfo: ConnectionInfo): void {
    // Monitor all incoming events
    const originalOnevent = socket.onevent;
    socket.onevent = (packet: any) => {
      this.trackIncomingEvent(socket.id, packet, connectionInfo);
      return originalOnevent.call(socket, packet);
    };

    // Monitor outgoing events
    const originalEmit = socket.emit;
    socket.emit = (...args: any[]) => {
      this.trackOutgoingEvent(socket.id, args, connectionInfo);
      return originalEmit.apply(socket, args);
    };

    // Monitor room joins/leaves
    socket.on('join-room', (data: any) => {
      this.handleRoomJoin(socket.id, data.roomId, connectionInfo);
    });

    socket.on('leave-room', (data: any) => {
      this.handleRoomLeave(socket.id, data.roomId, connectionInfo);
    });

    // Monitor disconnection
    socket.on('disconnect', (reason: string) => {
      this.handleDisconnection(socket.id, reason, connectionInfo);
    });

    // Monitor errors
    socket.on('error', (error: any) => {
      this.handleSocketError(socket.id, error, connectionInfo);
    });

    // Set up latency monitoring
    this.setupLatencyMonitoring(socket, connectionInfo);
  }

  private setupLatencyMonitoring(socket: any, connectionInfo: ConnectionInfo): void {
    const pingInterval = setInterval(() => {
      const startTime = Date.now();
      socket.emit('ping', startTime, (responseTime: number) => {
        const latency = Date.now() - startTime;
        connectionInfo.latency = latency;
        this.updateAverageLatency(latency);
      });
    }, 30000); // Ping every 30 seconds

    socket.on('disconnect', () => {
      clearInterval(pingInterval);
    });
  }

  private trackIncomingEvent(socketId: string, packet: any, connectionInfo: ConnectionInfo): void {
    connectionInfo.eventsReceived++;
    connectionInfo.lastActivity = new Date();
    
    const eventData = {
      socketId,
      playerId: connectionInfo.playerId,
      eventName: packet.data[0],
      eventData: packet.data[1],
      direction: 'incoming' as const,
      timestamp: new Date(),
      namespace: connectionInfo.namespace,
      roomId: connectionInfo.roomId
    };

    this.recordEvent(eventData);
    this.performanceMetrics.totalEvents++;

    // Estimate bandwidth usage (rough approximation)
    const dataSize = JSON.stringify(packet.data).length;
    connectionInfo.bytesReceived += dataSize;
    this.performanceMetrics.bandwidthUsage.incoming += dataSize;
  }

  private trackOutgoingEvent(socketId: string, args: any[], connectionInfo: ConnectionInfo): void {
    connectionInfo.eventsSent++;
    
    const eventData = {
      socketId,
      playerId: connectionInfo.playerId,
      eventName: args[0],
      eventData: args[1],
      direction: 'outgoing' as const,
      timestamp: new Date(),
      namespace: connectionInfo.namespace,
      roomId: connectionInfo.roomId
    };

    this.recordEvent(eventData);
    this.performanceMetrics.totalEvents++;

    // Estimate bandwidth usage
    const dataSize = JSON.stringify(args).length;
    connectionInfo.bytesSent += dataSize;
    this.performanceMetrics.bandwidthUsage.outgoing += dataSize;
  }

  private handleRoomJoin(socketId: string, roomId: string, connectionInfo: ConnectionInfo): void {
    connectionInfo.roomId = roomId;
    
    let roomInfo = this.rooms.get(roomId);
    if (!roomInfo) {
      roomInfo = {
        roomId,
        namespace: connectionInfo.namespace,
        createdAt: new Date(),
        playerCount: 0,
        maxPlayers: 10, // Default, should be updated from actual room settings
        isActive: true,
        lastActivity: new Date(),
        totalMessages: 0,
        totalEvents: 0,
        averageLatency: 0,
        players: new Map()
      };
      this.rooms.set(roomId, roomInfo);
      this.performanceMetrics.totalRooms++;
      this.performanceMetrics.activeRooms++;
    }

    roomInfo.players.set(socketId, connectionInfo);
    roomInfo.playerCount = roomInfo.players.size;
    roomInfo.lastActivity = new Date();

    adminLogger.info('Player joined room', {
      socketId,
      playerId: connectionInfo.playerId,
      roomId,
      playerCount: roomInfo.playerCount
    });

    this.emit('room-join', { socketId, roomId, roomInfo });
  }

  private handleRoomLeave(socketId: string, roomId: string, connectionInfo: ConnectionInfo): void {
    connectionInfo.roomId = undefined;
    
    const roomInfo = this.rooms.get(roomId);
    if (roomInfo) {
      roomInfo.players.delete(socketId);
      roomInfo.playerCount = roomInfo.players.size;
      roomInfo.lastActivity = new Date();

      if (roomInfo.playerCount === 0) {
        roomInfo.isActive = false;
        this.performanceMetrics.activeRooms--;
      }
    }

    adminLogger.info('Player left room', {
      socketId,
      playerId: connectionInfo.playerId,
      roomId,
      playerCount: roomInfo?.playerCount || 0
    });

    this.emit('room-leave', { socketId, roomId, roomInfo });
  }

  private handleDisconnection(socketId: string, reason: string, connectionInfo: ConnectionInfo): void {
    connectionInfo.disconnectedAt = new Date();
    connectionInfo.disconnectReason = reason;

    this.performanceMetrics.activeConnections--;

    // Update transport metrics
    if (connectionInfo.transport === 'websocket') {
      this.performanceMetrics.connectionsByTransport.websocket--;
    } else {
      this.performanceMetrics.connectionsByTransport.polling--;
    }

    // Update namespace metrics
    const namespaceCount = this.performanceMetrics.connectionsByNamespace.get(connectionInfo.namespace) || 0;
    this.performanceMetrics.connectionsByNamespace.set(connectionInfo.namespace, Math.max(0, namespaceCount - 1));

    // Remove from room if in one
    if (connectionInfo.roomId) {
      this.handleRoomLeave(socketId, connectionInfo.roomId, connectionInfo);
    }

    adminLogger.info('Socket disconnected', {
      socketId,
      playerId: connectionInfo.playerId,
      reason,
      duration: connectionInfo.disconnectedAt.getTime() - connectionInfo.connectedAt.getTime()
    });

    this.emit('disconnection', { socketId, reason, connectionInfo });

    // Keep connection info for a while for analytics
    setTimeout(() => {
      this.connections.delete(socketId);
    }, 300000); // Keep for 5 minutes
  }

  private handleSocketError(socketId: string, error: any, connectionInfo: ConnectionInfo): void {
    connectionInfo.errors++;
    this.performanceMetrics.errorRate = this.calculateErrorRate();

    const errorInfo = {
      socketId,
      playerId: connectionInfo.playerId,
      error: error.message || error,
      timestamp: new Date(),
      namespace: connectionInfo.namespace,
      roomId: connectionInfo.roomId
    };

    adminLogger.error('Socket error occurred', errorInfo);
    this.emit('socket-error', errorInfo);

    // Check if this should trigger a security alert
    this.checkForSecurityAlert(socketId, 'SOCKET_ERROR', error, connectionInfo);
  }

  private handleConnectionError(error: any): void {
    adminLogger.error('Socket.IO connection error', {
      error: error.message || error,
      code: error.code,
      type: error.type,
      timestamp: new Date()
    });

    this.emit('connection-error', error);
  }

  private performSecurityChecks(socket: any, connectionInfo: ConnectionInfo): void {
    // Check for multiple connections from same IP
    const sameIPConnections = Array.from(this.connections.values())
      .filter(conn => conn.ipAddress === connectionInfo.ipAddress && conn.socketId !== connectionInfo.socketId);
    
    if (sameIPConnections.length > 5) {
      this.createSecurityAlert('MULTIPLE_CONNECTIONS', connectionInfo, 
        `Multiple connections (${sameIPConnections.length + 1}) from same IP`);
    }

    // Check for rapid reconnections
    const recentConnections = Array.from(this.connections.values())
      .filter(conn => 
        conn.ipAddress === connectionInfo.ipAddress && 
        Date.now() - conn.connectedAt.getTime() < 60000 // Last minute
      );

    if (recentConnections.length > 10) {
      this.createSecurityAlert('SUSPICIOUS_ACTIVITY', connectionInfo, 
        'Rapid reconnection pattern detected');
    }
  }

  private checkForSecurityAlert(socketId: string, type: string, data: any, connectionInfo: ConnectionInfo): void {
    // Implement various security checks based on the type and data
    // This is a placeholder for more sophisticated security analysis
  }

  private createSecurityAlert(type: SecurityAlert['type'], connectionInfo: ConnectionInfo, description: string, severity: SecurityAlert['severity'] = 'MEDIUM'): void {
    const alert: SecurityAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      socketId: connectionInfo.socketId,
      playerId: connectionInfo.playerId,
      ipAddress: connectionInfo.ipAddress,
      description,
      severity,
      timestamp: new Date(),
      metadata: {
        namespace: connectionInfo.namespace,
        roomId: connectionInfo.roomId,
        userAgent: connectionInfo.userAgent
      }
    };

    this.securityAlerts.unshift(alert);
    if (this.securityAlerts.length > this.maxSecurityAlerts) {
      this.securityAlerts = this.securityAlerts.slice(0, this.maxSecurityAlerts);
    }

    adminLogger.warn('Security alert created', alert);
    this.emit('security-alert', alert);
  }

  private recordEvent(eventData: any): void {
    const event = new SocketEvent(eventData);
    this.eventHistory.unshift(event);
    
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory = this.eventHistory.slice(0, this.maxEventHistory);
    }

    // Also buffer for batch processing
    this.eventBuffer.push(eventData);
  }

  private updateAverageLatency(latency: number): void {
    const activeConnections = Array.from(this.connections.values())
      .filter(conn => !conn.disconnectedAt && conn.latency);
    
    if (activeConnections.length > 0) {
      const totalLatency = activeConnections.reduce((sum, conn) => sum + (conn.latency || 0), 0);
      this.performanceMetrics.averageLatency = totalLatency / activeConnections.length;
    }
  }

  private calculateErrorRate(): number {
    const totalErrors = Array.from(this.connections.values())
      .reduce((sum, conn) => sum + conn.errors, 0);
    
    return this.performanceMetrics.totalEvents > 0 ? 
      (totalErrors / this.performanceMetrics.totalEvents) * 100 : 0;
  }

  private trackGeolocation(req: any): void {
    // This would integrate with a geolocation service
    // For now, just extract basic info from headers
    const country = req.headers['cf-ipcountry'] || req.headers['x-country-code'];
    if (country) {
      const currentCount = this.performanceMetrics.geographicDistribution.get(country) || 0;
      this.performanceMetrics.geographicDistribution.set(country, currentCount + 1);
    }
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.calculateEventsPerSecond();
      this.persistMetrics();
      this.processBatchedEvents();
    }, 10000); // Every 10 seconds
  }

  private calculateEventsPerSecond(): void {
    // This is a simplified calculation
    // In a real implementation, you'd track events over time windows
    this.performanceMetrics.eventsPerSecond = this.eventBuffer.length / 10;
  }

  private async persistMetrics(): Promise<void> {
    try {
      const metrics = new SocketMetrics({
        timestamp: new Date(),
        totalConnections: this.performanceMetrics.totalConnections,
        activeConnections: this.performanceMetrics.activeConnections,
        totalRooms: this.performanceMetrics.totalRooms,
        activeRooms: this.performanceMetrics.activeRooms,
        totalEvents: this.performanceMetrics.totalEvents,
        eventsPerSecond: this.performanceMetrics.eventsPerSecond,
        averageLatency: this.performanceMetrics.averageLatency,
        errorRate: this.performanceMetrics.errorRate,
        bandwidthUsage: this.performanceMetrics.bandwidthUsage,
        connectionsByTransport: this.performanceMetrics.connectionsByTransport,
        connectionsByNamespace: Object.fromEntries(this.performanceMetrics.connectionsByNamespace),
        geographicDistribution: Object.fromEntries(this.performanceMetrics.geographicDistribution)
      });

      await metrics.save();
    } catch (error) {
      adminLogger.error('Failed to persist socket metrics', error);
    }
  }

  private async processBatchedEvents(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    try {
      // Process events in batches for better performance
      const batchSize = 100;
      const batches = [];
      
      for (let i = 0; i < this.eventBuffer.length; i += batchSize) {
        batches.push(this.eventBuffer.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        await SocketEvent.insertMany(batch);
      }

      this.eventBuffer = [];
    } catch (error) {
      adminLogger.error('Failed to process batched events', error);
    }
  }

  private startCleanupTasks(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 3600000); // Every hour
  }

  private async cleanupOldData(): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      
      // Clean up old socket events
      await SocketEvent.deleteMany({ timestamp: { $lt: cutoffDate } });
      
      // Clean up old metrics
      await SocketMetrics.deleteMany({ timestamp: { $lt: cutoffDate } });
      
      // Clean up old security alerts
      this.securityAlerts = this.securityAlerts.filter(
        alert => Date.now() - alert.timestamp.getTime() < 7 * 24 * 60 * 60 * 1000
      );

      adminLogger.info('Socket monitoring data cleanup completed');
    } catch (error) {
      adminLogger.error('Failed to cleanup old socket data', error);
    }
  }

  // Public API methods
  public getActiveConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values())
      .filter(conn => !conn.disconnectedAt);
  }

  public getActiveRooms(): RoomInfo[] {
    return Array.from(this.rooms.values())
      .filter(room => room.isActive);
  }

  public getConnectionById(socketId: string): ConnectionInfo | undefined {
    return this.connections.get(socketId);
  }

  public getRoomById(roomId: string): RoomInfo | undefined {
    return this.rooms.get(roomId);
  }

  public getPerformanceMetrics(): SocketPerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  public getRecentEvents(limit: number = 100): SocketEvent[] {
    return this.eventHistory.slice(0, limit);
  }

  public getSecurityAlerts(limit: number = 50): SecurityAlert[] {
    return this.securityAlerts.slice(0, limit);
  }

  public async getHistoricalMetrics(startDate: Date, endDate: Date): Promise<any[]> {
    try {
      return await SocketMetrics.find({
        timestamp: { $gte: startDate, $lte: endDate }
      }).sort({ timestamp: 1 });
    } catch (error) {
      adminLogger.error('Failed to fetch historical metrics', error);
      return [];
    }
  }

  public async getEventHistory(filters: any = {}, limit: number = 1000): Promise<any[]> {
    try {
      return await SocketEvent.find(filters)
        .sort({ timestamp: -1 })
        .limit(limit);
    } catch (error) {
      adminLogger.error('Failed to fetch event history', error);
      return [];
    }
  }

  public disconnectSocket(socketId: string, reason: string = 'Admin disconnect'): boolean {
    const connection = this.connections.get(socketId);
    if (connection) {
      // This would need access to the actual socket instance
      // For now, just mark as disconnected
      this.handleDisconnection(socketId, reason, connection);
      return true;
    }
    return false;
  }

  public broadcastToRoom(roomId: string, event: string, data: any): boolean {
    const room = this.rooms.get(roomId);
    if (room && room.isActive) {
      // This would need access to the actual Socket.IO server
      // Implementation would depend on how this service is integrated
      adminLogger.info('Broadcasting to room', { roomId, event, playerCount: room.playerCount });
      return true;
    }
    return false;
  }

  public shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    adminLogger.info('Socket monitoring service shutdown');
  }
}

export default SocketMonitoringService;