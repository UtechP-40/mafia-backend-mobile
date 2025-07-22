import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Player } from '../models/Player';
import { Room } from '../models/Room';
import { ChatMessage } from '../models/ChatMessage';
import { logger } from '../utils/logger';

interface AuthenticatedSocket extends Socket {
  playerId?: string;
  player?: any;
}

interface PlayerSession {
  playerId: string;
  socketId: string;
  roomId?: string;
  connectedAt: Date;
  lastActivity: Date;
}

interface RoomState {
  roomId: string;
  players: Map<string, PlayerSession>;
  host?: string;
}

export class SocketService {
  private io: Server;
  private playerSessions: Map<string, PlayerSession> = new Map();
  private roomStates: Map<string, RoomState> = new Map();
  private socketToPlayer: Map<string, string> = new Map();

  constructor(io: Server) {
    this.io = io;
    this.setupNamespaces();
  }

  private setupNamespaces() {
    // Main game namespace
    const gameNamespace = this.io.of('/game');
    
    gameNamespace.use(this.authenticateSocket.bind(this));
    gameNamespace.on('connection', this.handleConnection.bind(this));
  }

  private async authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void) {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET!) as any;
      const player = await Player.findById(decoded.playerId);
      
      if (!player) {
        return next(new Error('Player not found'));
      }

      socket.playerId = player._id.toString();
      socket.player = player;
      next();
    } catch (error) {
      logger.error('Socket authentication failed:', error);
      next(new Error('Authentication failed'));
    }
  }

  private handleConnection(socket: AuthenticatedSocket) {
    const playerId = socket.playerId!;
    
    logger.info(`Player ${playerId} connected with socket ${socket.id}`);

    // Create or update player session
    const session: PlayerSession = {
      playerId,
      socketId: socket.id,
      connectedAt: new Date(),
      lastActivity: new Date()
    };

    this.playerSessions.set(playerId, session);
    this.socketToPlayer.set(socket.id, playerId);

    // Set up event handlers
    this.setupEventHandlers(socket);

    // Handle disconnection
    socket.on('disconnect', () => this.handleDisconnection(socket));
  }

  private setupEventHandlers(socket: AuthenticatedSocket) {
    // Room management events
    socket.on('join-room', (data) => this.handleJoinRoom(socket, data));
    socket.on('leave-room', (data) => this.handleLeaveRoom(socket, data));
    socket.on('room-settings-update', (data) => this.handleRoomSettingsUpdate(socket, data));

    // Chat events
    socket.on('chat-message', (data) => this.handleChatMessage(socket, data));

    // Game events
    socket.on('player-action', (data) => this.handlePlayerAction(socket, data));
    socket.on('ready-state-change', (data) => this.handleReadyStateChange(socket, data));

    // Voice chat events
    socket.on('voice-state-change', (data) => this.handleVoiceStateChange(socket, data));

    // Connection management
    socket.on('ping', () => this.handlePing(socket));
    socket.on('heartbeat', () => this.updatePlayerActivity(socket));
  }

  private async handleJoinRoom(socket: AuthenticatedSocket, data: { roomId: string }) {
    try {
      const { roomId } = data;
      const playerId = socket.playerId!;

      // Validate room exists
      const room = await Room.findById(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if room is full
      if (room.players.length >= room.settings.maxPlayers) {
        socket.emit('error', { message: 'Room is full' });
        return;
      }

      // Check if player is already in room
      const isAlreadyInRoom = room.players.some(p => p._id.toString() === playerId);
      if (isAlreadyInRoom) {
        socket.emit('error', { message: 'Already in room' });
        return;
      }

      // Add player to room
      room.players.push(socket.player);
      await room.save();

      // Join socket room
      socket.join(roomId);

      // Update session
      const session = this.playerSessions.get(playerId);
      if (session) {
        session.roomId = roomId;
        this.playerSessions.set(playerId, session);
      }

      // Update room state
      if (!this.roomStates.has(roomId)) {
        this.roomStates.set(roomId, {
          roomId,
          players: new Map(),
          host: room.hostId.toString()
        });
      }

      const roomState = this.roomStates.get(roomId)!;
      roomState.players.set(playerId, session!);

      // Notify all players in room
      socket.to(roomId).emit('player-joined', {
        player: socket.player,
        roomState: await this.getRoomStateForClient(roomId)
      });

      // Send room state to joining player
      socket.emit('room-joined', {
        room,
        roomState: await this.getRoomStateForClient(roomId)
      });

      logger.info(`Player ${playerId} joined room ${roomId}`);
    } catch (error) {
      logger.error('Error handling join room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  }

  private async handleLeaveRoom(socket: AuthenticatedSocket, data: { roomId?: string }) {
    try {
      const playerId = socket.playerId!;
      const session = this.playerSessions.get(playerId);
      const roomId = data.roomId || session?.roomId;

      if (!roomId) {
        return;
      }

      // Remove player from database room
      const room = await Room.findById(roomId);
      if (room) {
        room.players = room.players.filter(p => p._id.toString() !== playerId);
        
        // If host left, transfer to another player or delete room
        if (room.hostId.toString() === playerId) {
          if (room.players.length > 0) {
            room.hostId = room.players[0]._id;
          } else {
            await Room.findByIdAndDelete(roomId);
            this.roomStates.delete(roomId);
            return;
          }
        }
        
        await room.save();
      }

      // Leave socket room
      socket.leave(roomId);

      // Update session
      if (session) {
        session.roomId = undefined;
        this.playerSessions.set(playerId, session);
      }

      // Update room state
      const roomState = this.roomStates.get(roomId);
      if (roomState) {
        roomState.players.delete(playerId);
        
        if (roomState.players.size === 0) {
          this.roomStates.delete(roomId);
        } else if (roomState.host === playerId && room) {
          roomState.host = room.hostId.toString();
        }
      }

      // Notify remaining players
      socket.to(roomId).emit('player-left', {
        playerId,
        roomState: await this.getRoomStateForClient(roomId)
      });

      socket.emit('room-left', { roomId });

      logger.info(`Player ${playerId} left room ${roomId}`);
    } catch (error) {
      logger.error('Error handling leave room:', error);
      socket.emit('error', { message: 'Failed to leave room' });
    }
  }

  private async handleRoomSettingsUpdate(socket: AuthenticatedSocket, data: any) {
    try {
      const playerId = socket.playerId!;
      const session = this.playerSessions.get(playerId);
      
      if (!session?.roomId) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      const room = await Room.findById(session.roomId);
      if (!room || room.hostId.toString() !== playerId) {
        socket.emit('error', { message: 'Only host can update room settings' });
        return;
      }

      // Update room settings
      Object.assign(room.settings, data.settings);
      await room.save();

      // Notify all players in room
      this.io.to(session.roomId).emit('room-settings-updated', {
        settings: room.settings
      });

      logger.info(`Room ${session.roomId} settings updated by ${playerId}`);
    } catch (error) {
      logger.error('Error updating room settings:', error);
      socket.emit('error', { message: 'Failed to update room settings' });
    }
  }

  private async handleChatMessage(socket: AuthenticatedSocket, data: { content: string, type?: string }) {
    try {
      const playerId = socket.playerId!;
      const session = this.playerSessions.get(playerId);
      
      if (!session?.roomId) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      // Create chat message
      const chatMessage = new ChatMessage({
        roomId: session.roomId,
        playerId,
        content: data.content,
        type: data.type || 'player_chat',
        timestamp: new Date(),
        isModerated: false
      });

      await chatMessage.save();

      // Broadcast to room (including sender)
      this.io.of('/game').to(session.roomId).emit('chat-message', {
        id: chatMessage._id,
        playerId,
        playerName: socket.player.username,
        content: data.content,
        type: data.type || 'player_chat',
        timestamp: chatMessage.timestamp
      });

      this.updatePlayerActivity(socket);
    } catch (error) {
      logger.error('Error handling chat message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  private handlePlayerAction(socket: AuthenticatedSocket, data: any) {
    // This will be implemented in the game logic task
    // For now, just acknowledge the action
    socket.emit('action-acknowledged', { actionId: data.actionId });
    this.updatePlayerActivity(socket);
  }

  private async handleReadyStateChange(socket: AuthenticatedSocket, data: { isReady: boolean }) {
    try {
      const playerId = socket.playerId!;
      const session = this.playerSessions.get(playerId);
      
      if (!session?.roomId) {
        socket.emit('error', { message: 'Not in a room' });
        return;
      }

      // Update player ready state in database
      const room = await Room.findById(session.roomId);
      if (room) {
        const player = room.players.find(p => p._id.toString() === playerId);
        if (player) {
          (player as any).isReady = data.isReady;
          await room.save();
        }
      }

      // Broadcast to room
      socket.to(session.roomId).emit('player-ready-state-changed', {
        playerId,
        isReady: data.isReady
      });

      this.updatePlayerActivity(socket);
    } catch (error) {
      logger.error('Error handling ready state change:', error);
      socket.emit('error', { message: 'Failed to update ready state' });
    }
  }

  private handleVoiceStateChange(socket: AuthenticatedSocket, data: any) {
    const playerId = socket.playerId!;
    const session = this.playerSessions.get(playerId);
    
    if (!session?.roomId) {
      return;
    }

    // Broadcast voice state to room
    socket.to(session.roomId).emit('voice-state-changed', {
      playerId,
      ...data
    });

    this.updatePlayerActivity(socket);
  }

  private handlePing(socket: AuthenticatedSocket) {
    socket.emit('pong', { timestamp: Date.now() });
    this.updatePlayerActivity(socket);
  }

  private updatePlayerActivity(socket: AuthenticatedSocket) {
    const playerId = socket.playerId!;
    const session = this.playerSessions.get(playerId);
    
    if (session) {
      session.lastActivity = new Date();
      this.playerSessions.set(playerId, session);
    }
  }

  private handleDisconnection(socket: AuthenticatedSocket) {
    const playerId = socket.playerId!;
    const session = this.playerSessions.get(playerId);

    logger.info(`Player ${playerId} disconnected`);

    if (session?.roomId) {
      // Notify room of disconnection
      socket.to(session.roomId).emit('player-disconnected', {
        playerId,
        timestamp: new Date()
      });
    }

    // Clean up session data
    this.playerSessions.delete(playerId);
    this.socketToPlayer.delete(socket.id);

    // Note: We don't remove from room immediately to allow reconnection
    // Room cleanup will happen after a timeout or explicit leave
  }

  private async getRoomStateForClient(roomId: string) {
    const roomState = this.roomStates.get(roomId);
    const room = await Room.findById(roomId);
    
    if (!roomState || !room) {
      return null;
    }

    return {
      roomId,
      players: Array.from(roomState.players.values()).map(session => ({
        playerId: session.playerId,
        isConnected: true,
        lastActivity: session.lastActivity
      })),
      host: roomState.host,
      settings: room.settings
    };
  }

  // Public methods for external use
  public async broadcastToRoom(roomId: string, event: string, data: any) {
    this.io.to(roomId).emit(event, data);
  }

  public async sendToPlayer(playerId: string, event: string, data: any) {
    const session = this.playerSessions.get(playerId);
    if (session) {
      this.io.to(session.socketId).emit(event, data);
    }
  }

  public getPlayerSession(playerId: string): PlayerSession | undefined {
    return this.playerSessions.get(playerId);
  }

  public getRoomPlayers(roomId: string): PlayerSession[] {
    const roomState = this.roomStates.get(roomId);
    return roomState ? Array.from(roomState.players.values()) : [];
  }

  public isPlayerConnected(playerId: string): boolean {
    return this.playerSessions.has(playerId);
  }

  // Cleanup inactive sessions
  public cleanupInactiveSessions(timeoutMinutes: number = 30) {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    
    for (const [playerId, session] of this.playerSessions.entries()) {
      if (session.lastActivity < cutoff) {
        logger.info(`Cleaning up inactive session for player ${playerId}`);
        
        // Remove from room if in one
        if (session.roomId) {
          const roomState = this.roomStates.get(session.roomId);
          if (roomState) {
            roomState.players.delete(playerId);
            
            // Notify room
            this.io.to(session.roomId).emit('player-timeout', {
              playerId,
              timestamp: new Date()
            });
          }
        }
        
        // Clean up session
        this.playerSessions.delete(playerId);
        this.socketToPlayer.delete(session.socketId);
      }
    }
  }
}