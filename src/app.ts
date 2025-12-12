import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { config } from './config';
import { apiKeyMiddleware, errorHandler } from './middleware/auth.middleware';
import evaluationRoutes from './routes/evaluation.routes';
import applicationsRoutes from './routes/applications.routes';
import authRoutes from './routes/auth.routes';

const app = express();

// Middleware
app.use(cors({
  origin: (origin, callback) => {
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-api-key'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Health check (before any auth)
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    mongoUri: process.env.MONGODB_URI ? 'SET' : 'NOT SET',
    apiKey: process.env.API_KEY ? 'SET' : 'NOT SET',
    nodeEnv: process.env.NODE_ENV || 'not set'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    mongoUri: process.env.MONGODB_URI ? 'SET' : 'NOT SET',
    apiKey: process.env.API_KEY ? 'SET' : 'NOT SET',
    nodeEnv: process.env.NODE_ENV || 'not set'
  });
});

// Auth routes (no API key required)
app.use('/api/auth', authRoutes);

// Ring-fenced: API key validation for other routes
app.use(apiKeyMiddleware);

// Routes
app.use('/api/evaluation', evaluationRoutes);
app.use('/api/applications', applicationsRoutes);

// Error handling
app.use(errorHandler);

export default app;
