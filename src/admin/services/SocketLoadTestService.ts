import { io as SocketIOClient, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';
import { adminLogger } from '../config/logger';

interface LoadTestConfig {
  serverUrl: string;
  namespace?: string;
  connectionCount: number;
  eventRate: number; // events per second per connection
  duration: number; // seconds
  authToken?: string;
  eventTypes: string[];
  payloadSize?: number; // bytes
}

interface LoadTestResult {
  testId: string;
  config: LoadTestConfig;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  metrics: {
    totalConnections: number;
    successfulConnections: number;
    failedConnections: number;
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    connectionsPerSecond: number;
    eventsPerSecond: number;
    errorRate: number;
    throughput: number; // bytes per second
  };
  errors: Array<{
    timestamp: Date;
    type: string;
    message: string;
    connectionId?: string;
  }>;
  connectionMetrics: Map<string, {
    connectionId: string;
    connected: boolean;
    connectTime?: number;
    disconnectTime?: number;
    eventsSent: number;
    eventsReceived: number;
    errors: number;
    latencies: number[];
    averageLatency: number;
  }>;
}

interface TestConnection {
  id: string;
  socket: Socket;
  connected: boolean;
  eventsSent: number;
  eventsReceived: number;
  errors: number;
  latencies: number[];
  connectTime?: number;
  disconnectTime?: number;
  eventInterval?: NodeJS.Timeout;
}

export class SocketLoadTestService extends EventEmitter {
  private static instance: SocketLoadTestService;
  private activeTests: Map<string, LoadTestResult> = new Map();
  private testConnections: Map<string, Map<string, TestConnection>> = new Map();

  private constructor() {
    super();
  }

  public static getInstance(): SocketLoadTestService {
    if (!SocketLoadTestService.instance) {
      SocketLoadTestService.instance = new SocketLoadTestService();
    }
    return SocketLoadTestService.instance;
  }

  public async startLoadTest(config: LoadTestConfig): Promise<string> {
    const testId = `load_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const result: LoadTestResult = {
      testId,
      config,
      startTime: new Date(),
      status: 'running',
      metrics: {
        totalConnections: config.connectionCount,
        successfulConnections: 0,
        failedConnections: 0,
        totalEvents: 0,
        successfulEvents: 0,
        failedEvents: 0,
        averageLatency: 0,
        minLatency: Infinity,
        maxLatency: 0,
        connectionsPerSecond: 0,
        eventsPerSecond: 0,
        errorRate: 0,
        throughput: 0
      },
      errors: [],
      connectionMetrics: new Map()
    };

    this.activeTests.set(testId, result);
    this.testConnections.set(testId, new Map());

    adminLogger.info('Starting socket load test', {
      testId,
      config: {
        connectionCount: config.connectionCount,
        eventRate: config.eventRate,
        duration: config.duration,
        namespace: config.namespace
      }
    });

    try {
      await this.executeLoadTest(testId, config, result);
    } catch (error) {
      result.status = 'failed';
      result.endTime = new Date();
      this.addError(result, 'TEST_EXECUTION', error instanceof Error ? error.message : 'Unknown error');
      adminLogger.error('Load test execution failed', { testId, error });
    }

    return testId;
  }

  private async executeLoadTest(testId: string, config: LoadTestConfig, result: LoadTestResult): Promise<void> {
    const connections = this.testConnections.get(testId)!;
    const connectionPromises: Promise<void>[] = [];

    // Create connections in batches to avoid overwhelming the server
    const batchSize = Math.min(50, config.connectionCount);
    const batches = Math.ceil(config.connectionCount / batchSize);

    for (let batch = 0; batch < batches; batch++) {
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, config.connectionCount);

      for (let i = batchStart; i < batchEnd; i++) {
        const connectionPromise = this.createTestConnection(testId, config, result, i);
        connectionPromises.push(connectionPromise);
      }

      // Wait a bit between batches
      if (batch < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Wait for all connections to be established (or fail)
    await Promise.allSettled(connectionPromises);

    // Calculate connections per second
    const connectionTime = (Date.now() - result.startTime.getTime()) / 1000;
    result.metrics.connectionsPerSecond = result.metrics.successfulConnections / connectionTime;

    // Start event generation for successful connections
    this.startEventGeneration(testId, config, result);

    // Set up test duration timer
    setTimeout(() => {
      this.stopLoadTest(testId);
    }, config.duration * 1000);

    // Set up metrics collection interval
    const metricsInterval = setInterval(() => {
      this.updateMetrics(testId, result);
      this.emit('metrics-update', { testId, metrics: result.metrics });
    }, 1000);

    // Clean up interval when test ends
    setTimeout(() => {
      clearInterval(metricsInterval);
    }, config.duration * 1000 + 5000);
  }

  private async createTestConnection(
    testId: string, 
    config: LoadTestConfig, 
    result: LoadTestResult, 
    connectionIndex: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const connectionId = `conn_${connectionIndex}`;
      const serverUrl = config.namespace ? 
        `${config.serverUrl}${config.namespace}` : 
        config.serverUrl;

      const socketOptions: any = {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        forceNew: true
      };

      if (config.authToken) {
        socketOptions.auth = { token: config.authToken };
      }

      const socket = SocketIOClient(serverUrl, socketOptions);
      
      const connection: TestConnection = {
        id: connectionId,
        socket,
        connected: false,
        eventsSent: 0,
        eventsReceived: 0,
        errors: 0,
        latencies: []
      };

      const connections = this.testConnections.get(testId)!;
      connections.set(connectionId, connection);

      const connectTimeout = setTimeout(() => {
        if (!connection.connected) {
          result.metrics.failedConnections++;
          this.addError(result, 'CONNECTION_TIMEOUT', `Connection ${connectionId} timed out`);
          socket.disconnect();
          resolve();
        }
      }, 10000);

      socket.on('connect', () => {
        clearTimeout(connectTimeout);
        connection.connected = true;
        connection.connectTime = Date.now();
        result.metrics.successfulConnections++;
        
        adminLogger.debug('Test connection established', { testId, connectionId });
        resolve();
      });

      socket.on('connect_error', (error) => {
        clearTimeout(connectTimeout);
        connection.errors++;
        result.metrics.failedConnections++;
        this.addError(result, 'CONNECTION_ERROR', error.message, connectionId);
        resolve();
      });

      socket.on('disconnect', (reason) => {
        connection.connected = false;
        connection.disconnectTime = Date.now();
        adminLogger.debug('Test connection disconnected', { testId, connectionId, reason });
      });

      socket.on('error', (error) => {
        connection.errors++;
        this.addError(result, 'SOCKET_ERROR', error.message || error, connectionId);
      });

      // Set up event response handlers
      config.eventTypes.forEach(eventType => {
        socket.on(eventType, (data) => {
          connection.eventsReceived++;
          result.metrics.totalEvents++;
          
          // Calculate latency if timestamp is included
          if (data && data.timestamp) {
            const latency = Date.now() - data.timestamp;
            connection.latencies.push(latency);
            this.updateLatencyMetrics(result, latency);
          }
        });
      });

      // Set up ping/pong for latency measurement
      socket.on('pong', (timestamp) => {
        const latency = Date.now() - timestamp;
        connection.latencies.push(latency);
        this.updateLatencyMetrics(result, latency);
      });
    });
  }

  private startEventGeneration(testId: string, config: LoadTestConfig, result: LoadTestResult): void {
    const connections = this.testConnections.get(testId)!;
    const eventInterval = 1000 / config.eventRate; // milliseconds between events

    connections.forEach((connection, connectionId) => {
      if (!connection.connected) return;

      connection.eventInterval = setInterval(() => {
        if (!connection.connected) {
          if (connection.eventInterval) {
            clearInterval(connection.eventInterval);
          }
          return;
        }

        try {
          const eventType = config.eventTypes[Math.floor(Math.random() * config.eventTypes.length)];
          const payload = this.generateEventPayload(config.payloadSize || 100);
          
          connection.socket.emit(eventType, {
            ...payload,
            timestamp: Date.now(),
            connectionId,
            testId
          });

          connection.eventsSent++;
          result.metrics.successfulEvents++;

          // Send periodic ping for latency measurement
          if (connection.eventsSent % 10 === 0) {
            connection.socket.emit('ping', Date.now());
          }

        } catch (error) {
          connection.errors++;
          result.metrics.failedEvents++;
          this.addError(result, 'EVENT_SEND_ERROR', 
            error instanceof Error ? error.message : 'Unknown error', connectionId);
        }
      }, eventInterval);
    });
  }

  private generateEventPayload(size: number): any {
    const basePayload = {
      type: 'load_test',
      data: 'x'.repeat(Math.max(0, size - 50)) // Adjust for other fields
    };
    
    return basePayload;
  }

  private updateLatencyMetrics(result: LoadTestResult, latency: number): void {
    result.metrics.minLatency = Math.min(result.metrics.minLatency, latency);
    result.metrics.maxLatency = Math.max(result.metrics.maxLatency, latency);
    
    // Update average latency (simplified calculation)
    const connections = Array.from(this.testConnections.get(result.testId)?.values() || []);
    const allLatencies = connections.flatMap(conn => conn.latencies);
    
    if (allLatencies.length > 0) {
      result.metrics.averageLatency = allLatencies.reduce((sum, lat) => sum + lat, 0) / allLatencies.length;
    }
  }

  private updateMetrics(testId: string, result: LoadTestResult): void {
    const connections = this.testConnections.get(testId);
    if (!connections) return;

    // Update connection metrics
    connections.forEach((connection, connectionId) => {
      const avgLatency = connection.latencies.length > 0 ?
        connection.latencies.reduce((sum, lat) => sum + lat, 0) / connection.latencies.length : 0;

      result.connectionMetrics.set(connectionId, {
        connectionId,
        connected: connection.connected,
        connectTime: connection.connectTime,
        disconnectTime: connection.disconnectTime,
        eventsSent: connection.eventsSent,
        eventsReceived: connection.eventsReceived,
        errors: connection.errors,
        latencies: [...connection.latencies],
        averageLatency: avgLatency
      });
    });

    // Calculate aggregate metrics
    const totalEventsSent = Array.from(connections.values())
      .reduce((sum, conn) => sum + conn.eventsSent, 0);
    
    const totalEventsReceived = Array.from(connections.values())
      .reduce((sum, conn) => sum + conn.eventsReceived, 0);

    const testDuration = (Date.now() - result.startTime.getTime()) / 1000;
    
    result.metrics.eventsPerSecond = totalEventsSent / testDuration;
    result.metrics.errorRate = result.errors.length > 0 ? 
      (result.errors.length / (totalEventsSent + result.errors.length)) * 100 : 0;
    
    // Estimate throughput (rough calculation)
    const avgPayloadSize = result.config.payloadSize || 100;
    result.metrics.throughput = (totalEventsSent * avgPayloadSize) / testDuration;
  }

  private addError(result: LoadTestResult, type: string, message: string, connectionId?: string): void {
    result.errors.push({
      timestamp: new Date(),
      type,
      message,
      connectionId
    });
  }

  public stopLoadTest(testId: string): boolean {
    const result = this.activeTests.get(testId);
    const connections = this.testConnections.get(testId);

    if (!result || !connections) {
      return false;
    }

    adminLogger.info('Stopping load test', { testId });

    result.status = 'completed';
    result.endTime = new Date();

    // Clean up all connections
    connections.forEach((connection) => {
      if (connection.eventInterval) {
        clearInterval(connection.eventInterval);
      }
      if (connection.socket) {
        connection.socket.disconnect();
      }
    });

    // Final metrics update
    this.updateMetrics(testId, result);

    adminLogger.info('Load test completed', {
      testId,
      duration: result.endTime.getTime() - result.startTime.getTime(),
      metrics: result.metrics
    });

    this.emit('test-completed', { testId, result });

    // Clean up after a delay
    setTimeout(() => {
      this.testConnections.delete(testId);
    }, 60000); // Keep results for 1 minute

    return true;
  }

  public getTestResult(testId: string): LoadTestResult | undefined {
    return this.activeTests.get(testId);
  }

  public getActiveTests(): LoadTestResult[] {
    return Array.from(this.activeTests.values())
      .filter(test => test.status === 'running');
  }

  public getAllTests(): LoadTestResult[] {
    return Array.from(this.activeTests.values());
  }

  public cancelTest(testId: string): boolean {
    const result = this.activeTests.get(testId);
    if (!result || result.status !== 'running') {
      return false;
    }

    result.status = 'cancelled';
    result.endTime = new Date();

    return this.stopLoadTest(testId);
  }

  public cleanup(): void {
    // Stop all active tests
    this.activeTests.forEach((result, testId) => {
      if (result.status === 'running') {
        this.stopLoadTest(testId);
      }
    });

    // Clear all data
    this.activeTests.clear();
    this.testConnections.clear();

    adminLogger.info('Socket load test service cleaned up');
  }

  // Stress testing with gradually increasing load
  public async startStressTest(baseConfig: LoadTestConfig, options: {
    maxConnections: number;
    incrementStep: number;
    incrementInterval: number; // seconds
    stopOnFailureRate?: number; // percentage
  }): Promise<string> {
    const stressTestId = `stress_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    adminLogger.info('Starting socket stress test', {
      stressTestId,
      baseConfig,
      options
    });

    let currentConnections = baseConfig.connectionCount;
    const stressResults: LoadTestResult[] = [];

    const runStressPhase = async (connections: number): Promise<LoadTestResult> => {
      const phaseConfig = { ...baseConfig, connectionCount: connections };
      const testId = await this.startLoadTest(phaseConfig);
      
      // Wait for test to complete
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const result = this.getTestResult(testId);
          if (result && result.status !== 'running') {
            clearInterval(checkInterval);
            resolve(result);
          }
        }, 1000);
      });
    };

    // Run stress test phases
    while (currentConnections <= options.maxConnections) {
      const phaseResult = await runStressPhase(currentConnections);
      stressResults.push(phaseResult);

      // Check if we should stop due to high failure rate
      if (options.stopOnFailureRate && phaseResult.metrics.errorRate > options.stopOnFailureRate) {
        adminLogger.warn('Stress test stopped due to high failure rate', {
          stressTestId,
          connections: currentConnections,
          errorRate: phaseResult.metrics.errorRate
        });
        break;
      }

      currentConnections += options.incrementStep;

      // Wait before next phase
      if (currentConnections <= options.maxConnections) {
        await new Promise(resolve => setTimeout(resolve, options.incrementInterval * 1000));
      }
    }

    adminLogger.info('Stress test completed', {
      stressTestId,
      phases: stressResults.length,
      maxConnectionsTested: Math.min(currentConnections - options.incrementStep, options.maxConnections)
    });

    return stressTestId;
  }
}

export default SocketLoadTestService;