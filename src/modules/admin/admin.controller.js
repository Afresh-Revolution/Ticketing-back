import bcrypt from 'bcryptjs';
import { query } from '../../shared/config/db.js';
import { config } from '../../shared/config/env.js';

/** GET /api/admin/dashboard */
export async function getDashboard(req, res) {
  try {
    const stats = {
      totalRevenue: 0,
      ticketRevenue: 0,
      ticketsSold: 0,
      totalEvents: 0,
      activeEvents: 0,
    };
    const recentSales = [];
    const r = await query(
      `SELECT COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN o."totalAmount" ELSE 0 END), 0) AS ticket_rev,
              COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN 1 ELSE 0 END), 0) AS tickets_sold
       FROM "Order" o`
    ).catch(() => ({ rows: [{ ticket_rev: 0, tickets_sold: 0 }] }));
    if (r.rows && r.rows[0]) {
      stats.ticketRevenue = Number(r.rows[0].ticket_rev) || 0;
      stats.totalRevenue = stats.ticketRevenue;
      stats.ticketsSold = Number(r.rows[0].tickets_sold) || 0;
    }
    const e = await query(
      'SELECT COUNT(*) AS c FROM "Event"'
    ).catch(() => ({ rows: [{ c: 0 }] }));
    stats.totalEvents = Number(e.rows?.[0]?.c) || 0;
    stats.activeEvents = stats.totalEvents;
    return res.json({ stats, recentSales });
  } catch (err) {
    console.error('getDashboard', err);
    return res.json({
      stats: {
        totalRevenue: 0,
        ticketRevenue: 0,
        ticketsSold: 0,
        totalEvents: 0,
        activeEvents: 0,
      },
      recentSales: [],
    });
  }
}

/** GET /api/admin/admins */
export async function listAdmins(req, res) {
  try {
    const result = await query(
      'SELECT "id", "email", "name", "role", "emailVerified", "createdAt", "updatedAt" FROM "User" WHERE "role" IN (\'admin\', \'superadmin\') ORDER BY "id"'
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      emailVerified: !!row.emailVerified,
      createdAt: row.createdAt != null ? row.createdAt : null,
      updatedAt: row.updatedAt != null ? row.updatedAt : null,
    }));
    return res.json(list);
  } catch {
    return res.json([]);
  }
}

/** DELETE /api/admin/admins/:id */
export async function deleteAdmin(req, res) {
  try {
    await query('DELETE FROM "User" WHERE "id" = $1 AND "role" = \'admin\'', [req.params.id]);
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}

/** GET /api/admin/sales */
export async function getSales(req, res) {
  try {
    const result = await query(
      `SELECT o."id", o."fullName", o."email", o."totalAmount", o."status", o."createdAt", e."title" AS "event_title"
       FROM "Order" o LEFT JOIN "Event" e ON e."id" = o."eventId"
       ORDER BY o."createdAt" DESC LIMIT 100`
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((r) => ({
      id: r.id,
      buyer_name: r.fullName,
      buyer_email: r.email,
      amount: r.totalAmount,
      ticket_count: 1,
      status: r.status,
      created_at: r.createdAt,
      event_title: r.event_title,
    }));
    return res.json(list);
  } catch {
    return res.json([]);
  }
}

/** GET /api/admin/events */
export async function listAdminEvents(req, res) {
  try {
    const result = await query(
      'SELECT "id", "title", "date", "location", "isPublished" FROM "Event" ORDER BY "date" DESC'
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch {
    return res.json([]);
  }
}

/** DELETE /api/events/:id (admin) - handled in events.routes with requireAuth */
/** GET /api/admin/events/:eventId/orders */
export async function getEventOrders(req, res) {
  try {
    const result = await query(
      'SELECT * FROM "Order" WHERE "eventId" = $1 ORDER BY "createdAt" DESC',
      [req.params.eventId]
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch {
    return res.json([]);
  }
}

/** POST /api/admin/verify-ticket */
export async function verifyTicket(req, res) {
  try {
    const { orderId, code } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId required' });
    const result = await query(
      'SELECT "id", "status" FROM "Order" WHERE "id" = $1',
      [orderId]
    ).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(404).json({ error: 'Ticket not found' });
    const order = result.rows[0];
    return res.json({ valid: order.status === 'paid', orderId: order.id });
  } catch {
    return res.status(400).json({ error: 'Invalid ticket' });
  }
}

/** GET /api/admin/banks */
export async function getBanks(req, res) {
  try {
    if (config.paystackSecretKey) {
      const r = await fetch('https://api.paystack.co/bank?currency=NGN&perPage=100', {
        headers: { Authorization: `Bearer ${config.paystackSecretKey}` },
      });
      const d = await r.json();
      if (d.data) return res.json(d.data);
    }
    return res.json([]);
  } catch {
    return res.json([]);
  }
}

/** GET/POST /api/admin/bank-account */
export async function getBankAccount(req, res) {
  try {
    const result = await query(
      'SELECT "accountNumber", "bankCode", "accountName", "bankName", "recipientCode" FROM "BankAccount" WHERE "userId" = $1',
      [req.userId]
    ).catch(() => ({ rows: [] }));
    if (result.rows?.[0]) return res.json(result.rows[0]);
    return res.json(null);
  } catch {
    return res.json(null);
  }
}

export async function saveBankAccount(req, res) {
  try {
    const { accountNumber, bankCode, accountName, bankName } = req.body || {};
    if (!accountNumber || !bankCode) return res.status(400).json({ error: 'accountNumber and bankCode required' });
    await query(
      `INSERT INTO "BankAccount" ("userId", "accountNumber", "bankCode", "accountName", "bankName", "recipientCode")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("userId") DO UPDATE SET "accountNumber" = $2, "bankCode" = $3, "accountName" = $4, "bankName" = $5, "recipientCode" = $6`,
      [req.userId, accountNumber, bankCode, accountName || '', bankName || '', req.body?.recipientCode || '']
    ).catch(() => ({}));
    return res.json({ message: 'Saved' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** GET /api/admin/withdraw – full withdraw page payload (kpi, events, withdrawals, bankAccount, isSuperAdmin) */
export async function getWithdrawPage(req, res) {
  try {
    const isSuperAdmin = req.userRole === 'superadmin';
    const userId = req.userId;

    const kpi = { totalGross: 0, availableToWithdraw: 0, totalFees: 0 };

    const revResult = await query(
      `SELECT COALESCE(SUM(o."totalAmount"), 0) AS total
       FROM "Order" o
       JOIN "Event" e ON e."id" = o."eventId"
       WHERE o."status" = 'paid' ${!isSuperAdmin ? 'AND e."createdBy" = $1' : ''}`,
      isSuperAdmin ? [] : [userId]
    ).catch(() => ({ rows: [{ total: 0 }] }));
    kpi.totalGross = Number(revResult.rows?.[0]?.total) || 0;
    kpi.totalFees = Math.round(kpi.totalGross * 0.15);
    kpi.availableToWithdraw = kpi.totalGross - kpi.totalFees;

    const eventsSql = isSuperAdmin
      ? `
      SELECT e."id", e."title", e."date", e."imageUrl", e."createdBy",
             COALESCE(rev.gross, 0) AS "gross_revenue",
             NULL::varchar AS "withdrawal_status", NULL::integer AS "withdrawn_net", NULL::timestamptz AS "withdrawn_at"
      FROM "Event" e
      LEFT JOIN (
        SELECT o."eventId", SUM(o."totalAmount") AS gross
        FROM "Order" o WHERE o."status" = 'paid'
        GROUP BY o."eventId"
      ) rev ON rev."eventId" = e."id"
      ORDER BY e."date" DESC
    `
      : `
      SELECT e."id", e."title", e."date", e."imageUrl", e."createdBy",
             COALESCE(rev.gross, 0) AS "gross_revenue",
             w."status" AS "withdrawal_status", w."amount" AS "withdrawn_net", w."createdAt" AS "withdrawn_at"
      FROM "Event" e
      LEFT JOIN (
        SELECT o."eventId", SUM(o."totalAmount") AS gross
        FROM "Order" o WHERE o."status" = 'paid'
        GROUP BY o."eventId"
      ) rev ON rev."eventId" = e."id"
      LEFT JOIN LATERAL (
        SELECT "status", "amount", "createdAt"
        FROM "Withdrawal" WHERE "eventId" = e."id" AND "userId" = $1
        ORDER BY "createdAt" DESC LIMIT 1
      ) w ON true
      WHERE e."createdBy" = $2
      ORDER BY e."date" DESC
    `;
    const eventsResult = await query(
      eventsSql,
      isSuperAdmin ? [] : [userId, userId]
    ).catch(() => ({ rows: [] }));
    const events = (eventsResult.rows || []).map((r) => ({
      id: String(r.id),
      title: r.title || '',
      date: r.date || '',
      imageUrl: r.imageUrl || null,
      createdBy: r.createdBy != null ? String(r.createdBy) : null,
      gross_revenue: Number(r.gross_revenue) || 0,
      withdrawal_status: r.withdrawal_status || null,
      withdrawn_net: r.withdrawn_net != null ? Number(r.withdrawn_net) : null,
      withdrawn_at: r.withdrawn_at || null,
    }));

    const withResult = await query(
      'SELECT * FROM "Withdrawal" WHERE "userId" = $1 ORDER BY "createdAt" DESC',
      [userId]
    ).catch(() => ({ rows: [] }));
    const withdrawals = (withResult.rows || []).map((w) => ({
      id: String(w.id),
      eventId: String(w.eventId),
      adminId: String(w.userId),
      grossAmount: 0,
      platformFee: 0,
      netAmount: w.amount || 0,
      status: w.status || 'pending',
      paystackReference: null,
      createdAt: w.createdAt,
      event_title: '',
      admin_name: null,
      admin_email: null,
    }));

    let bankAccount = null;
    if (userId != null && userId !== 0) {
      const ba = await query(
        'SELECT "id", "accountNumber", "bankCode", "accountName", "bankName" FROM "BankAccount" WHERE "userId" = $1',
        [userId]
      ).catch(() => ({ rows: [] }));
      if (ba.rows?.[0]) {
        const row = ba.rows[0];
        bankAccount = {
          id: String(row.id),
          accountName: row.accountName || '',
          accountNumber: row.accountNumber || '',
          bankCode: row.bankCode || '',
          bankName: row.bankName || '',
        };
      }
    }

    return res.json({
      kpi,
      events,
      withdrawals,
      bankAccount,
      isSuperAdmin,
    });
  } catch (err) {
    console.error('getWithdrawPage', err);
    return res.status(500).json({
      kpi: { totalGross: 0, availableToWithdraw: 0, totalFees: 0 },
      events: [],
      withdrawals: [],
      bankAccount: null,
      isSuperAdmin: req.userRole === 'superadmin',
    });
  }
}

/** POST /api/admin/withdraw - body: eventId (optional) */
/** POST /api/admin/withdraw/:eventId */
export async function listWithdrawals(req, res) {
  try {
    const result = await query(
      'SELECT * FROM "Withdrawal" WHERE "userId" = $1 ORDER BY "createdAt" DESC',
      [req.userId]
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch {
    return res.json([]);
  }
}

export async function createWithdrawal(req, res) {
  try {
    const eventId = req.params.eventId;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });
    const result = await query(
      `INSERT INTO "Withdrawal" ("userId", "eventId", "amount", "status") VALUES ($1, $2, 0, 'pending') RETURNING "id"`,
      [req.userId, eventId]
    ).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(501).json({ error: 'Withdrawals not configured' });
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** GET /api/admin/top-users */
export async function listTopUsers(req, res) {
  try {
    const result = await query(
      'SELECT "id", "name", "title", "imageUrl", "sortOrder" FROM "TopUser" ORDER BY "sortOrder"'
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch {
    return res.json([]);
  }
}

/** POST /api/admin/top-users, PATCH/DELETE /api/admin/top-users/:id */
export async function createTopUser(req, res) {
  try {
    const { name, title, imageUrl, sortOrder } = req.body || {};
    const result = await query(
      'INSERT INTO "TopUser" ("name", "title", "imageUrl", "sortOrder") VALUES ($1, $2, $3, $4) RETURNING "id"',
      [name || '', title || '', imageUrl || null, sortOrder ?? 0]
    ).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(501).json({ error: 'TopUser table not configured' });
    return res.status(201).json(result.rows[0]);
  } catch {
    return res.status(500).json({ error: 'Failed' });
  }
}

export async function updateTopUser(req, res) {
  try {
    const { name, title, imageUrl, sortOrder } = req.body || {};
    await query(
      'UPDATE "TopUser" SET "name" = COALESCE($1, "name"), "title" = COALESCE($2, "title"), "imageUrl" = COALESCE($3, "imageUrl"), "sortOrder" = COALESCE($4, "sortOrder") WHERE "id" = $5',
      [name, title, imageUrl, sortOrder, req.params.id]
    ).catch(() => ({}));
    return res.json({ message: 'Updated' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}

export async function deleteTopUser(req, res) {
  try {
    await query('DELETE FROM "TopUser" WHERE "id" = $1', [req.params.id]);
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}

/** GET /api/admin/password-change-status */
export async function getPasswordChangeStatus(req, res) {
  try {
    const result = await query(
      'SELECT "lastPasswordChangeAt" FROM "User" WHERE "id" = $1',
      [req.userId]
    ).catch(() => ({ rows: [] }));
    const last = result.rows?.[0]?.lastPasswordChangeAt;
    const nextAllowed = last ? new Date(new Date(last).getTime() + 30 * 24 * 60 * 60 * 1000) : null;
    const canChange = !nextAllowed || new Date() >= nextAllowed;
    return res.json({
      canChange: !!canChange,
      nextChangeAllowedAt: nextAllowed ? nextAllowed.toISOString() : null,
    });
  } catch {
    return res.json({ canChange: true, nextChangeAllowedAt: null });
  }
}

/** POST /api/admin/verify-password */
export async function verifyPassword(req, res) {
  try {
    const { currentPassword } = req.body || {};
    const result = await query(
      'SELECT "passwordHash" FROM "User" WHERE "id" = $1',
      [req.userId]
    );
    if (!result.rows?.length) return res.status(401).json({ error: 'Invalid password' });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid current password' });
    return res.json({ verified: true });
  } catch {
    return res.status(401).json({ error: 'Invalid password' });
  }
}

/** POST /api/admin/change-password */
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    const result = await query(
      'SELECT "passwordHash" FROM "User" WHERE "id" = $1',
      [req.userId]
    );
    if (!result.rows?.length) return res.status(401).json({ error: 'Invalid password' });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid current password' });
    const hash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE "User" SET "passwordHash" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [hash, req.userId]
    );
    return res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}
