import { getTicketDesign } from './ticketDesign.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (value) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(value) || 0);
const safeUrl = (value) => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';

/** Pure rendering: no email delivery, environment access, or database queries. */
export function renderTicketEmail(ctx, { frontendBaseUrl = 'https://gatewav.com', qrSrc = '' } = {}) {
  const title = ctx.eventTitle || 'Event';
  const items = (ctx.ticketItems?.length ? ctx.ticketItems : (ctx.ticketTypes || []).map((name) => ({ name }))).map((item) => ({
    ...item, quantity: Math.max(1, Number(item.quantity) || 1),
    price: item.price == null ? undefined : Number(item.price),
  }));
  const theme = getTicketDesign({ items, totalAmount: ctx.totalAmount });
  const onlineOnly = String(ctx.eventType).toLowerCase() === 'online' || (items.length > 0 && items.every((item) => item.deliveryMode === 'online'));
  const hasOnline = onlineOnly || items.some((item) => item.deliveryMode === 'online');
  const date = ctx.eventDate ? new Date(ctx.eventDate) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' }) : 'Date to be announced';
  const timeLabel = ctx.eventStartTime ? `${String(ctx.eventStartTime).slice(0, 5)}${ctx.eventEndTime ? ` - ${String(ctx.eventEndTime).slice(0, 5)}` : ''} WAT` : '';
  const venue = onlineOnly ? 'Online event' : [ctx.eventVenue, ctx.eventLocation].filter(Boolean).join(' · ') || 'Venue to be announced';
  const eventUrl = `${safeUrl(frontendBaseUrl) || 'https://gatewav.com'}/#/event/${encodeURIComponent(ctx.eventId || '')}`;
  const image = safeUrl(ctx.eventImageUrl);
  const selection = items.map((item) => `${item.quantity} × ${item.name || 'Ticket'}`).join(' · ') || 'Event admission';
  const qr = !onlineOnly && ctx.ticketCode;
  const label = 'font-size:10px;font-weight:700;letter-spacing:2px;';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your GateWav ticket</title></head>
<body style="margin:0;background:#162629;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Your ticket for ${escape(title)}. Keep this email for your event.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#162629;table-layout:fixed;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;max-width:560px;border:1px solid ${theme.accent};border-radius:24px;overflow:hidden;">
<tr><td style="background:${theme.gradient[1]};background-image:linear-gradient(135deg,${theme.gradient[0]},${theme.gradient[1]});padding:26px 24px;color:#fff;">
<table role="presentation" width="100%"><tr><td style="font-size:16px;font-weight:800;letter-spacing:4px;color:${theme.accent};">GATEWAV</td><td align="right" style="${label}color:${theme.accent};line-height:16px;">${theme.name}<br>EDITION</td></tr></table>
<p style="margin:28px 0 10px;${label}color:${theme.accent};">${onlineOnly ? 'DIGITAL PASS' : 'EVENT PASS'} / CONFIRMED</p>
<h1 style="word-break:break-word;font-size:30px;line-height:1.15;letter-spacing:-1px;margin:0;overflow-wrap:anywhere;">${escape(title)}</h1>
</td></tr>
${image ? `<tr><td style="background:${theme.gradient[1]};"><img src="${escape(image)}" alt="${escape(title)}" width="560" style="display:block;width:100%;height:auto;border:0;"></td></tr>` : ''}
<tr><td style="background:${theme.gradient[1]};padding:24px;color:#e0ebe6;">
<p style="margin:0 0 8px;font-size:15px;font-weight:700;">${escape(dateLabel)}</p>
${timeLabel ? `<p style="margin:0 0 8px;font-size:14px;">${escape(timeLabel)}</p>` : ''}
<p style="margin:0 0 20px;font-size:14px;">${escape(venue)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="14" style="border:1px solid ${theme.accent};border-radius:10px;"><tr><td><div style="${label}color:${theme.accent};margin-bottom:8px;">YOUR SELECTION</div><div style="font-size:15px;font-weight:700;color:#fff;">${escape(selection)}</div></td></tr></table>
</td></tr>
<tr><td style="background:${theme.paper};padding:14px 24px;"><div style="border-top:2px dashed #9da9a1;height:1px;"></div></td></tr>
<tr><td style="background:${theme.paper};padding:8px 24px 28px;color:${theme.ink};">
<p style="${label}margin:0 0 20px;">${onlineOnly ? 'ONLINE ACCESS / KEEP THIS PASS' : 'ADMISSION / SCAN AT ENTRY'}</p>
${qr ? `<table role="presentation" width="100%"><tr><td align="center" style="padding:6px 0 20px;">${qrSrc ? `<img src="${escape(qrSrc)}" alt="Entry QR code" width="200" height="200" style="display:block;background:#fff;border:12px solid #fff;border-radius:12px;max-width:85%;">` : ''}<p style="font-family:monospace;font-size:21px;font-weight:700;letter-spacing:2px;margin:16px 0 8px;overflow-wrap:anywhere;">${escape(ctx.ticketCode)}</p><p style="font-size:12px;color:#52615d;margin:0;">Show at the gate. Keep your entry code private.</p></td></tr></table>` : ''}
${hasOnline ? '<div style="padding:16px;background:#fff;border:1px solid #cbd5ce;border-radius:10px;font-size:14px;line-height:1.6;margin-bottom:20px;"><strong>Your online access is confirmed.</strong><br>We will email your private watch link when the event goes live. No QR is needed for online access.</div>' : ''}
<div style="border-top:1px solid #cbd5ce;padding-top:20px;"><p style="${label}color:#52615d;margin:0 0 8px;">TICKET HOLDER</p><p style="font-size:22px;font-weight:700;margin:0 0 6px;">${escape(ctx.fullName || 'Guest')}</p><p style="font-size:13px;color:#52615d;margin:0;overflow-wrap:anywhere;">${escape(ctx.to)}</p></div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px;font-size:13px;color:#52615d;">
${items.map((item) => `<tr><td style="padding:7px 8px 7px 0;">${escape(`${item.quantity} × ${item.name || 'Ticket'}`)}</td><td align="right" style="padding:7px 0;">${Number.isFinite(item.price) ? escape(money(item.price * item.quantity)) : ''}</td></tr>`).join('')}
${ctx.totalAmount != null && Number.isFinite(Number(ctx.totalAmount)) ? `<tr><td style="padding-top:18px;border-top:1px solid #cbd5ce;${label}">TOTAL PAID</td><td align="right" style="padding-top:18px;border-top:1px solid #cbd5ce;font-size:24px;font-weight:700;color:${theme.ink};">${escape(money(ctx.totalAmount))}</td></tr>` : ''}
</table>
<p style="font-size:10px;color:#69756f;margin:24px 0 0;letter-spacing:1px;overflow-wrap:anywhere;">${ctx.orderId ? `ORDER ${escape(ctx.orderId)}` : 'GATEWAV EVENT TICKET'}</p>
</td></tr></table>
<p style="margin:24px 0 14px;"><a href="${escape(eventUrl)}" style="display:inline-block;padding:15px 26px;background:${theme.accent};color:${theme.ink};border-radius:24px;font-size:14px;font-weight:700;text-decoration:none;">View event details</a></p>
<p style="font-size:12px;line-height:20px;color:#b7c7c2;margin:0;">Made for moments worth keeping.<br>GateWav</p>
</td></tr></table></body></html>`;
  const text = [`Your GateWav ticket: ${title}`, `Ticket holder: ${ctx.fullName || 'Guest'}`, dateLabel, timeLabel, venue, selection,
    qr ? `Entry code: ${ctx.ticketCode}. Keep this code private.` : '',
    hasOnline ? 'Your private watch link will be emailed when the event goes live.' : '',
    ctx.totalAmount != null ? `Total paid: ${money(ctx.totalAmount)}` : '', `Event details: ${eventUrl}`].filter(Boolean).join('\n');
  return { subject: `Your ticket - ${String(title).replace(/[\r\n]/g, ' ')}`, html, text };
}
