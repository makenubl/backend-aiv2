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
interface AccessGrant {
    _id?: string;
    applicationId: string;
    email: string;
    role: 'viewer' | 'editor' | 'admin';
    permissions: Array<'view' | 'edit' | 'delete'>;
    invitedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}
interface ChatMessage {
    _id?: string;
    applicationId: string;
    documentName?: string;
    role: 'user' | 'assistant';
    message: string;
    recommendationIds?: string[];
    actions?: Array<{
        type: 'accept' | 'reject';
        ids: string[];
    }>;
    createdAt: Date;
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
export declare const seedDefaultUsers: () => Promise<void>;
export declare const getEvaluationsCollection: () => Collection<StoredEvaluation>;
export declare const getRecommendationsCollection: () => Collection<DocumentRecommendationTrail>;
export declare const getAccessCollection: () => Collection<AccessGrant>;
export declare const getChatCollection: () => Collection<ChatMessage>;
export declare const saveEvaluation: (applicationId: string, evaluation: any) => Promise<void>;
export declare const getEvaluation: (applicationId: string) => Promise<any | null>;
export declare const getAllEvaluations: () => Promise<StoredEvaluation[]>;
export declare const saveRecommendationsVersion: (applicationId: string, documentName: string, version: number, recommendations: RecommendationItem[], originalExtract?: string) => Promise<void>;
export declare const getRecommendationsTrail: (applicationId: string, documentName?: string) => Promise<DocumentRecommendationTrail[]>;
export declare const updateRecommendationStatus: (applicationId: string, documentName: string, version: number, ids: string[], status: "accepted" | "rejected") => Promise<void>;
export declare const upsertAccessGrant: (applicationId: string, email: string, role: AccessGrant["role"], permissions: AccessGrant["permissions"], invitedBy?: string) => Promise<void>;
export declare const listAccessGrants: (applicationId: string) => Promise<AccessGrant[]>;
export declare const removeAccessGrant: (applicationId: string, email: string) => Promise<void>;
export declare const hasAccess: (applicationId: string, email: string | undefined, required: "view" | "edit" | "delete") => Promise<boolean>;
export declare const insertChatMessage: (applicationId: string, documentName: string | undefined, role: ChatMessage["role"], message: string, recommendationIds?: string[], actions?: ChatMessage["actions"]) => Promise<void>;
export declare const listChatMessages: (applicationId: string, documentName?: string, limit?: number) => Promise<ChatMessage[]>;
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
    getAllEvaluations: () => Promise<StoredEvaluation[]>;
    getRecommendationsCollection: () => Collection<DocumentRecommendationTrail>;
    saveRecommendationsVersion: (applicationId: string, documentName: string, version: number, recommendations: RecommendationItem[], originalExtract?: string) => Promise<void>;
    getRecommendationsTrail: (applicationId: string, documentName?: string) => Promise<DocumentRecommendationTrail[]>;
    updateRecommendationStatus: (applicationId: string, documentName: string, version: number, ids: string[], status: "accepted" | "rejected") => Promise<void>;
    getAccessCollection: () => Collection<AccessGrant>;
    upsertAccessGrant: (applicationId: string, email: string, role: AccessGrant["role"], permissions: AccessGrant["permissions"], invitedBy?: string) => Promise<void>;
    listAccessGrants: (applicationId: string) => Promise<AccessGrant[]>;
    removeAccessGrant: (applicationId: string, email: string) => Promise<void>;
    hasAccess: (applicationId: string, email: string | undefined, required: "view" | "edit" | "delete") => Promise<boolean>;
    getChatCollection: () => Collection<ChatMessage>;
    insertChatMessage: (applicationId: string, documentName: string | undefined, role: ChatMessage["role"], message: string, recommendationIds?: string[], actions?: ChatMessage["actions"]) => Promise<void>;
    listChatMessages: (applicationId: string, documentName?: string, limit?: number) => Promise<ChatMessage[]>;
};
export default _default;
//# sourceMappingURL=database.service.d.ts.map