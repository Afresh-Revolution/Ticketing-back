const { Resend } = require('resend');
const config = require('../shared/config/env');

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

/**
 * Send membership receipt and organizer form link after successful payment.
 */
async function sendMembershipReceipt({ to, planName, amountNaira, currency = 'NGN' }) {
  const organizerFormLink = `${frontendBaseUrl}/#/organizer-form`;
  const subject = 'Your Gatewav Organizer Membership – Receipt';
  const html = `
    <h2>Thank you for your purchase</h2>
    <p>Your Gatewav organizer membership is now active.</p>
    <ul>
      <li><strong>Plan:</strong> ${planName}</li>
      <li><strong>Amount:</strong> ${currency} ${amountNaira}</li>
    </ul>
    <p>To create your organizer account and access the admin dashboard, use this link:</p>
    <p><a href="${organizerFormLink}">${organizerFormLink}</a></p>
    <p>Save this link to complete your organizer setup when you're ready.</p>
    <p>— Gatewav</p>
  `;
  logEmail(subject, to, { planName, amountNaira });
  if (resend) {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(error.message);
  }
}

/**
 * Send 6-digit OTP for organizer verification.
 */
async function sendOrganizerVerificationOtp({ to, code }) {
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

/**
 * Send 6-digit OTP for signup verification (main app users).
 */
async function sendSignupVerificationOtp({ to, code }) {
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

/**
 * Send 6-digit OTP for password reset.
 */
async function sendPasswordResetOtp({ to, code }) {
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

module.exports = {
  sendMembershipReceipt,
  sendOrganizerVerificationOtp,
  sendSignupVerificationOtp,
  sendPasswordResetOtp,
};
