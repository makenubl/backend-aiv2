"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const application_folder_service_1 = require("../services/application-folder.service");
const document_analyzer_service_1 = require("../services/document-analyzer.service");
const role_middleware_1 = require("../middleware/role.middleware");
const router = (0, express_1.Router)();
/**
 * GET /api/applications/permissions
 * Get current user's permissions based on role
 */
router.get('/permissions', role_middleware_1.getPermissionsHandler);
/**
 * GET /api/applications/scan
 * Scan applications folder and return all applications
 */
router.get('/scan', async (_req, res) => {
    try {
        const applications = await application_folder_service_1.applicationFolderService.scanApplications();
        res.json({
            success: true,
            count: applications.length,
            applications
        });
    }
    catch (error) {
        console.error('Error scanning applications:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to scan applications folder'
        });
    }
});
/**
 * GET /api/applications/documents/library
 * Get all documents organized by applicant and PVARA category
 */
router.get('/documents/library', async (_req, res) => {
    try {
        const applications = await application_folder_service_1.applicationFolderService.scanApplications();
        const path = require('path');
        const documentLibrary = {};
        // Process each application
        for (const app of applications) {
            const companyName = app.applicationData?.companyName || app.id;
            documentLibrary[companyName] = {
                'ordinance': [],
                'regulations': [],
                'application-form': [],
                'submitted-application': [],
                'supporting-document': []
            };
            // Categorize each document
            for (const docName of app.documents) {
                const filePath = path.join(app.folderPath, 'documents', docName);
                try {
                    const docCategory = await document_analyzer_service_1.documentAnalyzerService.categorizeDocumentWithAI(app.id, companyName, filePath, docName);
                    const pvaraCategory = docCategory.pvaraCategory || 'supporting-document';
                    documentLibrary[companyName][pvaraCategory].push({
                        name: docCategory.name,
                        category: docCategory.category,
                        subcategory: docCategory.subcategory,
                        pvaraCategory: pvaraCategory,
                        applicant: companyName,
                        confidence: docCategory.relevanceScore,
                        notes: docCategory.notes
                    });
                }
                catch (docError) {
                    console.error(`Error categorizing ${docName}:`, docError);
                }
            }
        }
        res.json({
            success: true,
            documentLibrary
        });
    }
    catch (error) {
        console.error('Error fetching document library:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch document library'
        });
    }
});
/**
 * GET /api/applications/:id/evaluate
 * Perform comprehensive evaluation of application
 * Query params:
 *   - refresh=true: Force re-evaluation with GPT-5.1 (clears cache)
 * Requires: evaluator or admin role
 */
router.get('/:id/evaluate', (0, role_middleware_1.requirePermission)('evaluation:trigger'), async (req, res) => {
    try {
        const { id } = req.params;
        const refresh = req.query.refresh === 'true';
        // If refresh requested, clear both memory and MongoDB cache first
        if (refresh) {
            console.log(`🔄 Refresh requested for ${id} - clearing all caches for GPT-5.1 re-evaluation`);
            await application_folder_service_1.applicationFolderService.clearEvaluationCache(id);
        }
        const evaluation = await application_folder_service_1.applicationFolderService.evaluateApplication(id);
        res.json({
            success: true,
            evaluation
        });
    }
    catch (error) {
        console.error('Error evaluating application:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Evaluation failed'
        });
    }
});
/**
 * POST /api/applications/refresh-all
 * Clear all evaluation caches to force GPT-5.1 re-evaluation
 * Requires: evaluator or admin role
 */
router.post('/refresh-all', (0, role_middleware_1.requirePermission)('evaluation:refresh'), async (_req, res) => {
    try {
        await application_folder_service_1.applicationFolderService.clearEvaluationCache();
        res.json({
            success: true,
            message: 'All evaluation caches cleared. Next evaluations will use GPT-5.1.'
        });
    }
    catch (error) {
        console.error('Error clearing caches:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear caches'
        });
    }
});
/**
 * GET /api/applications/:id/documents/analyze
 * Analyze and categorize documents for an application
 */
router.get('/:id/documents/analyze', async (req, res) => {
    try {
        const { id } = req.params;
        const applications = await application_folder_service_1.applicationFolderService.scanApplications();
        const application = applications.find(app => app.id === id);
        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }
        const analysis = document_analyzer_service_1.documentAnalyzerService.analyzeDocuments(id, application.documents);
        return res.json({
            success: true,
            analysis
        });
    }
    catch (error) {
        console.error('Error analyzing documents:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Document analysis failed'
        });
    }
});
/**
 * GET /api/applications/:id/documents/ai-analyze
 * AI-powered document analysis
 */
router.get('/:id/documents/ai-analyze', async (req, res) => {
    try {
        const { id } = req.params;
        const applications = await application_folder_service_1.applicationFolderService.scanApplications();
        const application = applications.find(app => app.id === id);
        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }
        const companyName = application.applicationData?.companyName || 'Unknown';
        const aiAnalysis = await document_analyzer_service_1.documentAnalyzerService.analyzeWithAI(id, companyName, application.documents);
        const basicAnalysis = document_analyzer_service_1.documentAnalyzerService.analyzeDocuments(id, application.documents);
        // Attempt AI per-document categorization using available file paths (documents assumed under folderPath/documents)
        const path = require('path');
        const aiDocCategories = await Promise.all(application.documents.map(async (docName) => {
            const filePath = path.join(application.folderPath, 'documents', docName);
            return document_analyzer_service_1.documentAnalyzerService.categorizeDocumentWithAI(id, companyName, filePath, docName);
        }));
        return res.json({
            success: true,
            analysis: basicAnalysis,
            aiInsights: aiAnalysis,
            aiDocumentCategories: aiDocCategories
        });
    }
    catch (error) {
        console.error('Error with AI document analysis:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'AI document analysis failed'
        });
    }
});
/**
 * GET /api/applications/:id
 * Get single application details
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const applications = await application_folder_service_1.applicationFolderService.scanApplications();
        const application = applications.find(app => app.id === id);
        if (!application) {
            return res.status(404).json({
                success: false,
                error: 'Application not found'
            });
        }
        return res.json({
            success: true,
            application
        });
    }
    catch (error) {
        console.error('Error fetching application:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch application'
        });
    }
});
/**
 * POST /api/applications/:id/evaluate-with-config
 * Perform comprehensive evaluation with custom configuration
 * Body params:
 *   - folder: string - Storage folder to pull documents from
 *   - documents: Array<{ name: string; tag: string }> - Selected documents with tags
 *   - documentsByTag: Record<string, string[]> - Documents grouped by tag
 *   - checklists: Array<{ id: string; name: string; items: string[] }> - Enabled regulatory checklists
 *   - aiContext: string - Custom AI context/prompt
 *   - companyName: string - Company name for evaluation
 * Requires: evaluator or admin role
 */
router.post('/:id/evaluate-with-config', (0, role_middleware_1.requirePermission)('evaluation:trigger'), async (req, res) => {
    try {
        const { id } = req.params;
        const { folder, documents, documentsByTag, checklists, aiContext, companyName } = req.body;
        console.log(`📋 Configured evaluation request for ${id}`);
        console.log(`📁 Folder: ${folder}`);
        console.log(`📄 Documents: ${documents?.length || 0}`);
        console.log(`✅ Checklists: ${checklists?.length || 0}`);
        // Validate required fields
        if (!documents || documents.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'At least one document must be selected'
            });
        }
        // Call the configured evaluation service
        const evaluation = await application_folder_service_1.applicationFolderService.evaluateWithConfig({
            applicationId: id,
            folder,
            documents,
            documentsByTag,
            checklists,
            aiContext,
            companyName
        });
        return res.json({
            success: true,
            evaluation
        });
    }
    catch (error) {
        console.error('Error evaluating with config:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Configured evaluation failed'
        });
    }
});
exports.default = router;
//# sourceMappingURL=applications.routes.js.map