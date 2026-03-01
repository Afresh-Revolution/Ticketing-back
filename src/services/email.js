import { Resend } from 'resend';
import { config } from '../shared/config/env.js';

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;
const from = config.resendFrom;
const frontendBaseUrl = config.frontendBaseUrl;

function logEmail(subject, to, description) {
  console.log('[email]', config.resendApiKey ? 'Sending' : '(Resend not configured) Would send:', {
    to,
    subject,
    ...description,
  });
}

export async function sendOrganizerVerificationOtp({ to, code }) {
  const subject = 'Your Gatewav organizer verification code';
  const html = `
    <p>Your verification code is: <strong>${code}</strong></p>
    <p>This code expires in 10 minutes.</p>
    <p>— Gatewav</p>
  `;
  logEmail(subject, to, { code });
  if (resend) {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(error.message);
  }
}

export async function sendSignupVerificationOtp({ to, code }) {
  const subject = 'Verify your Gatewav email';
  const html = `
    <p>Your verification code is: <strong>${code}</strong></p>
    <p>Enter this code when you sign in. It expires in 10 minutes.</p>
    <p>— Gatewav</p>
  `;
  logEmail(subject, to, { code });
  if (resend) {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(error.message);
  }
}

export async function sendPasswordResetOtp({ to, code }) {
  const subject = 'Your Gatewav password reset code';
  const html = `
    <p>Your password reset code is: <strong>${code}</strong></p>
    <p>This code expires in 10 minutes.</p>
    <p>— Gatewav</p>
  `;
  logEmail(subject, to, { code });
  if (resend) {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(error.message);
  }
}
