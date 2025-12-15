import { Collection } from 'mongodb';
interface User {
    _id?: string;
    username: string;
    email: string;
    password: string;
    name: string;
    role: 'admin' | 'evaluator' | 'reviewer';
    createdAt?: Date;
    updatedAt?: Date;
}
interface StoredEvaluation {
    _id?: string;
    applicationId: string;
    evaluation: any;
    createdAt: Date;
    updatedAt: Date;
}
interface RecommendationItem {
    id: string;
    point: string;
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: Date;
    updatedAt?: Date;
}
interface DocumentRecommendationTrail {
    _id?: string;
    applicationId: string;
    documentName: string;
    version: number;
    recommendations: RecommendationItem[];
    originalExtract?: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare const connectDatabase: () => Promise<void>;
export declare const disconnectDatabase: () => Promise<void>;
export declare const getUsersCollection: () => Collection<User>;
export declare const findUserByUsername: (username: string) => Promise<User | null>;
export declare const findUserByEmail: (email: string) => Promise<User | null>;
export declare const createUser: (user: Omit<User, "_id">) => Promise<User>;
export declare const getAllUsers: () => Promise<User[]>;
export declare const updateUser: (username: string, updates: Partial<Omit<User, "_id" | "createdAt">>) => Promise<User | null>;
export declare const deleteUser: (username: string) => Promise<boolean>;
export declare const seedDefaultUsers: () => Promise<void>;
export declare const getEvaluationsCollection: () => Collection<StoredEvaluation>;
export declare const getRecommendationsCollection: () => Collection<DocumentRecommendationTrail>;
export declare const saveEvaluation: (applicationId: string, evaluation: any) => Promise<void>;
export declare const getEvaluation: (applicationId: string) => Promise<any | null>;
export declare const deleteEvaluation: (applicationId: string) => Promise<boolean>;
export declare const getAllEvaluations: () => Promise<StoredEvaluation[]>;
export declare const saveRecommendationsVersion: (applicationId: string, documentName: string, version: number, recommendations: RecommendationItem[], originalExtract?: string) => Promise<void>;
export declare const getRecommendationsTrail: (applicationId: string, documentName?: string) => Promise<DocumentRecommendationTrail[]>;
export declare const updateRecommendationStatus: (applicationId: string, documentName: string, version: number, ids: string[], status: "accepted" | "rejected") => Promise<void>;
export declare const deleteRecommendationsForDocument: (applicationId: string, documentName: string) => Promise<void>;
declare const _default: {
    connectDatabase: () => Promise<void>;
    disconnectDatabase: () => Promise<void>;
    getUsersCollection: () => Collection<User>;
    findUserByUsername: (username: string) => Promise<User | null>;
    findUserByEmail: (email: string) => Promise<User | null>;
    createUser: (user: Omit<User, "_id">) => Promise<User>;
    seedDefaultUsers: () => Promise<void>;
    getEvaluationsCollection: () => Collection<StoredEvaluation>;
    saveEvaluation: (applicationId: string, evaluation: any) => Promise<void>;
    getEvaluation: (applicationId: string) => Promise<any | null>;
    deleteEvaluation: (applicationId: string) => Promise<boolean>;
    getAllEvaluations: () => Promise<StoredEvaluation[]>;
    getRecommendationsCollection: () => Collection<DocumentRecommendationTrail>;
    saveRecommendationsVersion: (applicationId: string, documentName: string, version: number, recommendations: RecommendationItem[], originalExtract?: string) => Promise<void>;
    getRecommendationsTrail: (applicationId: string, documentName?: string) => Promise<DocumentRecommendationTrail[]>;
    updateRecommendationStatus: (applicationId: string, documentName: string, version: number, ids: string[], status: "accepted" | "rejected") => Promise<void>;
    deleteRecommendationsForDocument: (applicationId: string, documentName: string) => Promise<void>;
};
export default _default;
//# sourceMappingURL=database.service.d.ts.map