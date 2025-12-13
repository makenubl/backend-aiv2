import { listChatMessages } from './database.service';
export declare function chatAboutRecommendations(applicationId: string, documentName: string | undefined, message: string): Promise<{
    reply: string;
    applied?: string[];
    history: any[];
}>;
export declare function listStorageChat(applicationId: string, documentName?: string): Promise<Awaited<ReturnType<typeof listChatMessages>>>;
//# sourceMappingURL=storage-chat.service.d.ts.map