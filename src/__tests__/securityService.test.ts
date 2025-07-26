import { SecurityService } from '../services/SecurityService';
import { Request } from 'express';

describe('SecurityService', () => {
  beforeEach(() => {
    // Clear any existing security events
    SecurityService.getSecurityEvents().length = 0;
  });

  describe('sanitizeString', () => {
    it('should remove XSS attempts', () => {
      const maliciousInput = '<script>alert("xss")</script>Hello';
      const sanitized = SecurityService.sanitizeString(maliciousInput);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('</script>');
      expect(sanitized).toContain('Hello');
    });

    it('should remove javascript: protocol', () => {
      const maliciousInput = 'javascript:alert("xss")';
      const sanitized = SecurityService.sanitizeString(maliciousInput);
      expect(sanitized).not.toContain('javascript:');
    });

    it('should remove event handlers', () => {
      const maliciousInput = 'onclick="alert(1)"';
      const sanitized = SecurityService.sanitizeString(maliciousInput);
      expect(sanitized).not.toContain('onclick=');
    });

    it('should remove null bytes', () => {
      const maliciousInput = 'test\0null';
      const sanitized = SecurityService.sanitizeString(maliciousInput);
      expect(sanitized).not.toContain('\0');
    });
  });

  describe('sanitizeObject', () => {
    it('should sanitize nested objects', () => {
      const maliciousObject = {
        name: '<script>alert("xss")</script>John',
        profile: {
          bio: 'javascript:alert("xss")',
          tags: ['<img onerror="alert(1)">', 'safe tag']
        }
      };

      const sanitized = SecurityService.sanitizeObject(maliciousObject);
      expect(sanitized.name).not.toContain('<script>');
      expect(sanitized.profile.bio).not.toContain('javascript:');
      expect(sanitized.profile.tags[0]).not.toContain('onerror=');
      expect(sanitized.profile.tags[1]).toBe('safe tag');
    });

    it('should handle null and undefined values', () => {
      const obj = {
        nullValue: null,
        undefinedValue: undefined,
        normalValue: 'test'
      };

      const sanitized = SecurityService.sanitizeObject(obj);
      expect(sanitized.nullValue).toBeNull();
      expect(sanitized.undefinedValue).toBeUndefined();
      expect(sanitized.normalValue).toBe('test');
    });
  });

  describe('validateInput', () => {
    const schema = {
      username: {
        type: 'username' as const,
        required: true,
        minLength: 3,
        maxLength: 20
      },
      email: {
        type: 'email' as const,
        required: false
      },
      age: {
        type: 'number' as const,
        required: true,
        min: 13,
        max: 120
      }
    };

    it('should validate valid input', () => {
      const validData = {
        username: 'testuser123',
        email: 'test@example.com',
        age: 25
      };

      const result = SecurityService.validateInput(validData, schema);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid username', () => {
      const invalidData = {
        username: 'ab', // too short
        age: 25
      };

      const result = SecurityService.validateInput(invalidData, schema);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('username must be 3-20 characters and contain only letters, numbers, and underscores');
    });

    it('should reject invalid email', () => {
      const invalidData = {
        username: 'testuser',
        email: 'invalid-email',
        age: 25
      };

      const result = SecurityService.validateInput(invalidData, schema);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('email must be a valid email address');
    });

    it('should reject out of range numbers', () => {
      const invalidData = {
        username: 'testuser',
        age: 150 // too high
      };

      const result = SecurityService.validateInput(invalidData, schema);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('age must be at most 120');
    });

    it('should handle missing required fields', () => {
      const invalidData = {
        email: 'test@example.com'
        // missing username and age
      };

      const result = SecurityService.validateInput(invalidData, schema);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('username is required');
      expect(result.errors).toContain('age is required');
    });
  });

  describe('detectSuspiciousActivity', () => {
    it('should detect XSS attempts', () => {
      const mockReq = {
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
        url: '/api/test',
        body: { content: '<script>alert("xss")</script>' },
        query: {},
        ip: '127.0.0.1'
      } as unknown as Request;

      const indicators = SecurityService.detectSuspiciousActivity(mockReq);
      expect(indicators).toContain('xss_attempt');
    });

    it('should detect SQL injection attempts', () => {
      const mockReq = {
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
        url: '/api/test',
        body: { query: "'; DROP TABLE users; --" },
        query: {},
        ip: '127.0.0.1'
      } as unknown as Request;

      const indicators = SecurityService.detectSuspiciousActivity(mockReq);
      expect(indicators).toContain('sql_injection');
    });

    it('should detect path traversal attempts', () => {
      const mockReq = {
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
        url: '/api/files?path=../../../etc/passwd',
        body: {},
        query: { path: '../../../etc/passwd' },
        ip: '127.0.0.1'
      } as unknown as Request;

      const indicators = SecurityService.detectSuspiciousActivity(mockReq);
      expect(indicators).toContain('path_traversal');
    });

    it('should detect suspicious user agents', () => {
      const mockReq = {
        get: jest.fn().mockReturnValue('sqlmap/1.0'),
        url: '/api/test',
        body: {},
        query: {},
        ip: '127.0.0.1'
      } as unknown as Request;

      const indicators = SecurityService.detectSuspiciousActivity(mockReq);
      expect(indicators).toContain('suspicious_user_agent');
    });

    it('should detect unusually long URLs', () => {
      const longUrl = '/api/test?' + 'a'.repeat(2100);
      const mockReq = {
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
        url: longUrl,
        body: {},
        query: {},
        ip: '127.0.0.1'
      } as unknown as Request;

      const indicators = SecurityService.detectSuspiciousActivity(mockReq);
      expect(indicators).toContain('unusually_long_url');
    });
  });

  describe('CSRF token management', () => {
    it('should generate valid CSRF token', () => {
      const sessionToken = 'test-session-token';
      const csrfToken = SecurityService.generateCSRFToken(sessionToken);
      
      expect(csrfToken).toBeDefined();
      expect(csrfToken).toContain(':');
    });

    it('should validate correct CSRF token', () => {
      const sessionToken = 'test-session-token';
      const csrfToken = SecurityService.generateCSRFToken(sessionToken);
      
      const isValid = SecurityService.validateCSRFToken(csrfToken, sessionToken);
      expect(isValid).toBe(true);
    });

    it('should reject invalid CSRF token', () => {
      const sessionToken = 'test-session-token';
      const invalidToken = 'invalid:token';
      
      const isValid = SecurityService.validateCSRFToken(invalidToken, sessionToken);
      expect(isValid).toBe(false);
    });

    it('should reject expired CSRF token', () => {
      // Mock Date.now to simulate old timestamp
      const originalNow = Date.now;
      Date.now = jest.fn(() => 1000000); // Old timestamp
      
      const sessionToken = 'test-session-token';
      const csrfToken = SecurityService.generateCSRFToken(sessionToken);
      
      // Restore Date.now and advance time
      Date.now = jest.fn(() => 1000000 + 4000000); // 4000 seconds later (> 1 hour)
      
      const isValid = SecurityService.validateCSRFToken(csrfToken, sessionToken);
      expect(isValid).toBe(false);
      
      // Restore original Date.now
      Date.now = originalNow;
    });
  });

  describe('password strength validation', () => {
    it('should accept strong password', () => {
      const strongPassword = 'MyStr0ng!P@ssw0rd';
      const result = SecurityService.validatePasswordStrength(strongPassword);
      
      expect(result.isStrong).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(4);
      expect(result.feedback).toHaveLength(0);
    });

    it('should reject weak password', () => {
      const weakPassword = '123456';
      const result = SecurityService.validatePasswordStrength(weakPassword);
      
      expect(result.isStrong).toBe(false);
      expect(result.score).toBeLessThan(4);
      expect(result.feedback.length).toBeGreaterThan(0);
    });

    it('should provide helpful feedback', () => {
      const weakPassword = 'password';
      const result = SecurityService.validatePasswordStrength(weakPassword);
      
      expect(result.feedback).toContain('Password should contain uppercase letters');
      expect(result.feedback).toContain('Password should contain numbers');
      expect(result.feedback).toContain('Password should contain special characters');
    });

    it('should detect repeated characters', () => {
      const repeatedPassword = 'aaaaaaaaA1!';
      const result = SecurityService.validatePasswordStrength(repeatedPassword);
      
      expect(result.feedback).toContain('Password should not contain repeated characters');
    });
  });

  describe('security event logging', () => {
    it('should log security events', async () => {
      const event = {
        type: 'test_event',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
        url: '/test',
        indicators: ['test_indicator'],
        timestamp: new Date(),
        severity: 'medium' as const
      };

      await SecurityService.logSecurityEvent(event);
      
      const events = SecurityService.getSecurityEvents(10);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject(event);
    });

    it('should limit stored events', async () => {
      // Add more than 1000 events
      for (let i = 0; i < 1005; i++) {
        await SecurityService.logSecurityEvent({
          type: `test_event_${i}`,
          ip: '127.0.0.1',
          userAgent: 'test-agent',
          url: '/test',
          timestamp: new Date()
        });
      }

      const events = SecurityService.getSecurityEvents(2000);
      expect(events.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('security analysis', () => {
    it('should analyze security patterns', async () => {
      // Add some test events with unique identifiers
      const uniqueId = Date.now();
      await SecurityService.logSecurityEvent({
        type: `xss_attempt_${uniqueId}`,
        ip: '192.168.100.1',
        userAgent: 'test-agent',
        url: '/test1',
        timestamp: new Date()
      });

      await SecurityService.logSecurityEvent({
        type: `xss_attempt_${uniqueId}`,
        ip: '192.168.100.1',
        userAgent: 'test-agent',
        url: '/test2',
        timestamp: new Date()
      });

      await SecurityService.logSecurityEvent({
        type: `sql_injection_${uniqueId}`,
        ip: '192.168.100.2',
        userAgent: 'test-agent',
        url: '/test3',
        timestamp: new Date()
      });

      const analysis = SecurityService.analyzeSecurityPatterns();
      
      // Should have our unique events
      expect(analysis.topAttackTypes.length).toBeGreaterThanOrEqual(2);
      
      const xssAttack = analysis.topAttackTypes.find(t => t.type === `xss_attempt_${uniqueId}`);
      expect(xssAttack).toBeDefined();
      expect(xssAttack?.count).toBe(2);
      
      const sqlAttack = analysis.topAttackTypes.find(t => t.type === `sql_injection_${uniqueId}`);
      expect(sqlAttack).toBeDefined();
      expect(sqlAttack?.count).toBe(1);
      
      expect(analysis.topAttackIPs.length).toBeGreaterThanOrEqual(2);
      
      const ip1Attack = analysis.topAttackIPs.find(ip => ip.ip === '192.168.100.1');
      expect(ip1Attack).toBeDefined();
      expect(ip1Attack?.count).toBe(2);
      
      const ip2Attack = analysis.topAttackIPs.find(ip => ip.ip === '192.168.100.2');
      expect(ip2Attack).toBeDefined();
      expect(ip2Attack?.count).toBe(1);
    });
  });

  describe('IP blocking', () => {
    it('should not block IP with few violations', () => {
      const shouldBlock = SecurityService.shouldBlockIP('127.0.0.1');
      expect(shouldBlock).toBe(false);
    });

    it('should block IP with many recent violations', async () => {
      // Simulate many violations
      for (let i = 0; i < 25; i++) {
        await SecurityService.logSecurityEvent({
          type: 'test_violation',
          ip: '192.168.1.100',
          userAgent: 'test-agent',
          url: '/test',
          indicators: ['violation'],
          timestamp: new Date()
        });
      }

      const shouldBlock = SecurityService.shouldBlockIP('192.168.1.100');
      expect(shouldBlock).toBe(true);
    });
  });

  describe('data encryption', () => {
    it('should encrypt and decrypt data', () => {
      const originalData = 'sensitive information';
      const encrypted = SecurityService.encryptData(originalData);
      
      expect(encrypted).not.toBe(originalData);
      expect(encrypted).toContain(':');
      
      const decrypted = SecurityService.decryptData(encrypted);
      expect(decrypted).toBe(originalData);
    });

    it('should fail to decrypt invalid data', () => {
      expect(() => {
        SecurityService.decryptData('invalid:data');
      }).toThrow('Failed to decrypt data');
    });
  });

  describe('secure token generation', () => {
    it('should generate secure random tokens', () => {
      const token1 = SecurityService.generateSecureToken();
      const token2 = SecurityService.generateSecureToken();
      
      expect(token1).not.toBe(token2);
      expect(token1).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(token2).toHaveLength(64);
      expect(token1).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate tokens of specified length', () => {
      const token = SecurityService.generateSecureToken(16);
      expect(token).toHaveLength(32); // 16 bytes = 32 hex chars
    });
  });

  describe('sensitive data hashing', () => {
    it('should hash sensitive data consistently', () => {
      const data = 'sensitive@email.com';
      const hash1 = SecurityService.hashSensitiveData(data);
      const hash2 = SecurityService.hashSensitiveData(data);
      
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(data);
      expect(hash1).toHaveLength(64); // SHA-256 hex output
    });

    it('should produce different hashes for different data', () => {
      const data1 = 'email1@example.com';
      const data2 = 'email2@example.com';
      
      const hash1 = SecurityService.hashSensitiveData(data1);
      const hash2 = SecurityService.hashSensitiveData(data2);
      
      expect(hash1).not.toBe(hash2);
    });
  });
});