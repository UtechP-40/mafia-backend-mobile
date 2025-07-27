import request from 'supertest';
import express from 'express';
import databaseRoutes from '../routes/database';
import { DatabaseOperationsService } from '../services/DatabaseOperationsService';
import { adminAuthMiddleware, requireAdminPermission } from '../middleware/auth';
import { Permission } from '../models/SuperUser';

// Mock the DatabaseOperationsService
jest.mock('../services/DatabaseOperationsService');

// Mock the middleware
jest.mock('../middleware/auth', () => ({
  adminAuthMiddleware: jest.fn((req: any, res: any, next: any) => {
    req.adminUser = { id: 'test-admin-id', permissions: ['DATABASE_READ', 'DATABASE_WRITE', 'DATABASE_DELETE', 'DATABASE_BACKUP', 'DATABASE_RESTORE'] };
    next();
  }),
  requireAdminPermission: jest.fn(() => (req: any, res: any, next: any) => {
    req.adminUser = { id: 'test-admin-id', permissions: ['DATABASE_READ', 'DATABASE_WRITE', 'DATABASE_DELETE', 'DATABASE_BACKUP', 'DATABASE_RESTORE'] };
    next();
  })
}));

// Mock the error handler
jest.mock('../middleware/errorHandler', () => ({
  adminAsyncHandler: jest.fn((fn: any) => fn),
  adminErrorHandler: jest.fn()
}));
const 
mockDatabaseOperationsService = DatabaseOperationsService as jest.Mocked<typeof DatabaseOperationsService>;

describe('Database Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/admin/api/database', databaseRoutes);
    jest.clearAllMocks();
  });

  describe('GET /collections', () => {
    it('should return collections metadata', async () => {
      const mockCollections = [
        {
          name: 'players',
          count: 100,
          size: 1024,
          avgObjSize: 10,
          indexes: ['_id_', 'username_1'],
          schema: { fields: {} }
        }
      ];

      mockDatabaseOperationsService.getCollections.mockResolvedValue(mockCollections);

      const response = await request(app)
        .get('/admin/api/database/collections')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockCollections);
      expect(mockDatabaseOperationsService.getCollections).toHaveBeenCalled();
    });
  });

  describe('GET /collections/:name', () => {
    it('should return collection documents with pagination', async () => {
      const mockResult = {
        documents: [{ _id: '1', name: 'test' }],
        pagination: {
          page: 1,
          limit: 50,
          total: 1,
          pages: 1,
          hasNext: false,
          hasPrev: false
        }
      };

      mockDatabaseOperationsService.getCollectionDocuments.mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/admin/api/database/collections/players')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockResult.documents);
      expect(response.body.pagination).toEqual(mockResult.pagination);
    });
  });

  describe('POST /collections/:name', () => {
    it('should create a new document', async () => {
      const mockDocument = { _id: '1', name: 'test' };
      const inputData = { name: 'test' };

      mockDatabaseOperationsService.createDocument.mockResolvedValue(mockDocument);

      const response = await request(app)
        .post('/admin/api/database/collections/players')
        .send(inputData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockDocument);
      expect(mockDatabaseOperationsService.createDocument).toHaveBeenCalledWith('players', inputData);
    });
  });

  describe('PUT /collections/:name/:id', () => {
    it('should update a document', async () => {
      const mockDocument = { _id: '1', name: 'updated' };
      const updateData = { name: 'updated' };

      mockDatabaseOperationsService.updateDocument.mockResolvedValue(mockDocument);

      const response = await request(app)
        .put('/admin/api/database/collections/players/1')
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockDocument);
      expect(mockDatabaseOperationsService.updateDocument).toHaveBeenCalledWith('players', '1', updateData, { upsert: false });
    });
  });

  describe('DELETE /collections/:name/:id', () => {
    it('should soft delete a document', async () => {
      const mockDocument = { _id: '1', name: 'test', deletedAt: '2025-07-27T02:03:11.643Z', isDeleted: true };

      mockDatabaseOperationsService.deleteDocument.mockResolvedValue(mockDocument);

      const response = await request(app)
        .delete('/admin/api/database/collections/players/1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockDocument);
      expect(mockDatabaseOperationsService.deleteDocument).toHaveBeenCalledWith('players', '1', false);
    });
  });

  describe('POST /collections/:name/bulk', () => {
    it('should perform bulk operations', async () => {
      const operations = [
        { operation: 'insert', data: { name: 'test1' } },
        { operation: 'update', filter: { _id: '1' }, data: { name: 'updated' } }
      ];

      const mockResult = {
        insertedCount: 1,
        modifiedCount: 1,
        deletedCount: 0,
        upsertedCount: 0,
        matchedCount: 1,
        result: {},
        upsertedIds: {},
        insertedIds: {},
        ok: 1,
        acknowledged: true,
        hasWriteErrors: () => false,
        getWriteErrors: () => [],
        getWriteConcernError: () => null,
        toString: () => 'BulkWriteResult',
        isOk: () => true
      } as any;

      mockDatabaseOperationsService.bulkOperations.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/admin/api/database/collections/players/bulk')
        .send({ operations })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        insertedCount: mockResult.insertedCount,
        modifiedCount: mockResult.modifiedCount,
        deletedCount: mockResult.deletedCount,
        upsertedCount: mockResult.upsertedCount,
        matchedCount: mockResult.matchedCount
      });
    });
  });

  describe('POST /collections/:name/aggregate', () => {
    it('should execute aggregation pipeline', async () => {
      const pipeline = [{ $match: { active: true } }, { $count: 'total' }];
      const mockResult = [{ total: 5 }];

      mockDatabaseOperationsService.executeAggregation.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/admin/api/database/collections/players/aggregate')
        .send({ pipeline })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockResult);
      expect(response.body.count).toBe(1);
    });
  });

  describe('GET /collections/:name/stats', () => {
    it('should return collection statistics', async () => {
      const mockStats = {
        name: 'players',
        stats: {
          count: 100,
          size: 1024,
          avgObjSize: 10,
          storageSize: 2048,
          totalIndexSize: 512,
          indexSizes: { '_id_': 256, 'username_1': 256 }
        },
        indexes: [
          { name: '_id_', spec: [['_id', 1]], size: 256 },
          { name: 'username_1', spec: [['username', 1]], size: 256 }
        ],
        schema: { fields: {}, indexes: [], virtuals: [] },
        sampleDocument: { _id: '1', name: 'test' }
      } as any;

      mockDatabaseOperationsService.getCollectionStats.mockResolvedValue(mockStats);

      const response = await request(app)
        .get('/admin/api/database/collections/players/stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStats);
    });
  });

  describe('GET /collections/:name/export', () => {
    it('should export collection data in JSON format', async () => {
      const mockExport = {
        data: Buffer.from(JSON.stringify([{ _id: '1', name: 'test' }])),
        mimeType: 'application/json',
        filename: 'players_export.json',
        documentCount: 1
      };

      mockDatabaseOperationsService.exportCollection.mockResolvedValue(mockExport);

      const response = await request(app)
        .get('/admin/api/database/collections/players/export?format=json')
        .expect(200);

      expect(response.headers['content-type']).toBe('application/json');
      expect(response.headers['content-disposition']).toBe('attachment; filename="players_export.json"');
    });
  });

  describe('POST /backup', () => {
    it('should create database backup', async () => {
      const mockBackup = {
        data: Buffer.from(JSON.stringify({ backup: 'data' })),
        filename: 'database_backup_2023-01-01.json',
        mimeType: 'application/json'
      };

      mockDatabaseOperationsService.createBackup.mockResolvedValue(mockBackup);

      const response = await request(app)
        .post('/admin/api/database/backup')
        .send({ collections: ['players'] })
        .expect(200);

      expect(response.headers['content-type']).toBe('application/json');
      expect(response.headers['content-disposition']).toBe('attachment; filename="database_backup_2023-01-01.json"');
    });
  });

  describe('POST /query-builder', () => {
    it('should execute query builder', async () => {
      const queryOptions = {
        collection: 'players',
        filter: { active: true },
        sort: { name: 1 },
        limit: 10
      };

      const mockResult = {
        documents: [{ _id: '1', name: 'test', active: true }],
        pagination: {
          page: 1,
          limit: 10,
          total: 1,
          pages: 1,
          hasNext: false,
          hasPrev: false
        }
      };

      mockDatabaseOperationsService.getCollectionDocuments.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/admin/api/database/query-builder')
        .send(queryOptions)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockResult.documents);
      expect(response.body.pagination).toEqual(mockResult.pagination);
    });
  });
});