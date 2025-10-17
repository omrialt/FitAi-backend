import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    try {
      console.log(`🔍 [${new Date().toISOString()}]`);
      console.log(`📝 Method: ${req.method}`);
      console.log(`🌐 URL: ${req.originalUrl}`);

      // ✅ Safely log body
      if (
        req.body &&
        typeof req.body === 'object' &&
        !Array.isArray(req.body) &&
        Object.keys(req.body ?? {}).length > 0
      ) {
        console.log('📦 Request Body:', JSON.stringify(req.body, null, 2));
      }

      // ✅ Safely log query params
      if (
        req.query &&
        typeof req.query === 'object' &&
        Object.keys(req.query ?? {}).length > 0
      ) {
        console.log('🔎 Query Params:', JSON.stringify(req.query, null, 2));
      }

      // ✅ Safe headers logging
      const safeHeaders = { ...(req.headers || {}) };
      delete safeHeaders.authorization;
      delete safeHeaders.cookie;
      console.log('📋 Headers:', JSON.stringify(safeHeaders, null, 2));

      // ✅ Response time tracking
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`⌛ Response Time: ${duration}ms`);
        console.log('📍 End of request log\n');
      });
    } catch (error) {
      console.error('❌ Logger middleware error:', error);
    }

    next();
  }
}
