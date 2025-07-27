const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function testEmailConfiguration() {
  console.log('Testing email configuration...');
  
  // Check if environment variables are set
  console.log('GMAIL_USER:', process.env.GMAIL_USER ? 'Set' : 'Not set');
  console.log('GMAIL_PASS:', process.env.GMAIL_PASS ? 'Set' : 'Not set');
  
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.error('Gmail credentials not configured in .env file');
    return;
  }
  
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });
    
    // Verify connection
    await transporter.verify();
    console.log('✅ Email configuration is valid');
    
    // Send test email
    const testEmail = {
      from: `"🔐 Admin Portal Test" <${process.env.GMAIL_USER}>`,
      to: 'pradeep2420pradeep@gmail.com', // Send to self for testing
      subject: '🧪 Email Approval System Test',
      html: `
        <h2>Email Approval System Test</h2>
        <p>This is a test email to verify the email approval workflow system is working correctly.</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p>If you received this email, the email configuration is working properly!</p>
      `
    };
    
    const result = await transporter.sendMail(testEmail);
    console.log('✅ Test email sent successfully');
    console.log('Message ID:', result.messageId);
    
  } catch (error) {
    console.error('❌ Email configuration test failed:', error.message);
  }
}

testEmailConfiguration();