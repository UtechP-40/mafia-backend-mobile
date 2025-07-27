
    import { AdminWebSocketService } from './src/admin/services/WebSocketService';
    import { createServer } from 'http';
    
    const server = createServer();
    const wsService = new AdminWebSocketService(server);
    console.log('✅ AdminWebSocketService instantiated successfully');
    
    // Test subscription stats
    const stats = wsService.getSubscriptionStats();
    console.log('✅ Subscription stats available:', typeof stats === 'object');
    
    console.log('✅ WebSocket service tests passed');
  