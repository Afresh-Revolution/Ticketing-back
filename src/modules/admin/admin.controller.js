import { query } from '../../shared/config/db.js';

/** True if current user is super admin (sees all events in Supabase). */
function isSuperAdmin(req) {
  if (!req.user) return false;
  const role = (req.user.role || '').toLowerCase();
  const id = req.user.id;
  return role === 'superadmin' || id === 0 || id === '0';
}

/** GET /api/admin/dashboard – stats and recent sales from Supabase; super admin sees all, others only their events. */
export async function getDashboard(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;

    const stats = {
      totalRevenue: 0,
      ticketRevenue: 0,
      ticketsSold: 0,
      totalEvents: 0,
      activeEvents: 0,
    };
    const recentSales = [];

    // Revenue/sales: join Order -> Event; super admin sees all, others only their events (createdBy = userId)
    const revSql = superAdmin
      ? `SELECT COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN o."totalAmount" ELSE 0 END), 0) AS ticket_rev,
                COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN 1 ELSE 0 END), 0) AS tickets_sold
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id = o."eventId"`
      : `SELECT COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN o."totalAmount" ELSE 0 END), 0) AS ticket_rev,
                COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN 1 ELSE 0 END), 0) AS tickets_sold
         FROM "Order" o
         INNER JOIN "Event" e ON e.id = o."eventId" AND (e."createdBy" = $1 OR (e."createdBy" IS NULL AND ($1 = 0 OR $1 = '0')))`;
    const revParams = superAdmin ? [] : [userId];
    const r = await query(revSql, revParams).catch(() => ({ rows: [{ ticket_rev: 0, tickets_sold: 0 }] }));
    if (r.rows?.[0]) {
      stats.ticketRevenue = Number(r.rows[0].ticket_rev) || 0;
      stats.totalRevenue = stats.ticketRevenue;
      stats.ticketsSold = Number(r.rows[0].tickets_sold) || 0;
    }

    // Event counts: all for super admin, else only events created by this admin (or createdBy IS NULL = super admin’s)
    const countSql = superAdmin
      ? 'SELECT COUNT(*) AS c FROM "Event"'
      : 'SELECT COUNT(*) AS c FROM "Event" WHERE "createdBy" = $1 OR ("createdBy" IS NULL AND ($1 = 0 OR $1 = \'0\'))';
    const countParams = superAdmin ? [] : [userId];
    const e = await query(countSql, countParams).catch(() => ({ rows: [{ c: 0 }] }));
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

/** GET /api/admin/me – current admin from token (so frontend can use server identity for createdBy). */
export async function getMe(req, res) {
  try {
    const id = req.user?.id ?? req.userId;
    const role = (req.user?.role || req.userRole || 'admin').toLowerCase();
    return res.json({
      id: id === 0 || id === '0' ? 0 : Number(id) || null,
      role: role === 'superadmin' ? 'superadmin' : 'admin',
    });
  } catch (err) {
    console.error('getMe', err);
    return res.status(500).json({ error: 'Not found' });
  }
}

/** GET /api/admin/admins – list admin users (superadmin only). */
export async function listAdmins(req, res) {
  try {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await query(
      `SELECT id, email, name, role, "emailVerified", "createdAt"
       FROM "User"
       WHERE role IN ('admin', 'superadmin')
       ORDER BY "createdAt" DESC`
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role || 'admin',
      emailVerified: !!row.emailVerified,
      createdAt: row.createdAt,
    }));
    return res.json(list);
  } catch (err) {
    console.error('listAdmins', err);
    return res.status(500).json({ error: 'Failed to list admins' });
  }
}

/** DELETE /api/admin/admins/:id – remove an admin user (superadmin only). Cannot delete self or another superadmin. */
export async function deleteAdmin(req, res) {
  try {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid admin id' });
    }
    // Do not allow deleting yourself
    const currentId = Number(req.userId) || req.userId;
    if (id === currentId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    // Only delete users with role 'admin' (never superadmin)
    const result = await query(
      `DELETE FROM "User" WHERE id = $1 AND role = 'admin' RETURNING id`,
      [id]
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found or cannot be deleted' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('deleteAdmin', err);
    return res.status(500).json({ error: 'Failed to delete admin' });
  }
}

/** GET /api/admin/events – list events from Supabase; super admin sees all, others only their own. */
export async function listAdminEvents(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;

    // Event table columns (match event.model): include isPublished for visibility toggle
    const sql = superAdmin
      ? `SELECT id, title, date, location, venue, "imageUrl", "isTrending", price, "createdBy", category, "startTime", "isPublished"
         FROM "Event"
         ORDER BY date DESC NULLS LAST`
      : `SELECT id, title, date, location, venue, "imageUrl", "isTrending", price, "createdBy", category, "startTime", "isPublished"
         FROM "Event"
         WHERE "createdBy" = $1 OR ("createdBy" IS NULL AND ($1 = 0 OR $1 = '0'))
         ORDER BY date DESC NULLS LAST`;
    const params = superAdmin ? [] : [userId];
    const result = await query(sql, params).catch((err) => {
      console.error('listAdminEvents query', err?.message || err);
      return { rows: [] };
    });
    const rows = result.rows || [];
    const list = rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      date: row.date,
      location: row.location || row.venue,
      isPublished: row.isPublished !== false,
      isTrending: row.isTrending ?? false,
      price: row.price ?? 0,
      createdBy: row.createdBy,
    }));
    return res.json(list);
  } catch (err) {
    console.error('listAdminEvents', err);
    return res.json([]);
  }
}

/** GET /api/admin/events/:eventId – single event; 404 if not owner (unless super admin). */
export async function getAdminEvent(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;
    const eventId = req.params.eventId;

    const sql = superAdmin
      ? 'SELECT * FROM "Event" WHERE id = $1'
      : 'SELECT * FROM "Event" WHERE id = $1 AND ("createdBy" = $2 OR ("createdBy" IS NULL AND ($2 = 0 OR $2 = \'0\')))';
    const params = superAdmin ? [eventId] : [eventId, userId];
    const result = await query(sql, params).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(404).json({ error: 'Event not found' });
    const row = result.rows[0];
    return res.json({
      id: String(row.id),
      title: row.title,
      date: row.date,
      location: row.location || row.venue,
      venue: row.venue,
      price: row.price,
      imageUrl: row.imageUrl,
      startTime: row.startTime,
      description: row.description,
      organizer: row.organizer,
      isPublished: row.isPublished,
      isTrending: row.isTrending,
    });
  } catch (err) {
    console.error('getAdminEvent', err);
    return res.status(500).json({ error: 'Not found' });
  }
}

/** PATCH /api/admin/events/:eventId/visibility – toggle event visible on public side (isPublished). */
export async function patchEventVisibility(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;
    const eventId = req.params.eventId;
    const isPublished = req.body?.isPublished !== false;

    const checkSql = superAdmin
      ? 'SELECT id FROM "Event" WHERE id = $1'
      : 'SELECT id FROM "Event" WHERE id = $1 AND ("createdBy" = $2 OR ("createdBy" IS NULL AND ($2 = 0 OR $2 = \'0\')))';
    const checkParams = superAdmin ? [eventId] : [eventId, userId];
    const check = await query(checkSql, checkParams).catch(() => ({ rows: [] }));
    if (!check.rows?.length) return res.status(404).json({ error: 'Event not found' });

    await query(
      'UPDATE "Event" SET "isPublished" = $1, "updatedAt" = COALESCE("updatedAt", NOW()) WHERE id = $2',
      [isPublished, eventId]
    ).catch(() => ({}));
    return res.json({ isPublished });
  } catch (err) {
    console.error('patchEventVisibility', err);
    return res.status(500).json({ error: 'Failed to update visibility' });
  }
}

/** GET /api/admin/events/:eventId/orders – orders for an event; only if user owns event or is super admin. */
export async function getEventOrders(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;
    const eventId = req.params.eventId;

    const checkSql = superAdmin
      ? 'SELECT id FROM "Event" WHERE id = $1'
      : 'SELECT id FROM "Event" WHERE id = $1 AND ("createdBy" = $2 OR ("createdBy" IS NULL AND ($2 = 0 OR $2 = \'0\')))';
    const checkParams = superAdmin ? [eventId] : [eventId, userId];
    const check = await query(checkSql, checkParams).catch(() => ({ rows: [] }));
    if (!check.rows?.length) return res.status(404).json({ error: 'Event not found' });

    const result = await query(
      'SELECT * FROM "Order" WHERE "eventId" = $1 ORDER BY "createdAt" DESC',
      [eventId]
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch (err) {
    console.error('getEventOrders', err);
    return res.json([]);
  }
}

/** GET /api/admin/sales – sales from Supabase; super admin sees all, others only for their events. */
export async function getSales(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;

    const sql = superAdmin
      ? `SELECT o.id, o."fullName", o.email, o."totalAmount", o."status", o."createdAt", e.title AS event_title
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id = o."eventId"
         ORDER BY o."createdAt" DESC
         LIMIT 100`
      : `SELECT o.id, o."fullName", o.email, o."totalAmount", o."status", o."createdAt", e.title AS event_title
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id = o."eventId"
         WHERE e."createdBy" = $1 OR (e."createdBy" IS NULL AND ($1 = 0 OR $1 = '0'))
         ORDER BY o."createdAt" DESC
         LIMIT 100`;
    const params = superAdmin ? [] : [userId];
    const result = await query(sql, params).catch(() => ({ rows: [] }));
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
  } catch (err) {
    console.error('getSales', err);
    return res.json([]);
  }
}

/** Resolve current user id (requireAuth sets both req.user and req.userId). */
function getUserId(req) {
  return req.user?.id ?? req.userId;
}

/** GET /api/admin/withdraw – full withdraw page: kpi, events, withdrawals, bankAccount, isSuperAdmin. */
export async function getWithdrawPage(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    if (userId == null && userId !== 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const kpi = { totalGross: 0, availableToWithdraw: 0, totalFees: 0 };

    const revSql = superAdmin
      ? `SELECT COALESCE(SUM(o."totalAmount"), 0) AS total FROM "Order" o JOIN "Event" e ON e.id = o."eventId" WHERE o."status" = 'paid'`
      : `SELECT COALESCE(SUM(o."totalAmount"), 0) AS total FROM "Order" o JOIN "Event" e ON e.id = o."eventId" WHERE o."status" = 'paid' AND (e."createdBy" = $1 OR (e."createdBy" IS NULL AND ($1 = 0 OR $1 = '0')))`;
    const revParams = superAdmin ? [] : [userId];
    const revResult = await query(revSql, revParams).catch(() => ({ rows: [{ total: 0 }] }));
    kpi.totalGross = Number(revResult.rows?.[0]?.total) || 0;
    kpi.totalFees = Math.round(kpi.totalGross * 0.15);
    kpi.availableToWithdraw = kpi.totalGross - kpi.totalFees;

    const eventsSql = superAdmin
      ? `SELECT e.id, e.title, e.date, e."imageUrl", e."createdBy",
                COALESCE(rev.gross, 0) AS gross_revenue,
                NULL::varchar AS withdrawal_status, NULL::numeric AS withdrawn_net, NULL::timestamptz AS withdrawn_at
         FROM "Event" e
         LEFT JOIN (SELECT o."eventId", SUM(o."totalAmount") AS gross FROM "Order" o WHERE o."status" = 'paid' GROUP BY o."eventId") rev ON rev."eventId" = e.id
         ORDER BY e.date DESC NULLS LAST`
      : `SELECT e.id, e.title, e.date, e."imageUrl", e."createdBy",
                COALESCE(rev.gross, 0) AS gross_revenue,
                w.status AS withdrawal_status, w.amount AS withdrawn_net, w."createdAt" AS withdrawn_at
         FROM "Event" e
         LEFT JOIN (SELECT o."eventId", SUM(o."totalAmount") AS gross FROM "Order" o WHERE o."status" = 'paid' GROUP BY o."eventId") rev ON rev."eventId" = e.id
         LEFT JOIN LATERAL (SELECT status, amount, "createdAt" FROM "Withdrawal" WHERE "eventId" = e.id AND "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1) w ON true
         WHERE e."createdBy" = $2 OR (e."createdBy" IS NULL AND ($2 = 0 OR $2 = '0'))
         ORDER BY e.date DESC NULLS LAST`;
    const eventsParams = superAdmin ? [] : [userId, userId];
    const eventsResult = await query(eventsSql, eventsParams).catch(() => ({ rows: [] }));
    const events = (eventsResult.rows || []).map((r) => ({
      id: String(r.id),
      title: r.title || '',
      date: r.date || '',
      imageUrl: r.imageUrl ?? null,
      createdBy: r.createdBy != null ? String(r.createdBy) : null,
      gross_revenue: Number(r.gross_revenue) || 0,
      withdrawal_status: r.withdrawal_status ?? null,
      withdrawn_net: r.withdrawn_net != null ? Number(r.withdrawn_net) : null,
      withdrawn_at: r.withdrawn_at ?? null,
    }));

    const withResult = await query(
      'SELECT * FROM "Withdrawal" WHERE "userId" = $1 ORDER BY "createdAt" DESC',
      [userId]
    ).catch(() => ({ rows: [] }));
    const withdrawals = (withResult.rows || []).map((w) => ({
      id: String(w.id),
      eventId: String(w.eventId),
      adminId: String(w.userId ?? w.adminId ?? ''),
      grossAmount: 0,
      platformFee: 0,
      netAmount: Number(w.amount) || 0,
      status: w.status || 'pending',
      paystackReference: w.paystackReference ?? null,
      createdAt: w.createdAt ?? '',
      event_title: '',
      admin_name: null,
      admin_email: null,
    }));

    let bankAccount = null;
    const baResult = await query(
      'SELECT "id", "accountNumber", "bankCode", "accountName", "bankName" FROM "BankAccount" WHERE "userId" = $1',
      [userId]
    ).catch(() => ({ rows: [] }));
    if (baResult.rows?.[0]) {
      const row = baResult.rows[0];
      bankAccount = {
        id: String(row.id),
        accountName: row.accountName || '',
        accountNumber: row.accountNumber || '',
        bankCode: row.bankCode || '',
        bankName: row.bankName || '',
      };
    }

    return res.json({
      kpi,
      events,
      withdrawals,
      bankAccount,
      isSuperAdmin: !!superAdmin,
    });
  } catch (err) {
    console.error('getWithdrawPage', err);
    return res.status(500).json({
      kpi: { totalGross: 0, availableToWithdraw: 0, totalFees: 0 },
      events: [],
      withdrawals: [],
      bankAccount: null,
      isSuperAdmin: false,
    });
  }
}

/** GET /api/admin/withdraw (list) – kept for compatibility; prefer getWithdrawPage. */
export async function listWithdrawals(req, res) {
  try {
    const userId = getUserId(req);
    const result = await query(
      'SELECT * FROM "Withdrawal" WHERE "userId" = $1 ORDER BY "createdAt" DESC',
      [userId]
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch {
    return res.json([]);
  }
}

/** Withdrawals: admins can only withdraw from events they created; superadmin only from events with createdBy null. */
export async function createWithdrawal(req, res) {
  try {
    const eventId = req.params.eventId;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });
    const userId = getUserId(req);
    const superAdmin = isSuperAdmin(req);

    const eventRows = await query('SELECT "id", "createdBy" FROM "Event" WHERE "id" = $1', [eventId]).catch(() => ({ rows: [] }));
    if (!eventRows.rows?.length) return res.status(404).json({ error: 'Event not found' });
    const event = eventRows.rows[0];
    const createdBy = event.createdBy;

    if (superAdmin) {
      if (createdBy != null && Number(createdBy) !== 0) {
        return res.status(403).json({ error: 'Super admin can only withdraw from their own events, not another admin\'s' });
      }
    } else {
      if (String(createdBy) !== String(userId)) {
        return res.status(403).json({ error: 'You can only withdraw from events you created' });
      }
    }

    const result = await query(
      `INSERT INTO "Withdrawal" ("userId", "eventId", "amount", "status") VALUES ($1, $2, 0, 'pending') RETURNING "id", "amount"`,
      [userId, eventId]
    ).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(501).json({ error: 'Withdrawals not configured' });
    const row = result.rows[0];
    return res.status(201).json({
      withdrawal: { id: row.id, net: Number(row.amount) || 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** GET /api/admin/banks – list banks (e.g. Paystack). */
export async function getBanks(req, res) {
  try {
    const { config } = await import('../../shared/config/env.js');
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

/** GET /api/admin/bank-account – current user's bank account. */
export async function getBankAccount(req, res) {
  try {
    const userId = getUserId(req);
    const result = await query(
      'SELECT "id", "accountNumber", "bankCode", "accountName", "bankName" FROM "BankAccount" WHERE "userId" = $1',
      [userId]
    ).catch(() => ({ rows: [] }));
    if (result.rows?.[0]) return res.json(result.rows[0]);
    return res.json(null);
  } catch {
    return res.json(null);
  }
}

/** POST /api/admin/bank-account – save bank account. */
export async function saveBankAccount(req, res) {
  try {
    const userId = getUserId(req);
    const { accountNumber, bankCode, accountName, bankName } = req.body || {};
    if (!accountNumber || !bankCode) return res.status(400).json({ error: 'accountNumber and bankCode required' });
    const existing = await query(
      'SELECT "id" FROM "BankAccount" WHERE "userId" = $1',
      [userId]
    ).catch(() => ({ rows: [] }));
    if (existing.rows?.length > 0) {
      await query(
        `UPDATE "BankAccount" SET "accountNumber" = $1, "bankCode" = $2, "accountName" = $3, "bankName" = $4 WHERE "userId" = $5`,
        [accountNumber, bankCode, accountName || '', bankName || '', userId]
      ).catch(() => ({}));
    } else {
      await query(
        `INSERT INTO "BankAccount" ("userId", "accountNumber", "bankCode", "accountName", "bankName") VALUES ($1, $2, $3, $4, $5)`,
        [userId, accountNumber, bankCode, accountName || '', bankName || '']
      ).catch(() => ({}));
    }
    const row = await query(
      'SELECT "id", "accountNumber", "bankCode", "accountName", "bankName" FROM "BankAccount" WHERE "userId" = $1',
      [userId]
    ).then((r) => r.rows?.[0]).catch(() => null);
    return res.json(row || { id: null, accountNumber, bankCode, accountName: accountName || '', bankName: bankName || '' });
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
