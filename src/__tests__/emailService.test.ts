import { EmailService } from '../services/EmailService';
import nodemailer from 'nodemailer';

// Mock nodemailer
jest.mock('nodemailer');
const mockedNodemailer = nodemailer as jest.Mocked<typeof nodemailer>;

describe('EmailService', () => {
  let mockTransporter: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock transporter
    mockTransporter = {
      sendMail: jest.fn()
    };
    
    // Set the mock transporter directly
    EmailService.setTransporter(mockTransporter);
    
    // Mock environment variables
    process.env.GMAIL_USER = 'test@gmail.com';
    process.env.GMAIL_PASS = 'testpassword';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_PASS;
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const result = await EmailService.sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        template: 'welcome',
        data: { username: 'testuser' }
      });

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: '"🎭 Mafia Game" <test@gmail.com>',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: expect.stringContaining('Welcome aboard, testuser!')
      });
    });

    it('should return false when Gmail credentials are missing', async () => {
      delete process.env.GMAIL_USER;
      delete process.env.GMAIL_PASS;

      const result = await EmailService.sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        template: 'welcome',
        data: { username: 'testuser' }
      });

      expect(result).toBe(false);
      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('should handle email sending errors', async () => {
      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP Error'));

      const result = await EmailService.sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        template: 'welcome',
        data: { username: 'testuser' }
      });

      expect(result).toBe(false);
    });
  });

  describe('sendWelcomeEmail', () => {
    it('should send welcome email with correct template', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const result = await EmailService.sendWelcomeEmail(
        'user@example.com',
        'testuser',
        'https://game.example.com'
      );

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: '"🎭 Mafia Game" <test@gmail.com>',
        to: 'user@example.com',
        subject: '🎭 Welcome to Mafia Game - Let the Games Begin!',
        html: expect.stringContaining('Welcome aboard, testuser!')
      });
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset email with correct template', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const result = await EmailService.sendPasswordResetEmail(
        'user@example.com',
        'testuser',
        'https://game.example.com/reset?token=abc123'
      );

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: '"🎭 Mafia Game" <test@gmail.com>',
        to: 'user@example.com',
        subject: '🔐 Reset Your Mafia Game Password',
        html: expect.stringContaining('Reset Your Password')
      });
    });
  });

  describe('sendGameInviteEmail', () => {
    it('should send game invite email with correct template', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const roomData = {
        name: 'Test Room',
        players: ['player1', 'player2'],
        maxPlayers: 10,
        gameMode: 'Classic',
        status: 'waiting'
      };

      const result = await EmailService.sendGameInviteEmail(
        'user@example.com',
        'testuser',
        'inviter',
        roomData,
        'https://game.example.com/join/room123'
      );

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: '"🎭 Mafia Game" <test@gmail.com>',
        to: 'user@example.com',
        subject: '🎭 inviter invited you to a Mafia Game!',
        html: expect.stringContaining('You\'re Invited to a Mafia Game!')
      });
    });
  });

  describe('sendNotificationEmail', () => {
    it('should send notification email with correct template', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      const result = await EmailService.sendNotificationEmail(
        'user@example.com',
        'testuser',
        'Game Update',
        'Your game has started!',
        'https://game.example.com/game/123',
        'Join Game'
      );

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith({
        from: '"🎭 Mafia Game" <test@gmail.com>',
        to: 'user@example.com',
        subject: '🔔 Game Update',
        html: expect.stringContaining('Your game has started!')
      });
    });
  });

  describe('email templates', () => {
    it('should generate welcome template with user data', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await EmailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        template: 'welcome',
        data: { username: 'John', gameUrl: 'https://game.com' }
      });

      const emailCall = mockTransporter.sendMail.mock.calls[0][0];
      expect(emailCall.html).toContain('Welcome aboard, John!');
      expect(emailCall.html).toContain('href="https://game.com"');
      expect(emailCall.html).toContain('🎭 Welcome to Mafia Game!');
    });

    it('should generate password reset template with reset URL', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await EmailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        template: 'passwordReset',
        data: { username: 'John', resetUrl: 'https://game.com/reset/token123' }
      });

      const emailCall = mockTransporter.sendMail.mock.calls[0][0];
      expect(emailCall.html).toContain('Hi John,');
      expect(emailCall.html).toContain('href="https://game.com/reset/token123"');
      expect(emailCall.html).toContain('Reset Your Password');
    });

    it('should generate game invite template with room details', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await EmailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        template: 'gameInvite',
        data: {
          username: 'John',
          inviterName: 'Alice',
          roomName: 'Epic Game',
          currentPlayers: 5,
          maxPlayers: 10,
          gameMode: 'Classic',
          status: 'waiting',
          joinUrl: 'https://game.com/join/room123'
        }
      });

      const emailCall = mockTransporter.sendMail.mock.calls[0][0];
      expect(emailCall.html).toContain('Hey John,');
      expect(emailCall.html).toContain('<strong>Alice</strong> has invited you');
      expect(emailCall.html).toContain('Epic Game');
      expect(emailCall.html).toContain('5/10');
      expect(emailCall.html).toContain('href="https://game.com/join/room123"');
    });

    it('should generate notification template with custom message', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await EmailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        template: 'notification',
        data: {
          username: 'John',
          title: 'Game Started',
          message: 'Your mafia game has begun!',
          actionUrl: 'https://game.com/play',
          actionText: 'Play Now'
        }
      });

      const emailCall = mockTransporter.sendMail.mock.calls[0][0];
      expect(emailCall.html).toContain('Hi John,');
      expect(emailCall.html).toContain('Your mafia game has begun!');
      expect(emailCall.html).toContain('href="https://game.com/play"');
      expect(emailCall.html).toContain('Play Now');
    });

    it('should handle missing data gracefully', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-message-id' });

      await EmailService.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        template: 'welcome',
        data: {} // No username provided
      });

      const emailCall = mockTransporter.sendMail.mock.calls[0][0];
      expect(emailCall.html).toContain('Welcome aboard, Player!'); // Default fallback
    });
  });
});