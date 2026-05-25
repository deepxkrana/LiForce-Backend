import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireBloodBank = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'bloodbank') {
    return res.status(403).json({ error: 'Forbidden: Blood Bank access only' });
  }
  next();
};
