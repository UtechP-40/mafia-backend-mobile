import * as nodemailer from 'nodemailer';
import { config } from 'dotenv';

config();

export interface EmailOptions {
  to: string;
  subject: string;
  template: 'welcome' | 'passwordReset' | 'gameInvite' | 'notification';
  data?: Record<string, any>;
}

export class EmailService {
  private static _transporter: any = null;

  private static get transporter() {
    if (!this._transporter) {
      this._transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASS,
        },
      });
    }
    return this._transporter;
  }

  // For testing purposes
  public static setTransporter(transporter: any) {
    this._transporter = transporter;
  }

  private static getEmailTemplate(template: string, data: Record<string, any> = {}): string {
    const baseStyle = `
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          background-color: #f4f4f4;
          padding: 20px;
        }
        .email-container {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 15px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .header {
          background: rgba(255,255,255,0.1);
          padding: 30px;
          text-align: center;
          border-bottom: 1px solid rgba(255,255,255,0.2);
        }
        .header h1 {
          color: white;
          margin: 0;
          font-size: 28px;
          font-weight: 300;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .content {
          background: white;
          padding: 40px 30px;
        }
        .content h2 {
          color: #667eea;
          margin-top: 0;
          font-size: 24px;
          font-weight: 600;
        }
        .content p {
          margin-bottom: 20px;
          font-size: 16px;
          line-height: 1.8;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 15px 30px;
          text-decoration: none;
          border-radius: 25px;
          font-weight: 600;
          margin: 20px 0;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
          transition: transform 0.2s ease;
        }
        .button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        .footer {
          background: #f8f9fa;
          padding: 20px 30px;
          text-align: center;
          border-top: 1px solid #e9ecef;
        }
        .footer p {
          margin: 0;
          color: #6c757d;
          font-size: 14px;
        }
        .game-stats {
          background: #f8f9fa;
          border-radius: 10px;
          padding: 20px;
          margin: 20px 0;
          border-left: 4px solid #667eea;
        }
        .highlight {
          background: linear-gradient(120deg, #a8edea 0%, #fed6e3 100%);
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 600;
        }
      </style>
    `;

    switch (template) {
      case 'welcome':
        return `
          ${baseStyle}
          <body>
            <div class="email-container">
              <div class="header">
                <h1>🎭 Welcome to Mafia Game!</h1>
              </div>
              <div class="content">
                <h2>Welcome aboard, ${data.username || 'Player'}! 🎉</h2>
                <p>You've successfully joined the most thrilling online Mafia experience! Get ready to test your deception skills, form alliances, and outwit your opponents in intense psychological battles.</p>
                
                <div class="game-stats">
                  <h3>🎮 What awaits you:</h3>
                  <ul>
                    <li><strong>Strategic Gameplay:</strong> Use your wits to survive and win</li>
                    <li><strong>Real-time Chat:</strong> Communicate with other players</li>
                    <li><strong>Multiple Roles:</strong> Play as Mafia, Detective, Doctor, and more</li>
                    <li><strong>Ranked Matches:</strong> Climb the leaderboards</li>
                  </ul>
                </div>

                <p>Ready to start your first game? Click the button below to jump into the action!</p>
                
                <a href="${data.gameUrl || '#'}" class="button">🚀 Start Playing Now</a>
                
                <p>Need help getting started? Check out our <a href="${data.guideUrl || '#'}" style="color: #667eea;">beginner's guide</a> or join our community Discord.</p>
              </div>
              <div class="footer">
                <p>Happy gaming! 🎭<br>The Mafia Game Team</p>
              </div>
            </div>
          </body>
        `;

      case 'passwordReset':
        return `
          ${baseStyle}
          <body>
            <div class="email-container">
              <div class="header">
                <h1>🔐 Password Reset</h1>
              </div>
              <div class="content">
                <h2>Reset Your Password</h2>
                <p>Hi ${data.username || 'there'},</p>
                <p>We received a request to reset your password for your Mafia Game account. If you didn't make this request, you can safely ignore this email.</p>
                
                <p>To reset your password, click the button below. This link will expire in <span class="highlight">1 hour</span> for security reasons.</p>
                
                <a href="${data.resetUrl || '#'}" class="button">🔑 Reset Password</a>
                
                <p><strong>Security tip:</strong> Make sure to choose a strong password that includes a mix of letters, numbers, and special characters.</p>
                
                <div class="game-stats">
                  <p><strong>⚠️ Important:</strong> If you didn't request this password reset, please contact our support team immediately.</p>
                </div>
              </div>
              <div class="footer">
                <p>Stay secure! 🛡️<br>The Mafia Game Team</p>
              </div>
            </div>
          </body>
        `;

      case 'gameInvite':
        return `
          ${baseStyle}
          <body>
            <div class="email-container">
              <div class="header">
                <h1>🎭 Game Invitation</h1>
              </div>
              <div class="content">
                <h2>You're Invited to a Mafia Game! 🎉</h2>
                <p>Hey ${data.username || 'Player'},</p>
                <p><strong>${data.inviterName || 'A friend'}</strong> has invited you to join an exciting Mafia game!</p>
                
                <div class="game-stats">
                  <h3>🎮 Game Details:</h3>
                  <ul>
                    <li><strong>Room:</strong> ${data.roomName || 'Private Game'}</li>
                    <li><strong>Players:</strong> ${data.currentPlayers || 0}/${data.maxPlayers || 10}</li>
                    <li><strong>Game Mode:</strong> ${data.gameMode || 'Classic'}</li>
                    <li><strong>Status:</strong> <span class="highlight">${data.status || 'Waiting for players'}</span></li>
                  </ul>
                </div>

                <p>The tension is building and the game is about to begin. Will you be the cunning Mafia member or the vigilant Townsperson? Join now to find out!</p>
                
                <a href="${data.joinUrl || '#'}" class="button">🎭 Join Game</a>
                
                <p><em>Hurry up! Games fill up fast, and you don't want to miss out on the psychological warfare!</em></p>
              </div>
              <div class="footer">
                <p>Good luck and may the best deceiver win! 🏆<br>The Mafia Game Team</p>
              </div>
            </div>
          </body>
        `;

      case 'notification':
        return `
          ${baseStyle}
          <body>
            <div class="email-container">
              <div class="header">
                <h1>🔔 ${data.title || 'Notification'}</h1>
              </div>
              <div class="content">
                <h2>${data.heading || 'Update from Mafia Game'}</h2>
                <p>Hi ${data.username || 'Player'},</p>
                <p>${data.message || 'We have an update for you!'}</p>
                
                ${data.actionUrl ? `<a href="${data.actionUrl}" class="button">${data.actionText || 'Take Action'}</a>` : ''}
                
                ${data.additionalInfo ? `
                <div class="game-stats">
                  <p>${data.additionalInfo}</p>
                </div>
                ` : ''}
              </div>
              <div class="footer">
                <p>Stay in the game! 🎮<br>The Mafia Game Team</p>
              </div>
            </div>
          </body>
        `;

      default:
        return `
          ${baseStyle}
          <body>
            <div class="email-container">
              <div class="header">
                <h1>🎭 Mafia Game</h1>
              </div>
              <div class="content">
                <h2>Hello!</h2>
                <p>Thank you for being part of the Mafia Game community!</p>
              </div>
              <div class="footer">
                <p>The Mafia Game Team</p>
              </div>
            </div>
          </body>
        `;
    }
  }

  public static async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        console.error('Gmail credentials not configured');
        return false;
      }

      const htmlContent = this.getEmailTemplate(options.template, options.data);

      const mailOptions = {
        from: `"🎭 Mafia Game" <${process.env.GMAIL_USER}>`,
        to: options.to,
        subject: options.subject,
        html: htmlContent,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', result.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  // Convenience methods for common email types
  public static async sendWelcomeEmail(to: string, username: string, gameUrl?: string): Promise<boolean> {
    return this.sendEmail({
      to,
      subject: '🎭 Welcome to Mafia Game - Let the Games Begin!',
      template: 'welcome',
      data: { username, gameUrl }
    });
  }

  public static async sendPasswordResetEmail(to: string, username: string, resetUrl: string): Promise<boolean> {
    return this.sendEmail({
      to,
      subject: '🔐 Reset Your Mafia Game Password',
      template: 'passwordReset',
      data: { username, resetUrl }
    });
  }

  public static async sendGameInviteEmail(
    to: string, 
    username: string, 
    inviterName: string, 
    roomData: any, 
    joinUrl: string
  ): Promise<boolean> {
    return this.sendEmail({
      to,
      subject: `🎭 ${inviterName} invited you to a Mafia Game!`,
      template: 'gameInvite',
      data: { 
        username, 
        inviterName, 
        roomName: roomData.name,
        currentPlayers: roomData.players?.length || 0,
        maxPlayers: roomData.maxPlayers,
        gameMode: roomData.gameMode,
        status: roomData.status,
        joinUrl 
      }
    });
  }

  public static async sendNotificationEmail(
    to: string, 
    username: string, 
    title: string, 
    message: string,
    actionUrl?: string,
    actionText?: string
  ): Promise<boolean> {
    return this.sendEmail({
      to,
      subject: `🔔 ${title}`,
      template: 'notification',
      data: { username, title, heading: title, message, actionUrl, actionText }
    });
  }
}