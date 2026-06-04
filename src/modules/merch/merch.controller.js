import * as merchModel from './merch.model.js';
import { eventModel } from '../event/event.model.js';
import { sendEmail } from '../../shared/services/email.service.js';
import {
  initializeTransaction,
  isPaystackConfigured,
  verifyTransaction,
} from '../../shared/services/paystack.service.js';
import { normalizeBuyerEmail } from '../../shared/utils/email.js';

export async function listByEvent(req, res, next) {
  try {
    const merch = await merchModel.fetchMerchByEventId(req.params.id);
    res.json({ merch });
  } catch (e) {
    next(e);
  }
}

export async function replaceForEvent(req, res, next) {
  try {
    const eventId = req.params.id;
    const existing = await eventModel.findById(eventId);
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    const items = req.body?.merch ?? req.body?.items ?? [];
    const merch = await merchModel.replaceMerchForEvent(eventId, items);
    res.json({ merch });
  } catch (e) {
    next(e);
  }
}

async function getAdminEmailsForEvent(eventId) {
  const owner = await eventModel.getOwnerEmail(eventId);
  const emails = [];
  if (owner) emails.push(owner);
  return emails;
}

async function sendMerchReceiptEmail(orderId) {
  const order = await merchModel.findMerchOrderById(orderId);
  if (!order || order.status !== 'paid') return;
  const items = await merchModel.getMerchOrderItems(orderId);
  const lines = items
    .map(
      (r) =>
        `• ${r.merch_description} × ${r.quantity} — ₦${Number(r.line_total).toLocaleString()}`
    )
    .join('\n');
  const html = items
    .map(
      (r) =>
        `<p><strong>${r.merch_description}</strong> × ${r.quantity}<br/>` +
        (r.image_url ? `<img src="${r.image_url}" alt="" width="200" style="max-width:100%"/>` : '') +
        `</p>`
    )
    .join('');

  await sendEmail({
    to: order.email,
    subject: 'Your merch purchase receipt — GateWav',
    text: `Thank you ${order.full_name}!\n\nTotal: ₦${Number(order.total_amount).toLocaleString()}\n\n${lines}`,
    html,
  }).catch((err) => console.error('[merch] receipt email:', err.message));
}

async function notifyAdminsMerchOrder(orderId, label) {
  const order = await merchModel.findMerchOrderById(orderId);
  if (!order) return;
  const event = await eventModel.findById(order.event_id);
  const items = await merchModel.getMerchOrderItems(orderId);
  const lines = items
    .map((r) => `${r.merch_description} ×${r.quantity} — ₦${Number(r.line_total).toLocaleString()}`)
    .join('\n');
  const admins = await getAdminEmailsForEvent(order.event_id);
  for (const to of admins) {
    await sendEmail({
      to,
      subject: `[${label}] Merch order — ${event?.title || 'Event'}`,
      text: `${order.full_name} <${order.email}>\n₦${order.total_amount}\n${lines}`,
    }).catch((err) => console.error('[merch] admin notify:', err.message));
  }
}

export async function createOrder(req, res, next) {
  try {
    const {
      eventId,
      items,
      totalAmount,
      fullName,
      email,
      phone,
      address,
      paymentMethod = 'manual',
    } = req.body;

    if (!eventId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Invalid merch order' });
    }
    if (!fullName?.trim() || !email?.includes('@')) {
      return res.status(400).json({ error: 'Name and valid email required' });
    }

    let computed = 0;
    const lines = [];
    for (const line of items) {
      const merch = await merchModel.fetchMerchById(line.merchId);
      if (!merch) return res.status(400).json({ error: 'Merch not found' });
      if (merch.availability === 'at_event') {
        return res.status(400).json({ error: 'This merch is only available at the event' });
      }
      const img = merch.images.find((i) => i.id === line.imageId);
      if (!img) return res.status(400).json({ error: 'Invalid merch image' });
      const unitPrice = merch.sameAmount ? Number(merch.unitPrice) || 0 : Number(img.unitPrice) || 0;
      const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
      const lineTotal = unitPrice * qty;
      computed += lineTotal;
      lines.push({
        merchId: merch.id,
        imageId: img.id,
        colorName: line.colorName || null,
        typeName: line.typeName || null,
        quantity: qty,
        unitPrice,
        lineTotal,
      });
    }

    const payable = Number(totalAmount);
    if (Math.abs(computed - payable) > 0.01) {
      return res.status(400).json({ error: 'Order total mismatch' });
    }

    const method = String(paymentMethod).toLowerCase();
    const isPaystack = method === 'paystack';
    const status = payable <= 0 ? 'paid' : isPaystack ? 'pending' : 'pending';

    const order = await merchModel.createMerchOrder({
      eventId,
      fullName: fullName.trim(),
      email: normalizeBuyerEmail(email),
      phone,
      address,
      totalAmount: payable,
      status,
      paymentMethod: method === 'paystack' ? 'paystack' : 'manual',
      lines,
    });

    if (order.status === 'paid') {
      await sendMerchReceiptEmail(order.id);
      await notifyAdminsMerchOrder(order.id, 'Paid');
    }

    res.status(201).json(order);
  } catch (e) {
    next(e);
  }
}

export async function initializePayment(req, res, next) {
  try {
    const { orderId, callbackUrl, email } = req.body;
    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'Paystack not configured' });
    }
    const order = await merchModel.findMerchOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'paid') return res.status(400).json({ error: 'Already paid' });

    const amountKobo = Math.round(Number(order.total_amount) * 100);
    const reference = `merch_${orderId}_${Date.now()}`;
    const init = await initializeTransaction({
      email: email || order.email,
      amountKobo,
      reference,
      callbackUrl,
      metadata: { orderId: String(orderId), type: 'merch' },
    });

    if (!init?.authorization_url) {
      return res.status(400).json({ error: 'Failed to initialize payment' });
    }

    res.json({
      authorizationUrl: init.authorization_url,
      reference: init.reference || reference,
      orderId: String(orderId),
    });
  } catch (e) {
    next(e);
  }
}

export async function verifyPayment(req, res, next) {
  try {
    const { orderId, reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'reference required' });
    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'Paystack not configured' });
    }

    const paystackTx = await verifyTransaction(reference);
    if (!paystackTx || String(paystackTx.status || '').toLowerCase() !== 'success') {
      return res.status(400).json({ error: 'Payment not verified' });
    }

    const updated = await merchModel.updateMerchOrderStatus(orderId, 'paid', reference);
    if (!updated) return res.status(404).json({ error: 'Order not found' });

    await sendMerchReceiptEmail(orderId);
    await notifyAdminsMerchOrder(orderId, 'Paid');

    res.json({ status: 'paid', id: orderId });
  } catch (e) {
    next(e);
  }
}

export async function manualPaymentNotify(req, res, next) {
  try {
    const { orderId, email } = req.body;
    const order = await merchModel.findMerchOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await notifyAdminsMerchOrder(orderId, 'Pending');
    res.json({ ok: true, email: email || order.email });
  } catch (e) {
    next(e);
  }
}

export async function createSaveRequest(req, res, next) {
  try {
    const { eventId, merchId, fullName, email, message } = req.body;
    if (!eventId || !merchId || !fullName?.trim() || !email?.includes('@')) {
      return res.status(400).json({ error: 'Invalid save request' });
    }
    const merch = await merchModel.fetchMerchById(merchId);
    if (!merch) return res.status(404).json({ error: 'Merch not found' });
    if (merch.availability === 'online') {
      return res.status(400).json({ error: 'This merch is only available online' });
    }

    const row = await merchModel.createSaveRequest({
      eventId: String(eventId),
      merchId,
      fullName: fullName.trim(),
      email: normalizeBuyerEmail(email),
      message,
    });

    const admins = await getAdminEmailsForEvent(eventId);
    for (const to of admins) {
      await sendEmail({
        to,
        subject: '[Pending] Merch save request',
        text: `${fullName} <${email}> requested to save merch.\n${message || ''}`,
      }).catch(() => {});
    }

    res.status(201).json({
      id: row.id,
      status: row.status,
      message:
        'Save request submitted. It will be confirmed after you purchase a ticket.',
    });
  } catch (e) {
    next(e);
  }
}

export async function adminListOrders(req, res, next) {
  try {
    const rows = await merchModel.listMerchOrdersForAdmin(req.user.id, req.user.role);
    res.json({
      orders: rows.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        eventTitle: r.event_title,
        buyerName: r.full_name,
        buyerEmail: r.email,
        amount: Number(r.total_amount),
        status: r.status,
        paymentMethod: r.payment_method,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    next(e);
  }
}

export async function adminUpdateOrderStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['pending', 'paid', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const prev = await merchModel.findMerchOrderById(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Order not found' });

    await merchModel.updateMerchOrderStatus(req.params.id, status, null);

    if (status === 'paid' && prev.status !== 'paid') {
      await sendMerchReceiptEmail(req.params.id);
      await notifyAdminsMerchOrder(req.params.id, 'Paid');
    }

    res.json({ id: req.params.id, status });
  } catch (e) {
    next(e);
  }
}

export async function adminListSaveRequests(req, res, next) {
  try {
    const rows = await merchModel.listSaveRequestsForAdmin(req.user.id, req.user.role);
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        eventTitle: r.event_title,
        merchId: r.merch_id,
        merchDescription: r.merch_description,
        fullName: r.full_name,
        email: r.email,
        message: r.message,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    next(e);
  }
}

export async function adminUpdateSaveRequestStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const row = await merchModel.updateSaveRequestStatus(
      req.params.id,
      status,
      req.user.id
    );
    if (!row) return res.status(404).json({ error: 'Not found' });

    if (status === 'approved') {
      await sendEmail({
        to: row.email,
        subject: 'Your merch save request was accepted',
        text: `Hi ${row.full_name},\n\nYour merch save request has been accepted and your items are saved.\n\n— GateWav`,
      }).catch(() => {});
    }

    res.json({ id: row.id, status: row.status });
  } catch (e) {
    next(e);
  }
}
