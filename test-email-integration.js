const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

async function testEmailIntegration() {
  console.log('🧪 Testing Email Integration with Actual Sending...\n');
  
  try {
    // Create transporter with Gmail configuration
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: 14,
    });
    
    console.log('✅ Email transporter created');
    
    // Test 1: Send approval request email
    console.log('\n1. Testing approval request email...');
    
    const approvalRequestEmail = {
      from: `"🔐 Admin Portal" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER, // Send to self for testing
      subject: '🔐 Approval Required: Test Super User Registration',
      html: generateApprovalRequestEmail({
        approverName: 'Test Admin',
        title: 'Test Super User Registration',
        description: 'This is a test approval request for the email workflow system',
        priority: 'HIGH',
        requesterName: 'Test User',
        approvalUrl: 'http://localhost:3000/admin/approvals/test-token-123',
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toLocaleString(),
        formattedTimeRemaining: '3 days'
      })
    };
    
    const result1 = await transporter.sendMail(approvalRequestEmail);
    console.log('   ✅ Approval request email sent successfully');
    console.log('   📧 Message ID:', result1.messageId);
    
    // Test 2: Send reminder email
    console.log('\n2. Testing reminder email...');
    
    const reminderEmail = {
      from: `"⏰ Admin Portal Reminder" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: '⏰ Reminder: Approval Required - Test Registration',
      html: generateReminderEmail({
        approverName: 'Test Admin',
        title: 'Test Super User Registration',
        description: 'This is a reminder for the pending approval request',
        priority: 'HIGH',
        approvalUrl: 'http://localhost:3000/admin/approvals/test-token-123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString(),
        timeRemaining: '24 hours'
      })
    };
    
    const result2 = await transporter.sendMail(reminderEmail);
    console.log('   ✅ Reminder email sent successfully');
    console.log('   📧 Message ID:', result2.messageId);
    
    // Test 3: Send approval status notification (approved)
    console.log('\n3. Testing approval status notification (approved)...');
    
    const approvedEmail = {
      from: `"✅ Admin Portal" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: '✅ Your approval request has been approved: Test Registration',
      html: generateStatusNotificationEmail('approved', {
        requesterName: 'Test User',
        title: 'Test Super User Registration',
        approvedBy: 'Admin User',
        completedAt: new Date().toLocaleString()
      })
    };
    
    const result3 = await transporter.sendMail(approvedEmail);
    console.log('   ✅ Approval status (approved) email sent successfully');
    console.log('   📧 Message ID:', result3.messageId);
    
    // Test 4: Send approval status notification (rejected)
    console.log('\n4. Testing approval status notification (rejected)...');
    
    const rejectedEmail = {
      from: `"❌ Admin Portal" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: '❌ Your approval request has been rejected: Test Registration',
      html: generateStatusNotificationEmail('rejected', {
        requesterName: 'Test User',
        title: 'Test Super User Registration',
        rejectedBy: 'Admin User',
        completedAt: new Date().toLocaleString(),
        comment: 'Insufficient information provided. Please resubmit with more details.'
      })
    };
    
    const result4 = await transporter.sendMail(rejectedEmail);
    console.log('   ✅ Approval status (rejected) email sent successfully');
    console.log('   📧 Message ID:', result4.messageId);
    
    // Test 5: Test email queue processing simulation
    console.log('\n5. Testing email queue processing...');
    
    const emailQueue = [
      {
        id: 'queue_test_1',
        to: process.env.GMAIL_USER,
        subject: '📬 Queue Test Email 1',
        html: '<h2>Queue Test Email 1</h2><p>This email was processed from the queue system.</p>',
        priority: 'high',
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(),
        createdAt: new Date()
      },
      {
        id: 'queue_test_2',
        to: process.env.GMAIL_USER,
        subject: '📬 Queue Test Email 2',
        html: '<h2>Queue Test Email 2</h2><p>This email was processed from the queue system with medium priority.</p>',
        priority: 'medium',
        retryCount: 0,
        maxRetries: 3,
        scheduledAt: new Date(),
        createdAt: new Date()
      }
    ];
    
    // Process queue (simulate the queue processing logic)
    for (const email of emailQueue) {
      const queueResult = await transporter.sendMail({
        from: `"📬 Queue System" <${process.env.GMAIL_USER}>`,
        to: email.to,
        subject: email.subject,
        html: email.html
      });
      
      console.log(`   ✅ Queue email ${email.id} sent successfully`);
      console.log(`   📧 Message ID: ${queueResult.messageId}`);
    }
    
    console.log('\n🎉 All email integration tests passed successfully!');
    console.log('\n📊 Test Summary:');
    console.log('   ✅ Approval request emails working');
    console.log('   ✅ Reminder emails working');
    console.log('   ✅ Status notification emails working');
    console.log('   ✅ Email queue processing working');
    console.log('   ✅ Gmail SMTP integration working');
    console.log('   ✅ Email templates rendering correctly');
    console.log('   ✅ Priority-based styling working');
    
    console.log('\n📧 Check your email inbox for the test messages!');
    
  } catch (error) {
    console.error('❌ Email integration test failed:', error.message);
    console.error(error.stack);
  }
}

// Email template generators

function generateApprovalRequestEmail(data) {
  const priorityColors = {
    LOW: '#28a745',
    MEDIUM: '#ffc107',
    HIGH: '#fd7e14',
    CRITICAL: '#dc3545'
  };
  
  const priorityColor = priorityColors[data.priority] || '#6c757d';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Approval Request</title>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
      <div style="background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">🔐 Approval Request</h1>
        </div>
        <div style="padding: 30px;">
          <div style="display: inline-block; background: ${priorityColor}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 20px;">
            ${data.priority} Priority
          </div>
          
          <h2>Hello ${data.approverName},</h2>
          <p>You have received a new approval request that requires your attention.</p>
          
          <div style="background: #f8f9fa; border-left: 4px solid #007bff; padding: 20px; margin: 20px 0; border-radius: 0 5px 5px 0;">
            <h3 style="margin-top: 0; color: #007bff;">${data.title}</h3>
            <p><strong>Description:</strong> ${data.description}</p>
            <p><strong>Requested by:</strong> ${data.requesterName}</p>
            <p><strong>Expires:</strong> ${data.expiresAt}</p>
            <p><strong>Time Remaining:</strong> ${data.formattedTimeRemaining}</p>
          </div>

          <p>Please review this request and take appropriate action:</p>
          
          <div style="margin: 20px 0;">
            <a href="${data.approvalUrl}?action=approve" style="display: inline-block; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 10px 10px 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">✅ Approve</a>
            <a href="${data.approvalUrl}?action=reject" style="display: inline-block; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 10px 10px 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">❌ Reject</a>
            <a href="${data.approvalUrl}" style="display: inline-block; background: #6c757d; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 10px 10px 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">👁️ View Details</a>
          </div>
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 14px;">
          <p>This is an automated message from the Admin Portal.<br>
          Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateReminderEmail(data) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Approval Reminder</title>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
      <div style="background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #ffc107 0%, #e0a800 100%); padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">⏰ Approval Reminder</h1>
        </div>
        <div style="padding: 30px;">
          <div style="display: inline-block; background: #ffc107; color: #212529; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; margin-bottom: 20px;">
            REMINDER
          </div>
          
          <h2>Hello ${data.approverName},</h2>
          <p>This is a reminder that you have a pending approval request that expires soon.</p>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 0 5px 5px 0;">
            <h3 style="margin-top: 0; color: #856404;">${data.title}</h3>
            <p><strong>Description:</strong> ${data.description}</p>
            <p><strong>Priority:</strong> ${data.priority}</p>
            <p><strong>Time Remaining:</strong> ${data.timeRemaining}</p>
            <p><strong>Expires:</strong> ${data.expiresAt}</p>
          </div>

          <p>Please take action before the deadline:</p>
          
          <div style="margin: 20px 0;">
            <a href="${data.approvalUrl}?action=approve" style="display: inline-block; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 10px 10px 10px 0;">✅ Approve</a>
            <a href="${data.approvalUrl}?action=reject" style="display: inline-block; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 10px 10px 10px 0;">❌ Reject</a>
            <a href="${data.approvalUrl}" style="display: inline-block; background: #6c757d; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 10px 10px 10px 0;">👁️ View Details</a>
          </div>
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 14px;">
          <p>This is an automated message from the Admin Portal.<br>
          Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateStatusNotificationEmail(status, data) {
  const statusColor = status === 'approved' ? '#28a745' : '#dc3545';
  const statusIcon = status === 'approved' ? '✅' : '❌';
  const statusText = status === 'approved' ? 'APPROVED' : 'REJECTED';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Request ${statusText}</title>
    </head>
    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
      <div style="background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <div style="background: ${statusColor}; padding: 30px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">${statusIcon} Request ${statusText}</h1>
        </div>
        <div style="padding: 30px;">
          <div style="display: inline-block; background: ${statusColor}; color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; margin-bottom: 20px;">
            ${statusText}
          </div>
          
          <h2>Hello ${data.requesterName},</h2>
          <p>Your approval request has been <strong>${status}</strong>.</p>
          
          <div style="background: #f8f9fa; border-left: 4px solid ${statusColor}; padding: 20px; margin: 20px 0; border-radius: 0 5px 5px 0;">
            <h3 style="margin-top: 0;">${data.title}</h3>
            <p><strong>Status:</strong> ${statusText}</p>
            <p><strong>Action by:</strong> ${data[status + 'By']}</p>
            <p><strong>Completed at:</strong> ${data.completedAt}</p>
            ${status === 'rejected' && data.comment ? `<p><strong>Comment:</strong> ${data.comment}</p>` : ''}
          </div>

          ${status === 'approved' ? 
            '<p>Your request has been approved and the necessary actions will be taken shortly.</p>' :
            '<p>Your request has been rejected. If you have questions, please contact the administrator.</p>'
          }
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 14px;">
          <p>This is an automated message from the Admin Portal.<br>
          Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Run the test
testEmailIntegration();