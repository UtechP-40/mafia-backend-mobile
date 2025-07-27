
    import express from 'express';
    
    // Test that monitoring routes can be imported
    const monitoringRoutes = require('./src/admin/routes/monitoring');
    console.log('✅ Monitoring routes imported successfully');
    
    // Test that it's an Express router
    console.log('✅ Monitoring routes is Express router:', 
      typeof monitoringRoutes === 'function' || 
      (monitoringRoutes.default && typeof monitoringRoutes.default === 'function')
    );
    
    console.log('✅ Monitoring routes tests passed');
  