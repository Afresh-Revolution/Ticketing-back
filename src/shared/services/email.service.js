import { Resend } from 'resend';
import QRCode from 'qrcode';
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

/** Send digital ticket email with QR code (after payment success). */
export async function sendTicketEmail({ to, fullName, ticketCode, eventTitle, eventDate }) {
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(ticketCode, { margin: 2, width: 200 });
  } catch (qrErr) {
    console.warn('[email] QR generation failed:', qrErr.message);
  }
  const dateStr = eventDate ? new Date(eventDate).toLocaleDateString('en-NG', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const subject = 'Your ticket – ' + (eventTitle || 'Event');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f8f9fa; border-radius: 12px;">
      <h2 style="color: #791A94; margin-top: 0;">Gatewave Ticket</h2>
      <p>Hi ${fullName || 'there'},</p>
      <p>Your payment was successful. Here is your digital ticket.</p>
      <div style="background: #fff; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0; border: 1px solid #e0e0e0;">
        <p style="margin: 0 0 8px 0; font-weight: bold; color: #1a1a2e;">${eventTitle || 'Event'}</p>
        <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">${dateStr}</p>
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #999;">Ticket code</p>
        <p style="margin: 0 0 12px 0; font-size: 18px; font-weight: bold; letter-spacing: 2px;">${ticketCode}</p>
        ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR code" width="200" height="200" style="display: block; margin: 0 auto;" />` : ''}
      </div>
      <p style="color: #666; font-size: 12px;">Show this QR code at the venue for entry.</p>
    </div>
  `;
  return sendEmail({ to, subject, html });
}
