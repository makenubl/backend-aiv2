"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const app_1 = __importDefault(require("../src/app"));
const database_service_1 = require("../src/services/database.service");
let isInitialized = false;
async function handler(req, res) {
    // Initialize database once
    if (!isInitialized) {
        try {
            await (0, database_service_1.connectDatabase)();
            await (0, database_service_1.seedDefaultUsers)();
            isInitialized = true;
            console.log('✅ Database initialized');
        }
        catch (error) {
            console.error('❌ Database init failed:', error);
        }
    }
    // Handle the request
    return (0, app_1.default)(req, res);
}
//# sourceMappingURL=index.js.map