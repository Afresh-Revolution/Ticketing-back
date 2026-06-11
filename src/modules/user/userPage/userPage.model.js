import { query } from '../../../shared/config/db.js';
import { normalizeBuyerEmail } from '../../../shared/utils/email.js';

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

  /**
   * Attach guest checkout orders (null userId) to the signed-in account when emails match.
   */
  async linkGuestOrdersToUser(userId, userEmail) {
    const normalizedEmail = normalizeBuyerEmail(userEmail);
    if (!userId || !normalizedEmail) return;
    await query(
      `UPDATE "Order"
       SET "userId" = $1, "updatedAt" = NOW()
       WHERE "userId" IS NULL
         AND LOWER(TRIM(email)) = $2`,
      [userId, normalizedEmail]
    );
  },

  /** Fetches paid orders linked to the account or purchased with the same email. */
  async getMyOrders(userId, userEmail) {
    const normalizedEmail = normalizeBuyerEmail(userEmail);
    const { rows } = await query(
      `SELECT o.id AS "orderId", o."eventId", o."fullName", o.email, o."totalAmount", o.status, o."ticketCode", o."createdAt" AS "orderCreatedAt",
              e.title AS "event_title", e.description AS "event_description", e.date AS "event_date",
              e."endDate" AS "event_endDate", e."endTime" AS "event_endTime",
              COALESCE(e.venue, e.location) AS "event_venue", e.location AS "event_location",
              e."imageUrl" AS "event_imageUrl", e.category AS "event_category",
              e."startTime" AS "event_startTime", e."eventType" AS "event_type", e."isLive" AS "event_is_live"
       FROM "Order" o
       JOIN "Event" e ON e.id = o."eventId"
       WHERE o.status = 'paid'
         AND (
           o."userId" = $1
           OR ($2::text <> '' AND LOWER(TRIM(o.email)) = $2)
         )
       ORDER BY o."createdAt" DESC`,
      [userId, normalizedEmail]
    );
    const orders = [];
    for (const r of rows) {
      const { rows: items } = await query(
        `SELECT oi.quantity, oi.price, tt.name AS "ticketName",
                COALESCE(tt."deliveryMode", 'in_person') AS "deliveryMode"
         FROM "OrderItem" oi
         JOIN "TicketType" tt ON oi."ticketTypeId" = tt.id
         WHERE oi."orderId" = $1`,
        [r.orderId]
      );
      orders.push({
        id: r.orderId,
        eventId: r.eventId,
        ticketCode: r.ticketCode ?? null,
        fullName: r.fullName,
        email: r.email,
        totalAmount: r.totalAmount,
        status: r.status,
        createdAt: r.orderCreatedAt,
        event: {
          title: r.event_title,
          description: r.event_description,
          date: r.event_date,
          endDate: r.event_endDate,
          endTime: r.event_endTime,
          venue: r.event_venue,
          location: r.event_location,
          imageUrl: r.event_imageUrl,
          category: r.event_category,
          startTime: r.event_startTime,
          eventType: r.event_type,
          isLive: Boolean(r.event_is_live),
        },
        items,
      });
    }
    return orders;
  },
};
