import request from 'supertest';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as SocketIOClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import app from '../server';
import { connectAdminDatabase } from '../config/database';
import { SuperUser } from '../models/SuperUser';
import SocketMonitoringService from '../services/SocketMonitoringService';
import SocketLoadTestService from '../services/SocketLoadTestService';
import { SocketMetrics } from '../models/SocketMetrics';
import { SocketEvent } from '../models/SocketEvent';
import { GameRoomMetrics } from '../models/GameRoomMetrics';

describe('Socket Monitoring System', () => {
  let adminToken: string;
  let adminUser: any;
  let socketMonitoring: SocketMonitoringService;
  let loadTestService: SocketLoadTestService;
  let testServer: any;
  let testIo: Server;

  beforeAll(async () => {
    // Connect to test database
    await connectAdminDatabase();

    // Create test admin user
    adminUser = new SuperUser({
      username: 'test-admin',
      email: 'test@admin.com',
      password: 'hashedpassword',
      permissions: ['SYSTEM_MONITOR', 'ANALYTICS_READ', 'SYSTEM_ADMIN', 'SECURITY_MONITOR'],
      status: 'approved'
    });
    await adminUser.save();

    // Generate admin token
    adminToken = jwt.sign(
      { userId: adminUser._id, username: adminUser.username },
      process.env.ADMIN_JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );

    // Set up test Socket.IO server
    testServer = createServer();
    testIo = new Server(testServer, {
      cors: { origin: "*", methods: ["GET", "POST"] }
    });

    // Initialize monitoring services
    socketMonitoring = SocketMonitoringService.getInstance();
    loadTestService = SocketLoadTestService.getInstance();

    // Attach monitoring to test server
    socketMonitoring.attachToSocketServer(testIo);

    // Start test server
    await new Promise<void>((resolve) => {
      testServer.listen(3001, resolve);
    });
  });

  afterAll(async () => {
    // Clean up
    await SuperUser.deleteMany({});
    await SocketMetrics.deleteMany({});
    await SocketEvent.deleteMany({});
    await GameRoomMetrics.deleteMany({});
    
    socketMonitoring.shutdown();
    loadTestService.cleanup();
    
    testServer.close();
  });

  describe('Socket Monitoring Service', () => {
    test('should initialize correctly', () => {
      expect(socketMonitoring).toBeDefined();
      expect(socketMonitoring.getPerformanceMetrics()).toBeDefined();
      expect(socketMonitoring.getActiveConnections()).toEqual([]);
      expect(socketMonitoring.getActiveRooms()).toEqual([]);
    });

    test('should track socket connections', (done) => {
      const client = SocketIOClient('http://localhost:3001');
      
      client.on('connect', () => {
        setTimeout(() => {
          const connections = socketMonitoring.getActiveConnections();
          expect(connections.length).toBeGreaterThan(0);
          
          const connection = connections.find(c => c.socketId === client.id);
          expect(connection).toBeDefined();
          expect(connection?.connectedAt).toBeDefined();
          expect(connection?.namespace).toBe('/');
          
          client.disconnect();
          done();
        }, 100);
      });
    });

    test('should track socket events', (done) => {
      const client = SocketIOClient('http://localhost:3001');
      
      client.on('connect', () => {
        client.emit('test-event', { message: 'test' });
        
        setTimeout(() => {
          const recentEvents = socketMonitoring.getRecentEvents(10);
          expect(recentEvents.length).toBeGreaterThan(0);
          
          const testEvent = recentEvents.find(e => e.eventName === 'test-event');
          expect(testEvent).toBeDefined();
          
          client.disconnect();
          done();
        }, 100);
      });
    });

    test('should calculate performance metrics', () => {
      const metrics = socketMonitoring.getPerformanceMetrics();
      
      expect(metrics).toHaveProperty('totalConnections');
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('totalEvents');
      expect(metrics).toHaveProperty('averageLatency');
      expect(metrics).toHaveProperty('errorRate');
      expect(metrics).toHaveProperty('bandwidthUsage');
      expect(metrics).toHaveProperty('connectionsByTransport');
      expect(metrics).toHaveProperty('connectionsByNamespace');
    });
  });

  describe('Socket Monitoring API Endpoints', () => {
    test('GET /admin/api/socket-monitoring/connections should return active connections', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/connections')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('activeConnections');
      expect(response.body.data).toHaveProperty('metrics');
      expect(response.body.data).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.data.activeConnections)).toBe(true);
    });

    test('GET /admin/api/socket-monitoring/rooms should return active rooms', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/rooms')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('activeRooms');
      expect(response.body.data).toHaveProperty('summary');
      expect(Array.isArray(response.body.data.activeRooms)).toBe(true);
      expect(response.body.data.summary).toHaveProperty('totalActiveRooms');
      expect(response.body.data.summary).toHaveProperty('totalActivePlayers');
    });

    test('GET /admin/api/socket-monitoring/events should return socket events', async () => {
      // Create some test events first
      const testEvent = new SocketEvent({
        socketId: 'test-socket-1',
        playerId: 'test-player-1',
        eventName: 'test-event',
        direction: 'incoming',
        timestamp: new Date(),
        namespace: '/game'
      });
      await testEvent.save();

      const response = await request(app)
        .get('/admin/api/socket-monitoring/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ limit: 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('events');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.events)).toBe(true);
    });

    test('GET /admin/api/socket-monitoring/metrics should return performance metrics', async () => {
      // Create some test metrics
      const testMetrics = new SocketMetrics({
        timestamp: new Date(),
        totalConnections: 10,
        activeConnections: 5,
        totalRooms: 2,
        activeRooms: 1,
        totalEvents: 100,
        eventsPerSecond: 5,
        averageLatency: 50,
        errorRate: 1,
        bandwidthUsage: { incoming: 1000, outgoing: 800 },
        connectionsByTransport: { websocket: 4, polling: 1 },
        connectionsByNamespace: { '/game': 5 },
        geographicDistribution: { 'US': 3, 'UK': 2 }
      });
      await testMetrics.save();

      const response = await request(app)
        .get('/admin/api/socket-monitoring/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('current');
      expect(response.body.data).toHaveProperty('historical');
      expect(response.body.data).toHaveProperty('summary');
      expect(response.body.data).toHaveProperty('peakTimes');
    });

    test('GET /admin/api/socket-monitoring/security should return security alerts', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/security')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('alerts');
      expect(response.body.data).toHaveProperty('summary');
      expect(Array.isArray(response.body.data.alerts)).toBe(true);
      expect(response.body.data.summary).toHaveProperty('bySeverity');
      expect(response.body.data.summary).toHaveProperty('byType');
    });

    test('GET /admin/api/socket-monitoring/health should return system health', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('healthScore');
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data).toHaveProperty('metrics');
      expect(response.body.data).toHaveProperty('alerts');
      expect(response.body.data).toHaveProperty('recommendations');
      expect(Array.isArray(response.body.data.recommendations)).toBe(true);
    });

    test('POST /admin/api/socket-monitoring/broadcast should broadcast messages', async () => {
      const broadcastData = {
        target: 'all',
        event: 'test-broadcast',
        data: { message: 'Test broadcast message' },
        namespace: '/game'
      };

      const response = await request(app)
        .post('/admin/api/socket-monitoring/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(broadcastData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
    });

    test('GET /admin/api/socket-monitoring/geography should return geographic distribution', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/geography')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('distribution');
      expect(response.body.data).toHaveProperty('summary');
      expect(Array.isArray(response.body.data.distribution)).toBe(true);
    });
  });

  describe('Load Testing Service', () => {
    test('should initialize correctly', () => {
      expect(loadTestService).toBeDefined();
      expect(loadTestService.getActiveTests()).toEqual([]);
      expect(loadTestService.getAllTests()).toEqual([]);
    });

    test('POST /admin/api/socket-monitoring/load-test should start load test', async () => {
      const loadTestConfig = {
        connectionCount: 5,
        eventRate: 1,
        duration: 5, // Short duration for testing
        namespace: '/game',
        eventTypes: ['test-event'],
        payloadSize: 50
      };

      const response = await request(app)
        .post('/admin/api/socket-monitoring/load-test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(loadTestConfig)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.testId).toBeDefined();
      expect(response.body.config).toBeDefined();
      expect(response.body.estimatedCompletion).toBeDefined();

      // Wait a bit and check if test is running
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const activeTests = loadTestService.getActiveTests();
      expect(activeTests.length).toBeGreaterThan(0);
    });

    test('GET /admin/api/socket-monitoring/load-tests should return load tests', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/load-tests')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('tests');
      expect(response.body.data).toHaveProperty('summary');
      expect(Array.isArray(response.body.data.tests)).toBe(true);
    });

    test('POST /admin/api/socket-monitoring/stress-test should start stress test', async () => {
      const stressTestConfig = {
        connectionCount: 2,
        maxConnections: 6,
        incrementStep: 2,
        incrementInterval: 2, // Short interval for testing
        eventRate: 1,
        duration: 3, // Short duration for testing
        namespace: '/game'
      };

      const response = await request(app)
        .post('/admin/api/socket-monitoring/stress-test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(stressTestConfig)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.stressTestId).toBeDefined();
      expect(response.body.baseConfig).toBeDefined();
      expect(response.body.options).toBeDefined();
    });
  });

  describe('Socket Event Statistics', () => {
    test('GET /admin/api/socket-monitoring/events/statistics should return event statistics', async () => {
      // Create some test events for statistics
      const events = [
        {
          socketId: 'socket-1',
          playerId: 'player-1',
          eventName: 'chat-message',
          direction: 'incoming',
          timestamp: new Date(),
          namespace: '/game',
          roomId: 'room-1'
        },
        {
          socketId: 'socket-2',
          playerId: 'player-2',
          eventName: 'player-action',
          direction: 'outgoing',
          timestamp: new Date(),
          namespace: '/game',
          roomId: 'room-1'
        }
      ];

      await SocketEvent.insertMany(events);

      const response = await request(app)
        .get('/admin/api/socket-monitoring/events/statistics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('eventStatistics');
      expect(response.body.data).toHaveProperty('topActivePlayers');
      expect(response.body.data).toHaveProperty('roomActivity');
      expect(response.body.data).toHaveProperty('errorAnalysis');
    });

    test('GET /admin/api/socket-monitoring/events/realtime should return real-time events', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/events/realtime')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ limit: 20 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('events');
      expect(response.body.data).toHaveProperty('timestamp');
      expect(Array.isArray(response.body.data.events)).toBe(true);
    });
  });

  describe('Game Room Analytics', () => {
    test('GET /admin/api/socket-monitoring/rooms/analytics should return room analytics', async () => {
      // Create test room metrics
      const roomMetrics = new GameRoomMetrics({
        roomId: 'test-room-1',
        namespace: '/game',
        gameState: 'ended',
        playerCount: 5,
        maxPlayers: 8,
        isActive: false,
        totalMessages: 50,
        totalEvents: 200,
        averageLatency: 75,
        peakPlayerCount: 6,
        playerJoinEvents: 6,
        playerLeaveEvents: 1,
        disconnectionEvents: 2,
        reconnectionEvents: 1,
        errorEvents: 0,
        bandwidthUsage: { incoming: 5000, outgoing: 4000 },
        playerSessions: [],
        gameEvents: [],
        performanceMetrics: {
          averageResponseTime: 50,
          eventThroughput: 10,
          errorRate: 0,
          connectionStability: 95
        }
      });
      await roomMetrics.save();

      const response = await request(app)
        .get('/admin/api/socket-monitoring/rooms/analytics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('summary');
      expect(response.body.data).toHaveProperty('topPerformingRooms');
      expect(response.body.data).toHaveProperty('capacityAnalysis');
      expect(response.body.data).toHaveProperty('hourlyActivity');
    });
  });

  describe('Authentication and Authorization', () => {
    test('should require authentication for all endpoints', async () => {
      await request(app)
        .get('/admin/api/socket-monitoring/connections')
        .expect(401);
    });

    test('should require proper permissions for admin endpoints', async () => {
      // Create user with limited permissions
      const limitedUser = new SuperUser({
        username: 'limited-user',
        email: 'limited@admin.com',
        password: 'hashedpassword',
        permissions: [], // No permissions
        status: 'approved'
      });
      await limitedUser.save();

      const limitedToken = jwt.sign(
        { userId: limitedUser._id, username: limitedUser.username },
        process.env.ADMIN_JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      await request(app)
        .post('/admin/api/socket-monitoring/load-test')
        .set('Authorization', `Bearer ${limitedToken}`)
        .send({ connectionCount: 5 })
        .expect(403);

      await limitedUser.deleteOne();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid socket ID in debug endpoint', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/debug/invalid-socket-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Socket connection not found');
    });

    test('should handle invalid load test ID', async () => {
      const response = await request(app)
        .get('/admin/api/socket-monitoring/load-test/invalid-test-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Load test not found');
    });

    test('should handle invalid broadcast target', async () => {
      const response = await request(app)
        .post('/admin/api/socket-monitoring/broadcast')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          target: 'invalid-target',
          event: 'test',
          data: {}
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid target type');
    });
  });
});

describe('Socket Monitoring Models', () => {
  beforeAll(async () => {
    await connectAdminDatabase();
  });

  afterAll(async () => {
    await SocketMetrics.deleteMany({});
    await SocketEvent.deleteMany({});
    await GameRoomMetrics.deleteMany({});
  });

  describe('SocketMetrics Model', () => {
    test('should create and save socket metrics', async () => {
      const metrics = new SocketMetrics({
        timestamp: new Date(),
        totalConnections: 100,
        activeConnections: 50,
        totalRooms: 10,
        activeRooms: 5,
        totalEvents: 1000,
        eventsPerSecond: 10,
        averageLatency: 100,
        errorRate: 2,
        bandwidthUsage: { incoming: 10000, outgoing: 8000 },
        connectionsByTransport: { websocket: 45, polling: 5 },
        connectionsByNamespace: { '/game': 50 },
        geographicDistribution: { 'US': 30, 'UK': 20 }
      });

      const savedMetrics = await metrics.save();
      expect(savedMetrics._id).toBeDefined();
      expect(savedMetrics.totalConnections).toBe(100);
      expect(savedMetrics.getConnectionEfficiency()).toBe(50);
    });

    test('should get metrics summary', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const summary = await SocketMetrics.getMetricsSummary(startDate, endDate);
      expect(summary).toBeDefined();
      if (summary) {
        expect(summary).toHaveProperty('avgActiveConnections');
        expect(summary).toHaveProperty('maxActiveConnections');
        expect(summary).toHaveProperty('avgEventsPerSecond');
      }
    });
  });

  describe('SocketEvent Model', () => {
    test('should create and save socket events', async () => {
      const event = new SocketEvent({
        socketId: 'test-socket',
        playerId: 'test-player',
        eventName: 'test-event',
        eventData: { message: 'test' },
        direction: 'incoming',
        timestamp: new Date(),
        namespace: '/game',
        roomId: 'test-room'
      });

      const savedEvent = await event.save();
      expect(savedEvent._id).toBeDefined();
      expect(savedEvent.eventName).toBe('test-event');
      expect(savedEvent.isError()).toBe(false);
    });

    test('should get event statistics', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const stats = await SocketEvent.getEventStatistics(startDate, endDate);
      expect(Array.isArray(stats)).toBe(true);
    });

    test('should search events', async () => {
      const results = await SocketEvent.searchEvents('test', {}, 10);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('GameRoomMetrics Model', () => {
    test('should create and save game room metrics', async () => {
      const roomMetrics = new GameRoomMetrics({
        roomId: 'test-room',
        namespace: '/game',
        gameState: 'waiting',
        playerCount: 3,
        maxPlayers: 8,
        isActive: true,
        totalMessages: 0,
        totalEvents: 0,
        averageLatency: 0,
        peakPlayerCount: 3,
        playerJoinEvents: 3,
        playerLeaveEvents: 0,
        disconnectionEvents: 0,
        reconnectionEvents: 0,
        errorEvents: 0,
        bandwidthUsage: { incoming: 0, outgoing: 0 },
        playerSessions: [],
        gameEvents: [],
        performanceMetrics: {
          averageResponseTime: 0,
          eventThroughput: 0,
          errorRate: 0,
          connectionStability: 100
        }
      });

      const savedMetrics = await roomMetrics.save();
      expect(savedMetrics._id).toBeDefined();
      expect(savedMetrics.roomId).toBe('test-room');
      expect(savedMetrics.completionRate).toBe(0);
    });

    test('should add and end player sessions', async () => {
      const roomMetrics = new GameRoomMetrics({
        roomId: 'session-test-room',
        namespace: '/game',
        gameState: 'waiting',
        playerCount: 0,
        maxPlayers: 8,
        isActive: true,
        totalMessages: 0,
        totalEvents: 0,
        averageLatency: 0,
        peakPlayerCount: 0,
        playerJoinEvents: 0,
        playerLeaveEvents: 0,
        disconnectionEvents: 0,
        reconnectionEvents: 0,
        errorEvents: 0,
        bandwidthUsage: { incoming: 0, outgoing: 0 },
        playerSessions: [],
        gameEvents: [],
        performanceMetrics: {
          averageResponseTime: 0,
          eventThroughput: 0,
          errorRate: 0,
          connectionStability: 100
        }
      });

      // Add player session
      roomMetrics.addPlayerSession('player-1');
      expect(roomMetrics.playerSessions.length).toBe(1);
      expect(roomMetrics.playerCount).toBe(1);
      expect(roomMetrics.peakPlayerCount).toBe(1);

      // End player session
      roomMetrics.endPlayerSession('player-1');
      const session = roomMetrics.playerSessions[0];
      expect(session.leftAt).toBeDefined();
      expect(session.sessionDuration).toBeDefined();

      await roomMetrics.save();
    });

    test('should get room statistics summary', async () => {
      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const summary = await GameRoomMetrics.getRoomStatsSummary(startDate, endDate);
      expect(summary).toBeDefined();
      if (summary) {
        expect(summary).toHaveProperty('totalRooms');
        expect(summary).toHaveProperty('activeRooms');
        expect(summary).toHaveProperty('avgPlayerCount');
      }
    });
  });
});