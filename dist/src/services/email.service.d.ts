export interface InviteEmailPayload {
    to: string;
    folder: string;
    role: string;
    invitedBy?: string;
    link?: string;
}
export declare const emailService: {
    sendInviteEmail(payload: InviteEmailPayload): Promise<void>;
};
export default emailService;
//# sourceMappingURL=email.service.d.ts.map