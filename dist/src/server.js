"use strict";
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
const evaluation_routes_1 = __importDefault(require("./routes/evaluation.routes"));
const applications_routes_1 = __importDefault(require("./routes/applications.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const storage_routes_1 = __importDefault(require("./routes/storage.routes"));
const app = (0, express_1.default)();
// Middleware
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        const allowed = Array.isArray(config_1.config.CORS_ORIGIN) ? config_1.config.CORS_ORIGIN : [config_1.config.CORS_ORIGIN];
        const isListed = allowed.includes(origin);
        const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/i.test(origin);
        const isVercel = origin.includes('.vercel.app');
        const isRender = origin.includes('.onrender.com');
        const isRailway = origin.includes('.railway.app');
        const isPvaraDomain = origin && (origin.includes('pvara.team') || origin.includes('pvara.gov.pk'));
        if (isListed || isLocalhost || isVercel || isRender || isRailway || isPvaraDomain)
            return callback(null, true);
        console.warn(`CORS: Origin not allowed: ${origin}`);
        return callback(new Error(`CORS: Origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-api-key'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 600
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Health check (before any auth)
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date(),
        mongoUri: process.env.MONGODB_URI ? 'SET' : 'NOT SET',
        nodeEnv: process.env.NODE_ENV || 'not set'
    });
});
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date(),
        mongoUri: process.env.MONGODB_URI ? 'SET' : 'NOT SET',
        nodeEnv: process.env.NODE_ENV || 'not set'
    });
});
// Auth routes (no API key required)
app.use('/api/auth', auth_routes_1.default);
// Ring-fenced: API key validation for other routes
app.use(auth_middleware_1.apiKeyMiddleware);
// Routes
app.use('/api/evaluation', evaluation_routes_1.default);
app.use('/api/applications', applications_routes_1.default);
app.use('/api/storage', storage_routes_1.default);
// Error handling
app.use(auth_middleware_1.errorHandler);
// Start server
const PORT = process.env.PORT || config_1.config.PORT || 3001;
// Initialize database and start server
(async () => {
    try {
        await (0, database_service_1.connectDatabase)();
        await (0, database_service_1.seedDefaultUsers)();
        app.listen(PORT, () => {
            console.log(`✅ NOC Evaluator Backend running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
})();
exports.default = app;
//# sourceMappingURL=server.js.map