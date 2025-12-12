import { Request, Response, NextFunction } from 'express';

export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Skip auth for health and diagnostic endpoints
  if (req.path === '/health' || req.path === '/api/health' || req.path === '/debug') {
    next();
    return;
  }

  // Allow all requests in development mode
  const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  
  if (isDevelopment) {
    next();
    return;
  }

  // If no API_KEY is set in environment, allow all requests
  const validKey = process.env.API_KEY;
  if (!validKey) {
    next();
    return;
  }

  // Ring-fenced: Validate API key for all requests in production
  const apiKey = req.headers['x-api-key'] as string;

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
