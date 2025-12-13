import nodemailer from 'nodemailer';

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

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass }
  });
}

const transport = createTransport();

export interface InviteEmailPayload {
  to: string;
  folder: string;
  role: string;
  invitedBy?: string;
  link?: string;
}

export const emailService = {
  async sendInviteEmail(payload: InviteEmailPayload) {
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

export default emailService;
