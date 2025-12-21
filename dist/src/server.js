"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
require("express-async-errors");
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const auth_middleware_1 = require("./middleware/auth.middleware");
const database_service_1 = require("./services/database.service");
const s3Storage = __importStar(require("./services/s3-storage.service"));
const evaluation_routes_1 = __importDefault(require("./routes/evaluation.routes"));
const applications_routes_1 = __importDefault(require("./routes/applications.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const storage_routes_1 = __importDefault(require("./routes/storage.routes"));
const users_routes_1 = __importDefault(require("./routes/users.routes"));
// Project Tracker Module - routes
const projects_routes_1 = __importDefault(require("./routes/projects.routes"));
const vendor_portal_routes_1 = __importDefault(require("./routes/vendor-portal.routes"));
const project_tracker_routes_1 = __importDefault(require("./routes/project-tracker.routes"));
const project_tracker_db_service_1 = require("./services/project-tracker-db.service");
const app = (0, express_1.default)();
// Middleware
// Allow configured origins and any localhost/127.0.0.1 port in development
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
        if (!origin)
            return callback(null, true);
        const allowed = Array.isArray(config_1.config.CORS_ORIGIN) ? config_1.config.CORS_ORIGIN : [config_1.config.CORS_ORIGIN];
        const isListed = allowed.includes(origin);
        const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/i.test(origin);
        const isVercel = origin.includes('.vercel.app');
        const isPvaraTeam = origin.includes('pvara.team');
        if (isListed || isLocalhost || isVercel || isPvaraTeam)
            return callback(null, true);
        console.warn(`CORS: Origin not allowed: ${origin}`);
        return callback(new Error(`CORS: Origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-api-key', 'x-user-role', 'x-user-email'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 600 // Cache preflight for 10 minutes
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Auth routes (no API key required)
app.use('/api/auth', auth_routes_1.default);
// Vendor Portal routes (separate authentication, no API key)
// This allows vendors/external users to access without main system credentials
app.use('/api/portal', vendor_portal_routes_1.default);
// Ring-fenced: API key validation for other routes
app.use(auth_middleware_1.apiKeyMiddleware);
// Routes
app.use('/api/evaluation', evaluation_routes_1.default);
app.use('/api/applications', applications_routes_1.default);
app.use('/api/storage', storage_routes_1.default);
app.use('/api/users', users_routes_1.default);
// Project Tracker routes (requires API key authentication)
app.use('/api/projects', projects_routes_1.default);
// Project Tracker wizard routes (file upload, AI analysis, task management)
app.use('/api/project-tracker', project_tracker_routes_1.default);
// Health check
app.get('/health', async (_req, res) => {
    const storageMode = process.env.STORAGE_MODE || 'local';
    let s3Status = 'not configured';
    if (storageMode === 's3' && s3Storage.isS3Configured()) {
        try {
            const connected = await s3Storage.checkS3Connection();
            s3Status = connected ? 'connected' : 'disconnected';
        }
        catch (e) {
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
app.use(auth_middleware_1.errorHandler);
// Start server
const PORT = config_1.config.PORT;
// Initialize database and start server
(async () => {
    try {
        const db = await (0, database_service_1.connectDatabase)();
        await (0, database_service_1.seedDefaultUsers)();
        // Initialize Project Tracker collections and indexes
        await (0, project_tracker_db_service_1.initializeProjectTrackerDb)(db);
        // Initialize S3 storage if configured
        const storageMode = process.env.STORAGE_MODE || 'local';
        if (storageMode === 's3' && s3Storage.isS3Configured()) {
            try {
                await s3Storage.initS3Storage();
                console.log('✅ S3 Storage initialized');
            }
            catch (e) {
                console.warn('⚠️ S3 Storage initialization failed:', e);
                console.warn('   Falling back to local/GridFS storage');
            }
        }
        else {
            console.log(`📦 Storage mode: ${storageMode}`);
        }
        app.listen(PORT, () => {
            console.log(`✅ NOC Evaluator Backend running on port ${PORT}`);
            console.log(`Environment: ${config_1.config.NODE_ENV}`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
})();
exports.default = app;
//# sourceMappingURL=server.js.map