import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { SocketService } from '../services/SocketService';
import { Player } from '../models/Player';
import { Room } from '../models/Room';
import { ChatMessage } from '../models/ChatMessage';
import { connectDatabase, disconnectDatabase } from '../utils/database';

// Type definitions for test data
interface TestData {
  room?: any;
  roomState?: any;
  player?: any;
  playerId?: string;
  isReady?: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
  audioLevel?: number;
  timestamp?: number;
  message?: string;
  content?: string;
  playerName?: string;
  type?: string;
  settings?: any;
  roomId?: string;
}

describe('SocketService', () => {
  let httpServer: any;
  let io: Server;
  let socketService: SocketService;
  let clientSocket: ClientSocket;
  let testPlayer: any;
  let testRoom: any;
  let authToken: string;

  beforeAll(async () => {
    await connectDatabase();
    
    // Create HTTP server and Socket.io instance
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    // Initialize SocketService
    socketService = new SocketService(io);
    
    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });
  });

  beforeEach(async () => {
    // Clean up database
    await Player.deleteMany({});
    await Room.deleteMany({});
    await ChatMessage.deleteMany({});
    
    // Create test player
    testPlayer = new Player({
      username: 'testplayer',
      email: 'test@example.com',
      passwordHash: 'hashedpassword',
      statistics: {
        gamesPlayed: 0,
        gamesWon: 0,
        winRate: 0,
        favoriteRole: 'villager',
        averageGameDuration: 0,
        eloRating: 1000
      }
    });
    await testPlayer.save();
    
    // Create test room
    testRoom = new Room({
      code: 'TEST123',
      hostId: testPlayer._id,
      players: [testPlayer],
      settings: {
        isPublic: true,
        maxPlayers: 8,
        gameSettings: {
          maxPlayers: 8,
          enableVoiceChat: true,
          dayPhaseDuration: 300,
          nightPhaseDuration: 180,
          votingDuration: 60,
          roles: []
        },
        allowSpectators: false,
        requireInvite: false
      },
      status: 'waiting'
    });
    await testRoom.save();
    
    // Generate auth token
    authToken = jwt.sign(
      { playerId: testPlayer._id },
      process.env.JWT_SECRET || 'test-secret'
    );
  });

  afterEach(() => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
    io.close();
    httpServer.close();
  });

  const connectClient = (token: string = authToken): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const port = httpServer.address()?.port;
      const client = Client(`http://localhost:${port}/game`, {
        auth: { token }
      });
      
      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);
      
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  };

  describe('Authentication', () => {
    it('should authenticate valid token', async () => {
      clientSocket = await connectClient();
      expect(clientSocket.connected).toBe(true);
    });

    it('should reject invalid token', async () => {
      await expect(connectClient('invalid-token')).rejects.toThrow();
    });

    it('should reject missing token', async () => {
      await expect(connectClient('')).rejects.toThrow();
    });

    it('should reject token for non-existent player', async () => {
      const fakeToken = jwt.sign(
        { playerId: '507f1f77bcf86cd799439011' },
        process.env.JWT_SECRET || 'test-secret'
      );
      await expect(connectClient(fakeToken)).rejects.toThrow();
    });
  });

  describe('Room Management', () => {
    beforeEach(async () => {
      clientSocket = await connectClient();
    });

    it('should allow player to join room', (done) => {
      clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
      
      clientSocket.on('room-joined', (data: TestData) => {
        expect(data.room).toBeDefined();
        expect(data.roomState).toBeDefined();
        expect(data.roomState.players).toHaveLength(1);
        done();
      });
    });

    it('should broadcast when player joins room', (done) => {
      // Connect second client
      const secondToken = jwt.sign(
        { playerId: testPlayer._id },
        process.env.JWT_SECRET || 'test-secret'
      );
      
      connectClient(secondToken).then((secondClient) => {
        // First client joins room
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        
        clientSocket.on('room-joined', () => {
          // Second client joins same room
          secondClient.emit('join-room', { roomId: testRoom._id.toString() });
        });
        
        // First client should receive notification
        clientSocket.on('player-joined', (data) => {
          expect(data.player).toBeDefined();
          expect(data.roomState).toBeDefined();
          secondClient.disconnect();
          done();
        });
      });
    });

    it('should prevent joining non-existent room', (done) => {
      clientSocket.emit('join-room', { roomId: '507f1f77bcf86cd799439011' });
      
      clientSocket.on('error', (error) => {
        expect(error.message).toBe('Room not found');
        done();
      });
    });

    it('should allow player to leave room', (done) => {
      clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
      
      clientSocket.on('room-joined', () => {
        clientSocket.emit('leave-room', { roomId: testRoom._id.toString() });
      });
      
      clientSocket.on('room-left', (data) => {
        expect(data.roomId).toBe(testRoom._id.toString());
        done();
      });
    });

    it('should broadcast when player leaves room', (done) => {
      const secondToken = jwt.sign(
        { playerId: testPlayer._id },
        process.env.JWT_SECRET || 'test-secret'
      );
      
      connectClient(secondToken).then((secondClient) => {
        // Both clients join room
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        
        clientSocket.on('room-joined', () => {
          secondClient.emit('join-room', { roomId: testRoom._id.toString() });
        });
        
        secondClient.on('room-joined', () => {
          // First client leaves
          clientSocket.emit('leave-room', { roomId: testRoom._id.toString() });
        });
        
        // Second client should receive notification
        secondClient.on('player-left', (data) => {
          expect(data.playerId).toBe(testPlayer._id.toString());
          expect(data.roomState).toBeDefined();
          secondClient.disconnect();
          done();
        });
      });
    });
  });

  describe('Chat Messaging', () => {
    beforeEach(async () => {
      clientSocket = await connectClient();
      // Join room first
      await new Promise<void>((resolve) => {
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        clientSocket.on('room-joined', () => resolve());
      });
    });

    it('should send and receive chat messages', (done) => {
      const message = 'Hello, world!';
      
      clientSocket.emit('chat-message', { content: message });
      
      clientSocket.on('chat-message', (data) => {
        expect(data.content).toBe(message);
        expect(data.playerId).toBe(testPlayer._id.toString());
        expect(data.playerName).toBe(testPlayer.username);
        expect(data.type).toBe('player_chat');
        expect(data.timestamp).toBeDefined();
        done();
      });
    });

    it('should save chat messages to database', async () => {
      const message = 'Test message';
      
      await new Promise<void>((resolve) => {
        clientSocket.emit('chat-message', { content: message });
        clientSocket.on('chat-message', () => resolve());
      });
      
      const savedMessage = await ChatMessage.findOne({ content: message });
      expect(savedMessage).toBeTruthy();
      expect(savedMessage!.playerId.toString()).toBe(testPlayer._id.toString());
      expect(savedMessage!.roomId.toString()).toBe(testRoom._id.toString());
    });

    it('should prevent chat when not in room', (done) => {
      // Disconnect and reconnect without joining room
      clientSocket.disconnect();
      
      connectClient().then((newClient) => {
        newClient.emit('chat-message', { content: 'Should fail' });
        
        newClient.on('error', (error) => {
          expect(error.message).toBe('Not in a room');
          newClient.disconnect();
          done();
        });
      });
    });
  });

  describe('Ready State Management', () => {
    beforeEach(async () => {
      clientSocket = await connectClient();
      // Join room first
      await new Promise<void>((resolve) => {
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        clientSocket.on('room-joined', () => resolve());
      });
    });

    it('should update and broadcast ready state', (done) => {
      const secondToken = jwt.sign(
        { playerId: testPlayer._id },
        process.env.JWT_SECRET || 'test-secret'
      );
      
      connectClient(secondToken).then((secondClient) => {
        secondClient.emit('join-room', { roomId: testRoom._id.toString() });
        
        secondClient.on('room-joined', () => {
          clientSocket.emit('ready-state-change', { isReady: true });
        });
        
        secondClient.on('player-ready-state-changed', (data) => {
          expect(data.playerId).toBe(testPlayer._id.toString());
          expect(data.isReady).toBe(true);
          secondClient.disconnect();
          done();
        });
      });
    });
  });

  describe('Voice Chat Events', () => {
    beforeEach(async () => {
      clientSocket = await connectClient();
      // Join room first
      await new Promise<void>((resolve) => {
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        clientSocket.on('room-joined', () => resolve());
      });
    });

    it('should broadcast voice state changes', (done) => {
      const secondToken = jwt.sign(
        { playerId: testPlayer._id },
        process.env.JWT_SECRET || 'test-secret'
      );
      
      connectClient(secondToken).then((secondClient) => {
        secondClient.emit('join-room', { roomId: testRoom._id.toString() });
        
        secondClient.on('room-joined', () => {
          clientSocket.emit('voice-state-change', {
            isMuted: false,
            isSpeaking: true,
            audioLevel: 0.8
          });
        });
        
        secondClient.on('voice-state-changed', (data) => {
          expect(data.playerId).toBe(testPlayer._id.toString());
          expect(data.isMuted).toBe(false);
          expect(data.isSpeaking).toBe(true);
          expect(data.audioLevel).toBe(0.8);
          secondClient.disconnect();
          done();
        });
      });
    });
  });

  describe('Connection Management', () => {
    beforeEach(async () => {
      clientSocket = await connectClient();
    });

    it('should respond to ping with pong', (done) => {
      clientSocket.emit('ping');
      
      clientSocket.on('pong', (data) => {
        expect(data.timestamp).toBeDefined();
        expect(typeof data.timestamp).toBe('number');
        done();
      });
    });

    it('should track player sessions', () => {
      const session = socketService.getPlayerSession(testPlayer._id.toString());
      expect(session).toBeDefined();
      expect(session!.playerId).toBe(testPlayer._id.toString());
      expect(session!.socketId).toBe(clientSocket.id);
    });

    it('should detect player connection status', () => {
      expect(socketService.isPlayerConnected(testPlayer._id.toString())).toBe(true);
      
      clientSocket.disconnect();
      
      // Give some time for disconnection to process
      setTimeout(() => {
        expect(socketService.isPlayerConnected(testPlayer._id.toString())).toBe(false);
      }, 100);
    });

    it('should broadcast disconnection to room', (done) => {
      const secondToken = jwt.sign(
        { playerId: testPlayer._id },
        process.env.JWT_SECRET || 'test-secret'
      );
      
      connectClient(secondToken).then((secondClient) => {
        // Both join room
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        
        clientSocket.on('room-joined', () => {
          secondClient.emit('join-room', { roomId: testRoom._id.toString() });
        });
        
        secondClient.on('room-joined', () => {
          // First client disconnects
          clientSocket.disconnect();
        });
        
        secondClient.on('player-disconnected', (data) => {
          expect(data.playerId).toBe(testPlayer._id.toString());
          expect(data.timestamp).toBeDefined();
          secondClient.disconnect();
          done();
        });
      });
    });
  });

  describe('Room Settings Management', () => {
    beforeEach(async () => {
      clientSocket = await connectClient();
      // Join room as host
      await new Promise<void>((resolve) => {
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        clientSocket.on('room-joined', () => resolve());
      });
    });

    it('should allow host to update room settings', (done) => {
      const newSettings = {
        maxPlayers: 6,
        enableVoiceChat: false
      };
      
      clientSocket.emit('room-settings-update', { settings: newSettings });
      
      clientSocket.on('room-settings-updated', (data) => {
        expect(data.settings.maxPlayers).toBe(6);
        expect(data.settings.enableVoiceChat).toBe(false);
        done();
      });
    });

    it('should prevent non-host from updating settings', async () => {
      // Create another player
      const otherPlayer = new Player({
        username: 'otherplayer',
        email: 'other@example.com',
        passwordHash: 'hashedpassword',
        statistics: {
          gamesPlayed: 0,
          gamesWon: 0,
          winRate: 0,
          favoriteRole: 'villager',
          averageGameDuration: 0,
          eloRating: 1000
        }
      });
      await otherPlayer.save();
      
      const otherToken = jwt.sign(
        { playerId: otherPlayer._id },
        process.env.JWT_SECRET || 'test-secret'
      );
      
      const otherClient = await connectClient(otherToken);
      
      await new Promise<void>((resolve) => {
        otherClient.emit('join-room', { roomId: testRoom._id.toString() });
        otherClient.on('room-joined', () => resolve());
      });
      
      await new Promise<void>((resolve) => {
        otherClient.emit('room-settings-update', { settings: { maxPlayers: 4 } });
        
        otherClient.on('error', (error) => {
          expect(error.message).toBe('Only host can update room settings');
          otherClient.disconnect();
          resolve();
        });
      });
    });
  });

  describe('Session Cleanup', () => {
    it('should clean up inactive sessions', async () => {
      clientSocket = await connectClient();
      
      const playerId = testPlayer._id.toString();
      expect(socketService.isPlayerConnected(playerId)).toBe(true);
      
      // Manually set last activity to old time
      const session = socketService.getPlayerSession(playerId);
      if (session) {
        session.lastActivity = new Date(Date.now() - 35 * 60 * 1000); // 35 minutes ago
      }
      
      // Run cleanup
      socketService.cleanupInactiveSessions(30);
      
      expect(socketService.isPlayerConnected(playerId)).toBe(false);
    });
  });

  describe('Public Methods', () => {
    beforeEach(async () => {
      clientSocket = await connectClient();
      await new Promise<void>((resolve) => {
        clientSocket.emit('join-room', { roomId: testRoom._id.toString() });
        clientSocket.on('room-joined', () => resolve());
      });
    });

    it('should broadcast to room', (done) => {
      socketService.broadcastToRoom(testRoom._id.toString(), 'test-event', { message: 'test' });
      
      clientSocket.on('test-event', (data) => {
        expect(data.message).toBe('test');
        done();
      });
    });

    it('should send to specific player', (done) => {
      socketService.sendToPlayer(testPlayer._id.toString(), 'test-player-event', { message: 'player-test' });
      
      clientSocket.on('test-player-event', (data) => {
        expect(data.message).toBe('player-test');
        done();
      });
    });

    it('should get room players', () => {
      const players = socketService.getRoomPlayers(testRoom._id.toString());
      expect(players).toHaveLength(1);
      expect(players[0].playerId).toBe(testPlayer._id.toString());
    });
  });
});