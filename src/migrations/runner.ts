import { migrationRunner } from './index';
import { initialSetupMigration } from './001_initial_setup';
import { gameRolesSetupMigration } from './002_game_roles_setup';
import { connectDatabase } from '../utils/database';
import { logger } from '../utils/logger';

// Register all migrations
migrationRunner.register(initialSetupMigration);
migrationRunner.register(gameRolesSetupMigration);

/**
 * Run migrations from command line
 */
async function runMigrations() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Connected to database for migrations');
    
    // Get command line arguments
    const command = process.argv[2];
    
    switch (command) {
      case 'up':
        await migrationRunner.up();
        break;
        
      case 'down':
        await migrationRunner.down();
        break;
        
      case 'status':
        const status = await migrationRunner.status();
        logger.info('Migration Status:');
        logger.info(`Total migrations: ${status.total}`);
        logger.info(`Applied: ${status.applied.length} - ${status.applied.join(', ')}`);
        logger.info(`Pending: ${status.pending.length} - ${status.pending.join(', ')}`);
        break;
        
      default:
        logger.info('Usage: npm run migrate [up|down|status]');
        logger.info('  up     - Run all pending migrations');
        logger.info('  down   - Rollback the last migration');
        logger.info('  status - Show migration status');
        break;
    }
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runMigrations();
}

export { migrationRunner };