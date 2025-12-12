import { DocumentAnalysis, DocumentCategory } from './document-analyzer.service';
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
        corporateVerification: {
            passed: boolean;
            notes: string;
        };
        licenseVerification: {
            passed: boolean;
            notes: string;
        };
        financialStability: {
            passed: boolean;
            notes: string;
        };
        technicalCapability: {
            passed: boolean;
            notes: string;
        };
        complianceFramework: {
            passed: boolean;
            notes: string;
        };
        dataProtection: {
            passed: boolean;
            notes: string;
        };
        riskManagement: {
            passed: boolean;
            notes: string;
        };
        pakistanReadiness: {
            passed: boolean;
            notes: string;
        };
    };
    aiInsights: string;
    aiDocumentCategories?: DocumentCategory[];
    modelUsed: string;
    nextSteps: string[];
    conditions: string[];
    evaluatedAt: Date;
}
declare class ApplicationFolderService {
    private applicationsBasePath;
    constructor();
    private folderExists;
    private ensureApplicationsFolder;
    /**
     * Scan applications folder and return all applications
     */
    scanApplications(): Promise<ApplicationFolder[]>;
    /**
     * Scan documents in application folder (recursively)
     */
    private scanDocuments;
    /**
     * Perform comprehensive due diligence evaluation
     */
    evaluateApplication(applicationId: string): Promise<ComprehensiveEvaluation>;
    private checkCorporateVerification;
    private checkLicenseVerification;
    private checkFinancialStability;
    private checkTechnicalCapability;
    private addPositiveTechnicalComment;
    private checkComplianceFramework;
    private checkDataProtection;
    private checkRiskManagement;
    private checkPakistanReadiness;
    private calculateScores;
    private determineRecommendation;
    private generateAIInsights;
    private generateNextStepsAndConditions;
}
export declare const applicationFolderService: ApplicationFolderService;
export {};
//# sourceMappingURL=application-folder.service.d.ts.map