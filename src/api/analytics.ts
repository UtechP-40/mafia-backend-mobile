import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { analyticsService, EventType, MetricType } from '../services';
import { authMiddleware } from '../middleware/authMiddleware';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Middleware for analytics routes
router.use(authMiddleware);
router.use(rateLimiter);

/**
 * Track an analytics event
 * POST /api/analytics/events
 */
router.post('/events', async (req: Request, res: Response) => {
  try {
    const {
      eventType,
      gameId,
      roomId,
      properties,
      platform,
      version
    } = req.body;

    // Validate event type
    if (!Object.values(EventType).includes(eventType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid event type'
      });
    }

    const event = await analyticsService.trackEvent({
      eventType,
      userId: req.user?.id ? new Types.ObjectId(req.user.id) : undefined,
      sessionId: req.sessionID,
      gameId: gameId ? new Types.ObjectId(gameId) : undefined,
      roomId: roomId ? new Types.ObjectId(roomId) : undefined,
      properties: properties || {},
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip,
      platform,
      version
    });

    res.status(201).json({
      success: true,
      data: event
    });
  } catch (error) {
    console.error('Error tracking event:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track event'
    });
  }
});

/**
 * Record a performance metric
 * POST /api/analytics/metrics
 */
router.post('/metrics', async (req: Request, res: Response) => {
  try {
    const {
      metricName,
      metricType,
      value,
      tags,
      source
    } = req.body;

    // Validate metric type
    if (!Object.values(MetricType).includes(metricType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid metric type'
      });
    }

    // Validate value is a number
    if (typeof value !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Metric value must be a number'
      });
    }

    const metric = await analyticsService.recordMetric({
      metricName,
      metricType,
      value,
      tags: tags || {},
      source: source || 'client'
    });

    res.status(201).json({
      success: true,
      data: metric
    });
  } catch (error) {
    console.error('Error recording metric:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record metric'
    });
  }
});

/**
 * Log an error
 * POST /api/analytics/errors
 */
router.post('/errors', async (req: Request, res: Response) => {
  try {
    const {
      errorType,
      message,
      stack,
      endpoint,
      method,
      statusCode,
      severity
    } = req.body;

    const errorLog = await analyticsService.logError({
      errorType,
      message,
      stack,
      userId: req.user?.id ? new Types.ObjectId(req.user.id) : undefined,
      sessionId: req.sessionID,
      endpoint,
      method,
      statusCode,
      userAgent: req.get('User-Agent'),
      severity: severity || 'medium'
    });

    res.status(201).json({
      success: true,
      data: errorLog
    });
  } catch (error) {
    console.error('Error logging error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log error'
    });
  }
});

/**
 * Get dashboard metrics
 * GET /api/analytics/dashboard
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate
    } = req.query;

    // Default to last 7 days if no dates provided
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Validate date range
    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
    }

    const metrics = await analyticsService.getDashboardMetrics(start, end);

    res.json({
      success: true,
      data: metrics,
      dateRange: {
        startDate: start,
        endDate: end
      }
    });
  } catch (error) {
    console.error('Error getting dashboard metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard metrics'
    });
  }
});

/**
 * Get analytics events with filtering
 * GET /api/analytics/events
 */
router.get('/events', async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      eventTypes,
      userId,
      gameId,
      roomId,
      page = '1',
      limit = '100'
    } = req.query;

    // Default to last 24 hours if no dates provided
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 24 * 60 * 60 * 1000);

    // Parse event types
    let parsedEventTypes: EventType[] | undefined;
    if (eventTypes) {
      const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
      parsedEventTypes = types.filter(type => Object.values(EventType).includes(type as EventType)) as EventType[];
    }

    const query = {
      startDate: start,
      endDate: end,
      eventTypes: parsedEventTypes,
      userId: userId ? new Types.ObjectId(userId as string) : undefined,
      gameId: gameId ? new Types.ObjectId(gameId as string) : undefined,
      roomId: roomId ? new Types.ObjectId(roomId as string) : undefined
    };

    const result = await analyticsService.getEvents(
      query,
      parseInt(page as string),
      Math.min(parseInt(limit as string), 1000) // Cap at 1000 events per request
    );

    res.json({
      success: true,
      data: result.events,
      pagination: {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 1000),
        total: result.total,
        pages: result.pages
      },
      dateRange: {
        startDate: start,
        endDate: end
      }
    });
  } catch (error) {
    console.error('Error getting events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get events'
    });
  }
});

/**
 * Export analytics data
 * GET /api/analytics/export
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      eventTypes,
      userId,
      gameId,
      roomId,
      format = 'json'
    } = req.query;

    // Limit export to last 30 days maximum
    const end = endDate ? new Date(endDate as string) : new Date();
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Validate date range (max 30 days)
    const maxRange = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    if (end.getTime() - start.getTime() > maxRange) {
      return res.status(400).json({
        success: false,
        message: 'Export date range cannot exceed 30 days'
      });
    }

    // Parse event types
    let parsedEventTypes: EventType[] | undefined;
    if (eventTypes) {
      const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
      parsedEventTypes = types.filter(type => Object.values(EventType).includes(type as EventType)) as EventType[];
    }

    const query = {
      startDate: start,
      endDate: end,
      eventTypes: parsedEventTypes,
      userId: userId ? new Types.ObjectId(userId as string) : undefined,
      gameId: gameId ? new Types.ObjectId(gameId as string) : undefined,
      roomId: roomId ? new Types.ObjectId(roomId as string) : undefined
    };

    const data = await analyticsService.exportData(query, format as 'json' | 'csv');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=analytics-export-${Date.now()}.csv`);
      res.send(data);
    } else {
      res.json({
        success: true,
        data,
        dateRange: {
          startDate: start,
          endDate: end
        }
      });
    }
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data'
    });
  }
});

/**
 * Create A/B test experiment
 * POST /api/analytics/experiments
 */
router.post('/experiments', async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      variants,
      startDate,
      endDate,
      targetAudience,
      metrics
    } = req.body;

    // Validate required fields
    if (!name || !description || !variants || !startDate || !metrics) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, description, variants, startDate, metrics'
      });
    }

    // Validate variants
    if (!Array.isArray(variants) || variants.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 variants are required'
      });
    }

    const experiment = await analyticsService.createExperiment({
      name,
      description,
      variants,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      targetAudience: targetAudience || {},
      metrics,
      createdBy: new Types.ObjectId(req.user!.id)
    });

    res.status(201).json({
      success: true,
      data: experiment
    });
  } catch (error) {
    console.error('Error creating experiment:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create experiment'
    });
  }
});

/**
 * Get user's experiment assignment
 * GET /api/analytics/experiments/:experimentId/assignment
 */
router.get('/experiments/:experimentId/assignment', async (req: Request, res: Response) => {
  try {
    const { experimentId } = req.params;
    const userId = new Types.ObjectId(req.user!.id);

    const assignment = await analyticsService.assignUserToExperiment(
      userId,
      new Types.ObjectId(experimentId)
    );

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Experiment not found or not active'
      });
    }

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    console.error('Error getting experiment assignment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get experiment assignment'
    });
  }
});

/**
 * Record experiment conversion
 * POST /api/analytics/experiments/:experimentId/conversion
 */
router.post('/experiments/:experimentId/conversion', async (req: Request, res: Response) => {
  try {
    const { experimentId } = req.params;
    const { conversionValue } = req.body;
    const userId = new Types.ObjectId(req.user!.id);

    const success = await analyticsService.recordConversion(
      userId,
      new Types.ObjectId(experimentId),
      conversionValue
    );

    if (!success) {
      return res.status(400).json({
        success: false,
        message: 'User not assigned to experiment or already converted'
      });
    }

    res.json({
      success: true,
      message: 'Conversion recorded successfully'
    });
  } catch (error) {
    console.error('Error recording conversion:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record conversion'
    });
  }
});

/**
 * Get experiment results
 * GET /api/analytics/experiments/:experimentId/results
 */
router.get('/experiments/:experimentId/results', async (req: Request, res: Response) => {
  try {
    const { experimentId } = req.params;

    const results = await analyticsService.getExperimentResults(
      new Types.ObjectId(experimentId)
    );

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error getting experiment results:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to get experiment results'
    });
  }
});

/**
 * Health check endpoint for monitoring
 * GET /api/analytics/health
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Basic health check - could be expanded with more comprehensive checks
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Check if we can query recent events
    const recentEventCount = await analyticsService.getEvents({
      startDate: oneHourAgo,
      endDate: now
    }, 1, 1);

    res.json({
      success: true,
      status: 'healthy',
      timestamp: now,
      checks: {
        database: 'connected',
        recentEvents: recentEventCount.total
      }
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      timestamp: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;