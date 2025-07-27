import request from 'supertest';
import express from 'express';
import databaseRoutes from '../routes/database';
import { DatabaseOperationsService } from '../services/DatabaseOperationsService';
import { adminAuthMiddleware, requireAdminPermission } from '../middleware/auth';
import { Permission } from '../models/SuperUser';

// Mock the DatabaseOperationsService
jest.mock('../services/DatabaseOperationsService');

// Mock the middleware
jest.mock('../middleware/auth