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
exports.generateRecommendationsForUpload = generateRecommendationsForUpload;
exports.acceptOrRejectRecommendations = acceptOrRejectRecommendations;
exports.listRecommendations = listRecommendations;
const fs = __importStar(require("fs"));
const uuid_1 = require("uuid");
const document_analyzer_service_1 = require("./document-analyzer.service");
const database_service_1 = require("./database.service");
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
async function readFileText(filePath) {
    try {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.pdf')) {
            const data = await (0, pdf_parse_1.default)(fs.readFileSync(filePath));
            return data.text || '';
        }
        if (lower.endsWith('.docx')) {
            const result = await mammoth_1.default.extractRawText({ path: filePath });
            return result.value || '';
        }
        // Fallback to plain text
        return fs.readFileSync(filePath, 'utf-8');
    }
    catch {
        return '';
    }
}
async function generateRecommendationsForUpload(applicationId, documentPath, documentName) {
    const trails = await (0, database_service_1.getRecommendationsTrail)(applicationId, documentName);
    const nextVersion = (trails[trails.length - 1]?.version || 0) + 1;
    const extract = await readFileText(documentPath);
    // Use AI categorization signals to craft recommendation points
    let points = [];
    try {
        const companyName = applicationId;
        const aiCat = await document_analyzer_service_1.documentAnalyzerService.categorizeDocumentWithAI(applicationId, companyName, documentPath, documentName);
        points = [
            `Ensure ${aiCat.category} - ${aiCat.subcategory} documentation complies with standards`,
            `Add missing references or sections related to ${aiCat.category}`
        ];
    }
    catch {
        // Fallback generic suggestions
        points = [
            'Clarify scope and objectives',
            'Provide references to applicable regulations',
            'Add version and change history in the document'
        ];
    }
    const recommendations = points.map(p => ({ id: (0, uuid_1.v4)(), point: p, status: 'pending', createdAt: new Date() }));
    await (0, database_service_1.saveRecommendationsVersion)(applicationId, documentName, nextVersion, recommendations, extract);
    return { version: nextVersion, recommendations, extract };
}
async function acceptOrRejectRecommendations(applicationId, documentName, version, acceptIds, rejectIds) {
    if (acceptIds?.length) {
        await (0, database_service_1.updateRecommendationStatus)(applicationId, documentName, version, acceptIds, 'accepted');
    }
    if (rejectIds?.length) {
        await (0, database_service_1.updateRecommendationStatus)(applicationId, documentName, version, rejectIds, 'rejected');
    }
}
async function listRecommendations(applicationId, documentName) {
    return await (0, database_service_1.getRecommendationsTrail)(applicationId, documentName);
}
//# sourceMappingURL=recommendations.service.js.map