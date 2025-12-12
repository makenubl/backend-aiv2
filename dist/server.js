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
const evaluation_routes_1 = __importDefault(require("./routes/evaluation.routes"));
const applications_routes_1 = __importDefault(require("./routes/applications.routes"));
const app = (0, express_1.default)();
// Middleware
app.use((0, cors_1.default)({ origin: config_1.config.CORS_ORIGIN }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Ring-fenced: API key validation
app.use(auth_middleware_1.apiKeyMiddleware);
// Routes
app.use('/api/evaluation', evaluation_routes_1.default);
app.use('/api/applications', applications_routes_1.default);
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});
// Error handling
app.use(auth_middleware_1.errorHandler);
// Start server
const PORT = config_1.config.PORT;
app.listen(PORT, () => {
    console.log(`✅ NOC Evaluator Backend running on port ${PORT}`);
    console.log(`Environment: ${config_1.config.NODE_ENV}`);
});
exports.default = app;
//# sourceMappingURL=server.js.map