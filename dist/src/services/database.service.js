"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllEvaluations = exports.getEvaluation = exports.saveEvaluation = exports.getEvaluationsCollection = exports.seedDefaultUsers = exports.createUser = exports.findUserByEmail = exports.findUserByUsername = exports.getUsersCollection = exports.disconnectDatabase = exports.connectDatabase = void 0;
const mongodb_1 = require("mongodb");
let mongoClient;
let database;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'pvara_ai_eval';
const USERS_COLLECTION = 'users';
const EVALUATIONS_COLLECTION = 'evaluations';
const connectDatabase = async () => {
    try {
        mongoClient = new mongodb_1.MongoClient(MONGO_URI);
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
    }
    catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error);
        throw error;
    }
};
exports.connectDatabase = connectDatabase;
const disconnectDatabase = async () => {
    if (mongoClient) {
        await mongoClient.close();
        console.log('❌ Disconnected from MongoDB');
    }
};
exports.disconnectDatabase = disconnectDatabase;
const getUsersCollection = () => {
    if (!database) {
        throw new Error('Database not connected');
    }
    return database.collection(USERS_COLLECTION);
};
exports.getUsersCollection = getUsersCollection;
const findUserByUsername = async (username) => {
    const collection = (0, exports.getUsersCollection)();
    return await collection.findOne({ username });
};
exports.findUserByUsername = findUserByUsername;
const findUserByEmail = async (email) => {
    const collection = (0, exports.getUsersCollection)();
    return await collection.findOne({ email });
};
exports.findUserByEmail = findUserByEmail;
const createUser = async (user) => {
    const collection = (0, exports.getUsersCollection)();
    const result = await collection.insertOne({
        ...user,
        createdAt: new Date(),
        updatedAt: new Date()
    });
    return {
        ...user,
        _id: result.insertedId.toString()
    };
};
exports.createUser = createUser;
const seedDefaultUsers = async () => {
    const collection = (0, exports.getUsersCollection)();
    const count = await collection.countDocuments();
    if (count > 0) {
        console.log('📦 Users already exist in database, skipping seed');
        return;
    }
    const defaultUsers = [
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
        await collection.insertMany(defaultUsers.map(user => ({
            ...user,
            createdAt: new Date(),
            updatedAt: new Date()
        })));
        console.log(`✅ Seeded ${defaultUsers.length} default users`);
    }
    catch (error) {
        console.error('⚠️ Error seeding users (may already exist):', error);
    }
};
exports.seedDefaultUsers = seedDefaultUsers;
// Evaluations Collection Functions
const getEvaluationsCollection = () => {
    if (!database) {
        throw new Error('Database not connected');
    }
    return database.collection(EVALUATIONS_COLLECTION);
};
exports.getEvaluationsCollection = getEvaluationsCollection;
const saveEvaluation = async (applicationId, evaluation) => {
    const collection = (0, exports.getEvaluationsCollection)();
    await collection.updateOne({ applicationId }, {
        $set: {
            applicationId,
            evaluation,
            updatedAt: new Date()
        },
        $setOnInsert: {
            createdAt: new Date()
        }
    }, { upsert: true });
    console.log(`💾 Saved evaluation to MongoDB for ${applicationId}`);
};
exports.saveEvaluation = saveEvaluation;
const getEvaluation = async (applicationId) => {
    const collection = (0, exports.getEvaluationsCollection)();
    const doc = await collection.findOne({ applicationId });
    return doc?.evaluation || null;
};
exports.getEvaluation = getEvaluation;
const getAllEvaluations = async () => {
    const collection = (0, exports.getEvaluationsCollection)();
    return await collection.find({}).toArray();
};
exports.getAllEvaluations = getAllEvaluations;
exports.default = {
    connectDatabase: exports.connectDatabase,
    disconnectDatabase: exports.disconnectDatabase,
    getUsersCollection: exports.getUsersCollection,
    findUserByUsername: exports.findUserByUsername,
    findUserByEmail: exports.findUserByEmail,
    createUser: exports.createUser,
    seedDefaultUsers: exports.seedDefaultUsers,
    getEvaluationsCollection: exports.getEvaluationsCollection,
    saveEvaluation: exports.saveEvaluation,
    getEvaluation: exports.getEvaluation,
    getAllEvaluations: exports.getAllEvaluations
};
//# sourceMappingURL=database.service.js.map