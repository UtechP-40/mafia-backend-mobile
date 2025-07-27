import { DatabaseOperationsService } from '../services/DatabaseOperationsService';
import { Player, Game, Room, ChatMessage } from '../../models';
import mongoose from 'mongoose';
import { adminLogger } from '../config/logger';

// Mock the admin logger
jest.mock('../config/logger', () => ({
  adminLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock the models
jest.mock('../../models', () => ({
  Player: {
    collection: { name: 'players', getIndexes: jest.fn(), stats: jest.fn() },
    countDocuments: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    bulkWrite: jest.fn(),
    aggregate: jest.fn(),
    schema: {
      paths: {
        username: { instance: 'String', isRequired: true },
        email: { instance: 'String', isRequired: true },
        _id: { instance: 'ObjectId' },
        __v: { instance: 'Number' }
      },
      indexes: jest.fn(() => []),
      virtuals: {}
    }
  },
  Game: {
    collection: { name: 'games', getIndexes: jest.fn(), stats: jest.fn() },
    countDocuments: jest.fn(),
    find: jest.fn(),
    schema: { paths: {}, indexes: jest.fn(() => []), virtuals: {} }
  },
  Room: {
    collection: { name: 'rooms', getIndexes: jest.fn(), stats: jest.fn() },
    countDocuments: jest.fn(),
    find: jest.fn(),
    schema: { paths: {}, indexes: jest.fn(() => []), virtuals: {} }
  },
  ChatMessage: {
    collection: { name: 'chatmessages', getIndexes: jest.fn(), stats: jest.fn() },
    countDocuments: jest.fn(),
    find: jest.fn(),
    schema: { paths: {}, indexes: jest.fn(() => []), virtuals: {} }
  },
  Analytics: {
    collection: { name: 'analytics', getIndexes: jest.fn(), stats: jest.fn() },
    countDocuments: jest.fn(),
    find: jest.fn(),
    schema: { paths: {}, indexes: jest.fn(() => []), virtuals: {} }
  }
}));

// Mock mongoose connection
jest.mock('mongoose', () => ({
  connection: {
    db: {
      collection: jest.fn(() => ({
        stats: jest.fn()
      }))
    }
  },
  Types: {
    ObjectId: {
      isValid: jest.fn()
    }
  }
}));

describe('DatabaseOperationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCollections', () => {
    it('should return collections metadata', async () => {
      // Mock collection stats
      const mockStats = {
        count: 100,
        size: 1024,
        avgObjSize: 10.24
      };

      const mockIndexes = {
        '_id_': { _id: 1 },
        'username_1': { username: 1 }
      };

      (Player.collection.stats as jest.Mock).mockResolvedValue(mockStats);
      (Player.collection.getIndexes as jest.Mock).mockResolvedValue(mockIndexes);
      (Player.countDocuments as jest.Mock).mockResolvedValue(100);

      // Mock mongoose connection
      (mongoose.connection.db?.collection as jest.Mock).mockReturnValue({
        stats: jest.fn().mockResolvedValue(mockStats)
      });

      const result = await DatabaseOperationsService.getCollections();

      expect(result).toHaveLength(5); // players, games, rooms, chatmessages, analytics
      expect(result[0]).toMatchObject({
        name: 'players',
        count: 100,
        size: 1024,
        avgObjSize: 10.24,
        indexes: ['_id_', 'username_1']
      });
    });

    it('should handle collection stats errors gracefully', async () => {
      (mongoose.connection.db?.collection as jest.Mock).mockReturnValue({
        stats: jest.fn().mockRejectedValue(new Error('Stats error'))
      });
      (Player.countDocuments as jest.Mock).mockResolvedValue(50);

      const result = await DatabaseOperationsService.getCollections();

      expect(result[0]).toMatchObject({
        name: 'players',
        count: 50,
        size: 0,
        avgObjSize: 0,
        indexes: []
      });
      expect(adminLogger.warn).toHaveBeenCalled();
    });
  });

  describe('getCollectionDocuments', () => {
    it('should return paginated documents', async () => {
      const mockDocuments = [
        { _id: '1', username: 'user1' },
        { _id: '2', username: 'user2' }
      ];

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockDocuments)
      };

      (Player.find as jest.Mock).mockReturnValue(mockQuery);
      (Player.countDocuments as jest.Mock).mockResolvedValue(100);

      const result = await DatabaseOperationsService.getCollectionDocuments('players', {
        page: 1,
        limit: 10,
        sort: { username: 1 },
        filter: { active: true },
        select: 'username email',
        populate: 'friends'
      });

      expect(result.documents).toEqual(mockDocuments);
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 100,
        pages: 10,
        hasNext: true,
        hasPrev: false
      });

      expect(mockQuery.select).toHaveBeenCalledWith('username email');
      expect(mockQuery.populate).toHaveBeenCalledWith('friends');
      expect(mockQuery.sort).toHaveBeenCalledWith({ username: 1 });
      expect(mockQuery.skip).toHaveBeenCalledWith(0);
      expect(mockQuery.limit).toHaveBeenCalledWith(10);
    });

    it('should enforce maximum limit', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };

      (Player.find as jest.Mock).mockReturnValue(mockQuery);
      (Player.countDocuments as jest.Mock).mockResolvedValue(0);

      await DatabaseOperationsService.getCollectionDocuments('players', {
        limit: 2000 // Should be capped at 1000
      });

      expect(mockQuery.limit).toHaveBeenCalledWith(1000);
    });

    it('should throw error for unknown collection', async () => {
      await expect(
        DatabaseOperationsService.getCollectionDocuments('unknown')
      ).rejects.toThrow('Unknown collection: unknown');
    });
  });

  describe('createDocument', () => {
    it('should create a new document', async () => {
      const mockData = { username: 'newuser', email: 'test@example.com' };
      const mockDocument = { _id: 'new-id', ...mockData, save: jest.fn() };
      
      mockDocument.save.mockResolvedValue(mockDocument);
      (Player as any).mockImplementation(() => mockDocument);

      const result = await DatabaseOperationsService.createDocument('players', mockData);

      expect(result).toEqual(mockDocument);
      expect(mockDocument.save).toHaveBeenCalled();
      expect(adminLogger.info).toHaveBeenCalledWith(
        'Created document in collection players',
        { collectionName: 'players', documentId: 'new-id' }
      );
    });

    it('should sanitize dangerous data', async () => {
      const dangerousData = {
        username: 'user',
        $set: { admin: true }, // Should be removed
        'field.with.dots': 'value' // Should be removed
      };

      const mockDocument = { 
        _id: 'new-id', 
        username: 'user',
        save: jest.fn().mockResolvedValue({ _id: 'new-id', username: 'user' })
      };
      
      (Player as any).mockImplementation((data: any) => {
        expect(data).not.toHaveProperty('$set');
        expect(data).not.toHaveProperty('field.with.dots');
        return mockDocument;
      });

      await DatabaseOperationsService.createDocument('players', dangerousData);
    });
  });

  describe('updateDocument', () => {
    it('should update document by ID', async () => {
      const mockUpdatedDoc = { _id: 'test-id', username: 'updated' };
      
      (mongoose.Types.ObjectId.isValid as jest.Mock).mockReturnValue(true);
      (Player.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockUpdatedDoc);

      const result = await DatabaseOperationsService.updateDocument(
        'players',
        'test-id',
        { username: 'updated' }
      );

      expect(result).toEqual(mockUpdatedDoc);
      expect(Player.findByIdAndUpdate).toHaveBeenCalledWith(
        'test-id',
        { $set: { username: 'updated' } },
        { new: true, runValidators: true, upsert: false }
      );
    });

    it('should throw error for invalid ID', async () => {
      (mongoose.Types.ObjectId.isValid as jest.Mock).mockReturnValue(false);

      await expect(
        DatabaseOperationsService.updateDocument('players', 'invalid-id', {})
      ).rejects.toThrow('Invalid document ID format');
    });

    it('should throw error when document not found', async () => {
      (mongoose.Types.ObjectId.isValid as jest.Mock).mockReturnValue(true);
      (Player.findByIdAndUpdate as jest.Mock).mockResolvedValue(null);

      await expect(
        DatabaseOperationsService.updateDocument('players', 'test-id', {})
      ).rejects.toThrow('Document not found');
    });
  });

  describe('deleteDocument', () => {
    it('should perform soft delete by default', async () => {
      const mockDoc = { _id: 'test-id', deletedAt: new Date(), isDeleted: true };
      
      (mongoose.Types.ObjectId.isValid as jest.Mock).mockReturnValue(true);
      (Player.findByIdAndUpdate as jest.Mock).mockResolvedValue(mockDoc);

      const result = await DatabaseOperationsService.deleteDocument('players', 'test-id');

      expect(result).toEqual(mockDoc);
      expect(Player.findByIdAndUpdate).toHaveBeenCalledWith(
        'test-id',
        { $set: { deletedAt: expect.any(Date), isDeleted: true } },
        { new: true }
      );
    });

    it('should perform hard delete when requested', async () => {
      const mockDoc = { _id: 'test-id', username: 'deleted' };
      
      (mongoose.Types.ObjectId.isValid as jest.Mock).mockReturnValue(true);
      (Player.findByIdAndDelete as jest.Mock).mockResolvedValue(mockDoc);

      const result = await DatabaseOperationsService.deleteDocument('players', 'test-id', true);

      expect(result).toEqual(mockDoc);
      expect(Player.findByIdAndDelete).toHaveBeenCalledWith('test-id');
    });
  });

  describe('bulkOperations', () => {
    it('should perform bulk operations', async () => {
      const operations = [
        { operation: 'insert' as const, data: { username: 'user1' } },
        { operation: 'update' as const, filter: { _id: 'test' }, data: { active: false } },
        { operation: 'delete' as const, filter: { old: true } }
      ];

      const mockResult = {
        insertedCount: 1,
        modifiedCount: 1,
        deletedCount: 1,
        upsertedCount: 0
      };

      (Player.bulkWrite as jest.Mock).mockResolvedValue(mockResult);

      const result = await DatabaseOperationsService.bulkOperations('players', operations);

      expect(result).toEqual(mockResult);
      expect(Player.bulkWrite).toHaveBeenCalledWith([
        { insertOne: { document: { username: 'user1' } } },
        { updateMany: { filter: { _id: 'test' }, update: { $set: { active: false } }, upsert: false } },
        { updateMany: { filter: { old: true }, update: { $set: { deletedAt: expect.any(Date), isDeleted: true } } } }
      ]);
    });

    it('should throw error for too many operations', async () => {
      const operations = Array(1001).fill({ operation: 'insert', data: {} });

      await expect(
        DatabaseOperationsService.bulkOperations('players', operations)
      ).rejects.toThrow('Too many operations (max 1000)');
    });

    it('should throw error for empty operations', async () => {
      await expect(
        DatabaseOperationsService.bulkOperations('players', [])
      ).rejects.toThrow('No operations provided');
    });
  });

  describe('executeAggregation', () => {
    it('should execute aggregation pipeline', async () => {
      const pipeline = [
        { $match: { active: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ];

      const mockResult = [
        { _id: 'admin', count: 5 },
        { _id: 'user', count: 95 }
      ];

      (Player.aggregate as jest.Mock).mockResolvedValue(mockResult);

      const result = await DatabaseOperationsService.executeAggregation('players', pipeline);

      expect(result).toEqual(mockResult);
      expect(Player.aggregate).toHaveBeenCalledWith([
        ...pipeline,
        { $limit: 10000 }
      ]);
    });

    it('should throw error for empty pipeline', async () => {
      await expect(
        DatabaseOperationsService.executeAggregation('players', [])
      ).rejects.toThrow('Empty aggregation pipeline');
    });
  });

  describe('exportCollection', () => {
    it('should export collection as JSON', async () => {
      const mockDocuments = [
        { _id: '1', username: 'user1' },
        { _id: '2', username: 'user2' }
      ];

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockDocuments)
      };

      (Player.find as jest.Mock).mockReturnValue(mockQuery);

      const result = await DatabaseOperationsService.exportCollection('players', 'json');

      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toBe('players_export.json');
      expect(result.documentCount).toBe(2);
      expect(JSON.parse(result.data.toString())).toEqual(mockDocuments);
    });

    it('should export collection as CSV', async () => {
      const mockDocuments = [
        { username: 'user1', email: 'user1@test.com' },
        { username: 'user2', email: 'user2@test.com' }
      ];

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockDocuments)
      };

      (Player.find as jest.Mock).mockReturnValue(mockQuery);

      const result = await DatabaseOperationsService.exportCollection('players', 'csv');

      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toBe('players_export.csv');
      expect(result.documentCount).toBe(2);
      expect(result.data.toString()).toContain('username');
      expect(result.data.toString()).toContain('user1');
    });

    it('should enforce export limit', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      };

      (Player.find as jest.Mock).mockReturnValue(mockQuery);

      await DatabaseOperationsService.exportCollection('players', 'json', {
        limit: 100000 // Should be capped at 50000
      });

      expect(mockQuery.limit).toHaveBeenCalledWith(50000);
    });
  });
});