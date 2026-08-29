import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { execute, queryOne } from '../db/connection';
import { JWT_SECRET } from '../middleware/authMiddleware';

const router = Router();


export default router;
