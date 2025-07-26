import { SecurityService } from '../services/SecurityService';

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254; // RFC 5321 limit
};

export const validateUsername = (username: string): boolean => {
  return username.length >= 3 && 
         username.length <= 20 && 
         /^[a-zA-Z0-9_]+$/.test(username) &&
         !username.startsWith('_') && 
         !username.endsWith('_');
};

export const validatePassword = (password: string): boolean => {
  const strength = SecurityService.validatePasswordStrength(password);
  return strength.isStrong;
};

export const sanitizeInput = (input: string): string => {
  return SecurityService.sanitizeString(input);
};

// Enhanced validation schemas
export const authValidationSchemas = {
  register: {
    username: {
      type: 'username' as const,
      required: true,
      minLength: 3,
      maxLength: 20
    },
    email: {
      type: 'email' as const,
      required: false,
      maxLength: 254
    },
    password: {
      type: 'string' as const,
      required: true,
      minLength: 8,
      maxLength: 128
    },
    avatar: {
      type: 'string' as const,
      required: false,
      maxLength: 500
    }
  },
  login: {
    username: {
      type: 'string' as const,
      required: false,
      maxLength: 254
    },
    email: {
      type: 'email' as const,
      required: false,
      maxLength: 254
    },
    password: {
      type: 'string' as const,
      required: true,
      maxLength: 128
    }
  }
};

export const gameValidationSchemas = {
  createRoom: {
    name: {
      type: 'string' as const,
      required: true,
      minLength: 1,
      maxLength: 50
    },
    maxPlayers: {
      type: 'number' as const,
      required: true,
      min: 4,
      max: 20
    },
    isPublic: {
      type: 'boolean' as const,
      required: true
    }
  },
  chatMessage: {
    content: {
      type: 'string' as const,
      required: true,
      minLength: 1,
      maxLength: 500
    },
    roomId: {
      type: 'string' as const,
      required: true,
      pattern: /^[a-fA-F0-9]{24}$/
    }
  },
  playerAction: {
    type: {
      type: 'string' as const,
      required: true,
      pattern: /^(vote|eliminate|use_ability|ready|unready)$/
    },
    targetId: {
      type: 'string' as const,
      required: false,
      pattern: /^[a-fA-F0-9]{24}$/
    }
  }
};

export const profileValidationSchemas = {
  updateProfile: {
    username: {
      type: 'username' as const,
      required: false,
      minLength: 3,
      maxLength: 20
    },
    avatar: {
      type: 'string' as const,
      required: false,
      maxLength: 500
    },
    bio: {
      type: 'string' as const,
      required: false,
      maxLength: 200
    }
  }
};

// Input sanitization for different contexts
export const sanitizeForDatabase = (input: any): any => {
  return SecurityService.sanitizeObject(input);
};

export const sanitizeForDisplay = (input: string): string => {
  return SecurityService.sanitizeString(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

export const sanitizeForJSON = (input: any): any => {
  if (typeof input === 'string') {
    return input.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  }
  return SecurityService.sanitizeObject(input);
};

// Rate limiting configurations
export const rateLimitConfigs = {
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5
  },
  api: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100
  },
  chat: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30
  },
  gameActions: {
    windowMs: 10 * 1000, // 10 seconds
    maxRequests: 10
  }
};