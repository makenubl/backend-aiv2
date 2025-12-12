import { NOCApplication, EvaluationResult } from '../types';
export declare class EvaluationService {
    evaluateApplicationSingleCall(application: NOCApplication, contextFiles?: string[]): Promise<EvaluationResult>;
    evaluateApplication(application: NOCApplication, contextFiles?: string[]): Promise<EvaluationResult>;
    private assessCompliance;
    private assessRisk;
    private generateSummary;
    processVoiceQuery(query: string, applicationId: string): Promise<string>;
    generateTextToSpeech(text: string): Promise<Buffer>;
}
export declare const evaluationService: EvaluationService;
//# sourceMappingURL=evaluation.service.d.ts.map