import { getRecommendationsTrail } from './database.service';
export interface GeneratedRecommendation {
    id: string;
    point: string;
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: Date;
}
export declare function generateRecommendationsForUpload(applicationId: string, documentPath: string, documentName: string): Promise<{
    version: number;
    recommendations: GeneratedRecommendation[];
    extract: string;
}>;
export declare function acceptOrRejectRecommendations(applicationId: string, documentName: string, version: number, acceptIds: string[], rejectIds: string[]): Promise<void>;
export declare function listRecommendations(applicationId: string, documentName?: string): Promise<ReturnType<typeof getRecommendationsTrail>>;
//# sourceMappingURL=recommendations.service.d.ts.map