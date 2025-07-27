import { ApiTestingService, TestResult, ApiEndpoint } from '../services/ApiTestingService';
import { adminLogger } from '../config/logger';
import { AdminLog } from '../models/AdminLog';

export interface AutomatedTestSuite {
  id: string;
  name: string;
  description?: string;
  endpoints: string[];
  schedule?: TestSchedule;
  notifications?: NotificationConfig;
  thresholds?: PerformanceThresholds;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  results?: AutomatedTestResult[];
}

export interface TestSchedule {
  type: 'interval' | 'cron';
  value: string; // Interval in ms or cron expression
  timezone?: string;
}

export interface NotificationConfig {
  onFailure: boolean;
  onSuccess: boolean;
  onThresholdExceeded: boolean;
  recipients: string[];
  channels: ('email' | 'webhook' | 'slack')[];
}

export interface PerformanceThresholds {
  maxResponseTime: number; // milliseconds
  minSuccessRate: number; // percentage
  maxErrorRate: number; // percentage
}

export interface AutomatedTestResult {
  id: string;
  suiteId: string;
  timestamp: Date;
  duration: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  averageResponseTime: number;
  successRate: number;
  errorRate: number;
  thresholdViolations: ThresholdViolation[];
  testResults: TestResult[];
  summary: TestSummary;
}

export interface ThresholdViolation {
  type: 'response_time' | 'success_rate' | 'error_rate';
  threshold: number;
  actual: number;
  endpoint?: string;
  severity: 'low' | 'medium' | 'high';
}

export interface TestSummary {
  status: 'passed' | 'failed' | 'warning';
  message: string;
  recommendations: string[];
}

export class AutomatedTestingService {
  private static testSuites: Map<string, AutomatedTestSuite> = new Map();
  private static scheduledJobs: Map<string, NodeJS.Timeout> = new Map();
  private static testResults: Map<string, AutomatedTestResult[]> = new Map();

  /**
   * Create automated test suite
   */
  static createTestSuite(suite: Omit<AutomatedTestSuite, 'id' | 'lastRun' | 'nextRun' | 'results'>): AutomatedTestSuite {
    const newSuite: AutomatedTestSuite = {
      ...suite,
      id: `suite_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      lastRun: undefined,
      nextRun: suite.schedule ? this.calculateNextRun(suite.schedule) : undefined,
      results: []
    };

    this.testSuites.set(newSuite.id, newSuite);

    if (newSuite.enabled && newSuite.schedule) {
      this.scheduleTestSuite(newSuite);
    }

    adminLogger.info('Automated test suite created', {
      suiteId: newSuite.id,
      name: newSuite.name,
      endpointCount: newSuite.endpoints.length,
      enabled: newSuite.enabled
    });

    return newSuite;
  }

  /**
   * Update test suite
   */
  static updateTestSuite(suiteId: string, updates: Partial<AutomatedTestSuite>): AutomatedTestSuite {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite ${suiteId} not found`);
    }

    const updatedSuite = { ...suite, ...updates };
    this.testSuites.set(suiteId, updatedSuite);

    // Reschedule if schedule changed
    if (updates.schedule || updates.enabled !== undefined) {
      this.unscheduleTestSuite(suiteId);
      if (updatedSuite.enabled && updatedSuite.schedule) {
        this.scheduleTestSuite(updatedSuite);
      }
    }

    adminLogger.info('Automated test suite updated', {
      suiteId,
      updates: Object.keys(updates)
    });

    return updatedSuite;
  }

  /**
   * Delete test suite
   */
  static deleteTestSuite(suiteId: string): boolean {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      return false;
    }

    this.unscheduleTestSuite(suiteId);
    this.testSuites.delete(suiteId);
    this.testResults.delete(suiteId);

    adminLogger.info('Automated test suite deleted', { suiteId });
    return true;
  }

  /**
   * Run test suite manually
   */
  static async runTestSuite(suiteId: string, baseUrl: string = 'http://localhost:3000'): Promise<AutomatedTestResult> {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite ${suiteId} not found`);
    }

    const startTime = Date.now();
    const testResults: TestResult[] = [];
    const thresholdViolations: ThresholdViolation[] = [];

    adminLogger.info('Running automated test suite', {
      suiteId,
      name: suite.name,
      endpointCount: suite.endpoints.length
    });

    // Run tests for each endpoint
    for (const endpointId of suite.endpoints) {
      try {
        const result = await ApiTestingService.testEndpoint(endpointId, baseUrl);
        testResults.push(result);

        // Check thresholds
        if (suite.thresholds) {
          this.checkThresholds(result, suite.thresholds, thresholdViolations);
        }
      } catch (error) {
        adminLogger.error('Failed to test endpoint in automated suite', {
          suiteId,
          endpointId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const duration = Date.now() - startTime;
    const passedTests = testResults.filter(r => r.success).length;
    const failedTests = testResults.filter(r => !r.success).length;
    const averageResponseTime = testResults.reduce((sum, r) => sum + r.responseTime, 0) / testResults.length;
    const successRate = (passedTests / testResults.length) * 100;
    const errorRate = (failedTests / testResults.length) * 100;

    // Check suite-level thresholds
    if (suite.thresholds) {
      if (averageResponseTime > suite.thresholds.maxResponseTime) {
        thresholdViolations.push({
          type: 'response_time',
          threshold: suite.thresholds.maxResponseTime,
          actual: averageResponseTime,
          severity: 'high'
        });
      }

      if (successRate < suite.thresholds.minSuccessRate) {
        thresholdViolations.push({
          type: 'success_rate',
          threshold: suite.thresholds.minSuccessRate,
          actual: successRate,
          severity: 'high'
        });
      }

      if (errorRate > suite.thresholds.maxErrorRate) {
        thresholdViolations.push({
          type: 'error_rate',
          threshold: suite.thresholds.maxErrorRate,
          actual: errorRate,
          severity: 'high'
        });
      }
    }

    const result: AutomatedTestResult = {
      id: `result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      suiteId,
      timestamp: new Date(),
      duration,
      totalTests: testResults.length,
      passedTests,
      failedTests,
      skippedTests: 0,
      averageResponseTime,
      successRate,
      errorRate,
      thresholdViolations,
      testResults,
      summary: this.generateTestSummary(testResults, thresholdViolations)
    };

    // Store result
    if (!this.testResults.has(suiteId)) {
      this.testResults.set(suiteId, []);
    }
    this.testResults.get(suiteId)!.push(result);

    // Update suite
    suite.lastRun = new Date();
    if (suite.schedule) {
      suite.nextRun = this.calculateNextRun(suite.schedule);
    }

    // Send notifications if configured
    if (suite.notifications) {
      await this.sendNotifications(suite, result);
    }

    // Log result
    await AdminLog.create({
      userId: 'system',
      action: 'automated_test_suite_run',
      resource: 'test_suite',
      resourceId: suiteId,
      details: {
        name: suite.name,
        duration,
        totalTests: result.totalTests,
        passedTests: result.passedTests,
        failedTests: result.failedTests,
        successRate: result.successRate,
        thresholdViolations: result.thresholdViolations.length
      },
      ipAddress: 'localhost',
      userAgent: 'AutomatedTestingService'
    });

    adminLogger.info('Automated test suite completed', {
      suiteId,
      name: suite.name,
      duration,
      totalTests: result.totalTests,
      passedTests: result.passedTests,
      failedTests: result.failedTests,
      successRate: result.successRate,
      status: result.summary.status
    });

    return result;
  }

  /**
   * Schedule test suite
   */
  private static scheduleTestSuite(suite: AutomatedTestSuite) {
    if (!suite.schedule) return;

    let timeout: NodeJS.Timeout;

    if (suite.schedule.type === 'interval') {
      const interval = parseInt(suite.schedule.value);
      timeout = setInterval(async () => {
        try {
          await this.runTestSuite(suite.id);
        } catch (error) {
          adminLogger.error('Scheduled test suite run failed', {
            suiteId: suite.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }, interval);
    } else if (suite.schedule.type === 'cron') {
      // For cron scheduling, we'd need a cron library like node-cron
      // For now, we'll implement a simple interval-based approach
      const nextRun = this.calculateNextRun(suite.schedule);
      if (nextRun) {
        const delay = nextRun.getTime() - Date.now();
        timeout = setTimeout(async () => {
          try {
            await this.runTestSuite(suite.id);
            // Reschedule for next run
            this.scheduleTestSuite(suite);
          } catch (error) {
            adminLogger.error('Scheduled test suite run failed', {
              suiteId: suite.id,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }, delay);
      }
    }

    if (timeout!) {
      this.scheduledJobs.set(suite.id, timeout);
    }
  }

  /**
   * Unschedule test suite
   */
  private static unscheduleTestSuite(suiteId: string) {
    const job = this.scheduledJobs.get(suiteId);
    if (job) {
      clearTimeout(job);
      clearInterval(job);
      this.scheduledJobs.delete(suiteId);
    }
  }

  /**
   * Calculate next run time
   */
  private static calculateNextRun(schedule: TestSchedule): Date | undefined {
    if (schedule.type === 'interval') {
      const interval = parseInt(schedule.value);
      return new Date(Date.now() + interval);
    } else if (schedule.type === 'cron') {
      // Simple cron parsing - in production, use a proper cron library
      // For now, return next hour as placeholder
      const nextHour = new Date();
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      return nextHour;
    }
    return undefined;
  }

  /**
   * Check performance thresholds
   */
  private static checkThresholds(
    result: TestResult,
    thresholds: PerformanceThresholds,
    violations: ThresholdViolation[]
  ) {
    if (result.responseTime > thresholds.maxResponseTime) {
      violations.push({
        type: 'response_time',
        threshold: thresholds.maxResponseTime,
        actual: result.responseTime,
        endpoint: result.endpoint,
        severity: result.responseTime > thresholds.maxResponseTime * 2 ? 'high' : 'medium'
      });
    }
  }

  /**
   * Generate test summary
   */
  private static generateTestSummary(
    testResults: TestResult[],
    thresholdViolations: ThresholdViolation[]
  ): TestSummary {
    const passedTests = testResults.filter(r => r.success).length;
    const totalTests = testResults.length;
    const successRate = (passedTests / totalTests) * 100;

    let status: 'passed' | 'failed' | 'warning' = 'passed';
    let message = `All ${totalTests} tests passed successfully`;
    const recommendations: string[] = [];

    if (thresholdViolations.length > 0) {
      const highSeverityViolations = thresholdViolations.filter(v => v.severity === 'high');
      if (highSeverityViolations.length > 0) {
        status = 'failed';
        message = `${highSeverityViolations.length} critical threshold violations detected`;
      } else {
        status = 'warning';
        message = `${thresholdViolations.length} threshold violations detected`;
      }
    } else if (successRate < 100) {
      status = 'warning';
      message = `${totalTests - passedTests} out of ${totalTests} tests failed`;
    }

    // Generate recommendations
    if (thresholdViolations.some(v => v.type === 'response_time')) {
      recommendations.push('Consider optimizing slow endpoints or increasing response time thresholds');
    }
    if (thresholdViolations.some(v => v.type === 'error_rate')) {
      recommendations.push('Investigate and fix failing endpoints to improve reliability');
    }
    if (successRate < 90) {
      recommendations.push('Review failed tests and fix underlying issues');
    }

    return { status, message, recommendations };
  }

  /**
   * Send notifications
   */
  private static async sendNotifications(suite: AutomatedTestSuite, result: AutomatedTestResult) {
    if (!suite.notifications) return;

    const shouldNotify = 
      (result.summary.status === 'failed' && suite.notifications.onFailure) ||
      (result.summary.status === 'passed' && suite.notifications.onSuccess) ||
      (result.thresholdViolations.length > 0 && suite.notifications.onThresholdExceeded);

    if (!shouldNotify) return;

    const notification = {
      subject: `Test Suite "${suite.name}" - ${result.summary.status.toUpperCase()}`,
      message: result.summary.message,
      details: {
        suite: suite.name,
        timestamp: result.timestamp,
        duration: result.duration,
        totalTests: result.totalTests,
        passedTests: result.passedTests,
        failedTests: result.failedTests,
        successRate: result.successRate,
        thresholdViolations: result.thresholdViolations,
        recommendations: result.summary.recommendations
      }
    };

    // Log notification (in production, integrate with actual notification services)
    adminLogger.info('Test suite notification sent', {
      suiteId: suite.id,
      recipients: suite.notifications.recipients,
      channels: suite.notifications.channels,
      status: result.summary.status
    });
  }

  /**
   * Get all test suites
   */
  static getTestSuites(): AutomatedTestSuite[] {
    return Array.from(this.testSuites.values());
  }

  /**
   * Get test suite by ID
   */
  static getTestSuite(suiteId: string): AutomatedTestSuite | undefined {
    return this.testSuites.get(suiteId);
  }

  /**
   * Get test results for suite
   */
  static getTestResults(suiteId: string, limit?: number): AutomatedTestResult[] {
    const results = this.testResults.get(suiteId) || [];
    return limit ? results.slice(-limit) : results;
  }

  /**
   * Get all test results
   */
  static getAllTestResults(): Map<string, AutomatedTestResult[]> {
    return new Map(this.testResults);
  }

  /**
   * Enable/disable test suite
   */
  static toggleTestSuite(suiteId: string, enabled: boolean): boolean {
    const suite = this.testSuites.get(suiteId);
    if (!suite) return false;

    suite.enabled = enabled;
    
    if (enabled && suite.schedule) {
      this.scheduleTestSuite(suite);
    } else {
      this.unscheduleTestSuite(suiteId);
    }

    adminLogger.info('Test suite toggled', { suiteId, enabled });
    return true;
  }

  /**
   * Get suite statistics
   */
  static getSuiteStatistics(suiteId: string): {
    totalRuns: number;
    averageSuccessRate: number;
    averageResponseTime: number;
    lastRunStatus: string;
    uptime: number;
  } | null {
    const results = this.testResults.get(suiteId);
    if (!results || results.length === 0) return null;

    const totalRuns = results.length;
    const averageSuccessRate = results.reduce((sum, r) => sum + r.successRate, 0) / totalRuns;
    const averageResponseTime = results.reduce((sum, r) => sum + r.averageResponseTime, 0) / totalRuns;
    const lastRunStatus = results[results.length - 1].summary.status;
    const successfulRuns = results.filter(r => r.summary.status === 'passed').length;
    const uptime = (successfulRuns / totalRuns) * 100;

    return {
      totalRuns,
      averageSuccessRate,
      averageResponseTime,
      lastRunStatus,
      uptime
    };
  }

  /**
   * Cleanup old test results
   */
  static cleanupOldResults(maxAge: number = 30 * 24 * 60 * 60 * 1000) { // 30 days
    const cutoffDate = new Date(Date.now() - maxAge);
    
    for (const [suiteId, results] of this.testResults.entries()) {
      const filteredResults = results.filter(r => r.timestamp > cutoffDate);
      this.testResults.set(suiteId, filteredResults);
    }

    adminLogger.info('Old test results cleaned up', { cutoffDate });
  }

  /**
   * Shutdown all scheduled jobs
   */
  static shutdown() {
    for (const [suiteId, job] of this.scheduledJobs.entries()) {
      clearTimeout(job);
      clearInterval(job);
    }
    this.scheduledJobs.clear();
    adminLogger.info('Automated testing service shut down');
  }
}