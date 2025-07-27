import mongoose, { Model, Document, Types, FilterQuery, UpdateQuery, PipelineStage } from 'mongoose';
import { adminLogger } from '../config/logger';
import { AdminDatabaseUtils } from '../utils/adminDatabase';
import * as XLSX from 'xlsx';
import { Parser } from 'json2csv';

// Import main game models
import { Player, Game, Room, ChatMessage, AnalyticsEvent } from '../../models';

// Collection metadata interface
export interface CollectionMetadata {
  name: string;
  count: number;
  size: number;
  avgObjSize: number;
  indexes: any[];
  schema?: any;
}

// Query builder interface
export interface QueryBuilder {
  collection: string;
  filter?: any;
  sort?: any;
  limit?: number;
  skip?: number;
  select?: string;
  populate?: string | string[];
}

// Bulk operation interface
export interface BulkOperation {
  operation: 'insert' | 'update' | 'delete';
  filter?: any;
  data?: any;
  upsert?: boolean;
}

// Export format type
export type ExportFormat = 'json' | 'csv' | 'xlsx';

export class DatabaseOperationsService {
  // Available collections mapping
  private static readonly COLLECTIONS = {
    players: Player,
    games: Game,
    rooms: Room,
    chatmessages: ChatMessage,
    analytics: AnalyticsEvent
  };

  /**
   * Get all available collections with metadata
   */
  static async getCollections(): Promise<CollectionMetadata[]> {
    try {
      const collections: CollectionMetadata[] = [];
      
      for (const [name, model] of Object.entries(this.COLLECTIONS)) {
        try {
          const [count, indexes] = await Promise.all([
            model.countDocuments(),
            model.collection.getIndexes()
          ]);
          
          // Try to get collection stats, fallback if not available
          let stats: any = {};
          try {
            const collection = mongoose.connection.db?.collection(model.collection.name) as any;
            const collectionStats = await collection?.stats();
            stats = collectionStats || {};
          } catch (statsError) {
            // Stats not available, use defaults
            stats = { size: 0, avgObjSize: 0 };
          }
          
          collections.push({
            name,
            count,
            size: stats.size || 0,
            avgObjSize: stats.avgObjSize || 0,
            indexes: Object.keys(indexes || {}),
            schema: this.getSchemaInfo(model)
          });
        } catch (error) {
          adminLogger.warn(`Failed to get stats for collection ${name}`, {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          // Fallback to basic count
          const count = await model.countDocuments();
          collections.push({
            name,
            count,
            size: 0,
            avgObjSize: 0,
            indexes: [],
            schema: this.getSchemaInfo(model)
          });
        }
      }
      
      return collections;
    } catch (error) {
      adminLogger.error('Failed to get collections metadata', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get documents from a specific collection with pagination
   */
  static async getCollectionDocuments(
    collectionName: string,
    options: {
      page?: number;
      limit?: number;
      sort?: any;
      filter?: any;
      select?: string;
      populate?: string | string[];
    } = {}
  ) {
    try {
      const model = this.getModel(collectionName);
      const page = options.page || 1;
      const limit = Math.min(options.limit || 50, 1000); // Max 1000 documents per request
      const skip = (page - 1) * limit;

      // Build query
      let query = model.find(options.filter || {});
      
      if (options.select) {
        query = query.select(options.select);
      }
      
      if (options.populate) {
        query = query.populate(options.populate);
      }
      
      if (options.sort) {
        query = query.sort(options.sort);
      } else {
        query = query.sort({ _id: -1 }); // Default sort by newest
      }
      
      query = query.skip(skip).limit(limit);
      
      // Execute query and get total count
      const [documents, total] = await Promise.all([
        query.exec(),
        model.countDocuments(options.filter || {})
      ]);

      return {
        documents,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      adminLogger.error(`Failed to get documents from collection ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        options
      });
      throw error;
    }
  }

  /**
   * Create a new document in a collection
   */
  static async createDocument(collectionName: string, data: any) {
    try {
      const model = this.getModel(collectionName);
      
      // Validate and sanitize data
      const sanitizedData = this.sanitizeDocumentData(data);
      
      const document = new model(sanitizedData);
      const result = await document.save();
      
      adminLogger.info(`Created document in collection ${collectionName}`, {
        collectionName,
        documentId: result._id
      });
      
      return result;
    } catch (error) {
      adminLogger.error(`Failed to create document in collection ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        data
      });
      throw error;
    }
  }

  /**
   * Update a document by ID
   */
  static async updateDocument(
    collectionName: string,
    documentId: string,
    data: any,
    options: { upsert?: boolean } = {}
  ) {
    try {
      const model = this.getModel(collectionName);
      
      if (!Types.ObjectId.isValid(documentId)) {
        throw new Error('Invalid document ID format');
      }
      
      // Validate and sanitize data
      const sanitizedData = this.sanitizeDocumentData(data);
      
      const result = await model.findByIdAndUpdate(
        documentId,
        { $set: sanitizedData },
        { 
          new: true, 
          runValidators: true,
          upsert: options.upsert || false
        }
      );
      
      if (!result && !options.upsert) {
        throw new Error('Document not found');
      }
      
      adminLogger.info(`Updated document in collection ${collectionName}`, {
        collectionName,
        documentId,
        upsert: options.upsert
      });
      
      return result;
    } catch (error) {
      adminLogger.error(`Failed to update document in collection ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionName,
        documentId,
        data
      });
      throw error;
    }
  }

  /**
   * Soft delete a document by ID (adds deletedAt field)
   */
  static async deleteDocument(collectionName: string, documentId: string, hard = false) {
    try {
      const model = this.getModel(collectionName);
      
      if (!Types.ObjectId.isValid(documentId)) {
        throw new Error('Invalid document ID format');
      }
      
      let result;
      
      if (hard) {
        // Hard delete - permanently remove document
        result = await model.findByIdAndDelete(documentId);
      } else {
        // Soft delete - add deletedAt timestamp
        result = await model.findByIdAndUpdate(
          documentId,
          { 
            $set: { 
              deletedAt: new Date(),
              isDeleted: true 
            } 
          },
          { new: true }
        );
      }
      
      if (!result) {
        throw new Error('Document not found');
      }
      
      adminLogger.info(`${hard ? 'Hard' : 'Soft'} deleted document in collection ${collectionName}`, {
        collectionName,
        documentId,
        hard
      });
      
      return result;
    } catch (error) {
      adminLogger.error(`Failed to delete document in collection ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionName,
        documentId,
        hard
      });
      throw error;
    }
  }

  /**
   * Perform bulk operations on a collection
   */
  static async bulkOperations(collectionName: string, operations: BulkOperation[]) {
    try {
      const model = this.getModel(collectionName);
      
      if (!operations || operations.length === 0) {
        throw new Error('No operations provided');
      }
      
      if (operations.length > 1000) {
        throw new Error('Too many operations (max 1000)');
      }
      
      const bulkOps = operations.map(op => {
        switch (op.operation) {
          case 'insert':
            return {
              insertOne: {
                document: this.sanitizeDocumentData(op.data)
              }
            };
          case 'update':
            return {
              updateMany: {
                filter: op.filter || {},
                update: { $set: this.sanitizeDocumentData(op.data) },
                upsert: op.upsert || false
              }
            };
          case 'delete':
            return {
              updateMany: {
                filter: op.filter || {},
                update: { 
                  $set: { 
                    deletedAt: new Date(),
                    isDeleted: true 
                  } 
                }
              }
            };
          default:
            throw new Error(`Unsupported operation: ${op.operation}`);
        }
      });
      
      const result = await model.bulkWrite(bulkOps);
      
      adminLogger.info(`Performed bulk operations on collection ${collectionName}`, {
        collectionName,
        operationsCount: operations.length,
        result: {
          insertedCount: result.insertedCount,
          modifiedCount: result.modifiedCount,
          deletedCount: result.deletedCount,
          upsertedCount: result.upsertedCount
        }
      });
      
      return result;
    } catch (error) {
      adminLogger.error(`Failed to perform bulk operations on collection ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionName,
        operationsCount: operations.length
      });
      throw error;
    }
  }

  /**
   * Execute aggregation pipeline
   */
  static async executeAggregation(collectionName: string, pipeline: PipelineStage[]) {
    try {
      const model = this.getModel(collectionName);
      
      if (!pipeline || pipeline.length === 0) {
        throw new Error('Empty aggregation pipeline');
      }
      
      // Add safety limits to prevent resource exhaustion
      const safePipeline = [
        ...pipeline,
        { $limit: 10000 } // Max 10k results
      ];
      
      const result = await model.aggregate(safePipeline);
      
      adminLogger.info(`Executed aggregation on collection ${collectionName}`, {
        collectionName,
        pipelineStages: pipeline.length,
        resultCount: result.length
      });
      
      return result;
    } catch (error) {
      adminLogger.error(`Failed to execute aggregation on collection ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionName,
        pipeline
      });
      throw error;
    }
  }

  /**
   * Get collection statistics and indexing information
   */
  static async getCollectionStats(collectionName: string) {
    try {
      const model = this.getModel(collectionName);
      
      // Get basic info that's always available
      const [count, indexes, sampleDoc] = await Promise.all([
        model.countDocuments(),
        model.collection.getIndexes(),
        model.findOne().lean()
      ]);
      
      // Try to get collection stats, fallback if not available
      let stats: any = {};
      try {
        const collection = mongoose.connection.db?.collection(model.collection.name) as any;
        const collectionStats = await collection?.stats();
        stats = collectionStats || {};
      } catch (statsError) {
        // Stats not available, use defaults
        stats = { 
          count,
          size: 0, 
          avgObjSize: 0,
          storageSize: 0,
          totalIndexSize: 0,
          indexSizes: {}
        };
      }
      
      return {
        name: collectionName,
        stats: {
          count: stats.count || count,
          size: stats.size || 0,
          avgObjSize: stats.avgObjSize || 0,
          storageSize: stats.storageSize || 0,
          totalIndexSize: stats.totalIndexSize || 0,
          indexSizes: stats.indexSizes || {}
        },
        indexes: Object.entries(indexes || {}).map(([name, spec]) => ({
          name,
          spec,
          size: stats.indexSizes?.[name] || 0
        })),
        schema: this.getSchemaInfo(model),
        sampleDocument: sampleDoc
      };
    } catch (error) {
      adminLogger.error(`Failed to get collection stats for ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionName
      });
      throw error;
    }
  }

  /**
   * Export collection data in various formats
   */
  static async exportCollection(
    collectionName: string,
    format: ExportFormat,
    options: {
      filter?: any;
      select?: string;
      limit?: number;
    } = {}
  ) {
    try {
      const model = this.getModel(collectionName);
      const limit = Math.min(options.limit || 10000, 50000); // Max 50k documents
      
      let query = model.find(options.filter || {});
      
      if (options.select) {
        query = query.select(options.select);
      }
      
      query = query.limit(limit).lean();
      
      const documents = await query.exec();
      
      let exportData: Buffer;
      let mimeType: string;
      let filename: string;
      
      switch (format) {
        case 'json':
          exportData = Buffer.from(JSON.stringify(documents, null, 2));
          mimeType = 'application/json';
          filename = `${collectionName}_export.json`;
          break;
          
        case 'csv':
          if (documents.length === 0) {
            exportData = Buffer.from('');
          } else {
            const parser = new Parser();
            const csv = parser.parse(documents);
            exportData = Buffer.from(csv);
          }
          mimeType = 'text/csv';
          filename = `${collectionName}_export.csv`;
          break;
          
        case 'xlsx':
          const worksheet = XLSX.utils.json_to_sheet(documents);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, collectionName);
          exportData = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          filename = `${collectionName}_export.xlsx`;
          break;
          
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
      
      adminLogger.info(`Exported collection ${collectionName}`, {
        collectionName,
        format,
        documentCount: documents.length,
        fileSize: exportData.length
      });
      
      return {
        data: exportData,
        mimeType,
        filename,
        documentCount: documents.length
      };
    } catch (error) {
      adminLogger.error(`Failed to export collection ${collectionName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        collectionName,
        format
      });
      throw error;
    }
  }

  /**
   * Create database backup
   */
  static async createBackup(collections?: string[]) {
    try {
      const collectionsToBackup = collections || Object.keys(this.COLLECTIONS);
      const backup: any = {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        collections: {}
      };
      
      for (const collectionName of collectionsToBackup) {
        if (!this.COLLECTIONS[collectionName as keyof typeof this.COLLECTIONS]) {
          adminLogger.warn(`Skipping unknown collection: ${collectionName}`);
          continue;
        }
        
        const model = this.getModel(collectionName);
        const documents = await model.find().lean().limit(10000); // Limit for safety
        
        backup.collections[collectionName] = {
          count: documents.length,
          documents
        };
      }
      
      const backupData = Buffer.from(JSON.stringify(backup, null, 2));
      
      adminLogger.info('Created database backup', {
        collections: collectionsToBackup,
        totalSize: backupData.length
      });
      
      return {
        data: backupData,
        filename: `database_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        mimeType: 'application/json'
      };
    } catch (error) {
      adminLogger.error('Failed to create database backup', {
        error: error instanceof Error ? error.message : 'Unknown error',
        collections
      });
      throw error;
    }
  }

  /**
   * Restore database from backup
   */
  static async restoreBackup(backupData: any, options: { overwrite?: boolean } = {}) {
    try {
      if (!backupData.collections) {
        throw new Error('Invalid backup format');
      }
      
      const results: any = {};
      
      for (const [collectionName, collectionData] of Object.entries(backupData.collections as any)) {
        if (!this.COLLECTIONS[collectionName as keyof typeof this.COLLECTIONS]) {
          adminLogger.warn(`Skipping unknown collection in backup: ${collectionName}`);
          continue;
        }
        
        const model = this.getModel(collectionName);
        
        if (options.overwrite) {
          // Clear existing data
          await model.deleteMany({});
        }
        
        // Insert backup data
        const documents = (collectionData as any).documents || [];
        if (documents.length > 0) {
          const insertResult = await model.insertMany(documents, { ordered: false });
          results[collectionName] = {
            inserted: insertResult.length,
            skipped: documents.length - insertResult.length
          };
        } else {
          results[collectionName] = { inserted: 0, skipped: 0 };
        }
      }
      
      adminLogger.info('Restored database from backup', {
        results,
        overwrite: options.overwrite
      });
      
      return results;
    } catch (error) {
      adminLogger.error('Failed to restore database from backup', {
        error: error instanceof Error ? error.message : 'Unknown error',
        overwrite: options.overwrite
      });
      throw error;
    }
  }

  // Helper methods

  /**
   * Get model by collection name
   */
  private static getModel(collectionName: string): Model<any> {
    const model = this.COLLECTIONS[collectionName as keyof typeof this.COLLECTIONS];
    if (!model) {
      throw new Error(`Unknown collection: ${collectionName}`);
    }
    return model;
  }

  /**
   * Get schema information from model
   */
  private static getSchemaInfo(model: Model<any>) {
    try {
      const schema = model.schema;
      const paths = schema.paths;
      
      const fields: any = {};
      
      for (const [path, schemaType] of Object.entries(paths)) {
        if (path === '_id' || path === '__v') continue;
        
        fields[path] = {
          type: (schemaType as any).instance || 'Mixed',
          required: (schemaType as any).isRequired || false,
          default: (schemaType as any).defaultValue,
          enum: (schemaType as any).enumValues
        };
      }
      
      return {
        fields,
        indexes: schema.indexes(),
        virtuals: Object.keys(schema.virtuals)
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Sanitize document data to prevent injection
   */
  private static sanitizeDocumentData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      // Skip dangerous keys
      if (key.startsWith('$') || key.includes('.')) {
        continue;
      }
      
      // Recursively sanitize nested objects
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        sanitized[key] = this.sanitizeDocumentData(value);
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
}