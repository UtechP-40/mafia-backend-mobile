import { getAdminConnection } from '../config/database';
import { adminLogger } from '../config/logger';

// Import all migrations
import * as migration001 from './001_admin_collections_setup';
import * as migration002 from './002_admin_performance_indexes';

// Migration interface
interface Migration {
  up: () => Promise<void>;
  down: () => Promise<void>;
  migrationInfo: {
    version: string;
    name: string;
    description: string;
    createdAt: Date;
  };
}

// Registry of all migrations
const migrations: Migration[] = [
  migration001,
  migration002
];

// Migration tracking collection
const MIGRATION_COLLECTION = 'admin_migrations';

interface MigrationRecord {
  version: string;
  name: string;
  description: string;
  appliedAt: Date;
  rollbackAt?: Date;
  status: 'applied' | 'rolled_back';
}

/**
 * Get the migration tracking collection
 */
function getMigrationCollection() {
  const connection = getAdminConnection();
  return connection.db.collection<MigrationRecord>(MIGRATION_COLLECTION);
}

/**
 * Get applied migrations from database
 */
async function getAppliedMigrations(): Promise<MigrationRecord[]> {
  try {
    const collection = getMigrationCollection();
    return await collection.find({ status: 'applied' }).sort({ version: 1 }).toArray();
  } catch (error) {
    adminLogger.warn('Could not get applied migrations, assuming none applied', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return [];
  }
}

/**
 * Record migration as applied
 */
async function recordMigrationApplied(migration: Migration): Promise<void> {
  const collection = getMigrationCollection();
  const record: MigrationRecord = {
    version: migration.migrationInfo.version,
    name: migration.migrationInfo.name,
    description: migration.migrationInfo.description,
    appliedAt: new Date(),
    status: 'applied'
  };
  
  await collection.replaceOne(
    { version: migration.migrationInfo.version },
    record,
    { upsert: true }
  );
}

/**
 * Record migration as rolled back
 */
async function recordMigrationRolledBack(migration: Migration): Promise<void> {
  const collection = getMigrationCollection();
  await collection.updateOne(
    { version: migration.migrationInfo.version },
    {
      $set: {
        rollbackAt: new Date(),
        status: 'rolled_back'
      }
    }
  );
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  try {
    adminLogger.info('Starting admin database migrations...');
    
    const appliedMigrations = await getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    
    let migrationsRun = 0;
    
    for (const migration of migrations) {
      const version = migration.migrationInfo.version;
      
      if (!appliedVersions.has(version)) {
        adminLogger.info(`Running migration ${version}: ${migration.migrationInfo.name}`);
        
        try {
          await migration.up();
          await recordMigrationApplied(migration);
          migrationsRun++;
          
          adminLogger.info(`Migration ${version} completed successfully`);
        } catch (error) {
          adminLogger.error(`Migration ${version} failed`, {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
          });
          throw error;
        }
      } else {
        adminLogger.debug(`Migration ${version} already applied, skipping`);
      }
    }
    
    if (migrationsRun > 0) {
      adminLogger.info(`Admin database migrations completed. ${migrationsRun} migrations applied.`);
    } else {
      adminLogger.info('All admin database migrations are up to date.');
    }
    
  } catch (error) {
    adminLogger.error('Admin database migrations failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Rollback the last applied migration
 */
export async function rollbackLastMigration(): Promise<void> {
  try {
    adminLogger.info('Rolling back last admin database migration...');
    
    const appliedMigrations = await getAppliedMigrations();
    
    if (appliedMigrations.length === 0) {
      adminLogger.info('No migrations to rollback');
      return;
    }
    
    // Get the last applied migration
    const lastMigration = appliedMigrations[appliedMigrations.length - 1];
    const migration = migrations.find(m => m.migrationInfo.version === lastMigration.version);
    
    if (!migration) {
      throw new Error(`Migration ${lastMigration.version} not found in migration registry`);
    }
    
    adminLogger.info(`Rolling back migration ${lastMigration.version}: ${lastMigration.name}`);
    
    try {
      await migration.down();
      await recordMigrationRolledBack(migration);
      
      adminLogger.info(`Migration ${lastMigration.version} rolled back successfully`);
    } catch (error) {
      adminLogger.error(`Migration ${lastMigration.version} rollback failed`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
    
  } catch (error) {
    adminLogger.error('Admin database migration rollback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Rollback to a specific migration version
 */
export async function rollbackToVersion(targetVersion: string): Promise<void> {
  try {
    adminLogger.info(`Rolling back admin database to migration version ${targetVersion}...`);
    
    const appliedMigrations = await getAppliedMigrations();
    const targetIndex = appliedMigrations.findIndex(m => m.version === targetVersion);
    
    if (targetIndex === -1) {
      throw new Error(`Target migration version ${targetVersion} not found or not applied`);
    }
    
    // Rollback migrations in reverse order
    const migrationsToRollback = appliedMigrations.slice(targetIndex + 1).reverse();
    
    for (const migrationRecord of migrationsToRollback) {
      const migration = migrations.find(m => m.migrationInfo.version === migrationRecord.version);
      
      if (!migration) {
        adminLogger.warn(`Migration ${migrationRecord.version} not found in registry, skipping rollback`);
        continue;
      }
      
      adminLogger.info(`Rolling back migration ${migrationRecord.version}: ${migrationRecord.name}`);
      
      try {
        await migration.down();
        await recordMigrationRolledBack(migration);
        
        adminLogger.info(`Migration ${migrationRecord.version} rolled back successfully`);
      } catch (error) {
        adminLogger.error(`Migration ${migrationRecord.version} rollback failed`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
      }
    }
    
    adminLogger.info(`Successfully rolled back to migration version ${targetVersion}`);
    
  } catch (error) {
    adminLogger.error('Admin database migration rollback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{
  totalMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  migrations: Array<{
    version: string;
    name: string;
    description: string;
    status: 'applied' | 'pending' | 'rolled_back';
    appliedAt?: Date;
    rollbackAt?: Date;
  }>;
}> {
  try {
    const appliedMigrations = await getAppliedMigrations();
    const appliedVersions = new Map(appliedMigrations.map(m => [m.version, m]));
    
    const migrationStatus = migrations.map(migration => {
      const applied = appliedVersions.get(migration.migrationInfo.version);
      
      return {
        version: migration.migrationInfo.version,
        name: migration.migrationInfo.name,
        description: migration.migrationInfo.description,
        status: applied ? applied.status : 'pending' as const,
        appliedAt: applied?.appliedAt,
        rollbackAt: applied?.rollbackAt
      };
    });
    
    const appliedCount = migrationStatus.filter(m => m.status === 'applied').length;
    const pendingCount = migrationStatus.filter(m => m.status === 'pending').length;
    
    return {
      totalMigrations: migrations.length,
      appliedMigrations: appliedCount,
      pendingMigrations: pendingCount,
      migrations: migrationStatus
    };
    
  } catch (error) {
    adminLogger.error('Failed to get migration status', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Reset all migrations (dangerous - use with caution)
 */
export async function resetMigrations(): Promise<void> {
  try {
    adminLogger.warn('Resetting all admin database migrations...');
    
    const appliedMigrations = await getAppliedMigrations();
    
    // Rollback all migrations in reverse order
    for (const migrationRecord of appliedMigrations.reverse()) {
      const migration = migrations.find(m => m.migrationInfo.version === migrationRecord.version);
      
      if (!migration) {
        adminLogger.warn(`Migration ${migrationRecord.version} not found in registry, skipping rollback`);
        continue;
      }
      
      adminLogger.info(`Rolling back migration ${migrationRecord.version}: ${migrationRecord.name}`);
      
      try {
        await migration.down();
        adminLogger.info(`Migration ${migrationRecord.version} rolled back successfully`);
      } catch (error) {
        adminLogger.error(`Migration ${migrationRecord.version} rollback failed`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Continue with other rollbacks even if one fails
      }
    }
    
    // Clear migration tracking collection
    const collection = getMigrationCollection();
    await collection.deleteMany({});
    
    adminLogger.warn('All admin database migrations have been reset');
    
  } catch (error) {
    adminLogger.error('Failed to reset migrations', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

// Export migration utilities
export {
  migrations,
  Migration,
  MigrationRecord
};