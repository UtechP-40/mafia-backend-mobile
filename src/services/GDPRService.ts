import { logger } from '../utils/logger';
import { Player } from '../models/Player';
import { Game } from '../models/Game';
import { Room } from '../models/Room';
import { ChatMessage } from '../models/ChatMessage';
import { AnalyticsEvent, EventType } from '../models/Analytics';
import { SecurityService } from './SecurityService';

export interface DataExportRequest {
  userId: string;
  requestId: string;
  requestDate: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl?: string;
  expiresAt?: Date;
}

export interface DataDeletionRequest {
  userId: string;
  requestId: string;
  requestDate: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  deletionType: 'partial' | 'complete';
  retentionPeriod?: number; // days
}

export interface ConsentRecord {
  userId: string;
  consentType: 'data_processing' | 'analytics' | 'marketing' | 'cookies';
  granted: boolean;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
}

export interface PrivacySettings {
  userId: string;
  dataProcessingConsent: boolean;
  analyticsConsent: boolean;
  marketingConsent: boolean;
  cookiesConsent: boolean;
  profileVisibility: 'public' | 'friends' | 'private';
  gameHistoryVisibility: 'public' | 'friends' | 'private';
  allowFriendRequests: boolean;
  allowGameInvites: boolean;
  updatedAt: Date;
}

export class GDPRService {
  private static dataExportRequests = new Map<string, DataExportRequest>();
  private static dataDeletionRequests = new Map<string, DataDeletionRequest>();
  private static consentRecords = new Map<string, ConsentRecord[]>();
  private static privacySettings = new Map<string, PrivacySettings>();

  /**
   * Record user consent
   */
  static async recordConsent(
    userId: string,
    consentType: ConsentRecord['consentType'],
    granted: boolean,
    ipAddress: string,
    userAgent: string
  ): Promise<void> {
    try {
      const consent: ConsentRecord = {
        userId,
        consentType,
        granted,
        timestamp: new Date(),
        ipAddress,
        userAgent
      };

      // Store in memory
      if (!this.consentRecords.has(userId)) {
        this.consentRecords.set(userId, []);
      }
      this.consentRecords.get(userId)!.push(consent);

      // Store in database for persistence
      await AnalyticsEvent.create({
        eventType: EventType.CONSENT_RECORD,
        userId,
        sessionId: `consent_${Date.now()}`,
        properties: {
          consentType,
          granted,
          ipAddress: SecurityService.hashSensitiveData(ipAddress),
          userAgent: SecurityService.hashSensitiveData(userAgent)
        },
        timestamp: consent.timestamp
      });

      logger.info(`Consent recorded for user ${userId}: ${consentType} = ${granted}`);
    } catch (error) {
      logger.error('Failed to record consent:', error);
      throw new Error('Failed to record consent');
    }
  }

  /**
   * Get user consent history
   */
  static getUserConsent(userId: string): ConsentRecord[] {
    return this.consentRecords.get(userId) || [];
  }

  /**
   * Update privacy settings
   */
  static async updatePrivacySettings(
    userId: string,
    settings: Partial<PrivacySettings>
  ): Promise<PrivacySettings> {
    try {
      const currentSettings = this.privacySettings.get(userId) || {
        userId,
        dataProcessingConsent: false,
        analyticsConsent: false,
        marketingConsent: false,
        cookiesConsent: false,
        profileVisibility: 'friends' as const,
        gameHistoryVisibility: 'friends' as const,
        allowFriendRequests: true,
        allowGameInvites: true,
        updatedAt: new Date()
      };

      const updatedSettings: PrivacySettings = {
        ...currentSettings,
        ...settings,
        updatedAt: new Date()
      };

      this.privacySettings.set(userId, updatedSettings);

      // Store in database
      await AnalyticsEvent.create({
        eventType: EventType.PRIVACY_SETTINGS_UPDATE,
        userId,
        sessionId: `privacy_${Date.now()}`,
        properties: {
          oldSettings: currentSettings,
          newSettings: updatedSettings
        },
        timestamp: new Date()
      });

      logger.info(`Privacy settings updated for user ${userId}`);
      return updatedSettings;
    } catch (error) {
      logger.error('Failed to update privacy settings:', error);
      throw new Error('Failed to update privacy settings');
    }
  }

  /**
   * Get user privacy settings
   */
  static getPrivacySettings(userId: string): PrivacySettings | null {
    return this.privacySettings.get(userId) || null;
  }

  /**
   * Request data export (Right to Data Portability)
   */
  static async requestDataExport(userId: string): Promise<string> {
    try {
      const requestId = SecurityService.generateSecureToken();
      const request: DataExportRequest = {
        userId,
        requestId,
        requestDate: new Date(),
        status: 'pending'
      };

      this.dataExportRequests.set(requestId, request);

      // Process the export asynchronously
      this.processDataExport(requestId).catch(error => {
        logger.error(`Data export failed for request ${requestId}:`, error);
        const failedRequest = this.dataExportRequests.get(requestId);
        if (failedRequest) {
          failedRequest.status = 'failed';
        }
      });

      logger.info(`Data export requested for user ${userId}, request ID: ${requestId}`);
      return requestId;
    } catch (error) {
      logger.error('Failed to request data export:', error);
      throw new Error('Failed to request data export');
    }
  }

  /**
   * Process data export
   */
  private static async processDataExport(requestId: string): Promise<void> {
    const request = this.dataExportRequests.get(requestId);
    if (!request) {
      throw new Error('Export request not found');
    }

    try {
      request.status = 'processing';

      // Collect all user data
      const userData = await this.collectUserData(request.userId);

      // Generate export file (in production, this would be saved to secure storage)
      const exportData = {
        exportDate: new Date().toISOString(),
        userId: request.userId,
        data: userData
      };

      // In production, save to secure file storage and generate download URL
      const downloadUrl = `/api/gdpr/export/${requestId}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      request.status = 'completed';
      request.downloadUrl = downloadUrl;
      request.expiresAt = expiresAt;

      // Store export data temporarily (in production, use secure storage)
      // This is a simplified implementation
      logger.info(`Data export completed for request ${requestId}`);
    } catch (error) {
      request.status = 'failed';
      throw error;
    }
  }

  /**
   * Collect all user data for export
   */
  private static async collectUserData(userId: string): Promise<any> {
    try {
      // Collect profile data
      const profile = await Player.findById(userId).lean();

      // Collect game history
      const games = await Game.find({ 
        $or: [
          { 'players.playerId': userId },
          { hostId: userId }
        ]
      }).lean();

      // Collect room history
      const rooms = await Room.find({
        $or: [
          { 'players.playerId': userId },
          { hostId: userId }
        ]
      }).lean();

      // Collect chat messages
      const chatMessages = await ChatMessage.find({ playerId: userId }).lean();

      // Collect analytics data (anonymized)
      const analytics = await AnalyticsEvent.find({ userId }).lean();

      // Collect consent records
      const consentHistory = this.getUserConsent(userId);

      // Collect privacy settings
      const privacySettings = this.getPrivacySettings(userId);

      return {
        profile: this.anonymizePersonalData(profile),
        gameHistory: games.map(game => this.anonymizeGameData(game, userId)),
        roomHistory: rooms.map(room => this.anonymizeRoomData(room, userId)),
        chatMessages: chatMessages.map(msg => this.anonymizeChatMessage(msg)),
        analytics: analytics.map(a => this.anonymizeAnalyticsData(a)),
        consentHistory,
        privacySettings
      };
    } catch (error) {
      logger.error('Failed to collect user data:', error);
      throw new Error('Failed to collect user data');
    }
  }

  /**
   * Request data deletion (Right to be Forgotten)
   */
  static async requestDataDeletion(
    userId: string,
    deletionType: 'partial' | 'complete' = 'complete'
  ): Promise<string> {
    try {
      const requestId = SecurityService.generateSecureToken();
      const request: DataDeletionRequest = {
        userId,
        requestId,
        requestDate: new Date(),
        status: 'pending',
        deletionType
      };

      this.dataDeletionRequests.set(requestId, request);

      // Process the deletion asynchronously
      this.processDataDeletion(requestId).catch(error => {
        logger.error(`Data deletion failed for request ${requestId}:`, error);
        const failedRequest = this.dataDeletionRequests.get(requestId);
        if (failedRequest) {
          failedRequest.status = 'failed';
        }
      });

      logger.info(`Data deletion requested for user ${userId}, request ID: ${requestId}`);
      return requestId;
    } catch (error) {
      logger.error('Failed to request data deletion:', error);
      throw new Error('Failed to request data deletion');
    }
  }

  /**
   * Process data deletion
   */
  private static async processDataDeletion(requestId: string): Promise<void> {
    const request = this.dataDeletionRequests.get(requestId);
    if (!request) {
      throw new Error('Deletion request not found');
    }

    try {
      request.status = 'processing';

      if (request.deletionType === 'complete') {
        await this.performCompleteDeletion(request.userId);
      } else {
        await this.performPartialDeletion(request.userId);
      }

      request.status = 'completed';
      logger.info(`Data deletion completed for request ${requestId}`);
    } catch (error) {
      request.status = 'failed';
      throw error;
    }
  }

  /**
   * Perform complete data deletion
   */
  private static async performCompleteDeletion(userId: string): Promise<void> {
    try {
      // Delete profile
      await Player.findByIdAndDelete(userId);

      // Anonymize game history (keep for game integrity)
      await Game.updateMany(
        { 'players.playerId': userId },
        { 
          $set: { 
            'players.$.playerId': 'deleted_user',
            'players.$.username': 'Deleted User'
          }
        }
      );

      // Anonymize room history
      await Room.updateMany(
        { 'players.playerId': userId },
        { 
          $set: { 
            'players.$.playerId': 'deleted_user',
            'players.$.username': 'Deleted User'
          }
        }
      );

      // Delete chat messages
      await ChatMessage.deleteMany({ playerId: userId });

      // Delete analytics data
      await AnalyticsEvent.deleteMany({ userId });

      // Remove from memory caches
      this.consentRecords.delete(userId);
      this.privacySettings.delete(userId);

      logger.info(`Complete data deletion performed for user ${userId}`);
    } catch (error) {
      logger.error('Failed to perform complete deletion:', error);
      throw error;
    }
  }

  /**
   * Perform partial data deletion (keep essential game data)
   */
  private static async performPartialDeletion(userId: string): Promise<void> {
    try {
      // Anonymize profile but keep essential data
      await Player.findByIdAndUpdate(userId, {
        username: 'Anonymous User',
        email: null,
        avatar: null,
        bio: null,
        lastActive: null
      });

      // Delete personal chat messages
      await ChatMessage.deleteMany({ 
        playerId: userId,
        type: { $ne: 'game_event' }
      });

      // Delete personal analytics data
      await AnalyticsEvent.deleteMany({ 
        userId,
        eventType: { $nin: ['game_result', 'game_action'] }
      });

      // Clear consent records
      this.consentRecords.delete(userId);

      logger.info(`Partial data deletion performed for user ${userId}`);
    } catch (error) {
      logger.error('Failed to perform partial deletion:', error);
      throw error;
    }
  }

  /**
   * Get data export status
   */
  static getDataExportStatus(requestId: string): DataExportRequest | null {
    return this.dataExportRequests.get(requestId) || null;
  }

  /**
   * Get data deletion status
   */
  static getDataDeletionStatus(requestId: string): DataDeletionRequest | null {
    return this.dataDeletionRequests.get(requestId) || null;
  }

  /**
   * Check if user has given consent for specific purpose
   */
  static hasConsent(userId: string, consentType: ConsentRecord['consentType']): boolean {
    const consents = this.getUserConsent(userId);
    const latestConsent = consents
      .filter(c => c.consentType === consentType)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    
    return latestConsent ? latestConsent.granted : false;
  }

  /**
   * Anonymize personal data for export
   */
  private static anonymizePersonalData(data: any): any {
    if (!data) return data;
    
    return {
      ...data,
      email: data.email ? SecurityService.hashSensitiveData(data.email) : null,
      // Keep username and avatar as they're not sensitive
      createdAt: data.createdAt,
      statistics: data.statistics
    };
  }

  /**
   * Anonymize game data for export
   */
  private static anonymizeGameData(game: any, userId: string): any {
    return {
      ...game,
      players: game.players.map((player: any) => ({
        ...player,
        playerId: player.playerId === userId ? userId : 'other_player',
        username: player.playerId === userId ? player.username : 'Other Player'
      }))
    };
  }

  /**
   * Anonymize room data for export
   */
  private static anonymizeRoomData(room: any, userId: string): any {
    return {
      ...room,
      players: room.players.map((player: any) => ({
        ...player,
        playerId: player.playerId === userId ? userId : 'other_player',
        username: player.playerId === userId ? player.username : 'Other Player'
      }))
    };
  }

  /**
   * Anonymize chat message for export
   */
  private static anonymizeChatMessage(message: any): any {
    return {
      ...message,
      playerId: 'user', // Always show as 'user' for their own messages
      content: message.content,
      timestamp: message.timestamp,
      type: message.type
    };
  }

  /**
   * Anonymize analytics data for export
   */
  private static anonymizeAnalyticsData(analytics: any): any {
    return {
      eventType: analytics.eventType,
      timestamp: analytics.timestamp,
      data: {
        ...analytics.data,
        // Remove any IP addresses or sensitive identifiers
        ip: undefined,
        userAgent: undefined
      }
    };
  }

  /**
   * Clean up expired requests
   */
  static cleanupExpiredRequests(): void {
    const now = new Date();
    
    // Clean up expired export requests
    for (const [requestId, request] of this.dataExportRequests.entries()) {
      if (request.expiresAt && request.expiresAt < now) {
        this.dataExportRequests.delete(requestId);
      }
    }

    // Clean up old deletion requests (keep for 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    for (const [requestId, request] of this.dataDeletionRequests.entries()) {
      if (request.requestDate < thirtyDaysAgo) {
        this.dataDeletionRequests.delete(requestId);
      }
    }
  }

  /**
   * Get GDPR compliance statistics
   */
  static getComplianceStats(): {
    totalExportRequests: number;
    totalDeletionRequests: number;
    pendingRequests: number;
    consentRecords: number;
  } {
    const pendingExports = Array.from(this.dataExportRequests.values())
      .filter(r => r.status === 'pending' || r.status === 'processing').length;
    
    const pendingDeletions = Array.from(this.dataDeletionRequests.values())
      .filter(r => r.status === 'pending' || r.status === 'processing').length;

    const totalConsents = Array.from(this.consentRecords.values())
      .reduce((sum, consents) => sum + consents.length, 0);

    return {
      totalExportRequests: this.dataExportRequests.size,
      totalDeletionRequests: this.dataDeletionRequests.size,
      pendingRequests: pendingExports + pendingDeletions,
      consentRecords: totalConsents
    };
  }
}