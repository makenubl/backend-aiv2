import app from '../src/app';
import { connectDatabase, seedDefaultUsers } from '../src/services/database.service';

let isInitialized = false;

export default async function handler(req: any, res: any) {
  // Initialize database once
  if (!isInitialized) {
    try {
      await connectDatabase();
      await seedDefaultUsers();
      isInitialized = true;
      console.log('✅ Database initialized');
    } catch (error) {
      console.error('❌ Database init failed:', error);
    }
  }
  
  // Handle the request
  return app(req, res);
}
