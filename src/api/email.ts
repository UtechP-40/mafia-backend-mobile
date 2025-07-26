import { Router, Request, Response } from 'express';
import { EmailService } from '../services/EmailService';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Test endpoint for sending emails (protected route)
router.post('/test', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { to, template, data } = req.body;

    if (!to || !template) {
      return res.status(400).json({
        success: false,
        message: 'Email address and template are required'
      });
    }

    const validTemplates = ['welcome', 'passwordReset', 'gameInvite', 'notification'];
    if (!validTemplates.includes(template)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template. Valid templates: ' + validTemplates.join(', ')
      });
    }

    const success = await EmailService.sendEmail({
      to,
      subject: `Test Email - ${template}`,
      template,
      data: data || {}
    });

    if (success) {
      return res.json({
        success: true,
        message: 'Test email sent successfully'
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to send test email'
      });
    }
  } catch (error) {
    console.error('Email test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Send welcome email (internal use)
router.post('/welcome', async (req: Request, res: Response) => {
  try {
    const { to, username, gameUrl } = req.body;

    if (!to || !username) {
      return res.status(400).json({
        success: false,
        message: 'Email address and username are required'
      });
    }

    const success = await EmailService.sendWelcomeEmail(to, username, gameUrl);

    if (success) {
      return res.json({
        success: true,
        message: 'Welcome email sent successfully'
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to send welcome email'
      });
    }
  } catch (error) {
    console.error('Welcome email error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;