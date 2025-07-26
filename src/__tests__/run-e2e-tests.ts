#!/usr/bin/env ts-node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface TestResult {
  testFile: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

class E2ETestRunner {
  private results: TestResult[] = [];
  private startTime: number = 0;

  constructor() {
    this.startTime = Date.now();
  }

  async runTest(testFile: string): Promise<TestResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let output = '';
      let error = '';

      console.log(`\n🧪 Running ${testFile}...`);

      const testProcess = spawn('npx', ['jest', testFile, '--verbose', '--detectOpenHandles'], {
        cwd: path.join(__dirname, '../../..'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      testProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        process.stdout.write(chunk);
      });

      testProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        error += chunk;
        process.stderr.write(chunk);
      });

      testProcess.on('close', (code) => {
        const duration = Date.now() - startTime;
        const result: TestResult = {
          testFile,
          passed: code === 0,
          duration,
          output,
          error: error || undefined
        };

        this.results.push(result);
        
        if (code === 0) {
          console.log(`✅ ${testFile} passed in ${duration}ms`);
        } else {
          console.log(`❌ ${testFile} failed in ${duration}ms`);
        }

        resolve(result);
      });
    });
  }

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting End-to-End Integration Test Suite');
    console.log('=' .repeat(60));

    const testFiles = [
      'e2e-integration.test.ts',
      'cross-platform-integration.test.ts'
    ];

    // Run tests sequentially to avoid database conflicts
    for (const testFile of testFiles) {
      await this.runTest(testFile);
    }

    this.generateReport();
  }

  private generateReport(): void {
    const totalDuration = Date.now() - this.startTime;
    const passedTests = this.results.filter(r => r.passed);
    const failedTests = this.results.filter(r => !r.passed);

    console.log('\n' + '='.repeat(60));
    console.log('📊 END-TO-END INTEGRATION TEST REPORT');
    console.log('='.repeat(60));

    console.log(`\n📈 Summary:`);
    console.log(`   Total Tests: ${this.results.length}`);
    console.log(`   Passed: ${passedTests.length} ✅`);
    console.log(`   Failed: ${failedTests.length} ❌`);
    console.log(`   Total Duration: ${totalDuration}ms`);

    if (passedTests.length > 0) {
      console.log(`\n✅ Passed Tests:`);
      passedTests.forEach(result => {
        console.log(`   • ${result.testFile} (${result.duration}ms)`);
      });
    }

    if (failedTests.length > 0) {
      console.log(`\n❌ Failed Tests:`);
      failedTests.forEach(result => {
        console.log(`   • ${result.testFile} (${result.duration}ms)`);
        if (result.error) {
          console.log(`     Error: ${result.error.split('\n')[0]}`);
        }
      });
    }

    // Generate detailed report file
    this.generateDetailedReport();

    console.log('\n' + '='.repeat(60));
    
    if (failedTests.length === 0) {
      console.log('🎉 All integration tests passed!');
      process.exit(0);
    } else {
      console.log('💥 Some integration tests failed. Check the detailed report.');
      process.exit(1);
    }
  }

  private generateDetailedReport(): void {{
    const reportPath = path.join(__dirname, '../../../e2e-test-report.json');
    
    const report = {
      timestamp: new Date().toISOString(),
      totalDuration: Date.now() - this.startTime,
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.passed).length,
        failed: this.results.filter(r => !r.passed).length
      },
      results: this.results.map(result => ({
        testFile: result.testFile,
        passed: result.passed,
        duration: result.duration,
        hasError: !!result.error
      })),
      coverage: {
        scenarios: [
          'Complete user journey from registration to game completion',
          'Multi-player game scenarios with synchronized actions',
          'Real-time communication between multiple clients',
          'Friend system with invitation and game joining flows',
          'Matchmaking system with concurrent users',
          'Game hosting and room management scenarios',
          'Chat moderation and AI moderator interactions',
          'Social features and leaderboard updates',
          'Cross-platform compatibility testing',
          'Performance and load testing scenarios'
        ]
      }
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }
}

// Run the tests if this script is executed directly
if (require.main === module) {
  const runner = new E2ETestRunner();
  runner.runAllTests().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

export { E2ETestRunner };