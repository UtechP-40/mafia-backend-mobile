import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export interface Migration {
  version: string;
  description: string;
  up: () => Promise<void>;
  down: () => Promise<void>;
}

// Migration tracking schema
const migrationSchema = new mongoose.Schema({
  version: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  appliedAt: { type: Date, default: Date.now }
});

const MigrationModel = mongoose.model('Migration', migrationSchema);

export class MigrationRunner {
  private migrations: Migration[] = [];

  /**
   * Register a migration
   */
  register(migration: Migration) {
    this.migrations.push(migration);
    // Sort migrations by version
    this.migrations.sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Get applied migrations
   */
  private async getAppliedMigrations(): Promise<string[]> {
    try {
      const applied = await MigrationModel.find({}).sort({ version: 1 });
      return applied.map(m => m.version);
    } catch (error) {
      logger.error('Error fetching applied migrations:', error);
      return [];
    }
  }

  /**
   * Mark migration as applied
   */
  private async markAsApplied(migration: Migration) {
    try {
      await MigrationModel.create({
        version: migration.version,
        description: migration.description
      });
      logger.info(`Migration ${migration.version} marked as applied`);
    } catch (error) {
      logger.error(`Error marking migration ${migration.version} as applied:`, error);
      throw error;
    }
  }

  /**
   * Remove migration from applied list
   */
  private async markAsUnapplied(version: string) {
    try {
      await MigrationModel.deleteOne({ version });
      logger.info(`Migration ${version} marked as unapplied`);
    } catch (error) {
      logger.error(`Error marking migration ${version} as unapplied:`, error);
      throw error;
    }
  }

  /**
   * Run pending migrations
   */
  async up(): Promise<void> {
    try {
      const appliedMigrations = await this.getAppliedMigrations();
      const pendingMigrations = this.migrations.filter(
        m => !appliedMigrations.includes(m.version)
      );

      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations to run');
        return;
      }

      logger.info(`Running ${pendingMigrations.length} pending migrations...`);

      for (const migration of pendingMigrations) {
        logger.info(`Running migration ${migration.version}: ${migration.description}`);
        
        try {
          await migration.up();
          await this.markAsApplied(migration);
          logger.info(`Migration ${migration.version} completed successfully`);
        } catch (error) {
          logger.error(`Migration ${migration.version} failed:`, error);
          throw error;
        }
      }

      logger.info('All migrations completed successfully');
    } catch (error) {
      logger.error('Migration process failed:', error);
      throw error;
    }
  }

  /**
   * Rollback the last migration
   */
  async down(): Promise<void> {
    try {
      const appliedMigrations = await this.getAppliedMigrations();
      
      if (appliedMigrations.length === 0) {
        logger.info('No migrations to rollback');
        return;
      }

      const lastAppliedVersion = appliedMigrations[appliedMigrations.length - 1];
      const migration = this.migrations.find(m => m.version === lastAppliedVersion);

      if (!migration) {
        throw new Error(`Migration ${lastAppliedVersion} not found in registered migrations`);
      }

      logger.info(`Rolling back migration ${migration.version}: ${migration.description}`);
      
      try {
        await migration.down();
        await this.markAsUnapplied(migration.version);
        logger.info(`Migration ${migration.version} rolled back successfully`);
      } catch (error) {
        logger.error(`Migration rollback ${migration.version} failed:`, error);
        throw error;
      }
    } catch (error) {
      logger.error('Migration rollback failed:', error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async status(): Promise<{
    applied: string[];
    pending: string[];
    total: number;
  }> {
    try {
      const appliedMigrations = await this.getAppliedMigrations();
      const allMigrations = this.migrations.map(m => m.version);
      const pendingMigrations = allMigrations.filter(
        v => !appliedMigrations.includes(v)
      );

      return {
        applied: appliedMigrations,
        pending: pendingMigrations,
        total: allMigrations.length
      };
    } catch (error) {
      logger.error('Error getting migration status:', error);
      throw error;
    }
  }
}

// Global migration runner instance
export const migrationRunner = new MigrationRunner();