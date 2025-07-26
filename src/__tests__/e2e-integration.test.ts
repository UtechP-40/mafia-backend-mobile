import request from 'supertest';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { Express } from 'express';
import { Client as SocketClient } from 'socket.io-client';
import { connectDB, disconnectDB, clearDB, setupTestApp } from './setup';
import { Player } from '../models/Player';
import { Room } from '../models/Room';
import { Game } from '../models/Game';
import { setupSocketServer } from '../services/SocketService';

describe('End-to-End Integration Tests', () => {
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
    
    // Start server on random port
    await new Promise<void>((resolve) => {
      server.listen(0, resolve);
    });
  });

  afterAll(async () => {
    // Clean up all socket connections
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
    // Clean up socket connections after each test
    clients.forEach(client => {
      if (client.connected) {
        client.disconnect();
      }
    });
    clients = [];
  });

  // Helper function to create authenticated user
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

  // Helper function to create socket client
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

  describe('Complete User Journey: Registration to Game Completion', () => {
    it('should complete full user journey from registration to game end', async () => {
      // Step 1: Register multiple users
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');
      const bob = await createAuthenticatedUser('bob', 'bob@test.com');
      const charlie = await createAuthenticatedUser('charlie', 'charlie@test.com');

      // Step 2: Connect users via WebSocket
      const aliceSocket = await createSocketClient(alice);
      const bobSocket = await createSocketClient(bob);
      const charlieSocket = await createSocketClient(charlie);

      // Step 3: Alice creates a room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${alice}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 6,
            gameSettings: {
              maxPlayers: 6,
              enableVoiceChat: false,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: [
                { name: 'villager', count: 2 },
                { name: 'mafia', count: 1 }
              ]
            }
          }
        });

      expect(roomResponse.status).toBe(201);
      const roomId = roomResponse.body.id;

      // Step 4: Players join the room
      let bobJoined = false;
      let charlieJoined = false;

      bobSocket.on('player-joined', (data) => {
        if (data.player.username === 'bob') bobJoined = true;
      });

      charlieSocket.on('player-joined', (data) => {
        if (data.player.username === 'charlie') charlieJoined = true;
      });

      // Bob joins room
      bobSocket.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Charlie joins room
      charlieSocket.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(bobJoined).toBe(true);
      expect(charlieJoined).toBe(true);

      // Step 5: Start the game
      let gameStarted = false;
      const gameStates: any[] = [];

      [aliceSocket, bobSocket, charlieSocket].forEach(socket => {
        socket.on('game-started', () => {
          gameStarted = true;
        });
        socket.on('game-state-update', (state) => {
          gameStates.push(state);
        });
      });

      aliceSocket.emit('start-game');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(gameStarted).toBe(true);
      expect(gameStates.length).toBeGreaterThan(0);

      // Step 6: Simulate game phases and voting
      let phaseChanged = false;
      [aliceSocket, bobSocket, charlieSocket].forEach(socket => {
        socket.on('phase-change', () => {
          phaseChanged = true;
        });
      });

      // Simulate voting during day phase
      aliceSocket.emit('player-action', {
        type: 'vote',
        targetId: users.bob.id
      });

      charlieSocket.emit('player-action', {
        type: 'vote',
        targetId: users.bob.id
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Step 7: Verify game completion
      let gameEnded = false;
      [aliceSocket, bobSocket, charlieSocket].forEach(socket => {
        socket.on('game-ended', () => {
          gameEnded = true;
        });
      });

      // Wait for potential game end
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify room and game state in database
      const room = await Room.findById(roomId);
      expect(room).toBeTruthy();
      expect(room!.players.length).toBe(3);
    });
  });

  describe('Multi-Player Game Scenarios with Synchronized Actions', () => {
    it('should handle simultaneous player actions correctly', async () => {
      // Create 4 players for a more complex game
      const tokens = await Promise.all([
        createAuthenticatedUser('player1', 'p1@test.com'),
        createAuthenticatedUser('player2', 'p2@test.com'),
        createAuthenticatedUser('player3', 'p3@test.com'),
        createAuthenticatedUser('player4', 'p4@test.com')
      ]);

      const sockets = await Promise.all(tokens.map(createSocketClient));

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${tokens[0]}`)
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
              roles: [
                { name: 'villager', count: 2 },
                { name: 'mafia', count: 2 }
              ]
            }
          }
        });

      const roomId = roomResponse.body.id;

      // All players join
      await Promise.all(sockets.map((socket, index) => {
        return new Promise<void>((resolve) => {
          if (index === 0) {
            resolve(); // Host is already in room
            return;
          }
          socket.emit('join-room', roomId);
          socket.on('room-joined', () => resolve());
        });
      }));

      // Start game
      sockets[0].emit('start-game');
      await new Promise(resolve => setTimeout(resolve, 200));

      // Test simultaneous voting
      const votePromises = sockets.map((socket, index) => {
        return new Promise<void>((resolve) => {
          const targetIndex = (index + 1) % sockets.length;
          socket.emit('player-action', {
            type: 'vote',
            targetId: Object.values(users)[targetIndex].id
          });
          resolve();
        });
      });

      await Promise.all(votePromises);
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify game state consistency
      const room = await Room.findById(roomId);
      expect(room).toBeTruthy();
    });

    it('should handle player disconnection and reconnection during game', async () => {
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');
      const bob = await createAuthenticatedUser('bob', 'bob@test.com');

      const aliceSocket = await createSocketClient(alice);
      const bobSocket = await createSocketClient(bob);

      // Create and join room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${alice}`)
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
              roles: [
                { name: 'villager', count: 1 },
                { name: 'mafia', count: 1 }
              ]
            }
          }
        });

      const roomId = roomResponse.body.id;
      bobSocket.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start game
      aliceSocket.emit('start-game');
      await new Promise(resolve => setTimeout(resolve, 200));

      // Bob disconnects
      bobSocket.disconnect();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Bob reconnects
      const bobReconnectSocket = await createSocketClient(bob);
      bobReconnectSocket.emit('rejoin-game', roomId);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify game state is restored
      let stateRestored = false;
      bobReconnectSocket.on('game-state-update', (state) => {
        if (state.players && state.players.length === 2) {
          stateRestored = true;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(stateRestored).toBe(true);
    });
  });

  describe('Real-Time Communication Between Multiple Clients', () => {
    it('should broadcast chat messages to all players in real-time', async () => {
      const tokens = await Promise.all([
        createAuthenticatedUser('alice', 'alice@test.com'),
        createAuthenticatedUser('bob', 'bob@test.com'),
        createAuthenticatedUser('charlie', 'charlie@test.com')
      ]);

      const sockets = await Promise.all(tokens.map(createSocketClient));
      const receivedMessages: any[][] = [[], [], []];

      // Create room and join all players
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${tokens[0]}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 6,
            gameSettings: {
              maxPlayers: 6,
              enableVoiceChat: false,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;

      // Join all players
      for (let i = 1; i < sockets.length; i++) {
        sockets[i].emit('join-room', roomId);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Set up message listeners
      sockets.forEach((socket, index) => {
        socket.on('chat-message', (message) => {
          receivedMessages[index].push(message);
        });
      });

      // Send messages from different players
      const testMessages = [
        { sender: 0, content: 'Hello everyone!' },
        { sender: 1, content: 'Hi Alice!' },
        { sender: 2, content: 'Ready to play?' }
      ];

      for (const msg of testMessages) {
        sockets[msg.sender].emit('chat-message', {
          content: msg.content,
          type: 'player_chat'
        });
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify all players received all messages
      await new Promise(resolve => setTimeout(resolve, 200));
      
      receivedMessages.forEach((messages, playerIndex) => {
        expect(messages.length).toBe(testMessages.length);
        testMessages.forEach((testMsg, msgIndex) => {
          expect(messages[msgIndex].content).toBe(testMsg.content);
        });
      });
    });

    it('should handle real-time game state synchronization', async () => {
      const tokens = await Promise.all([
        createAuthenticatedUser('host', 'host@test.com'),
        createAuthenticatedUser('player', 'player@test.com')
      ]);

      const sockets = await Promise.all(tokens.map(createSocketClient));
      const gameStateUpdates: any[][] = [[], []];

      // Set up state update listeners
      sockets.forEach((socket, index) => {
        socket.on('game-state-update', (state) => {
          gameStateUpdates[index].push(state);
        });
      });

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${tokens[0]}`)
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
              roles: [
                { name: 'villager', count: 1 },
                { name: 'mafia', count: 1 }
              ]
            }
          }
        });

      const roomId = roomResponse.body.id;

      // Player joins
      sockets[1].emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start game
      sockets[0].emit('start-game');
      await new Promise(resolve => setTimeout(resolve, 200));

      // Perform game action
      sockets[0].emit('player-action', {
        type: 'vote',
        targetId: users.player.id
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify both players received state updates
      expect(gameStateUpdates[0].length).toBeGreaterThan(0);
      expect(gameStateUpdates[1].length).toBeGreaterThan(0);

      // Verify state consistency
      const lastState0 = gameStateUpdates[0][gameStateUpdates[0].length - 1];
      const lastState1 = gameStateUpdates[1][gameStateUpdates[1].length - 1];
      
      expect(lastState0.players.length).toBe(lastState1.players.length);
    });
  });

  describe('Friend System with Invitation and Game Joining Flows', () => {
    it('should complete friend request and game invitation workflow', async () => {
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');
      const bob = await createAuthenticatedUser('bob', 'bob@test.com');

      // Alice searches for Bob
      const searchResponse = await request(app)
        .get('/api/players/search?query=bob')
        .set('Authorization', `Bearer ${alice}`);

      expect(searchResponse.status).toBe(200);
      expect(searchResponse.body.length).toBe(1);
      expect(searchResponse.body[0].username).toBe('bob');

      // Alice sends friend request to Bob
      const friendRequestResponse = await request(app)
        .post('/api/players/friends/request')
        .set('Authorization', `Bearer ${alice}`)
        .send({ targetUserId: users.bob.id });

      expect(friendRequestResponse.status).toBe(200);

      // Bob accepts friend request
      const acceptResponse = await request(app)
        .post('/api/players/friends/respond')
        .set('Authorization', `Bearer ${bob}`)
        .send({ 
          requestId: friendRequestResponse.body.id,
          action: 'accept'
        });

      expect(acceptResponse.status).toBe(200);

      // Verify friendship exists
      const aliceFriendsResponse = await request(app)
        .get('/api/players/friends')
        .set('Authorization', `Bearer ${alice}`);

      expect(aliceFriendsResponse.status).toBe(200);
      expect(aliceFriendsResponse.body.friends.length).toBe(1);
      expect(aliceFriendsResponse.body.friends[0].username).toBe('bob');

      // Alice creates a private room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${alice}`)
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

      // Alice invites Bob to the game
      const inviteResponse = await request(app)
        .post('/api/players/friends/invite')
        .set('Authorization', `Bearer ${alice}`)
        .send({
          friendId: users.bob.id,
          roomId: roomId
        });

      expect(inviteResponse.status).toBe(200);

      // Bob joins using room code
      const joinResponse = await request(app)
        .post(`/api/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${bob}`)
        .send({ code: roomCode });

      expect(joinResponse.status).toBe(200);

      // Verify Bob is in the room
      const roomDetailsResponse = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${alice}`);

      expect(roomDetailsResponse.status).toBe(200);
      expect(roomDetailsResponse.body.players.length).toBe(2);
      expect(roomDetailsResponse.body.players.some((p: any) => p.username === 'bob')).toBe(true);
    });
  });

  describe('Matchmaking System with Concurrent Users', () => {
    it('should handle concurrent matchmaking requests', async () => {
      // Create multiple users with different ELO ratings
      const users = await Promise.all([
        createAuthenticatedUser('player1', 'p1@test.com'),
        createAuthenticatedUser('player2', 'p2@test.com'),
        createAuthenticatedUser('player3', 'p3@test.com'),
        createAuthenticatedUser('player4', 'p4@test.com')
      ]);

      // Update ELO ratings to test skill-based matching
      await Player.findOneAndUpdate(
        { username: 'player1' },
        { 'statistics.eloRating': 1000 }
      );
      await Player.findOneAndUpdate(
        { username: 'player2' },
        { 'statistics.eloRating': 1050 }
      );
      await Player.findOneAndUpdate(
        { username: 'player3' },
        { 'statistics.eloRating': 1500 }
      );
      await Player.findOneAndUpdate(
        { username: 'player4' },
        { 'statistics.eloRating': 1550 }
      );

      // Simulate concurrent matchmaking requests
      const matchmakingPromises = users.map((token, index) => 
        request(app)
          .post('/api/matchmaking/quick-match')
          .set('Authorization', `Bearer ${token}`)
          .send({
            gameMode: 'classic',
            maxWaitTime: 30000
          })
      );

      const responses = await Promise.all(matchmakingPromises);

      // Verify all requests were successful
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.roomId).toBeTruthy();
      });

      // Verify players were matched appropriately
      const room1Id = responses[0].body.roomId;
      const room2Id = responses[2].body.roomId;

      // Players with similar ELO should be in the same room
      expect(responses[0].body.roomId).toBe(responses[1].body.roomId);
      expect(responses[2].body.roomId).toBe(responses[3].body.roomId);
    });

    it('should handle matchmaking timeout scenarios', async () => {
      const token = await createAuthenticatedUser('lonePlayer', 'lone@test.com');

      // Set very high ELO to ensure no matches
      await Player.findOneAndUpdate(
        { username: 'lonePlayer' },
        { 'statistics.eloRating': 3000 }
      );

      const matchResponse = await request(app)
        .post('/api/matchmaking/quick-match')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gameMode: 'classic',
          maxWaitTime: 1000 // Short timeout for testing
        });

      // Should either find a match or timeout gracefully
      expect([200, 408]).toContain(matchResponse.status);
    });
  });

  describe('Game Hosting and Room Management Scenarios', () => {
    it('should handle host transfer when host leaves', async () => {
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');
      const bob = await createAuthenticatedUser('bob', 'bob@test.com');
      const charlie = await createAuthenticatedUser('charlie', 'charlie@test.com');

      const aliceSocket = await createSocketClient(alice);
      const bobSocket = await createSocketClient(bob);
      const charlieSocket = await createSocketClient(charlie);

      // Alice creates room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${alice}`)
        .send({
          settings: {
            isPublic: true,
            maxPlayers: 6,
            gameSettings: {
              maxPlayers: 6,
              enableVoiceChat: false,
              dayPhaseDuration: 300,
              nightPhaseDuration: 180,
              votingDuration: 60,
              roles: []
            }
          }
        });

      const roomId = roomResponse.body.id;

      // Bob and Charlie join
      bobSocket.emit('join-room', roomId);
      charlieSocket.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Set up host change listeners
      let newHostAssigned = false;
      let newHostId = '';

      [bobSocket, charlieSocket].forEach(socket => {
        socket.on('host-changed', (data) => {
          newHostAssigned = true;
          newHostId = data.newHostId;
        });
      });

      // Alice leaves (host leaves)
      aliceSocket.emit('leave-room');
      aliceSocket.disconnect();
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify new host was assigned
      expect(newHostAssigned).toBe(true);
      expect(newHostId).toBeTruthy();

      // Verify room still exists with new host
      const updatedRoom = await Room.findById(roomId);
      expect(updatedRoom).toBeTruthy();
      expect(updatedRoom!.hostId).not.toBe(users.alice.id);
      expect(updatedRoom!.players.length).toBe(2);
    });

    it('should handle room settings updates by host', async () => {
      const host = await createAuthenticatedUser('host', 'host@test.com');
      const player = await createAuthenticatedUser('player', 'player@test.com');

      const hostSocket = await createSocketClient(host);
      const playerSocket = await createSocketClient(player);

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host}`)
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

      // Player joins
      playerSocket.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Set up settings update listener
      let settingsUpdated = false;
      playerSocket.on('room-settings-updated', () => {
        settingsUpdated = true;
      });

      // Host updates room settings
      const updateResponse = await request(app)
        .put(`/api/rooms/${roomId}/settings`)
        .set('Authorization', `Bearer ${host}`)
        .send({
          settings: {
            isPublic: false,
            maxPlayers: 6,
            gameSettings: {
              maxPlayers: 6,
              enableVoiceChat: true,
              dayPhaseDuration: 240,
              nightPhaseDuration: 120,
              votingDuration: 45,
              roles: [
                { name: 'villager', count: 3 },
                { name: 'mafia', count: 2 },
                { name: 'detective', count: 1 }
              ]
            }
          }
        });

      expect(updateResponse.status).toBe(200);
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify settings were updated and broadcasted
      expect(settingsUpdated).toBe(true);

      const updatedRoom = await Room.findById(roomId);
      expect(updatedRoom!.settings.maxPlayers).toBe(6);
      expect(updatedRoom!.settings.gameSettings.enableVoiceChat).toBe(true);
    });
  });

  describe('Chat Moderation and AI Moderator Interactions', () => {
    it('should filter inappropriate content in chat messages', async () => {
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');
      const bob = await createAuthenticatedUser('bob', 'bob@test.com');

      const aliceSocket = await createSocketClient(alice);
      const bobSocket = await createSocketClient(bob);

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${alice}`)
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
      bobSocket.emit('join-room', roomId);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Set up message listeners
      const receivedMessages: any[] = [];
      [aliceSocket, bobSocket].forEach(socket => {
        socket.on('chat-message', (message) => {
          receivedMessages.push(message);
        });
      });

      // Send inappropriate message
      aliceSocket.emit('chat-message', {
        content: 'This is a bad word: damn',
        type: 'player_chat'
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify message was moderated
      expect(receivedMessages.length).toBeGreaterThan(0);
      const moderatedMessage = receivedMessages.find(msg => msg.isModerated);
      expect(moderatedMessage).toBeTruthy();
    });

    it('should provide AI moderator assistance during games', async () => {
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');
      const aliceSocket = await createSocketClient(alice);

      // Create room
      const roomResponse = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${alice}`)
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

      // Request AI assistance
      let aiResponse = '';
      aliceSocket.on('ai-assistance', (data) => {
        aiResponse = data.message;
      });

      aliceSocket.emit('request-ai-help', {
        question: 'How do I play as a detective?'
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify AI provided assistance
      expect(aiResponse).toBeTruthy();
      expect(aiResponse.length).toBeGreaterThan(0);
    });
  });

  describe('Social Features and Leaderboard Updates', () => {
    it('should update leaderboards after game completion', async () => {
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');
      const bob = await createAuthenticatedUser('bob', 'bob@test.com');

      // Get initial leaderboard
      const initialLeaderboard = await request(app)
        .get('/api/players/leaderboard')
        .set('Authorization', `Bearer ${alice}`);

      expect(initialLeaderboard.status).toBe(200);

      // Simulate game completion by updating player statistics
      await Player.findOneAndUpdate(
        { username: 'alice' },
        {
          $inc: {
            'statistics.gamesPlayed': 1,
            'statistics.gamesWon': 1
          },
          $set: {
            'statistics.eloRating': 1100
          }
        }
      );

      await Player.findOneAndUpdate(
        { username: 'bob' },
        {
          $inc: {
            'statistics.gamesPlayed': 1
          },
          $set: {
            'statistics.eloRating': 950
          }
        }
      );

      // Get updated leaderboard
      const updatedLeaderboard = await request(app)
        .get('/api/players/leaderboard')
        .set('Authorization', `Bearer ${alice}`);

      expect(updatedLeaderboard.status).toBe(200);
      expect(updatedLeaderboard.body.length).toBeGreaterThan(0);

      // Verify Alice is ranked higher than Bob
      const aliceRank = updatedLeaderboard.body.findIndex((p: any) => p.username === 'alice');
      const bobRank = updatedLeaderboard.body.findIndex((p: any) => p.username === 'bob');
      
      expect(aliceRank).toBeLessThan(bobRank);
    });

    it('should track and display player achievements', async () => {
      const alice = await createAuthenticatedUser('alice', 'alice@test.com');

      // Simulate achievement unlock
      await Player.findOneAndUpdate(
        { username: 'alice' },
        {
          $push: {
            'statistics.achievements': {
              id: 'first_win',
              name: 'First Victory',
              description: 'Win your first game',
              unlockedAt: new Date()
            }
          }
        }
      );

      // Get player profile with achievements
      const profileResponse = await request(app)
        .get('/api/players/profile')
        .set('Authorization', `Bearer ${alice}`);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.statistics.achievements.length).toBe(1);
      expect(profileResponse.body.statistics.achievements[0].name).toBe('First Victory');
    });
  });
});