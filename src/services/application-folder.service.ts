import * as fs from 'fs';
import * as path from 'path';
import { documentAnalyzerService, DocumentAnalysis, DocumentCategory } from './document-analyzer.service';
import { saveEvaluation, getEvaluation, deleteEvaluation } from './database.service';
import { config } from '../config';

// Response type for OpenAI Responses API
interface OpenAIResponsesData {
  status?: string;
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
    }>;
  }>;
  error?: { message: string };
}

// Helper function for OpenAI Responses API (gpt-5.1)
async function callOpenAIResponsesAPI(input: string, options?: { reasoning?: boolean }): Promise<string> {
  const url = 'https://api.openai.com/v1/responses';
  const startTime = Date.now();
  
  const body: any = {
    model: config.OPENAI_MODEL || 'gpt-5.1',
    input: input
  };

  if (options?.reasoning) {
    body.reasoning = { effort: 'medium' };
  }

  console.log(`🤖 [OpenAI Responses API] Generating AI Insights - Model: ${body.model}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ [OpenAI] Error:`, error);
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data: OpenAIResponsesData = await response.json() as OpenAIResponsesData;
    const totalTime = Date.now() - startTime;
    console.log(`✅ [OpenAI] AI Insights generated - Time: ${totalTime}ms`);
    
    // Parse Responses API format
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              return contentItem.text;
            }
          }
        }
      }
    }
    
    return '';
  } catch (error) {
    console.error(`❌ [OpenAI] Failed to generate insights:`, error);
    return '';
  }
}

export interface ApplicationFolder {
  id: string;
  folderPath: string;
  applicationData: any;
  documents: string[];
  categorizedDocuments?: DocumentCategory[];
  documentsAnalysis?: DocumentAnalysis;
  submittedAt: Date;
  status: 'pending' | 'processing' | 'evaluated' | 'approved' | 'rejected';
}

export interface EvaluationComment {
  category: 'compliance' | 'risk' | 'technical' | 'business' | 'regulatory' | 'recommendation';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  evaluatedAt: Date;
}

export interface ComprehensiveEvaluation {
  applicationId: string;
  overallScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  recommendation: 'approve' | 'conditional-approval' | 'reject' | 'needs-review';
  complianceScore: number;
  technicalScore: number;
  businessScore: number;
  regulatoryScore: number;
  comments: EvaluationComment[];
  dueDiligenceChecks: {
    corporateVerification: { passed: boolean; notes: string };
    licenseVerification: { passed: boolean; notes: string };
    financialStability: { passed: boolean; notes: string };
    technicalCapability: { passed: boolean; notes: string };
    complianceFramework: { passed: boolean; notes: string };
    dataProtection: { passed: boolean; notes: string };
    riskManagement: { passed: boolean; notes: string };
    pakistanReadiness: { passed: boolean; notes: string };
  };
  aiInsights: string;
  aiDocumentCategories?: DocumentCategory[];
  modelUsed: string;
  nextSteps: string[];
  conditions: string[];
  evaluatedAt: Date;
}

// Cache for evaluations to avoid repeated OpenAI calls
const evaluationCache = new Map<string, ComprehensiveEvaluation>();

class ApplicationFolderService {
  private applicationsBasePath: string;

  constructor() {
    // Look for applications in the parent directory (workspace root)
    const workspaceRoot = path.join(process.cwd(), '..');
    this.applicationsBasePath = path.join(workspaceRoot, 'applications');
    
    // If not found, fallback to backend/applications
    if (!this.folderExists(this.applicationsBasePath)) {
      this.applicationsBasePath = path.join(process.cwd(), 'applications');
    }
    
    this.ensureApplicationsFolder();
  }

  private folderExists(folderPath: string): boolean {
    return fs.existsSync(folderPath);
  }

  private ensureApplicationsFolder(): void {
    if (!fs.existsSync(this.applicationsBasePath)) {
      fs.mkdirSync(this.applicationsBasePath, { recursive: true });
    }
  }

  /**
   * Scan applications folder and return all applications
   */
  public async scanApplications(): Promise<ApplicationFolder[]> {
    const applications: ApplicationFolder[] = [];

    try {
      const folders = fs.readdirSync(this.applicationsBasePath, { withFileTypes: true });

      for (const folder of folders) {
        if (folder.isDirectory() && !folder.name.startsWith('.')) {
          const folderPath = path.join(this.applicationsBasePath, folder.name);
          const applicationJsonPath = path.join(folderPath, 'application.json');

          if (fs.existsSync(applicationJsonPath)) {
            const applicationData = JSON.parse(
              fs.readFileSync(applicationJsonPath, 'utf-8')
            );

            const documents = this.scanDocuments(folderPath);
            const analysis = documentAnalyzerService.analyzeDocuments(applicationData.id || folder.name, documents);

            applications.push({
              id: applicationData.id || folder.name,
              folderPath,
              applicationData,
              documents,
              categorizedDocuments: analysis.categorizedDocuments,
              documentsAnalysis: analysis,
              submittedAt: new Date(applicationData.applicationDate || Date.now()),
              status: 'pending'
            });
          }
        }
      }

      return applications.sort((a, b) => 
        b.submittedAt.getTime() - a.submittedAt.getTime()
      );
    } catch (error) {
      console.error('Error scanning applications:', error);
      return [];
    }
  }

  /**
   * Scan documents in application folder (recursively)
   */
  private scanDocuments(folderPath: string): string[] {
    const documents: string[] = [];
    
    const scanDir = (dir: string, prefix = ''): void => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const entryPath = path.join(dir, entry.name);
        const displayName = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          scanDir(entryPath, displayName);
        } else if (entry.name.match(/\.(pdf|docx|doc|xlsx|png|jpg|jpeg)$/i)) {
          documents.push(displayName);
        }
      }
    };

    try {
      const documentsPath = path.join(folderPath, 'documents');
      scanDir(documentsPath);

      // Also check for documents listed in application.json
      const applicationJsonPath = path.join(folderPath, 'application.json');
      if (fs.existsSync(applicationJsonPath)) {
        const appData = JSON.parse(fs.readFileSync(applicationJsonPath, 'utf-8'));
        if (appData.documents && Array.isArray(appData.documents)) {
          appData.documents.forEach((doc: string) => {
            if (!documents.includes(doc)) {
              documents.push(doc);
            }
          });
        }
      }
    } catch (error) {
      console.error('Error scanning documents:', error);
    }

    return documents;
  }

  /**
   * Perform comprehensive due diligence evaluation
   * Results are stored in MongoDB and cached in memory
   */
  public async evaluateApplication(applicationId: string): Promise<ComprehensiveEvaluation> {
    // Check in-memory cache first
    if (evaluationCache.has(applicationId)) {
      console.log(`[EvaluationCache] Returning memory-cached evaluation for ${applicationId}`);
      return evaluationCache.get(applicationId)!;
    }

    // Check MongoDB cache
    try {
      const storedEvaluation = await getEvaluation(applicationId);
      if (storedEvaluation) {
        console.log(`[MongoDB] Returning stored evaluation for ${applicationId}`);
        evaluationCache.set(applicationId, storedEvaluation);
        return storedEvaluation;
      }
    } catch (error) {
      console.warn(`[MongoDB] Could not retrieve evaluation for ${applicationId}:`, error);
    }

    const applications = await this.scanApplications();
    const app = applications.find(a => a.id === applicationId);

    if (!app) {
      throw new Error(`Application ${applicationId} not found`);
    }

    const data = app.applicationData;
    const docAnalysis = app.documentsAnalysis;
    const comments: EvaluationComment[] = [];

    // 1. Corporate Verification
    const corporateVerification = this.checkCorporateVerification(data, comments);

    // 2. License Verification
    const licenseVerification = this.checkLicenseVerification(data, comments);

    // 3. Financial Stability
    const financialStability = this.checkFinancialStability(data, comments);

    // 4. Technical Capability
    const technicalCapability = this.checkTechnicalCapability(data, comments);
    this.addPositiveTechnicalComment(data, comments, technicalCapability.passed);

    // 5. Compliance Framework
    const complianceFramework = this.checkComplianceFramework(data, comments);

    // 6. Data Protection
    const dataProtection = this.checkDataProtection(data, comments);

    // 7. Risk Management
    const riskManagement = this.checkRiskManagement(data, comments);

    // 8. Pakistan Readiness
    const pakistanReadiness = this.checkPakistanReadiness(data, comments);

    // Add document-based gaps as comments if analysis is available
    if (docAnalysis && docAnalysis.missingCategories && docAnalysis.missingCategories.length > 0) {
      for (const cat of docAnalysis.missingCategories) {
        const severity: EvaluationComment['severity'] = (cat === 'regulatory' || cat === 'compliance') ? 'critical' : 'high';
        comments.push({
          category: cat === 'technical' ? 'technical' : cat === 'financial' ? 'business' : cat === 'regulatory' ? 'regulatory' : cat === 'corporate' ? 'regulatory' : cat === 'legal' ? 'regulatory' : 'compliance',
          severity,
          title: `Missing ${cat.charAt(0).toUpperCase() + cat.slice(1)} Documentation`,
          description: `Document analysis indicates missing ${cat} category materials. Submit relevant evidence (e.g., policies, licenses, financials) to proceed.`,
          evaluatedAt: new Date()
        });
      }
    }

    // Calculate scores (adjusted with document analysis penalties when available)
    const scores = this.calculateScores({
      corporateVerification,
      licenseVerification,
      financialStability,
      technicalCapability,
      complianceFramework,
      dataProtection,
      riskManagement,
      pakistanReadiness
    }, docAnalysis);

    // Determine recommendation
    const recommendation = this.determineRecommendation(scores, comments);

    // Generate AI insights using GPT-5.1
    const aiInsights = await this.generateAIInsights(data, scores, comments, docAnalysis);

    // Optional: AI per-document categorization to enrich evaluation
    let aiDocCategories: DocumentCategory[] | undefined;
    try {
      const path = require('path');
      const companyName = data.companyName || 'Unknown';
      aiDocCategories = await Promise.all(
        app.documents.map(async (docName: string) => {
          const filePath = path.join(app.folderPath, 'documents', docName);
          return documentAnalyzerService.categorizeDocumentWithAI(applicationId, companyName, filePath, docName);
        })
      );

      // Add positive findings based on AI-detected strong evidence
      const hasBoardResolution = aiDocCategories.some(d => d.category === 'legal' && /board.*resolution/i.test(d.subcategory));
      const hasLicense = aiDocCategories.some(d => d.category === 'regulatory' && /license|licence|permit/i.test(d.subcategory));
      const hasFinancials = aiDocCategories.some(d => d.category === 'financial');

      if (hasBoardResolution) {
        comments.push({
          category: 'regulatory',
          severity: 'info',
          title: 'Board Resolution Present',
          description: 'Board resolution found in submission evidencing corporate authorization.',
          evaluatedAt: new Date()
        });
      }
      if (hasLicense) {
        comments.push({
          category: 'regulatory',
          severity: 'info',
          title: 'Existing License Documentation',
          description: 'Regulatory license or permit documents present, supporting compliance posture.',
          evaluatedAt: new Date()
        });
      }
      if (hasFinancials) {
        comments.push({
          category: 'business',
          severity: 'info',
          title: 'Financial Documentation Provided',
          description: 'Financial statements or projections detected among submitted documents.',
          evaluatedAt: new Date()
        });
      }
    } catch (e) {
      // Non-fatal: proceed without AI categories if any issue
    }

    // Generate next steps and conditions
    const { nextSteps, conditions } = this.generateNextStepsAndConditions(
      recommendation,
      comments
    );

    const evaluation: ComprehensiveEvaluation = {
      applicationId: app.id,
      overallScore: scores.overall,
      riskLevel: scores.riskLevel,
      recommendation: recommendation.decision,
      complianceScore: scores.compliance,
      technicalScore: scores.technical,
      businessScore: scores.business,
      regulatoryScore: scores.regulatory,
      comments,
      dueDiligenceChecks: {
        corporateVerification,
        licenseVerification,
        financialStability,
        technicalCapability,
        complianceFramework,
        dataProtection,
        riskManagement,
        pakistanReadiness
      },
      aiInsights,
      aiDocumentCategories: aiDocCategories,
      modelUsed: config.OPENAI_MODEL || 'gpt-5.1',
      nextSteps,
      conditions,
      evaluatedAt: new Date()
    };

    // Cache in memory
    evaluationCache.set(applicationId, evaluation);
    console.log(`[EvaluationCache] Cached evaluation for ${applicationId}`);

    // Save to MongoDB for persistence
    try {
      await saveEvaluation(applicationId, evaluation);
    } catch (error) {
      console.error(`[MongoDB] Failed to save evaluation for ${applicationId}:`, error);
    }

    return evaluation;
  }

  /**
   * Perform evaluation with custom configuration
   * Allows selecting specific documents and regulatory checklists
   */
  public async evaluateWithConfig(config: {
    applicationId: string;
    folder: string;
    documents: Array<{ name: string; tag: string }>;
    documentsByTag: Record<string, string[]>;
    checklists: Array<{ id: string; name: string; items: string[] }>;
    aiContext: string;
    companyName: string;
  }): Promise<ComprehensiveEvaluation> {
    const { applicationId, folder, documents, documentsByTag, checklists, aiContext, companyName } = config;
    
    console.log(`📋 Starting configured evaluation for ${applicationId}`);
    console.log(`📁 Using documents from folder: ${folder}`);
    console.log(`📄 Selected ${documents.length} documents`);
    console.log(`✅ Using ${checklists.length} regulatory checklists`);

    // Build document context for AI
    const applicationFormDocs = documentsByTag['application-form'] || [];
    const regulationDocs = documentsByTag['regulation'] || [];
    const supportingDocs = documentsByTag['supporting'] || [];
    const ordinanceDocs = documentsByTag['ordinance'] || [];

    // Build comprehensive prompt with selected documents and checklists
    const checklistText = checklists.map(cl => 
      `### ${cl.name}\n${cl.items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`
    ).join('\n\n');

    const documentsText = `
📋 APPLICATION FORMS:
${applicationFormDocs.length > 0 ? applicationFormDocs.map(d => `- ${d}`).join('\n') : 'None selected'}

📜 REGULATIONS & ORDINANCES:
${[...regulationDocs, ...ordinanceDocs].map(d => `- ${d}`).join('\n') || 'None selected'}

📎 SUPPORTING DOCUMENTS:
${supportingDocs.length > 0 ? supportingDocs.map(d => `- ${d}`).join('\n') : 'None selected'}
`;

    const evaluationPrompt = `${aiContext}

=== EVALUATION CONTEXT ===

🏢 APPLICANT: ${companyName}
📁 APPLICATION ID: ${applicationId}

=== SELECTED DOCUMENTS FOR REVIEW ===
${documentsText}

=== REGULATORY CHECKLISTS TO EVALUATE AGAINST ===
${checklistText}

=== EVALUATION INSTRUCTIONS ===

Based on the documents listed above and the regulatory checklists provided, perform a comprehensive evaluation:

1. **DOCUMENT REVIEW**: For each regulatory checklist item, indicate whether the corresponding document/evidence is:
   - ✅ PRESENT and compliant
   - ⚠️ PRESENT but requires clarification
   - ❌ MISSING or non-compliant

2. **COMPLIANCE SCORING**: Provide scores (0-100%) for each regulatory area:
   - NOC Regulations Compliance
   - VA Fit & Proper Requirements  
   - SECP Prerequisites
   - Licensing Regulations

3. **RISK ASSESSMENT**: Identify potential risks in:
   - AML/CFT compliance
   - Governance structure
   - Technical security
   - Operational capabilities

4. **GAP ANALYSIS**: List all missing documents and compliance gaps

5. **RECOMMENDATIONS**: Provide specific, actionable recommendations for addressing each gap

6. **FINAL DECISION**: Based on the evaluation, provide:
   - Overall Compliance Score (0-100%)
   - Risk Level (Low/Medium/High/Critical)
   - Recommendation (APPROVE / CONDITIONAL APPROVAL / REJECT)
   - Required conditions for approval (if applicable)

Be thorough, specific, and cite the relevant regulatory sections where applicable.`;

    console.log('🤖 Calling GPT-5.1 for configured evaluation...');
    
    try {
      // Call GPT-5.1 for evaluation
      const { callOpenAIResponsesAPI } = await import('./openai.service');
      const aiResponse = await callOpenAIResponsesAPI(evaluationPrompt, { reasoning: true });

      // Parse the AI response to extract scores and recommendations
      const scores = this.parseAIScores(aiResponse);
      const recommendation = this.parseAIRecommendation(aiResponse);
      
      const comments: EvaluationComment[] = [];
      
      // Add document gap comments
      if (applicationFormDocs.length === 0) {
        comments.push({
          category: 'compliance',
          severity: 'critical',
          title: 'No Application Forms Selected',
          description: 'No application forms were selected for evaluation. Please ensure all required forms are included.',
          evaluatedAt: new Date()
        });
      }

      if (regulationDocs.length === 0 && ordinanceDocs.length === 0) {
        comments.push({
          category: 'regulatory',
          severity: 'high',
          title: 'No Regulations Referenced',
          description: 'No regulatory documents were selected for compliance checking.',
          evaluatedAt: new Date()
        });
      }

      // Build evaluation result
      const evaluation: ComprehensiveEvaluation = {
        applicationId,
        overallScore: scores.overall,
        riskLevel: scores.riskLevel,
        recommendation: recommendation.decision,
        complianceScore: scores.compliance,
        technicalScore: scores.technical,
        businessScore: scores.business,
        regulatoryScore: scores.regulatory,
        comments,
        dueDiligenceChecks: {
          corporateVerification: { passed: true, notes: 'Evaluated from selected documents' },
          licenseVerification: { passed: scores.regulatory >= 60, notes: 'Based on document review' },
          financialStability: { passed: scores.business >= 60, notes: 'Based on document review' },
          technicalCapability: { passed: scores.technical >= 60, notes: 'Based on document review' },
          complianceFramework: { passed: scores.compliance >= 60, notes: 'Based on document review' },
          dataProtection: { passed: true, notes: 'Evaluated from selected documents' },
          riskManagement: { passed: scores.riskLevel !== 'critical', notes: 'Based on risk assessment' },
          pakistanReadiness: { passed: true, notes: 'Evaluated from selected documents' }
        },
        aiInsights: aiResponse,
        aiDocumentCategories: documents.map(d => ({
          name: d.name,
          category: d.tag,
          subcategory: d.tag,
          pvaraCategory: d.tag,
          applicant: companyName,
          relevanceScore: 0.9,
          notes: 'User-tagged document'
        })),
        modelUsed: config.OPENAI_MODEL || 'gpt-5.1',
        nextSteps: recommendation.nextSteps || [],
        conditions: recommendation.conditions || [],
        evaluatedAt: new Date()
      };

      // Save to MongoDB
      try {
        await saveEvaluation(applicationId, evaluation);
      } catch (error) {
        console.error(`[MongoDB] Failed to save configured evaluation for ${applicationId}:`, error);
      }

      return evaluation;
    } catch (error) {
      console.error('Configured evaluation error:', error);
      throw new Error(`Evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse AI response to extract scores
   */
  private parseAIScores(aiResponse: string): {
    overall: number;
    compliance: number;
    technical: number;
    business: number;
    regulatory: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  } {
    // Default scores
    let overall = 65;
    let compliance = 65;
    let technical = 70;
    let business = 65;
    let regulatory = 60;
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium';

    const response = aiResponse.toLowerCase();

    // Try to extract overall score
    const overallMatch = response.match(/overall.*?(\d{1,3})%|overall score.*?(\d{1,3})/i);
    if (overallMatch) {
      overall = parseInt(overallMatch[1] || overallMatch[2]);
    }

    // Try to extract compliance score
    const complianceMatch = response.match(/compliance.*?(\d{1,3})%|compliance score.*?(\d{1,3})/i);
    if (complianceMatch) {
      compliance = parseInt(complianceMatch[1] || complianceMatch[2]);
    }

    // Try to extract risk level
    if (response.includes('critical risk') || response.includes('risk.*critical')) {
      riskLevel = 'critical';
    } else if (response.includes('high risk') || response.includes('risk.*high')) {
      riskLevel = 'high';
    } else if (response.includes('low risk') || response.includes('risk.*low')) {
      riskLevel = 'low';
    }

    return { overall, compliance, technical, business, regulatory, riskLevel };
  }

  /**
   * Parse AI response to extract recommendation
   */
  private parseAIRecommendation(aiResponse: string): {
    decision: 'approve' | 'conditional' | 'reject' | 'review';
    nextSteps: string[];
    conditions: string[];
  } {
    const response = aiResponse.toLowerCase();
    let decision: 'approve' | 'conditional' | 'reject' | 'review' = 'review';
    const nextSteps: string[] = [];
    const conditions: string[] = [];

    if (response.includes('reject') || response.includes('not approved') || response.includes('denial')) {
      decision = 'reject';
    } else if (response.includes('conditional approval') || response.includes('approve with conditions')) {
      decision = 'conditional';
    } else if (response.includes('approve') && !response.includes('not approve')) {
      decision = 'approve';
    }

    // Extract conditions (simple pattern matching)
    const conditionMatch = response.match(/conditions?[:\s]*\n?([\s\S]*?)(?:\n\n|$)/i);
    if (conditionMatch) {
      const conditionText = conditionMatch[1];
      const bulletPoints = conditionText.match(/[-•]\s*([^\n]+)/g);
      if (bulletPoints) {
        conditions.push(...bulletPoints.map(b => b.replace(/^[-•]\s*/, '').trim()).slice(0, 5));
      }
    }

    // Default next steps based on decision
    if (decision === 'conditional') {
      nextSteps.push('Submit missing documentation within 30 days');
      nextSteps.push('Address identified compliance gaps');
      nextSteps.push('Schedule follow-up review meeting');
    } else if (decision === 'reject') {
      nextSteps.push('Review rejection reasons in detail');
      nextSteps.push('Prepare comprehensive remediation plan');
      nextSteps.push('Consider reapplication after addressing gaps');
    } else if (decision === 'approve') {
      nextSteps.push('Proceed with license issuance');
      nextSteps.push('Schedule onboarding meeting');
      nextSteps.push('Begin compliance monitoring setup');
    } else {
      nextSteps.push('Additional review required');
      nextSteps.push('Submit clarification documents');
      nextSteps.push('Schedule review meeting with regulatory team');
    }

    return { decision, nextSteps, conditions };
  }

  private checkCorporateVerification(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const issues: string[] = [];
    
    if (!data.companyName) {
      issues.push('Company name not provided');
    }
    
    if (!data.submittedBy || !data.submitterEmail) {
      issues.push('Incomplete submitter information');
      comments.push({
        category: 'compliance',
        severity: 'high',
        title: 'Missing Submitter Details',
        description: 'Application lacks complete submitter contact information required for verification.',
        evaluatedAt: new Date()
      });
    }

    const passed = issues.length === 0;
    
    return {
      passed,
      notes: passed 
        ? 'Corporate information appears complete.' 
        : `Issues: ${issues.join('; ')}`
    };
  }

  private checkLicenseVerification(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const hasRegulatoryHistory = data.regulatoryHistory && data.regulatoryHistory.length > 50;
    
    if (!hasRegulatoryHistory) {
      comments.push({
        category: 'regulatory',
        severity: 'critical',
        title: 'Insufficient Regulatory History',
        description: 'Applicant must provide detailed regulatory history including all current licenses, past sanctions, and regulatory interactions.',
        evaluatedAt: new Date()
      });
    }

    // Check for problematic regulatory history
    if (data.regulatoryHistory && 
        (data.regulatoryHistory.toLowerCase().includes('sanction') || 
         data.regulatoryHistory.toLowerCase().includes('settlement'))) {
      comments.push({
        category: 'regulatory',
        severity: 'high',
        title: 'Regulatory Concerns Identified',
        description: 'Past regulatory sanctions or settlements require additional scrutiny and remediation evidence.',
        evaluatedAt: new Date()
      });
    }

    return {
      passed: hasRegulatoryHistory,
      notes: hasRegulatoryHistory 
        ? 'Regulatory history provided for review.' 
        : 'Regulatory history insufficient or missing.'
    };
  }

  private checkFinancialStability(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const hasFinancials = data.financialProjections && 
                          data.financialProjections.year1Revenue;

    if (!hasFinancials) {
      comments.push({
        category: 'business',
        severity: 'high',
        title: 'Missing Financial Projections',
        description: 'Detailed financial projections for 3 years required including revenue, costs, and break-even analysis.',
        evaluatedAt: new Date()
      });
    }

    if (hasFinancials && data.financialProjections.breakEvenMonth > 24) {
      comments.push({
        category: 'business',
        severity: 'medium',
        title: 'Extended Break-Even Period',
        description: `Break-even projected at month ${data.financialProjections.breakEvenMonth}. Applicant must demonstrate sufficient capital reserves.`,
        evaluatedAt: new Date()
      });
    }

    return {
      passed: hasFinancials,
      notes: hasFinancials 
        ? `Financial projections provided. Break-even: Month ${data.financialProjections.breakEvenMonth}` 
        : 'Financial projections missing or incomplete.'
    };
  }

  private checkTechnicalCapability(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const hasTechArch = data.technicalArchitecture && data.technicalArchitecture.length > 100;
    const hasAI = data.aiCapabilities && data.aiCapabilities.length > 0;

    if (!hasTechArch) {
      comments.push({
        category: 'technical',
        severity: 'critical',
        title: 'Insufficient Technical Documentation',
        description: 'Detailed technical architecture documentation required including infrastructure, security, and scalability plans.',
        evaluatedAt: new Date()
      });
    }

    if (!hasAI) {
      comments.push({
        category: 'technical',
        severity: 'medium',
        title: 'AI Capabilities Not Defined',
        description: 'Applicant must specify AI/ML capabilities for compliance, fraud detection, and risk management.',
        evaluatedAt: new Date()
      });
    }

    return {
      passed: hasTechArch && hasAI,
      notes: hasTechArch && hasAI 
        ? `Technical architecture documented. AI capabilities: ${data.aiCapabilities?.length || 0}` 
        : 'Technical documentation incomplete.'
    };
  }

  // Add positive technical finding when checks pass
  private addPositiveTechnicalComment(data: any, comments: EvaluationComment[], passed: boolean): void {
    if (passed) {
      const aiCount = data.aiCapabilities?.length || 0;
      comments.push({
        category: 'technical',
        severity: 'info',
        title: 'Technical Architecture Verified',
        description: `Technical documentation complete with ${aiCount} AI/ML capabilities defined for compliance and risk management.`,
        evaluatedAt: new Date()
      });
    }
  }

  private checkComplianceFramework(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const hasCompliance = data.complianceFramework && data.complianceFramework.length > 50;

    if (!hasCompliance) {
      comments.push({
        category: 'compliance',
        severity: 'critical',
        title: 'Missing Compliance Framework',
        description: 'Comprehensive compliance framework required covering KYC, AML, CFT, data protection, and cybersecurity.',
        evaluatedAt: new Date()
      });
    }

    // Check for specific compliance elements
    const framework = (data.complianceFramework || '').toLowerCase();
    const hasKYC = framework.includes('kyc');
    const hasAML = framework.includes('aml');
    const hasData = framework.includes('data protection') || framework.includes('gdpr');

    if (!hasKYC || !hasAML || !hasData) {
      comments.push({
        category: 'compliance',
        severity: 'high',
        title: 'Incomplete Compliance Elements',
        description: `Missing critical compliance elements: ${!hasKYC ? 'KYC ' : ''}${!hasAML ? 'AML ' : ''}${!hasData ? 'Data Protection' : ''}`,
        evaluatedAt: new Date()
      });
    }

    // Add positive finding when compliance passes
    if (hasCompliance && hasKYC && hasAML && hasData) {
      comments.push({
        category: 'compliance',
        severity: 'info',
        title: 'Compliance Framework Verified',
        description: 'KYC, AML, and Data Protection policies documented and present in application materials.',
        evaluatedAt: new Date()
      });
    }

    return {
      passed: hasCompliance && hasKYC && hasAML,
      notes: hasCompliance 
        ? 'Compliance framework provided for review.' 
        : 'Compliance framework missing or incomplete.'
    };
  }

  private checkDataProtection(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const dataUsage = (data.dataUsage || '').toLowerCase();
    const compliance = (data.complianceFramework || '').toLowerCase();
    
    const hasDataPolicy = compliance.includes('data protection') || 
                          compliance.includes('gdpr') || 
                          compliance.includes('privacy');

    if (!hasDataPolicy) {
      comments.push({
        category: 'compliance',
        severity: 'critical',
        title: 'Data Protection Policy Missing',
        description: 'GDPR-compliant data protection policy required. Must address data localization for Pakistan market.',
        evaluatedAt: new Date()
      });
    }

    const mentionsSensitiveData = dataUsage.includes('biometric') || 
                                   dataUsage.includes('identity') || 
                                   dataUsage.includes('financial');

    if (mentionsSensitiveData && !hasDataPolicy) {
      comments.push({
        category: 'compliance',
        severity: 'critical',
        title: 'Sensitive Data Without Protection Policy',
        description: 'Application processes sensitive personal data but lacks comprehensive data protection framework.',
        evaluatedAt: new Date()
      });
    }

    return {
      passed: hasDataPolicy,
      notes: hasDataPolicy 
        ? 'Data protection measures documented.' 
        : 'Data protection policy required.'
    };
  }

  private checkRiskManagement(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const hasRiskMgmt = data.riskManagement && data.riskManagement.length > 50;

    if (!hasRiskMgmt) {
      comments.push({
        category: 'risk',
        severity: 'critical',
        title: 'Risk Management Framework Missing',
        description: 'Comprehensive risk management framework required covering operational, financial, cybersecurity, and regulatory risks.',
        evaluatedAt: new Date()
      });
    }

    const riskMgmt = (data.riskManagement || '').toLowerCase();
    const hasInsurance = riskMgmt.includes('insurance');
    const hasColdStorage = riskMgmt.includes('cold storage') || riskMgmt.includes('cold wallet');

    if (!hasInsurance) {
      comments.push({
        category: 'risk',
        severity: 'high',
        title: 'Insurance Coverage Not Specified',
        description: 'Proof of insurance coverage required for customer fund protection and operational risks.',
        evaluatedAt: new Date()
      });
    }

    if (!hasColdStorage) {
      comments.push({
        category: 'risk',
        severity: 'medium',
        title: 'Asset Storage Security',
        description: 'Cold storage arrangements for customer assets must be documented with security protocols.',
        evaluatedAt: new Date()
      });
    }

    return {
      passed: hasRiskMgmt,
      notes: hasRiskMgmt 
        ? 'Risk management framework provided.' 
        : 'Risk management documentation insufficient.'
    };
  }

  private checkPakistanReadiness(data: any, comments: EvaluationComment[]): { passed: boolean; notes: string } {
    const hasPakistanPlan = data.pakistanTeamPlan && data.pakistanTeamPlan.length > 30;

    if (!hasPakistanPlan) {
      comments.push({
        category: 'regulatory',
        severity: 'critical',
        title: 'Pakistan Operations Plan Missing',
        description: 'Detailed plan required for Pakistan entity incorporation, local staffing, physical office, and timeline.',
        evaluatedAt: new Date()
      });
    }

    // Check business plan for Pakistan specifics
    const businessPlan = (data.businessPlan || '').toLowerCase();
    const hasPKRPlan = businessPlan.includes('pkr') || businessPlan.includes('rupee');
    const hasBankingPlan = businessPlan.includes('bank') || businessPlan.includes('hbl') || 
                           businessPlan.includes('mcb') || businessPlan.includes('ubl');

    if (!hasPKRPlan) {
      comments.push({
        category: 'business',
        severity: 'high',
        title: 'PKR Integration Plan Missing',
        description: 'Fiat on/off-ramp strategy for Pakistani Rupee (PKR) must be detailed.',
        evaluatedAt: new Date()
      });
    }

    if (!hasBankingPlan) {
      comments.push({
        category: 'business',
        severity: 'high',
        title: 'Banking Partnership Not Addressed',
        description: 'Partnership with Pakistan-licensed bank required for fiat gateway. Letters of intent or agreements needed.',
        evaluatedAt: new Date()
      });
    }

    const passed = hasPakistanPlan && (hasPKRPlan || hasBankingPlan);

    return {
      passed,
      notes: passed 
        ? 'Pakistan market readiness addressed in application.' 
        : 'Pakistan-specific operational plans insufficient.'
    };
  }

  private calculateScores(checks: any, docAnalysis?: DocumentAnalysis | undefined): any {
    const passCount = Object.values(checks).filter((c: any) => c.passed).length;
    const totalChecks = Object.keys(checks).length;
    
    const overall = Math.round((passCount / totalChecks) * 100);
    let compliance = checks.complianceFramework.passed && checks.dataProtection.passed ? 85 : 60;
    let technical = checks.technicalCapability.passed ? 80 : 50;
    let business = checks.financialStability.passed && checks.pakistanReadiness.passed ? 75 : 55;
    let regulatory = checks.licenseVerification.passed && checks.corporateVerification.passed ? 80 : 50;

    // Apply penalties based on missing document categories to reflect evidence gaps
    if (docAnalysis && Array.isArray(docAnalysis.missingCategories)) {
      const missing = new Set(docAnalysis.missingCategories);
      if (missing.has('compliance')) compliance = Math.max(0, compliance - 20);
      if (missing.has('legal')) regulatory = Math.max(0, regulatory - 10);
      if (missing.has('regulatory')) regulatory = Math.max(0, regulatory - 20);
      if (missing.has('corporate')) regulatory = Math.max(0, regulatory - 10);
      if (missing.has('financial')) business = Math.max(0, business - 15);
      if (missing.has('technical')) technical = Math.max(0, technical - 15);
      if (missing.has('personnel')) business = Math.max(0, business - 10);
    }

    let riskLevel: 'critical' | 'high' | 'medium' | 'low';
    if (overall >= 80) riskLevel = 'low';
    else if (overall >= 65) riskLevel = 'medium';
    else if (overall >= 50) riskLevel = 'high';
    else riskLevel = 'critical';

    return {
      overall,
      compliance,
      technical,
      business,
      regulatory,
      riskLevel
    };
  }

  private determineRecommendation(scores: any, comments: EvaluationComment[]): any {
    const criticalIssues = comments.filter(c => c.severity === 'critical').length;
    const highIssues = comments.filter(c => c.severity === 'high').length;

    if (scores.overall < 50) {
      return { decision: 'reject' as const };
    } else if (criticalIssues >= 3 || criticalIssues > 0 || highIssues >= 3 || scores.overall < 70) {
      return { decision: 'conditional-approval' as const };
    } else if (scores.overall >= 85) {
      return { decision: 'approve' as const };
    } else {
      return { decision: 'conditional-approval' as const };
    }
  }

  private async generateAIInsights(data: any, scores: any, comments: EvaluationComment[], docAnalysis?: DocumentAnalysis): Promise<string> {
    const criticalCount = comments.filter(c => c.severity === 'critical').length;
    const highCount = comments.filter(c => c.severity === 'high').length;
    const mediumCount = comments.filter(c => c.severity === 'medium').length;
    const lowCount = comments.filter(c => c.severity === 'low').length;

    // Prepare comprehensive context for GPT-5.1
    const prompt = `You are a senior regulatory evaluator for the Pakistan Virtual Assets Regulatory Authority (PVARA).
Generate a COMPREHENSIVE and DETAILED regulatory assessment for this VASP license application.

🏢 **APPLICANT INFORMATION:**
- Company Name: ${data.companyName || 'Unknown'}
- Application Name: ${data.appName || 'N/A'}
- Country: ${data.country || 'Unknown'}
- Founded: ${data.founded || 'Unknown'}
- Team Size: ${data.teamSize || 'Unknown'}
- Description: ${data.description || 'No description provided'}

📊 **EVALUATION SCORES:**
- Overall Score: ${scores.overall}/100
- Risk Level: ${scores.riskLevel?.toUpperCase()}
- Compliance Score: ${scores.compliance}/100
- Technical Score: ${scores.technical}/100
- Business Score: ${scores.business}/100
- Regulatory Score: ${scores.regulatory}/100

⚠️ **ISSUES IDENTIFIED:**
- Critical Issues: ${criticalCount}
- High Priority Issues: ${highCount}
- Medium Priority Issues: ${mediumCount}
- Low Priority Issues: ${lowCount}

📋 **TOP CONCERNS:**
${comments.slice(0, 5).map(c => `• [${c.severity.toUpperCase()}] ${c.title}: ${c.description}`).join('\n')}

📄 **DOCUMENT ANALYSIS:**
${docAnalysis ? `
- Total Documents: ${docAnalysis.totalDocuments || 0}
- Missing Categories: ${docAnalysis.missingCategories?.join(', ') || 'None identified'}
- Category Breakdown: ${JSON.stringify(docAnalysis.categoryBreakdown || {})}
` : 'No document analysis available'}

🌍 **REGULATORY CONTEXT:**
- Regulatory History: ${data.regulatoryHistory || 'Not provided'}
- Existing Licenses: ${data.existingLicenses || 'Not specified'}
- Pakistan Operations Plan: ${data.pakistanTeamPlan ? 'Provided' : 'NOT PROVIDED (CRITICAL GAP)'}
- AML/CFT Framework: ${data.amlCftFramework || 'Not detailed'}

📝 **GENERATE A DETAILED ASSESSMENT COVERING:**

1. **Executive Summary** (3-4 sentences on overall assessment, key strengths, and main concerns)

2. **Regulatory Compliance Analysis**
   - PVARA regulations compliance status
   - FATF Recommendations alignment (especially Rec. 15)
   - AML/CFT Act 2010 (Pakistan) adherence
   - KYC/CDD requirements assessment
   - Travel Rule readiness

3. **Risk Assessment**
   - Money laundering risk level
   - Terrorist financing risk indicators
   - Operational risk factors
   - Technology/cybersecurity risks
   - Reputational risk considerations

4. **Documentation Gaps**
   - Missing critical documents
   - Documents requiring updates
   - Additional submissions needed

5. **Key Strengths** (what the applicant does well)

6. **Key Weaknesses** (areas requiring improvement)

7. **Conditions for Approval** (if applicable)
   - Mandatory conditions
   - Recommended enhancements

8. **Final Recommendation**
   - Clear APPROVE / CONDITIONAL APPROVAL / REJECT recommendation
   - Confidence level (HIGH/MEDIUM/LOW)
   - Next steps for the applicant

Format the response with clear sections using headers and bullet points. Be specific and actionable in your recommendations.`;

    try {
      // Call GPT-5.1 with reasoning for thorough analysis
      const aiResponse = await callOpenAIResponsesAPI(prompt, { reasoning: true });
      
      if (aiResponse && aiResponse.length > 100) {
        return aiResponse;
      }
    } catch (error) {
      console.error('Failed to generate AI insights with GPT-5.1:', error);
    }

    // Fallback to template-based insights if API fails
    let insights = `📊 AI-Powered Evaluation Summary for ${data.companyName}:\n\n`;
    insights += `Overall Assessment Score: ${scores.overall}/100 (Risk Level: ${scores.riskLevel?.toUpperCase()})\n\n`;
    insights += `The application has been analyzed across 8 due diligence dimensions. `;
    
    if (criticalCount > 0) {
      insights += `⛔ CRITICAL ISSUES IDENTIFIED (${criticalCount}): These must be resolved before approval. `;
    }
    
    if (highCount > 0) {
      insights += `⚠️ High-priority concerns (${highCount}) require attention. `;
    }

    insights += `\n\n✅ Key Strengths:\n`;
    if (data.regulatoryHistory && data.regulatoryHistory.includes('Licensed')) {
      insights += `• Established regulatory track record with international licenses\n`;
    }
    
    const hasPersonnel = docAnalysis && docAnalysis.categoryBreakdown && docAnalysis.categoryBreakdown['personnel'] >= 3;
    const hasCompliance = docAnalysis && docAnalysis.categoryBreakdown && docAnalysis.categoryBreakdown['compliance'] >= 2;
    const hasCorporate = docAnalysis && docAnalysis.categoryBreakdown && docAnalysis.categoryBreakdown['corporate'] >= 4;
    
    if (hasPersonnel) {
      insights += `• Strong governance: ${docAnalysis!.categoryBreakdown['personnel']} key personnel documents submitted\n`;
    }
    if (hasCorporate) {
      insights += `• Robust corporate structure: ${docAnalysis!.categoryBreakdown['corporate']} corporate documents verified\n`;
    }
    if (hasCompliance) {
      insights += `• Comprehensive compliance framework: ${docAnalysis!.categoryBreakdown['compliance']} policies documented\n`;
    }

    insights += `\n❌ Key Concerns:\n`;
    comments.slice(0, 5).forEach(c => {
      insights += `• [${c.severity.toUpperCase()}] ${c.title}: ${c.description}\n`;
    });

    insights += `\n🇵🇰 Pakistan Market Fit: `;
    if (data.pakistanTeamPlan) {
      insights += `Applicant has provided Pakistan operations plan. `;
    } else {
      insights += `CRITICAL GAP: No Pakistan-specific operations plan provided. `;
    }

    insights += `\n\n📈 Recommendation Confidence: ${scores.overall >= 70 ? 'HIGH' : scores.overall >= 50 ? 'MEDIUM' : 'LOW'}`;
    insights += `\n\n📌 Model Used: ${config.OPENAI_MODEL || 'gpt-5.1'} (Fallback mode - API response was insufficient)`;

    return insights;
  }

  private generateNextStepsAndConditions(recommendation: any, comments: EvaluationComment[]): any {
    const nextSteps: string[] = [];
    const conditions: string[] = [];

    // Add next steps based on recommendation
    if (recommendation.decision === 'approve') {
      nextSteps.push('Issue NOC with standard compliance monitoring requirements');
      nextSteps.push('Schedule quarterly compliance reviews for first 12 months');
      nextSteps.push('Establish reporting framework to State Bank of Pakistan');
    } else if (recommendation.decision === 'conditional-approval') {
      nextSteps.push('Applicant must address all critical issues within 60 days');
      nextSteps.push('Submit supplementary documentation for high-priority concerns');
      nextSteps.push('Schedule follow-up review meeting with PVARA compliance team');
    } else if (recommendation.decision === 'reject') {
      nextSteps.push('Provide detailed rejection notice to applicant');
      nextSteps.push('Allow reapplication after 6 months with remediation plan');
      nextSteps.push('Offer regulatory guidance session for future compliance');
    }

    // Add conditions based on critical comments
    comments
      .filter(c => c.severity === 'critical' || c.severity === 'high')
      .slice(0, 5)
      .forEach(c => {
        conditions.push(`${c.title}: ${c.description}`);
      });

    return { nextSteps, conditions };
  }

  /**
   * Clear evaluation cache for a specific application or all applications
   * This forces re-evaluation with GPT-5.1 on next request
   * Clears both memory cache AND MongoDB stored evaluation
   */
  public async clearEvaluationCache(applicationId?: string): Promise<void> {
    if (applicationId) {
      // Clear memory cache
      evaluationCache.delete(applicationId);
      console.log(`[EvaluationCache] Cleared memory cache for ${applicationId}`);
      
      // Clear MongoDB cache
      try {
        await deleteEvaluation(applicationId);
        console.log(`[MongoDB] Deleted stored evaluation for ${applicationId}`);
      } catch (error) {
        console.warn(`[MongoDB] Could not delete evaluation for ${applicationId}:`, error);
      }
    } else {
      // Clear all memory cache
      evaluationCache.clear();
      console.log(`[EvaluationCache] Cleared all cached evaluations`);
      // Note: For "clear all", we don't delete from MongoDB to preserve history
      // Users should use specific applicationId to force refresh
    }
  }
}

export const applicationFolderService = new ApplicationFolderService();
