import { query, createId } from '../../shared/config/db.js';

// --- Membership Plans ---

export const createPlan = async (req, res, next) => {
  try {
    const { name, price, currency, duration, description } = req.body;
    const id = createId();
    const result = await query(
      `INSERT INTO "MembershipPlan" (id, name, price, currency, duration, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, name, price, currency || 'NGN', duration, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

export const getPlans = async (req, res, next) => {
  try {
    // Public endpoint: only active plans
    // Admin execution logic could start with ?all=true check if needed, but keeping simple for now
    const result = await query(
      `SELECT * FROM "MembershipPlan" WHERE "isActive" = TRUE ORDER BY price ASC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive, name, price, description } = req.body;
    
    // Build dynamic query
    let fields = [];
    let values = [];
    let idx = 1;

    if (isActive !== undefined) { fields.push(`"isActive"=$${idx++}`); values.push(isActive); }
    if (name) { fields.push(`name=$${idx++}`); values.push(name); }
    if (price) { fields.push(`price=$${idx++}`); values.push(price); }
    if (description) { fields.push(`description=$${idx++}`); values.push(description); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const text = `UPDATE "MembershipPlan" SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`;
    
    const result = await query(text, values);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// --- User Memberships ---

export const createMembership = async (req, res, next) => {
  try {
    const userId = req.user.id; // From authMiddleware
    const { planId, paystackReference } = req.body;

    // 1. Get Plan details to calculate duration
    const planResult = await query(`SELECT * FROM "MembershipPlan" WHERE id = $1`, [planId]);
    if (planResult.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    const plan = planResult.rows[0];

    // 2. Calculate dates
    const startDate = new Date();
    const endDate = new Date(startDate);
    if (plan.duration === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (plan.duration === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // 3. Create Membership
    const id = createId();
    const result = await query(
      `INSERT INTO "Membership" (id, "userId", "planId", "startDate", "endDate", "paystackReference")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, userId, planId, startDate, endDate, paystackReference]
    );

    // 4. Update User Role to 'organizer' if not already (Optional business logic)
    // await query(`UPDATE "User" SET role = 'organizer' WHERE id = $1 AND role = 'user'`, [userId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

export const getMyMembership = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `SELECT m.*, p.name as "planName", p.price as "planPrice"
       FROM "Membership" m
       LEFT JOIN "MembershipPlan" p ON m."planId" = p.id
       WHERE m."userId" = $1 AND m.status = 'active'
       ORDER BY m."endDate" DESC
       LIMIT 1`,
      [userId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    next(err);
  }
};

export const getAllMemberships = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.*, u.name as "userName", u.email as "userEmail", p.name as "planName"
       FROM "Membership" m
       JOIN "User" u ON m."userId" = u.id
       LEFT JOIN "MembershipPlan" p ON m."planId" = p.id
       ORDER BY m."createdAt" DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

export const updateMembershipStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, extendDays } = req.body; // 'active', 'suspended', 'cancelled'

    let result;
    if (extendDays) {
      const days = Math.max(0, parseInt(extendDays, 10));
      if (Number.isNaN(days)) return res.status(400).json({ error: 'Invalid extendDays' });
      result = await query(
        `UPDATE "Membership" 
         SET "endDate" = "endDate" + ($1 || ' days')::interval, status = 'active'
         WHERE id = $2 RETURNING *`,
        [String(days), id]
      );
    } else {
      result = await query(
        `UPDATE "Membership" SET status = $1 WHERE id = $2 RETURNING *`,
        [status, id]
      );
    }

    if (result.rows.length === 0) return res.status(404).json({ error: 'Membership not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// --- Admin self-service subscription actions ---

/**
 * POST /api/memberships/cancel
 * Cancels the calling admin's active membership.
 */
export const cancelMyMembership = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await query(
      `UPDATE "Membership" SET status = 'cancelled', "updatedAt" = now()
       WHERE "userId" = $1 AND status = 'active'
       RETURNING *`,
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No active membership found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/memberships/resubscribe
 * Creates a new membership from the same plan as the last one.
 * Only allowed if the current membership expires within 5 days OR is already cancelled/expired.
 */
export const resubscribeMyMembership = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Find the most recent membership (any status)
    const lastResult = await query(
      `SELECT m.*, p.duration FROM "Membership" m
       JOIN "MembershipPlan" p ON m."planId" = p.id
       WHERE m."userId" = $1
       ORDER BY m."createdAt" DESC LIMIT 1`,
      [userId]
    );
    if (lastResult.rows.length === 0) return res.status(404).json({ error: 'No previous membership found' });
    const last = lastResult.rows[0];

    // Check eligibility: must be within 5 days of expiry OR already cancelled/expired
    const now = new Date();
    const endDate = new Date(last.endDate);
    const daysUntilExpiry = (endDate - now) / (1000 * 60 * 60 * 24);
    const isExpiredOrCancelled = last.status === 'cancelled' || last.status === 'expired' || endDate < now;

    if (!isExpiredOrCancelled && daysUntilExpiry > 5) {
      return res.status(400).json({
        error: 'Resubscription is only available within 5 days of expiry',
        daysUntilEligible: Math.ceil(daysUntilExpiry - 5),
      });
    }

    // Create new membership
    const startDate = new Date();
    const newEndDate = new Date(startDate);
    if (last.duration === 'monthly') newEndDate.setMonth(newEndDate.getMonth() + 1);
    else if (last.duration === 'yearly') newEndDate.setFullYear(newEndDate.getFullYear() + 1);

    const id = createId();
    const result = await query(
      `INSERT INTO "Membership" (id, "userId", "planId", "startDate", "endDate", status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING *`,
      [id, userId, last.planId, startDate, newEndDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

