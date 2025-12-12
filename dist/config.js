"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    PORT: process.env.PORT || 3001,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    NODE_ENV: process.env.NODE_ENV || 'development',
    // Allow multiple comma-separated origins for local dev convenience (3000/3001/3002)
    CORS_ORIGIN: (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001,http://localhost:3002')
        .split(',')
        .map(origin => origin.trim()),
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_FILE_TYPES: ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};
if (!exports.config.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not set. Please configure it in .env file');
}
//# sourceMappingURL=config.js.map