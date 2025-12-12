import app from '../src/app';
import { connectDatabase, seedDefaultUsers } from '../src/services/database.service';

// Initialize database connection (only once per cold start)
let isInitialized = false;

const initializeDatabase = async () => {
  if (isInitialized) return;
  
  try {
    console.log('🔄 Initializing database connection...');
    console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);
    await connectDatabase();
    await seedDefaultUsers();
    isInitialized = true;
    console.log('✅ Database initialized for serverless function');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    // Don't throw - let the app handle errors gracefully
  }
};

// Serverless function handler
export default async (req: any, res: any) => {
  try {
    await initializeDatabase();
    return app(req, res);
  } catch (error: any) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error?.message || 'Unknown error',
      mongoUri: process.env.MONGODB_URI ? 'SET' : 'NOT SET'
    });
  }
};
