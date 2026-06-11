import crypto from 'node:crypto';
import { query, createId } from '../../shared/config/db.js';
import { sendEmail, buildLiveStreamEmail } from '../../shared/services/email.service.js';
import { config } from '../../shared/config/env.js';
import { toEmbedUrl } from '../../shared/utils/streamUrl.js';

const PAID_STATUSES = ['paid', 'completed', 'success', 'changed', 'true'];

function isSuperAdmin(userId) {
  const sid = String(userId);
  return sid === '0' || userId === 0;
}

function frontendWatchUrl(eventId, token) {
  const base = (config.frontendBaseUrl || process.env.PUBLIC_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/#/event/${eventId}/watch?token=${encodeURIComponent(token)}`;
}

export const streamModel = {
  async listStreamableEvents(userId) {
    const params = [];
    let sql = `
      SELECT id, title, "eventType", "isLive", "liveStartedAt", "streamUrl", "streamProvider", date, "startTime"
      FROM "Event"
      WHERE LOWER(COALESCE("eventType", 'in-person')) IN ('online', 'hybrid')
    `;
    if (!isSuperAdmin(userId)) {
      params.push(String(userId));
      sql += ` AND "createdBy"::text = $${params.length}`;
    }
    sql += ' ORDER BY date ASC NULLS LAST, title ASC';
    const { rows } = await query(sql, params);
    return rows.map((row) => ({
      ...row,
      id: String(row.id),
    }));
  },

  async getStreamEvent(eventId, userId) {
    const params = [String(eventId)];
    let sql = `
      SELECT e.*,
        (SELECT COUNT(*)::int FROM "Order" o
         WHERE o."eventId"::text = e.id::text
           AND LOWER(TRIM(COALESCE(o.status, ''))) = ANY($2::text[])) AS "paidAttendeeCount"
      FROM "Event" e
      WHERE e.id::text = $1
        AND LOWER(COALESCE(e."eventType", 'in-person')) IN ('online', 'hybrid')
    `;
    params.push(PAID_STATUSES);
    if (!isSuperAdmin(userId)) {
      params.push(String(userId));
      sql += ` AND e."createdBy"::text = $${params.length}`;
    }
    const { rows } = await query(sql, params);
    return rows[0] || null;
  },

  async updateStreamConfig(eventId, userId, { streamUrl, streamProvider }) {
    const event = await this.getStreamEvent(eventId, userId);
    if (!event) return null;
    await query(
      `UPDATE "Event"
       SET "streamUrl" = $1, "streamProvider" = $2, "updatedAt" = NOW()
       WHERE id::text = $3`,
      [streamUrl?.trim() || null, streamProvider || 'youtube', String(eventId)]
    );
    return this.getStreamEvent(eventId, userId);
  },

  async getPaidOrdersForEvent(eventId) {
    const { rows } = await query(
      `SELECT o.id, o.email, o."fullName", o."userId"
       FROM "Order" o
       WHERE o."eventId"::text = $1
         AND LOWER(TRIM(COALESCE(o.status, ''))) = ANY($2::text[])
         AND COALESCE(TRIM(o.email), '') <> ''`,
      [String(eventId), PAID_STATUSES]
    );
    return rows;
  },

  async ensureStreamToken(orderId, eventId, email) {
    const existing = await query(
      'SELECT token FROM "StreamAccess" WHERE "orderId"::text = $1 AND "eventId"::text = $2 LIMIT 1',
      [String(orderId), String(eventId)]
    );
    if (existing.rows[0]?.token) return existing.rows[0].token;

    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO "StreamAccess" (id, "orderId", "eventId", email, token)
       VALUES ($1, $2, $3, $4, $5)`,
      [createId(), String(orderId), String(eventId), email, token]
    );
    return token;
  },

  async goLive(eventId, userId) {
    const event = await this.getStreamEvent(eventId, userId);
    if (!event) return { error: 'Event not found or not streamable' };
    if (!String(event.streamUrl || '').trim()) {
      return { error: 'Add a stream URL before going live' };
    }

    await query(
      `UPDATE "Event" SET "isLive" = TRUE, "liveStartedAt" = NOW(), "updatedAt" = NOW() WHERE id::text = $1`,
      [String(eventId)]
    );

    const orders = await this.getPaidOrdersForEvent(eventId);
    let emailsSent = 0;
    const failures = [];

    for (const order of orders) {
      try {
        const token = await this.ensureStreamToken(order.id, eventId, order.email);
        const watchUrl = frontendWatchUrl(eventId, token);
        const mail = buildLiveStreamEmail({
          eventTitle: event.title,
          watchUrl,
          buyerName: order.fullName,
        });
        await sendEmail({ to: order.email, ...mail });
        emailsSent += 1;
      } catch (err) {
        failures.push({ orderId: order.id, error: err.message });
      }
    }

    return {
      ok: true,
      emailsSent,
      attendeeCount: orders.length,
      failures,
      event: await this.getStreamEvent(eventId, userId),
    };
  },

  async endLive(eventId, userId) {
    const event = await this.getStreamEvent(eventId, userId);
    if (!event) return null;
    await query(
      `UPDATE "Event" SET "isLive" = FALSE, "updatedAt" = NOW() WHERE id::text = $1`,
      [String(eventId)]
    );
    return this.getStreamEvent(eventId, userId);
  },

  async getLiveStatus(eventId) {
    const { rows } = await query(
      `SELECT id, "eventType", "isLive", "liveStartedAt"
       FROM "Event" WHERE id::text = $1 LIMIT 1`,
      [String(eventId)]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      eventId: row.id,
      eventType: row.eventType || 'in-person',
      isLive: Boolean(row.isLive),
      liveStartedAt: row.liveStartedAt,
    };
  },

  async validateStreamAccess(eventId, token) {
    const { rows: accessRows } = await query(
      `SELECT sa.*, o.status AS "orderStatus"
       FROM "StreamAccess" sa
       INNER JOIN "Order" o ON o.id::text = sa."orderId"::text
       WHERE sa."eventId"::text = $1 AND sa.token = $2
       LIMIT 1`,
      [String(eventId), token]
    );
    const access = accessRows[0];
    if (!access) return { error: 'Invalid or expired access link' };
    if (!PAID_STATUSES.includes(String(access.orderStatus || '').toLowerCase().trim())) {
      return { error: 'Ticket payment is not confirmed' };
    }

    const { rows: eventRows } = await query(
      'SELECT title, "streamUrl", "streamProvider", "isLive", "eventType" FROM "Event" WHERE id::text = $1 LIMIT 1',
      [String(eventId)]
    );
    const event = eventRows[0];
    if (!event) return { error: 'Event not found' };
    if (!event.isLive) return { error: 'This event is not live yet', notLive: true, eventTitle: event.title };
    if (!event.streamUrl) return { error: 'Stream is not configured' };

    return {
      ok: true,
      eventTitle: event.title,
      eventType: event.eventType,
      embedUrl: toEmbedUrl(event.streamUrl, event.streamProvider),
      isLive: true,
    };
  },
};
