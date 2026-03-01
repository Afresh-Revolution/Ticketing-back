import { query } from '../../shared/db.js';

/** GET /api/user/orders - current user's orders (tickets) */
export async function getMyOrders(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await query(
      `SELECT o."id", o."eventId", o."fullName", o."email", o."totalAmount", o."status", o."reference", o."createdAt",
              e."title" AS "eventTitle", e."date" AS "eventDate"
       FROM "Order" o
       LEFT JOIN "Event" e ON e."id" = o."eventId"
       WHERE o."userId" = $1
       ORDER BY o."createdAt" DESC`,
      [userId]
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: String(row.id),
      eventId: row.eventId ? String(row.eventId) : null,
      eventTitle: row.eventTitle,
      eventDate: row.eventDate,
      fullName: row.fullName,
      email: row.email,
      totalAmount: row.totalAmount,
      status: row.status,
      reference: row.reference,
      createdAt: row.createdAt,
    }));
    return res.json(list);
  } catch {
    return res.json([]);
  }
}
