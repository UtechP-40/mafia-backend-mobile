import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { createRateLimit } from '../middleware/securityMiddleware';
import { SecurityService } from '../services/SecurityService';
import { AntiCheatService } from '../services/AntiCheatService';
import { GDPRService } from '../services/GDPRService';
import { logger } from '../utils/logger';

const router = Router();

// Rate limiting for security endpoints
const securityRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute per IP
  keyGenerator: (req) => `${req.ip}_${req.userId || 'anonymous'}`
});

/**
 * GET /api/security/events
 * Get recent security events (admin only)
 */
router.get('/events', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const events = SecurityService.getSecurityEvents(Math.min(limit, 200));

    res.status(200).json({
      success: true,
      data: {
        events,
        total: events.length
      }
    });
  } catch (error) {
    logger.error('Get security events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve security events'
    });
  }
});

/**
 * GET /api/security/analysis
 * Get security analysis and patterns (admin only)
 */
router.get('/analysis', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const analysis = SecurityService.analyzeSecurityPatterns();

    res.status(200).json({
      success: true,
      data: analysis
    });
  } catch (error) {
    logger.error('Security analysis error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform security analysis'
    });
  }
});

/**
 * GET /api/security/anti-cheat/stats
 * Get anti-cheat statistics (admin only)
 */
router.get('/anti-cheat/stats', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = AntiCheatService.getAntiCheatStats();

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Anti-cheat stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve anti-cheat statistics'
    });
  }
});

/**
 * GET /api/security/anti-cheat/player/:playerId
 * Get player violation history (admin only)
 */
router.get('/anti-cheat/player/:playerId', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { playerId } = req.params;
    const violations = AntiCheatService.getPlayerViolations(playerId);
    const shouldFlag = AntiCheatService.shouldFlagPlayer(playerId);

    res.status(200).json({
      success: true,
      data: {
        playerId,
        violations,
        shouldFlag,
        riskLevel: shouldFlag ? 'high' : violations && violations.count > 2 ? 'medium' : 'low'
      }
    });
  } catch (error) {
    logger.error('Player violation check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check player violations'
    });
  }
});

/**
 * POST /api/security/csrf-token
 * Generate CSRF token for authenticated user
 */
router.post('/csrf-token', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionToken = req.headers['x-session-token'] as string || SecurityService.generateSecureToken();
    const csrfToken = SecurityService.generateCSRFToken(sessionToken);

    res.status(200).json({
      success: true,
      data: {
        csrfToken,
        sessionToken
      }
    });
  } catch (error) {
    logger.error('CSRF token generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate CSRF token'
    });
  }
});

/**
 * POST /api/security/validate-password
 * Validate password strength
 */
router.post('/validate-password', securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Password is required'
      });
      return;
    }

    const validation = SecurityService.validatePasswordStrength(password);

    res.status(200).json({
      success: true,
      data: validation
    });
  } catch (error) {
    logger.error('Password validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate password'
    });
  }
});

/**
 * GET /api/security/gdpr/stats
 * Get GDPR compliance statistics (admin only)
 */
router.get('/gdpr/stats', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = GDPRService.getComplianceStats();

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('GDPR stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve GDPR statistics'
    });
  }
});

/**
 * POST /api/security/report-incident
 * Report security incident
 */
router.post('/report-incident', authenticateToken, securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, description, evidence } = req.body;
    const userId = req.userId!;
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    if (!type || !description) {
      res.status(400).json({
        success: false,
        message: 'Incident type and description are required'
      });
      return;
    }

    // Log the security incident
    await SecurityService.logSecurityEvent({
      type: `user_reported_${type}`,
      ip: ipAddress,
      userAgent,
      url: req.url,
      userId,
      indicators: ['user_report'],
      timestamp: new Date(),
      severity: 'medium'
    });

    // Store additional incident details
    logger.warn('Security incident reported by user', {
      reportedBy: userId,
      type,
      description,
      evidence,
      ip: ipAddress,
      userAgent
    });

    res.status(200).json({
      success: true,
      message: 'Security incident reported successfully'
    });
  } catch (error) {
    logger.error('Security incident report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to report security incident'
    });
  }
});

/**
 * GET /api/security/health
 * Security health check
 */
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const securityHealth = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      checks: {
        rateLimiting: 'active',
        inputSanitization: 'active',
        antiCheat: 'active',
        gdprCompliance: 'active',
        securityHeaders: 'active',
        suspiciousActivityDetection: 'active'
      },
      metrics: {
        securityEvents: SecurityService.getSecurityEvents(10).length,
        antiCheatDetections: AntiCheatService.getAntiCheatStats().totalDetections,
        gdprRequests: GDPRService.getComplianceStats().totalExportRequests + GDPRService.getComplianceStats().totalDeletionRequests
      }
    };

    res.status(200).json({
      success: true,
      data: securityHealth
    });
  } catch (error) {
    logger.error('Security health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Security health check failed',
      data: {
        status: 'unhealthy',
        timestamp: new Date().toISOString()
      }
    });
  }
});

/**
 * POST /api/security/block-ip
 * Block IP address (admin only)
 */
router.post('/block-ip', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ip, reason, duration = 3600000 } = req.body; // Default 1 hour

    if (!ip || !reason) {
      res.status(400).json({
        success: false,
        message: 'IP address and reason are required'
      });
      return;
    }

    // Import blockIP function
    const { blockIP } = await import('../middleware/securityMiddleware');
    blockIP(ip, reason, duration);

    // Log the IP blocking action
    await SecurityService.logSecurityEvent({
      type: 'ip_blocked',
      ip,
      userAgent: 'admin_action',
      url: req.url,
      userId: req.userId,
      indicators: ['admin_block'],
      timestamp: new Date(),
      severity: 'high'
    });

    logger.warn('IP address blocked by admin', {
      blockedIp: ip,
      reason,
      duration,
      adminUserId: req.userId
    });

    res.status(200).json({
      success: true,
      message: 'IP address blocked successfully',
      data: {
        ip,
        reason,
        duration,
        expiresAt: new Date(Date.now() + duration)
      }
    });
  } catch (error) {
    logger.error('IP blocking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block IP address'
    });
  }
});

/**
 * DELETE /api/security/unblock-ip
 * Unblock IP address (admin only)
 */
router.delete('/unblock-ip', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ip } = req.body;

    if (!ip) {
      res.status(400).json({
        success: false,
        message: 'IP address is required'
      });
      return;
    }

    // Import unblockIP function
    const { unblockIP } = await import('../middleware/securityMiddleware');
    const wasBlocked = unblockIP(ip);

    if (!wasBlocked) {
      res.status(404).json({
        success: false,
        message: 'IP address was not blocked'
      });
      return;
    }

    // Log the IP unblocking action
    await SecurityService.logSecurityEvent({
      type: 'ip_unblocked',
      ip,
      userAgent: 'admin_action',
      url: req.url,
      userId: req.userId,
      indicators: ['admin_unblock'],
      timestamp: new Date(),
      severity: 'medium'
    });

    logger.info('IP address unblocked by admin', {
      unblockedIp: ip,
      adminUserId: req.userId
    });

    res.status(200).json({
      success: true,
      message: 'IP address unblocked successfully'
    });
  } catch (error) {
    logger.error('IP unblocking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock IP address'
    });
  }
});

/**
 * GET /api/security/blocked-ips
 * Get list of blocked IP addresses (admin only)
 */
router.get('/blocked-ips', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    // Import getBlockedIPs function
    const { getBlockedIPs } = await import('../middleware/securityMiddleware');
    const blockedIPs = getBlockedIPs();

    res.status(200).json({
      success: true,
      data: {
        blockedIPs,
        total: blockedIPs.length
      }
    });
  } catch (error) {
    logger.error('Get blocked IPs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve blocked IP addresses'
    });
  }
});

/**
 * POST /api/security/run-vulnerability-scan
 * Run vulnerability assessment (admin only)
 */
router.post('/vulnerability-scan', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    // Import and run vulnerability assessment
    const { VulnerabilityAssessment } = await import('../scripts/vulnerability-assessment');
    const assessment = new VulnerabilityAssessment();
    
    const results = await assessment.runAssessment();
    const report = await assessment.generateReport(results);

    res.status(200).json({
      success: true,
      message: 'Vulnerability assessment completed',
      data: {
        results,
        report: JSON.parse(report)
      }
    });
  } catch (error) {
    logger.error('Vulnerability scan error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to run vulnerability assessment'
    });
  }
});

/**
 * GET /api/security/audit-log
 * Get security audit log (admin only)
 */
router.get('/audit-log', authenticateToken, requireRole(['admin']), securityRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const eventType = req.query.eventType as string;

    let events = SecurityService.getSecurityEvents(1000); // Get more for filtering

    // Filter by event type if specified
    if (eventType) {
      events = events.filter(event => event.type === eventType);
    }

    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedEvents = events.slice(startIndex, endIndex);

    res.status(200).json({
      success: true,
      data: {
        events: paginatedEvents,
        pagination: {
          page,
          limit,
          total: events.length,
          pages: Math.ceil(events.length / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Audit log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit log'
    });
  }
});

export { router as securityRoutes };