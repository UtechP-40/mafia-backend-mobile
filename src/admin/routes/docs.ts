import { Router, Response } from 'express';
import { adminAsyncHandler } from '../middleware/errorHandler';
import { requireAdminPermission, AuthenticatedAdminRequest } from '../middleware/auth';
import { adminLogger } from '../config/logger';
import { Permission } from '../models/SuperUser';

const router = Router();

// Mock API documentation data
const mockApiEndpoints = [
  {
    id: '1',
    method: 'GET',
    path: '/api/auth/profile',
    description: 'Get user profile information',
    parameters: {
      headers: {
        'Authorization': 'Bearer <token>'
      }
    },
    example: {
      id: 'user123',
      username: 'player1',
      email: 'player1@example.com',
      statistics: {
        gamesPlayed: 25,
        gamesWon: 12,
        winRate: 48
      }
    }
  },
  {
    id: '2',
    method: 'POST',
    path: '/api/auth/login',
    description: 'Authenticate user and get access token',
    parameters: {
      body: {
        email: 'string',
        password: 'string'
      }
    },
    exampleBody: {
      email: 'player1@example.com',
      password: 'password123'
    },
    example: {
      success: true,
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      refreshToken: 'refresh_token_here',
      user: {
        id: 'user123',
        username: 'player1',
        email: 'player1@example.com'
      }
    }
  },
  {
    id: '3',
    method: 'POST',
    path: '/api/rooms',
    description: 'Create a new game room',
    parameters: {
      headers: {
        'Authorization': 'Bearer <token>',
        'Content-Type': 'application/json'
      },
      body: {
        name: 'string (optional)',
        maxPlayers: 'number',
        isPublic: 'boolean',
        settings: 'object'
      }
    },
    exampleBody: {
      name: 'My Game Room',
      maxPlayers: 8,
      isPublic: true,
      settings: {
        dayPhaseDuration: 300,
        nightPhaseDuration: 120,
        enableVoiceChat: true
      }
    },
    example: {
      success: true,
      room: {
        id: 'room123',
        code: 'ABC123',
        name: 'My Game Room',
        hostId: 'user123',
        players: [],
        status: 'waiting',
        settings: {
          maxPlayers: 8,
          dayPhaseDuration: 300,
          nightPhaseDuration: 120,
          enableVoiceChat: true
        }
      }
    }
  },
  {
    id: '4',
    method: 'GET',
    path: '/api/rooms/public',
    description: 'Get list of public game rooms',
    parameters: {
      query: {
        limit: 'number (optional, default: 20)',
        offset: 'number (optional, default: 0)',
        status: 'string (optional: waiting, playing, finished)'
      }
    },
    example: {
      success: true,
      rooms: [
        {
          id: 'room123',
          code: 'ABC123',
          name: 'Public Room 1',
          hostId: 'user456',
          playerCount: 5,
          maxPlayers: 8,
          status: 'waiting'
        }
      ],
      pagination: {
        total: 15,
        limit: 20,
        offset: 0
      }
    }
  },
  {
    id: '5',
    method: 'POST',
    path: '/api/rooms/:roomId/join',
    description: 'Join a game room',
    parameters: {
      headers: {
        'Authorization': 'Bearer <token>'
      },
      path: {
        roomId: 'string'
      }
    },
    example: {
      success: true,
      message: 'Successfully joined room',
      room: {
        id: 'room123',
        code: 'ABC123',
        players: [
          {
            id: 'user123',
            username: 'player1',
            isHost: false
          }
        ]
      }
    }
  },
  {
    id: '6',
    method: 'GET',
    path: '/api/players/stats',
    description: 'Get player statistics',
    parameters: {
      headers: {
        'Authorization': 'Bearer <token>'
      }
    },
    example: {
      success: true,
      statistics: {
        gamesPlayed: 25,
        gamesWon: 12,
        winRate: 48,
        favoriteRole: 'Villager',
        averageGameDuration: 1200,
        eloRating: 1450
      }
    }
  },
  {
    id: '7',
    method: 'POST',
    path: '/api/players/friends',
    description: 'Add a friend',
    parameters: {
      headers: {
        'Authorization': 'Bearer <token>',
        'Content-Type': 'application/json'
      },
      body: {
        friendId: 'string'
      }
    },
    exampleBody: {
      friendId: 'user456'
    },
    example: {
      success: true,
      message: 'Friend request sent',
      friendship: {
        id: 'friendship123',
        status: 'pending',
        createdAt: '2024-01-15T10:30:00Z'
      }
    }
  },
  {
    id: '8',
    method: 'GET',
    path: '/api/games/history',
    description: 'Get game history for the authenticated user',
    parameters: {
      headers: {
        'Authorization': 'Bearer <token>'
      },
      query: {
        limit: 'number (optional, default: 20)',
        offset: 'number (optional, default: 0)'
      }
    },
    example: {
      success: true,
      games: [
        {
          id: 'game123',
          roomId: 'room123',
          result: 'won',
          role: 'Mafia',
          duration: 1200,
          playedAt: '2024-01-15T10:30:00Z'
        }
      ],
      pagination: {
        total: 25,
        limit: 20,
        offset: 0
      }
    }
  }
];

/**
 * GET /admin/api/docs
 * Get API documentation
 */
router.get('/',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    
    adminLogger.info('API documentation accessed', {
      userId: adminUser.id,
      username: adminUser.username
    });

    try {
      res.json({
        success: true,
        data: {
          endpoints: mockApiEndpoints,
          total: mockApiEndpoints.length,
          version: '1.0.0',
          baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
          lastUpdated: new Date().toISOString()
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch API documentation', {
        userId: adminUser.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch API documentation',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

/**
 * GET /admin/api/docs/:id
 * Get specific endpoint documentation
 */
router.get('/:id',
  requireAdminPermission(Permission.SYSTEM_MONITOR),
  adminAsyncHandler(async (req: AuthenticatedAdminRequest, res: Response) => {
    const adminUser = req.adminUser;
    const { id } = req.params;
    
    adminLogger.info('Specific API documentation accessed', {
      userId: adminUser.id,
      username: adminUser.username,
      endpointId: id
    });

    try {
      const endpoint = mockApiEndpoints.find(ep => ep.id === id);
      
      if (!endpoint) {
        return res.status(404).json({
          success: false,
          message: 'API endpoint documentation not found'
        });
      }

      res.json({
        success: true,
        data: {
          endpoint,
          baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
          fullUrl: `${process.env.API_BASE_URL || 'http://localhost:3000'}${endpoint.path}`
        }
      });
    } catch (error) {
      adminLogger.error('Failed to fetch specific API documentation', {
        userId: adminUser.id,
        endpointId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to fetch API documentation',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  })
);

export default router;