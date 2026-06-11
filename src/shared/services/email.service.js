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

const BRAND = '#791A94';
const EVENT_TZ = 'Africa/Lagos';

function normalizeEventFormat(value) {
  const v = String(value || 'in-person').toLowerCase().trim();
  if (v === 'online' || v === 'hybrid') return v;
  return 'in-person';
}

function normalizeDeliveryMode(ticket, eventType) {
  const explicit = String(ticket?.deliveryMode || '').toLowerCase().trim();
  if (explicit === 'online' || explicit === 'in_person') {
    return explicit === 'online' ? 'online' : 'in_person';
  }
  return normalizeEventFormat(eventType) === 'online' ? 'online' : 'in_person';
}

function eventPageUrl(eventId) {
  if (!eventId) return config.frontendBaseUrl;
  return `${config.frontendBaseUrl}/#/event/${encodeURIComponent(String(eventId))}`;
}

function datePartFromValue(value) {
  if (!value) return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseEventStart(eventDate, startTime) {
  const datePart = datePartFromValue(eventDate);
  if (!datePart) return null;
  const time = String(startTime || '00:00').trim() || '00:00';
  const normalizedTime = /^\d{1,2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const parsed = new Date(`${datePart}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEventDayLine(eventDate, startTime, endTime, endDate) {
  const start = parseEventStart(eventDate, startTime);
  if (!start) return { dayName: '', dateLine: '', timeLine: '' };

  const dayName = start.toLocaleDateString('en-NG', {
    weekday: 'long',
    timeZone: EVENT_TZ,
  });
  const dateLine = start.toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: EVENT_TZ,
  });
  const startLabel = start.toLocaleTimeString('en-NG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: EVENT_TZ,
  });

  let timeLine = startLabel;
  if (endTime) {
    const endPart = datePartFromValue(endDate || eventDate);
    const endParsed = parseEventStart(endPart, endTime);
    if (endParsed) {
      const endLabel = endParsed.toLocaleTimeString('en-NG', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: EVENT_TZ,
      });
      timeLine = `${startLabel} – ${endLabel}`;
    }
  }

  return { dayName, dateLine, timeLine };
}

function formatCountdownLabel(targetDate) {
  if (!targetDate) return '';
  const ms = targetDate.getTime() - Date.now();
  if (ms <= 0) return 'Starting soon';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (days === 0 && minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.length ? `Starts in ${parts.join(', ')}` : 'Starts very soon';
}

function ticketTypeBadgesHtml(ticketItems = []) {
  const labels = [];
  for (const item of ticketItems) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const name = escapeHtml(item.name || 'Ticket');
    const mode =
      normalizeDeliveryMode(item, 'in-person') === 'online' ? ' · Online' : '';
    labels.push(`${qty > 1 ? `${qty}× ` : ''}${name}${mode}`);
  }
  const unique = [...new Set(labels)];
  return unique
    .map(
      (label) =>
        `<span style="display:inline-block;background:${BRAND};color:#fff;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.02em;margin:0 6px 6px 0;">${label}</span>`
    )
    .join('');
}

function wrapTicketEmailLayout({ preheader, headerTitle, headerSubtitle, bodyHtml }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:24px 12px;margin:0;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || '')}</div>
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:${BRAND};color:#fff;padding:22px 24px;">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.88;">GateWav</div>
          <h1 style="margin:10px 0 0;font-size:22px;line-height:1.25;font-weight:700;">${headerTitle}</h1>
          ${headerSubtitle ? `<p style="margin:8px 0 0;font-size:14px;opacity:.92;line-height:1.45;">${headerSubtitle}</p>` : ''}
        </div>
        <div style="padding:24px;color:#111827;font-size:15px;line-height:1.55;">
          ${bodyHtml}
        </div>
        <div style="padding:0 24px 20px;color:#9ca3af;font-size:11px;">— GateWav Ticketing</div>
      </div>
    </div>
  `;
}

function buildScheduleCardHtml({
  eventDate,
  eventEndDate,
  eventStartTime,
  eventEndTime,
  eventLocation,
  eventVenue,
  eventId,
  showCountdown = true,
}) {
  const start = parseEventStart(eventDate, eventStartTime);
  const { dayName, dateLine, timeLine } = formatEventDayLine(
    eventDate,
    eventStartTime,
    eventEndTime,
    eventEndDate
  );
  const countdown = showCountdown ? formatCountdownLabel(start) : '';
  const locationLine = [eventVenue, eventLocation].filter(Boolean).join(' · ') || '';

  return `
    <div style="background:linear-gradient(135deg,#f5f3ff 0%,#faf5ff 100%);border:1px solid #e9d5ff;border-radius:12px;padding:18px 20px;margin:20px 0;text-align:center;">
      ${dayName ? `<div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${BRAND};margin-bottom:6px;">${escapeHtml(dayName)}</div>` : ''}
      ${dateLine ? `<div style="font-size:20px;font-weight:700;color:#1f2937;line-height:1.3;">${escapeHtml(dateLine)}</div>` : ''}
      ${timeLine ? `<div style="font-size:17px;font-weight:600;color:#4b5563;margin-top:8px;">${escapeHtml(timeLine)} <span style="font-size:12px;color:#6b7280;">WAT</span></div>` : ''}
      ${
        countdown
          ? `<div style="display:inline-block;margin-top:14px;background:${BRAND};color:#fff;font-size:13px;font-weight:700;padding:8px 16px;border-radius:999px;">${escapeHtml(countdown)}</div>`
          : ''
      }
      ${
        locationLine
          ? `<div style="margin-top:14px;font-size:13px;color:#6b7280;">📍 ${escapeHtml(locationLine)}</div>`
          : ''
      }
      ${
        eventId
          ? `<p style="margin:14px 0 0;font-size:12px;"><a href="${escapeHtml(eventPageUrl(eventId))}" style="color:${BRAND};font-weight:600;text-decoration:none;">View event page for live countdown →</a></p>`
          : ''
      }
    </div>
  `;
}

function buildOnlineAccessNoticeHtml() {
  return `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 18px;margin:20px 0;">
      <div style="font-size:13px;font-weight:700;color:#9a3412;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Online access</div>
      <p style="margin:0;color:#7c2d12;font-size:14px;line-height:1.55;">
        When this event <strong>goes live</strong>, we will email you a <strong>private watch link</strong> tied to your purchase.
        You do not need to do anything else right now — save this email for your records.
      </p>
    </div>
  `;
}

function buildInPersonTicketCardHtml({ ticketCode, qrDataUrl, eventTitle }) {
  return `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;margin:20px 0;">
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Venue entry</p>
      <p style="margin:0 0 14px;font-weight:700;color:#111827;">${escapeHtml(eventTitle || 'Event')}</p>
      <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;">Ticket code</p>
      <p style="margin:0 0 14px;font-size:18px;font-weight:700;letter-spacing:2px;color:#111827;">${escapeHtml(ticketCode)}</p>
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR code" width="180" height="180" style="display:block;margin:0 auto;border-radius:8px;" />` : ''}
      <p style="margin:14px 0 0;font-size:12px;color:#6b7280;">Show this QR code at the venue for entry.</p>
    </div>
  `;
}

function buildTicketEmailContent(ctx) {
  const eventType = normalizeEventFormat(ctx.eventType);
  const ticketItems = (ctx.ticketItems || []).map((item) => ({
    name: item.name || 'Ticket',
    deliveryMode: normalizeDeliveryMode(item, eventType),
    quantity: Math.max(1, Number(item.quantity) || 1),
  }));
  if (ticketItems.length === 0 && Array.isArray(ctx.ticketTypes)) {
    for (const name of ctx.ticketTypes) {
      ticketItems.push({
        name: String(name || 'Ticket'),
        deliveryMode: normalizeDeliveryMode({}, eventType),
        quantity: 1,
      });
    }
  }

  const hasOnlineTicket = ticketItems.some((t) => t.deliveryMode === 'online');
  const hasInPersonTicket = ticketItems.some((t) => t.deliveryMode === 'in_person');
  const isOnlineOnlyPurchase = hasOnlineTicket && !hasInPersonTicket;
  const isHybridEvent = eventType === 'hybrid';
  const showSchedule = isHybridEvent || isOnlineOnlyPurchase || eventType === 'online';
  const greeting = escapeHtml(ctx.fullName || 'there');
  const title = escapeHtml(ctx.eventTitle || 'Event');
  const badges = ticketTypeBadgesHtml(ticketItems);
  const scheduleHtml = showSchedule
    ? buildScheduleCardHtml({
        eventDate: ctx.eventDate,
        eventEndDate: ctx.eventEndDate,
        eventStartTime: ctx.eventStartTime,
        eventEndTime: ctx.eventEndTime,
        eventLocation: ctx.eventLocation,
        eventVenue: ctx.eventVenue,
        eventId: ctx.eventId,
        showCountdown: true,
      })
    : '';

  if (isOnlineOnlyPurchase || (eventType === 'online' && !hasInPersonTicket)) {
    const bodyHtml = `
      <p style="margin:0 0 16px;">Hi <strong>${greeting}</strong>,</p>
      <p style="margin:0 0 16px;">Your payment was successful. You are confirmed for the <strong>online stream</strong> of <strong>${title}</strong>.</p>
      ${scheduleHtml}
      ${badges ? `<div style="margin:0 0 8px;">${badges}</div>` : ''}
      ${buildOnlineAccessNoticeHtml()}
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">Confirmation code: <strong style="color:#111827;letter-spacing:1px;">${escapeHtml(ctx.ticketCode)}</strong></p>
      <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">If you bought multiple online tickets, forward the watch link to each attendee when you receive it.</p>
    `;
    return {
      subject: `You're in — ${ctx.eventTitle || 'Live stream'}`,
      html: wrapTicketEmailLayout({
        preheader: 'Your online access is confirmed. We will send your watch link when the event goes live.',
        headerTitle: 'Online access confirmed',
        headerSubtitle: ctx.eventTitle || 'Live event',
        bodyHtml,
      }),
    };
  }

  if (isHybridEvent || (hasOnlineTicket && hasInPersonTicket)) {
    const bodyHtml = `
      <p style="margin:0 0 16px;">Hi <strong>${greeting}</strong>,</p>
      <p style="margin:0 0 16px;">Your payment was successful for <strong>${title}</strong>.</p>
      ${scheduleHtml}
      ${badges ? `<div style="margin:0 0 8px;">${badges}</div>` : ''}
      ${hasOnlineTicket ? buildOnlineAccessNoticeHtml() : ''}
      ${hasInPersonTicket ? (ctx.inPersonCardHtml || '') : ''}
      ${
        hasInPersonTicket && hasOnlineTicket
          ? '<p style="margin:16px 0 0;font-size:13px;color:#6b7280;">This order includes both venue and online tickets — use the QR above for in-person entry; your stream link will arrive separately when the event goes live.</p>'
          : hasInPersonTicket
            ? '<p style="margin:16px 0 0;font-size:13px;color:#6b7280;">Show the QR code above at the venue for entry.</p>'
            : ''
      }
    `;
    return {
      subject: `Your ticket — ${ctx.eventTitle || 'Event'}`,
      html: wrapTicketEmailLayout({
        preheader: 'Event details, countdown, and your ticket information.',
        headerTitle: 'Hybrid event ticket',
        headerSubtitle: 'In-person and/or online access',
        bodyHtml,
      }),
    };
  }

  const dateStr = ctx.eventDate
    ? new Date(ctx.eventDate).toLocaleDateString('en-NG', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';
  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi <strong>${greeting}</strong>,</p>
    <p style="margin:0 0 16px;">Your payment was successful. Here is your digital ticket. If multiple tickets were purchased, please share with individual attendees.</p>
    ${ctx.inPersonCardHtml || ''}
    ${dateStr ? `<p style="margin:0 0 12px;color:#6b7280;font-size:14px;text-align:center;">${escapeHtml(dateStr)}</p>` : ''}
    ${badges ? `<div style="text-align:center;margin:0 0 8px;">${badges}</div>` : ''}
    <p style="margin:12px 0 0;font-size:12px;color:#6b7280;text-align:center;">Show this QR code at the venue for entry.</p>
  `;
  return {
    subject: `Your ticket — ${ctx.eventTitle || 'Event'}`,
    html: wrapTicketEmailLayout({
      preheader: 'Your digital ticket and QR code for venue entry.',
      headerTitle: 'Your ticket',
      headerSubtitle: ctx.eventTitle || 'Event',
      bodyHtml,
    }),
  };
}

/** Send digital ticket email (after payment success). Routes template by event/ticket type. */
export async function sendTicketEmail(ctx) {
  let qrDataUrl = '';
  const eventType = normalizeEventFormat(ctx.eventType);
  const ticketItems = ctx.ticketItems || [];
  const hasInPerson =
    ticketItems.some((t) => normalizeDeliveryMode(t, eventType) === 'in_person') ||
    (!ticketItems.length && eventType !== 'online');

  if (hasInPerson && ctx.ticketCode) {
    try {
      qrDataUrl = await QRCode.toDataURL(ctx.ticketCode, { margin: 2, width: 200 });
    } catch (qrErr) {
      console.warn('[email] QR generation failed:', qrErr.message);
    }
  }

  const enriched = {
    ...ctx,
    inPersonCardHtml: hasInPerson
      ? buildInPersonTicketCardHtml({
          ticketCode: ctx.ticketCode,
          qrDataUrl,
          eventTitle: ctx.eventTitle,
        })
      : '',
  };

  const { subject, html } = buildTicketEmailContent(enriched);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return sendEmail({ to: ctx.to, subject, html, text });
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

function merchReceiptContactHtml(organizerEmail) {
  const email = String(organizerEmail || '').trim();
  if (!email) {
    return 'Keep this email for your records. If you have questions about your order, contact the event organizer or reply with your order reference.';
  }
  const safe = escapeHtml(email);
  return `Keep this email for your records. If you have questions about your order, contact the event organizer at <a href="mailto:${safe}" style="color:#791A94;">${safe}</a>, or reply with your order reference.`;
}

function merchReceiptContactText(organizerEmail) {
  const email = String(organizerEmail || '').trim();
  if (!email) {
    return 'Keep this email for your records. If you have questions about your order, contact the event organizer or reply with your order reference.';
  }
  return `Keep this email for your records. If you have questions about your order, contact the event organizer at ${email}, or reply with your order reference.`;
}

/** HTML receipt for a paid merch order. */
export function buildMerchReceiptHtml({ order, items = [], eventTitle, organizerEmail }) {
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
          ${merchReceiptContactHtml(organizerEmail)}
        </p>
        <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">— GateWav Ticketing</p>
      </div>
    </div>
  `;
}

export function buildMerchReceiptText({ order, items = [], eventTitle, organizerEmail }) {
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
    merchReceiptContactText(organizerEmail),
    '',
    '— GateWav Ticketing',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Send styled merch purchase receipt to the buyer. */
export async function sendMerchPurchaseReceipt({ to, order, items, eventTitle, organizerEmail }) {
  const subject = 'Your merch purchase receipt — GateWav';
  const payload = { order, items, eventTitle, organizerEmail };
  return sendEmail({
    to,
    subject,
    html: buildMerchReceiptHtml(payload),
    text: buildMerchReceiptText(payload),
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

export function buildLiveStreamEmail({ eventTitle, watchUrl, buyerName }) {
  const greeting = escapeHtml(buyerName || 'there');
  const title = escapeHtml(eventTitle || 'Event');
  const safeUrl = escapeHtml(watchUrl);
  const subject = `${eventTitle || 'Event'} is live — join now`;
  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi <strong>${greeting}</strong>,</p>
    <p style="margin:0 0 16px;"><strong>${title}</strong> is <strong style="color:${BRAND};">live now</strong>. Your ticket includes online access — tap below to join.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${safeUrl}" style="display:inline-block;background:${BRAND};color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;">Join live stream</a>
    </div>
    <p style="margin:0;font-size:13px;color:#6b7280;">This link is tied to your purchase. Please do not share it publicly.</p>
    <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;word-break:break-all;">If the button does not work, copy this URL:<br>${safeUrl}</p>
  `;
  const html = wrapTicketEmailLayout({
    preheader: 'The event is live. Join the stream with your private link.',
    headerTitle: 'We are live!',
    headerSubtitle: eventTitle || 'Online event',
    bodyHtml,
  });
  const text = `Hi ${buyerName || 'there'},\n\n${eventTitle} is live. Join here: ${watchUrl}`;
  return { subject, html, text };
}
