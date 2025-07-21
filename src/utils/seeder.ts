import { Types } from 'mongoose';
import { Player, Room, Game, ChatMessage, GameRole, RoomStatus, GamePhase, MessageType } from '../models';
import { connectDatabase } from './database';
import { logger } from './logger';

export class DatabaseSeeder {
  /**
   * Seed the database with sample data for development
   */
  static async seedDatabase() {
    try {
      logger.info('Starting database seeding...');
      
      // Clear existing data (only in development)
      if (process.env.NODE_ENV === 'development') {
        await this.clearDatabase();
      }
      
      // Create sample players
      const players = await this.createSamplePlayers();
      logger.info(`Created ${players.length} sample players`);
      
      // Create sample rooms
      const rooms = await this.createSampleRooms(players);
      logger.info(`Created ${rooms.length} sample rooms`);
      
      // Create sample games
      const games = await this.createSampleGames(rooms, players);
      logger.info(`Created ${games.length} sample games`);
      
      // Create sample chat messages
      const messages = await this.createSampleChatMessages(rooms, players);
      logger.info(`Created ${messages.length} sample chat messages`);
      
      logger.info('Database seeding completed successfully');
      
      return {
        players: players.length,
        rooms: rooms.length,
        games: games.length,
        messages: messages.length
      };
      
    } catch (error) {
      logger.error('Database seeding failed:', error);
      throw error;
    }
  }
  
  /**
   * Clear all data from the database
   */
  static async clearDatabase() {
    logger.info('Clearing existing database data...');
    
    await Promise.all([
      Player.deleteMany({}),
      Room.deleteMany({}),
      Game.deleteMany({}),
      ChatMessage.deleteMany({})
    ]);
    
    logger.info('Database cleared');
  }
  
  /**
   * Create sample players
   */
  static async createSamplePlayers() {
    const samplePlayers = [
      {
        username: 'alice_detective',
        email: 'alice@example.com',
        avatar: 'avatar1.png',
        statistics: {
          gamesPlayed: 25,
          gamesWon: 15,
          winRate: 60,
          favoriteRole: GameRole.DETECTIVE,
          averageGameDuration: 1200000, // 20 minutes
          eloRating: 1450
        }
      },
      {
        username: 'bob_mafia',
        email: 'bob@example.com',
        avatar: 'avatar2.png',
        statistics: {
          gamesPlayed: 30,
          gamesWon: 18,
          winRate: 60,
          favoriteRole: GameRole.MAFIA,
          averageGameDuration: 1100000, // 18 minutes
          eloRating: 1520
        }
      },
      {
        username: 'charlie_villager',
        email: 'charlie@example.com',
        avatar: 'avatar3.png',
        statistics: {
          gamesPlayed: 20,
          gamesWon: 8,
          winRate: 40,
          favoriteRole: GameRole.VILLAGER,
          averageGameDuration: 1300000, // 22 minutes
          eloRating: 1280
        }
      },
      {
        username: 'diana_doctor',
        email: 'diana@example.com',
        avatar: 'avatar4.png',
        statistics: {
          gamesPlayed: 35,
          gamesWon: 22,
          winRate: 63,
          favoriteRole: GameRole.DOCTOR,
          averageGameDuration: 1250000, // 21 minutes
          eloRating: 1580
        }
      },
      {
        username: 'eve_mayor',
        email: 'eve@example.com',
        avatar: 'avatar5.png',
        statistics: {
          gamesPlayed: 15,
          gamesWon: 9,
          winRate: 60,
          favoriteRole: GameRole.MAYOR,
          averageGameDuration: 1400000, // 23 minutes
          eloRating: 1380
        }
      },
      {
        username: 'frank_newbie',
        email: 'frank@example.com',
        avatar: 'avatar6.png',
        statistics: {
          gamesPlayed: 5,
          gamesWon: 1,
          winRate: 20,
          favoriteRole: GameRole.VILLAGER,
          averageGameDuration: 1500000, // 25 minutes
          eloRating: 1150
        }
      }
    ];
    
    const players = [];
    for (const playerData of samplePlayers) {
      const player = new Player(playerData);
      await player.save();
      players.push(player);
    }
    
    // Create friend relationships
    players[0].friends.push(players[1]._id, players[3]._id); // Alice friends with Bob and Diana
    players[1].friends.push(players[0]._id, players[2]._id); // Bob friends with Alice and Charlie
    players[2].friends.push(players[1]._id, players[4]._id); // Charlie friends with Bob and Eve
    players[3].friends.push(players[0]._id, players[4]._id); // Diana friends with Alice and Eve
    
    await Promise.all(players.map(player => player.save()));
    
    return players;
  }
  
  /**
   * Create sample rooms
   */
  static async createSampleRooms(players: any[]) {
    const sampleRooms = [
      {
        code: 'ROOM01',
        hostId: players[0]._id,
        players: [players[0]._id, players[1]._id, players[2]._id, players[3]._id],
        settings: {
          isPublic: true,
          maxPlayers: 8,
          gameSettings: {
            maxPlayers: 8,
            enableVoiceChat: true,
            dayPhaseDuration: 300000,
            nightPhaseDuration: 120000,
            votingDuration: 60000,
            roles: [
              { role: GameRole.MAFIA, count: 2 },
              { role: GameRole.DETECTIVE, count: 1 },
              { role: GameRole.DOCTOR, count: 1 },
              { role: GameRole.VILLAGER, count: 4 }
            ]
          },
          allowSpectators: false,
          requireInvite: false
        },
        status: RoomStatus.WAITING
      },
      {
        code: 'ROOM02',
        hostId: players[1]._id,
        players: [players[1]._id, players[4]._id, players[5]._id],
        settings: {
          isPublic: true,
          maxPlayers: 6,
          gameSettings: {
            maxPlayers: 6,
            enableVoiceChat: false,
            dayPhaseDuration: 240000,
            nightPhaseDuration: 90000,
            votingDuration: 45000,
            roles: [
              { role: GameRole.MAFIA, count: 2 },
              { role: GameRole.DETECTIVE, count: 1 },
              { role: GameRole.VILLAGER, count: 3 }
            ]
          },
          allowSpectators: true,
          requireInvite: false
        },
        status: RoomStatus.WAITING
      },
      {
        code: 'ROOM03',
        hostId: players[2]._id,
        players: [players[2]._id, players[3]._id, players[4]._id, players[5]._id, players[0]._id, players[1]._id],
        settings: {
          isPublic: false,
          maxPlayers: 6,
          gameSettings: {
            maxPlayers: 6,
            enableVoiceChat: true,
            dayPhaseDuration: 360000,
            nightPhaseDuration: 150000,
            votingDuration: 75000,
            roles: [
              { role: GameRole.MAFIA, count: 2 },
              { role: GameRole.DETECTIVE, count: 1 },
              { role: GameRole.VILLAGER, count: 3 }
            ]
          },
          allowSpectators: false,
          requireInvite: true
        },
        status: RoomStatus.IN_PROGRESS
      }
    ];
    
    const rooms = [];
    for (const roomData of sampleRooms) {
      const room = new Room(roomData);
      await room.save();
      rooms.push(room);
    }
    
    return rooms;
  }
  
  /**
   * Create sample games
   */
  static async createSampleGames(rooms: any[], players: any[]) {
    const sampleGames = [
      {
        roomId: rooms[2]._id, // The in-progress room
        phase: GamePhase.DAY,
        dayNumber: 2,
        players: [players[2]._id, players[3]._id, players[4]._id, players[5]._id, players[0]._id, players[1]._id],
        eliminatedPlayers: [],
        votes: [],
        timeRemaining: 180000, // 3 minutes remaining
        settings: rooms[2].settings.gameSettings,
        history: [
          {
            type: 'game_start',
            timestamp: new Date(Date.now() - 600000), // 10 minutes ago
            phase: GamePhase.DAY,
            dayNumber: 1
          },
          {
            type: 'phase_change',
            timestamp: new Date(Date.now() - 300000), // 5 minutes ago
            phase: GamePhase.NIGHT,
            dayNumber: 1,
            data: { from: 'day', to: 'night' }
          },
          {
            type: 'phase_change',
            timestamp: new Date(Date.now() - 120000), // 2 minutes ago
            phase: GamePhase.DAY,
            dayNumber: 2,
            data: { from: 'night', to: 'day' }
          }
        ]
      }
    ];
    
    const games = [];
    for (const gameData of sampleGames) {
      const game = new Game(gameData);
      await game.save();
      
      // Update the room to reference this game
      await Room.findByIdAndUpdate(gameData.roomId, { gameStateId: game._id });
      
      games.push(game);
    }
    
    return games;
  }
  
  /**
   * Create sample chat messages
   */
  static async createSampleChatMessages(rooms: any[], players: any[]) {
    const sampleMessages = [
      // Messages for Room 1
      {
        roomId: rooms[0]._id,
        playerId: players[0]._id,
        content: 'Hey everyone! Ready for a game?',
        type: MessageType.PLAYER_CHAT,
        timestamp: new Date(Date.now() - 300000)
      },
      {
        roomId: rooms[0]._id,
        playerId: players[1]._id,
        content: 'Absolutely! Let\'s do this!',
        type: MessageType.PLAYER_CHAT,
        timestamp: new Date(Date.now() - 280000)
      },
      {
        roomId: rooms[0]._id,
        content: 'Alice has joined the room',
        type: MessageType.SYSTEM_MESSAGE,
        timestamp: new Date(Date.now() - 320000)
      },
      
      // Messages for Room 2
      {
        roomId: rooms[1]._id,
        playerId: players[4]._id,
        content: 'First time playing, any tips?',
        type: MessageType.PLAYER_CHAT,
        timestamp: new Date(Date.now() - 240000)
      },
      {
        roomId: rooms[1]._id,
        playerId: players[1]._id,
        content: 'Just watch and learn, you\'ll get the hang of it!',
        type: MessageType.PLAYER_CHAT,
        timestamp: new Date(Date.now() - 220000)
      },
      {
        roomId: rooms[1]._id,
        content: 'Welcome to Mafia! Pay attention to player behavior and voting patterns.',
        type: MessageType.AI_ASSISTANCE,
        timestamp: new Date(Date.now() - 200000)
      },
      
      // Messages for Room 3 (in-progress game)
      {
        roomId: rooms[2]._id,
        content: 'Day phase has begun. Discuss and vote!',
        type: MessageType.GAME_EVENT,
        timestamp: new Date(Date.now() - 120000)
      },
      {
        roomId: rooms[2]._id,
        playerId: players[2]._id,
        content: 'I think we should be careful about who we vote for',
        type: MessageType.PLAYER_CHAT,
        timestamp: new Date(Date.now() - 100000)
      },
      {
        roomId: rooms[2]._id,
        playerId: players[3]._id,
        content: 'Agreed, let\'s think this through',
        type: MessageType.PLAYER_CHAT,
        timestamp: new Date(Date.now() - 80000)
      },
      {
        roomId: rooms[2]._id,
        playerId: players[5]._id,
        content: 'Someone seems suspicious...',
        type: MessageType.PLAYER_CHAT,
        timestamp: new Date(Date.now() - 60000)
      }
    ];
    
    const messages = [];
    for (const messageData of sampleMessages) {
      const message = new ChatMessage(messageData);
      await message.save();
      messages.push(message);
    }
    
    return messages;
  }
}

/**
 * Run seeder from command line
 */
async function runSeeder() {
  try {
    await connectDatabase();
    logger.info('Connected to database for seeding');
    
    const result = await DatabaseSeeder.seedDatabase();
    logger.info('Seeding completed:', result);
    
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runSeeder();
}