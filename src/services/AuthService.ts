import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { Player, IPlayer } from '../models/Player';
import { EmailService } from './EmailService';

// JWT payload interface
export interface JWTPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

// Authentication result interfaces
export interface AuthResult {
  success: boolean;
  player?: IPlayer;
  accessToken?: string;
  refreshToken?: string;
  message?: string;
}

export interface LoginCredentials {
  username?: string;
  email?: string;
  password: string;
}

export interface RegistrationData {
  username: string;
  email?: string;
  password: string;
  avatar?: string;
}

export class AuthService {
  private static get ACCESS_TOKEN_SECRET() { return process.env.JWT_ACCESS_SECRET || 'access-secret-key'; }
  private static get REFRESH_TOKEN_SECRET() { return process.env.JWT_REFRESH_SECRET || 'refresh-secret-key'; }
  private static get ACCESS_TOKEN_EXPIRES_IN() { return process.env.JWT_ACCESS_EXPIRES_IN || '15m'; }
  private static get REFRESH_TOKEN_EXPIRES_IN() { return process.env.JWT_REFRESH_EXPIRES_IN || '7d'; }
  private static readonly SALT_ROUNDS = 12;

  /**
   * Hash a password using bcrypt
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Compare a plain text password with a hashed password
   */
  static async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  /**
   * Generate JWT access token
   */
  static generateAccessToken(payload: JWTPayload): string {
    return jwt.sign(payload, this.ACCESS_TOKEN_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  /**
   * Generate JWT refresh token
   */
  static generateRefreshToken(payload: JWTPayload): string {
    return jwt.sign(payload, this.REFRESH_TOKEN_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  /**
   * Verify JWT access token
   */
  static verifyAccessToken(token: string): JWTPayload | null {
    try {
      return jwt.verify(token, this.ACCESS_TOKEN_SECRET) as JWTPayload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Verify JWT refresh token
   */
  static verifyRefreshToken(token: string): JWTPayload | null {
    try {
      return jwt.verify(token, this.REFRESH_TOKEN_SECRET) as JWTPayload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Register a new player
   */
  static async register(data: RegistrationData): Promise<AuthResult> {
    try {
      // Validate input
      if (!data.username || data.username.length < 3) {
        return { success: false, message: 'Username must be at least 3 characters long' };
      }

      if (!data.password || data.password.length < 6) {
        return { success: false, message: 'Password must be at least 6 characters long' };
      }

      // Check if username already exists
      const existingPlayer = await Player.findOne({ username: data.username });
      if (existingPlayer) {
        return { success: false, message: 'Username already exists' };
      }

      // Check if email already exists (if provided)
      if (data.email) {
        const existingEmail = await Player.findOne({ email: data.email });
        if (existingEmail) {
          return { success: false, message: 'Email already exists' };
        }
      }

      // Hash password
      const hashedPassword = await this.hashPassword(data.password);

      // Create new player
      const player = new Player({
        username: data.username,
        email: data.email,
        password: hashedPassword,
        avatar: data.avatar || 'default-avatar.png',
      });

      await player.save();

      // Generate tokens
      const tokenPayload: JWTPayload = {
        userId: player._id.toString(),
        username: player.username,
      };

      const accessToken = this.generateAccessToken(tokenPayload);
      const refreshToken = this.generateRefreshToken(tokenPayload);

      // Store refresh token
      if (!player.refreshTokens) {
        player.refreshTokens = [];
      }
      player.refreshTokens.push(refreshToken);
      await player.save();

      // Send welcome email if email is provided
      if (data.email) {
        try {
          const gameUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
          await EmailService.sendWelcomeEmail(data.email, data.username, gameUrl);
        } catch (emailError) {
          console.error('Failed to send welcome email:', emailError);
          // Don't fail registration if email fails
        }
      }

      // Remove password from response
      const playerResponse = player.toObject();
      delete (playerResponse as any).password;
      delete (playerResponse as any).refreshTokens;

      return {
        success: true,
        player: playerResponse as IPlayer,
        accessToken,
        refreshToken,
        message: 'Registration successful',
      };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, message: 'Registration failed' };
    }
  }

  /**
   * Login a player
   */
  static async login(credentials: LoginCredentials): Promise<AuthResult> {
    try {
      // Validate input
      if (!credentials.password) {
        return { success: false, message: 'Password is required' };
      }

      if (!credentials.username && !credentials.email) {
        return { success: false, message: 'Username or email is required' };
      }

      // Find player by username or email
      const query = credentials.username 
        ? { username: credentials.username }
        : { email: credentials.email };

      const player = await Player.findOne(query).select('+password');
      console.log(player)
      if (!player || !player.password) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Verify password
      const isPasswordValid = await this.comparePassword(credentials.password, player.password);
      if (!isPasswordValid) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Generate tokens
      const tokenPayload: JWTPayload = {
        userId: player._id.toString(),
        username: player.username,
      };

      const accessToken = this.generateAccessToken(tokenPayload);
      const refreshToken = this.generateRefreshToken(tokenPayload);

      // Store refresh token
      if (!player.refreshTokens) {
        player.refreshTokens = [];
      }
      player.refreshTokens.push(refreshToken);
      await player.save();

      // Update last active
      player.lastActive = new Date();
      await player.save();

      // Remove sensitive data from response
      const playerResponse = player.toObject();
      delete (playerResponse as any).password;
      delete (playerResponse as any).refreshTokens;

      return {
        success: true,
        player: playerResponse as IPlayer,
        accessToken,
        refreshToken,
        message: 'Login successful',
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'Login failed' };
    }
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      // Verify refresh token
      const payload = this.verifyRefreshToken(refreshToken);
      if (!payload) {
        return { success: false, message: 'Invalid refresh token' };
      }

      // Find player and verify refresh token exists
      const player = await Player.findById(payload.userId).select('+refreshTokens');
      if (!player || !player.refreshTokens || !player.refreshTokens.includes(refreshToken)) {
        return { success: false, message: 'Invalid refresh token' };
      }

      // Generate new tokens with unique identifier to ensure they're different
      const basePayload: JWTPayload = {
        userId: player._id.toString(),
        username: player.username,
      };

      const newAccessToken = this.generateAccessToken(basePayload);
      
      // Add a unique identifier for the refresh token to ensure it's different
      const refreshPayload = {
        ...basePayload,
        tokenId: Date.now() + Math.random().toString(36).substr(2, 9)
      };
      const newRefreshToken = this.generateRefreshToken(refreshPayload as JWTPayload);

      // Replace old refresh token with new one
      player.refreshTokens = player.refreshTokens.filter(token => token !== refreshToken);
      player.refreshTokens.push(newRefreshToken);
      await player.save();

      // Remove sensitive data from response
      const playerResponse = player.toObject();
      delete (playerResponse as any).password;
      delete (playerResponse as any).refreshTokens;

      return {
        success: true,
        player: playerResponse as IPlayer,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        message: 'Token refreshed successfully',
      };
    } catch (error) {
      console.error('Token refresh error:', error);
      return { success: false, message: 'Token refresh failed' };
    }
  }

  /**
   * Logout a player (invalidate refresh token)
   */
  static async logout(refreshToken: string): Promise<{ success: boolean; message: string }> {
    try {
      // Verify refresh token
      const payload = this.verifyRefreshToken(refreshToken);
      if (!payload) {
        return { success: false, message: 'Invalid refresh token' };
      }

      // Find player and remove refresh token
      const player = await Player.findById(payload.userId).select('+refreshTokens');
      if (player && player.refreshTokens) {
        player.refreshTokens = player.refreshTokens.filter(token => token !== refreshToken);
        await player.save();
      }

      return { success: true, message: 'Logout successful' };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, message: 'Logout failed' };
    }
  }

  /**
   * Logout from all devices (invalidate all refresh tokens)
   */
  static async logoutAll(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const player = await Player.findById(userId);
      if (player) {
        player.refreshTokens = [];
        await player.save();
      }

      return { success: true, message: 'Logged out from all devices' };
    } catch (error) {
      console.error('Logout all error:', error);
      return { success: false, message: 'Logout from all devices failed' };
    }
  }

  /**
   * Get player by ID (for middleware)
   */
  static async getPlayerById(userId: string): Promise<IPlayer | null> {
    try {
      return await Player.findById(userId);
    } catch (error) {
      console.error('Get player error:', error);
      return null;
    }
  }
}