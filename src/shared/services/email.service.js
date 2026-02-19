import { Resend } from 'resend';
import { config } from '../config/env.js';

const EMAIL_TIMEOUT_MS = 15000;

let resendClient = null;

function getResend() {
  if (resendClient) return resendClient;
  const { resend } = config;
  if (!resend.apiKey) {
    console.warn('[email] Resend not configured (RESEND_API_KEY missing). Emails will be logged only.');
  }
  resendClient = new Resend(resend.apiKey || 'placeholder');
  return resendClient;
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
  const { resend } = config;
  if (!resend.apiKey) {
    console.log('[email] (Resend not configured) Would send:', { to, subject, text: (text || html)?.slice(0, 80) });
    return { ok: true, simulated: true };
  }

  try {
    const sendPromise = getResend().emails.send({
      from: resend.from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || text || '',
      text: text || (html ? html.replace(/<[^>]+>/g, '') : ''),
    });

    const result = await withTimeout(sendPromise, EMAIL_TIMEOUT_MS);

    if (result.error) {
      console.error('[email] Resend error:', result.error);
      throw new Error(result.error.message || 'Email send failed');
    }

    return { ok: true, messageId: result.data?.id };
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
