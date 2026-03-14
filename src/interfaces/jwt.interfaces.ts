import { Request } from 'express';

export interface JwtPayload {
  userId: string;
  email: string;
  role?: string;
}

export interface AuthRequest extends Request {
  user: {
    id: string;
    email: string;
    role: string;
    roles: string[];
  };
}
