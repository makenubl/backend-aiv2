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
const config_1 = require("../config");
const openai_request_manager_1 = require("./openai-request-manager");
const database_service_1 = require("./database.service");
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
// Use new OpenAI Responses API (gpt-5.1)
async function callOpenAIResponses(input, options, metadata) {
    const url = 'https://api.openai.com/v1/responses';
    const body = {
        model: config_1.config.OPENAI_MODEL || 'gpt-5.1',
        input,
    };
    if (options?.reasoning) {
        body.reasoning = { effort: 'low' };
    }
    const inputLength = typeof input === 'string' ? input.length : JSON.stringify(input).length;
    console.log(`🤖 [OpenAI-Recommendations] Starting request - Model: ${body.model}, Input: ${inputLength} chars`);
    return openai_request_manager_1.openAIRequestManager.execute({
        tenantId: metadata?.tenantId,
        requestName: metadata?.requestName || 'recommendations.callOpenAIResponses',
        promptSnippet: input,
        cacheKey: metadata?.cacheKey ||
            openai_request_manager_1.openAIRequestManager.buildCacheKey('recommendations.callOpenAIResponses', input.length, options?.reasoning),
        operation: async () => {
            const startedAt = Date.now();
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config_1.config.OPENAI_API_KEY}`
                },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const error = await response.text();
                console.error(`❌ [OpenAI-Recommendations] Error after ${Date.now() - startedAt}ms:`, error);
                throw new Error(`OpenAI API error: ${response.statusText}`);
            }
            const data = await response.json();
            const totalTime = Date.now() - startedAt;
            console.log(`✅ [OpenAI-Recommendations] Response received - Status: ${data.status}, Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
            if (data.output && Array.isArray(data.output)) {
                for (const item of data.output) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                        for (const contentItem of item.content) {
                            if (contentItem.type === 'output_text' && contentItem.text) {
                                console.log(`📊 [OpenAI-Recommendations] Output: ${contentItem.text.length} chars`);
                                return { value: contentItem.text, usage: data.usage };
                            }
                        }
                    }
                }
            }
            return { value: '', usage: data.usage };
        }
    });
}
async function readFileText(filePath) {
    try {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.pdf')) {
            const buffer = fs.readFileSync(filePath);
            // Add timeout for PDF parsing
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('PDF parsing timeout')), 10000));
            const parsePromise = (0, pdf_parse_1.default)(buffer).then(data => data.text || '');
            return await Promise.race([parsePromise, timeoutPromise]);
        }
        if (lower.endsWith('.docx')) {
            const result = await mammoth_1.default.extractRawText({ path: filePath });
            return result.value || '';
        }
        // Fallback to plain text
        return fs.readFileSync(filePath, 'utf-8');
    }
    catch (err) {
        console.error('Error reading file:', err);
        return '';
    }
}
async function generateAIRecommendations(documentName, documentContent, folderName) {
    // No truncation needed with gpt-5.1 - it handles full documents
    const truncatedContent = documentContent;
    if (!truncatedContent.trim()) {
        return [
            'Document content could not be extracted - please verify the file format',
            'Consider uploading a text-based version of this document'
        ];
    }
    const systemPrompt = `You are an expert regulatory compliance analyst specializing in software licensing, NOC (No Objection Certificate) applications, and regulatory documentation for fintech and virtual asset service providers.

Your task is to analyze the uploaded document and provide specific, actionable recommendations for compliance and completeness.

Focus on:
1. Missing required sections or information
2. Regulatory compliance gaps
3. Document formatting and structure issues
4. Clarity and completeness of statements
5. References to applicable laws/regulations that should be included
6. Risk areas that need attention
7. Best practices that should be followed

Provide 3-7 specific, actionable recommendations. Each recommendation should be:
- Specific to the document content
- Actionable (what exactly needs to be done)
- Clear about why it matters for compliance

Do NOT provide generic advice - analyze THIS specific document.`;
    const userPrompt = `Analyze this document from folder "${folderName}" named "${documentName}":

---DOCUMENT START---
${truncatedContent}
---DOCUMENT END---

Provide your recommendations as a JSON array of strings. Example format:
["Recommendation 1", "Recommendation 2", "Recommendation 3"]

Only return the JSON array, nothing else.`;
    try {
        console.log(`🤖 Generating AI recommendations for: ${documentName}`);
        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
        const responseText = await callOpenAIResponses(fullPrompt, { reasoning: true }, {
            tenantId: folderName,
            cacheKey: openai_request_manager_1.openAIRequestManager.buildCacheKey('recommendations.generateAI', folderName, documentName, truncatedContent.length),
            requestName: 'recommendations.generateAI',
        });
        console.log(`✅ AI response received for: ${documentName}`);
        // Parse JSON array from response
        try {
            // Handle markdown code blocks if present
            let jsonText = responseText.trim();
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            }
            const recommendations = JSON.parse(jsonText);
            if (Array.isArray(recommendations) && recommendations.length > 0) {
                return recommendations.filter((r) => typeof r === 'string' && r.trim());
            }
        }
        catch (parseError) {
            console.error('Failed to parse AI recommendations JSON:', parseError);
            // Try to extract recommendations from text if JSON parsing fails
            const lines = responseText.split('\n').filter(l => l.trim().startsWith('-') || l.trim().match(/^\d+\./));
            if (lines.length > 0) {
                return lines.map(l => l.replace(/^[-\d.)\s]+/, '').trim()).filter(l => l);
            }
        }
    }
    catch (error) {
        console.error('OpenAI API error:', error?.message);
    }
    // Fallback recommendations if AI fails
    return [
        `Review ${documentName} for completeness and regulatory compliance`,
        'Ensure all required sections are present and properly formatted',
        'Verify references to applicable regulations are up to date'
    ];
}
async function generateRecommendationsForUpload(applicationId, documentPath, documentName) {
    const trails = await (0, database_service_1.getRecommendationsTrail)(applicationId, documentName);
    const nextVersion = (trails[trails.length - 1]?.version || 0) + 1;
    console.log(`📄 Processing document: ${documentName} for folder: ${applicationId}`);
    const extract = await readFileText(documentPath);
    console.log(`📝 Extracted ${extract.length} characters from document`);
    // Generate AI-powered recommendations based on actual file content
    const points = await generateAIRecommendations(documentName, extract, applicationId);
    console.log(`💡 Generated ${points.length} recommendations`);
    const recommendations = points.map(p => ({
        id: (0, uuid_1.v4)(),
        point: p,
        status: 'pending',
        createdAt: new Date()
    }));
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