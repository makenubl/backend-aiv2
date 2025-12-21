import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { config } from './config';
import { apiKeyMiddleware, errorHandler } from './middleware/auth.middleware';
import { connectDatabase, seedDefaultUsers } from './services/database.service';
import * as s3Storage from './services/s3-storage.service';
import evaluationRoutes from './routes/evaluation.routes';
import applicationsRoutes from './routes/applications.routes';
import authRoutes from './routes/auth.routes';
import storageRoutes from './routes/storage.routes';
import usersRoutes from './routes/users.routes';
// Project Tracker Module - routes
import projectsRoutes from './routes/projects.routes';
import vendorPortalRoutes from './routes/vendor-portal.routes';
import projectTrackerRoutes from './routes/project-tracker.routes';
import { initializeProjectTrackerDb } from './services/project-tracker-db.service';

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
    const isPvaraTeam = origin.includes('pvara.team');
    
    if (isListed || isLocalhost || isVercel || isPvaraTeam) return callback(null, true);
    
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

// Vendor Portal routes (separate authentication, no API key)
// This allows vendors/external users to access without main system credentials
app.use('/api/portal', vendorPortalRoutes);

// Ring-fenced: API key validation for other routes
app.use(apiKeyMiddleware);

// Routes
app.use('/api/evaluation', evaluationRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/users', usersRoutes);
// Project Tracker routes (requires API key authentication)
app.use('/api/projects', projectsRoutes);
// Project Tracker wizard routes (file upload, AI analysis, task management)
app.use('/api/project-tracker', projectTrackerRoutes);

// Health check
app.get('/health', async (_req, res) => {
  const storageMode = process.env.STORAGE_MODE || 'local';
  let s3Status = 'not configured';
  
  if (storageMode === 's3' && s3Storage.isS3Configured()) {
    try {
      const connected = await s3Storage.checkS3Connection();
      s3Status = connected ? 'connected' : 'disconnected';
    } catch (e) {
      s3Status = 'error';
    }
  }
  
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    storageMode,
    s3Status
  });
});

// Error handling
app.use(errorHandler);

// Start server
const PORT = config.PORT;

// Initialize database and start server
(async () => {
  try {
    const db = await connectDatabase();
    await seedDefaultUsers();
    
    // Initialize Project Tracker collections and indexes
    await initializeProjectTrackerDb(db);
    
    // Initialize S3 storage if configured
    const storageMode = process.env.STORAGE_MODE || 'local';
    if (storageMode === 's3' && s3Storage.isS3Configured()) {
      try {
        await s3Storage.initS3Storage();
        console.log('✅ S3 Storage initialized');
      } catch (e) {
        console.warn('⚠️ S3 Storage initialization failed:', e);
        console.warn('   Falling back to local/GridFS storage');
      }
    } else {
      console.log(`📦 Storage mode: ${storageMode}`);
    }
    
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

