import { Router, Request, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { Permission } from '../models/SuperUser';
import { DatabaseOperationsService, ExportFormat } from '../services/DatabaseOperationsService';
import { adminLogger } from '../config/logger';
import { Types } from 'mongoose';
import multer from 'multer';

const router = Router();

// Configure multer for file uploads (backup restore)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json') {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed for backup restore'));
    }
  }
});

/**
 * GET /admin/api/database/collections
 * Get all collections with metadata
 */
router.get('/collections',
  requireAdminPermission(Permission.DATABASE_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const collections = await DatabaseOperationsService.getCollections();
    
    adminLogger.info('Admin accessed collections metadata', {
      userId: req.adminUser.id,
      collectionsCount: collections.length
    });
    
    res.json({
      success: true,
      data: collections,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * GET /admin/api/database/collections/:name
 * Get documents from a specific collection with pagination
 */
router.get('/collections/:name',
  requireAdminPermission(Permission.DATABASE_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name } = req.params;
    const {
      page = '1',
      limit = '50',
      sort,
      filter,
      select,
      populate
    } = req.query;
    
    // Parse query parameters
    const options: any = {
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10)
    };
    
    if (sort) {
      try {
        options.sort = JSON.parse(sort as string);
      } catch (error) {
        res.status(400).json({
          success: false,
          error: 'Invalid sort parameter format'
        });
        return;
      }
    }
    
    if (filter) {
      try {
        options.filter = JSON.parse(filter as string);
      } catch (error) {
        res.status(400).json({
          success: false,
          error: 'Invalid filter parameter format'
        });
        return;
      }
    }
    
    if (select) {
      options.select = select as string;
    }
    
    if (populate) {
      options.populate = Array.isArray(populate) ? populate : [populate];
    }
    
    const result = await DatabaseOperationsService.getCollectionDocuments(name, options);
    
    adminLogger.info('Admin accessed collection documents', {
      userId: req.adminUser.id,
      collection: name,
      page: options.page,
      limit: options.limit,
      documentCount: result.documents.length
    });
    
    res.json({
      success: true,
      data: result.documents,
      pagination: result.pagination,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /admin/api/database/collections/:name
 * Create a new document in a collection
 */
router.post('/collections/:name',
  requireAdminPermission(Permission.DATABASE_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name } = req.params;
    const data = req.body;
    
    if (!data || typeof data !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid document data'
      });
      return;
    }
    
    const document = await DatabaseOperationsService.createDocument(name, data);
    
    adminLogger.info('Admin created document', {
      userId: req.adminUser.id,
      collection: name,
      documentId: document._id
    });
    
    res.status(201).json({
      success: true,
      data: document,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * PUT /admin/api/database/collections/:name/:id
 * Update a document by ID
 */
router.put('/collections/:name/:id',
  requireAdminPermission(Permission.DATABASE_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name, id } = req.params;
    const data = req.body;
    const { upsert = false } = req.query;
    
    if (!data || typeof data !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid document data'
      });
      return;
    }
    
    const document = await DatabaseOperationsService.updateDocument(
      name, 
      id, 
      data, 
      { upsert: upsert === 'true' }
    );
    
    adminLogger.info('Admin updated document', {
      userId: req.adminUser.id,
      collection: name,
      documentId: id,
      upsert
    });
    
    res.json({
      success: true,
      data: document,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * DELETE /admin/api/database/collections/:name/:id
 * Delete a document by ID (soft delete by default)
 */
router.delete('/collections/:name/:id',
  requireAdminPermission(Permission.DATABASE_DELETE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name, id } = req.params;
    const { hard = false } = req.query;
    
    const document = await DatabaseOperationsService.deleteDocument(
      name, 
      id, 
      hard === 'true'
    );
    
    adminLogger.info('Admin deleted document', {
      userId: req.adminUser.id,
      collection: name,
      documentId: id,
      hard: hard === 'true'
    });
    
    res.json({
      success: true,
      data: document,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /admin/api/database/collections/:name/bulk
 * Perform bulk operations on a collection
 */
router.post('/collections/:name/bulk',
  requireAdminPermission(Permission.DATABASE_WRITE),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name } = req.params;
    const { operations } = req.body;
    
    if (!Array.isArray(operations) || operations.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid operations array'
      });
      return;
    }
    
    const result = await DatabaseOperationsService.bulkOperations(name, operations);
    
    adminLogger.info('Admin performed bulk operations', {
      userId: req.adminUser.id,
      collection: name,
      operationsCount: operations.length,
      result: {
        insertedCount: result.insertedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount
      }
    });
    
    res.json({
      success: true,
      data: {
        insertedCount: result.insertedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
        upsertedCount: result.upsertedCount,
        matchedCount: result.matchedCount
      },
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /admin/api/database/collections/:name/aggregate
 * Execute aggregation pipeline on a collection
 */
router.post('/collections/:name/aggregate',
  requireAdminPermission(Permission.DATABASE_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name } = req.params;
    const { pipeline } = req.body;
    
    if (!Array.isArray(pipeline) || pipeline.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid aggregation pipeline'
      });
      return;
    }
    
    const result = await DatabaseOperationsService.executeAggregation(name, pipeline);
    
    adminLogger.info('Admin executed aggregation', {
      userId: req.adminUser.id,
      collection: name,
      pipelineStages: pipeline.length,
      resultCount: result.length
    });
    
    res.json({
      success: true,
      data: result,
      count: result.length,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * GET /admin/api/database/collections/:name/stats
 * Get collection statistics and indexing information
 */
router.get('/collections/:name/stats',
  requireAdminPermission(Permission.DATABASE_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name } = req.params;
    
    const stats = await DatabaseOperationsService.getCollectionStats(name);
    
    adminLogger.info('Admin accessed collection stats', {
      userId: req.adminUser.id,
      collection: name
    });
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * GET /admin/api/database/collections/:name/export
 * Export collection data in various formats
 */
router.get('/collections/:name/export',
  requireAdminPermission(Permission.DATABASE_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name } = req.params;
    const {
      format = 'json',
      filter,
      select,
      limit = '10000'
    } = req.query;
    
    // Validate format
    if (!['json', 'csv', 'xlsx'].includes(format as string)) {
      res.status(400).json({
        success: false,
        error: 'Invalid export format. Supported: json, csv, xlsx'
      });
      return;
    }
    
    const options: any = {
      limit: parseInt(limit as string, 10)
    };
    
    if (filter) {
      try {
        options.filter = JSON.parse(filter as string);
      } catch (error) {
        res.status(400).json({
          success: false,
          error: 'Invalid filter parameter format'
        });
        return;
      }
    }
    
    if (select) {
      options.select = select as string;
    }
    
    const exportResult = await DatabaseOperationsService.exportCollection(
      name,
      format as ExportFormat,
      options
    );
    
    adminLogger.info('Admin exported collection', {
      userId: req.adminUser.id,
      collection: name,
      format,
      documentCount: exportResult.documentCount,
      fileSize: exportResult.data.length
    });
    
    res.setHeader('Content-Type', exportResult.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
    res.setHeader('Content-Length', exportResult.data.length);
    
    res.send(exportResult.data);
  })
);

/**
 * POST /admin/api/database/backup
 * Create database backup
 */
router.post('/backup',
  requireAdminPermission(Permission.DATABASE_BACKUP),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { collections } = req.body;
    
    const backup = await DatabaseOperationsService.createBackup(collections);
    
    adminLogger.info('Admin created database backup', {
      userId: req.adminUser.id,
      collections: collections || 'all',
      fileSize: backup.data.length
    });
    
    res.setHeader('Content-Type', backup.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    res.setHeader('Content-Length', backup.data.length);
    
    res.send(backup.data);
  })
);

/**
 * POST /admin/api/database/restore
 * Restore database from backup
 */
router.post('/restore',
  requireAdminPermission(Permission.DATABASE_RESTORE),
  upload.single('backup'),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No backup file provided'
      });
      return;
    }
    
    const { overwrite = false } = req.body;
    
    let backupData;
    try {
      backupData = JSON.parse(req.file.buffer.toString());
    } catch (error) {
      res.status(400).json({
        success: false,
        error: 'Invalid backup file format'
      });
      return;
    }
    
    const result = await DatabaseOperationsService.restoreBackup(backupData, {
      overwrite: overwrite === 'true'
    });
    
    adminLogger.info('Admin restored database from backup', {
      userId: req.adminUser.id,
      overwrite: overwrite === 'true',
      result
    });
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /admin/api/database/query-builder
 * Execute custom queries using query builder
 */
router.post('/query-builder',
  requireAdminPermission(Permission.DATABASE_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const {
      collection,
      filter = {},
      sort,
      limit = 100,
      skip = 0,
      select,
      populate
    } = req.body;
    
    if (!collection) {
      res.status(400).json({
        success: false,
        error: 'Collection name is required'
      });
      return;
    }
    
    const options = {
      filter,
      sort,
      limit: Math.min(limit, 1000), // Max 1000 results
      skip,
      select,
      populate
    };
    
    const result = await DatabaseOperationsService.getCollectionDocuments(collection, options);
    
    adminLogger.info('Admin executed query builder', {
      userId: req.adminUser.id,
      collection,
      options,
      resultCount: result.documents.length
    });
    
    res.json({
      success: true,
      data: result.documents,
      pagination: result.pagination,
      timestamp: new Date().toISOString()
    });
  })
);

export default router;