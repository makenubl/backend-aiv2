import app from '../src/server';
import { connectDatabase, seedDefaultUsers } from '../src/services/database.service';

// Initialize database connection (only once per cold start)
let isInitialized = false;

const initializeDatabase = async () => {
  if (!isInitialized) {
    try {
      await connectDatabase();
      await seedDefaultUsers();
      isInitialized = true;
      console.log('✅ Database initialized for serverless function');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }
};

// Serverless function handler
export default async (req: any, res: any) => {
  try {
    await initializeDatabase();
    return app(req, res);
  } catch (error) {
    console.error('Serverless function error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
