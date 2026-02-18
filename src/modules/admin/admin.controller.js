import { query, createId } from '../../shared/config/db.js';
import { config } from '../../shared/config/env.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const PLATFORM_FEE_PCT = 0.15;

async function paystackRequest(method, path, body) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/dashboard
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'superadmin' || req.user.id === 0;
    const adminId = req.user.id;
    const eventScopeClause = isSuperAdmin ? '' : `WHERE e."createdBy" = $1`;
    const eventScopeParam = isSuperAdmin ? [] : [adminId];

    const totalEventsResult = await query(
      `SELECT COUNT(*) AS count FROM "Event" e ${eventScopeClause}`,
      eventScopeParam
    );
    const totalEvents = parseInt(totalEventsResult.rows[0].count, 10);

    const activeEventsResult = await query(
      `SELECT COUNT(*) AS count FROM "Event" e
       ${isSuperAdmin ? 'WHERE' : 'WHERE e."createdBy" = $1 AND'} e.date >= NOW()`,
      eventScopeParam
    );
    const activeEvents = parseInt(activeEventsResult.rows[0].count, 10);

    const ticketStatsResult = await query(
      `SELECT
         COALESCE(SUM(o."totalAmount"), 0) AS revenue,
         COALESCE(SUM(oi.quantity), 0)     AS tickets_sold
       FROM "Order" o
       JOIN "Event" e ON o."eventId" = e.id
       LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
       WHERE o.status = 'paid'
       ${isSuperAdmin ? '' : 'AND e."createdBy" = $1'}`,
      eventScopeParam
    );
    const ticketRevenue = parseFloat(ticketStatsResult.rows[0].revenue);
    const ticketsSold = parseInt(ticketStatsResult.rows[0].tickets_sold, 10);

    let membershipRevenue = 0;
    if (isSuperAdmin) {
      const membershipResult = await query(
        `SELECT COALESCE(SUM(mp.price), 0) AS revenue
         FROM "Membership" m
         JOIN "MembershipPlan" mp ON m."planId" = mp.id
         WHERE m.status = 'active'`
      );
      membershipRevenue = parseFloat(membershipResult.rows[0].revenue);
    }

    const totalRevenue = ticketRevenue + membershipRevenue;

    const recentSalesResult = await query(
      `SELECT
         o.id,
         o."fullName"    AS buyer_name,
         o.email         AS buyer_email,
         o."totalAmount" AS amount,
         o.status,
         o."createdAt"   AS created_at,
         e.title         AS event_title
       FROM "Order" o
       JOIN "Event" e ON o."eventId" = e.id
       ${isSuperAdmin ? '' : 'WHERE e."createdBy" = $1'}
       ORDER BY o."createdAt" DESC
       LIMIT 10`,
      eventScopeParam
    );

    res.json({
      stats: { totalRevenue, ticketRevenue, membershipRevenue, ticketsSold, totalEvents, activeEvents },
      recentSales: recentSalesResult.rows,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Withdraw Page Data ───────────────────────────────────────────────────────

/**
 * GET /api/admin/withdraw
 * Returns events with revenue, withdrawal history, and bank account status.
 */
export const getWithdrawPage = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'superadmin' || req.user.id === 0;
    const adminId = req.user.id;
    const scopeParam = isSuperAdmin ? [] : [adminId];

    // Events with their ticket revenue and withdrawal status
    const eventsResult = await query(
      `SELECT
         e.id,
         e.title,
         e.date,
         e."imageUrl",
         e."createdBy",
         COALESCE(SUM(o."totalAmount") FILTER (WHERE o.status = 'paid'), 0) AS gross_revenue,
         MAX(w.status)      AS withdrawal_status,
         MAX(w."netAmount") AS withdrawn_net,
         MAX(w."createdAt") AS withdrawn_at
       FROM "Event" e
       LEFT JOIN "Order" o ON o."eventId" = e.id
       LEFT JOIN "Withdrawal" w ON w."eventId" = e.id
       ${isSuperAdmin ? '' : 'WHERE e."createdBy" = $1'}
       GROUP BY e.id
       ORDER BY e.date DESC`,
      scopeParam
    );

    // Withdrawal history
    const withdrawalsResult = await query(
      `SELECT
         w.*,
         e.title AS event_title,
         u.name  AS admin_name,
         u.email AS admin_email
       FROM "Withdrawal" w
       JOIN "Event" e ON w."eventId" = e.id
       LEFT JOIN "User" u ON w."adminId" = u.id
       ${isSuperAdmin ? '' : 'WHERE w."adminId" = $1'}
       ORDER BY w."createdAt" DESC`,
      scopeParam
    );

    // KPI totals
    const kpiResult = await query(
      `SELECT
         COALESCE(SUM(o."totalAmount") FILTER (WHERE o.status = 'paid'), 0) AS total_gross,
         COALESCE(SUM(w."netAmount")   FILTER (WHERE w.status = 'completed'), 0) AS total_withdrawn,
         COALESCE(SUM(w."platformFee") FILTER (WHERE w.status = 'completed'), 0) AS total_fees
       FROM "Event" e
       LEFT JOIN "Order" o ON o."eventId" = e.id
       LEFT JOIN "Withdrawal" w ON w."eventId" = e.id
       ${isSuperAdmin ? '' : 'WHERE e."createdBy" = $1'}`,
      scopeParam
    );

    let membershipRevenue = 0;
    if (isSuperAdmin) {
      const mr = await query(
        `SELECT COALESCE(SUM(mp.price), 0) AS revenue
         FROM "Membership" m
         JOIN "MembershipPlan" mp ON m."planId" = mp.id
         WHERE m.status = 'active'`
      );
      membershipRevenue = parseFloat(mr.rows[0].revenue);
    }

    const kpi = kpiResult.rows[0];
    const totalGross = parseFloat(kpi.total_gross);
    const totalWithdrawn = parseFloat(kpi.total_withdrawn);
    const totalFees = parseFloat(kpi.total_fees);
    const availableToWithdraw = (totalGross - totalWithdrawn / (1 - PLATFORM_FEE_PCT)) * (1 - PLATFORM_FEE_PCT);

    // Bank account for this admin (not applicable for superadmin)
    let bankAccount = null;
    if (!isSuperAdmin) {
      const baResult = await query(
        `SELECT id, "accountName", "accountNumber", "bankCode", "bankName", "recipientCode"
         FROM "BankAccount" WHERE "userId" = $1`,
        [adminId]
      );
      bankAccount = baResult.rows[0] || null;
    }

    res.json({
      kpi: {
        totalGross,
        availableToWithdraw: Math.max(0, availableToWithdraw),
        totalFees,
        membershipRevenue,
      },
      events: eventsResult.rows,
      withdrawals: withdrawalsResult.rows,
      bankAccount,
      isSuperAdmin,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Withdraw an Event ────────────────────────────────────────────────────────

/**
 * POST /api/admin/withdraw/:eventId
 */
export const withdrawEvent = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'superadmin' || req.user.id === 0;
    const adminId = req.user.id;
    const { eventId } = req.params;

    // 1. Fetch event
    const eventResult = await query(`SELECT * FROM "Event" WHERE id = $1`, [eventId]);
    if (eventResult.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    const event = eventResult.rows[0];

    // 2. Ownership check
    if (!isSuperAdmin && event.createdBy !== String(adminId)) {
      return res.status(403).json({ error: 'You do not own this event' });
    }

    // 3. Timing check — event must have started (date <= now)
    const eventDate = new Date(event.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (eventDate > today) {
      return res.status(400).json({ error: 'Withdrawals are only available on or after the event date' });
    }

    // 4. One withdrawal per event
    const existingResult = await query(
      `SELECT id FROM "Withdrawal" WHERE "eventId" = $1 AND status = 'completed'`,
      [eventId]
    );
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ error: 'This event has already been withdrawn' });
    }

    // 5. Calculate revenue
    const revenueResult = await query(
      `SELECT COALESCE(SUM("totalAmount"), 0) AS gross FROM "Order"
       WHERE "eventId" = $1 AND status = 'paid'`,
      [eventId]
    );
    const gross = parseFloat(revenueResult.rows[0].gross);
    if (gross <= 0) return res.status(400).json({ error: 'No paid revenue to withdraw for this event' });

    const platformFee = parseFloat((gross * PLATFORM_FEE_PCT).toFixed(2));
    const net = parseFloat((gross - platformFee).toFixed(2));

    // 6. Get bank account / recipient code (not needed for superadmin)
    let recipientCode = null;
    if (!isSuperAdmin) {
      const baResult = await query(
        `SELECT "recipientCode" FROM "BankAccount" WHERE "userId" = $1`,
        [adminId]
      );
      if (baResult.rows.length === 0 || !baResult.rows[0].recipientCode) {
        return res.status(400).json({ error: 'Please set up your bank account before withdrawing' });
      }
      recipientCode = baResult.rows[0].recipientCode;
    }

    // 7. Create pending withdrawal record
    const withdrawalId = createId();
    await query(
      `INSERT INTO "Withdrawal" (id, "eventId", "adminId", "grossAmount", "platformFee", "netAmount", status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [withdrawalId, eventId, String(adminId), gross, platformFee, net]
    );

    // 8. Initiate Paystack transfer (skip for superadmin — platform retains the fee)
    let paystackRef = null;
    if (!isSuperAdmin && config.paystackSecretKey) {
      const transferRes = await paystackRequest('POST', '/transfer', {
        source: 'balance',
        amount: Math.round(net * 100), // kobo
        recipient: recipientCode,
        reason: `Withdrawal for event: ${event.title}`,
      });

      if (transferRes.status) {
        paystackRef = transferRes.data?.transfer_code || transferRes.data?.reference || null;
        await query(
          `UPDATE "Withdrawal" SET status = 'completed', "paystackReference" = $1, "updatedAt" = now()
           WHERE id = $2`,
          [paystackRef, withdrawalId]
        );
      } else {
        await query(
          `UPDATE "Withdrawal" SET status = 'failed', "updatedAt" = now() WHERE id = $1`,
          [withdrawalId]
        );
        return res.status(502).json({ error: transferRes.message || 'Paystack transfer failed' });
      }
    } else {
      // No Paystack key configured or superadmin — mark completed immediately
      await query(
        `UPDATE "Withdrawal" SET status = 'completed', "updatedAt" = now() WHERE id = $1`,
        [withdrawalId]
      );
    }

    res.json({
      message: 'Withdrawal successful',
      withdrawal: { id: withdrawalId, gross, platformFee, net, paystackRef },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Bank Account ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/bank-account
 */
export const getBankAccount = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, "accountName", "accountNumber", "bankCode", "bankName"
       FROM "BankAccount" WHERE "userId" = $1`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/bank-account
 * Body: { accountNumber, bankCode, accountName, bankName }
 */
export const saveBankAccount = async (req, res, next) => {
  try {
    const { accountNumber, bankCode, accountName, bankName } = req.body;
    if (!accountNumber || !bankCode || !accountName || !bankName) {
      return res.status(400).json({ error: 'accountNumber, bankCode, accountName, and bankName are required' });
    }

    // Create Paystack transfer recipient
    let recipientCode = null;
    if (config.paystackSecretKey) {
      const recipientRes = await paystackRequest('POST', '/transferrecipient', {
        type: 'nuban',
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      });
      if (recipientRes.status) {
        recipientCode = recipientRes.data?.recipient_code || null;
      }
    }

    // Upsert BankAccount
    const existing = await query(`SELECT id FROM "BankAccount" WHERE "userId" = $1`, [req.user.id]);
    if (existing.rows.length > 0) {
      await query(
        `UPDATE "BankAccount"
         SET "accountName" = $1, "accountNumber" = $2, "bankCode" = $3, "bankName" = $4, "recipientCode" = $5, "updatedAt" = now()
         WHERE "userId" = $6`,
        [accountName, accountNumber, bankCode, bankName, recipientCode, req.user.id]
      );
    } else {
      const id = createId();
      await query(
        `INSERT INTO "BankAccount" (id, "userId", "accountName", "accountNumber", "bankCode", "bankName", "recipientCode")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, req.user.id, accountName, accountNumber, bankCode, bankName, recipientCode]
      );
    }

    const result = await query(
      `SELECT id, "accountName", "accountNumber", "bankCode", "bankName"
       FROM "BankAccount" WHERE "userId" = $1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/banks
 * Proxies Paystack bank list
 */
export const getPaystackBanks = async (req, res, next) => {
  try {
    if (!config.paystackSecretKey) {
      // Return a small hardcoded list as fallback
      return res.json([
        { name: 'Access Bank', code: '044' },
        { name: 'First Bank of Nigeria', code: '011' },
        { name: 'Guaranty Trust Bank', code: '058' },
        { name: 'United Bank for Africa', code: '033' },
        { name: 'Zenith Bank', code: '057' },
        { name: 'Opay', code: '999992' },
        { name: 'Kuda Bank', code: '090267' },
        { name: 'Palmpay', code: '999991' },
        { name: 'Moniepoint', code: '50515' },
        { name: 'Wema Bank', code: '035' },
        { name: 'Fidelity Bank', code: '070' },
        { name: 'Sterling Bank', code: '232' },
        { name: 'Stanbic IBTC Bank', code: '221' },
        { name: 'Union Bank of Nigeria', code: '032' },
        { name: 'Ecobank Nigeria', code: '050' },
      ]);
    }
    const data = await paystackRequest('GET', '/bank?currency=NGN&perPage=100', null);
    res.json(data.data || []);
  } catch (err) {
    next(err);
  }
};
