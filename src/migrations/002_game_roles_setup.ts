import { Migration } from './index';
import { Room, GameRole } from '../models';
import { logger } from '../utils/logger';

export const gameRolesSetupMigration: Migration = {
  version: '002',
  description: 'Set up default game role configurations and update existing rooms',
  
  async up() {
    logger.info('Setting up default game role configurations...');
    
    try {
      // Define default role configurations for different player counts
      const defaultRoleConfigs = {
        4: [
          { role: GameRole.MAFIA, count: 1 },
          { role: GameRole.DETECTIVE, count: 1 },
          { role: GameRole.VILLAGER, count: 2 }
        ],
        5: [
          { role: GameRole.MAFIA, count: 1 },
          { role: GameRole.DETECTIVE, count: 1 },
          { role: GameRole.VILLAGER, count: 3 }
        ],
        6: [
          { role: GameRole.MAFIA, count: 2 },
          { role: GameRole.DETECTIVE, count: 1 },
          { role: GameRole.VILLAGER, count: 3 }
        ],
        7: [
          { role: GameRole.MAFIA, count: 2 },
          { role: GameRole.DETECTIVE, count: 1 },
          { role: GameRole.DOCTOR, count: 1 },
          { role: GameRole.VILLAGER, count: 3 }
        ],
        8: [
          { role: GameRole.MAFIA, count: 2 },
          { role: GameRole.DETECTIVE, count: 1 },
          { role: GameRole.DOCTOR, count: 1 },
          { role: GameRole.VILLAGER, count: 4 }
        ],
        10: [
          { role: GameRole.MAFIA, count: 3 },
          { role: GameRole.DETECTIVE, count: 1 },
          { role: GameRole.DOCTOR, count: 1 },
          { role: GameRole.MAYOR, count: 1 },
          { role: GameRole.VILLAGER, count: 4 }
        ],
        12: [
          { role: GameRole.MAFIA, count: 3 },
          { role: GameRole.DETECTIVE, count: 1 },
          { role: GameRole.DOCTOR, count: 1 },
          { role: GameRole.MAYOR, count: 1 },
          { role: GameRole.VILLAGER, count: 6 }
        ]
      };
      
      // Update existing rooms that don't have role configurations
      const roomsWithoutRoles = await Room.find({
        $or: [
          { 'settings.gameSettings.roles': { $exists: false } },
          { 'settings.gameSettings.roles': { $size: 0 } }
        ]
      });
      
      logger.info(`Found ${roomsWithoutRoles.length} rooms without role configurations`);
      
      for (const room of roomsWithoutRoles) {
        const maxPlayers = room.settings.maxPlayers;
        let roleConfig = defaultRoleConfigs[maxPlayers as keyof typeof defaultRoleConfigs];
        
        // If no exact match, use the closest configuration
        if (!roleConfig) {
          const availableCounts = Object.keys(defaultRoleConfigs).map(Number).sort((a, b) => a - b);
          const closestCount = availableCounts.reduce((prev, curr) => 
            Math.abs(curr - maxPlayers) < Math.abs(prev - maxPlayers) ? curr : prev
          );
          roleConfig = defaultRoleConfigs[closestCount as keyof typeof defaultRoleConfigs];
          
          // Adjust the configuration to match the actual player count
          if (roleConfig) {
            roleConfig = [...roleConfig];
            const totalRoles = roleConfig.reduce((sum, role) => sum + role.count, 0);
            const difference = maxPlayers - totalRoles;
            
            if (difference > 0) {
              // Add more villagers
              const villagerRole = roleConfig.find(r => r.role === GameRole.VILLAGER);
              if (villagerRole) {
                villagerRole.count += difference;
              } else {
                roleConfig.push({ role: GameRole.VILLAGER, count: difference });
              }
            } else if (difference < 0) {
              // Remove villagers first, then other roles if necessary
              const villagerRole = roleConfig.find(r => r.role === GameRole.VILLAGER);
              if (villagerRole && villagerRole.count > Math.abs(difference)) {
                villagerRole.count += difference; // difference is negative
              }
            }
          }
        }
        
        if (roleConfig) {
          room.settings.gameSettings.roles = roleConfig;
          await room.save();
          logger.info(`Updated room ${room.code} with role configuration for ${maxPlayers} players`);
        }
      }
      
      // Create indexes for role-based queries
      await Room.collection.createIndex(
        { 'settings.gameSettings.roles.role': 1, 'settings.gameSettings.roles.count': 1 },
        { name: 'room_roles_index' }
      );
      
      logger.info('Game roles setup completed successfully');
      
    } catch (error) {
      logger.error('Game roles setup failed:', error);
      throw error;
    }
  },
  
  async down() {
    logger.info('Rolling back game roles setup...');
    
    try {
      // Remove role configurations from all rooms
      await Room.updateMany(
        {},
        { $unset: { 'settings.gameSettings.roles': 1 } }
      );
      
      // Drop the roles index
      try {
        await Room.collection.dropIndex('room_roles_index');
        logger.info('Dropped room roles index');
      } catch (error) {
        logger.warn('Could not drop room roles index:', error);
      }
      
      logger.info('Game roles setup rollback completed');
      
    } catch (error) {
      logger.error('Game roles setup rollback failed:', error);
      throw error;
    }
  }
};