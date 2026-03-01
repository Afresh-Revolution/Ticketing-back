import { query } from '../../shared/config/db.js';

/** POST /api/orders - create order (eventId, items, totalAmount, fullName, email, phone?, address?) */
export async function createOrder(req, res) {
  try {
    const { eventId, items, totalAmount, fullName, email, phone, address } = req.body || {};
    const userId = req.userId || null;
    if (!eventId || !items || !Array.isArray(items) || items.length === 0 || totalAmount == null) {
      return res.status(400).json({ error: 'eventId, items and totalAmount required' });
    }
    const ref = `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const result = await query(
      `INSERT INTO "Order" ("eventId", "userId", "fullName", "email", "phone", "address", "totalAmount", "status", "reference")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING "id", "reference", "status", "totalAmount"`,
      [
        eventId,
        userId,
        (fullName || '').trim() || null,
        (email || '').trim() || null,
        (phone || '').trim() || null,
        (address || '').trim() || null,
        Number(totalAmount),
        ref,
      ]
    ).catch((e) => {
      if (e.code === '42P01') return null;
      throw e;
    });
    if (!result || result.rows.length === 0) {
      return res.status(501).json({ error: 'Orders table not configured' });
    }
    const row = result.rows[0];
    return res.status(201).json({
      id: row.id,
      reference: row.reference,
      status: row.status,
      totalAmount: row.totalAmount,
    });
  } catch (err) {
    console.error('createOrder', err);
    return res.status(500).json({ error: err.message || 'Failed to create order' });
  }
}

/** POST /api/orders/verify - body: reference, orderId */
export async function verifyOrder(req, res) {
  try {
    const { reference, orderId } = req.body || {};
    if (!reference || !orderId) {
      return res.status(400).json({ error: 'reference and orderId required' });
    }
    await query(
      'UPDATE "Order" SET "status" = \'paid\', "reference" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [reference, orderId]
    ).catch((e) => {
      if (e.code === '42P01') return { rowCount: 0 };
      throw e;
    });
    return res.json({ message: 'Verified' });
  } catch (err) {
    console.error('verifyOrder', err);
    return res.status(500).json({ error: err.message || 'Verification failed' });
  }
}
