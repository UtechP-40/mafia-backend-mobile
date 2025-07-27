import { Router, Request, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { Permission } from '../models/SuperUser';
import { AutomatedTestingService } from '../utils/automatedTesting';
import { adminLogger } from '../config/logger';

const router = Router();

/**
 * POST /admin/api/automated-testing/suites
 * Create automated test suite
 */
router.post('/suites',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { name, description, endpoints, schedule, notifications, thresholds, enabled } = req.body;
    const adminUser = req.adminUser;
    
    if (!name || !endpoints || !Array.isArray(endpoints)) {
      return res.status(400).json({
        success: false,
        message: 'Name and endpoints array are required'
      });
    }

    adminLogger.info('Creating automated test suite', {
      userId: adminUser.id,
      username: adminUser.username,
      suiteName: name,
      endpointCount: endpoints.length
    });

    try {
      const suite = AutomatedTestingService.createTestSuite({
        name,
        description,
        endpoints,
        schedule,
        notifications,
        thresholds,
        enabled: enabled !== false
      });

      res.status(201).json({
        success: true,
        message: 'Automated test suite created successfully',
        data: { suite }
      });
    } catch (error) {
      adminLogger.error('Failed to create automated test suite', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to create automated test suite',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/automated-testing/suites
 * Get all automated test suites
 */
router.get('/suites',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const suites = AutomatedTestingService.getTestSuites();

    res.json({
      success: true,
      data: {
        suites,
        total: suites.length
      }
    });
  })
);

/**
 * GET /admin/api/automated-testing/suites/:id
 * Get specific automated test suite
 */
router.get('/suites/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const suite = AutomatedTestingService.getTestSuite(id);
    
    if (!suite) {
      return res.status(404).json({
        success: false,
        message: 'Test suite not found'
      });
    }

    const statistics = AutomatedTestingService.getSuiteStatistics(id);

    res.json({
      success: true,
      data: { 
        suite,
        statistics
      }
    });
  })
);

/**
 * PUT /admin/api/automated-testing/suites/:id
 * Update automated test suite
 */
router.put('/suites/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;
    const adminUser = req.adminUser;
    
    adminLogger.info('Updating automated test suite', {
      userId: adminUser.id,
      username: adminUser.username,
      suiteId: id,
      updates: Object.keys(updates)
    });

    try {
      const suite = AutomatedTestingService.updateTestSuite(id, updates);

      res.json({
        success: true,
        message: 'Test suite updated successfully',
        data: { suite }
      });
    } catch (error) {
      adminLogger.error('Failed to update automated test suite', {
        userId: adminUser.id,
        suiteId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to update test suite',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * DELETE /admin/api/automated-testing/suites/:id
 * Delete automated test suite
 */
router.delete('/suites/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const adminUser = req.adminUser;
    
    adminLogger.info('Deleting automated test suite', {
      userId: adminUser.id,
      username: adminUser.username,
      suiteId: id
    });

    const deleted = AutomatedTestingService.deleteTestSuite(id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Test suite not found'
      });
    }

    res.json({
      success: true,
      message: 'Test suite deleted successfully'
    });
  })
);

/**
 * POST /admin/api/automated-testing/suites/:id/run
 * Run automated test suite manually
 */
router.post('/suites/:id/run',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { baseUrl } = req.body;
    const adminUser = req.adminUser;
    
    adminLogger.info('Running automated test suite manually', {
      userId: adminUser.id,
      username: adminUser.username,
      suiteId: id,
      baseUrl
    });

    try {
      const result = await AutomatedTestingService.runTestSuite(id, baseUrl);

      res.json({
        success: true,
        message: 'Test suite executed successfully',
        data: { result }
      });
    } catch (error) {
      adminLogger.error('Failed to run automated test suite', {
        userId: adminUser.id,
        suiteId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to run test suite',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * POST /admin/api/automated-testing/suites/:id/toggle
 * Enable/disable automated test suite
 */
router.post('/suites/:id/toggle',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { enabled } = req.body;
    const adminUser = req.adminUser;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Enabled field must be a boolean'
      });
    }

    adminLogger.info('Toggling automated test suite', {
      userId: adminUser.id,
      username: adminUser.username,
      suiteId: id,
      enabled
    });

    const success = AutomatedTestingService.toggleTestSuite(id, enabled);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        message: 'Test suite not found'
      });
    }

    res.json({
      success: true,
      message: `Test suite ${enabled ? 'enabled' : 'disabled'} successfully`
    });
  })
);

/**
 * GET /admin/api/automated-testing/suites/:id/results
 * Get test results for specific suite
 */
router.get('/suites/:id/results',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { id } = req.params;
    const { limit } = req.query;
    
    const results = AutomatedTestingService.getTestResults(
      id, 
      limit ? parseInt(limit as string) : undefined
    );

    res.json({
      success: true,
      data: {
        results,
        total: results.length
      }
    });
  })
);

/**
 * GET /admin/api/automated-testing/results
 * Get all test results across all suites
 */
router.get('/results',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const allResults = AutomatedTestingService.getAllTestResults();
    
    // Flatten results for easier consumption
    const flatResults: any[] = [];
    for (const [suiteId, results] of allResults.entries()) {
      flatResults.push(...results.map(result => ({
        ...result,
        suiteId
      })));
    }

    // Sort by timestamp descending
    flatResults.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    res.json({
      success: true,
      data: {
        results: flatResults,
        total: flatResults.length,
        suiteCount: allResults.size
      }
    });
  })
);

/**
 * GET /admin/api/automated-testing/statistics
 * Get overall automated testing statistics
 */
router.get('/statistics',
  requireAdminPermission(Permission.ANALYTICS_READ),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const suites = AutomatedTestingService.getTestSuites();
    const allResults = AutomatedTestingService.getAllTestResults();
    
    let totalRuns = 0;
    let totalTests = 0;
    let totalPassedTests = 0;
    let totalFailedTests = 0;
    let totalResponseTime = 0;
    let activeSuites = 0;
    let scheduledSuites = 0;

    for (const suite of suites) {
      if (suite.enabled) activeSuites++;
      if (suite.schedule) scheduledSuites++;
      
      const results = allResults.get(suite.id) || [];
      totalRuns += results.length;
      
      for (const result of results) {
        totalTests += result.totalTests;
        totalPassedTests += result.passedTests;
        totalFailedTests += result.failedTests;
        totalResponseTime += result.averageResponseTime;
      }
    }

    const statistics = {
      totalSuites: suites.length,
      activeSuites,
      scheduledSuites,
      totalRuns,
      totalTests,
      totalPassedTests,
      totalFailedTests,
      overallSuccessRate: totalTests > 0 ? (totalPassedTests / totalTests) * 100 : 0,
      averageResponseTime: totalRuns > 0 ? totalResponseTime / totalRuns : 0,
      uptime: totalRuns > 0 ? (totalRuns - (allResults.size > 0 ? Array.from(allResults.values()).flat().filter(r => r.summary.status === 'failed').length : 0)) / totalRuns * 100 : 0
    };

    res.json({
      success: true,
      data: { statistics }
    });
  })
);

/**
 * POST /admin/api/automated-testing/cleanup
 * Cleanup old test results
 */
router.post('/cleanup',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const { maxAge } = req.body;
    const adminUser = req.adminUser;
    
    const maxAgeMs = maxAge ? parseInt(maxAge) : 30 * 24 * 60 * 60 * 1000; // 30 days default
    
    adminLogger.info('Cleaning up old automated test results', {
      userId: adminUser.id,
      username: adminUser.username,
      maxAge: maxAgeMs
    });

    AutomatedTestingService.cleanupOldResults(maxAgeMs);

    res.json({
      success: true,
      message: 'Old test results cleaned up successfully'
    });
  })
);

/**
 * GET /admin/api/automated-testing/health
 * Get health status of automated testing system
 */
router.get('/health',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const suites = AutomatedTestingService.getTestSuites();
    const allResults = AutomatedTestingService.getAllTestResults();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      suites: {
        total: suites.length,
        enabled: suites.filter(s => s.enabled).length,
        scheduled: suites.filter(s => s.schedule).length
      },
      recentActivity: {
        last24Hours: 0,
        lastWeek: 0,
        lastMonth: 0
      },
      issues: [] as string[]
    };

    // Calculate recent activity
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const week = 7 * day;
    const month = 30 * day;

    for (const results of allResults.values()) {
      for (const result of results) {
        const age = now - result.timestamp.getTime();
        if (age <= day) health.recentActivity.last24Hours++;
        if (age <= week) health.recentActivity.lastWeek++;
        if (age <= month) health.recentActivity.lastMonth++;
      }
    }

    // Check for issues
    const enabledSuites = suites.filter(s => s.enabled);
    if (enabledSuites.length === 0) {
      health.issues.push('No enabled test suites');
      health.status = 'warning';
    }

    const recentFailures = Array.from(allResults.values())
      .flat()
      .filter(r => r.timestamp.getTime() > now - day && r.summary.status === 'failed');
    
    if (recentFailures.length > 0) {
      health.issues.push(`${recentFailures.length} test suite failures in the last 24 hours`);
      health.status = 'warning';
    }

    res.json({
      success: true,
      data: { health }
    });
  })
);

export default router;