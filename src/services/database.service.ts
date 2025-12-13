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

interface AccessGrant {
  _id?: string;
  applicationId: string;
  email: string;
  role: 'viewer' | 'editor' | 'admin';
  permissions: Array<'view' | 'edit' | 'delete'>;
  invitedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatMessage {
  _id?: string;
  applicationId: string;
  documentName?: string;
  role: 'user' | 'assistant';
  message: string;
  recommendationIds?: string[];
  actions?: Array<{ type: 'accept' | 'reject'; ids: string[] }>;
  createdAt: Date;
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
const ACCESS_COLLECTION = 'storage_access';
const CHAT_COLLECTION = 'storage_chat';

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

    // Access control indexes
    const accessCollection = database.collection(ACCESS_COLLECTION);
    await accessCollection.createIndex({ applicationId: 1, email: 1 }, { unique: true });

    // Chat indexes
    const chatCollection = database.collection(CHAT_COLLECTION);
    await chatCollection.createIndex({ applicationId: 1, documentName: 1, createdAt: -1 });
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

export const getAccessCollection = (): Collection<AccessGrant> => {
  if (!database) {
    throw new Error('Database not connected');
  }
  return database.collection(ACCESS_COLLECTION);
};

export const getChatCollection = (): Collection<ChatMessage> => {
  if (!database) {
    throw new Error('Database not connected');
  }
  return database.collection(CHAT_COLLECTION);
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

// Access control helpers
export const upsertAccessGrant = async (
  applicationId: string,
  email: string,
  role: AccessGrant['role'],
  permissions: AccessGrant['permissions'],
  invitedBy?: string
): Promise<void> => {
  const collection = getAccessCollection();
  await collection.updateOne(
    { applicationId, email },
    {
      $set: {
        applicationId,
        email,
        role,
        permissions,
        invitedBy,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      }
    },
    { upsert: true }
  );
};

export const listAccessGrants = async (applicationId: string): Promise<AccessGrant[]> => {
  const collection = getAccessCollection();
  return collection.find({ applicationId }).sort({ createdAt: 1 }).toArray();
};

export const removeAccessGrant = async (applicationId: string, email: string): Promise<void> => {
  const collection = getAccessCollection();
  await collection.deleteOne({ applicationId, email });
};

export const hasAccess = async (
  applicationId: string,
  email: string | undefined,
  required: 'view' | 'edit' | 'delete'
): Promise<boolean> => {
  const collection = getAccessCollection();
  const record = await collection.findOne({ applicationId, email });
  if (!record) return false;
  if (record.role === 'admin') return true;
  return record.permissions.includes(required);
};

// Chat helpers
export const insertChatMessage = async (
  applicationId: string,
  documentName: string | undefined,
  role: ChatMessage['role'],
  message: string,
  recommendationIds?: string[],
  actions?: ChatMessage['actions']
): Promise<void> => {
  const collection = getChatCollection();
  await collection.insertOne({
    applicationId,
    documentName,
    role,
    message,
    recommendationIds,
    actions,
    createdAt: new Date()
  } as ChatMessage);
};

export const listChatMessages = async (
  applicationId: string,
  documentName?: string,
  limit = 20
): Promise<ChatMessage[]> => {
  const collection = getChatCollection();
  const query: Record<string, any> = { applicationId };
  if (documentName) query.documentName = documentName;
  return collection
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()
    .then(list => list.reverse());
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
  ,getAccessCollection
  ,upsertAccessGrant
  ,listAccessGrants
  ,removeAccessGrant
  ,hasAccess
  ,getChatCollection
  ,insertChatMessage
  ,listChatMessages
};
