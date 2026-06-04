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
export async function sendTicketEmail({ to, fullName, ticketCode, eventTitle, eventDate, ticketTypes = [] }) {
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(ticketCode, { margin: 2, width: 200 });
  } catch (qrErr) {
    console.warn('[email] QR generation failed:', qrErr.message);
  }
  const dateStr = eventDate ? new Date(eventDate).toLocaleDateString('en-NG', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const subject = 'Your ticket – ' + (eventTitle || 'Event');
  const safeTicketTypes = Array.isArray(ticketTypes)
    ? ticketTypes.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  const uniqueTicketTypes = [...new Set(safeTicketTypes)];
  const ticketTypeBadges = uniqueTicketTypes
    .map(
      (type) =>
        `<span style="display:inline-block;background:#791A94;color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin:0 6px 6px 0;">${type}</span>`
    )
    .join('');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f8f9fa; border-radius: 12px;">
      <h2 style="color: #791A94; margin-top: 0;">Gatewave Ticket</h2>
      <p>Hi ${fullName || 'there'},</p>
      <p>Your payment was successful. Here is your digital ticket. NOTE: If multiple tickets were purchased, please share to individual attendees.</p>
      <div style="background: #fff; padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0; border: 1px solid #e0e0e0;">
        <p style="margin: 0 0 8px 0; font-weight: bold; color: #1a1a2e;">${eventTitle || 'Event'}</p>
        <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">${dateStr}</p>
        ${ticketTypeBadges ? `<div style="margin: 0 0 14px 0;">${ticketTypeBadges}</div>` : ''}
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #999;">Ticket code</p>
        <p style="margin: 0 0 12px 0; font-size: 18px; font-weight: bold; letter-spacing: 2px;">${ticketCode}</p>
        ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR code" width="200" height="200" style="display: block; margin: 0 auto;" />` : ''}
      </div>
      <p style="color: #666; font-size: 12px;">Show this QR code at the venue for entry.</p>
    </div>
  `;
  return sendEmail({ to, subject, html });
}

function naira(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReceiptDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortOrderRef(orderId) {
  const id = String(orderId || '').replace(/-/g, '');
  return id.length >= 8 ? id.slice(0, 8).toUpperCase() : id.toUpperCase() || '—';
}

function normalizeMerchReceiptItem(row) {
  const description = row.merch_description || row.description || 'Item';
  const meta = [row.color_name, row.type_name].filter(Boolean).join(' · ');
  return {
    description,
    meta,
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    lineTotal: Number(row.line_total) || 0,
    imageUrl: row.image_url || null,
  };
}

function paymentMethodLabel(method) {
  if (method === 'paystack') return 'Paystack (card)';
  if (method === 'manual') return 'Manual transfer';
  return method ? String(method) : '—';
}

/** HTML receipt for a paid merch order. */
export function buildMerchReceiptHtml({ order, items = [], eventTitle }) {
  const ref = order.paystack_reference || order.paystackReference || shortOrderRef(order.id);
  const refLabel = order.paystack_reference || order.paystackReference ? 'Payment reference' : 'Order reference';
  const normalizedItems = items.map(normalizeMerchReceiptItem);
  const itemRows = normalizedItems
    .map((item) => {
      const thumb = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="" width="56" height="56" style="display:block;border-radius:6px;object-fit:cover;border:1px solid #e5e7eb;"/>`
        : `<div style="width:56px;height:56px;background:#f3f4f6;border-radius:6px;border:1px solid #e5e7eb;"></div>`;
      const metaLine = item.meta
        ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(item.meta)}</div>`
        : '';
      return `
        <tr>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;width:64px;">${thumb}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-weight:600;color:#111827;">${escapeHtml(item.description)}</div>
            ${metaLine}
          </td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">${item.quantity}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;white-space:nowrap;">${naira(item.unitPrice)}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827;white-space:nowrap;">${naira(item.lineTotal)}</td>
        </tr>`;
    })
    .join('');

  const phone = order.phone?.trim();
  const address = order.address?.trim();

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#f3f4f6;padding:24px 16px;">
      <div style="background:#791A94;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
        <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.9;">GateWav</div>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;">Purchase receipt</h1>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 20px;color:#374151;font-size:15px;">
          Hi <strong>${escapeHtml(order.full_name)}</strong>, thank you for your purchase. Your payment was received.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
          <tr>
            <td style="padding:6px 0;color:#6b7280;width:40%;">${refLabel}</td>
            <td style="padding:6px 0;font-weight:600;color:#111827;font-family:monospace;">${escapeHtml(ref)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Order ID</td>
            <td style="padding:6px 0;font-family:monospace;font-size:13px;color:#374151;">${escapeHtml(order.id)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Date</td>
            <td style="padding:6px 0;color:#111827;">${escapeHtml(formatReceiptDate(order.created_at || order.createdAt))}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Event</td>
            <td style="padding:6px 0;color:#111827;"><strong>${escapeHtml(eventTitle || 'Event')}</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Buyer</td>
            <td style="padding:6px 0;color:#111827;">${escapeHtml(order.full_name)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Email</td>
            <td style="padding:6px 0;color:#111827;">${escapeHtml(order.email)}</td>
          </tr>
          ${phone ? `<tr><td style="padding:6px 0;color:#6b7280;">Phone</td><td style="padding:6px 0;color:#111827;">${escapeHtml(phone)}</td></tr>` : ''}
          ${address ? `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">Delivery</td><td style="padding:6px 0;color:#111827;">${escapeHtml(address)}</td></tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Payment</td>
            <td style="padding:6px 0;color:#111827;">${escapeHtml(paymentMethodLabel(order.payment_method || order.paymentMethod))}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;">Status</td>
            <td style="padding:6px 0;"><span style="display:inline-block;background:#dcfce7;color:#166534;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;text-transform:uppercase;">Paid</span></td>
          </tr>
        </table>
        <h2 style="margin:0 0 12px;font-size:16px;color:#111827;">Items</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e5e7eb;" colspan="2">Description</th>
              <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e5e7eb;">Qty</th>
              <th style="padding:10px 8px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e5e7eb;">Unit</th>
              <th style="padding:10px 8px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e5e7eb;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="5" style="padding:16px;color:#6b7280;">No line items</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="padding:16px 8px 8px;text-align:right;font-weight:700;color:#111827;border-top:2px solid #e5e7eb;">Total paid</td>
              <td style="padding:16px 8px 8px;text-align:right;font-size:18px;font-weight:700;color:#791A94;border-top:2px solid #e5e7eb;white-space:nowrap;">${naira(order.total_amount ?? order.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="margin:24px 0 0;color:#6b7280;font-size:12px;line-height:1.5;">
          Keep this email for your records. If you have questions about your order, contact the event organizer or reply with your order reference.
        </p>
        <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">— GateWav Ticketing</p>
      </div>
    </div>
  `;
}

export function buildMerchReceiptText({ order, items = [], eventTitle }) {
  const ref = order.paystack_reference || order.paystackReference || shortOrderRef(order.id);
  const refLabel = order.paystack_reference || order.paystackReference ? 'Payment reference' : 'Order reference';
  const lines = items.map(normalizeMerchReceiptItem).map((item) => {
    const meta = item.meta ? ` (${item.meta})` : '';
    return `  ${item.description}${meta} — ${item.quantity} × ${naira(item.unitPrice)} = ${naira(item.lineTotal)}`;
  });
  return [
    'GATEWAV — PURCHASE RECEIPT',
    '',
    `Hi ${order.full_name},`,
    'Thank you for your purchase. Your payment was received.',
    '',
    `${refLabel}: ${ref}`,
    `Order ID: ${order.id}`,
    `Date: ${formatReceiptDate(order.created_at || order.createdAt)}`,
    `Event: ${eventTitle || 'Event'}`,
    `Buyer: ${order.full_name}`,
    `Email: ${order.email}`,
    order.phone?.trim() ? `Phone: ${order.phone.trim()}` : null,
    order.address?.trim() ? `Delivery: ${order.address.trim()}` : null,
    `Payment: ${paymentMethodLabel(order.payment_method || order.paymentMethod)}`,
    'Status: PAID',
    '',
    'Items:',
    ...(lines.length ? lines : ['  (none)']),
    '',
    `Total paid: ${naira(order.total_amount ?? order.totalAmount)}`,
    '',
    '— GateWav Ticketing',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Send styled merch purchase receipt to the buyer. */
export async function sendMerchPurchaseReceipt({ to, order, items, eventTitle }) {
  const subject = 'Your merch purchase receipt — GateWav';
  return sendEmail({
    to,
    subject,
    html: buildMerchReceiptHtml({ order, items, eventTitle }),
    text: buildMerchReceiptText({ order, items, eventTitle }),
  });
}

/** Notify super admins of a new withdrawal request. */
export function sendWithdrawalRequestEmail({
  to,
  adminName,
  adminEmail,
  eventTitle,
  grossAmount,
  platformFee,
  netAmount,
  bankName,
  accountName,
  accountNumber,
}) {
  const subject = `Withdrawal request – ${eventTitle || 'Event'}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #791A94;">New withdrawal request</h2>
      <p>An admin has requested a withdrawal. Review it in the admin dashboard.</p>
      <table style="width:100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color:#666;">Admin</td><td style="padding: 6px 0;"><strong>${adminName || '—'}</strong> (${adminEmail || '—'})</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Event</td><td style="padding: 6px 0;"><strong>${eventTitle || '—'}</strong></td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Gross</td><td style="padding: 6px 0;">${naira(grossAmount)}</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Platform fee (15%)</td><td style="padding: 6px 0;">${naira(platformFee)}</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Net payout</td><td style="padding: 6px 0;"><strong>${naira(netAmount)}</strong></td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Bank</td><td style="padding: 6px 0;">${bankName || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Account name</td><td style="padding: 6px 0;">${accountName || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Account number</td><td style="padding: 6px 0;">${accountNumber || '—'}</td></tr>
      </table>
    </div>
  `;
  return sendEmail({ to, subject, html });
}

/** Notify admin their withdrawal was approved. */
export function sendWithdrawalApprovedEmail({
  to,
  adminName,
  eventTitle,
  netAmount,
  bankName,
  accountNumber,
  isManualPayout = false,
}) {
  const subject = `Withdrawal approved – ${eventTitle || 'Event'}`;
  const payoutNote = isManualPayout
    ? `Your payout will be sent via manual bank transfer to ${bankName || 'your bank'} ···${String(accountNumber || '').slice(-4)}.`
    : `Funds are being sent via Paystack to ${bankName || 'your bank'} ···${String(accountNumber || '').slice(-4)}.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #166534;">Withdrawal approved</h2>
      <p>Hi ${adminName || 'there'},</p>
      <p>Your withdrawal request for <strong>${eventTitle || 'your event'}</strong> has been approved.</p>
      <p style="font-size: 18px;"><strong>Net amount: ${naira(netAmount)}</strong></p>
      <p style="color:#666; font-size: 14px;">${payoutNote}</p>
      <p style="color:#999; font-size: 12px;">Thank you for using Gatewave.</p>
    </div>
  `;
  return sendEmail({ to, subject, html });
}

/** Notify super admin to complete a withdrawal manually when Paystack transfer fails. */
export function sendManualWithdrawalPayoutEmail({
  to,
  adminName,
  adminEmail,
  eventTitle,
  netAmount,
  bankName,
  accountName,
  accountNumber,
  reason,
}) {
  const subject = `Manual withdrawal payout required – ${eventTitle || 'Event'}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #991b1b;">Manual payout required</h2>
      <p>Paystack could not send this withdrawal automatically. Please transfer the net amount manually.</p>
      ${reason ? `<p style="color:#666; font-size:14px;"><strong>Reason:</strong> ${reason}</p>` : ''}
      <table style="width:100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color:#666;">Admin</td><td style="padding: 6px 0;"><strong>${adminName || '—'}</strong> (${adminEmail || '—'})</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Event</td><td style="padding: 6px 0;"><strong>${eventTitle || '—'}</strong></td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Net payout</td><td style="padding: 6px 0;"><strong>${naira(netAmount)}</strong></td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Bank</td><td style="padding: 6px 0;">${bankName || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Account name</td><td style="padding: 6px 0;">${accountName || '—'}</td></tr>
        <tr><td style="padding: 6px 0; color:#666;">Account number</td><td style="padding: 6px 0;">${accountNumber || '—'}</td></tr>
      </table>
    </div>
  `;
  return sendEmail({ to, subject, html });
}

/** Notify admin their withdrawal was rejected. */
export function sendWithdrawalRejectedEmail({ to, adminName, eventTitle }) {
  const subject = `Withdrawal not approved – ${eventTitle || 'Event'}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #991b1b;">Withdrawal not approved</h2>
      <p>Hi ${adminName || 'there'},</p>
      <p>Your withdrawal request for <strong>${eventTitle || 'your event'}</strong> was not approved by the super admin.</p>
      <p style="color:#666; font-size: 14px;">You may submit a new request from the Withdraw page if needed.</p>
    </div>
  `;
  return sendEmail({ to, subject, html });
}
