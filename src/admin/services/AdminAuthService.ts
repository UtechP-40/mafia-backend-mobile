import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Types } from "mongoose";
import {
  SuperUser,
  ISuperUser,
  Permission,
  SuperUserStatus,
} from "../models/SuperUser";
import { AdminSession } from "../models/AdminSession";
import { EmailApproval } from "../models/EmailApproval";
import { AdminLog } from "../models/AdminLog";
import { adminLogger, logAdminSecurity } from "../config/logger";
import { AdminOperationalError } from "../middleware/errorHandler";

// JWT payload interface for admin users
export interface AdminJWTPayload {
  userId: string;
  username: string;
  email: string;
  permissions: Permission[];
  status: SuperUserStatus;
  isAdmin: boolean;
  iat?: number;
  exp?: number;
}

// Authentication result interfaces
export interface AdminAuthResult {
  success: boolean;
  user?: ISuperUser;
  accessToken?: string;
  refreshToken?: string;
  message?: string;
  requiresApproval?: boolean;
}

export interface AdminLoginCredentials {
  username?: string;
  email?: string;
  password: string;
  twoFactorCode?: string;
}

export interface AdminRegistrationData {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  requestedPermissions: Permission[];
  justification: string;
}

export interface PasswordResetData {
  email: string;
}

export interface PasswordResetConfirmData {
  token: string;
  newPassword: string;
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  forbiddenPatterns: string[];
}

export class AdminAuthService {
  private static get ACCESS_TOKEN_SECRET() {
    return (
      process.env.ADMIN_JWT_ACCESS_SECRET ||
      process.env.JWT_ACCESS_SECRET ||
      "admin-access-secret-key"
    );
  }

  private static get REFRESH_TOKEN_SECRET() {
    return (
      process.env.ADMIN_JWT_REFRESH_SECRET ||
      process.env.JWT_REFRESH_SECRET ||
      "admin-refresh-secret-key"
    );
  }

  private static get ACCESS_TOKEN_EXPIRES_IN() {
    return process.env.ADMIN_JWT_ACCESS_EXPIRES_IN || "1h";
  }

  private static get REFRESH_TOKEN_EXPIRES_IN() {
    return process.env.ADMIN_JWT_REFRESH_EXPIRES_IN || "7d";
  }

  private static readonly SALT_ROUNDS = 14; // Higher security for admin accounts
  private static readonly MAX_LOGIN_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION = 2 * 60 * 60 * 1000; // 2 hours

  /**
   * Password policy configuration
   */
  private static readonly PASSWORD_POLICY: PasswordPolicy = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    forbiddenPatterns: [
      "password",
      "admin",
      "123456",
      "qwerty",
      "letmein",
      "welcome",
      "monkey",
      "dragon",
      "master",
      "shadow",
    ],
  };

  /**
   * Validate password against security policy
   */
  static validatePassword(password: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const policy = this.PASSWORD_POLICY;

    if (password.length < policy.minLength) {
      errors.push(
        `Password must be at least ${policy.minLength} characters long`
      );
    }

    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }

    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }

    if (policy.requireNumbers && !/\d/.test(password)) {
      errors.push("Password must contain at least one number");
    }

    if (
      policy.requireSpecialChars &&
      !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    ) {
      errors.push("Password must contain at least one special character");
    }

    // Check for forbidden patterns
    const lowerPassword = password.toLowerCase();
    for (const pattern of policy.forbiddenPatterns) {
      if (lowerPassword.includes(pattern)) {
        errors.push(
          `Password cannot contain common patterns like "${pattern}"`
        );
      }
    }

    // Check for sequential characters
    if (/(.)\1{2,}/.test(password)) {
      errors.push("Password cannot contain repeated characters");
    }

    // Check for sequential patterns
    if (
      /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|123|234|345|456|567|678|789)/i.test(
        password
      )
    ) {
      errors.push("Password cannot contain sequential characters");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Hash a password using bcrypt with high security
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Compare a plain text password with a hashed password
   */
  static async comparePassword(
    password: string,
    hashedPassword: string
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  /**
   * Generate JWT access token for admin
   */
  static generateAccessToken(payload: AdminJWTPayload): string {
    return jwt.sign(payload, this.ACCESS_TOKEN_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRES_IN,
      issuer: "mafia-game-admin",
      audience: "admin-portal",
    } as jwt.SignOptions);
  }

  /**
   * Generate JWT refresh token for admin
   */
  static generateRefreshToken(payload: AdminJWTPayload): string {
    return jwt.sign(payload, this.REFRESH_TOKEN_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRES_IN,
      issuer: "mafia-game-admin",
      audience: "admin-portal",
    } as jwt.SignOptions);
  }

  /**
   * Verify JWT access token
   */
  static verifyAccessToken(token: string): AdminJWTPayload | null {
    try {
      return jwt.verify(token, this.ACCESS_TOKEN_SECRET, {
        issuer: "mafia-game-admin",
        audience: "admin-portal",
      }) as AdminJWTPayload;
    } catch (error) {
      adminLogger.warn("Admin access token verification failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Verify JWT refresh token
   */
  static verifyRefreshToken(token: string): AdminJWTPayload | null {
    try {
      return jwt.verify(token, this.REFRESH_TOKEN_SECRET, {
        issuer: "mafia-game-admin",
        audience: "admin-portal",
      }) as AdminJWTPayload;
    } catch (error) {
      adminLogger.warn("Admin refresh token verification failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Register a new admin user with approval workflow
   */
  static async register(
    data: AdminRegistrationData,
    requestIp?: string
  ): Promise<AdminAuthResult> {
    try {
      // Validate input
      if (!data.username || data.username.length < 3) {
        return {
          success: false,
          message: "Username must be at least 3 characters long",
        };
      }

      if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        return { success: false, message: "Valid email address is required" };
      }

      // Validate password
      const passwordValidation = this.validatePassword(data.password);
      if (!passwordValidation.isValid) {
        return {
          success: false,
          message:
            "Password does not meet security requirements: " +
            passwordValidation.errors.join(", "),
        };
      }

      // Check if username already exists
      const existingUser = await SuperUser.findOne({ username: data.username });
      if (existingUser) {
        logAdminSecurity(
          "Admin registration attempt with existing username",
          requestIp || "unknown",
          "",
          {
            username: data.username,
            email: data.email,
          }
        );
        return { success: false, message: "Username already exists" };
      }

      // Check if email already exists
      const existingEmail = await SuperUser.findOne({ email: data.email });
      if (existingEmail) {
        logAdminSecurity(
          "Admin registration attempt with existing email",
          requestIp || "unknown",
          "",
          {
            username: data.username,
            email: data.email,
          }
        );
        return { success: false, message: "Email already exists" };
      }

      // Hash password
      const hashedPassword = await this.hashPassword(data.password);

      // Create new admin user in pending status
      const adminUser = new SuperUser({
        username: data.username,
        email: data.email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        permissions: data.requestedPermissions,
        status: SuperUserStatus.PENDING,
      });

      await adminUser.save();

      // Create email approval record using the correct structure
      const approvalToken = crypto.randomBytes(32).toString("hex");

      // Find existing super admins to be approvers
      const superAdmins = await SuperUser.find({
        permissions: Permission.SUPER_ADMIN,
        status: SuperUserStatus.APPROVED,
      });

      const approverIds = superAdmins.map((admin) => admin._id);

      // If no super admins exist, create a basic approval record
      if (approverIds.length === 0) {
        // For the first admin, we'll need manual approval
        approverIds.push(adminUser._id); // Self-approval for first admin
      }

      const emailApproval = await EmailApproval.create({
        type: "super_user_registration",
        title: `Admin Registration Request: ${data.username}`,
        description: `Registration request for admin user ${data.username} (${data.email}). Justification: ${data.justification}`,
        requestedBy: adminUser._id,
        approvers: approverIds,
        requiredApprovals: Math.max(1, Math.ceil(approverIds.length / 2)),
        data: {
          userData: {
            username: data.username,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            requestedPermissions: data.requestedPermissions,
          },
        },
        approvalToken: approvalToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });

      // Log admin registration attempt
      await AdminLog.create({
        userId: adminUser._id,
        level: "info",
        action: "admin:create",
        message: `Admin registration request submitted for ${data.username}`,
        details: {
          username: data.username,
          email: data.email,
          requestedPermissions: data.requestedPermissions,
          justification: data.justification,
        },
        success: true,
      });

      adminLogger.info("Admin registration request created", {
        userId: adminUser._id.toString(),
        username: data.username,
        email: data.email,
        requestedPermissions: data.requestedPermissions,
      });

      // TODO: Send approval email to existing super admins
      // This would be implemented in the email approval workflow

      return {
        success: true,
        message:
          "Registration request submitted successfully. Your account will be reviewed by an administrator.",
        requiresApproval: true,
      };
    } catch (error) {
      adminLogger.error("Admin registration error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        message: "Registration failed due to server error",
      };
    }
  }

  /**
   * Login an admin user
   */
  static async login(
    credentials: AdminLoginCredentials,
    requestIp?: string,
    userAgent?: string
  ): Promise<AdminAuthResult> {
    try {
      // Validate input
      if (!credentials.password) {
        return { success: false, message: "Password is required" };
      }

      if (!credentials.username && !credentials.email) {
        return { success: false, message: "Username or email is required" };
      }

      // Find admin user by username or email
      const query = credentials.username
        ? { username: credentials.username }
        : { email: credentials.email };

      const adminUser = await SuperUser.findOne(query).select(
        "+password +refreshTokens +loginAttempts +lockUntil"
      );

      if (!adminUser) {
        logAdminSecurity(
          "Admin login attempt with non-existent user",
          requestIp || "unknown",
          userAgent || "",
          {
            username: credentials.username,
            email: credentials.email,
          }
        );
        return { success: false, message: "Invalid credentials" };
      }

      // Check if account is locked
      if (adminUser.isLocked) {
        logAdminSecurity(
          "Admin login attempt on locked account",
          requestIp || "unknown",
          userAgent || "",
          {
            userId: adminUser._id.toString(),
            username: adminUser.username,
            lockUntil: adminUser.lockUntil,
          }
        );
        return {
          success: false,
          message: `Account is locked until ${adminUser.lockUntil?.toISOString()}. Please try again later or contact support.`,
        };
      }

      // Check account status
      if (adminUser.status !== SuperUserStatus.APPROVED) {
        logAdminSecurity(
          "Admin login attempt with non-approved account",
          requestIp || "unknown",
          userAgent || "",
          {
            userId: adminUser._id.toString(),
            username: adminUser.username,
            status: adminUser.status,
          }
        );

        let message = "Account access denied";
        switch (adminUser.status) {
          case SuperUserStatus.PENDING:
            message = "Account is pending approval";
            break;
          case SuperUserStatus.SUSPENDED:
            message = "Account has been suspended";
            break;
          case SuperUserStatus.REJECTED:
            message = "Account registration was rejected";
            break;
        }

        return { success: false, message };
      }

      // Verify password
      const isPasswordValid = await this.comparePassword(
        credentials.password,
        adminUser.password
      );
      if (!isPasswordValid) {
        // Increment login attempts
        await adminUser.incrementLoginAttempts();

        logAdminSecurity(
          "Admin login attempt with invalid password",
          requestIp || "unknown",
          userAgent || "",
          {
            userId: adminUser._id.toString(),
            username: adminUser.username,
            loginAttempts: adminUser.loginAttempts + 1,
          }
        );

        return { success: false, message: "Invalid credentials" };
      }

      // TODO: Implement 2FA verification if enabled
      if (adminUser.twoFactorEnabled && !credentials.twoFactorCode) {
        return {
          success: false,
          message: "Two-factor authentication code required",
        };
      }

      // Reset login attempts on successful login
      if (adminUser.loginAttempts > 0) {
        await adminUser.resetLoginAttempts();
      }

      // Generate tokens
      const tokenPayload: AdminJWTPayload = {
        userId: adminUser._id.toString(),
        username: adminUser.username,
        email: adminUser.email,
        permissions: adminUser.permissions,
        status: adminUser.status,
        isAdmin: true,
      };

      const accessToken = this.generateAccessToken(tokenPayload);
      const refreshToken = this.generateRefreshToken({
        ...tokenPayload,
        tokenId: Date.now() + Math.random().toString(36).substring(2, 9),
      } as AdminJWTPayload);

      // Store refresh token
      if (!adminUser.refreshTokens) {
        adminUser.refreshTokens = [];
      }
      adminUser.refreshTokens.push(refreshToken);

      // Limit number of refresh tokens (keep only last 5)
      if (adminUser.refreshTokens.length > 5) {
        adminUser.refreshTokens = adminUser.refreshTokens.slice(-5);
      }

      // Update last login
      await adminUser.updateLastLogin();
      await adminUser.save();

      // Create admin session
      await AdminSession.create({
        userId: adminUser._id,
        sessionToken: accessToken,
        refreshToken: refreshToken,
        ipAddress: requestIp || "unknown",
        userAgent: userAgent || "unknown",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });

      // Log successful login
      await AdminLog.create({
        userId: adminUser._id,
        level: "info",
        action: "auth:login",
        message: `Admin user ${adminUser.username} logged in successfully`,
        details: {
          username: adminUser.username,
          permissions: adminUser.permissions,
        },
        success: true,
      });

      adminLogger.info("Admin login successful", {
        userId: adminUser._id.toString(),
        username: adminUser.username,
        permissions: adminUser.permissions,
        ip: requestIp,
      });

      // Remove sensitive data from response
      const userResponse = adminUser.toObject();
      delete (userResponse as any).password;
      delete (userResponse as any).refreshTokens;

      return {
        success: true,
        user: userResponse as ISuperUser,
        accessToken,
        refreshToken,
        message: "Login successful",
      };
    } catch (error) {
      adminLogger.error("Admin login error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Login failed due to server error" };
    }
  }

  /**
   * Refresh access token using refresh token
   */
  static async refreshToken(
    refreshToken: string,
    requestIp?: string
  ): Promise<AdminAuthResult> {
    try {
      // Verify refresh token
      const payload = this.verifyRefreshToken(refreshToken);
      if (!payload) {
        return { success: false, message: "Invalid refresh token" };
      }

      // Find admin user and verify refresh token exists
      const adminUser = await SuperUser.findById(payload.userId).select(
        "+refreshTokens"
      );
      if (
        !adminUser ||
        !adminUser.refreshTokens ||
        !adminUser.refreshTokens.includes(refreshToken)
      ) {
        logAdminSecurity(
          "Admin token refresh attempt with invalid token",
          requestIp || "unknown",
          "",
          {
            userId: payload.userId,
            username: payload.username,
          }
        );
        return { success: false, message: "Invalid refresh token" };
      }

      // Check account status
      if (adminUser.status !== SuperUserStatus.APPROVED) {
        return { success: false, message: "Account access denied" };
      }

      // Generate new tokens
      const newTokenPayload: AdminJWTPayload = {
        userId: adminUser._id.toString(),
        username: adminUser.username,
        email: adminUser.email,
        permissions: adminUser.permissions,
        status: adminUser.status,
        isAdmin: true,
      };

      const newAccessToken = this.generateAccessToken(newTokenPayload);
      const newRefreshToken = this.generateRefreshToken({
        ...newTokenPayload,
        tokenId: Date.now() + Math.random().toString(36).substring(2, 9),
      } as AdminJWTPayload);

      // Replace old refresh token with new one
      adminUser.refreshTokens = adminUser.refreshTokens.filter(
        (token) => token !== refreshToken
      );
      adminUser.refreshTokens.push(newRefreshToken);
      await adminUser.save();

      // Update admin session
      await AdminSession.findOneAndUpdate(
        { sessionToken: refreshToken },
        {
          sessionToken: newRefreshToken,
          lastActivity: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }
      );

      // Log token refresh
      await AdminLog.create({
        userId: adminUser._id,
        level: "info",
        action: "auth:token_refresh",
        message: `Admin token refreshed for user ${adminUser.username}`,
        details: { username: adminUser.username },
        success: true,
      });

      // Remove sensitive data from response
      const userResponse = adminUser.toObject();
      delete (userResponse as any).password;
      delete (userResponse as any).refreshTokens;

      return {
        success: true,
        user: userResponse as ISuperUser,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        message: "Token refreshed successfully",
      };
    } catch (error) {
      adminLogger.error("Admin token refresh error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Token refresh failed" };
    }
  }

  /**
   * Logout an admin user (invalidate refresh token)
   */
  static async logout(
    refreshToken: string,
    requestIp?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Verify refresh token
      const payload = this.verifyRefreshToken(refreshToken);
      if (!payload) {
        return { success: false, message: "Invalid refresh token" };
      }

      // Find admin user and remove refresh token
      const adminUser = await SuperUser.findById(payload.userId).select(
        "+refreshTokens"
      );
      if (adminUser && adminUser.refreshTokens) {
        adminUser.refreshTokens = adminUser.refreshTokens.filter(
          (token) => token !== refreshToken
        );
        await adminUser.save();
      }

      // Remove admin session
      await AdminSession.findOneAndDelete({ sessionToken: refreshToken });

      // Log logout
      if (adminUser) {
        await AdminLog.create({
          userId: adminUser._id,
          level: "info",
          action: "auth:logout",
          message: `Admin user ${adminUser.username} logged out successfully`,
          details: { username: adminUser.username },
          success: true,
        });

        adminLogger.info("Admin logout successful", {
          userId: adminUser._id.toString(),
          username: adminUser.username,
          ip: requestIp,
        });
      }

      return { success: true, message: "Logout successful" };
    } catch (error) {
      adminLogger.error("Admin logout error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Logout failed" };
    }
  }

  /**
   * Logout from all devices (invalidate all refresh tokens)
   */
  static async logoutAll(
    userId: string,
    requestIp?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const adminUser = await SuperUser.findById(userId);
      if (adminUser) {
        adminUser.refreshTokens = [];
        await adminUser.save();

        // Remove all admin sessions
        await AdminSession.deleteMany({ userId: adminUser._id });

        // Log logout all
        await AdminLog.create({
          userId: adminUser._id,
          level: "info",
          action: "auth:logout",
          message: `Admin user ${adminUser.username} logged out from all devices`,
          details: { username: adminUser.username },
          success: true,
        });

        adminLogger.info("Admin logout all successful", {
          userId: adminUser._id.toString(),
          username: adminUser.username,
          ip: requestIp,
        });
      }

      return { success: true, message: "Logged out from all devices" };
    } catch (error) {
      adminLogger.error("Admin logout all error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Logout from all devices failed" };
    }
  }

  /**
   * Initiate password reset
   */
  static async initiatePasswordReset(
    data: PasswordResetData,
    requestIp?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const adminUser = await SuperUser.findOne({ email: data.email });
      if (!adminUser) {
        // Don't reveal if email exists or not
        return {
          success: true,
          message: "If the email exists, a password reset link has been sent",
        };
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

      // Set reset token and expiration (1 hour)
      adminUser.passwordResetToken = resetTokenHash;
      adminUser.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
      await adminUser.save();

      // Log password reset request
      await AdminLog.create({
        userId: adminUser._id,
        level: "info",
        action: "auth:password_reset",
        message: `Password reset requested for admin user ${adminUser.username}`,
        details: {
          username: adminUser.username,
          email: adminUser.email,
        },
        success: true,
      });

      adminLogger.info("Admin password reset requested", {
        userId: adminUser._id.toString(),
        username: adminUser.username,
        email: adminUser.email,
        ip: requestIp,
      });

      // TODO: Send password reset email
      // This would be implemented with the email service

      return {
        success: true,
        message: "If the email exists, a password reset link has been sent",
      };
    } catch (error) {
      adminLogger.error("Admin password reset initiation error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Password reset request failed" };
    }
  }

  /**
   * Confirm password reset
   */
  static async confirmPasswordReset(
    data: PasswordResetConfirmData,
    requestIp?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Validate new password
      const passwordValidation = this.validatePassword(data.newPassword);
      if (!passwordValidation.isValid) {
        return {
          success: false,
          message:
            "Password does not meet security requirements: " +
            passwordValidation.errors.join(", "),
        };
      }

      // Hash the token to compare with stored hash
      const resetTokenHash = crypto
        .createHash("sha256")
        .update(data.token)
        .digest("hex");

      // Find user with valid reset token
      const adminUser = await SuperUser.findOne({
        passwordResetToken: resetTokenHash,
        passwordResetExpires: { $gt: new Date() },
      }).select("+passwordResetToken +passwordResetExpires +refreshTokens");

      if (!adminUser) {
        return { success: false, message: "Invalid or expired reset token" };
      }

      // Hash new password
      const hashedPassword = await this.hashPassword(data.newPassword);

      // Update password and clear reset token
      adminUser.password = hashedPassword;
      adminUser.passwordResetToken = undefined;
      adminUser.passwordResetExpires = undefined;

      // Invalidate all refresh tokens for security
      adminUser.refreshTokens = [];

      await adminUser.save();

      // Remove all admin sessions
      await AdminSession.deleteMany({ userId: adminUser._id });

      // Log password reset completion
      await AdminLog.create({
        userId: adminUser._id,
        level: "info",
        action: "auth:password_reset",
        message: `Password reset completed for admin user ${adminUser.username}`,
        details: {
          username: adminUser.username,
          email: adminUser.email,
        },
        success: true,
      });

      adminLogger.info("Admin password reset completed", {
        userId: adminUser._id.toString(),
        username: adminUser.username,
        email: adminUser.email,
        ip: requestIp,
      });

      return {
        success: true,
        message:
          "Password reset successful. Please log in with your new password.",
      };
    } catch (error) {
      adminLogger.error("Admin password reset confirmation error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Password reset failed" };
    }
  }

  /**
   * Get admin user by ID (for middleware)
   */
  static async getAdminUserById(userId: string): Promise<ISuperUser | null> {
    try {
      return await SuperUser.findById(userId);
    } catch (error) {
      adminLogger.error("Get admin user error", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      return null;
    }
  }

  /**
   * Approve admin user registration
   */
  static async approveRegistration(
    userId: string,
    approverId: string,
    requestIp?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const adminUser = await SuperUser.findById(userId);
      if (!adminUser) {
        return { success: false, message: "Admin user not found" };
      }

      if (adminUser.status !== SuperUserStatus.PENDING) {
        return {
          success: false,
          message: "Admin user is not in pending status",
        };
      }

      // Update status to approved
      adminUser.status = SuperUserStatus.APPROVED;
      adminUser.approvedBy = new Types.ObjectId(approverId);
      adminUser.approvedAt = new Date();
      await adminUser.save();

      // Update email approval record by approving it
      const emailApproval = await EmailApproval.findOne({
        "data.userData.email": adminUser.email,
        type: "super_user_registration",
      });

      if (emailApproval) {
        await emailApproval.approve(
          new Types.ObjectId(approverId),
          "Registration approved"
        );
      }

      // Log approval
      await AdminLog.create({
        userId: adminUser._id,
        action: "admin_registration_approved",
        details: {
          username: adminUser.username,
          approvedBy: approverId,
        },
        ipAddress: requestIp || "unknown",
        timestamp: new Date(),
      });

      adminLogger.info("Admin registration approved", {
        userId: adminUser._id.toString(),
        username: adminUser.username,
        approvedBy: approverId,
        ip: requestIp,
      });

      return {
        success: true,
        message: "Admin registration approved successfully",
      };
    } catch (error) {
      adminLogger.error("Admin registration approval error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Registration approval failed" };
    }
  }

  /**
   * Reject admin user registration
   */
  static async rejectRegistration(
    userId: string,
    approverId: string,
    reason: string,
    requestIp?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const adminUser = await SuperUser.findById(userId);
      if (!adminUser) {
        return { success: false, message: "Admin user not found" };
      }

      if (adminUser.status !== SuperUserStatus.PENDING) {
        return {
          success: false,
          message: "Admin user is not in pending status",
        };
      }

      // Update status to rejected
      adminUser.status = SuperUserStatus.REJECTED;
      await adminUser.save();

      // Update email approval record by rejecting it
      const emailApproval = await EmailApproval.findOne({
        "data.userData.email": adminUser.email,
        type: "super_user_registration",
      });

      if (emailApproval) {
        await emailApproval.reject(new Types.ObjectId(approverId), reason);
      }

      // Log rejection
      await AdminLog.create({
        userId: adminUser._id,
        action: "admin_registration_rejected",
        details: {
          username: adminUser.username,
          rejectedBy: approverId,
          reason: reason,
        },
        ipAddress: requestIp || "unknown",
        timestamp: new Date(),
      });

      adminLogger.info("Admin registration rejected", {
        userId: adminUser._id.toString(),
        username: adminUser.username,
        rejectedBy: approverId,
        reason: reason,
        ip: requestIp,
      });

      return {
        success: true,
        message: "Admin registration rejected successfully",
      };
    } catch (error) {
      adminLogger.error("Admin registration rejection error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return { success: false, message: "Registration rejection failed" };
    }
  }
}
