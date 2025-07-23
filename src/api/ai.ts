import { Router, Request, Response } from "express";
import { AIService } from "../services";
import { Game, Player, ChatMessage } from "../models";
import { authenticateToken } from "../middleware/authMiddleware";
import { Types } from "mongoose";

const router = Router();

/**
 * POST /api/ai/moderate-content
 * Moderate chat content for appropriateness
 */
router.post(
  "/moderate-content",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { content, context } = req.body;

      if (!content || typeof content !== "string") {
        return res.status(400).json({
          error: "Content is required and must be a string",
        });
      }

      const result = await AIService.moderateContent(content, context);

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error moderating content:", error);
      return res.status(500).json({
        error: "Failed to moderate content",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * POST /api/ai/moderate-game
 * Get AI moderation assistance for game situations
 */
router.post(
  "/moderate-game",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { gameId, context, issue } = req.body;

      if (!gameId || !context) {
        return res.status(400).json({
          error: "Game ID and context are required",
        });
      }

      // Fetch the game state
      const game = await Game.findById(gameId).populate(
        "players",
        "username avatar role isAlive"
      );

      if (!game) {
        return res.status(404).json({
          error: "Game not found",
        });
      }

      const response = await AIService.moderateGame(game, context, issue);

      return res.json({
        success: true,
        data: response,
      });
    } catch (error) {
      console.error("Error in game moderation:", error);
      return res.status(500).json({
        error: "Failed to moderate game",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * POST /api/ai/analyze-behavior
 * Analyze player behavior for suspicious patterns
 */
router.post(
  "/analyze-behavior",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { playerId, gameId } = req.body;

      if (!playerId) {
        return res.status(400).json({
          error: "Player ID is required",
        });
      }

      // Fetch the player
      const player = await Player.findById(playerId);
      if (!player) {
        return res.status(404).json({
          error: "Player not found",
        });
      }

      // Fetch game history for the player (simplified for now)
      const gameHistory = await Game.find({
        players: playerId,
        phase: "finished",
      })
        .limit(20)
        .sort({ createdAt: -1 });

      // Fetch current game if provided
      let currentGame = null;
      if (gameId) {
        currentGame = await Game.findById(gameId);
      }

      const analysis = await AIService.analyzePlayerBehavior(
        player,
        gameHistory,
        currentGame || undefined
      );

      return res.json({
        success: true,
        data: analysis,
      });
    } catch (error) {
      console.error("Error analyzing player behavior:", error);
      return res.status(500).json({
        error: "Failed to analyze player behavior",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * POST /api/ai/gameplay-tips
 * Get contextual gameplay tips for a player
 */
router.post(
  "/gameplay-tips",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { gameId, experience = "intermediate" } = req.body;
      const playerId = (req as any).user.id;

      if (!gameId) {
        return res.status(400).json({
          error: "Game ID is required",
        });
      }

      // Fetch the game and player
      const game = await Game.findById(gameId).populate(
        "players",
        "username avatar role isAlive"
      );
      const player = await Player.findById(playerId);

      if (!game) {
        return res.status(404).json({
          error: "Game not found",
        });
      }

      if (!player) {
        return res.status(404).json({
          error: "Player not found",
        });
      }

      // Check if player is in the game
      const isPlayerInGame = game.players.some((p: any) =>
        p._id.equals(playerId)
      );
      if (!isPlayerInGame) {
        return res.status(403).json({
          error: "Player is not in this game",
        });
      }

      const tips = await AIService.provideGameplayTips(
        player,
        game,
        experience
      );

      return res.json({
        success: true,
        data: tips,
      });
    } catch (error) {
      console.error("Error providing gameplay tips:", error);
      return res.status(500).json({
        error: "Failed to provide gameplay tips",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * GET /api/ai/health
 * Check AI service health
 */
router.get("/health", async (req: Request, res: Response) => {
  try {
    const isHealthy = await AIService.healthCheck();

    res.json({
      success: true,
      data: {
        healthy: isHealthy,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error checking AI service health:", error);
    res.status(500).json({
      error: "Failed to check AI service health",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/ai/chat-assistance
 * Get AI assistance for chat messages (for moderators)
 */
router.post(
  "/chat-assistance",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { roomId, messageId, action } = req.body;

      if (!roomId || !messageId) {
        return res.status(400).json({
          error: "Room ID and message ID are required",
        });
      }

      // Fetch the message
      const message = await ChatMessage.findById(messageId).populate(
        "playerId",
        "username"
      );
      if (!message) {
        return res.status(404).json({
          error: "Message not found",
        });
      }

      // Moderate the content
      const moderationResult = await AIService.moderateContent(message.content);

      // If action is provided, apply it
      if (action && moderationResult.suggestedAction) {
        switch (action) {
          case "moderate":
            await (message as any).moderate("AI-assisted moderation");
            break;
          case "approve":
            // Message is already approved by default
            break;
        }
      }

      return res.json({
        success: true,
        data: {
          moderation: moderationResult,
          message: {
            id: message._id,
            content: message.content,
            isModerated: message.isModerated,
            moderationReason: message.moderationReason,
          },
        },
      });
    } catch (error) {
      console.error("Error in chat assistance:", error);
      return res.status(500).json({
        error: "Failed to provide chat assistance",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

export default router;
