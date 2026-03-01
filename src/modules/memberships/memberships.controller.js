const { query } = require('../../shared/db');
const config = require('../../shared/config/env');
const emailService = require('../../services/email');

// GET /api/memberships/plans (public; optional ?all=true for admin to see inactive)
async function getPlans(req, res) {
  try {
    const all = req.query.all === 'true';
    const sql = all
      ? 'SELECT "id", "name", "price", "currency", "duration", "description", "isActive" FROM "MembershipPlan" ORDER BY "createdAt"'
      : 'SELECT "id", "name", "price", "currency", "duration", "description", "isActive" FROM "MembershipPlan" WHERE "isActive" = TRUE ORDER BY "createdAt"';
    const result = await query(sql);
    const plans = result.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      price: row.price,
      currency: row.currency || 'NGN',
      duration: row.duration,
      description: row.description || '',
      isActive: row.isActive,
    }));
    return res.json(plans);
  } catch (err) {
    console.error('getPlans', err);
    return res.status(500).json({ error: 'Failed to fetch plans' });
  }
}

// POST /api/memberships/plans (superadmin only – handled by route)
async function createPlan(req, res) {
  try {
    const { name, price, currency, duration, description } = req.body || {};
    if (!name || price == null) {
      return res.status(400).json({ error: 'Name and price required' });
    }
    const priceInt = Math.round(Number(price));
    const dur = (duration || 'yearly').toLowerCase();
    const desc = description || '';
    const curr = currency || 'NGN';
    const result = await query(
      `INSERT INTO "MembershipPlan" ("name", "price", "currency", "duration", "description")
       VALUES ($1, $2, $3, $4, $5)
       RETURNING "id", "name", "price", "currency", "duration", "description", "isActive"`,
      [name, priceInt, curr, dur, desc]
    );
    const row = result.rows[0];
    return res.status(201).json({
      id: String(row.id),
      name: row.name,
      price: row.price,
      currency: row.currency,
      duration: row.duration,
      description: row.description,
      isActive: row.isActive,
    });
  } catch (err) {
    console.error('createPlan', err);
    return res.status(500).json({ error: 'Failed to create plan' });
  }
}

// PATCH /api/memberships/plans/:id (superadmin; body: isActive and/or name, price, currency, duration, description)
async function updatePlan(req, res) {
  try {
    const planId = req.params.id;
    const { isActive, name, price, currency, duration, description } = req.body || {};

    const updates = [];
    const values = [];
    let v = 1;
    if (typeof isActive === 'boolean') {
      updates.push(`"isActive" = $${v++}`);
      values.push(isActive);
    }
    if (name !== undefined) {
      updates.push(`"name" = $${v++}`);
      values.push(name);
    }
    if (price !== undefined) {
      updates.push(`"price" = $${v++}`);
      values.push(Math.round(Number(price)));
    }
    if (currency !== undefined) {
      updates.push(`"currency" = $${v++}`);
      values.push(currency);
    }
    if (duration !== undefined) {
      updates.push(`"duration" = $${v++}`);
      values.push(duration);
    }
    if (description !== undefined) {
      updates.push(`"description" = $${v++}`);
      values.push(description);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    updates.push(`"updatedAt" = NOW()`);
    values.push(planId);
    const sql = `UPDATE "MembershipPlan" SET ${updates.join(', ')} WHERE "id" = $${v} RETURNING "id", "name", "price", "currency", "duration", "description", "isActive"`;
    const result = await query(sql, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    const row = result.rows[0];
    return res.json({
      id: String(row.id),
      name: row.name,
      price: row.price,
      currency: row.currency,
      duration: row.duration,
      description: row.description,
      isActive: row.isActive,
    });
  } catch (err) {
    console.error('updatePlan', err);
    return res.status(500).json({ error: 'Failed to update plan' });
  }
}

async function verifyPaystackTransaction(reference) {
  if (!config.paystackSecretKey) return { ok: true, amount: null };
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${config.paystackSecretKey}` },
  });
  const data = await res.json();
  if (!data.status || !data.data || data.data.status !== 'success') {
    return { ok: false, amount: null };
  }
  return { ok: true, amount: data.data.amount };
}

// POST /api/memberships (authenticated user; body: planId, paystackReference)
async function createMembership(req, res) {
  try {
    const userId = req.userId;
    const { planId, paystackReference } = req.body || {};
    if (!planId || !paystackReference) {
      return res.status(400).json({ error: 'planId and paystackReference required' });
    }

    const planResult = await query(
      'SELECT "id", "name", "price", "currency", "duration" FROM "MembershipPlan" WHERE "id" = $1 AND "isActive" = TRUE',
      [planId]
    );
    if (planResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or inactive plan' });
    }
    const plan = planResult.rows[0];

    const verify = await verifyPaystackTransaction(paystackReference);
    if (!verify.ok) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }
    if (verify.amount != null && verify.amount !== plan.price) {
      return res.status(400).json({ error: 'Payment amount does not match plan' });
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    if (plan.duration === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    await query(
      `INSERT INTO "Membership" ("userId", "planId", "status", "startDate", "endDate", "paystackReference")
       VALUES ($1, $2, 'active', $3, $4, $5)`,
      [userId, plan.id, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10), paystackReference]
    );

    const userResult = await query('SELECT "email" FROM "User" WHERE "id" = $1', [userId]);
    const to = userResult.rows[0]?.email;
    if (to) {
      const amountNaira = (plan.price / 100).toFixed(2);
      await emailService.sendMembershipReceipt({
        to,
        planName: plan.name,
        amountNaira,
        currency: plan.currency || 'NGN',
      });
    }

    return res.status(201).json({ message: 'Membership activated' });
  } catch (err) {
    console.error('createMembership', err);
    return res.status(500).json({ error: err.message || 'Failed to process membership' });
  }
}

// GET /api/memberships/my (current user's active subscription)
async function getMyMembership(req, res) {
  try {
    const userId = req.userId;
    const result = await query(
      `SELECT m."id", m."planId", m."status", m."startDate", m."endDate", m."paystackReference",
              p."name" AS "planName", p."price" AS "planPrice"
       FROM "Membership" m
       JOIN "MembershipPlan" p ON p."id" = m."planId"
       WHERE m."userId" = $1 AND m."status" = 'active' AND m."endDate" >= CURRENT_DATE
       ORDER BY m."endDate" DESC LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.json(null);
    }
    const row = result.rows[0];
    return res.json({
      id: String(row.id),
      planId: String(row.planId),
      planName: row.planName,
      planPrice: row.planPrice,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
    });
  } catch (err) {
    console.error('getMyMembership', err);
    return res.status(500).json({ error: 'Failed to fetch membership' });
  }
}

// POST /api/memberships/cancel
async function cancelMembership(req, res) {
  try {
    const userId = req.userId;
    await query(
      'UPDATE "Membership" SET "status" = \'cancelled\', "updatedAt" = NOW() WHERE "userId" = $1 AND "status" = \'active\'',
      [userId]
    );
    return res.json({ message: 'Subscription cancelled' });
  } catch (err) {
    console.error('cancelMembership', err);
    return res.status(500).json({ error: 'Failed to cancel' });
  }
}

// POST /api/memberships/resubscribe (reactivate or extend; simple: set status active and extend endDate)
async function resubscribeMembership(req, res) {
  try {
    const userId = req.userId;
    const result = await query(
      `SELECT m."id", m."planId", m."endDate", p."duration" FROM "Membership" m
       JOIN "MembershipPlan" p ON p."id" = m."planId"
       WHERE m."userId" = $1 ORDER BY m."createdAt" DESC LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No subscription found' });
    }
    const m = result.rows[0];
    let newEnd = new Date(m.endDate);
    if (m.duration === 'yearly') newEnd.setFullYear(newEnd.getFullYear() + 1);
    else newEnd.setMonth(newEnd.getMonth() + 1);
    await query(
      'UPDATE "Membership" SET "status" = \'active\', "endDate" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [newEnd.toISOString().slice(0, 10), m.id]
    );
    return res.json({ message: 'Resubscribed' });
  } catch (err) {
    console.error('resubscribeMembership', err);
    return res.status(500).json({ error: 'Failed to resubscribe' });
  }
}

module.exports = {
  getPlans,
  createPlan,
  updatePlan,
  createMembership,
  getMyMembership,
  cancelMembership,
  resubscribeMembership,
};
