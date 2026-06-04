/**
 * Express router for merch — mount at app root:
 *   import { createMerchRouter } from './merch/routes.js';
 *   app.use(createMerchRouter({ pool, authAdmin, authOptional, sendEmail, paystack }));
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sendMerchPurchaseReceipt } from '../shared/services/email.service.js';
import {
  fetchMerchByEventId,
  fetchMerchById,
  insertMerchForEvent,
  replaceMerchForEvent,
  decrementMerchStock,
} from './repository.js';

export function createMerchRouter(deps) {
  const {
    pool,
    authAdmin = (_req, _res, next) => next(),
    authOptional = (_req, _res, next) => next(),
    sendEmail = async () => {},
    paystack = null,
    getAdminEmailsForEvent = async () => [],
  } = deps;

  const router = Router();

  /** Attach to event create/update handlers or call directly */
  router.post('/api/events/:eventId/merch', authAdmin, async (req, res) => {
    try {
      const { eventId } = req.params;
      const items = req.body?.merch ?? req.body?.items ?? [];
      await replaceMerchForEvent(pool, eventId, items);
      const merch = await fetchMerchByEventId(pool, eventId);
      res.json({ merch });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Failed to save merch' });
    }
  });

  router.get('/api/events/:eventId/merch', async (req, res) => {
    try {
      const merch = await fetchMerchByEventId(pool, req.params.eventId);
      res.json({ merch });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to load merch' });
    }
  });

  router.post('/api/merch-orders', authOptional, async (req, res) => {
    const client = await pool.connect();
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

      let computedTotal = 0;
      const lineRows = [];
      for (const line of items) {
        const merch = await fetchMerchById(pool, line.merchId);
        if (!merch) return res.status(400).json({ error: 'Merch not found' });
        if (merch.availability === 'at_event') {
          return res.status(400).json({ error: 'This merch is only available at the event' });
        }
        const img = merch.images.find((i) => i.id === line.imageId);
        if (!img) return res.status(400).json({ error: 'Invalid merch image' });
        const unitPrice = merch.sameAmount
          ? Number(merch.unitPrice) || 0
          : Number(img.unitPrice) || 0;
        const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
        const lineTotal = unitPrice * qty;
        computedTotal += lineTotal;
        lineRows.push({
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
      if (Math.abs(computedTotal - payable) > 0.01) {
        return res.status(400).json({ error: 'Order total mismatch' });
      }

      const isFree = payable <= 0;
      const status = isFree || paymentMethod === 'paystack' ? (isFree ? 'paid' : 'pending') : 'pending';

      await client.query('BEGIN');
      const orderRes = await client.query(
        `INSERT INTO merch_orders (
          event_id, full_name, email, phone, address, total_amount, status, payment_method
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          eventId,
          fullName.trim(),
          email.trim(),
          phone || null,
          address || null,
          payable,
          status,
          paymentMethod,
        ]
      );
      const order = orderRes.rows[0];

      for (const line of lineRows) {
        await client.query(
          `INSERT INTO merch_order_items (
            order_id, merch_id, image_id, color_name, type_name, quantity, unit_price, line_total
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            order.id,
            line.merchId,
            line.imageId,
            line.colorName,
            line.typeName,
            line.quantity,
            line.unitPrice,
            line.lineTotal,
          ]
        );
      }

      if (status === 'paid') {
        await decrementMerchStock(client, lineRows);
        await client.query('COMMIT');
        // stock decremented inside transaction before commit
        await sendMerchReceiptEmails({
          pool,
          sendEmail,
          orderId: order.id,
          getAdminEmailsForEvent,
        });
        return res.json({ id: order.id, totalAmount: payable, status: 'paid' });
      }

      await client.query('COMMIT');
      res.json({ id: order.id, totalAmount: payable, status: order.status });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      res.status(500).json({ error: err.message || 'Failed to create merch order' });
    } finally {
      client.release();
    }
  });

  router.post('/api/merch-orders/initialize-payment', authOptional, async (req, res) => {
    try {
      if (!paystack?.initialize) {
        return res.status(503).json({ error: 'Paystack not configured' });
      }
      const { orderId, callbackUrl, email } = req.body;
      const orderRes = await pool.query('SELECT * FROM merch_orders WHERE id = $1', [orderId]);
      if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
      const order = orderRes.rows[0];
      if (order.status === 'paid') return res.status(400).json({ error: 'Already paid' });

      const amountKobo = Math.round(Number(order.total_amount) * 100);
      const init = await paystack.initialize({
        email: email || order.email,
        amount: amountKobo,
        reference: `merch_${orderId}_${Date.now()}`,
        callback_url: callbackUrl,
        metadata: { orderId, type: 'merch' },
      });
      res.json({
        authorizationUrl: init.authorization_url || init.authorizationUrl,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Payment init failed' });
    }
  });

  router.post('/api/merch-orders/verify', async (req, res) => {
    try {
      const { orderId, reference } = req.body;
      if (!paystack?.verify) {
        return res.status(503).json({ error: 'Paystack not configured' });
      }
      const verified = await paystack.verify(reference);
      if (!verified.success) {
        return res.status(400).json({ error: 'Payment not verified' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const orderRes = await client.query(
          'SELECT * FROM merch_orders WHERE id = $1 FOR UPDATE',
          [orderId]
        );
        if (orderRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Order not found' });
        }
        const order = orderRes.rows[0];
        if (order.status === 'paid') {
          await client.query('COMMIT');
          return res.json({ status: 'paid', id: order.id });
        }

        const itemsRes = await client.query(
          'SELECT * FROM merch_order_items WHERE order_id = $1',
          [orderId]
        );
        await decrementMerchStock(
          client,
          itemsRes.rows.map((r) => ({
            imageId: r.image_id,
            quantity: r.quantity,
          }))
        );

        await client.query(
          `UPDATE merch_orders SET status = 'paid', paystack_reference = $1, updated_at = NOW() WHERE id = $2`,
          [reference, orderId]
        );
        await client.query('COMMIT');

        await sendMerchReceiptEmails({
          pool,
          sendEmail,
          orderId,
          getAdminEmailsForEvent,
        });
        await notifyAdminsMerchPaid(pool, sendEmail, getAdminEmailsForEvent, orderId);

        res.json({ status: 'paid', id: order.id });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      res.status(500).json({ error: err.message || 'Verify failed' });
    }
  });

  router.post('/api/merch-orders/manual-payment-notify', async (req, res) => {
    try {
      const { orderId, email } = req.body;
      const orderRes = await pool.query(
        `SELECT mo.*, e.title AS event_title FROM merch_orders mo
         LEFT JOIN events e ON e.id = mo.event_id
         WHERE mo.id = $1`,
        [orderId]
      );
      if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
      const order = orderRes.rows[0];
      const itemsRes = await pool.query(
        `SELECT moi.*, em.description AS merch_description, emi.image_url
         FROM merch_order_items moi
         JOIN event_merch em ON em.id = moi.merch_id
         LEFT JOIN event_merch_images emi ON emi.id = moi.image_id
         WHERE moi.order_id = $1`,
        [orderId]
      );

      const adminEmails = await getAdminEmailsForEvent(order.event_id);
      const lines = itemsRes.rows
        .map(
          (r) =>
            `${r.merch_description || 'Merch'} x${r.quantity} — ₦${Number(r.line_total).toLocaleString()}`
        )
        .join('\n');

      for (const to of adminEmails) {
        await sendEmail({
          to,
          subject: `[Pending] Merch order — ${order.event_title || 'Event'}`,
          text: `Manual merch payment pending\nBuyer: ${order.full_name} <${email || order.email}>\nTotal: ₦${order.total_amount}\n\n${lines}`,
        });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Notify failed' });
    }
  });

  router.post('/api/merch-save-requests', async (req, res) => {
    try {
      const { eventId, merchId, fullName, email, message } = req.body;
      if (!eventId || !merchId || !fullName?.trim() || !email?.includes('@')) {
        return res.status(400).json({ error: 'Invalid save request' });
      }
      const merch = await fetchMerchById(pool, merchId);
      if (!merch) return res.status(404).json({ error: 'Merch not found' });
      if (merch.availability === 'online') {
        return res.status(400).json({ error: 'This merch is only available online' });
      }

      const resInsert = await pool.query(
        `INSERT INTO merch_save_requests (event_id, merch_id, full_name, email, message)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [eventId, merchId, fullName.trim(), email.trim(), message || null]
      );
      const row = resInsert.rows[0];

      const adminEmails = await getAdminEmailsForEvent(eventId);
      for (const to of adminEmails) {
        await sendEmail({
          to,
          subject: '[Pending] Merch save request',
          text: `${fullName} <${email}> requested to save merch for the event.\nMessage: ${message || '(none)'}`,
        });
      }

      res.status(201).json({
        id: row.id,
        status: row.status,
        message: 'Save request submitted. It will be confirmed after you purchase a ticket.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to submit save request' });
    }
  });

  router.get('/api/admin/merch-orders', authAdmin, async (req, res) => {
    try {
      const adminId = req.admin?.id;
      const isSuper = req.admin?.role === 'superadmin' || adminId === 0;
      let query = `
        SELECT mo.*, e.title AS event_title,
          COALESCE(json_agg(json_build_object(
            'merchDescription', em.description,
            'quantity', moi.quantity,
            'lineTotal', moi.line_total,
            'imageUrl', emi.image_url
          )) FILTER (WHERE moi.id IS NOT NULL), '[]') AS items
        FROM merch_orders mo
        LEFT JOIN events e ON e.id = mo.event_id
        LEFT JOIN merch_order_items moi ON moi.order_id = mo.id
        LEFT JOIN event_merch em ON em.id = moi.merch_id
        LEFT JOIN event_merch_images emi ON emi.id = moi.image_id
      `;
      const params = [];
      if (!isSuper && adminId) {
        params.push(adminId);
        query += ` WHERE e.created_by = $${params.length}`;
      }
      query += ` GROUP BY mo.id, e.title ORDER BY mo.created_at DESC LIMIT 200`;
      const result = await pool.query(query, params);
      res.json({ orders: result.rows.map(formatMerchOrderRow) });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to load merch orders' });
    }
  });

  router.patch('/api/admin/merch-orders/:id/status', authAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { status } = req.body;
      if (!['pending', 'paid', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const { id } = req.params;

      await client.query('BEGIN');
      const orderRes = await client.query(
        'SELECT * FROM merch_orders WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }
      const prev = orderRes.rows[0];

      if (status === 'paid' && prev.status !== 'paid') {
        const itemsRes = await client.query(
          'SELECT * FROM merch_order_items WHERE order_id = $1',
          [id]
        );
        await decrementMerchStock(
          client,
          itemsRes.rows.map((r) => ({ imageId: r.image_id, quantity: r.quantity }))
        );
      }

      await client.query(
        `UPDATE merch_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, id]
      );
      await client.query('COMMIT');

      if (status === 'paid' && prev.status !== 'paid') {
        await sendMerchReceiptEmails({ pool, sendEmail, orderId: id, getAdminEmailsForEvent });
        await notifyAdminsMerchPaid(pool, sendEmail, getAdminEmailsForEvent, id);
      }

      res.json({ id, status });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message || 'Status update failed' });
    } finally {
      client.release();
    }
  });

  router.get('/api/admin/merch-save-requests', authAdmin, async (req, res) => {
    try {
      const adminId = req.admin?.id;
      const isSuper = req.admin?.role === 'superadmin' || adminId === 0;
      let query = `
        SELECT msr.*, e.title AS event_title, em.description AS merch_description
        FROM merch_save_requests msr
        LEFT JOIN events e ON e.id = msr.event_id
        LEFT JOIN event_merch em ON em.id = msr.merch_id
      `;
      const params = [];
      if (!isSuper && adminId) {
        params.push(adminId);
        query += ` WHERE e.created_by = $${params.length}`;
      }
      query += ' ORDER BY msr.created_at DESC LIMIT 200';
      const result = await pool.query(query, params);
      res.json({
        requests: result.rows.map((r) => ({
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
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to load save requests' });
    }
  });

  router.patch('/api/admin/merch-save-requests/:id/status', authAdmin, async (req, res) => {
    try {
      const { status } = req.body;
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const resUpdate = await pool.query(
        `UPDATE merch_save_requests
         SET status = $1, reviewed_at = NOW(), reviewed_by = $2
         WHERE id = $3
         RETURNING *`,
        [status, req.admin?.id ?? null, req.params.id]
      );
      if (resUpdate.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const row = resUpdate.rows[0];

      if (status === 'approved') {
        await sendEmail({
          to: row.email,
          subject: 'Your merch save request was accepted',
          text: `Hi ${row.full_name},\n\nYour merch save request for the event has been accepted. Your items are saved.\n\n— GateWav`,
        });
      }

      res.json({ id: row.id, status: row.status });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Update failed' });
    }
  });

  return router;
}

export { insertMerchForEvent, replaceMerchForEvent, fetchMerchByEventId };

function formatMerchOrderRow(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    buyerName: row.full_name,
    buyerEmail: row.email,
    amount: Number(row.total_amount),
    status: row.status,
    paymentMethod: row.payment_method,
    createdAt: row.created_at,
    items: row.items || [],
  };
}

async function sendMerchReceiptEmails({ pool, orderId }) {
  const orderRes = await pool.query(
    `SELECT mo.*, e.title AS event_title FROM merch_orders mo
     LEFT JOIN events e ON e.id = mo.event_id WHERE mo.id = $1`,
    [orderId]
  );
  if (orderRes.rows.length === 0) return;
  const order = orderRes.rows[0];
  const itemsRes = await pool.query(
    `SELECT moi.*, em.description, emi.image_url
     FROM merch_order_items moi
     JOIN event_merch em ON em.id = moi.merch_id
     LEFT JOIN event_merch_images emi ON emi.id = moi.image_id
     WHERE moi.order_id = $1`,
    [orderId]
  );

  await sendMerchPurchaseReceipt({
    to: order.email,
    order,
    items: itemsRes.rows,
    eventTitle: order.event_title,
  });
}

async function notifyAdminsMerchPaid(pool, sendEmail, getAdminEmailsForEvent, orderId) {
  const orderRes = await pool.query(
    `SELECT mo.*, e.title AS event_title FROM merch_orders mo
     LEFT JOIN events e ON e.id = mo.event_id WHERE mo.id = $1`,
    [orderId]
  );
  if (orderRes.rows.length === 0) return;
  const order = orderRes.rows[0];
  const admins = await getAdminEmailsForEvent(order.event_id);
  for (const to of admins) {
    await sendEmail({
      to,
      subject: `[Paid] Merch order — ${order.event_title || 'Event'}`,
      text: `Merch paid via ${order.payment_method}\n${order.full_name} <${order.email}>\n₦${order.total_amount}`,
    });
  }
}
