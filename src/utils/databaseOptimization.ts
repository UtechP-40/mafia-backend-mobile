import mongoose, { Connection, Model, Document } from 'mongoose';

export interface QueryOptimizationOptions {
  enableProfiling?: boolean;
  slowQueryThreshold?: number;
  enableIndexHints?: boolean;
  enableQueryCache?: boolean;
}

export interface QueryPerformanceMetrics {
  query: string;
  executionTime: number;
  documentsExamined: number;
  documentsReturned: number;
  indexUsed: boolean;
  timestamp: Date;
}

class DatabaseOptimizer {
  private static instance: DatabaseOptimizer;
  private queryMetrics: QueryPerformanceMetrics[] = [];
  private slowQueryThreshold = 100; // milliseconds
  private maxMetricsHistory = 1000;

  static getInstance(): DatabaseOptimizer {
    if (!DatabaseOptimizer.instance) {
      DatabaseOptimizer.instance = new DatabaseOptimizer();
    }
    return DatabaseOptimizer.instance;
  }

  async setupIndexes(): Promise<void> {
    try {
      // Player indexes
      await this.createPlayerIndexes();
      
      // Game indexes
      await this.createGameIndexes();
      
      // Room indexes
      await this.createRoomIndexes();
      
      // Chat message indexes
      await this.createChatMessageIndexes();
      
      console.log('Database indexes created successfully');
    } catch (error) {
      console.error('Error creating database indexes:', error);
      throw error;
    }
  }

  private async createPlayerIndexes(): Promise<void> {
    const Player = mongoose.model('Player');
    
    // Unique index on username for fast lookups
    await Player.collection.createIndex({ username: 1 }, { unique: true });
    
    // Unique index on email for authentication
    await Player.collection.createIndex({ email: 1 }, { unique: true });
    
    // Compound index for friend queries
    await Player.collection.createIndex({ 'friends.playerId': 1, 'friends.status': 1 });
    
    // Index for ELO-based matchmaking
    await Player.collection.createIndex({ 'statistics.eloRating': -1 });
    
    // Index for active players
    await Player.collection.createIndex({ lastActive: -1 });
    
    // Compound index for leaderboard queries
    await Player.collection.createIndex({ 
      'statistics.gamesWon': -1, 
      'statistics.winRate': -1 
    });
  }

  private async createGameIndexes(): Promise<void> {
    const Game = mongoose.model('Game');
    
    // Index for active games
    await Game.collection.createIndex({ status: 1, updatedAt: -1 });
    
    // Compound index for player game history
    await Game.collection.createIndex({ 'players.playerId': 1, createdAt: -1 });
    
    // Index for room-based game queries
    await Game.collection.createIndex({ roomId: 1, status: 1 });
    
    // Index for game phase queries
    await Game.collection.createIndex({ phase: 1, updatedAt: -1 });
    
    // TTL index for completed games (optional cleanup after 30 days)
    await Game.collection.createIndex(
      { updatedAt: 1 }, 
      { expireAfterSeconds: 30 * 24 * 60 * 60 }
    );
  }

  private async createRoomIndexes(): Promise<void> {
    const Room = mongoose.model('Room');
    
    // Unique index on room code
    await Room.collection.createIndex({ code: 1 }, { unique: true });
    
    // Index for public room discovery
    await Room.collection.createIndex({ 
      'settings.isPublic': 1, 
      status: 1, 
      updatedAt: -1 
    });
    
    // Index for host queries
    await Room.collection.createIndex({ hostId: 1, status: 1 });
    
    // Compound index for room capacity filtering
    await Room.collection.createIndex({ 
      'settings.isPublic': 1,
      'settings.maxPlayers': 1,
      'players': 1
    });
  }

  private async createChatMessageIndexes(): Promise<void> {
    const ChatMessage = mongoose.model('ChatMessage');
    
    // Compound index for room chat queries
    await ChatMessage.collection.createIndex({ roomId: 1, timestamp: -1 });
    
    // Index for player message history
    await ChatMessage.collection.createIndex({ playerId: 1, timestamp: -1 });
    
    // Index for moderation queries
    await ChatMessage.collection.createIndex({ isModerated: 1, timestamp: -1 });
    
    // TTL index for message cleanup (optional, keep messages for 7 days)
    await ChatMessage.collection.createIndex(
      { timestamp: 1 }, 
      { expireAfterSeconds: 7 * 24 * 60 * 60 }
    );
  }

  enableQueryProfiling(connection: Connection): void {
    connection.db.admin().command({ profile: 2, slowms: this.slowQueryThreshold });
    console.log(`Query profiling enabled with ${this.slowQueryThreshold}ms threshold`);
  }

  async analyzeSlowQueries(connection: Connection): Promise<any[]> {
    const profileCollection = connection.db.collection('system.profile');
    const slowQueries = await profileCollection
      .find({ 
        ts: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
        millis: { $gte: this.slowQueryThreshold }
      })
      .sort({ ts: -1 })
      .limit(100)
      .toArray();

    return slowQueries;
  }

  createOptimizedQuery<T extends Document>(model: Model<T>) {
    return {
      // Optimized pagination
      paginate: async (
        filter: any = {}, 
        page: number = 1, 
        limit: number = 20,
        sort: any = { createdAt: -1 }
      ) => {
        const skip = (page - 1) * limit;
        
        const [data, total] = await Promise.all([
          model
            .find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(), // Use lean() for better performance
          model.countDocuments(filter)
        ]);

        return {
          data,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
            hasNext: page * limit < total,
            hasPrev: page > 1
          }
        };
      },

      // Optimized aggregation with proper indexing
      aggregate: (pipeline: any[]) => {
        // Add index hints for better performance
        const optimizedPipeline = [
          { $hint: this.getOptimalIndex(model, pipeline) },
          ...pipeline
        ];
        
        return model.aggregate(optimizedPipeline);
      },

      // Bulk operations for better performance
      bulkWrite: async (operations: any[]) => {
        const batchSize = 1000;
        const results = [];
        
        for (let i = 0; i < operations.length; i += batchSize) {
          const batch = operations.slice(i, i + batchSize);
          const result = await model.bulkWrite(batch, { ordered: false });
          results.push(result);
        }
        
        return results;
      },

      // Optimized search with text indexes
      textSearch: async (
        searchTerm: string,
        filter: any = {},
        options: any = {}
      ) => {
        return model
          .find({
            $text: { $search: searchTerm },
            ...filter
          })
          .sort({ score: { $meta: 'textScore' } })
          .limit(options.limit || 20)
          .lean();
      }
    };
  }

  private getOptimalIndex(model: Model<any>, pipeline: any[]): string {
    // Simple heuristic to suggest optimal index based on pipeline
    const firstStage = pipeline[0];
    
    if (firstStage && firstStage.$match) {
      const matchFields = Object.keys(firstStage.$match);
      return matchFields[0]; // Use first field as index hint
    }
    
    return '_id'; // Default fallback
  }

  // Connection pooling optimization
  optimizeConnectionPool(): mongoose.ConnectOptions {
    return {
      maxPoolSize: 10, // Maximum number of connections
      minPoolSize: 2,  // Minimum number of connections
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      serverSelectionTimeoutMS: 5000, // How long to try selecting a server
      socketTimeoutMS: 45000, // How long a send or receive on a socket can take
      bufferMaxEntries: 0, // Disable mongoose buffering
      bufferCommands: false, // Disable mongoose buffering
    };
  }

  // Query performance monitoring
  monitorQuery<T>(queryName: string, queryFn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    
    return queryFn()
      .then(result => {
        const executionTime = Date.now() - startTime;
        
        if (executionTime > this.slowQueryThreshold) {
          console.warn(`Slow query detected: ${queryName} took ${executionTime}ms`);
        }
        
        this.recordQueryMetrics({
          query: queryName,
          executionTime,
          documentsExamined: 0, // Would need to be extracted from explain()
          documentsReturned: Array.isArray(result) ? result.length : 1,
          indexUsed: true, // Would need to be determined from explain()
          timestamp: new Date()
        });
        
        return result;
      })
      .catch(error => {
        console.error(`Query error in ${queryName}:`, error);
        throw error;
      });
  }

  private recordQueryMetrics(metrics: QueryPerformanceMetrics): void {
    this.queryMetrics.push(metrics);
    
    // Keep metrics history manageable
    if (this.queryMetrics.length > this.maxMetricsHistory) {
      this.queryMetrics = this.queryMetrics.slice(-this.maxMetricsHistory);
    }
  }

  getQueryMetrics(): QueryPerformanceMetrics[] {
    return [...this.queryMetrics];
  }

  getSlowQueries(threshold?: number): QueryPerformanceMetrics[] {
    const slowThreshold = threshold || this.slowQueryThreshold;
    return this.queryMetrics.filter(metric => metric.executionTime > slowThreshold);
  }

  // Database health check
  async performHealthCheck(connection: Connection): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    metrics: any;
  }> {
    try {
      const adminDb = connection.db.admin();
      const serverStatus = await adminDb.command({ serverStatus: 1 });
      const dbStats = await connection.db.stats();
      
      const metrics = {
        connections: serverStatus.connections,
        memory: serverStatus.mem,
        operations: serverStatus.opcounters,
        database: {
          collections: dbStats.collections,
          objects: dbStats.objects,
          dataSize: dbStats.dataSize,
          indexSize: dbStats.indexSize
        },
        slowQueries: this.getSlowQueries().length
      };
      
      // Determine health status
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      
      if (metrics.connections.current > metrics.connections.available * 0.8) {
        status = 'warning';
      }
      
      if (metrics.slowQueries > 10) {
        status = 'warning';
      }
      
      if (metrics.connections.current > metrics.connections.available * 0.95) {
        status = 'critical';
      }
      
      return { status, metrics };
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        status: 'critical',
        metrics: { error: error.message }
      };
    }
  }
}

export const databaseOptimizer = DatabaseOptimizer.getInstance();

// Middleware for automatic query optimization
export const queryOptimizationMiddleware = (options: QueryOptimizationOptions = {}) => {
  return (req: any, res: any, next: any) => {
    const originalQuery = mongoose.Query.prototype.exec;
    
    mongoose.Query.prototype.exec = function(callback?: any) {
      const queryName = `${this.model.modelName}.${this.op}`;
      const startTime = Date.now();
      
      const result = originalQuery.call(this, callback);
      
      if (result && typeof result.then === 'function') {
        return result.then((data: any) => {
          const executionTime = Date.now() - startTime;
          
          if (options.enableProfiling && executionTime > (options.slowQueryThreshold || 100)) {
            console.warn(`Slow query: ${queryName} took ${executionTime}ms`);
          }
          
          return data;
        });
      }
      
      return result;
    };
    
    next();
  };
};