import { Router, Request, Response } from 'express';
import { applicationFolderService } from '../services/application-folder.service';
import { documentAnalyzerService } from '../services/document-analyzer.service';
import { requirePermission, requireEvaluator, getPermissionsHandler } from '../middleware/role.middleware';

const router = Router();

/**
 * GET /api/applications/permissions
 * Get current user's permissions based on role
 */
router.get('/permissions', getPermissionsHandler);

/**
 * GET /api/applications/scan
 * Scan applications folder and return all applications
 */
router.get('/scan', async (_req: Request, res: Response) => {
  try {
    const applications = await applicationFolderService.scanApplications();
    res.json({
      success: true,
      count: applications.length,
      applications
    });
  } catch (error) {
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
router.get('/documents/library', async (_req: Request, res: Response) => {
  try {
    const applications = await applicationFolderService.scanApplications();
    const path = require('path');
    
    const documentLibrary: Record<string, Record<string, any[]>> = {};
    
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
          const docCategory = await documentAnalyzerService.categorizeDocumentWithAI(app.id, companyName, filePath, docName);
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
        } catch (docError) {
          console.error(`Error categorizing ${docName}:`, docError);
        }
      }
    }
    
    res.json({
      success: true,
      documentLibrary
    });
  } catch (error) {
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
router.get('/:id/evaluate', requirePermission('evaluation:trigger'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const refresh = req.query.refresh === 'true';
    
    // If refresh requested, clear both memory and MongoDB cache first
    if (refresh) {
      console.log(`🔄 Refresh requested for ${id} - clearing all caches for GPT-5.1 re-evaluation`);
      await applicationFolderService.clearEvaluationCache(id);
    }
    
    const evaluation = await applicationFolderService.evaluateApplication(id);
    
    res.json({
      success: true,
      evaluation
    });
  } catch (error) {
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
router.post('/refresh-all', requirePermission('evaluation:refresh'), async (req: Request, res: Response) => {
  try {
    await applicationFolderService.clearEvaluationCache();
    res.json({
      success: true,
      message: 'All evaluation caches cleared. Next evaluations will use GPT-5.1.'
    });
  } catch (error) {
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
router.get('/:id/documents/analyze', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const applications = await applicationFolderService.scanApplications();
    const application = applications.find(app => app.id === id);
    
    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Application not found'
      });
    }

    const analysis = documentAnalyzerService.analyzeDocuments(id, application.documents);
    
    return res.json({
      success: true,
      analysis
    });
  } catch (error) {
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
router.get('/:id/documents/ai-analyze', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const applications = await applicationFolderService.scanApplications();
    const application = applications.find(app => app.id === id);
    
    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Application not found'
      });
    }

    const companyName = application.applicationData?.companyName || 'Unknown';
    const aiAnalysis = await documentAnalyzerService.analyzeWithAI(
      id,
      companyName,
      application.documents
    );
    const basicAnalysis = documentAnalyzerService.analyzeDocuments(id, application.documents);

    // Attempt AI per-document categorization using available file paths (documents assumed under folderPath/documents)
    const path = require('path');
    const aiDocCategories = await Promise.all(
      application.documents.map(async (docName: string) => {
        const filePath = path.join(application.folderPath, 'documents', docName);
        return documentAnalyzerService.categorizeDocumentWithAI(id, companyName, filePath, docName);
      })
    );
    
    return res.json({
      success: true,
      analysis: basicAnalysis,
      aiInsights: aiAnalysis,
      aiDocumentCategories: aiDocCategories
    });
  } catch (error) {
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
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const applications = await applicationFolderService.scanApplications();
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
  } catch (error) {
    console.error('Error fetching application:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch application'
    });
  }
});

export default router;
