import crypto from 'node:crypto';
import { query, createId, getPool } from '../../shared/config/db.js';
import { sendPushToEmail } from '../../shared/services/push.service.js';
import {
  assertCheckin,
  assertManager,
  audit,
  httpError,
  isSuper,
  loadEvent,
  userIdOf,
} from './access.js';
import { generateSessionInstants } from './recurrence.js';
import { ensureGatewav2Schema } from './schema.js';

function code() {
  return crypto.randomBytes(6).toString('hex');
}

const MISSING_SCHEMA = new Set(['42P01', '42703', '42883']);

async function q(sql, params) {
  try {
    return await query(sql, params);
  } catch (err) {
    if (!MISSING_SCHEMA.has(err?.code)) throw err;
    await ensureGatewav2Schema({ force: true });
    return query(sql, params);
  }
}

export async function listSessions(eventId) {
  const result = await q(
    `SELECT id, "eventId", "startsAt", "endsAt", timezone, capacity, price, status, "cancelReason"
     FROM "EventSession"
     WHERE "eventId" = $1 AND "startsAt" > NOW() - INTERVAL '1 day'
     ORDER BY "startsAt" ASC
     LIMIT 60`,
    [String(eventId)],
  );
  return result.rows || [];
}

export async function generateSessions(req, eventId, body) {
  const { event } = await assertManager(req, eventId);
  const frequency = body.frequency || event.recurrenceFrequency;
  const instants = generateSessionInstants({
    startDate: body.startDate || event.date,
    startTime: body.startTime || event.startTime || '19:00',
    frequency,
    weekday: body.weekday || event.recurrenceWeekday,
    until: body.until || event.recurrenceUntil,
    timeZone: body.timeZone || event.timezone || 'Africa/Lagos',
    max: body.max || 52,
    blackouts: Array.isArray(body.blackouts) ? body.blackouts : [],
  });
  if (!instants.length) {
    throw httpError(400, 'Add a date on this event before generating weekly sessions.');
  }
  let created = 0;
  for (const instant of instants) {
    const id = `${event.id}:${instant.startsAt}`;
    const inserted = await q(
      `INSERT INTO "EventSession" (id, "eventId", "startsAt", timezone, capacity, price, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
       ON CONFLICT ("eventId", "startsAt") DO NOTHING
       RETURNING id`,
      [
        id,
        String(event.id),
        instant.startsAt,
        instant.timeZone,
        body.capacity != null ? Number(body.capacity) : null,
        body.price != null ? Number(body.price) : null,
      ],
    );
    if (inserted.rows?.length) created += 1;
  }
  if (Array.isArray(body.blackouts)) {
    for (const day of body.blackouts) {
      await query(
        `UPDATE "EventSession" SET status = 'cancelled', "cancelReason" = 'blackout'
         WHERE "eventId" = $1 AND ("startsAt" AT TIME ZONE COALESCE(timezone, 'Africa/Lagos'))::date = $2::date`,
        [String(event.id), String(day).slice(0, 10)],
      ).catch(() => null);
    }
  }
  await audit(userIdOf(req), 'sessions_generated', 'event', event.id, { created });
  return { created, sessions: await listSessions(event.id) };
}

export async function cancelSession(req, eventId, sessionId, reason) {
  await assertManager(req, eventId);
  const updated = await query(
    `UPDATE "EventSession" SET status = 'cancelled', "cancelReason" = $3
     WHERE id = $1 AND "eventId" = $2 AND status <> 'cancelled'
     RETURNING id`,
    [sessionId, String(eventId), reason ? String(reason).slice(0, 200) : 'Cancelled instance'],
  );
  if (!updated.rows?.length) throw httpError(404, 'Session not found');
  await audit(userIdOf(req), 'session_cancelled', 'session', sessionId, {});
  return { cancelled: true, seriesContinues: true };
}

export async function inviteStaff(req, eventId, body) {
  const access = await assertManager(req, eventId);
  let staffUserId = Number(body.userId);
  if (!staffUserId && body.email) {
    const email = String(body.email).trim().toLowerCase();
    if (!email.includes('@')) throw httpError(400, 'Enter the email on their GateWav account.');
    const found = await query(`SELECT id FROM "User" WHERE LOWER(TRIM(email)) = $1 LIMIT 1`, [email]);
    const raw = found.rows?.[0]?.id;
    staffUserId = Number(raw);
    if (raw == null || !Number.isFinite(staffUserId) || staffUserId <= 0) {
      throw httpError(404, 'No GateWav account uses that email. They need to sign up first.');
    }
  }
  if (!staffUserId) throw httpError(400, 'Enter the email on their GateWav account.');
  const role = body.role === 'manager' ? 'manager' : 'checkin';
  if (role === 'manager' && access.role === 'manager') {
    throw httpError(403, 'Only the organizer can grant manager access');
  }
  await q(
    `INSERT INTO "EventStaff" (id, "eventId", "userId", role, status, "invitedBy")
     VALUES ($1, $2, $3, $4, 'active', $5)
     ON CONFLICT ("eventId", "userId") DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
    [createId(), String(eventId), staffUserId, role, userIdOf(req)],
  );
  await audit(userIdOf(req), 'staff_invited', 'event', eventId, { staffUserId, role });
  return listStaff(req, eventId);
}

export async function listStaff(req, eventId) {
  await assertManager(req, eventId);
  const result = await query(
    `SELECT s."userId", s.role, s.status, s."createdAt", u.name, u.email
     FROM "EventStaff" s
     LEFT JOIN "User" u ON u.id::text = s."userId"::text
     WHERE s."eventId" = $1 AND s.status <> 'revoked'
     ORDER BY s."createdAt" ASC`,
    [String(eventId)],
  ).catch(async (err) => {
    if (!['42P01', '42703', '42883'].includes(err?.code)) throw err;
    return query(
      `SELECT "userId", role, status, "createdAt" FROM "EventStaff" WHERE "eventId" = $1 ORDER BY "createdAt" ASC`,
      [String(eventId)],
    );
  });
  return (result.rows || []).map((row) => ({
    userId: row.userId,
    role: row.role,
    status: row.status,
    name: row.name || '',
    email: row.email || '',
  }));
}

export async function removeStaff(req, eventId, staffUserId) {
  await assertManager(req, eventId);
  await query(`UPDATE "EventStaff" SET status = 'revoked' WHERE "eventId" = $1 AND "userId" = $2`, [
    String(eventId),
    Number(staffUserId),
  ]);
  await audit(userIdOf(req), 'staff_revoked', 'event', eventId, { staffUserId });
  return { revoked: true };
}

export async function guestList(req, eventId) {
  await assertCheckin(req, eventId);
  const guestSql = `SELECT o.id, o."fullName", o.email, o.status, o."totalAmount", o."createdAt",
            COALESCE(SUM(oi.quantity), 0)::int AS tickets
     FROM "Order" o
     LEFT JOIN "OrderItem" oi ON oi."orderId"::text = o.id::text
     WHERE o."eventId"::text = $1
     GROUP BY o.id
     ORDER BY o."createdAt" DESC
     LIMIT 500`;
  const result = await q(guestSql, [String(eventId)]).catch(async (err) => {
    if (err?.code !== '42803') throw err;
    return q(
      `SELECT o.id, o."fullName", o.email, o.status, o."totalAmount", o."createdAt",
              COALESCE(SUM(oi.quantity), 0)::int AS tickets
       FROM "Order" o
       LEFT JOIN "OrderItem" oi ON oi."orderId"::text = o.id::text
       WHERE o."eventId"::text = $1
       GROUP BY o.id, o."fullName", o.email, o.status, o."totalAmount", o."createdAt"
       ORDER BY o."createdAt" DESC
       LIMIT 500`,
      [String(eventId)],
    );
  });
  return (result.rows || []).map((row) => ({
    id: String(row.id),
    fullName: row.fullName,
    email: row.email,
    status: row.status,
    tickets: Number(row.tickets) || 0,
    totalAmount: Number(row.totalAmount) || 0,
    createdAt: row.createdAt,
    admitted: Boolean(row.ticketCode),
  }));
}

export function guestsToCsv(rows) {
  const header = ['name', 'email', 'status', 'tickets', 'amount_ngn', 'created'];
  const lines = rows.map((row) =>
    [row.fullName, row.email, row.status, row.tickets, row.totalAmount, row.createdAt]
      .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export async function issueComp(req, eventId, body) {
  const { event } = await assertManager(req, eventId);
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.fullName || '').trim();
  const ticketTypeId = String(body.ticketTypeId || '').trim();
  const quantity = Math.max(1, Math.min(10, Number(body.quantity) || 1));
  if (!email || !name || !ticketTypeId) throw httpError(400, 'Name, email, and ticket type are required');
  const ticket = await query(
    `SELECT id, name, quantity FROM "TicketType" WHERE id::text = $1 AND "eventId"::text = $2`,
    [ticketTypeId, String(event.id)],
  );
  if (!ticket.rows?.length) throw httpError(404, 'Ticket type not found');
  const sold = await query(
    `SELECT COALESCE(SUM(oi.quantity), 0)::int AS sold
     FROM "OrderItem" oi
     JOIN "Order" o ON o.id::text = oi."orderId"::text
     WHERE oi."ticketTypeId"::text = $1
       AND LOWER(COALESCE(o.status, '')) IN ('paid', 'completed', 'success')`,
    [ticketTypeId],
  );
  const cap = Number(ticket.rows[0].quantity) || 0;
  const used = Number(sold.rows?.[0]?.sold) || 0;
  if (cap > 0 && used + quantity > cap) throw httpError(400, 'Not enough tickets left for this comp');
  const orderId = createId();
  const ticketCode = `COMP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const reference = `comp_${orderId.slice(0, 8)}`;
  const orderParams = [orderId, String(event.id), name, email, reference];
  try {
    await q(
      `INSERT INTO "Order" ("id", "eventId", "fullName", "email", "totalAmount", "status", "reference", "originalAmount", "discountAmount", "quantityDiscountAmount")
       VALUES ($1, $2, $3, $4, 0, 'paid', $5, 0, 0, 0)`,
      orderParams,
    );
  } catch (err) {
    if (err?.code !== '42703' && err?.code !== '23502') throw err;
    await q(
      `INSERT INTO "Order" (id, "eventId", "fullName", email, "totalAmount", status, reference)
       VALUES ($1, $2, $3, $4, 0, 'paid', $5)`,
      orderParams,
    );
  }
  await query(`UPDATE "Order" SET "ticketCode" = $2 WHERE id::text = $1`, [orderId, ticketCode]).catch(() => null);
  await q(
    `INSERT INTO "OrderItem" (id, "orderId", "ticketTypeId", quantity, price) VALUES ($1, $2, $3, $4, 0)`,
    [createId(), orderId, ticketTypeId, quantity],
  );
  await audit(userIdOf(req), 'comp_issued', 'order', orderId, { eventId: String(event.id), quantity });
  return { orderId, ticketCode, status: 'paid', amount: 0 };
}

export async function setRefundStatus(req, orderId, body) {
  const order = await query(`SELECT id, "eventId", status, "totalAmount" FROM "Order" WHERE id::text = $1`, [
    String(orderId),
  ]);
  const row = order.rows?.[0];
  if (!row) throw httpError(404, 'Order not found');
  await assertManager(req, row.eventId);
  const status = ['completed', 'rejected', 'chargeback', 'initiated'].includes(body.status)
    ? body.status
    : 'initiated';
  const id = createId();
  await q(
    `INSERT INTO "RefundCase" (id, "orderId", "eventId", status, reason, "actorUserId")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, String(row.id), String(row.eventId), status, body.reason ? String(body.reason).slice(0, 400) : null, userIdOf(req)],
  );
  if (status === 'completed' || status === 'chargeback') {
    await q(`UPDATE "Order" SET status = 'refunded', "updatedAt" = NOW() WHERE id::text = $1`, [String(row.id)]).catch((err) => {
      if (err?.code !== '42703') throw err;
      return query(`UPDATE "Order" SET status = 'refunded' WHERE id::text = $1`, [String(row.id)]);
    });
    await query(
      `UPDATE "PromoterConversion"
       SET status = 'reversed', "commissionAmount" = 0, "reversedReason" = $2, "updatedAt" = NOW()
       WHERE "orderId" = $1 AND status <> 'reversed'`,
      [String(row.id), status === 'chargeback' ? 'chargeback' : 'refund'],
    ).catch(() => null);
  }
  await audit(userIdOf(req), 'refund_status', 'order', row.id, { status });
  return {
    id,
    status,
    note: 'This records refund progress. It does not move payout funds. Completed refunds revoke admission and reverse promoter commission.',
  };
}

export async function createCampaign(req, eventId, body) {
  const { event } = await assertManager(req, eventId);
  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, 'Campaign name is required');
  const type = body.commissionType === 'fixed' ? 'fixed' : 'percent';
  const value = Math.max(0, Math.round(Number(body.commissionValue) || 0));
  if (type === 'percent' && value > 100) throw httpError(400, 'Percent commission cannot exceed 100');
  const id = createId();
  await q(
    `INSERT INTO "PromoterCampaign"
      (id, "eventId", "organizerUserId", name, "commissionType", "commissionValue", "windowDays", status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
    [
      id,
      String(event.id),
      userIdOf(req) || 0,
      name.slice(0, 80),
      type,
      value,
      Math.min(90, Math.max(1, Number(body.windowDays) || 14)),
    ],
  );
  await audit(userIdOf(req), 'campaign_created', 'campaign', id, {});
  return { id, name, commissionType: type, commissionValue: value, attributionRule: 'last_touch' };
}

export async function invitePromoter(req, campaignId, body) {
  const campaign = await query(`SELECT * FROM "PromoterCampaign" WHERE id = $1`, [campaignId]);
  const row = campaign.rows?.[0];
  if (!row) throw httpError(404, 'Campaign not found');
  await assertManager(req, row.eventId);
  const shareCode = code();
  const id = createId();
  await q(
    `INSERT INTO "PromoterMember" (id, "campaignId", "userId", email, "shareCode", status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [id, campaignId, body.userId != null ? Number(body.userId) : null, body.email ? String(body.email).slice(0, 160) : null, shareCode],
  );
  return { id, shareCode, status: 'active' };
}

export async function removePromoter(req, campaignId, memberId) {
  const campaign = await query(`SELECT * FROM "PromoterCampaign" WHERE id = $1`, [campaignId]);
  const row = campaign.rows?.[0];
  if (!row) throw httpError(404, 'Campaign not found');
  await assertManager(req, row.eventId);
  const updated = await query(
    `UPDATE "PromoterMember" SET status = 'removed'
     WHERE id = $1 AND "campaignId" = $2 AND status = 'active'
     RETURNING id`,
    [memberId, campaignId],
  );
  if (!updated.rows?.length) throw httpError(404, 'Promoter not found');
  await audit(userIdOf(req), 'promoter_removed', 'campaign', campaignId, { memberId });
  return { removed: true };
}

export async function recordClick(shareCode, anonId) {
  const member = await query(
    `SELECT m."shareCode" FROM "PromoterMember" m
     JOIN "PromoterCampaign" c ON c.id = m."campaignId"
     WHERE m."shareCode" = $1 AND m.status = 'active' AND c.status = 'active'`,
    [shareCode],
  );
  if (!member.rows?.length) return { ok: false };
  await query(`INSERT INTO "PromoterClick" (id, "shareCode", "anonId") VALUES ($1, $2, $3)`, [
    createId(),
    shareCode,
    anonId ? String(anonId).slice(0, 64) : null,
  ]);
  return { ok: true };
}

export async function rememberCheckout(orderId, body) {
  if (!orderId) return;
  const shareCode = body?.promoterShareCode ? String(body.promoterShareCode).slice(0, 64) : null;
  const sessionId = body?.sessionId ? String(body.sessionId) : null;
  if (!shareCode && !sessionId) return;
  await query(
    `INSERT INTO "CheckoutAttribution" ("orderId", "shareCode", "sessionId")
     VALUES ($1, $2, $3)
     ON CONFLICT ("orderId") DO UPDATE SET
       "shareCode" = COALESCE(EXCLUDED."shareCode", "CheckoutAttribution"."shareCode"),
       "sessionId" = COALESCE(EXCLUDED."sessionId", "CheckoutAttribution"."sessionId")`,
    [String(orderId), shareCode, sessionId],
  );
  if (sessionId) {
    await query(`UPDATE "Order" SET "sessionId" = $2 WHERE id::text = $1 AND "sessionId" IS NULL`, [
      String(orderId),
      sessionId,
    ]).catch(() => null);
  }
  if (shareCode) await recordClick(shareCode, null);
}

export async function settlePromoterForOrder(order) {
  if (!order?.id) return;
  const attr = await query(`SELECT "shareCode" FROM "CheckoutAttribution" WHERE "orderId" = $1`, [String(order.id)]).catch(
    () => ({ rows: [] }),
  );
  const shareCode = attr.rows?.[0]?.shareCode;
  if (!shareCode) return;
  const paid = String(order.status || '').toLowerCase();
  if (!['paid', 'completed', 'success'].includes(paid)) return;
  const member = await query(
    `SELECT m."shareCode", c.*
     FROM "PromoterMember" m
     JOIN "PromoterCampaign" c ON c.id = m."campaignId"
     WHERE m."shareCode" = $1 AND m.status = 'active' AND c.status = 'active'`,
    [shareCode],
  );
  const campaign = member.rows?.[0];
  if (!campaign) return;
  if (String(campaign.eventId) !== String(order.eventId)) return;
  const windowDays = Number(campaign.windowDays) || 14;
  const click = await query(
    `SELECT "createdAt" FROM "PromoterClick"
     WHERE "shareCode" = $1 AND "createdAt" > NOW() - ($2 || ' days')::interval
     ORDER BY "createdAt" DESC LIMIT 1`,
    [shareCode, String(windowDays)],
  );
  if (!click.rows?.length) return;
  const gross = Math.max(0, Math.round(Number(order.totalAmount) || 0));
  let commission = 0;
  if (campaign.commissionType === 'fixed') commission = Math.min(gross, Number(campaign.commissionValue) || 0);
  else commission = Math.round((gross * Math.min(100, Number(campaign.commissionValue) || 0)) / 100);
  const tickets = await query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS count FROM "OrderItem" WHERE "orderId"::text = $1`,
    [String(order.id)],
  ).catch(() => ({ rows: [{ count: 1 }] }));
  await query(
    `INSERT INTO "PromoterConversion"
      (id, "campaignId", "shareCode", "orderId", "grossAmount", "commissionAmount", "ticketCount", status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     ON CONFLICT ("orderId") DO NOTHING`,
    [createId(), campaign.id, shareCode, String(order.id), gross, commission, Number(tickets.rows?.[0]?.count) || 1],
  );
}

export async function promoterDashboard(req) {
  const userId = userIdOf(req);
  if (userId == null) throw httpError(401, 'Sign in to continue.');
  const result = await query(
    `SELECT m."shareCode", c.name AS campaign, c."eventId", e.title AS "eventTitle",
            c."commissionType", c."commissionValue",
            (SELECT COUNT(*)::int FROM "PromoterClick" k WHERE k."shareCode" = m."shareCode") AS clicks,
            (SELECT COUNT(*)::int FROM "PromoterConversion" v WHERE v."shareCode" = m."shareCode" AND v.status <> 'reversed') AS orders,
            (SELECT COALESCE(SUM("ticketCount"), 0)::int FROM "PromoterConversion" v WHERE v."shareCode" = m."shareCode" AND v.status <> 'reversed') AS tickets,
            (SELECT COALESCE(SUM("commissionAmount"), 0)::int FROM "PromoterConversion" v WHERE v."shareCode" = m."shareCode" AND v.status = 'pending') AS pending,
            (SELECT COALESCE(SUM("commissionAmount"), 0)::int FROM "PromoterConversion" v WHERE v."shareCode" = m."shareCode" AND v.status = 'paid') AS paid
     FROM "PromoterMember" m
     JOIN "PromoterCampaign" c ON c.id = m."campaignId"
     LEFT JOIN "Event" e ON e.id::text = c."eventId"
     WHERE m.status = 'active'
       AND (m."userId"::text = $1
        OR m.email = (SELECT email FROM "User" WHERE id::text = $1 LIMIT 1))`,
    [String(userId)],
  ).catch((err) => {
    if (err?.code === '42P01' || err?.code === '42703' || err?.code === '42883') return { rows: [] };
    throw err;
  });
  const payouts = await q(
    `SELECT id, "shareCode", "eventId", amount, status, "bankName", "accountName", "createdAt"
     FROM "PromoterPayout"
     WHERE "userId"::text = $1
     ORDER BY "createdAt" DESC
     LIMIT 30`,
    [String(userId)],
  );
  const bank = await query(
    `SELECT "accountName", "accountNumber", "bankCode", "bankName"
     FROM "BankAccount" WHERE "userId"::text = $1 LIMIT 1`,
    [String(userId)],
  ).catch((err) => {
    if (err?.code === '42P01' || err?.code === '42703') return { rows: [] };
    throw err;
  });
  const account = bank.rows?.[0] || null;
  return {
    rows: result.rows || [],
    payouts: payouts.rows || [],
    bank: account
      ? {
        accountName: account.accountName || '',
        accountNumber: account.accountNumber || '',
        bankCode: account.bankCode || '',
        bankName: account.bankName || '',
      }
      : null,
  };
}

export async function campaignReport(req, eventId) {
  await assertManager(req, eventId);
  const result = await q(
    `SELECT c.id, c.name, c."commissionType", c."commissionValue", c."windowDays", c.status,
            m.id AS "memberId", m."shareCode", m.email, m.status AS member_status,
            (SELECT COUNT(*)::int FROM "PromoterClick" k WHERE k."shareCode" = m."shareCode") AS clicks,
            (SELECT COUNT(*)::int FROM "PromoterConversion" v WHERE v."shareCode" = m."shareCode" AND v.status <> 'reversed') AS qualified_orders,
            (SELECT COALESCE(SUM(CASE WHEN v."ticketCount" > 0 THEN v."ticketCount" ELSE 1 END), 0)::int FROM "PromoterConversion" v WHERE v."shareCode" = m."shareCode" AND v.status <> 'reversed') AS tickets,
            (SELECT COALESCE(SUM(v."commissionAmount"), 0)::int FROM "PromoterConversion" v WHERE v."shareCode" = m."shareCode" AND v.status <> 'reversed') AS net_commission
     FROM "PromoterCampaign" c
     LEFT JOIN "PromoterMember" m ON m."campaignId" = c.id
     WHERE c."eventId" = $1
     ORDER BY c."createdAt" DESC`,
    [String(eventId)],
  );
  return result.rows || [];
}

async function promoterBank(userId) {
  const bank = await query(
    `SELECT "accountName", "accountNumber", "bankCode", "bankName"
     FROM "BankAccount" WHERE "userId"::text = $1 LIMIT 1`,
    [String(userId)],
  ).catch((err) => {
    if (err?.code === '42P01' || err?.code === '42703') return { rows: [] };
    throw err;
  });
  return bank.rows?.[0] || null;
}

export async function requestPromoterPayout(req, shareCode) {
  const userId = userIdOf(req);
  if (userId == null) throw httpError(401, 'Sign in to continue.');
  const code = String(shareCode || '').trim();
  if (!code) throw httpError(400, 'Choose a campaign.');
  const member = await query(
    `SELECT m."shareCode", m."campaignId", c."eventId", e.title AS "eventTitle",
            organizer.email AS "organizerEmail"
     FROM "PromoterMember" m
     JOIN "PromoterCampaign" c ON c.id = m."campaignId"
     LEFT JOIN "Event" e ON e.id::text = c."eventId"::text
     LEFT JOIN "User" organizer ON organizer.id::text = e."createdBy"::text
     WHERE m."shareCode" = $1
       AND m.status = 'active'
       AND (m."userId"::text = $2
         OR lower(m.email) = (SELECT lower(email) FROM "User" WHERE id::text = $2 LIMIT 1))`,
    [code, String(userId)],
  );
  const campaign = member.rows?.[0];
  if (!campaign) throw httpError(404, 'That campaign is not on your account.');
  const bank = await promoterBank(userId);
  if (!bank?.accountNumber || !bank?.bankCode) {
    throw httpError(400, 'Save a bank account before requesting a payout.');
  }
  const open = await q(
    `SELECT id FROM "PromoterPayout" WHERE "shareCode" = $1 AND status = 'pending' LIMIT 1`,
    [code],
  );
  if (open.rows?.length) throw httpError(409, 'A payout request is already waiting for this campaign.');
  const pending = await q(
    `SELECT id, "commissionAmount"
     FROM "PromoterConversion"
     WHERE "shareCode" = $1 AND status = 'pending' AND "payoutId" IS NULL`,
    [code],
  );
  const conversions = pending.rows || [];
  const amount = conversions.reduce((sum, row) => sum + (Number(row.commissionAmount) || 0), 0);
  if (amount <= 0) throw httpError(400, 'There is no pending commission to request.');
  const id = createId();
  const pool = getPool();
  if (!pool) throw httpError(500, 'Something went wrong. Please try again.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "PromoterPayout"
        (id, "userId", "eventId", "campaignId", "shareCode", amount, status, "accountName", "accountNumber", "bankCode", "bankName")
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)`,
      [
        id,
        userId,
        String(campaign.eventId),
        campaign.campaignId,
        code,
        amount,
        bank.accountName || '',
        bank.accountNumber,
        bank.bankCode,
        bank.bankName || '',
      ],
    );
    const reserved = await client.query(
      `UPDATE "PromoterConversion" SET "payoutId" = $1
       WHERE id = ANY($2::text[]) AND status = 'pending' AND "payoutId" IS NULL`,
      [id, conversions.map((row) => String(row.id))],
    );
    if (!reserved.rowCount) throw httpError(409, 'That commission was just included in another request.');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') throw httpError(409, 'A payout request is already waiting for this campaign.');
    throw err;
  } finally {
    client.release();
  }
  if (campaign.organizerEmail) {
    await sendPushToEmail(campaign.organizerEmail, {
      title: 'Promoter payout request',
      body: `A promoter asked for ₦${amount} on ${campaign.eventTitle || 'your event'}.`,
      data: { eventId: String(campaign.eventId) },
    }).catch(() => null);
  }
  await audit(userId, 'promoter_payout_requested', 'payout', id, { amount });
  return { id, amount, status: 'pending' };
}

export async function listPromoterPayouts(req, eventId) {
  await assertManager(req, eventId);
  const result = await q(
    `SELECT p.id, p."shareCode", p.amount, p.status, p."accountName", p."accountNumber", p."bankName", p."createdAt",
            COALESCE(u.name, m.email, 'Promoter') AS promoter
     FROM "PromoterPayout" p
     LEFT JOIN "User" u ON u.id::text = p."userId"::text
     LEFT JOIN "PromoterMember" m ON m."shareCode" = p."shareCode"
     WHERE p."eventId"::text = $1
     ORDER BY CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END, p."createdAt" DESC
     LIMIT 40`,
    [String(eventId)],
  );
  return result.rows || [];
}

export async function reviewPromoterPayout(req, payoutId, decision) {
  const userId = userIdOf(req);
  if (userId == null) throw httpError(401, 'Sign in to continue.');
  const found = await q(`SELECT * FROM "PromoterPayout" WHERE id = $1`, [String(payoutId)]);
  const payout = found.rows?.[0];
  if (!payout) throw httpError(404, 'Payout request not found.');
  if (payout.status !== 'pending') throw httpError(409, 'This request was already reviewed.');
  await assertManager(req, payout.eventId);
  const approve = decision === 'approve';
  if (!approve && decision !== 'decline') throw httpError(400, 'Choose approve or decline.');
  const pool = getPool();
  if (!pool) throw httpError(500, 'Something went wrong. Please try again.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE "PromoterPayout"
       SET status = $2, "reviewedBy" = $3, "updatedAt" = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [payout.id, approve ? 'approved' : 'declined', userId],
    );
    if (!updated.rowCount) throw httpError(409, 'This request was already reviewed.');
    if (approve) {
      await client.query(
        `UPDATE "PromoterConversion"
         SET status = 'paid', "updatedAt" = NOW()
         WHERE "payoutId" = $1 AND status = 'pending'`,
        [payout.id],
      );
    } else {
      await client.query(
        `UPDATE "PromoterConversion" SET "payoutId" = NULL
         WHERE "payoutId" = $1 AND status = 'pending'`,
        [payout.id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const promoter = await query(`SELECT email FROM "User" WHERE id::text = $1`, [String(payout.userId)]).catch(() => ({ rows: [] }));
  if (promoter.rows?.[0]?.email) {
    await sendPushToEmail(promoter.rows[0].email, {
      title: approve ? 'Payout approved' : 'Payout declined',
      body: approve
        ? `Your ₦${payout.amount} commission request was approved.`
        : 'Your commission payout request was declined. The amount is pending again.',
      data: { eventId: String(payout.eventId) },
    }).catch(() => null);
  }
  await audit(userId, approve ? 'promoter_payout_approved' : 'promoter_payout_declined', 'payout', payout.id, {});
  return { id: payout.id, status: approve ? 'approved' : 'declined' };
}

export async function markCommissionPaid(req, conversionId) {
  if (!isSuper(req)) throw httpError(403, 'Payout approval is limited to admin review');
  const updated = await query(
    `UPDATE "PromoterConversion" SET status = 'paid', "updatedAt" = NOW()
     WHERE id = $1 AND status = 'pending' RETURNING id`,
    [conversionId],
  );
  if (!updated.rows?.length) throw httpError(404, 'No pending commission to approve');
  await audit(userIdOf(req), 'commission_marked_paid', 'conversion', conversionId, {});
  return { id: conversionId, status: 'paid', note: 'Status only. This does not send money.' };
}

export async function suspiciousPromoters() {
  const result = await query(
    `SELECT "shareCode", COUNT(*)::int AS conversions
     FROM "PromoterConversion"
     WHERE "createdAt" > NOW() - INTERVAL '1 day' AND status <> 'reversed'
     GROUP BY "shareCode"
     HAVING COUNT(*) >= 15
     ORDER BY conversions DESC
     LIMIT 50`,
  );
  return result.rows || [];
}

export async function submitVerification(req, body) {
  const userId = userIdOf(req);
  if (userId == null) throw httpError(401, 'Sign in to continue.');
  const evidence = String(body.evidence || '').trim();
  if (evidence.length < 4) throw httpError(400, 'Add a short note about who you are.');
  const id = createId();
  await q(
    `INSERT INTO "VerificationCase" (id, "userId", "organizerName", evidence, status)
     VALUES ($1, $2, $3, $4, 'submitted')`,
    [id, userId, body.organizerName ? String(body.organizerName).slice(0, 120) : null, evidence.slice(0, 2000)],
  );
  await audit(userId, 'verification_submitted', 'verification', id, {});
  return { id, status: 'submitted' };
}

export async function reviewVerification(req, caseId, body) {
  if (!isSuper(req)) throw httpError(403, 'Only admin can review verification');
  const status = ['approved', 'revoked', 'appealed'].includes(body.status) ? body.status : null;
  if (!status) throw httpError(400, 'Status must be approved, revoked, or appealed');
  const updated = await query(
    `UPDATE "VerificationCase"
     SET status = $2, "reviewNote" = $3, "updatedAt" = NOW()
     WHERE id = $1 RETURNING "userId"`,
    [caseId, status, body.reviewNote ? String(body.reviewNote).slice(0, 500) : null],
  );
  if (!updated.rows?.length) throw httpError(404, 'Case not found');
  await audit(userIdOf(req), 'verification_reviewed', 'verification', caseId, { status });
  return { id: caseId, status };
}

export function verificationPolicy() {
  return {
    label: 'Verified organizer',
    criteria: [
      'A real organizer identity with a working contact email',
      'At least one listing with a venue or online access note',
      'No open fraud or refund incident',
    ],
    review: 'Admin reviews evidence before the badge appears. It is not granted automatically.',
    revocation: 'The badge can be removed. Organizers can submit an appeal.',
    reporting: 'Attendees can report a listing. Reports enter the admin queue.',
  };
}

export async function addMedia(req, eventId, body) {
  await assertManager(req, eventId);
  const url = String(body.url || '').trim();
  if (!/^https:\/\//i.test(url) || url.length > 500) throw httpError(400, 'Use an https image link');
  const id = createId();
  await query(
    `INSERT INTO "MediaAsset" (id, "eventId", "organizerUserId", "contributorUserId", url, caption, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [
      id,
      String(eventId),
      userIdOf(req),
      body.contributorUserId != null ? Number(body.contributorUserId) : userIdOf(req),
      url,
      body.caption ? String(body.caption).slice(0, 160) : null,
    ],
  );
  return { id, status: 'pending' };
}

export async function moderateMedia(req, mediaId, status) {
  const media = await query(`SELECT * FROM "MediaAsset" WHERE id = $1`, [mediaId]);
  const row = media.rows?.[0];
  if (!row) throw httpError(404, 'Photo not found');
  if (!isSuper(req)) await assertManager(req, row.eventId);
  const next = status === 'approved' ? 'approved' : 'removed';
  await query(`UPDATE "MediaAsset" SET status = $2 WHERE id = $1`, [mediaId, next]);
  await audit(userIdOf(req), 'media_moderated', 'media', mediaId, { status: next });
  return { id: mediaId, status: next };
}

export async function listMedia(eventId) {
  const result = await query(
    `SELECT id, url, caption, "createdAt" FROM "MediaAsset"
     WHERE "eventId" = $1 AND status = 'approved' ORDER BY "createdAt" DESC LIMIT 24`,
    [String(eventId)],
  );
  return result.rows || [];
}

export async function createPerk(req, body) {
  const eventId = body.eventId ? String(body.eventId) : null;
  if (eventId) await assertManager(req, eventId);
  else if (!isSuper(req)) throw httpError(403, 'Organizer benefits must belong to an event you manage');
  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, 'Benefit title is required');
  const id = createId();
  await q(
    `INSERT INTO "Perk" (id, "eventId", "organizerUserId", title, description, quota, "validUntil", "costOwner", status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'organizer', 'pending')`,
    [
      id,
      eventId,
      userIdOf(req) || 0,
      title.slice(0, 80),
      body.description ? String(body.description).slice(0, 400) : null,
      Math.max(1, Number(body.quota) || 1),
      body.validUntil || null,
    ],
  );
  return { id, status: 'pending', note: 'Admin approves this before attendees see it.' };
}

export async function approvePerk(req, perkId, approved) {
  if (!isSuper(req)) throw httpError(403, 'Only admin can approve benefits');
  const status = approved ? 'approved' : 'rejected';
  await query(`UPDATE "Perk" SET status = $2 WHERE id = $1`, [perkId, status]);
  return { id: perkId, status };
}

export async function setListing(req, eventId, status) {
  await assertManager(req, eventId);
  const allowed = ['published', 'cancelled', 'draft'];
  if (!allowed.includes(status)) throw httpError(400, 'Status must be published, cancelled, or draft');
  const published = status === 'published';
  try {
    await q(
      `UPDATE "Event"
       SET "listingStatus" = $2,
           "isPublished" = $3,
           "updatedAt" = NOW()
       WHERE id::text = $1`,
      [String(eventId), status, published],
    );
  } catch (err) {
    if (err?.code !== '42703') throw err;
    await query(`UPDATE "Event" SET "isPublished" = $2 WHERE id::text = $1`, [String(eventId), published]);
  }
  await audit(userIdOf(req), 'listing_status', 'event', eventId, { status });
  return { status, purchasable: status === 'published' };
}

export async function moderationQueue() {
  const [reports, verification, perks, media] = await Promise.all([
    query(`SELECT * FROM "ModerationRecord" WHERE status = 'open' ORDER BY "createdAt" DESC LIMIT 50`),
    query(`SELECT * FROM "VerificationCase" WHERE status IN ('submitted', 'appealed') ORDER BY "createdAt" DESC LIMIT 50`),
    query(`SELECT * FROM "Perk" WHERE status = 'pending' ORDER BY "createdAt" DESC LIMIT 50`),
    query(`SELECT * FROM "MediaAsset" WHERE status = 'pending' ORDER BY "createdAt" DESC LIMIT 50`),
  ]);
  return {
    reports: reports.rows || [],
    verification: verification.rows || [],
    perks: perks.rows || [],
    media: media.rows || [],
  };
}

export async function resolveReport(req, reportId, status) {
  if (!isSuper(req)) throw httpError(403, 'Only admin can resolve reports');
  const next = ['reviewed', 'actioned', 'dismissed'].includes(status) ? status : 'reviewed';
  await query(`UPDATE "ModerationRecord" SET status = $2 WHERE id = $1`, [reportId, next]);
  await audit(userIdOf(req), 'report_resolved', 'moderation', reportId, { status: next });
  return { id: reportId, status: next };
}

export async function metrics() {
  const result = await query(
    `SELECT name, COUNT(*)::int AS count
     FROM "AnalyticsEvent"
     WHERE "createdAt" > NOW() - INTERVAL '30 days'
     GROUP BY name
     ORDER BY count DESC`,
  );
  const organizers = await query(
    `SELECT COUNT(DISTINCT "createdBy")::int AS active
     FROM "Event"
     WHERE "createdAt" > NOW() - INTERVAL '30 days' AND "isPublished" = TRUE`,
  ).catch(() => ({ rows: [{ active: 0 }] }));
  return {
    windowDays: 30,
    events: result.rows || [],
    activeOrganizers: organizers.rows?.[0]?.active || 0,
  };
}

export async function announceFollowers(req, eventId, body) {
  const { event } = await assertManager(req, eventId);
  const message = String(body.message || '').trim();
  if (message.length < 4) throw httpError(400, 'Write a short announcement');
  const followers = await query(
    `SELECT f."userId", u.email
     FROM "OrganizerFollow" f
     JOIN "User" u ON u.id = f."userId"
     LEFT JOIN "NotificationPreference" p ON p."userId" = f."userId"
     WHERE f."notifyNextEvent" = TRUE
       AND COALESCE(p."organizerAnnouncements", TRUE) = TRUE
       AND (
         ($2::int IS NOT NULL AND f."organizerUserId" = $2)
         OR ($1 <> '' AND lower(f."organizerName") = lower($1))
       )`,
    [String(event.organizer || '').trim(), event.createdBy != null ? Number(event.createdBy) : null],
  ).catch(() => ({ rows: [] }));
  let sent = 0;
  for (const follower of followers.rows || []) {
    const recent = await query(
      `SELECT COUNT(*)::int AS count FROM "AnnouncementLog"
       WHERE "userId" = $1 AND "organizerUserId" = $2 AND "createdAt" > NOW() - INTERVAL '7 days'`,
      [follower.userId, event.createdBy],
    );
    if ((recent.rows?.[0]?.count || 0) >= 2) continue;
    await sendPushToEmail(follower.email, {
      title: event.title || 'New from an organizer you follow',
      body: message.slice(0, 140),
      data: { eventId: String(event.id) },
    });
    await query(
      `INSERT INTO "AnnouncementLog" (id, "organizerUserId", "userId", "eventId") VALUES ($1, $2, $3, $4)`,
      [createId(), event.createdBy, follower.userId, String(event.id)],
    );
    sent += 1;
  }
  return { sent, capped: true };
}

export async function assertPurchasable(eventId, sessionId) {
  const event = await loadEvent(eventId);
  if (!event) throw httpError(404, 'Event not found');
  if (String(event.listingStatus || '') === 'cancelled') {
    throw httpError(400, 'This event is cancelled and cannot be purchased');
  }
  if (event.isPublished === false) throw httpError(400, 'This event is not on sale');
  const caps = await query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS capacity FROM "TicketType" WHERE "eventId"::text = $1`,
    [String(event.id)],
  );
  const sold = await query(
    `SELECT COALESCE(SUM(oi.quantity), 0)::int AS sold
     FROM "Order" o
     JOIN "OrderItem" oi ON oi."orderId"::text = o.id::text
     WHERE o."eventId"::text = $1
       AND LOWER(COALESCE(o.status, '')) IN ('paid', 'completed', 'success')`,
    [String(event.id)],
  );
  const capacity = Number(caps.rows?.[0]?.capacity) || 0;
  const used = Number(sold.rows?.[0]?.sold) || 0;
  if (capacity > 0 && used >= capacity) throw httpError(400, 'This event is sold out');
  if (sessionId) {
    const session = await query(`SELECT status, "eventId" FROM "EventSession" WHERE id = $1`, [String(sessionId)]);
    const row = session.rows?.[0];
    if (!row || String(row.eventId) !== String(event.id)) throw httpError(400, 'Choose a valid session');
    if (row.status === 'cancelled') throw httpError(400, 'That session is cancelled. Other dates may still be on sale.');
  }
}

export async function awardStampForOrder(orderId) {
  const order = await query(
    `SELECT id, "eventId", "userId", status FROM "Order" WHERE id::text = $1`,
    [String(orderId)],
  );
  const row = order.rows?.[0];
  if (!row?.userId) return null;
  if (!['paid', 'completed', 'success'].includes(String(row.status || '').toLowerCase())) return null;
  const inserted = await query(
    `INSERT INTO "AttendanceStamp" (id, "userId", "eventId", "orderId", source)
     VALUES ($1, $2, $3, $4, 'checkin')
     ON CONFLICT ("userId", "eventId", "orderId") DO NOTHING
     RETURNING id`,
    [createId(), row.userId, String(row.eventId), String(row.id)],
  );
  return inserted.rows?.[0]?.id || null;
}

export async function purgeUser(client, userIdText) {
  const statements = [
    `DELETE FROM "Favorite" WHERE "userId"::text = $1`,
    `DELETE FROM "OrganizerFollow" WHERE "userId"::text = $1`,
    `DELETE FROM "PlanMember" WHERE "userId"::text = $1`,
    `DELETE FROM "PlanVote" WHERE "userId"::text = $1`,
    `DELETE FROM "CircleMembership" WHERE "userId"::text = $1`,
    `DELETE FROM "AttendanceStamp" WHERE "userId"::text = $1`,
    `DELETE FROM "EventReview" WHERE "userId"::text = $1`,
    `DELETE FROM "NotificationPreference" WHERE "userId"::text = $1`,
    `DELETE FROM "PassportPrivacy" WHERE "userId"::text = $1`,
    `DELETE FROM "UserBlock" WHERE "blockerUserId"::text = $1 OR "blockedUserId"::text = $1`,
    `DELETE FROM "PromoterMember" WHERE "userId"::text = $1`,
    `UPDATE "AnalyticsEvent" SET "userId" = NULL WHERE "userId"::text = $1`,
  ];
  for (const sql of statements) {
    try {
      await client.query(sql, [userIdText]);
    } catch (err) {
      if (err?.code !== '42P01' && err?.code !== '42703') throw err;
    }
  }
}
