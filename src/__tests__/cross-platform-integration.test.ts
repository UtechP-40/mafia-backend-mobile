import request from 'supertest';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { Express } from 'express';
import { Client as SocketClient } from 'socket.io-client';
import { connectDB, disconnectDB, clearDB, setupTestApp } from './setup';
import { Player } from '../models/Player';
import { Room } from '../models/Room';
import { Game } from '../models/Game';
import { ChatMessage } from '../models/ChatMessage';
import { setupSocketServer } from '../services/SocketService';

describe('Cross-Platform Integration Tests', () => {
  let app: Express;
  let server: any;
  let io: Server;
  let clients: SocketClient[] = [];
  let authTokens: { [key: string]: string } = {};
  let users: { [key: string]: any } = {};

  beforeAll(async () => {
    await connectDB();
    app = await setupTestApp();
    server = createServer(app);
    io = setupSocketServer(server);
    
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
  });

  afterAll(async () => {
    clients.forEach(client => {
      if (client.connected) {
        client.disconnect();
      }
    });
    
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(resolve);
      });
    }
    
    await disconnectDB();
  });

  beforeEach(async () => {
    await clearDB();
    clients = [];
    authTokens = {};
    users = {};
  });

  afterEach(async () => {
    clients.forEach(client => {
      if (client.connected) {
        client.disconnect();
      }
    });
    clients = [];
  });

  const createAuthenticatedUser = async (username: string, email: string): Promise<string> => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username,
        email,
        password: 'TestPass123!',
        confirmPassword: 'TestPass123!'
      });

    expect(response.status).toBe(201);
    authTokens[username] = response.body.token;
    users[username] = response.body.user;
    return response.body.token;
  };

  const createSocketClient = (token: string): Promise<SocketClient> => {
    return new Promise((resolve, reject) => {
      const client = new SocketClient(`http://localhost:${server.address().port}`, {
        auth: { token },
        transports: ['websocket']
      });

      client.on('connect', () => {
        clients.push(client);
        resolve(client);
      });

      client.on('connect_error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  };

  describe('Frontend-Backend Authentication Flow', () => {
    it('should handle complete authentication workflow from mobile app perspective', async () => {
      // Simulate mobile app registration request
      const registrationData = {
        username: 'mobileuser',
        email: 'mobile@test.com',
        password: 'MobilePass123!',
        confirmPassword: 'MobilePass123!'
      };

      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send(registrationData)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)');

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.user).toBeTruthy();
      expect(registerResponse.body.token).toBeTruthy();
      expect(registerResponse.body.refreshToken).toBeTruthy();

      const token = registerResponse.body.token;
      const userId = registerResponse.body.user.id;

      // Simulate mobile app login
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'mobile@test.com',
          password: 'MobilePass123!'
        })
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)');

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.token).toBeTruthy();

      // Simulate mobile app accessing protected resource
      const profileResponse = await request(app)
        .get('/api/players/profile')
        .set('Authorization', `Bearer ${token}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)');

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.username).toBe('mobileuser');

      // Simulate token refresh
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: registerResponse.body.refreshToken })
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)');

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.token).toBeTruthy();

      // Verify user exists in database
      const dbUser = await Player.findById(userId);
      expect(dbUser).toBeTruthy();
      expect(dbUser!.username).toBe('mobileuser');
    });

    it('should handle biometric authentication flow', async () => {
      // Create user first
      const token = await createAuthenticatedUser('biouser', 'bio@test.com');

      // Simulate biometric authentication setup
      const biometricSetupResponse = await request(app)
        .post('/api/auth/biometric/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({
          biometricType: 'fingerprint',
          deviceId: 'iPhone-12-Pro-Max-ABC123'
        });

      expect(biometricSetupResponse.status).toBe(200);

      // Simulate biometric login
      const biometricLoginResponse = await request(app)
        .post('/api/auth/biometric/login')
        .send({
          deviceId: 'iPhone-12-Pro-Max-ABC123',
          biometricHash: 'mock-biometric-hash'
        });

      expect(biometricLoginResponse.status).toBe(200);
      expect(biometricLoginResponse.body.token).toBeTruthy();
    });
  });

  describe('Real-Time Game Synchronization Across Platforms', () => {
    it('should synchronize game state between iOS and Android clients', async () => {
      // Create users representing different platforms
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      // Create socket connections with platform identification
      const iosClient = await createSocketClient(iosToken);
      const androidClient = await createSocketClient(androidToken);

      // Set platform headers for identification
      iosClient.emit('set-platform', { platform: 'ios', version: '15.0', appVersion: '1.0.0' });
      androidClient.emit('set-platform', { platform: 'android', version: '12', appVersion: '1.0.0' });

      // Create room from iOS client
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${iosToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)')
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 4,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: true,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: [
                { name: 'villager', count: 2 },
                { name: 'mafia', count: 2 }
              ]
            }
          }
        });

      const roomId = roomResponse.body.id;

      // Track state synchronization
      const iosStateUpdates: any[] = [];
      const androidStateUpdates: any[] = [];

      iosClient.on('game-state-update', (state) => {
        iosStateUpdates.push({ platform: 'ios', state, timestamp: Date.now() });
      });

      androidClient.on('game-state-update', (state) => {
        androidStateUpdates.push({ platform: 'android', state, timestamp: Date.now() });
      });

      // Android client joins room
      androidClient.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Start game from iOS
      iosClient.emit('start-game');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Perform actions from both platforms
      iosClient.emit('player-action', {
        type: 'vote',
        targetId: users.androiduser.id,
        platform: 'ios'
      });

      androidClient.emit('player-action', {
        type: 'vote',
        targetId: users.iosuser.id,
        platform: 'android'
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify both platforms received synchronized updates
      expect(iosStateUpdates.length).toBeGreaterThan(0);
      expect(androidStateUpdates.length).toBeGreaterThan(0);

      // Verify state consistency across platforms
      const latestIosState = iosStateUpdates[iosStateUpdates.length - 1];
      const latestAndroidState = androidStateUpdates[androidStateUpdates.length - 1];

      expect(latestIosState.state.players.length).toBe(latestAndroidState.state.players.length);
      expect(latestIosState.state.votes.length).toBe(latestAndroidState.state.votes.length);
    });

    it('should handle platform-specific features gracefully', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      const iosClient = await createSocketClient(iosToken);
      const androidClient = await createSocketClient(androidToken);

      // Create room with voice chat enabled
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${iosToken}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 4,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: true,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;

      // Join room from both platforms
      androidClient.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Test iOS-specific voice chat features
      let iosVoiceSupported = false;
      let androidVoiceSupported = false;

      iosClient.on('voice-chat-capability', (data) => {
        iosVoiceSupported = data.supported;
      });

      androidClient.on('voice-chat-capability', (data) => {
        androidVoiceSupported = data.supported;
      });

      // Request voice chat capabilities
      iosClient.emit('check-voice-capability', { platform: 'ios' });
      androidClient.emit('check-voice-capability', { platform: 'android' });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Both platforms should support voice chat
      expect(iosVoiceSupported).toBe(true);
      expect(androidVoiceSupported).toBe(true);
    });
  });

  describe('Cross-Platform Friend System Integration', () => {
    it('should handle friend interactions across different platforms', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      // iOS user searches for Android user
      const searchResponse = await request(app)
        .get('/api/players/search?query=androiduser')
        .set('Authorization', `Bearer ${iosToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)');

      expect(searchResponse.status).toBe(200);
      expect(searchResponse.body.length).toBe(1);
      expect(searchResponse.body[0].username).toBe('androiduser');

      // iOS user sends friend request to Android user
      const friendRequestResponse = await request(app)
        .post('/api/players/friends/request')
        .set('Authorization', `Bearer ${iosToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)')
        .send({ targetUserId: users.androiduser.id });

      expect(friendRequestResponse.status).toBe(200);

      // Android user accepts friend request
      const acceptResponse = await request(app)
        .post('/api/players/friends/respond')
        .set('Authorization', `Bearer ${androidToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (Android 12)')
        .send({ 
          requestId: friendRequestResponse.body.id,
          action: 'accept'
        });

      expect(acceptResponse.status).toBe(200);

      // Verify cross-platform friendship
      const iosFriendsResponse = await request(app)
        .get('/api/players/friends')
        .set('Authorization', `Bearer ${iosToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)');

      const androidFriendsResponse = await request(app)
        .get('/api/players/friends')
        .set('Authorization', `Bearer ${androidToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (Android 12)');

      expect(iosFriendsResponse.body.friends.length).toBe(1);
      expect(androidFriendsResponse.body.friends.length).toBe(1);
      expect(iosFriendsResponse.body.friends[0].username).toBe('androiduser');
      expect(androidFriendsResponse.body.friends[0].username).toBe('iosuser');
    });

    it('should handle cross-platform game invitations', async () => {
      // Create friendship first
      const iosToken = await createAuthenticatedUser('ioshost', 'ioshost@test.com');
      const androidToken = await createAuthenticatedUser('androidguest', 'androidguest@test.com');

      // Create friendship
      const friendRequestResponse = await request(app)
        .post('/api/players/friends/request')
        .set('Authorization', `Bearer ${iosToken}`)
        .send({ targetUserId: users.androidguest.id });

      await request(app)
        .post('/api/players/friends/respond')
        .set('Authorization', `Bearer ${androidToken}`)
        .send({ 
          requestId: friendRequestResponse.body.id,
          action: 'accept'
        });

      // iOS user creates private room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${iosToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)')
        .send({
          settings: {
            isPublic: false,
            maxPlayers: 4,
            requireInvite: true,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: false,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;
      const roomCode = roomResponse.body.code;

      // iOS user invites Android friend
      const inviteResponse = await request(app)
        .post('/api/players/friends/invite')
        .set('Authorization', `Bearer ${iosToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (iOS 15.0)')
        .send({
          friendId: users.androidguest.id,
          roomId: roomId
        });

      expect(inviteResponse.status).toBe(200);

      // Android user joins using invitation
      const joinResponse = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${androidToken}`)
        .set('User-Agent', 'MafiaGame-Mobile/1.0.0 (Android 12)')
        .send({ code: roomCode });

      expect(joinResponse.status).toBe(200);

      // Verify cross-platform room membership
      const roomDetailsResponse = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${iosToken}`);

      expect(roomDetailsResponse.body.players.length).toBe(2);
      expect(roomDetailsResponse.body.players.some((p: any) => p.username === 'ioshost')).toBe(true);
      expect(roomDetailsResponse.body.players.some((p: any) => p.username === 'androidguest')).toBe(true);
    });
  });

  describe('Cross-Platform Chat and Communication', () => {
    it('should handle chat messages between different platforms', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      const iosClient = await createSocketClient(iosToken);
      const androidClient = await createSocketClient(androidToken);

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${iosToken}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 4,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: false,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;

      // Both clients join room
      androidClient.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Track messages received by each platform
      const iosMessages: any[] = [];
      const androidMessages: any[] = [];

      iosClient.on('chat-message', (message) => {
        iosMessages.push({ ...message, receivedBy: 'ios' });
      });

      androidClient.on('chat-message', (message) => {
        androidMessages.push({ ...message, receivedBy: 'android' });
      });

      // Send messages from both platforms
      iosClient.emit('chat-message', {
        content: 'Hello from iOS!',
        type: 'player_chat',
        platform: 'ios'
      });

      androidClient.emit('chat-message', {
        content: 'Hello from Android!',
        type: 'player_chat',
        platform: 'android'
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify cross-platform message delivery
      expect(iosMessages.length).toBe(2); // Should receive both messages
      expect(androidMessages.length).toBe(2); // Should receive both messages

      // Verify message content
      const iosToAndroidMsg = androidMessages.find(m => m.content === 'Hello from iOS!');
      const androidToIosMsg = iosMessages.find(m => m.content === 'Hello from Android!');

      expect(iosToAndroidMsg).toBeTruthy();
      expect(androidToIosMsg).toBeTruthy();

      // Verify messages are stored in database
      const dbMessages = await ChatMessage.find({ roomId });
      expect(dbMessages.length).toBe(2);
    });

    it('should handle platform-specific emoji and text formatting', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      const iosClient = await createSocketClient(iosToken);
      const androidClient = await createSocketClient(androidToken);

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${iosToken}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 4,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: false,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;
      androidClient.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      const receivedMessages: any[] = [];
      androidClient.on('chat-message', (message) => {
        receivedMessages.push(message);
      });

      // Send message with emojis and formatting from iOS
      iosClient.emit('chat-message', {
        content: '🎮 Let\'s play! 😄 **Good luck everyone!**',
        type: 'player_chat',
        platform: 'ios',
        formatting: {
          hasEmojis: true,
          hasMarkdown: true
        }
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify message was received and processed correctly
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].content).toContain('🎮');
      expect(receivedMessages[0].content).toContain('😄');
      expect(receivedMessages[0].content).toContain('**Good luck everyone!**');
    });
  });

  describe('Cross-Platform Performance and Optimization', () => {
    it('should handle different network conditions across platforms', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      const iosClient = await createSocketClient(iosToken);
      const androidClient = await createSocketClient(androidToken);

      // Simulate different connection qualities
      iosClient.emit('set-connection-quality', { 
        type: 'wifi',
        strength: 'excellent',
        latency: 20
      });

      androidClient.emit('set-connection-quality', { 
        type: 'cellular',
        strength: 'poor',
        latency: 200
      });

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${iosToken}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 4,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: true,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;
      androidClient.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Track optimization adjustments
      const optimizations: any[] = [];
      
      [iosClient, androidClient].forEach(client => {
        client.on('optimization-adjustment', (data) => {
          optimizations.push(data);
        });
      });

      // Start game to trigger optimizations
      iosClient.emit('start-game');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify server adjusted for different connection qualities
      expect(optimizations.length).toBeGreaterThan(0);
      
      // Android client with poor connection should receive optimizations
      const androidOptimization = optimizations.find(o => o.platform === 'android');
      expect(androidOptimization).toBeTruthy();
      expect(androidOptimization.adjustments).toContain('reduced_update_frequency');
    });

    it('should handle platform-specific memory constraints', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      // Simulate different device capabilities
      const iosCapabilities = {
        platform: 'ios',
        device: 'iPhone 13 Pro',
        memory: '6GB',
        processingPower: 'high'
      };

      const androidCapabilities = {
        platform: 'android',
        device: 'Budget Android',
        memory: '2GB',
        processingPower: 'low'
      };

      // Test API responses are optimized for device capabilities
      const iosGameHistoryResponse = await request(app)
        .get('/api/players/game-history?limit=50')
        .set('Authorization', `Bearer ${iosToken}`)
        .set('X-Device-Capabilities', JSON.stringify(iosCapabilities));

      const androidGameHistoryResponse = await request(app)
        .get('/api/players/game-history?limit=50')
        .set('Authorization', `Bearer ${androidToken}`)
        .set('X-Device-Capabilities', JSON.stringify(androidCapabilities));

      expect(iosGameHistoryResponse.status).toBe(200);
      expect(androidGameHistoryResponse.status).toBe(200);

      // iOS should get full data, Android should get optimized data
      expect(iosGameHistoryResponse.body.games.length).toBeGreaterThanOrEqual(
        androidGameHistoryResponse.body.games.length
      );

      // Android response should have reduced detail level
      if (androidGameHistoryResponse.body.games.length > 0) {
        const androidGame = androidGameHistoryResponse.body.games[0];
        const iosGame = iosGameHistoryResponse.body.games[0];
        
        // Android version should have fewer details
        expect(Object.keys(androidGame).length).toBeLessThanOrEqual(Object.keys(iosGame).length);
      }
    });
  });

  describe('Cross-Platform Error Handling and Recovery', () => {
    it('should handle platform-specific error scenarios', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      const iosClient = await createSocketClient(iosToken);
      const androidClient = await createSocketClient(androidToken);

      // Track platform-specific errors
      const iosErrors: any[] = [];
      const androidErrors: any[] = [];

      iosClient.on('error', (error) => {
        iosErrors.push({ platform: 'ios', error });
      });

      androidClient.on('error', (error) => {
        androidErrors.push({ platform: 'android', error });
      });

      // Simulate iOS-specific error (e.g., background app limitation)
      iosClient.emit('app-backgrounded');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate Android-specific error (e.g., memory pressure)
      androidClient.emit('memory-pressure', { level: 'critical' });
      await new Promise(resolve => setTimeout(resolve, 100));

      // Both platforms should handle their specific errors gracefully
      // No errors should be thrown that crash the connection
      expect(iosClient.connected).toBe(true);
      expect(androidClient.connected).toBe(true);
    });

    it('should handle cross-platform reconnection scenarios', async () => {
      const iosToken = await createAuthenticatedUser('iosuser', 'ios@test.com');
      const androidToken = await createAuthenticatedUser('androiduser', 'android@test.com');

      let iosClient = await createSocketClient(iosToken);
      const androidClient = await createSocketClient(androidToken);

      // Create room and join
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${iosToken}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 4,
            gameSettings: {
              maxPlayers: 4,
              enableVoiceChat: false,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;
      androidClient.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start game
      iosClient.emit('start-game');
      await new Promise(resolve => setTimeout(resolve, 200));

      // iOS client disconnects (simulate app backgrounding)
      iosClient.disconnect();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Android client should be notified of disconnection
      let playerDisconnected = false;
      androidClient.on('player-disconnected', () => {
        playerDisconnected = true;
      });

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(playerDisconnected).toBe(true);

      // iOS client reconnects
      iosClient = await createSocketClient(iosToken);
      iosClient.emit('rejoin-game', roomId);

      // Android client should be notified of reconnection
      let playerReconnected = false;
      androidClient.on('player-reconnected', () => {
        playerReconnected = true;
      });

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(playerReconnected).toBe(true);

      // Game state should be restored for iOS client
      let stateRestored = false;
      iosClient.on('game-state-restored', () => {
        stateRestored = true;
      });

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(stateRestored).toBe(true);
    });
  });
});