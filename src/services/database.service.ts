import { MongoClient, Db, Collection } from 'mongodb';

let mongoClient: MongoClient;
let database: Db;

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

interface RecommendationItem {
  id: string;
  point: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
  updatedAt?: Date;
}

interface DocumentRecommendationTrail {
  _id?: string;
  applicationId: string; // folder name
  documentName: string;
  version: number; // increments with each upload/update
  recommendations: RecommendationItem[];
  originalExtract?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'pvara_ai_eval';
const USERS_COLLECTION = 'users';
const EVALUATIONS_COLLECTION = 'evaluations';
const RECOMMENDATIONS_COLLECTION = 'recommendations';

export const connectDatabase = async (): Promise<void> => {
  try {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    database = mongoClient.db(DB_NAME);
    console.log(`✅ Connected to MongoDB: ${DB_NAME}`);
    
    // Create indexes
    const usersCollection = database.collection(USERS_COLLECTION);
    await usersCollection.createIndex({ username: 1 }, { unique: true });
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    
    // Create evaluations index
    const evaluationsCollection = database.collection(EVALUATIONS_COLLECTION);
    await evaluationsCollection.createIndex({ applicationId: 1 }, { unique: true });

    // Recommendations indexes
    const recommendationsCollection = database.collection(RECOMMENDATIONS_COLLECTION);
    await recommendationsCollection.createIndex({ applicationId: 1, documentName: 1, version: 1 }, { unique: true });
    await recommendationsCollection.createIndex({ applicationId: 1 });
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoClient) {
    await mongoClient.close();
    console.log('❌ Disconnected from MongoDB');
  }
};

export const getUsersCollection = (): Collection<User> => {
  if (!database) {
    throw new Error('Database not connected');
  }
  return database.collection(USERS_COLLECTION);
};

export const findUserByUsername = async (username: string): Promise<User | null> => {
  const collection = getUsersCollection();
  return await collection.findOne({ username });
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
  const collection = getUsersCollection();
  const count = await collection.countDocuments();
  
  if (count > 0) {
    console.log('📦 Users already exist in database, skipping seed');
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

  try {
    await collection.insertMany(
      defaultUsers.map(user => ({
        ...user,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
    console.log(`✅ Seeded ${defaultUsers.length} default users`);
  } catch (error) {
    console.error('⚠️ Error seeding users (may already exist):', error);
  }
};

// Evaluations Collection Functions
export const getEvaluationsCollection = (): Collection<StoredEvaluation> => {
  if (!database) {
    throw new Error('Database not connected');
  }
  return database.collection(EVALUATIONS_COLLECTION);
};

export const getRecommendationsCollection = (): Collection<DocumentRecommendationTrail> => {
  if (!database) {
    throw new Error('Database not connected');
  }
  return database.collection(RECOMMENDATIONS_COLLECTION);
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

// Recommendation trail functions
export const saveRecommendationsVersion = async (
  applicationId: string,
  documentName: string,
  version: number,
  recommendations: RecommendationItem[],
  originalExtract?: string
): Promise<void> => {
  const collection = getRecommendationsCollection();
  await collection.updateOne(
    { applicationId, documentName, version },
    {
      $set: {
        applicationId,
        documentName,
        version,
        recommendations,
        originalExtract,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
};

export const getRecommendationsTrail = async (
  applicationId: string,
  documentName?: string
): Promise<DocumentRecommendationTrail[]> => {
  const collection = getRecommendationsCollection();
  const query: any = { applicationId };
  if (documentName) query.documentName = documentName;
  return await collection.find(query).sort({ version: 1 }).toArray();
};

export const updateRecommendationStatus = async (
  applicationId: string,
  documentName: string,
  version: number,
  ids: string[],
  status: 'accepted' | 'rejected'
): Promise<void> => {
  const collection = getRecommendationsCollection();
  await collection.updateOne(
    { applicationId, documentName, version },
    {
      $set: {
        'recommendations.$[r].status': status,
        'recommendations.$[r].updatedAt': new Date()
      }
    },
    {
      arrayFilters: [ { 'r.id': { $in: ids } } ]
    }
  );
};

export default {
  connectDatabase,
  disconnectDatabase,
  getUsersCollection,
  findUserByUsername,
  findUserByEmail,
  createUser,
  seedDefaultUsers,
  getEvaluationsCollection,
  saveEvaluation,
  getEvaluation,
  getAllEvaluations
  ,getRecommendationsCollection
  ,saveRecommendationsVersion
  ,getRecommendationsTrail
  ,updateRecommendationStatus
};
