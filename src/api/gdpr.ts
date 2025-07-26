import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { createRateLimit, validateRequest } from '../middleware/securityMiddleware';
import { GDPRService } from '../services/GDPRService';
import { logger } from '../utils/logger';

const router = Router();

// Rate limiting for GDPR endpoints
const gdprRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 10, // 10 requests per hour per IP
  keyGenerator: (req) => `${req.ip}_${req.userId || 'anonymous'}`
});

/**
 * POST /api/gdpr/consent
 * Record user consent for data processing
 */
router.post('/consent', authenticateToken, gdprRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { consentType, granted } = req.body;
    const userId = req.userId!;
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    // Validate input
    if (!consentType || typeof granted !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Consent type and granted status are required'
      });
      return;
    }

    const validConsentTypes = ['data_processing', 'analytics', 'marketing', 'cookies'];
    if (!validConsentTypes.includes(consentType)) {
      res.status(400).json({
        success: false,
        message: 'Invalid consent type'
      });
      return;
    }

    await GDPRService.recordConsent(userId, consentType, granted, ipAddress, userAgent);

    res.status(200).json({
      success: true,
      message: 'Consent recorded successfully'
    });
  } catch (error) {
    logger.error('Consent recording error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record consent'
    });
  }
});

/**
 * GET /api/gdpr/consent
 * Get user's consent history
 */
router.get('/consent', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const consentHistory = GDPRService.getUserConsent(userId);

    res.status(200).json({
      success: true,
      data: {
        consentHistory
      }
    });
  } catch (error) {
    logger.error('Get consent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve consent history'
    });
  }
});

/**
 * PUT /api/gdpr/privacy-settings
 * Update user's privacy settings
 */
router.put('/privacy-settings', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const settings = req.body;

    // Validate settings
    const validSettings = [
      'dataProcessingConsent',
      'analyticsConsent', 
      'marketingConsent',
      'cookiesConsent',
      'profileVisibility',
      'gameHistoryVisibility',
      'allowFriendRequests',
      'allowGameInvites'
    ];

    const invalidKeys = Object.keys(settings).filter(key => !validSettings.includes(key));
    if (invalidKeys.length > 0) {
      res.status(400).json({
        success: false,
        message: `Invalid settings: ${invalidKeys.join(', ')}`
      });
      return;
    }

    const updatedSettings = await GDPRService.updatePrivacySettings(userId, settings);

    res.status(200).json({
      success: true,
      message: 'Privacy settings updated successfully',
      data: {
        settings: updatedSettings
      }
    });
  } catch (error) {
    logger.error('Privacy settings update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update privacy settings'
    });
  }
});

/**
 * GET /api/gdpr/privacy-settings
 * Get user's privacy settings
 */
router.get('/privacy-settings', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const settings = GDPRService.getPrivacySettings(userId);

    res.status(200).json({
      success: true,
      data: {
        settings
      }
    });
  } catch (error) {
    logger.error('Get privacy settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve privacy settings'
    });
  }
});

/**
 * POST /api/gdpr/export-request
 * Request data export (Right to Data Portability)
 */
router.post('/export-request', authenticateToken, gdprRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const requestId = await GDPRService.requestDataExport(userId);

    res.status(202).json({
      success: true,
      message: 'Data export request submitted successfully',
      data: {
        requestId,
        estimatedProcessingTime: '24-48 hours'
      }
    });
  } catch (error) {
    logger.error('Data export request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit data export request'
    });
  }
});

/**
 * GET /api/gdpr/export-status/:requestId
 * Check data export status
 */
router.get('/export-status/:requestId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const userId = req.userId!;

    const exportRequest = GDPRService.getDataExportStatus(requestId);

    if (!exportRequest) {
      res.status(404).json({
        success: false,
        message: 'Export request not found'
      });
      return;
    }

    // Verify the request belongs to the authenticated user
    if (exportRequest.userId !== userId) {
      res.status(403).json({
        success: false,
        message: 'Access denied'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        status: exportRequest.status,
        requestDate: exportRequest.requestDate,
        downloadUrl: exportRequest.downloadUrl,
        expiresAt: exportRequest.expiresAt
      }
    });
  } catch (error) {
    logger.error('Export status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check export status'
    });
  }
});

/**
 * POST /api/gdpr/deletion-request
 * Request data deletion (Right to be Forgotten)
 */
router.post('/deletion-request', authenticateToken, gdprRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const { deletionType = 'complete' } = req.body;

    if (!['partial', 'complete'].includes(deletionType)) {
      res.status(400).json({
        success: false,
        message: 'Invalid deletion type. Must be "partial" or "complete"'
      });
      return;
    }

    const requestId = await GDPRService.requestDataDeletion(userId, deletionType);

    res.status(202).json({
      success: true,
      message: 'Data deletion request submitted successfully',
      data: {
        requestId,
        deletionType,
        estimatedProcessingTime: '7-30 days',
        warning: deletionType === 'complete' 
          ? 'Complete deletion will permanently remove your account and all associated data'
          : 'Partial deletion will anonymize your personal data while preserving game history'
      }
    });
  } catch (error) {
    logger.error('Data deletion request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit data deletion request'
    });
  }
});

/**
 * GET /api/gdpr/deletion-status/:requestId
 * Check data deletion status
 */
router.get('/deletion-status/:requestId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const userId = req.userId!;

    const deletionRequest = GDPRService.getDataDeletionStatus(requestId);

    if (!deletionRequest) {
      res.status(404).json({
        success: false,
        message: 'Deletion request not found'
      });
      return;
    }

    // Verify the request belongs to the authenticated user
    if (deletionRequest.userId !== userId) {
      res.status(403).json({
        success: false,
        message: 'Access denied'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        status: deletionRequest.status,
        requestDate: deletionRequest.requestDate,
        deletionType: deletionRequest.deletionType
      }
    });
  } catch (error) {
    logger.error('Deletion status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check deletion status'
    });
  }
});

/**
 * GET /api/gdpr/data-summary
 * Get summary of user's data (for transparency)
 */
router.get('/data-summary', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;

    // This would typically query the database to get data counts
    // For now, return a placeholder response
    const summary = {
      profile: {
        hasProfile: true,
        lastUpdated: new Date()
      },
      gameHistory: {
        totalGames: 0, // Would be calculated from database
        totalWins: 0,
        totalLosses: 0
      },
      chatMessages: {
        totalMessages: 0 // Would be calculated from database
      },
      analytics: {
        dataPoints: 0, // Would be calculated from database
        oldestRecord: null,
        newestRecord: null
      },
      consent: {
        records: GDPRService.getUserConsent(userId).length
      }
    };

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Data summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve data summary'
    });
  }
});

/**
 * GET /api/gdpr/compliance-info
 * Get GDPR compliance information
 */
router.get('/compliance-info', async (req: Request, res: Response): Promise<void> => {
  try {
    const complianceInfo = {
      dataController: {
        name: 'Mobile Mafia Game',
        contact: 'privacy@mobileamafiagame.com',
        address: 'Your Company Address'
      },
      dataProtectionOfficer: {
        contact: 'dpo@mobilemafiagame.com'
      },
      legalBasis: {
        dataProcessing: 'Legitimate interest for game functionality',
        analytics: 'Consent',
        marketing: 'Consent'
      },
      dataRetention: {
        profileData: '2 years after last activity',
        gameHistory: '5 years for fraud prevention',
        analytics: '2 years',
        chatMessages: '1 year'
      },
      rights: [
        'Right to access your data',
        'Right to rectification',
        'Right to erasure (right to be forgotten)',
        'Right to restrict processing',
        'Right to data portability',
        'Right to object',
        'Rights related to automated decision making'
      ],
      supervisoryAuthority: {
        name: 'Your Local Data Protection Authority',
        website: 'https://example.com'
      }
    };

    res.status(200).json({
      success: true,
      data: complianceInfo
    });
  } catch (error) {
    logger.error('Compliance info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve compliance information'
    });
  }
});

export { router as gdprRoutes };