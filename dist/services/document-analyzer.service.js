"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentAnalyzerService = void 0;
const openai_1 = require("openai");
const config_1 = require("../config");
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
class DocumentAnalyzerService {
    constructor() {
        this.openai = new openai_1.OpenAI({
            apiKey: config_1.config.OPENAI_API_KEY,
        });
    }
    // (Removed unused extractTextContent helper to satisfy strict TS settings)
    /**
     * AI-based categorization of a single document using filename and optional content snippet.
     */
    async categorizeDocumentWithAI(_applicationId, companyName, filePath, displayName) {
        const name = displayName || filePath.split('/').pop() || filePath;
        const contentSnippet = await (async () => {
            try {
                const ext = filePath.toLowerCase();
                if (ext.endsWith('.txt')) {
                    const content = require('fs').readFileSync(filePath, 'utf-8');
                    return content.length > 20000 ? content.slice(0, 20000) : content;
                }
                if (ext.endsWith('.pdf')) {
                    const fs = require('fs');
                    const pdfParse = require('pdf-parse');
                    const dataBuffer = fs.readFileSync(filePath);
                    const res = await pdfParse(dataBuffer);
                    const text = res.text || '';
                    return text ? (text.length > 20000 ? text.slice(0, 20000) : text) : null;
                }
                if (ext.endsWith('.docx')) {
                    const fs = require('fs');
                    const mammoth = require('mammoth');
                    const buffer = fs.readFileSync(filePath);
                    const res = await mammoth.extractRawText({ buffer });
                    const text = res.value || '';
                    return text ? (text.length > 20000 ? text.slice(0, 20000) : text) : null;
                }
                return null;
            }
            catch {
                return null;
            }
        })();
        if (!config_1.config.OPENAI_API_KEY) {
            // Fall back to heuristic categorization when API key missing
            return this.categorizeDocument(name);
        }
        const basePrompt = `You are a Pakistan VASP NOC document classification expert.

Document: ${name}
Company: ${companyName}
${contentSnippet ? `Content snippet (first ~20KB):\n${contentSnippet}` : 'No readable content available; infer from title and context.'}

TASK 1 - Standard Classification:
Classify into one of: corporate, compliance, financial, technical, regulatory, personnel, legal, other.

TASK 2 - PVARA Document Type Classification:
Determine if this document belongs to PVARA regulatory documents or applicant submissions:
- "ordinance": PVARA Act 2023, AML Ordinance, regulatory ordinances (very rare in submissions)
- "regulations": Pakistan VASP Regulations, NOC Guidelines, SBP/SECP regulations (rare in submissions)
- "application-form": Official PVARA Forms A1, A2, A3, A4, A5, A6 (standard application forms)
- "submitted-application": Completed/filled application forms or regulatory applications by the applicant
- "supporting-document": Corporate docs, policies, financial statements, certificates, personnel forms

IMPORTANT: Most documents from applicants will be "application-form" (if it's an official PVARA form) or "supporting-document" (if it's corporate/compliance/financial/technical documentation).

TASK 3 - Subcategory:
Provide specific subcategory (e.g., "Certificate of Incorporation", "AML Policy", "Form A3", "Board Resolution").

Respond strictly as JSON with keys: {"category": string, "pvaraCategory": string, "subcategory": string, "confidence": number (0-1), "notes": string}.`;
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.2',
                messages: [{ role: 'user', content: basePrompt }],
                max_tokens: 1000,
            });
            const content = response.choices[0]?.message?.content || '{}';
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
            return {
                name,
                category,
                subcategory,
                relevanceScore: confidence,
                notes,
                pvaraCategory,
                applicantName: companyName
            };
        }
        catch (error) {
            console.error('AI categorizeDocument error:', error);
            const fallback = this.categorizeDocument(name);
            return {
                ...fallback,
                applicantName: companyName
            };
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
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.2',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 2500
            });
            return response.choices[0].message.content || 'AI analysis completed.';
        }
        catch (error) {
            console.error('AI analysis error:', error);
            return `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
}
exports.documentAnalyzerService = new DocumentAnalyzerService();
//# sourceMappingURL=document-analyzer.service.js.map