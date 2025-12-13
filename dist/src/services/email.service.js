"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser || 'no-reply@pvara.ai';
function createTransport() {
    if (!smtpHost || !smtpUser || !smtpPass) {
        console.warn('Email transport not configured; emails will be logged only');
        return null;
    }
    return nodemailer_1.default.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass }
    });
}
const transport = createTransport();
exports.emailService = {
    async sendInviteEmail(payload) {
        const subject = `You have been granted access to ${payload.folder}`;
        const text = [
            `Hello,`,
            '',
            `${payload.invitedBy || 'A teammate'} has shared the folder "${payload.folder}" with you as ${payload.role}.`,
            payload.link ? `Access it here: ${payload.link}` : 'Log in to view the folder.',
            '',
            'If you did not expect this email, you can ignore it.',
            '',
            '— PVARA AI Storage'
        ].join('\n');
        if (!transport) {
            console.info('[Email:Invite][DRY_RUN]', { to: payload.to, subject, text });
            return;
        }
        await transport.sendMail({
            from: smtpFrom,
            to: payload.to,
            subject,
            text,
        });
    }
};
exports.default = exports.emailService;
//# sourceMappingURL=email.service.js.map