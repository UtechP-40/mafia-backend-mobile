import mongoose from 'mongoose';
import { Migration } from './index';
import { Player, Game, Room, ChatMessage } from '../models';
import { logger } from '../utils/logger';

export const initialSetupMigration: Migration = {
  version: '001',
  description: 'Initial database setup with indexes and constraints',
  
  async up() {
    logger.info('Running initial database setup...');
    
    try {
      // Ensure all collections exist
      const collections = await mongoose.connection.db?.listCollections().toArray() || [];
      const collectionNames = collections.map(col => col.name);
      
      // Create collections if they don't exist
      const requiredCollections = ['players', 'games', 'rooms', 'chatmessages'];
      for (const collectionName of requiredCollections) {
        if (!collectionNames.includes(collectionName)) {
          await mongoose.connection.db?.createCollection(collectionName);
          logger.info(`Created collection: ${collectionName}`);
        }
      }
      
      // Create additional indexes for better performance
      logger.info('Creating additional database indexes...');
      
      // Player indexes
      await Player.collection.createIndex(
        { username: 'text', email: 'text' },
        { name: 'player_search_index' }
      );
      
      await Player.collection.createIndex(
        { 'statistics.eloRating': -1, 'statistics.gamesPlayed': -1 },
        { name: 'player_leaderboard_index' }
      );
      
      // Game indexes
      await Game.collection.createIndex(
        { players: 1, phase: 1 },
        { name: 'game_player_phase_index' }
      );
      
      await Game.collection.createIndex(
        { createdAt: -1, 'winResult.condition': 1 },
        { name: 'game_history_index' }
      );
      
      // Room indexes
      await Room.collection.createIndex(
        { 'settings.isPublic': 1, status: 1, createdAt: -1 },
        { name: 'room_discovery_index' }
      );
      
      await Room.collection.createIndex(
        { hostId: 1, status: 1 },
        { name: 'room_host_index' }
      );
      
      // ChatMessage indexes
      await ChatMessage.collection.createIndex(
        { roomId: 1, timestamp: -1, type: 1 },
        { name: 'chat_room_timeline_index' }
      );
      
      await ChatMessage.collection.createIndex(
        { isModerated: 1, createdAt: -1 },
        { name: 'chat_moderation_index' }
      );
      
      // Create compound indexes for complex queries
      await Game.collection.createIndex(
        { 'winResult.winningPlayers': 1, createdAt: -1 },
        { name: 'game_winners_index' }
      );
      
      await Player.collection.createIndex(
        { friends: 1, lastActive: -1 },
        { name: 'player_friends_activity_index' }
      );
      
      logger.info('Database indexes created successfully');
      
      // Set up database constraints and validation
      logger.info('Setting up database constraints...');
      
      // Add validation rules at database level
      await mongoose.connection.db?.command({
        collMod: 'players',
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['username'],
            properties: {
              username: {
                bsonType: 'string',
                minLength: 3,
                maxLength: 20,
                pattern: '^[a-zA-Z0-9_]+$'
              },
              email: {
                bsonType: ['string', 'null'],
                pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
              },
              'statistics.eloRating': {
                bsonType: 'number',
                minimum: 0,
                maximum: 3000
              }
            }
          }
        },
        validationLevel: 'moderate',
        validationAction: 'warn'
      });
      
      logger.info('Database constraints set up successfully');
      
      // Create default system data if needed
      logger.info('Setting up default system data...');
      
      // Check if we need to create any default data
      const playerCount = await Player.countDocuments();
      if (playerCount === 0) {
        logger.info('No players found, database appears to be fresh');
        // Could create default admin user or system accounts here if needed
      }
      
      logger.info('Initial database setup completed successfully');
      
    } catch (error) {
      logger.error('Initial database setup failed:', error);
      throw error;
    }
  },
  
  async down() {
    logger.info('Rolling back initial database setup...');
    
    try {
      // Remove custom indexes (keep the ones created by Mongoose schemas)
      const customIndexes = [
        'player_search_index',
        'player_leaderboard_index',
        'game_player_phase_index',
        'game_history_index',
        'room_discovery_index',
        'room_host_index',
        'chat_room_timeline_index',
        'chat_moderation_index',
        'game_winners_index',
        'player_friends_activity_index'
      ];
      
      for (const indexName of customIndexes) {
        try {
          await Player.collection.dropIndex(indexName);
          logger.info(`Dropped index: ${indexName}`);
        } catch (error) {
          // Index might not exist, continue
          logger.warn(`Could not drop index ${indexName}:`, error);
        }
      }
      
      // Remove database-level validation
      try {
        await mongoose.connection.db?.command({
          collMod: 'players',
          validator: {},
          validationLevel: 'off'
        });
        logger.info('Removed database validation rules');
      } catch (error) {
        logger.warn('Could not remove validation rules:', error);
      }
      
      logger.info('Initial database setup rollback completed');
      
    } catch (error) {
      logger.error('Initial database setup rollback failed:', error);
      throw error;
    }
  }
};