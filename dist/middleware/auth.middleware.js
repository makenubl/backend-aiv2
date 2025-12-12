"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.apiKeyMiddleware = void 0;
const apiKeyMiddleware = (req, res, next) => {
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
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== validKey) {
        res.status(401).json({ error: 'Unauthorized: Invalid API key' });
        return;
    }
    next();
};
exports.apiKeyMiddleware = apiKeyMiddleware;
const errorHandler = (err, _req, res, _next) => {
    console.error('Error:', err);
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server error';
    res.status(statusCode).json({
        error: message,
        timestamp: new Date().toISOString(),
    });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=auth.middleware.js.map