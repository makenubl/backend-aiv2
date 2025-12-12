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
export declare const connectDatabase: () => Promise<void>;
export declare const disconnectDatabase: () => Promise<void>;
export declare const getUsersCollection: () => Collection<User>;
export declare const findUserByUsername: (username: string) => Promise<User | null>;
export declare const findUserByEmail: (email: string) => Promise<User | null>;
export declare const createUser: (user: Omit<User, "_id">) => Promise<User>;
export declare const seedDefaultUsers: () => Promise<void>;
export declare const getEvaluationsCollection: () => Collection<StoredEvaluation>;
export declare const saveEvaluation: (applicationId: string, evaluation: any) => Promise<void>;
export declare const getEvaluation: (applicationId: string) => Promise<any | null>;
export declare const getAllEvaluations: () => Promise<StoredEvaluation[]>;
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
};
export default _default;
//# sourceMappingURL=database.service.d.ts.map