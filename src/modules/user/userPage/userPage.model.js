import { query } from '../../../shared/config/db.js';

export const userPageModel = {
  async getProfile(userId) {
    const { rows } = await query(
      'SELECT id, email, name, "createdAt" FROM "User" WHERE id = $1',
      [userId]
    );
    return rows[0] ?? null;
  },
  async getTickets(userId) {
    const { rows } = await query(
      `SELECT t.*, e.id AS "event_id", e.title AS "event_title", e.description AS "event_description",
              e.date AS "event_date", e.venue AS "event_venue", e."imageUrl" AS "event_imageUrl",
              e.category AS "event_category", e."startTime" AS "event_startTime",
              e.price AS "event_price", e.currency AS "event_currency",
              e."createdAt" AS "event_createdAt", e."updatedAt" AS "event_updatedAt"
       FROM "Ticket" t
       JOIN "Event" e ON e.id = t."eventId"
       WHERE t."userId" = $1
       ORDER BY t."createdAt" DESC`,
      [userId]
    );
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      userId: r.userId,
      email: r.email,
      quantity: r.quantity,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      event: {
        id: r.event_id,
        title: r.event_title,
        description: r.event_description,
        date: r.event_date,
        venue: r.event_venue,
        imageUrl: r.event_imageUrl,
        category: r.event_category,
        startTime: r.event_startTime,
        price: r.event_price,
        currency: r.event_currency,
        createdAt: r.event_createdAt,
        updatedAt: r.event_updatedAt,
      },
    }));
  },

  /** Fetches paid orders for the user with event and order item details (ticket purchases) */
  async getMyOrders(userId) {
    const { rows } = await query(
      `SELECT o.id AS "orderId", o."eventId", o."fullName", o.email, o."totalAmount", o.status, o."createdAt" AS "orderCreatedAt",
              e.title AS "event_title", e.description AS "event_description", e.date AS "event_date",
              e.venue AS "event_venue", e."imageUrl" AS "event_imageUrl", e.category AS "event_category",
              e."startTime" AS "event_startTime"
       FROM "Order" o
       JOIN "Event" e ON e.id = o."eventId"
       WHERE o."userId" = $1 AND o.status = 'paid'
       ORDER BY o."createdAt" DESC`,
      [userId]
    );
    const orders = [];
    for (const r of rows) {
      const { rows: items } = await query(
        `SELECT oi.quantity, oi.price, tt.name AS "ticketName"
         FROM "OrderItem" oi
         JOIN "TicketType" tt ON oi."ticketTypeId" = tt.id
         WHERE oi."orderId" = $1`,
        [r.orderId]
      );
      orders.push({
        id: r.orderId,
        eventId: r.eventId,
        fullName: r.fullName,
        email: r.email,
        totalAmount: r.totalAmount,
        status: r.status,
        createdAt: r.orderCreatedAt,
        event: {
          title: r.event_title,
          description: r.event_description,
          date: r.event_date,
          venue: r.event_venue,
          imageUrl: r.event_imageUrl,
          category: r.event_category,
          startTime: r.event_startTime,
        },
        items,
      });
    }
    return orders;
  },
};
