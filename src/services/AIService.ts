import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { IGame, IPlayer, IChatMessage, GamePhase } from "../models";
import { logger } from "../utils/logger";

export interface AIModeratorResponse {
  message: string;
  action?: "warn" | "mute" | "kick";
  confidence: number;
}

export interface ContentModerationResult {
  isAppropriate: boolean;
  reason?: string;
  severity: "low" | "medium" | "high";
  suggestedAction?: "filter" | "warn" | "block";
}

export interface PlayerBehaviorAnalysis {
  playerId: string;
  suspiciousPatterns: string[];
  riskLevel: "low" | "medium" | "high";
  recommendations: string[];
}

export interface GameplayTip {
  message: string;
  relevance: number;
  timing: "immediate" | "next_phase" | "end_game";
}

class AIService {
  private model!: ChatGoogleGenerativeAI;
  private isInitialized: boolean = false;

  constructor() {
    this.initializeModel();
  }

  private initializeModel(): void {
    try {
      if (!process.env.GEMINI_API_KEY) {
        logger.warn("GEMINI_API_KEY environment variable is not set");
        this.isInitialized = false;
        return;
      }

      this.model = new ChatGoogleGenerativeAI({
        model: "gemini-2.0-flash-exp",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: 0.7,
        maxOutputTokens: 1024,
      });

      this.isInitialized = true;
      logger.info("AI Service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize AI Service:", error);
      this.isInitialized = false;
    }
  }

  /**
   * Reinitialize the service (useful for testing)
   */
  public reinitialize(): void {
    this.initializeModel();
  }

  /**
   * AI Game Moderator - Provides context-aware responses for game moderation
   */
  async moderateGame(
    gameState: IGame,
    context: string,
    issue?: string
  ): Promise<AIModeratorResponse> {
    if (!this.isInitialized) {
      throw new Error("AI Service is not initialized");
    }

    try {
      const systemPrompt = `You are an AI game moderator for a Mafia game. Your role is to:
1. Maintain fair play and good sportsmanship
2. Resolve disputes and clarify rules
3. Keep the game engaging and fun
4. Detect and address inappropriate behavior

Current game context:
- Phase: ${gameState.phase}
- Day: ${gameState.dayNumber}
- Players alive: ${
        gameState.players.length - gameState.eliminatedPlayers.length
      }
- Total players: ${gameState.players.length}

Respond with helpful, neutral, and encouraging guidance. Keep responses concise and game-focused.`;

      const userPrompt = issue
        ? `Issue reported: ${issue}\nContext: ${context}`
        : `Game situation: ${context}`;

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ];

      const response = await this.model.invoke(messages);
      const content = response.content as string;

      // Analyze response for suggested actions
      const action = this.extractModerationAction(content, issue);
      const confidence = this.calculateConfidence(content, issue);

      return {
        message: content,
        action,
        confidence,
      };
    } catch (error) {
      logger.error("Error in AI game moderation:", error);
      throw new Error("Failed to generate moderation response");
    }
  }

  /**
   * Chat Moderation - Filters inappropriate content
   */
  async moderateContent(
    message: string,
    context?: any
  ): Promise<ContentModerationResult> {
    if (!this.isInitialized) {
      return { isAppropriate: true, severity: "low" };
    }

    try {
      const systemPrompt = `You are a content moderation AI for a Mafia game chat. Analyze messages for:
1. Inappropriate language (profanity, harassment, hate speech)
2. Personal attacks or bullying
3. Spam or irrelevant content
4. Cheating attempts or game-breaking behavior
5. Sharing personal information

Respond with a JSON object containing:
- isAppropriate: boolean
- reason: string (if inappropriate)
- severity: "low" | "medium" | "high"
- suggestedAction: "filter" | "warn" | "block" (if inappropriate)

Be lenient with game-related banter and strategic deception, as these are part of Mafia gameplay.`;

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`Analyze this message: "${message}"`),
      ];

      const response = await this.model.invoke(messages);
      const content = response.content as string;

      try {
        const result = JSON.parse(content);
        return {
          isAppropriate: result.isAppropriate ?? true,
          reason: result.reason,
          severity: result.severity ?? "low",
          suggestedAction: result.suggestedAction,
        };
      } catch (parseError) {
        // Fallback if JSON parsing fails
        const isAppropriate = !content.toLowerCase().includes("inappropriate");
        return {
          isAppropriate,
          severity: "low",
          reason: isAppropriate ? undefined : "Content flagged for review",
        };
      }
    } catch (error) {
      logger.error("Error in content moderation:", error);
      // Fail safe - allow content if AI fails
      return { isAppropriate: true, severity: "low" };
    }
  }

  /**
   * Player Behavior Analysis - Detects suspicious patterns
   */
  async analyzePlayerBehavior(
    player: IPlayer,
    gameHistory: any[],
    currentGame?: IGame
  ): Promise<PlayerBehaviorAnalysis> {
    if (!this.isInitialized) {
      return {
        playerId: player._id.toString(),
        suspiciousPatterns: [],
        riskLevel: "low",
        recommendations: [],
      };
    }

    try {
      const systemPrompt = `You are an AI analyst detecting suspicious behavior in Mafia games. Analyze patterns for:
1. Potential cheating or collusion
2. Griefing or intentional game disruption
3. Unusual voting patterns
4. Communication anomalies
5. Meta-gaming or external coordination

Respond with JSON containing:
- suspiciousPatterns: string[] (specific behaviors observed)
- riskLevel: "low" | "medium" | "high"
- recommendations: string[] (suggested actions)

Consider that some unusual behavior might be legitimate strategy.`;

      const playerData = {
        username: player.username,
        gamesPlayed: player.statistics?.gamesPlayed || 0,
        winRate: player.statistics?.winRate || 0,
        recentGames: gameHistory.slice(-10),
        currentGameBehavior: currentGame
          ? {
              phase: currentGame.phase,
              isAlive: player.isAlive,
              role: player.role,
            }
          : null,
      };

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(
          `Analyze this player's behavior: ${JSON.stringify(
            playerData,
            null,
            2
          )}`
        ),
      ];

      const response = await this.model.invoke(messages);
      const content = response.content as string;

      try {
        const result = JSON.parse(content);
        return {
          playerId: player._id.toString(),
          suspiciousPatterns: result.suspiciousPatterns || [],
          riskLevel: result.riskLevel || "low",
          recommendations: result.recommendations || [],
        };
      } catch (parseError) {
        return {
          playerId: player._id.toString(),
          suspiciousPatterns: [],
          riskLevel: "low",
          recommendations: [],
        };
      }
    } catch (error) {
      logger.error("Error in player behavior analysis:", error);
      return {
        playerId: player._id.toString(),
        suspiciousPatterns: [],
        riskLevel: "low",
        recommendations: [],
      };
    }
  }

  /**
   * Gameplay Assistance - Provides contextual tips and suggestions
   */
  async provideGameplayTips(
    player: IPlayer,
    gameState: IGame,
    playerExperience: "beginner" | "intermediate" | "advanced" = "intermediate"
  ): Promise<GameplayTip[]> {
    if (!this.isInitialized) {
      return [];
    }

    try {
      const systemPrompt = `You are a helpful AI assistant providing strategic tips for Mafia game players. 
Provide contextual advice based on:
1. Current game phase and situation
2. Player's role (if known to them)
3. Player experience level
4. Game dynamics and voting patterns

Respond with JSON array of tips, each containing:
- message: string (the tip)
- relevance: number (0-1, how relevant to current situation)
- timing: "immediate" | "next_phase" | "end_game"

Keep tips strategic but not game-breaking. Don't reveal information players shouldn't know.`;

      const gameContext = {
        phase: gameState.phase,
        dayNumber: gameState.dayNumber,
        playersAlive:
          gameState.players.length - gameState.eliminatedPlayers.length,
        totalPlayers: gameState.players.length,
        playerRole: player.role,
        playerIsAlive: player.isAlive,
        experienceLevel: playerExperience,
        timeRemaining: gameState.timeRemaining,
      };

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(
          `Provide gameplay tips for this situation: ${JSON.stringify(
            gameContext,
            null,
            2
          )}`
        ),
      ];

      const response = await this.model.invoke(messages);
      const content = response.content as string;

      try {
        const tips = JSON.parse(content);
        return Array.isArray(tips) ? tips : [];
      } catch (parseError) {
        // Fallback with basic tips
        return this.getBasicTips(gameState.phase, playerExperience);
      }
    } catch (error) {
      logger.error("Error providing gameplay tips:", error);
      return this.getBasicTips(gameState.phase, playerExperience);
    }
  }

  /**
   * Health check for AI service
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isInitialized) {
      return false;
    }

    try {
      const testMessage = new HumanMessage('Health check - respond with "OK"');
      const response = await this.model.invoke([testMessage]);
      return response.content !== null;
    } catch (error) {
      logger.error("AI Service health check failed:", error);
      return false;
    }
  }

  // Helper methods
  private extractModerationAction(
    content: string,
    issue?: string
  ): "warn" | "mute" | "kick" | undefined {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes("kick") || lowerContent.includes("remove")) {
      return "kick";
    }
    if (lowerContent.includes("mute") || lowerContent.includes("silence")) {
      return "mute";
    }
    if (lowerContent.includes("warn") || lowerContent.includes("caution")) {
      return "warn";
    }

    return undefined;
  }

  private calculateConfidence(content: string, issue?: string): number {
    // Simple confidence calculation based on response characteristics
    const hasSpecificAction = /\b(warn|mute|kick|remove)\b/i.test(content);
    const hasReasoning = content.length > 50;
    const hasIssueContext = issue
      ? content.toLowerCase().includes(issue.toLowerCase())
      : true;

    let confidence = 0.5;
    if (hasSpecificAction) confidence += 0.2;
    if (hasReasoning) confidence += 0.2;
    if (hasIssueContext) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  private getBasicTips(phase: GamePhase, experience: string): GameplayTip[] {
    const basicTips: Record<GamePhase, GameplayTip[]> = {
      [GamePhase.DAY]: [
        {
          message:
            "Pay attention to voting patterns and who players are defending or attacking.",
          relevance: 0.8,
          timing: "immediate",
        },
        {
          message: "Look for inconsistencies in player stories and behavior.",
          relevance: 0.7,
          timing: "immediate",
        },
      ],
      [GamePhase.NIGHT]: [
        {
          message:
            "Use this time to plan your strategy for the next day phase.",
          relevance: 0.6,
          timing: "immediate",
        },
      ],
      [GamePhase.VOTING]: [
        {
          message:
            "Consider all the information shared during discussion before voting.",
          relevance: 0.9,
          timing: "immediate",
        },
      ],
      [GamePhase.FINISHED]: [],
    };

    return basicTips[phase] || [];
  }
}

export default new AIService();
