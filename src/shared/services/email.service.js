import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

const EMAIL_TIMEOUT_MS = 15000;

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { smtp } = config;
  if (!smtp.user || !smtp.pass) {
    console.warn('[email] SMTP not configured (SMTP_USER/SMTP_PASS missing). Emails will be logged only.');
  }
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  });
  return transporter;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Email delivery timed out. Please try again.')), ms)
    ),
  ]);
}

export async function sendEmail({ to, subject, text, html }) {
  const { smtp } = config;
  const mailOptions = {
    from: smtp.from,
    to,
    subject,
    text: text || html?.replace(/<[^>]+>/g, '') || '',
    html: html || text,
  };

  if (!smtp.user || !smtp.pass) {
    console.log('[email] (SMTP not configured) Would send:', { to, subject, text: text?.slice(0, 80) });
    return { ok: true, simulated: true };
  }

  try {
    const sendPromise = getTransporter().sendMail(mailOptions);
    const info = await withTimeout(sendPromise, EMAIL_TIMEOUT_MS);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    throw err;
  }
}

export function sendOtpEmail(to, code, type = 'verification') {
  const isForgot = type === 'forgot_password';
  const subject = isForgot ? 'Reset your password – Gatewave' : 'Verify your email – Gatewave';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #791A94;">Gatewave</h2>
      <p>${isForgot ? 'Use the code below to reset your password:' : 'Use the code below to verify your email on first login:'}</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #1a1a2e;">${code}</p>
      <p style="color: #666;">This code expires in 10 minutes. Do not share it with anyone.</p>
      <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email.</p>
    </div>
  `;
  return sendEmail({ to, subject, html });
}
