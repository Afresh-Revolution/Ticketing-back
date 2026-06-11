import { config } from '../config/env.js';

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;
  const host = config.smtpHost || process.env.SMTP_HOST;
  const user = config.smtpUser || process.env.SMTP_USER;
  const pass = config.smtpPass || process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  const nodemailer = await import('nodemailer');
  transporter = nodemailer.createTransport({
    host,
    port: Number(config.smtpPort || process.env.SMTP_PORT || 587),
    secure: String(config.smtpSecure || process.env.SMTP_SECURE || '') === 'true',
    auth: { user, pass },
  });
  return transporter;
}

export async function sendEmail({ to, subject, html, text }) {
  const from = config.mailFrom || process.env.MAIL_FROM || 'GateWav <noreply@gatewav.com>';
  const transport = await getTransporter();

  if (!transport) {
    console.info('[email] SMTP not configured — logging message instead');
    console.info({ to, subject, text: text || html?.slice(0, 200) });
    return { ok: true, mocked: true };
  }

  await transport.sendMail({ from, to, subject, html, text });
  return { ok: true };
}

export function buildLiveStreamEmail({ eventTitle, watchUrl, buyerName }) {
  const greeting = buyerName ? `Hi ${buyerName},` : 'Hi there,';
  const subject = `${eventTitle} is live now — join the stream`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111">
      <p>${greeting}</p>
      <p><strong>${eventTitle}</strong> is live. Your ticket includes online access — use the button below to join.</p>
      <p style="margin:28px 0">
        <a href="${watchUrl}" style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">
          Join live stream
        </a>
      </p>
      <p style="font-size:13px;color:#555">This link is tied to your purchase. Do not share it publicly.</p>
      <p style="font-size:12px;color:#888">If the button does not work, copy this URL:<br>${watchUrl}</p>
    </div>
  `;
  const text = `${greeting}\n\n${eventTitle} is live. Join here: ${watchUrl}`;
  return { subject, html, text };
}
