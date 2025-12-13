import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { config } from './config';
import { apiKeyMiddleware, errorHandler } from './middleware/auth.middleware';
import { connectDatabase, seedDefaultUsers } from './services/database.service';
import evaluationRoutes from './routes/evaluation.routes';
import applicationsRoutes from './routes/applications.routes';
import authRoutes from './routes/auth.routes';
import storageRoutes from './routes/storage.routes';

const app = express();

// Middleware
// Allow configured origins and any localhost/127.0.0.1 port in development
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
    if (!origin) return callback(null, true);
    
    const allowed = Array.isArray(config.CORS_ORIGIN) ? config.CORS_ORIGIN : [config.CORS_ORIGIN as any];
    const isListed = allowed.includes(origin);
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/i.test(origin);
    const isVercel = origin.includes('.vercel.app');
    
    if (isListed || isLocalhost || isVercel) return callback(null, true);
    
    console.warn(`CORS: Origin not allowed: ${origin}`);
    return callback(new Error(`CORS: Origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-api-key', 'x-user-role', 'x-user-email'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // Cache preflight for 10 minutes
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Auth routes (no API key required)
app.use('/api/auth', authRoutes);

// Ring-fenced: API key validation for other routes
app.use(apiKeyMiddleware);

// Routes
app.use('/api/evaluation', evaluationRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/storage', storageRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Error handling
app.use(errorHandler);

// Start server
const PORT = config.PORT;

// Initialize database and start server
(async () => {
  try {
    await connectDatabase();
    await seedDefaultUsers();
    
    app.listen(PORT, () => {
      console.log(`✅ NOC Evaluator Backend running on port ${PORT}`);
      console.log(`Environment: ${config.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();

export default app;

