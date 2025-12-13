"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChatMessages = exports.insertChatMessage = exports.hasAccess = exports.removeAccessGrant = exports.listAccessGrants = exports.upsertAccessGrant = exports.updateRecommendationStatus = exports.getRecommendationsTrail = exports.saveRecommendationsVersion = exports.getAllEvaluations = exports.getEvaluation = exports.saveEvaluation = exports.getChatCollection = exports.getAccessCollection = exports.getRecommendationsCollection = exports.getEvaluationsCollection = exports.seedDefaultUsers = exports.createUser = exports.findUserByEmail = exports.findUserByUsername = exports.getUsersCollection = exports.disconnectDatabase = exports.connectDatabase = void 0;
const mongodb_1 = require("mongodb");
let mongoClient;
let database;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'pvara_ai_eval';
const USERS_COLLECTION = 'users';
const EVALUATIONS_COLLECTION = 'evaluations';
const RECOMMENDATIONS_COLLECTION = 'recommendations';
const ACCESS_COLLECTION = 'storage_access';
const CHAT_COLLECTION = 'storage_chat';
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
const getRecommendationsCollection = () => {
    if (!database) {
        throw new Error('Database not connected');
    }
    return database.collection(RECOMMENDATIONS_COLLECTION);
};
exports.getRecommendationsCollection = getRecommendationsCollection;
const getAccessCollection = () => {
    if (!database) {
        throw new Error('Database not connected');
    }
    return database.collection(ACCESS_COLLECTION);
};
exports.getAccessCollection = getAccessCollection;
const getChatCollection = () => {
    if (!database) {
        throw new Error('Database not connected');
    }
    return database.collection(CHAT_COLLECTION);
};
exports.getChatCollection = getChatCollection;
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
// Recommendation trail functions
const saveRecommendationsVersion = async (applicationId, documentName, version, recommendations, originalExtract) => {
    const collection = (0, exports.getRecommendationsCollection)();
    await collection.updateOne({ applicationId, documentName, version }, {
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
    }, { upsert: true });
};
exports.saveRecommendationsVersion = saveRecommendationsVersion;
const getRecommendationsTrail = async (applicationId, documentName) => {
    const collection = (0, exports.getRecommendationsCollection)();
    const query = { applicationId };
    if (documentName)
        query.documentName = documentName;
    return await collection.find(query).sort({ version: 1 }).toArray();
};
exports.getRecommendationsTrail = getRecommendationsTrail;
const updateRecommendationStatus = async (applicationId, documentName, version, ids, status) => {
    const collection = (0, exports.getRecommendationsCollection)();
    await collection.updateOne({ applicationId, documentName, version }, {
        $set: {
            'recommendations.$[r].status': status,
            'recommendations.$[r].updatedAt': new Date()
        }
    }, {
        arrayFilters: [{ 'r.id': { $in: ids } }]
    });
};
exports.updateRecommendationStatus = updateRecommendationStatus;
// Access control helpers
const upsertAccessGrant = async (applicationId, email, role, permissions, invitedBy) => {
    const collection = (0, exports.getAccessCollection)();
    await collection.updateOne({ applicationId, email }, {
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
    }, { upsert: true });
};
exports.upsertAccessGrant = upsertAccessGrant;
const listAccessGrants = async (applicationId) => {
    const collection = (0, exports.getAccessCollection)();
    return collection.find({ applicationId }).sort({ createdAt: 1 }).toArray();
};
exports.listAccessGrants = listAccessGrants;
const removeAccessGrant = async (applicationId, email) => {
    const collection = (0, exports.getAccessCollection)();
    await collection.deleteOne({ applicationId, email });
};
exports.removeAccessGrant = removeAccessGrant;
const hasAccess = async (applicationId, email, required) => {
    const collection = (0, exports.getAccessCollection)();
    const record = await collection.findOne({ applicationId, email });
    if (!record)
        return false;
    if (record.role === 'admin')
        return true;
    return record.permissions.includes(required);
};
exports.hasAccess = hasAccess;
// Chat helpers
const insertChatMessage = async (applicationId, documentName, role, message, recommendationIds, actions) => {
    const collection = (0, exports.getChatCollection)();
    await collection.insertOne({
        applicationId,
        documentName,
        role,
        message,
        recommendationIds,
        actions,
        createdAt: new Date()
    });
};
exports.insertChatMessage = insertChatMessage;
const listChatMessages = async (applicationId, documentName, limit = 20) => {
    const collection = (0, exports.getChatCollection)();
    const query = { applicationId };
    if (documentName)
        query.documentName = documentName;
    return collection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
        .then(list => list.reverse());
};
exports.listChatMessages = listChatMessages;
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
    getAllEvaluations: exports.getAllEvaluations,
    getRecommendationsCollection: exports.getRecommendationsCollection,
    saveRecommendationsVersion: exports.saveRecommendationsVersion,
    getRecommendationsTrail: exports.getRecommendationsTrail,
    updateRecommendationStatus: exports.updateRecommendationStatus,
    getAccessCollection: exports.getAccessCollection,
    upsertAccessGrant: exports.upsertAccessGrant,
    listAccessGrants: exports.listAccessGrants,
    removeAccessGrant: exports.removeAccessGrant,
    hasAccess: exports.hasAccess,
    getChatCollection: exports.getChatCollection,
    insertChatMessage: exports.insertChatMessage,
    listChatMessages: exports.listChatMessages
};
//# sourceMappingURL=database.service.js.map