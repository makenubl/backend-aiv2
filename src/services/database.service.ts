import { MongoClient, Db, Collection } from 'mongodb';

let mongoClient: MongoClient | null = null;
let database: Db | null = null;
let isConnecting = false;

interface User {
  _id?: string;
  username: string;
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'evaluator' | 'reviewer';
  createdAt?: Date;
  updatedAt?: Date;
}

interface StoredEvaluation {
  _id?: string;
  applicationId: string;
  evaluation: any;
  createdAt: Date;
  updatedAt: Date;
}

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pvara_ai_eval';
const DB_NAME = process.env.DB_NAME || 'pvara_ai_eval';
const USERS_COLLECTION = 'users';
const EVALUATIONS_COLLECTION = 'evaluations';

export const connectDatabase = async (): Promise<void> => {
  if (database) {
    console.log('📦 Already connected to MongoDB');
    return;
  }
  
  if (isConnecting) {
    console.log('⏳ Connection in progress, waiting...');
    // Wait for existing connection attempt
    await new Promise(resolve => setTimeout(resolve, 1000));
    return;
  }
  
  isConnecting = true;
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log('URI prefix:', MONGO_URI.substring(0, 30) + '...');
    
    mongoClient = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    
    await mongoClient.connect();
    database = mongoClient.db(DB_NAME);
    console.log(`✅ Connected to MongoDB: ${DB_NAME}`);
    
    // Create indexes (don't fail if they exist)
    try {
      const usersCollection = database.collection(USERS_COLLECTION);
      await usersCollection.createIndex({ username: 1 }, { unique: true });
      await usersCollection.createIndex({ email: 1 }, { unique: true });
      
      const evaluationsCollection = database.collection(EVALUATIONS_COLLECTION);
      await evaluationsCollection.createIndex({ applicationId: 1 }, { unique: true });
    } catch (indexError) {
      console.log('⚠️ Index creation skipped (may already exist)');
    }
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    mongoClient = null;
    database = null;
    throw error;
  } finally {
    isConnecting = false;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    database = null;
    console.log('❌ Disconnected from MongoDB');
  }
};

export const getDatabase = (): Db => {
  if (!database) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return database;
};

export const getUsersCollection = (): Collection<User> => {
  return getDatabase().collection(USERS_COLLECTION);
};

export const findUserByUsername = async (username: string): Promise<User | null> => {
  try {
    const collection = getUsersCollection();
    return await collection.findOne({ username });
  } catch (error) {
    console.error('Error finding user by username:', error);
    throw error;
  }
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
  const collection = getUsersCollection();
  return await collection.findOne({ email });
};

export const createUser = async (user: Omit<User, '_id'>): Promise<User> => {
  const collection = getUsersCollection();
  const result = await collection.insertOne({
    ...user,
    createdAt: new Date(),
    updatedAt: new Date()
  } as User);
  
  return {
    ...user,
    _id: result.insertedId.toString()
  };
};

export const seedDefaultUsers = async (): Promise<void> => {
  try {
    const collection = getUsersCollection();
    const count = await collection.countDocuments();
    
    if (count > 0) {
      console.log(`📦 Found ${count} users in database, skipping seed`);
      return;
    }

    const defaultUsers: Omit<User, '_id'>[] = [
      {
        username: 'admin@pvara.gov.pk',
        email: 'admin@pvara.gov.pk',
        password: 'pvara@ai',
        name: 'System Administrator',
        role: 'admin'
      },
      {
        username: 'evaluator',
        email: 'evaluator@pvara.gov.pk',
        password: 'eval123',
        name: 'PVARA Evaluator',
        role: 'evaluator'
      },
      {
        username: 'reviewer',
        email: 'reviewer@pvara.gov.pk',
        password: 'review123',
        name: 'Compliance Reviewer',
        role: 'reviewer'
      },
      {
        username: 'demo',
        email: 'demo@pvara.gov.pk',
        password: 'demo',
        name: 'Demo User',
        role: 'evaluator'
      }
    ];

    await collection.insertMany(
      defaultUsers.map(user => ({
        ...user,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
    console.log(`✅ Seeded ${defaultUsers.length} default users`);
  } catch (error: any) {
    if (error.code === 11000) {
      console.log('⚠️ Users already exist, skipping seed');
    } else {
      console.error('⚠️ Error seeding users:', error);
    }
  }
};

// Evaluations Collection Functions
export const getEvaluationsCollection = (): Collection<StoredEvaluation> => {
  return getDatabase().collection(EVALUATIONS_COLLECTION);
};

export const saveEvaluation = async (applicationId: string, evaluation: any): Promise<void> => {
  const collection = getEvaluationsCollection();
  await collection.updateOne(
    { applicationId },
    {
      $set: {
        applicationId,
        evaluation,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log(`💾 Saved evaluation to MongoDB for ${applicationId}`);
};

export const getEvaluation = async (applicationId: string): Promise<any | null> => {
  const collection = getEvaluationsCollection();
  const doc = await collection.findOne({ applicationId });
  return doc?.evaluation || null;
};

export const getAllEvaluations = async (): Promise<StoredEvaluation[]> => {
  const collection = getEvaluationsCollection();
  return await collection.find({}).toArray();
};

export default {
  connectDatabase,
  disconnectDatabase,
  getDatabase,
  getUsersCollection,
  findUserByUsername,
  findUserByEmail,
  createUser,
  seedDefaultUsers,
  getEvaluationsCollection,
  saveEvaluation,
  getEvaluation,
  getAllEvaluations
};
