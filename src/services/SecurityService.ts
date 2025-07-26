import crypto from 'crypto';
import { Request } from 'express';
import { logger } from '../utils/logger';
import { AnalyticsEvent, EventType } from '../models/Analytics';

export interface SecurityEvent {
  type: string;
  ip: string;
  userAgent: string;
  url: string;
  userId?: string;
  indicators?: string[];
  timestamp: Date;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ValidationSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'email' | 'username';
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    min?: number;
    max?: number;
  };
}

export class SecurityService {
  private static readonly XSS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
    /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
    /<link\b[^<]*(?:(?!<\/link>)<[^<]*)*<\/link>/gi,
    /<meta\b[^<]*(?:(?!<\/meta>)<[^<]*)*<\/meta>/gi
  ];

  private static readonly SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
    /('|(\\')|(;)|(--)|(\s)|(\/\*)|(\*\/))/gi,
    /(\b(WAITFOR|DELAY)\b)/gi
  ];

  private static readonly PATH_TRAVERSAL_PATTERNS = [
    /\.\.\//g,
    /\.\.\\/g,
    /%2e%2e%2f/gi,
    /%2e%2e%5c/gi,
    /\.\.%2f/gi,
    /\.\.%5c/gi
  ];

  private static readonly SUSPICIOUS_USER_AGENTS = [
    /sqlmap/i,
    /nikto/i,
    /nessus/i,
    /burp/i,
    /nmap/i,
    /masscan/i,
    /zap/i,
    /w3af/i
  ];

  private static securityEvents: SecurityEvent[] = [];
  private static ipViolations = new Map<string, { count: number; lastViolation: Date }>();

  /**
   * Sanitize input to prevent XSS and other injection attacks
   */
  static sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      return String(input);
    }

    return input
      .trim()
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .replace(/&lt;/g, '') // Remove encoded angle brackets
      .replace(/&gt;/g, '')
      .replace(/&#x3C;/g, '')
      .replace(/&#x3E;/g, '')
      .replace(/\0/g, ''); // Remove null bytes
  }

  /**
   * Sanitize an object recursively
   */
  static sanitizeObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const sanitizedKey = this.sanitizeString(key);
        sanitized[sanitizedKey] = this.sanitizeObject(value);
      }
      return sanitized;
    }

    return obj;
  }

  /**
   * Validate input against schema
   */
  static validateInput(data: any, schema: ValidationSchema): ValidationResult {
    const errors: string[] = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      // Check required fields
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip validation for optional empty fields
      if (!rules.required && (value === undefined || value === null || value === '')) {
        continue;
      }

      // Type validation
      switch (rules.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`${field} must be a string`);
            break;
          }
          if (rules.minLength && value.length < rules.minLength) {
            errors.push(`${field} must be at least ${rules.minLength} characters`);
          }
          if (rules.maxLength && value.length > rules.maxLength) {
            errors.push(`${field} must be at most ${rules.maxLength} characters`);
          }
          if (rules.pattern && !rules.pattern.test(value)) {
            errors.push(`${field} format is invalid`);
          }
          break;

        case 'number':
          if (typeof value !== 'number' || isNaN(value)) {
            errors.push(`${field} must be a valid number`);
            break;
          }
          if (rules.min !== undefined && value < rules.min) {
            errors.push(`${field} must be at least ${rules.min}`);
          }
          if (rules.max !== undefined && value > rules.max) {
            errors.push(`${field} must be at most ${rules.max}`);
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`${field} must be a boolean`);
          }
          break;

        case 'email':
          if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            errors.push(`${field} must be a valid email address`);
          }
          break;

        case 'username':
          if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(value)) {
            errors.push(`${field} must be 3-20 characters and contain only letters, numbers, and underscores`);
          }
          break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Detect suspicious activity in request
   */
  static detectSuspiciousActivity(req: Request): string[] {
    const indicators: string[] = [];
    const userAgent = req.get('User-Agent') || '';
    const url = req.url;
    const body = JSON.stringify(req.body || {});
    const query = JSON.stringify(req.query || {});

    // Check for XSS attempts
    const allContent = `${url} ${body} ${query}`;
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(allContent)) {
        indicators.push('xss_attempt');
        break;
      }
    }

    // Check for SQL injection attempts
    for (const pattern of this.SQL_INJECTION_PATTERNS) {
      if (pattern.test(allContent)) {
        indicators.push('sql_injection');
        break;
      }
    }

    // Check for path traversal attempts
    for (const pattern of this.PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(allContent)) {
        indicators.push('path_traversal');
        break;
      }
    }

    // Check for suspicious user agents
    for (const pattern of this.SUSPICIOUS_USER_AGENTS) {
      if (pattern.test(userAgent)) {
        indicators.push('suspicious_user_agent');
        break;
      }
    }

    // Check for unusual request patterns
    if (url.length > 2000) {
      indicators.push('unusually_long_url');
    }

    if (Object.keys(req.query || {}).length > 50) {
      indicators.push('excessive_query_parameters');
    }

    if (body.length > 100000) { // 100KB
      indicators.push('unusually_large_payload');
    }

    // Check for rapid requests from same IP
    const ip = req.ip || 'unknown';
    const violations = this.ipViolations.get(ip);
    if (violations && violations.count > 10 && 
        Date.now() - violations.lastViolation.getTime() < 60000) { // 1 minute
      indicators.push('rapid_requests');
    }

    return indicators;
  }

  /**
   * Generate CSRF token
   */
  static generateCSRFToken(sessionToken: string): string {
    const timestamp = Date.now().toString();
    const hash = crypto
      .createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'default-secret')
      .update(`${sessionToken}:${timestamp}`)
      .digest('hex');
    
    return `${timestamp}:${hash}`;
  }

  /**
   * Validate CSRF token
   */
  static validateCSRFToken(token: string, sessionToken: string): boolean {
    try {
      const [timestamp, hash] = token.split(':');
      
      if (!timestamp || !hash) {
        return false;
      }

      // Check if token is not too old (1 hour)
      const tokenTime = parseInt(timestamp);
      if (Date.now() - tokenTime > 3600000) {
        return false;
      }

      const expectedHash = crypto
        .createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'default-secret')
        .update(`${sessionToken}:${timestamp}`)
        .digest('hex');

      return hash === expectedHash;
    } catch (error) {
      return false;
    }
  }

  /**
   * Log security event
   */
  static async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Store in memory for immediate analysis
      this.securityEvents.push(event);

      // Keep only last 1000 events in memory
      if (this.securityEvents.length > 1000) {
        this.securityEvents = this.securityEvents.slice(-1000);
      }

      // Update IP violation tracking
      if (event.indicators && event.indicators.length > 0) {
        const violations = this.ipViolations.get(event.ip) || { count: 0, lastViolation: new Date() };
        violations.count++;
        violations.lastViolation = new Date();
        this.ipViolations.set(event.ip, violations);
      }

      // Store in database for long-term analysis (skip in test environment)
      if (process.env.NODE_ENV !== 'test') {
        try {
          await AnalyticsEvent.create({
            eventType: EventType.SECURITY_EVENT,
            userId: event.userId,
            sessionId: `security_${Date.now()}`,
            properties: {
              type: event.type,
              ip: event.ip,
              userAgent: event.userAgent,
              url: event.url,
              indicators: event.indicators,
              severity: event.severity || 'medium'
            },
            timestamp: event.timestamp
          });
        } catch (dbError) {
          // Log database error but don't fail the security logging
          logger.error('Failed to store security event in database:', dbError);
        }
      }

      logger.warn('Security event logged', event);
    } catch (error) {
      logger.error('Failed to log security event:', error);
    }
  }

  /**
   * Get security events for analysis
   */
  static getSecurityEvents(limit: number = 100): SecurityEvent[] {
    return this.securityEvents.slice(-limit);
  }

  /**
   * Analyze security patterns
   */
  static analyzeSecurityPatterns(): {
    topAttackTypes: { type: string; count: number }[];
    topAttackIPs: { ip: string; count: number }[];
    recentEvents: SecurityEvent[];
  } {
    const attackTypes = new Map<string, number>();
    const attackIPs = new Map<string, number>();

    for (const event of this.securityEvents) {
      // Count attack types
      const count = attackTypes.get(event.type) || 0;
      attackTypes.set(event.type, count + 1);

      // Count attacking IPs
      const ipCount = attackIPs.get(event.ip) || 0;
      attackIPs.set(event.ip, ipCount + 1);
    }

    return {
      topAttackTypes: Array.from(attackTypes.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topAttackIPs: Array.from(attackIPs.entries())
        .map(([ip, count]) => ({ ip, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      recentEvents: this.securityEvents.slice(-20)
    };
  }

  /**
   * Check if IP should be blocked
   */
  static shouldBlockIP(ip: string): boolean {
    const violations = this.ipViolations.get(ip);
    if (!violations) return false;

    // Block if more than 20 violations in last hour
    const oneHourAgo = new Date(Date.now() - 3600000);
    return violations.count > 20 && violations.lastViolation > oneHourAgo;
  }

  /**
   * Hash sensitive data for storage
   */
  static hashSensitiveData(data: string): string {
    return crypto
      .createHash('sha256')
      .update(data + (process.env.JWT_ACCESS_SECRET || 'default-secret'))
      .digest('hex');
  }

  /**
   * Encrypt sensitive data
   */
  static encryptData(data: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || 'default-secret', 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   */
  static decryptData(encryptedData: string): string {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(process.env.JWT_ACCESS_SECRET || 'default-secret', 'salt', 32);
      
      const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Generate secure random token
   */
  static generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Validate password strength
   */
  static validatePasswordStrength(password: string): {
    isStrong: boolean;
    score: number;
    feedback: string[];
  } {
    const feedback: string[] = [];
    let score = 0;

    if (password.length >= 8) score += 1;
    else feedback.push('Password should be at least 8 characters long');

    if (password.length >= 12) score += 1;

    if (/[a-z]/.test(password)) score += 1;
    else feedback.push('Password should contain lowercase letters');

    if (/[A-Z]/.test(password)) score += 1;
    else feedback.push('Password should contain uppercase letters');

    if (/\d/.test(password)) score += 1;
    else feedback.push('Password should contain numbers');

    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
    else feedback.push('Password should contain special characters');

    if (!/(.)\1{2,}/.test(password)) score += 1;
    else feedback.push('Password should not contain repeated characters');

    return {
      isStrong: score >= 4,
      score,
      feedback
    };
  }
}