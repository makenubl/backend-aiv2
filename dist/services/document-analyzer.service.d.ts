export interface DocumentCategory {
    name: string;
    category: 'corporate' | 'compliance' | 'financial' | 'technical' | 'regulatory' | 'personnel' | 'legal' | 'other';
    subcategory: string;
    relevanceScore: number;
    notes: string;
    pvaraCategory?: 'ordinance' | 'regulations' | 'application-form' | 'submitted-application' | 'supporting-document';
    applicantName?: string;
}
export interface DocumentAnalysis {
    applicationId: string;
    totalDocuments: number;
    categorizedDocuments: DocumentCategory[];
    categoryBreakdown: Record<string, number>;
    missingCategories: string[];
    completenessScore: number;
    analysisNotes: string;
}
declare class DocumentAnalyzerService {
    private openai;
    constructor();
    /**
     * AI-based categorization of a single document using filename and optional content snippet.
     */
    categorizeDocumentWithAI(_applicationId: string, companyName: string, filePath: string, displayName?: string): Promise<DocumentCategory>;
    /**
     * Categorize a single document based on filename patterns
     */
    categorizeDocument(filename: string): DocumentCategory;
    /**
     * Analyze all documents for an application
     */
    analyzeDocuments(applicationId: string, documents: string[]): DocumentAnalysis;
    /**
     * Use AI to analyze document relevance and completeness
     */
    analyzeWithAI(applicationId: string, companyName: string, documents: string[], applicationType?: string): Promise<string>;
}
export declare const documentAnalyzerService: DocumentAnalyzerService;
export {};
//# sourceMappingURL=document-analyzer.service.d.ts.map