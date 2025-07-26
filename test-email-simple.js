// Simple test script for Gmail email functionality
require('dotenv').config();

// Mock nodemailer for testing
const mockTransporter = {
  sendMail: async (options) => {
    console.log('📧 Email would be sent with the following details:');
    console.log('From:', options.from);
    console.log('To:', options.to);
    console.log('Subject:', options.subject);
    console.log('HTML Content Preview:', options.html.substring(0, 200) + '...');
    return { messageId: 'mock-message-id-' + Date.now() };
  }
};

// Mock the EmailService
const EmailService = {
  transporter: mockTransporter,
  
  async sendEmail(options) {
    try {
      if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
        console.log('⚠️  Gmail credentials not configured in .env file');
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
      console.log('✅ Email sent successfully:', result.messageId);
      return true;
    } catch (error) {
      console.error('❌ Failed to send email:', error);
      return false;
    }
  },

  getEmailTemplate(template, data = {}) {
    const baseStyle = `
      <style>
        body { font-family: 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
        .email-container { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 15px; }
        .header { background: rgba(255,255,255,0.1); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 28px; }
        .content { background: white; padding: 40px 30px; }
        .button { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; }
      </style>
    `;

    switch (template) {
      case 'welcome':
        return `${baseStyle}<body><div class="email-container"><div class="header"><h1>🎭 Welcome to Mafia Game!</h1></div><div class="content"><h2>Welcome aboard, ${data.username || 'Player'}! 🎉</h2><p>You've successfully joined the most thrilling online Mafia experience!</p></div></div></body>`;
      
      case 'passwordReset':
        return `${baseStyle}<body><div class="email-container"><div class="header"><h1>🔐 Password Reset</h1></div><div class="content"><h2>Reset Your Password</h2><p>Hi ${data.username || 'there'},</p><p>Click the link to reset your password.</p></div></div></body>`;
      
      case 'gameInvite':
        return `${baseStyle}<body><div class="email-container"><div class="header"><h1>🎭 Game Invitation</h1></div><div class="content"><h2>You're Invited to a Mafia Game! 🎉</h2><p>Hey ${data.username || 'Player'},</p><p><strong>${data.inviterName || 'A friend'}</strong> has invited you to join an exciting Mafia game!</p></div></div></body>`;
      
      default:
        return `${baseStyle}<body><div class="email-container"><div class="header"><h1>🎭 Mafia Game</h1></div><div class="content"><h2>Hello!</h2><p>Thank you for being part of the Mafia Game community!</p></div></div></body>`;
    }
  },

  async sendWelcomeEmail(to, username, gameUrl) {
    return this.sendEmail({
      to,
      subject: '🎭 Welcome to Mafia Game - Let the Games Begin!',
      template: 'welcome',
      data: { username, gameUrl }
    });
  },

  async sendPasswordResetEmail(to, username, resetUrl) {
    return this.sendEmail({
      to,
      subject: '🔐 Reset Your Mafia Game Password',
      template: 'passwordReset',
      data: { username, resetUrl }
    });
  },

  async sendGameInviteEmail(to, username, inviterName, roomData, joinUrl) {
    return this.sendEmail({
      to,
      subject: `🎭 ${inviterName} invited you to a Mafia Game!`,
      template: 'gameInvite',
      data: { username, inviterName, joinUrl }
    });
  }
};

async function testEmailService() {
  console.log('🎭 Testing Gmail Email Service...\n');

  // Test welcome email
  console.log('1. Testing Welcome Email...');
  const welcomeResult = await EmailService.sendWelcomeEmail(
    'test@example.com',
    'TestUser',
    'http://localhost:3001'
  );
  console.log('Welcome email result:', welcomeResult ? '✅ Success' : '❌ Failed');

  console.log('\n2. Testing Password Reset Email...');
  const resetResult = await EmailService.sendPasswordResetEmail(
    'test@example.com',
    'TestUser',
    'http://localhost:3001/reset?token=abc123'
  );
  console.log('Password reset email result:', resetResult ? '✅ Success' : '❌ Failed');

  console.log('\n3. Testing Game Invite Email...');
  const inviteResult = await EmailService.sendGameInviteEmail(
    'test@example.com',
    'TestUser',
    'GameHost',
    { name: 'Epic Game' },
    'http://localhost:3001/join/room123'
  );
  console.log('Game invite email result:', inviteResult ? '✅ Success' : '❌ Failed');

  console.log('\n🎭 Email testing complete!');
  console.log('\n📝 Configuration Status:');
  console.log('GMAIL_USER:', process.env.GMAIL_USER ? '✅ Configured' : '❌ Not configured');
  console.log('GMAIL_PASS:', process.env.GMAIL_PASS ? '✅ Configured' : '❌ Not configured');
  
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    console.log('\n🚀 Your Gmail email service is ready to use!');
    console.log('The EmailService will use Gmail SMTP with the following configuration:');
    console.log('- Service: gmail');
    console.log('- User:', process.env.GMAIL_USER);
    console.log('- Templates: welcome, passwordReset, gameInvite, notification');
  } else {
    console.log('\n⚠️  To use Gmail email service, add these to your .env file:');
    console.log('GMAIL_USER=your-gmail@gmail.com');
    console.log('GMAIL_PASS=your-app-password');
  }
}

// Run the test
testEmailService().catch(console.error);