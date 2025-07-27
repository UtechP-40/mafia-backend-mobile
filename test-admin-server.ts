import express from 'express';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('Starting minimal admin server test...');

const app = express();
const PORT = process.env.ADMIN_PORT || 4000;

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/admin/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'admin-portal-test',
    version: '1.0.0'
  });
});

// Start server
async function startTestServer() {
  try {
    console.log('Starting test server...');
    
    const server = app.listen(PORT, () => {
      console.log(`Test admin server running on port ${PORT}`);
    });

    console.log('Test server started successfully');
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down test server');
      server.close(() => {
        console.log('Test server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down test server');
      server.close(() => {
        console.log('Test server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start test server:', error);
    process.exit(1);
  }
}

startTestServer();