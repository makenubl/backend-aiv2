"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("../src/app"));
const database_service_1 = require("../src/services/database.service");
// Initialize database connection (only once per cold start)
let isInitialized = false;
const initializeDatabase = async () => {
    if (isInitialized)
        return;
    try {
        console.log('🔄 Initializing database connection...');
        console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);
        await (0, database_service_1.connectDatabase)();
        await (0, database_service_1.seedDefaultUsers)();
        isInitialized = true;
        console.log('✅ Database initialized for serverless function');
    }
    catch (error) {
        console.error('❌ Failed to initialize database:', error);
        // Don't throw - let the app handle errors gracefully
    }
};
// Serverless function handler
exports.default = async (req, res) => {
    try {
        await initializeDatabase();
        return (0, app_1.default)(req, res);
    }
    catch (error) {
        console.error('Serverless function error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error?.message || 'Unknown error',
            mongoUri: process.env.MONGODB_URI ? 'SET' : 'NOT SET'
        });
    }
};
//# sourceMappingURL=index.js.map