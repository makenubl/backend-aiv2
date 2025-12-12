"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const application_folder_service_1 = require("../services/application-folder.service");
const document_analyzer_service_1 = require("../services/document-analyzer.service");
const router = (0, express_1.Router)();
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
 */
router.get('/:id/evaluate', async (req, res) => {
    try {
        const { id } = req.params;
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
exports.default = router;
//# sourceMappingURL=applications.routes.js.map