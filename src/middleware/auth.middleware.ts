import { Request, Response, NextFunction } from 'express';

export const apiKeyMiddleware = (_req: Request, res: Response, next: NextFunction): void => {
  // Allow all requests in development mode
  const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  
  if (isDevelopment) {
    next();
    return;
  }

  // Ring-fenced: Validate API key for all requests in production
  const apiKey = _req.headers['x-api-key'] as string;
  const validKey = process.env.API_KEY || 'dev-key-12345';

  if (!apiKey || apiKey !== validKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    return;
  }

  next();
};

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    timestamp: new Date().toISOString(),
  });
};
