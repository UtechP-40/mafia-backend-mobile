const { EmailService } = require('./dist/services/EmailService');
require('dotenv').config();

async function testEmail() {
  console.log('Testing Gmail Email Service...\n');

  // Test welcome email
  console.log('1. Testing Welcome Email...');
  const welcomeResult = await EmailService.sendWelcomeEmail(
    'test@example.com', // Replace with your email for testing
    'TestUser',
    'http://localhost:3001'
  );
  console.log('Welcome email result:', welcomeResult ? '✅ Success' : '❌ Failed');

  // Test password reset email
  console.log('\n2. Testing Password Reset Email...');
  const resetResult = await EmailService.sendPasswordResetEmail(
    'test@example.com', // Replace with your email for testing
    'TestUser',
    'http://localhost:3001/reset?token=abc123'
  );
  console.log('Password reset email result:', resetResult ? '✅ Success' : '❌ Failed');

  // Test game invite email
  console.log('\n3. Testing Game Invite Email...');
  const roomData = {
    name: 'Epic Mafia Game',
    players: ['player1', 'player2', 'player3'],
    maxPlayers: 10,
    gameMode: 'Classic',
    status: 'waiting for players'
  };
  const inviteResult = await EmailService.sendGameInviteEmail(
    'test@example.com', // Replace with your email for testing
    'TestUser',
    'GameHost',
    roomData,
    'http://localhost:3001/join/room123'
  );
  console.log('Game invite email result:', inviteResult ? '✅ Success' : '❌ Failed');

  // Test notification email
  console.log('\n4. Testing Notification Email...');
  const notificationResult = await EmailService.sendNotificationEmail(
    'test@example.com', // Replace with your email for testing
    'TestUser',
    'Game Started',
    'Your mafia game has begun! The night phase is starting and roles have been assigned.',
    'http://localhost:3001/game/123',
    'Join Game Now'
  );
  console.log('Notification email result:', notificationResult ? '✅ Success' : '❌ Failed');

  console.log('\n🎭 Email testing complete!');
}

// Run the test
testEmail().catch(console.error);