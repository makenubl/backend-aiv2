"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentAnalyzerService = void 0;
const openai_1 = require("openai");
const config_1 = require("../config");
const openai_service_1 = require("./openai.service");
const openai_request_manager_1 = require("./openai-request-manager");
const REQUIRED_CATEGORIES = [
    'corporate', // Certificate of incorporation, MOA, etc.
    'compliance', // AML, KYC policies
    'financial', // Financial statements, projections
    'regulatory', // Licenses, regulatory approvals
    'personnel', // A3 forms, director documents
    'legal' // Board resolutions, legal agreements
];
const DOCUMENT_PATTERNS = [
    // Corporate documents
    { pattern: /certificate.*incorporation|ci[-_]|coi[-_]/i, category: 'corporate', subcategory: 'Certificate of Incorporation' },
    { pattern: /moa|memorandum.*association|constitutive/i, category: 'corporate', subcategory: 'Memorandum of Association' },
    { pattern: /aoa|articles.*association/i, category: 'corporate', subcategory: 'Articles of Association' },
    { pattern: /apostille/i, category: 'corporate', subcategory: 'Apostille Certification' },
    { pattern: /notari|certified/i, category: 'corporate', subcategory: 'Notarized Document' },
    { pattern: /rom|register.*members/i, category: 'corporate', subcategory: 'Register of Members' },
    { pattern: /robo|beneficial.*owner/i, category: 'corporate', subcategory: 'Register of Beneficial Owners' },
    // Compliance documents
    { pattern: /aml|anti[-_\s]?money|laundering/i, category: 'compliance', subcategory: 'AML Policy' },
    { pattern: /kyc|know.*customer/i, category: 'compliance', subcategory: 'KYC Policy' },
    { pattern: /kyb|know.*business/i, category: 'compliance', subcategory: 'KYB Policy' },
    { pattern: /edd|enhanced.*diligence/i, category: 'compliance', subcategory: 'Enhanced Due Diligence' },
    { pattern: /sanction/i, category: 'compliance', subcategory: 'Sanctions Policy' },
    { pattern: /transaction.*monitor|tm[-_]|tmo/i, category: 'compliance', subcategory: 'Transaction Monitoring' },
    { pattern: /mlro|reporting.*officer/i, category: 'compliance', subcategory: 'MLRO Documentation' },
    { pattern: /record[-_\s]?keep/i, category: 'compliance', subcategory: 'Record Keeping Policy' },
    { pattern: /training.*policy|compliance.*training/i, category: 'compliance', subcategory: 'Compliance Training' },
    // Financial documents
    { pattern: /financial.*statement|fs[-_]/i, category: 'financial', subcategory: 'Financial Statements' },
    { pattern: /audit|audited/i, category: 'financial', subcategory: 'Audit Report' },
    { pattern: /projection|forecast/i, category: 'financial', subcategory: 'Financial Projections' },
    // Technical documents
    { pattern: /tech.*arch|infrastructure/i, category: 'technical', subcategory: 'Technical Architecture' },
    { pattern: /bcms|business.*continuity/i, category: 'technical', subcategory: 'Business Continuity' },
    { pattern: /bcp|continuity.*plan/i, category: 'technical', subcategory: 'Business Continuity Plan' },
    { pattern: /outsourc/i, category: 'technical', subcategory: 'Outsourcing' },
    { pattern: /risk.*assessment|ewra|era/i, category: 'technical', subcategory: 'Risk Assessment' },
    // Regulatory documents
    { pattern: /license|licence|permit/i, category: 'regulatory', subcategory: 'License' },
    { pattern: /sbp|state.*bank/i, category: 'regulatory', subcategory: 'SBP Documentation' },
    { pattern: /secp/i, category: 'regulatory', subcategory: 'SECP Documentation' },
    { pattern: /moit|ministry.*it/i, category: 'regulatory', subcategory: 'MoIT Documentation' },
    { pattern: /ordinance/i, category: 'regulatory', subcategory: 'Ordinance/Regulation' },
    // Personnel documents
    { pattern: /form[-_\s]?a3|a3[-_\s]?form/i, category: 'personnel', subcategory: 'A3 Form - Key Person' },
    { pattern: /form[-_\s]?a1|a1[-_\s]?form|application.*form/i, category: 'personnel', subcategory: 'A1 Application Form' },
    { pattern: /form[-_\s]?a2|a2[-_\s]?form/i, category: 'personnel', subcategory: 'A2 Form' },
    { pattern: /form[-_\s]?a5|a5[-_\s]?form/i, category: 'personnel', subcategory: 'A5 Outsourcing Declaration' },
    { pattern: /director|ceo|cfo|cto|coo/i, category: 'personnel', subcategory: 'Executive Documentation' },
    { pattern: /compliance.*officer|mlro/i, category: 'personnel', subcategory: 'Compliance Officer' },
    // Legal documents
    { pattern: /board.*resolution|br[-_]/i, category: 'legal', subcategory: 'Board Resolution' },
    { pattern: /power.*attorney|poa/i, category: 'legal', subcategory: 'Power of Attorney' },
    { pattern: /agreement|contract/i, category: 'legal', subcategory: 'Agreement' },
    { pattern: /noc|no.*objection/i, category: 'legal', subcategory: 'NOC Application' },
];
// Cache for AI document categorization to avoid repeated OpenAI calls
const documentCategorizationCache = new Map();
class DocumentAnalyzerService {
    constructor() {
        this.openai = new openai_1.OpenAI({
            apiKey: config_1.config.OPENAI_API_KEY,
        });
    }
    // (Removed unused extractTextContent helper to satisfy strict TS settings)
    /**
     * AI-based categorization of a single document using filename and optional content snippet.
     * Results are cached to avoid repeated OpenAI calls.
     */
    async categorizeDocumentWithAI(_applicationId, companyName, filePath, displayName) {
        const name = displayName || filePath.split('/').pop() || filePath;
        // Check cache first - use filePath as unique key
        const cacheKey = `${filePath}|${companyName}`;
        if (documentCategorizationCache.has(cacheKey)) {
            console.log(`[DocumentCache] Returning cached categorization for ${name}`);
            return documentCategorizationCache.get(cacheKey);
        }
        if (!config_1.config.OPENAI_API_KEY) {
            // Fall back to heuristic categorization when API key missing
            return this.categorizeDocument(name);
        }
        try {
            const fileId = await (0, openai_service_1.getOrUploadOpenAIFileId)(filePath);
            const completion = await (0, openai_service_1.fileAwareCompletion)({
                prompt: `You are a Pakistan VASP NOC document classification expert.

Full document is attached. Metadata:
- File name: ${name}
- Applicant: ${companyName}

Perform the following tasks:
1. Classify the document into one of: corporate, compliance, financial, technical, regulatory, personnel, legal, other.
2. Map it to the closest PVARA pipeline bucket:
   - "ordinance"
   - "regulations"
   - "application-form"
   - "submitted-application"
   - "supporting-document"
3. Provide a precise subcategory label (e.g., Certificate of Incorporation, AML Policy, Form A3, Board Resolution).
4. Provide a confidence score between 0 and 1 and add brief notes summarizing why.

Return ONLY a JSON object.`,
                instructions: 'Return strictly valid JSON with keys {"category","pvaraCategory","subcategory","confidence","notes"}. No prose.',
                fileIds: [fileId],
                reasoning: 'medium',
                tenantId: _applicationId || companyName,
                cacheKey: openai_request_manager_1.openAIRequestManager.buildCacheKey('document-category', filePath, companyName),
            });
            const content = completion || '{}';
            let parsed;
            try {
                parsed = JSON.parse(content);
            }
            catch {
                // If parsing fails, fallback to heuristic
                const fallback = this.categorizeDocument(name);
                return fallback;
            }
            const category = parsed.category || 'other';
            const subcategory = parsed.subcategory || 'Uncategorized';
            const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.6;
            const notes = parsed.notes || 'AI classification';
            const pvaraCategory = parsed.pvaraCategory || 'supporting-document';
            const result = {
                name,
                category,
                subcategory,
                relevanceScore: confidence,
                notes,
                pvaraCategory,
                applicantName: companyName
            };
            // Cache the result
            documentCategorizationCache.set(cacheKey, result);
            console.log(`[DocumentCache] Cached categorization for ${name}`);
            return result;
        }
        catch (error) {
            console.error('AI categorizeDocument error:', error);
            const fallback = this.categorizeDocument(name);
            const result = {
                ...fallback,
                applicantName: companyName
            };
            // Cache even fallback results to avoid re-processing
            documentCategorizationCache.set(cacheKey, result);
            return result;
        }
    }
    /**
     * Categorize a single document based on filename patterns
     */
    categorizeDocument(filename) {
        for (const { pattern, category, subcategory } of DOCUMENT_PATTERNS) {
            if (pattern.test(filename)) {
                return {
                    name: filename,
                    category,
                    subcategory,
                    relevanceScore: 1.0,
                    notes: `Matched pattern for ${subcategory}`
                };
            }
        }
        // Default categorization for unmatched documents
        return {
            name: filename,
            category: 'other',
            subcategory: 'Uncategorized',
            relevanceScore: 0.5,
            notes: 'Could not auto-categorize; manual review recommended'
        };
    }
    /**
     * Analyze all documents for an application
     */
    analyzeDocuments(applicationId, documents) {
        const categorizedDocuments = documents.map(doc => this.categorizeDocument(doc));
        // Calculate category breakdown
        const categoryBreakdown = {};
        for (const doc of categorizedDocuments) {
            categoryBreakdown[doc.category] = (categoryBreakdown[doc.category] || 0) + 1;
        }
        // Identify missing categories
        const presentCategories = new Set(Object.keys(categoryBreakdown).filter(c => c !== 'other'));
        const missingCategories = REQUIRED_CATEGORIES.filter(c => !presentCategories.has(c));
        // Calculate completeness score
        const completenessScore = Math.round(((REQUIRED_CATEGORIES.length - missingCategories.length) / REQUIRED_CATEGORIES.length) * 100);
        // Generate analysis notes
        let analysisNotes = `Document Analysis for ${applicationId}:\n`;
        analysisNotes += `- Total documents: ${documents.length}\n`;
        analysisNotes += `- Categories covered: ${presentCategories.size}/${REQUIRED_CATEGORIES.length}\n`;
        if (missingCategories.length > 0) {
            analysisNotes += `- Missing categories: ${missingCategories.join(', ')}\n`;
        }
        const otherCount = categoryBreakdown['other'] || 0;
        if (otherCount > 0) {
            analysisNotes += `- Uncategorized documents: ${otherCount} (manual review needed)\n`;
        }
        return {
            applicationId,
            totalDocuments: documents.length,
            categorizedDocuments,
            categoryBreakdown,
            missingCategories,
            completenessScore,
            analysisNotes
        };
    }
    /**
     * Use AI to analyze document relevance and completeness
     */
    async analyzeWithAI(applicationId, companyName, documents, applicationType = 'VASP NOC') {
        if (!config_1.config.OPENAI_API_KEY) {
            return 'AI analysis unavailable - OpenAI API key not configured';
        }
        const basicAnalysis = this.analyzeDocuments(applicationId, documents);
        const prompt = `You are an expert regulatory analyst evaluating a ${applicationType} application for ${companyName}.

The following documents have been submitted:
${documents.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Document Category Breakdown:
${Object.entries(basicAnalysis.categoryBreakdown).map(([cat, count]) => `- ${cat}: ${count} documents`).join('\n')}

Missing Document Categories: ${basicAnalysis.missingCategories.length > 0 ? basicAnalysis.missingCategories.join(', ') : 'None'}

Please provide:
1. Assessment of document completeness for Pakistan VASP NOC application
2. Identification of any critical missing documents
3. Quality assessment based on document naming/organization
4. Recommendations for document submission improvement
5. Overall document readiness score (0-100)

Format your response as a structured analysis.`;
        try {
            return await openai_request_manager_1.openAIRequestManager.execute({
                tenantId: applicationId,
                requestName: 'documentAnalyzer.analyzeWithAI',
                promptSnippet: prompt,
                cacheKey: openai_request_manager_1.openAIRequestManager.buildCacheKey('document-analysis', applicationId, documents),
                operation: async () => {
                    const response = await this.openai.chat.completions.create({
                        model: config_1.config.OPENAI_MODEL,
                        messages: [{ role: 'user', content: prompt }],
                        max_completion_tokens: 2500
                    });
                    const usage = response.usage
                        ? {
                            input_tokens: response.usage.prompt_tokens,
                            output_tokens: response.usage.completion_tokens,
                            total_tokens: response.usage.total_tokens,
                        }
                        : undefined;
                    const value = response.choices[0].message.content || 'AI analysis completed.';
                    return { value, usage };
                }
            });
        }
        catch (error) {
            console.error('AI analysis error:', error);
            return `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
}
exports.documentAnalyzerService = new DocumentAnalyzerService();
//# sourceMappingURL=document-analyzer.service.js.map