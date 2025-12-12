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
Object.defineProperty(exports, "__esModule", { value: true });
exports.applicationFolderService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const document_analyzer_service_1 = require("./document-analyzer.service");
class ApplicationFolderService {
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
    folderExists(folderPath) {
        return fs.existsSync(folderPath);
    }
    ensureApplicationsFolder() {
        if (!fs.existsSync(this.applicationsBasePath)) {
            fs.mkdirSync(this.applicationsBasePath, { recursive: true });
        }
    }
    /**
     * Scan applications folder and return all applications
     */
    async scanApplications() {
        const applications = [];
        try {
            const folders = fs.readdirSync(this.applicationsBasePath, { withFileTypes: true });
            for (const folder of folders) {
                if (folder.isDirectory() && !folder.name.startsWith('.')) {
                    const folderPath = path.join(this.applicationsBasePath, folder.name);
                    const applicationJsonPath = path.join(folderPath, 'application.json');
                    if (fs.existsSync(applicationJsonPath)) {
                        const applicationData = JSON.parse(fs.readFileSync(applicationJsonPath, 'utf-8'));
                        const documents = this.scanDocuments(folderPath);
                        const analysis = document_analyzer_service_1.documentAnalyzerService.analyzeDocuments(applicationData.id || folder.name, documents);
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
            return applications.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
        }
        catch (error) {
            console.error('Error scanning applications:', error);
            return [];
        }
    }
    /**
     * Scan documents in application folder (recursively)
     */
    scanDocuments(folderPath) {
        const documents = [];
        const scanDir = (dir, prefix = '') => {
            if (!fs.existsSync(dir))
                return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.'))
                    continue;
                const entryPath = path.join(dir, entry.name);
                const displayName = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    scanDir(entryPath, displayName);
                }
                else if (entry.name.match(/\.(pdf|docx|doc|xlsx|png|jpg|jpeg)$/i)) {
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
                    appData.documents.forEach((doc) => {
                        if (!documents.includes(doc)) {
                            documents.push(doc);
                        }
                    });
                }
            }
        }
        catch (error) {
            console.error('Error scanning documents:', error);
        }
        return documents;
    }
    /**
     * Perform comprehensive due diligence evaluation
     */
    async evaluateApplication(applicationId) {
        const applications = await this.scanApplications();
        const app = applications.find(a => a.id === applicationId);
        if (!app) {
            throw new Error(`Application ${applicationId} not found`);
        }
        const data = app.applicationData;
        const docAnalysis = app.documentsAnalysis;
        const comments = [];
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
                const severity = (cat === 'regulatory' || cat === 'compliance') ? 'critical' : 'high';
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
        // Generate AI insights
        const aiInsights = this.generateAIInsights(data, scores, comments, docAnalysis);
        // Optional: AI per-document categorization to enrich evaluation
        let aiDocCategories;
        try {
            const path = require('path');
            const companyName = data.companyName || 'Unknown';
            aiDocCategories = await Promise.all(app.documents.map(async (docName) => {
                const filePath = path.join(app.folderPath, 'documents', docName);
                return document_analyzer_service_1.documentAnalyzerService.categorizeDocumentWithAI(applicationId, companyName, filePath, docName);
            }));
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
        }
        catch (e) {
            // Non-fatal: proceed without AI categories if any issue
        }
        // Generate next steps and conditions
        const { nextSteps, conditions } = this.generateNextStepsAndConditions(recommendation, comments);
        return {
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
            modelUsed: 'gpt-5.2',
            nextSteps,
            conditions,
            evaluatedAt: new Date()
        };
    }
    checkCorporateVerification(data, comments) {
        const issues = [];
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
    checkLicenseVerification(data, comments) {
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
    checkFinancialStability(data, comments) {
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
    checkTechnicalCapability(data, comments) {
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
    addPositiveTechnicalComment(data, comments, passed) {
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
    checkComplianceFramework(data, comments) {
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
    checkDataProtection(data, comments) {
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
    checkRiskManagement(data, comments) {
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
    checkPakistanReadiness(data, comments) {
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
    calculateScores(checks, docAnalysis) {
        const passCount = Object.values(checks).filter((c) => c.passed).length;
        const totalChecks = Object.keys(checks).length;
        const overall = Math.round((passCount / totalChecks) * 100);
        let compliance = checks.complianceFramework.passed && checks.dataProtection.passed ? 85 : 60;
        let technical = checks.technicalCapability.passed ? 80 : 50;
        let business = checks.financialStability.passed && checks.pakistanReadiness.passed ? 75 : 55;
        let regulatory = checks.licenseVerification.passed && checks.corporateVerification.passed ? 80 : 50;
        // Apply penalties based on missing document categories to reflect evidence gaps
        if (docAnalysis && Array.isArray(docAnalysis.missingCategories)) {
            const missing = new Set(docAnalysis.missingCategories);
            if (missing.has('compliance'))
                compliance = Math.max(0, compliance - 20);
            if (missing.has('legal'))
                regulatory = Math.max(0, regulatory - 10);
            if (missing.has('regulatory'))
                regulatory = Math.max(0, regulatory - 20);
            if (missing.has('corporate'))
                regulatory = Math.max(0, regulatory - 10);
            if (missing.has('financial'))
                business = Math.max(0, business - 15);
            if (missing.has('technical'))
                technical = Math.max(0, technical - 15);
            if (missing.has('personnel'))
                business = Math.max(0, business - 10);
        }
        let riskLevel;
        if (overall >= 80)
            riskLevel = 'low';
        else if (overall >= 65)
            riskLevel = 'medium';
        else if (overall >= 50)
            riskLevel = 'high';
        else
            riskLevel = 'critical';
        return {
            overall,
            compliance,
            technical,
            business,
            regulatory,
            riskLevel
        };
    }
    determineRecommendation(scores, comments) {
        const criticalIssues = comments.filter(c => c.severity === 'critical').length;
        const highIssues = comments.filter(c => c.severity === 'high').length;
        if (scores.overall < 50) {
            return { decision: 'reject' };
        }
        else if (criticalIssues >= 3 || criticalIssues > 0 || highIssues >= 3 || scores.overall < 70) {
            return { decision: 'conditional-approval' };
        }
        else if (scores.overall >= 85) {
            return { decision: 'approve' };
        }
        else {
            return { decision: 'conditional-approval' };
        }
    }
    generateAIInsights(data, scores, comments, docAnalysis) {
        const criticalCount = comments.filter(c => c.severity === 'critical').length;
        const highCount = comments.filter(c => c.severity === 'high').length;
        let insights = `AI-Powered Evaluation Summary for ${data.companyName}:\n\n`;
        insights += `Overall Assessment Score: ${scores.overall}/100 (Risk Level: ${scores.riskLevel.toUpperCase()})\n\n`;
        insights += `The application has been analyzed across 8 due diligence dimensions. `;
        if (criticalCount > 0) {
            insights += `CRITICAL ISSUES IDENTIFIED (${criticalCount}): These must be resolved before approval. `;
        }
        if (highCount > 0) {
            insights += `High-priority concerns (${highCount}) require attention. `;
        }
        insights += `\n\nKey Strengths:\n`;
        if (data.regulatoryHistory && data.regulatoryHistory.includes('Licensed')) {
            insights += `• Established regulatory track record with international licenses\n`;
        }
        // Evidence from submitted documents
        const hasPersonnel = docAnalysis && docAnalysis.categoryBreakdown['personnel'] >= 3;
        const hasCompliance = docAnalysis && docAnalysis.categoryBreakdown['compliance'] >= 2;
        const hasCorporate = docAnalysis && docAnalysis.categoryBreakdown['corporate'] >= 4;
        if (hasPersonnel) {
            insights += `• Strong governance: ${docAnalysis.categoryBreakdown['personnel']} key personnel documents submitted\n`;
        }
        if (hasCorporate) {
            insights += `• Robust corporate structure: ${docAnalysis.categoryBreakdown['corporate']} corporate documents verified\n`;
        }
        if (hasCompliance) {
            insights += `• Comprehensive compliance framework: ${docAnalysis.categoryBreakdown['compliance']} policies documented\n`;
        }
        insights += `\nKey Concerns:\n`;
        comments.slice(0, 3).forEach(c => {
            insights += `• ${c.title}: ${c.description}\n`;
        });
        insights += `\nPakistan Market Fit: `;
        if (data.pakistanTeamPlan) {
            insights += `Applicant has provided Pakistan operations plan. `;
        }
        else {
            insights += `CRITICAL GAP: No Pakistan-specific operations plan. `;
        }
        insights += `\n\nRecommendation Confidence: ${scores.overall >= 70 ? 'HIGH' : scores.overall >= 50 ? 'MEDIUM' : 'LOW'}`;
        return insights;
    }
    generateNextStepsAndConditions(recommendation, comments) {
        const nextSteps = [];
        const conditions = [];
        // Add next steps based on recommendation
        if (recommendation.decision === 'approve') {
            nextSteps.push('Issue NOC with standard compliance monitoring requirements');
            nextSteps.push('Schedule quarterly compliance reviews for first 12 months');
            nextSteps.push('Establish reporting framework to State Bank of Pakistan');
        }
        else if (recommendation.decision === 'conditional-approval') {
            nextSteps.push('Applicant must address all critical issues within 60 days');
            nextSteps.push('Submit supplementary documentation for high-priority concerns');
            nextSteps.push('Schedule follow-up review meeting with PVARA compliance team');
        }
        else if (recommendation.decision === 'reject') {
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
}
exports.applicationFolderService = new ApplicationFolderService();
//# sourceMappingURL=application-folder.service.js.map