import { Request } from 'express';
import { logger } from '../utils/logger';
import { SecurityService } from './SecurityService';
import { AnalyticsEvent, EventType } from '../models/Analytics';

export interface PlayerBehaviorPattern {
  playerId: string;
  actionType: string;
  timestamp: Date;
  gameId: string;
  roomId: string;
  metadata?: any;
}

export interface CheatDetectionResult {
  isCheatDetected: boolean;
  cheatType: string[];
  confidence: number;
  evidence: string[];
}

export interface SuspiciousActivity {
  playerId: string;
  activityType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence: any;
  timestamp: Date;
}

export class AntiCheatService {
  private static playerBehaviors = new Map<string, PlayerBehaviorPattern[]>();
  private static suspiciousActivities: SuspiciousActivity[] = [];
  private static playerViolations = new Map<string, { count: number; lastViolation: Date }>();

  // Timing thresholds for human-like behavior
  private static readonly MIN_ACTION_INTERVAL = 100; // 100ms minimum between actions
  private static readonly MAX_REACTION_TIME = 50; // 50ms is superhuman reaction time
  private static readonly TYPICAL_VOTE_TIME = 2000; // 2 seconds typical voting time
  private static readonly MAX_SIMULTANEOUS_ACTIONS = 3;

  /**
   * Analyze player behavior for cheating patterns
   */
  static async analyzePlayerBehavior(
    playerId: string,
    actionType: string,
    gameId: string,
    roomId: string,
    metadata: any = {}
  ): Promise<CheatDetectionResult> {
    const pattern: PlayerBehaviorPattern = {
      playerId,
      actionType,
      timestamp: new Date(),
      gameId,
      roomId,
      metadata
    };

    // Store behavior pattern
    if (!this.playerBehaviors.has(playerId)) {
      this.playerBehaviors.set(playerId, []);
    }
    
    const behaviors = this.playerBehaviors.get(playerId)!;
    behaviors.push(pattern);

    // Keep only last 100 actions per player
    if (behaviors.length > 100) {
      behaviors.splice(0, behaviors.length - 100);
    }

    // Analyze for cheating patterns
    const result = await this.detectCheatingPatterns(playerId, behaviors);

    // Log suspicious activity
    if (result.isCheatDetected) {
      await this.logSuspiciousActivity({
        playerId,
        activityType: result.cheatType.join(', '),
        severity: result.confidence > 0.8 ? 'critical' : 
                 result.confidence > 0.6 ? 'high' : 'medium',
        description: `Potential cheating detected: ${result.cheatType.join(', ')}`,
        evidence: {
          patterns: result.evidence,
          confidence: result.confidence,
          recentActions: behaviors.slice(-10)
        },
        timestamp: new Date()
      });
    }

    return result;
  }

  /**
   * Detect various cheating patterns
   */
  private static async detectCheatingPatterns(
    playerId: string,
    behaviors: PlayerBehaviorPattern[]
  ): Promise<CheatDetectionResult> {
    const cheatTypes: string[] = [];
    const evidence: string[] = [];
    let maxConfidence = 0;

    // 1. Timing-based cheats
    const timingResult = this.detectTimingCheats(behaviors);
    if (timingResult.detected) {
      cheatTypes.push('timing_manipulation');
      evidence.push(...timingResult.evidence);
      maxConfidence = Math.max(maxConfidence, timingResult.confidence);
    }

    // 2. Pattern-based cheats
    const patternResult = this.detectPatternCheats(behaviors);
    if (patternResult.detected) {
      cheatTypes.push('pattern_manipulation');
      evidence.push(...patternResult.evidence);
      maxConfidence = Math.max(maxConfidence, patternResult.confidence);
    }

    // 3. Automated behavior
    const automationResult = this.detectAutomation(behaviors);
    if (automationResult.detected) {
      cheatTypes.push('automation');
      evidence.push(...automationResult.evidence);
      maxConfidence = Math.max(maxConfidence, automationResult.confidence);
    }

    // 4. Information leakage
    const infoResult = this.detectInformationLeakage(behaviors);
    if (infoResult.detected) {
      cheatTypes.push('information_leakage');
      evidence.push(...infoResult.evidence);
      maxConfidence = Math.max(maxConfidence, infoResult.confidence);
    }

    // 5. Collusion detection
    const collusionResult = await this.detectCollusion(playerId, behaviors);
    if (collusionResult.detected) {
      cheatTypes.push('collusion');
      evidence.push(...collusionResult.evidence);
      maxConfidence = Math.max(maxConfidence, collusionResult.confidence);
    }

    return {
      isCheatDetected: cheatTypes.length > 0,
      cheatType: cheatTypes,
      confidence: maxConfidence,
      evidence
    };
  }

  /**
   * Detect timing-based cheating
   */
  private static detectTimingCheats(behaviors: PlayerBehaviorPattern[]): {
    detected: boolean;
    confidence: number;
    evidence: string[];
  } {
    const evidence: string[] = [];
    let suspiciousCount = 0;

    if (behaviors.length < 2) {
      return { detected: false, confidence: 0, evidence: [] };
    }

    // Check for superhuman reaction times
    for (let i = 1; i < behaviors.length; i++) {
      const timeDiff = behaviors[i].timestamp.getTime() - behaviors[i - 1].timestamp.getTime();
      
      if (timeDiff < this.MIN_ACTION_INTERVAL) {
        suspiciousCount++;
        evidence.push(`Action interval too short: ${timeDiff}ms`);
      }

      if (timeDiff < this.MAX_REACTION_TIME && 
          behaviors[i].actionType === 'vote' && 
          behaviors[i - 1].actionType === 'phase_change') {
        suspiciousCount++;
        evidence.push(`Superhuman reaction time: ${timeDiff}ms`);
      }
    }

    // Check for perfectly consistent timing (bot-like behavior)
    const intervals = [];
    for (let i = 1; i < behaviors.length; i++) {
      intervals.push(behaviors[i].timestamp.getTime() - behaviors[i - 1].timestamp.getTime());
    }

    if (intervals.length > 5) {
      const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
      const variance = intervals.reduce((sum, interval) => 
        sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
      
      if (variance < 100 && avgInterval > 1000) { // Very consistent timing
        suspiciousCount++;
        evidence.push(`Suspiciously consistent timing: variance ${variance.toFixed(2)}`);
      }
    }

    const confidence = Math.min(suspiciousCount / 5, 1);
    return {
      detected: suspiciousCount >= 3,
      confidence,
      evidence
    };
  }

  /**
   * Detect pattern-based cheating
   */
  private static detectPatternCheats(behaviors: PlayerBehaviorPattern[]): {
    detected: boolean;
    confidence: number;
    evidence: string[];
  } {
    const evidence: string[] = [];
    let suspiciousCount = 0;

    // Check for impossible knowledge patterns
    const voteActions = behaviors.filter(b => b.actionType === 'vote');
    if (voteActions.length > 5) {
      // Check if player always votes for mafia members (impossible without cheating)
      const mafiaVotes = voteActions.filter(v => 
        v.metadata?.targetRole === 'mafia' || v.metadata?.targetRole === 'godfather'
      );
      
      if (mafiaVotes.length / voteActions.length > 0.8) {
        suspiciousCount++;
        evidence.push(`Suspiciously accurate mafia detection: ${mafiaVotes.length}/${voteActions.length}`);
      }
    }

    // Check for repetitive patterns that suggest automation
    const actionSequences = behaviors.slice(-10).map(b => b.actionType).join(',');
    const repeatingPattern = this.findRepeatingPattern(actionSequences);
    if (repeatingPattern && repeatingPattern.length > 2) {
      suspiciousCount++;
      evidence.push(`Repetitive action pattern detected: ${repeatingPattern}`);
    }

    const confidence = Math.min(suspiciousCount / 3, 1);
    return {
      detected: suspiciousCount >= 2,
      confidence,
      evidence
    };
  }

  /**
   * Detect automated behavior
   */
  private static detectAutomation(behaviors: PlayerBehaviorPattern[]): {
    detected: boolean;
    confidence: number;
    evidence: string[];
  } {
    const evidence: string[] = [];
    let suspiciousCount = 0;

    if (behaviors.length < 10) {
      return { detected: false, confidence: 0, evidence: [] };
    }

    // Check for lack of human-like hesitation
    const quickActions = behaviors.filter((b, i) => {
      if (i === 0) return false;
      const timeDiff = b.timestamp.getTime() - behaviors[i - 1].timestamp.getTime();
      return timeDiff < 500 && b.actionType === 'vote'; // Very quick voting
    });

    if (quickActions.length / behaviors.length > 0.7) {
      suspiciousCount++;
      evidence.push(`Too many quick actions: ${quickActions.length}/${behaviors.length}`);
    }

    // Check for perfect accuracy in complex scenarios
    const complexActions = behaviors.filter(b => 
      b.actionType === 'use_ability' && b.metadata?.complexity === 'high'
    );
    
    if (complexActions.length > 3 && 
        complexActions.every(a => a.metadata?.success === true)) {
      suspiciousCount++;
      evidence.push(`Perfect accuracy in complex actions: ${complexActions.length}`);
    }

    // Check for simultaneous actions (impossible for humans)
    const simultaneousActions = this.findSimultaneousActions(behaviors);
    if (simultaneousActions > this.MAX_SIMULTANEOUS_ACTIONS) {
      suspiciousCount++;
      evidence.push(`Too many simultaneous actions: ${simultaneousActions}`);
    }

    const confidence = Math.min(suspiciousCount / 3, 1);
    return {
      detected: suspiciousCount >= 2,
      confidence,
      evidence
    };
  }

  /**
   * Detect information leakage (knowing things they shouldn't)
   */
  private static detectInformationLeakage(behaviors: PlayerBehaviorPattern[]): {
    detected: boolean;
    confidence: number;
    evidence: string[];
  } {
    const evidence: string[] = [];
    let suspiciousCount = 0;

    // Check for actions that suggest knowledge of hidden information
    const suspiciousActions = behaviors.filter(b => {
      // Player targeting someone they shouldn't know about
      if (b.actionType === 'vote' && b.metadata?.targetRole && 
          b.metadata?.playerRole !== 'detective' && 
          b.metadata?.targetRole === 'mafia') {
        return true;
      }

      // Using abilities on perfect targets without investigation
      if (b.actionType === 'use_ability' && 
          b.metadata?.abilityType === 'protect' &&
          b.metadata?.targetWasAttacked === true) {
        return true;
      }

      return false;
    });

    if (suspiciousActions.length > 2) {
      suspiciousCount++;
      evidence.push(`Actions suggesting hidden knowledge: ${suspiciousActions.length}`);
    }

    const confidence = Math.min(suspiciousCount / 2, 1);
    return {
      detected: suspiciousCount >= 1,
      confidence,
      evidence
    };
  }

  /**
   * Detect collusion between players
   */
  private static async detectCollusion(playerId: string, behaviors: PlayerBehaviorPattern[]): Promise<{
    detected: boolean;
    confidence: number;
    evidence: string[];
  }> {
    const evidence: string[] = [];
    let suspiciousCount = 0;

    // Get behaviors of other players in the same games
    const gameIds = [...new Set(behaviors.map(b => b.gameId))];
    const otherPlayerBehaviors = new Map<string, PlayerBehaviorPattern[]>();

    for (const [otherPlayerId, otherBehaviors] of this.playerBehaviors.entries()) {
      if (otherPlayerId === playerId) continue;
      
      const relevantBehaviors = otherBehaviors.filter(b => gameIds.includes(b.gameId));
      if (relevantBehaviors.length > 0) {
        otherPlayerBehaviors.set(otherPlayerId, relevantBehaviors);
      }
    }

    // Check for coordinated voting patterns
    const playerVotes = behaviors.filter(b => b.actionType === 'vote');
    for (const [otherPlayerId, otherBehaviors] of otherPlayerBehaviors.entries()) {
      const otherVotes = otherBehaviors.filter(b => b.actionType === 'vote');
      
      // Check if players consistently vote for the same targets
      let matchingVotes = 0;
      for (const vote of playerVotes) {
        const matchingVote = otherVotes.find(v => 
          v.gameId === vote.gameId && 
          v.metadata?.targetId === vote.metadata?.targetId &&
          Math.abs(v.timestamp.getTime() - vote.timestamp.getTime()) < 30000 // Within 30 seconds
        );
        if (matchingVote) matchingVotes++;
      }

      if (matchingVotes > 3 && matchingVotes / Math.min(playerVotes.length, otherVotes.length) > 0.8) {
        suspiciousCount++;
        evidence.push(`Coordinated voting with player ${otherPlayerId}: ${matchingVotes} matches`);
      }
    }

    const confidence = Math.min(suspiciousCount / 2, 1);
    return {
      detected: suspiciousCount >= 1,
      confidence,
      evidence
    };
  }

  /**
   * Helper function to find repeating patterns in action sequences
   */
  private static findRepeatingPattern(sequence: string): string | null {
    for (let len = 2; len <= sequence.length / 2; len++) {
      for (let start = 0; start <= sequence.length - len * 2; start++) {
        const pattern = sequence.substr(start, len);
        const nextOccurrence = sequence.substr(start + len, len);
        if (pattern === nextOccurrence) {
          return pattern;
        }
      }
    }
    return null;
  }

  /**
   * Helper function to find simultaneous actions
   */
  private static findSimultaneousActions(behaviors: PlayerBehaviorPattern[]): number {
    let simultaneousCount = 0;
    const timeGroups = new Map<number, number>();

    for (const behavior of behaviors) {
      const timeSlot = Math.floor(behavior.timestamp.getTime() / 100); // 100ms slots
      timeGroups.set(timeSlot, (timeGroups.get(timeSlot) || 0) + 1);
    }

    for (const count of timeGroups.values()) {
      if (count > 1) {
        simultaneousCount += count - 1;
      }
    }

    return simultaneousCount;
  }

  /**
   * Log suspicious activity
   */
  private static async logSuspiciousActivity(activity: SuspiciousActivity): Promise<void> {
    try {
      this.suspiciousActivities.push(activity);

      // Keep only last 1000 activities in memory
      if (this.suspiciousActivities.length > 1000) {
        this.suspiciousActivities = this.suspiciousActivities.slice(-1000);
      }

      // Update player violation tracking
      const violations = this.playerViolations.get(activity.playerId) || 
        { count: 0, lastViolation: new Date() };
      violations.count++;
      violations.lastViolation = new Date();
      this.playerViolations.set(activity.playerId, violations);

      // Store in database
      await AnalyticsEvent.create({
        eventType: EventType.ANTI_CHEAT_DETECTION,
        userId: activity.playerId,
        sessionId: `cheat_${Date.now()}`,
        properties: {
          activityType: activity.activityType,
          severity: activity.severity,
          description: activity.description,
          evidence: activity.evidence
        },
        timestamp: activity.timestamp
      });

      // Log security event
      await SecurityService.logSecurityEvent({
        type: 'anti_cheat_detection',
        ip: 'unknown', // Will be filled by middleware
        userAgent: 'unknown',
        url: '/game/action',
        userId: activity.playerId,
        indicators: [activity.activityType],
        timestamp: activity.timestamp,
        severity: activity.severity
      });

      logger.warn('Suspicious game activity detected', activity);
    } catch (error) {
      logger.error('Failed to log suspicious activity:', error);
    }
  }

  /**
   * Get player violation history
   */
  static getPlayerViolations(playerId: string): { count: number; lastViolation: Date } | null {
    return this.playerViolations.get(playerId) || null;
  }

  /**
   * Check if player should be flagged for review
   */
  static shouldFlagPlayer(playerId: string): boolean {
    const violations = this.playerViolations.get(playerId);
    if (!violations) return false;

    // Flag if more than 5 violations in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return violations.count > 5 && violations.lastViolation > oneDayAgo;
  }

  /**
   * Get anti-cheat statistics
   */
  static getAntiCheatStats(): {
    totalDetections: number;
    detectionsByType: { [key: string]: number };
    flaggedPlayers: number;
    recentActivity: SuspiciousActivity[];
  } {
    const detectionsByType: { [key: string]: number } = {};
    
    for (const activity of this.suspiciousActivities) {
      detectionsByType[activity.activityType] = 
        (detectionsByType[activity.activityType] || 0) + 1;
    }

    const flaggedPlayers = Array.from(this.playerViolations.values())
      .filter(v => {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return v.count > 5 && v.lastViolation > oneDayAgo;
      }).length;

    return {
      totalDetections: this.suspiciousActivities.length,
      detectionsByType,
      flaggedPlayers,
      recentActivity: this.suspiciousActivities.slice(-20)
    };
  }

  /**
   * Clear old behavior data to prevent memory leaks
   */
  static cleanupOldData(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    for (const [playerId, behaviors] of this.playerBehaviors.entries()) {
      const recentBehaviors = behaviors.filter(b => b.timestamp > oneHourAgo);
      if (recentBehaviors.length === 0) {
        this.playerBehaviors.delete(playerId);
      } else {
        this.playerBehaviors.set(playerId, recentBehaviors);
      }
    }

    // Clean up old suspicious activities
    this.suspiciousActivities = this.suspiciousActivities.filter(
      a => a.timestamp > oneHourAgo
    );
  }
}