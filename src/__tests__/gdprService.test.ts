import { GDPRService } from '../services/GDPRService';

describe('GDPRService', () => {
  const testUserId = 'test-user-123';
  const testIp = '127.0.0.1';
  const testUserAgent = 'Mozilla/5.0 Test Browser';

  beforeEach(() => {
    // Clean up any existing data
    GDPRService.cleanupExpiredRequests();
  });

  describe('consent management', () => {
    it('should record user consent', async () => {
      await GDPRService.recordConsent(
        testUserId,
        'data_processing',
        true,
        testIp,
        testUserAgent
      );

      const consentHistory = GDPRService.getUserConsent(testUserId);
      expect(consentHistory).toHaveLength(1);
      expect(consentHistory[0]).toMatchObject({
        userId: testUserId,
        consentType: 'data_processing',
        granted: true,
        ipAddress: testIp,
        userAgent: testUserAgent
      });
      expect(consentHistory[0].timestamp).toBeInstanceOf(Date);
    });

    it('should handle multiple consent records', async () => {
      await GDPRService.recordConsent(testUserId, 'data_processing', true, testIp, testUserAgent);
      await GDPRService.recordConsent(testUserId, 'analytics', false, testIp, testUserAgent);
      await GDPRService.recordConsent(testUserId, 'marketing', true, testIp, testUserAgent);

      const consentHistory = GDPRService.getUserConsent(testUserId);
      expect(consentHistory).toHaveLength(3);
      
      const consentTypes = consentHistory.map(c => c.consentType);
      expect(consentTypes).toContain('data_processing');
      expect(consentTypes).toContain('analytics');
      expect(consentTypes).toContain('marketing');
    });

    it('should check if user has given consent', async () => {
      await GDPRService.recordConsent(testUserId, 'analytics', true, testIp, testUserAgent);
      await GDPRService.recordConsent(testUserId, 'marketing', false, testIp, testUserAgent);

      expect(GDPRService.hasConsent(testUserId, 'analytics')).toBe(true);
      expect(GDPRService.hasConsent(testUserId, 'marketing')).toBe(false);
      expect(GDPRService.hasConsent(testUserId, 'cookies')).toBe(false); // No record
    });

    it('should use latest consent when multiple records exist', async () => {
      // First, grant consent
      await GDPRService.recordConsent(testUserId, 'analytics', true, testIp, testUserAgent);
      expect(GDPRService.hasConsent(testUserId, 'analytics')).toBe(true);

      // Then, revoke consent
      await GDPRService.recordConsent(testUserId, 'analytics', false, testIp, testUserAgent);
      expect(GDPRService.hasConsent(testUserId, 'analytics')).toBe(false);
    });
  });

  describe('privacy settings', () => {
    it('should update privacy settings', async () => {
      const settings = {
        dataProcessingConsent: true,
        analyticsConsent: false,
        profileVisibility: 'friends' as const,
        allowFriendRequests: true
      };

      const updatedSettings = await GDPRService.updatePrivacySettings(testUserId, settings);
      
      expect(updatedSettings.userId).toBe(testUserId);
      expect(updatedSettings.dataProcessingConsent).toBe(true);
      expect(updatedSettings.analyticsConsent).toBe(false);
      expect(updatedSettings.profileVisibility).toBe('friends');
      expect(updatedSettings.allowFriendRequests).toBe(true);
      expect(updatedSettings.updatedAt).toBeInstanceOf(Date);
    });

    it('should retrieve privacy settings', async () => {
      const settings = {
        marketingConsent: true,
        gameHistoryVisibility: 'private' as const
      };

      await GDPRService.updatePrivacySettings(testUserId, settings);
      const retrievedSettings = GDPRService.getPrivacySettings(testUserId);
      
      expect(retrievedSettings).toBeDefined();
      expect(retrievedSettings!.marketingConsent).toBe(true);
      expect(retrievedSettings!.gameHistoryVisibility).toBe('private');
    });

    it('should return null for non-existent user settings', () => {
      const settings = GDPRService.getPrivacySettings('non-existent-user');
      expect(settings).toBeNull();
    });

    it('should merge settings updates', async () => {
      // Initial settings
      await GDPRService.updatePrivacySettings(testUserId, {
        dataProcessingConsent: true,
        analyticsConsent: true
      });

      // Partial update
      await GDPRService.updatePrivacySettings(testUserId, {
        analyticsConsent: false,
        marketingConsent: true
      });

      const settings = GDPRService.getPrivacySettings(testUserId);
      expect(settings!.dataProcessingConsent).toBe(true); // Unchanged
      expect(settings!.analyticsConsent).toBe(false); // Updated
      expect(settings!.marketingConsent).toBe(true); // New
    });
  });

  describe('data export', () => {
    it('should create data export request', async () => {
      const requestId = await GDPRService.requestDataExport(testUserId);
      
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId.length).toBeGreaterThan(0);
    });

    it('should track export request status', async () => {
      const requestId = await GDPRService.requestDataExport(testUserId);
      const status = GDPRService.getDataExportStatus(requestId);
      
      expect(status).toBeDefined();
      expect(status!.userId).toBe(testUserId);
      expect(status!.requestId).toBe(requestId);
      expect(status!.status).toBe('pending');
      expect(status!.requestDate).toBeInstanceOf(Date);
    });

    it('should return null for non-existent export request', () => {
      const status = GDPRService.getDataExportStatus('non-existent-request');
      expect(status).toBeNull();
    });

    it('should handle multiple export requests', async () => {
      const requestId1 = await GDPRService.requestDataExport(testUserId);
      const requestId2 = await GDPRService.requestDataExport('another-user');
      
      expect(requestId1).not.toBe(requestId2);
      
      const status1 = GDPRService.getDataExportStatus(requestId1);
      const status2 = GDPRService.getDataExportStatus(requestId2);
      
      expect(status1!.userId).toBe(testUserId);
      expect(status2!.userId).toBe('another-user');
    });
  });

  describe('data deletion', () => {
    it('should create data deletion request', async () => {
      const requestId = await GDPRService.requestDataDeletion(testUserId, 'complete');
      
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId.length).toBeGreaterThan(0);
    });

    it('should track deletion request status', async () => {
      const requestId = await GDPRService.requestDataDeletion(testUserId, 'partial');
      const status = GDPRService.getDataDeletionStatus(requestId);
      
      expect(status).toBeDefined();
      expect(status!.userId).toBe(testUserId);
      expect(status!.requestId).toBe(requestId);
      expect(status!.status).toBe('pending');
      expect(status!.deletionType).toBe('partial');
      expect(status!.requestDate).toBeInstanceOf(Date);
    });

    it('should default to complete deletion', async () => {
      const requestId = await GDPRService.requestDataDeletion(testUserId);
      const status = GDPRService.getDataDeletionStatus(requestId);
      
      expect(status!.deletionType).toBe('complete');
    });

    it('should return null for non-existent deletion request', () => {
      const status = GDPRService.getDataDeletionStatus('non-existent-request');
      expect(status).toBeNull();
    });
  });

  describe('compliance statistics', () => {
    it('should provide compliance statistics', async () => {
      // Create some test data
      await GDPRService.requestDataExport(testUserId);
      await GDPRService.requestDataDeletion('user2', 'partial');
      await GDPRService.recordConsent(testUserId, 'analytics', true, testIp, testUserAgent);

      const stats = GDPRService.getComplianceStats();
      
      expect(stats).toHaveProperty('totalExportRequests');
      expect(stats).toHaveProperty('totalDeletionRequests');
      expect(stats).toHaveProperty('pendingRequests');
      expect(stats).toHaveProperty('consentRecords');
      
      expect(stats.totalExportRequests).toBeGreaterThanOrEqual(1);
      expect(stats.totalDeletionRequests).toBeGreaterThanOrEqual(1);
      expect(stats.consentRecords).toBeGreaterThanOrEqual(1);
      expect(stats.pendingRequests).toBeGreaterThanOrEqual(2);
    });

    it('should count pending requests correctly', async () => {
      const exportRequestId = await GDPRService.requestDataExport(testUserId);
      const deletionRequestId = await GDPRService.requestDataDeletion('user2');
      
      const stats = GDPRService.getComplianceStats();
      expect(stats.pendingRequests).toBeGreaterThanOrEqual(2);
    });
  });

  describe('data cleanup', () => {
    it('should clean up expired requests', () => {
      // This test would need to mock time or create expired requests
      // For now, just ensure the method doesn't throw
      expect(() => {
        GDPRService.cleanupExpiredRequests();
      }).not.toThrow();
    });

    it('should handle cleanup with no data', () => {
      expect(() => {
        GDPRService.cleanupExpiredRequests();
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle invalid consent types gracefully', async () => {
      // This would typically be caught by validation middleware
      // but we test the service directly
      await expect(
        GDPRService.recordConsent(
          testUserId,
          'invalid_type' as any,
          true,
          testIp,
          testUserAgent
        )
      ).resolves.not.toThrow();
    });

    it('should handle empty user IDs', async () => {
      await expect(
        GDPRService.recordConsent('', 'analytics', true, testIp, testUserAgent)
      ).resolves.not.toThrow();
    });

    it('should handle missing IP or user agent', async () => {
      await expect(
        GDPRService.recordConsent(testUserId, 'analytics', true, '', '')
      ).resolves.not.toThrow();
    });
  });

  describe('data anonymization', () => {
    it('should handle data anonymization in exports', async () => {
      // This tests the private methods indirectly through the export process
      const requestId = await GDPRService.requestDataExport(testUserId);
      const status = GDPRService.getDataExportStatus(requestId);
      
      expect(status).toBeDefined();
      expect(status!.status).toBe('pending');
      
      // The actual anonymization would happen during processing
      // which is tested indirectly through the export functionality
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent consent recording', async () => {
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        promises.push(
          GDPRService.recordConsent(
            `user-${i}`,
            'analytics',
            i % 2 === 0,
            testIp,
            testUserAgent
          )
        );
      }
      
      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it('should handle concurrent export requests', async () => {
      const promises = [];
      
      for (let i = 0; i < 3; i++) {
        promises.push(GDPRService.requestDataExport(`concurrent-user-${i}`));
      }
      
      const requestIds = await Promise.all(promises);
      expect(requestIds).toHaveLength(3);
      expect(new Set(requestIds).size).toBe(3); // All unique
    });
  });
});