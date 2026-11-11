import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;
let lastHost = '';
let lastPort = '';
let lastUser = '';
let lastPass = '';

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    return null;
  }

  // If credentials change at runtime, re-create transporter
  if (!transporter || host !== lastHost || String(port) !== lastPort || user !== lastUser || pass !== lastPass) {
    lastHost = host;
    lastPort = String(port);
    lastUser = user || '';
    lastPass = pass || '';

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: user ? {
        user,
        pass,
      } : undefined,
    });
  }

  return transporter;
}

export function getFormattedFromAddress(): string {
  const customFrom = (process.env.SMTP_FROM || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();

  if (customFrom) {
    if (customFrom.includes('@')) {
      return customFrom;
    }
    // Name only, e.g. "hellomyphotos" -> combine with authenticated SMTP_USER email
    if (smtpUser && smtpUser.includes('@')) {
      const cleanName = customFrom.replace(/"/g, '');
      return `"${cleanName}" <${smtpUser}>`;
    }
    return `"${customFrom}" <no-reply@hellomyphotos.local>`;
  }

  if (smtpUser && smtpUser.includes('@')) {
    return `"hellomyphotos" <${smtpUser}>`;
  }

  return '"hellomyphotos" <no-reply@hellomyphotos.local>';
}

export async function sendPlainTextEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) {
    console.warn('[Mailer] SMTP not configured (SMTP_HOST is empty). Skipping email to:', to);
    return false;
  }

  const from = getFormattedFromAddress();

  try {
    const info = await mailer.sendMail({
      from,
      to,
      subject,
      text, // strictly plain text, no HTML
    });
    console.log(`[Mailer] Plain text email sent successfully to ${to} (MessageId: ${info.messageId})`);
    return true;
  } catch (error) {
    console.error('[Mailer] Failed to send email:', error);
    return false;
  }
}
