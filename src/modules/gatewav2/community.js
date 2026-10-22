import crypto from 'node:crypto';
import { query, createId, getPool } from '../../shared/config/db.js';
import { sendPushToEmail } from '../../shared/services/push.service.js';
import { httpError, userIdOf, isSuper, audit, loadEvent, requireFlag } from './access.js';
import { eventsByIds, searchEvents } from './discover.js';

function token() {
  return crypto.randomBytes(18).toString('hex');
}

function requireUser(req) {
  const id = userIdOf(req);
  if (id == null) throw httpError(401, 'Sign in to continue.');
  return id;
}

async function blockedEither(a, b) {
  if (a == null || b == null) return false;
  const result = await query(
    `SELECT 1 FROM "UserBlock"
     WHERE ("blockerUserId" = $1 AND "blockedUserId" = $2)
        OR ("blockerUserId" = $2 AND "blockedUserId" = $1)
     LIMIT 1`,
    [a, b],
  );
  return Boolean(result.rows?.length);
}

export async function toggleFavorite(req, eventId, on) {
  const userId = requireUser(req);
  const found = await query(`SELECT id FROM "Event" WHERE id::text = $1 LIMIT 1`, [String(eventId)]);
  const event = found.rows?.[0];
  if (!event) throw httpError(404, 'Event not found');
  const savedId = String(event.id);
  if (!on) {
    await query(`DELETE FROM "Favorite" WHERE "userId" = $1 AND "eventId" = $2`, [userId, savedId]);
    return { saved: false };
  }
  try {
    await query(
      `INSERT INTO "Favorite" (id, "userId", "eventId") VALUES ($1, $2, $3)
       ON CONFLICT ("userId", "eventId") DO NOTHING`,
      [createId(), userId, savedId],
    );
  } catch (err) {
    if (err?.code !== '42P10') throw err;
    await query(
      `INSERT INTO "Favorite" (id, "userId", "eventId")
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM "Favorite" WHERE "userId" = $2 AND "eventId" = $3
       )`,
      [createId(), userId, savedId],
    );
  }
  return { saved: true, eventId: savedId };
}

export async function listFavorites(req) {
  const userId = requireUser(req);
  const result = await query(
    `SELECT "eventId" FROM "Favorite" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 100`,
    [userId],
  );
  const ids = (result.rows || []).map((row) => String(row.eventId)).filter(Boolean);
  if (!ids.length) return [];
  return eventsByIds(ids);
}

export async function followOrganizer(req, body, on) {
  const userId = requireUser(req);
  const name = String(body.organizerName || '').trim();
  if (!name) throw httpError(400, 'Organizer name is required');
  if (!on) {
    await query(`DELETE FROM "OrganizerFollow" WHERE "userId" = $1 AND "organizerName" = $2`, [userId, name]);
    return { following: false };
  }
  await query(
    `INSERT INTO "OrganizerFollow" (id, "userId", "organizerUserId", "organizerName", "notifyNextEvent")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("userId", "organizerName") DO UPDATE SET "notifyNextEvent" = EXCLUDED."notifyNextEvent"`,
    [createId(), userId, body.organizerUserId != null ? Number(body.organizerUserId) : null, name, body.notifyNextEvent !== false],
  );
  return { following: true };
}

export async function listFollows(req) {
  const userId = requireUser(req);
  const result = await query(
    `SELECT "organizerName", "organizerUserId", "notifyNextEvent", "createdAt"
     FROM "OrganizerFollow" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [userId],
  );
  return result.rows || [];
}

export async function getNotificationPrefs(req) {
  const userId = requireUser(req);
  const result = await query(`SELECT * FROM "NotificationPreference" WHERE "userId" = $1`, [userId]);
  return (
    result.rows?.[0] || {
      userId,
      organizerAnnouncements: true,
      reminders: true,
      marketing: false,
    }
  );
}

export async function updateNotificationPrefs(req, body) {
  const userId = requireUser(req);
  const current = await getNotificationPrefs(req);
  const next = {
    organizerAnnouncements: body.organizerAnnouncements != null ? Boolean(body.organizerAnnouncements) : current.organizerAnnouncements,
    reminders: body.reminders != null ? Boolean(body.reminders) : current.reminders,
    marketing: body.marketing != null ? Boolean(body.marketing) : false,
  };
  await query(
    `INSERT INTO "NotificationPreference" ("userId", "organizerAnnouncements", reminders, marketing)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("userId") DO UPDATE SET
       "organizerAnnouncements" = EXCLUDED."organizerAnnouncements",
       reminders = EXCLUDED.reminders,
       marketing = EXCLUDED.marketing`,
    [userId, next.organizerAnnouncements, next.reminders, next.marketing],
  );
  return { userId, ...next };
}

async function planAccess(req, planId) {
  const userId = requireUser(req);
  const plan = await query(`SELECT * FROM "Plan" WHERE id = $1`, [planId]);
  const row = plan.rows?.[0];
  if (!row) throw httpError(404, 'Plan not found');
  const member = await query(
    `SELECT * FROM "PlanMember" WHERE "planId" = $1 AND "userId" = $2`,
    [planId, userId],
  );
  if (row.ownerUserId !== userId && !member.rows?.length && !isSuper(req)) {
    throw httpError(403, 'This plan is private.');
  }
  return { plan: row, userId, isOwner: row.ownerUserId === userId || isSuper(req) };
}

function shapePlan(plan, members, options, votes, viewerId) {
  return {
    id: plan.id,
    name: plan.name,
    budgetMin: plan.budgetMin,
    budgetMax: plan.budgetMax,
    notes: plan.notes,
    status: plan.status,
    ownerUserId: plan.ownerUserId,
    members: (members || []).map((m) => ({
      userId: m.userId,
      name: String(m.displayName || '').trim() || 'Member',
      role: m.role,
      rsvp: m.rsvp,
      payment: m.sharePayment && (m.userId === viewerId || plan.ownerUserId === viewerId) ? m.paymentLabel || null : null,
    })),
    options: (options || []).map((o) => ({
      id: o.id,
      eventId: o.eventId,
      proposedDate: o.proposedDate,
      label: o.label,
      votes: (votes || [])
        .filter((v) => v.optionId === o.id)
        .map((v) => ({ userId: v.userId, choice: v.choice })),
    })),
    paymentNote: 'Each person pays for their own ticket. GateWav does not hold pooled funds or charge invitees.',
  };
}

export async function createPlan(req, body) {
  await requireFlag('plans');
  const userId = requireUser(req);
  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, 'Plan name is required');
  const id = createId();
  await query(
    `INSERT INTO "Plan" (id, "ownerUserId", name, "budgetMin", "budgetMax", notes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, name.slice(0, 120), body.budgetMin != null ? Number(body.budgetMin) : null, body.budgetMax != null ? Number(body.budgetMax) : null, body.notes ? String(body.notes).slice(0, 500) : null],
  );
  await query(
    `INSERT INTO "PlanMember" (id, "planId", "userId", role, rsvp) VALUES ($1, $2, $3, 'owner', 'going')`,
    [createId(), id, userId],
  );
  if (body.eventId) {
    await query(
      `INSERT INTO "PlanOption" (id, "planId", "eventId", label) VALUES ($1, $2, $3, $4)`,
      [createId(), id, String(body.eventId), body.label ? String(body.label).slice(0, 120) : null],
    );
  }
  await audit(userId, 'plan_created', 'plan', id, {});
  return getPlan(req, id);
}

export async function listPlans(req) {
  const userId = requireUser(req);
  const result = await query(
    `SELECT p.* FROM "Plan" p
     JOIN "PlanMember" m ON m."planId" = p.id
     WHERE m."userId" = $1
     ORDER BY p."createdAt" DESC LIMIT 50`,
    [userId],
  );
  return result.rows || [];
}

async function execOptional(client, sql, params) {
  await client.query('SAVEPOINT gatewav_delete');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT gatewav_delete');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT gatewav_delete');
    if (err?.code !== '42P01' && err?.code !== '42703') throw err;
  }
}

export async function deletePlan(req, planId) {
  const { plan, userId } = await planAccess(req, planId);
  if (Number(plan.ownerUserId) !== Number(userId) && !isSuper(req)) {
    throw httpError(403, 'Only the plan owner can delete this plan.');
  }
  const pool = getPool();
  if (!pool) throw httpError(500, 'Something went wrong. Please try again.');
  const id = String(planId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await execOptional(
      client,
      `DELETE FROM "PlanVote" v
       USING "PlanOption" o
       WHERE v."optionId"::text = o.id::text AND o."planId"::text = $1`,
      [id],
    );
    await execOptional(client, `DELETE FROM "PlanOption" WHERE "planId"::text = $1`, [id]);
    await execOptional(client, `DELETE FROM "PlanInvite" WHERE "planId"::text = $1`, [id]);
    await execOptional(client, `DELETE FROM "PlanMember" WHERE "planId"::text = $1`, [id]);
    await execOptional(client, `UPDATE "Circle" SET "planId" = NULL WHERE "planId"::text = $1`, [id]);
    const removed = await client.query(`DELETE FROM "Plan" WHERE id::text = $1`, [id]);
    if (!removed.rowCount) throw httpError(404, 'Plan not found');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await audit(userId, 'plan_deleted', 'plan', id, {});
  return { deleted: true };
}

export async function getPlan(req, planId) {
  const { plan, userId } = await planAccess(req, planId);
  const [members, options, votes] = await Promise.all([
    query(
      `SELECT m.*, COALESCE(NULLIF(BTRIM(u.name), ''), 'Member') AS "displayName"
       FROM "PlanMember" m
       LEFT JOIN "User" u ON u.id::text = m."userId"::text
       WHERE m."planId" = $1
       ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m."userId" ASC`,
      [planId],
    ).catch((err) => {
      if (err?.code !== '42703') throw err;
      return query(`SELECT *, 'Member' AS "displayName" FROM "PlanMember" WHERE "planId" = $1`, [planId]);
    }),
    query(`SELECT * FROM "PlanOption" WHERE "planId" = $1`, [planId]),
    query(
      `SELECT v.* FROM "PlanVote" v JOIN "PlanOption" o ON o.id::text = v."optionId"::text WHERE o."planId" = $1`,
      [planId],
    ),
  ]);
  return shapePlan(plan, members.rows, options.rows, votes.rows, userId);
}

export async function addPlanOption(req, planId, body) {
  const { isOwner } = await planAccess(req, planId);
  if (!isOwner && !body.eventId && !body.proposedDate) throw httpError(400, 'Add an event or a date');
  if (!body.eventId && !body.proposedDate) throw httpError(400, 'Add an event or a date');
  const id = createId();
  await query(
    `INSERT INTO "PlanOption" (id, "planId", "eventId", "proposedDate", label) VALUES ($1, $2, $3, $4, $5)`,
    [id, planId, body.eventId ? String(body.eventId) : null, body.proposedDate || null, body.label ? String(body.label).slice(0, 120) : null],
  );
  return getPlan(req, planId);
}

export async function votePlan(req, planId, optionId, choice) {
  const { userId } = await planAccess(req, planId);
  const allowed = ['yes', 'no', 'maybe'];
  if (!allowed.includes(choice)) throw httpError(400, 'Vote must be yes, no, or maybe');
  const option = await query(`SELECT id FROM "PlanOption" WHERE id = $1 AND "planId" = $2`, [optionId, planId]);
  if (!option.rows?.length) throw httpError(404, 'Option not found');
  await query(
    `INSERT INTO "PlanVote" (id, "optionId", "userId", choice) VALUES ($1, $2, $3, $4)
     ON CONFLICT ("optionId", "userId") DO UPDATE SET choice = EXCLUDED.choice`,
    [createId(), optionId, userId, choice],
  );
  return getPlan(req, planId);
}

export async function rsvpPlan(req, planId, rsvp, sharePayment) {
  const { userId } = await planAccess(req, planId);
  const allowed = ['interested', 'tentative', 'going', 'declined'];
  if (!allowed.includes(rsvp)) throw httpError(400, 'RSVP is not valid');
  await query(
    `UPDATE "PlanMember" SET rsvp = $1, "sharePayment" = $2 WHERE "planId" = $3 AND "userId" = $4`,
    [rsvp, Boolean(sharePayment), planId, userId],
  );
  return getPlan(req, planId);
}

export async function inviteToPlan(req, planId) {
  const { isOwner, userId } = await planAccess(req, planId);
  if (!isOwner) throw httpError(403, 'Only the plan owner can invite');
  const value = token();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO "PlanInvite" (token, "planId", "expiresAt", "createdBy") VALUES ($1, $2, $3, $4)`,
    [value, planId, expires.toISOString(), userId],
  );
  await audit(userId, 'plan_invite_created', 'plan', planId, {});
  return { token: value, expiresAt: expires.toISOString() };
}

export async function revokePlanInvite(req, planId, inviteToken) {
  const { isOwner } = await planAccess(req, planId);
  if (!isOwner) throw httpError(403, 'Only the plan owner can revoke invites');
  await query(`UPDATE "PlanInvite" SET "revokedAt" = NOW() WHERE token = $1 AND "planId" = $2`, [inviteToken, planId]);
  return { revoked: true };
}

export async function previewPlanInvite(inviteToken) {
  const result = await query(
    `SELECT i.*, p.name, p."budgetMin", p."budgetMax"
     FROM "PlanInvite" i JOIN "Plan" p ON p.id = i."planId"
     WHERE i.token = $1`,
    [inviteToken],
  );
  const row = result.rows?.[0];
  if (!row || row.revokedAt || new Date(row.expiresAt).getTime() < Date.now()) {
    throw httpError(404, 'This invite is no longer valid');
  }
  return {
    name: row.name,
    budgetMin: row.budgetMin,
    budgetMax: row.budgetMax,
    expiresAt: row.expiresAt,
    note: 'Sign in to vote. Ticket payments stay with each person.',
  };
}

export async function acceptPlanInvite(req, inviteToken) {
  const userId = requireUser(req);
  const result = await query(`SELECT * FROM "PlanInvite" WHERE token = $1`, [inviteToken]);
  const row = result.rows?.[0];
  if (!row || row.revokedAt || new Date(row.expiresAt).getTime() < Date.now()) {
    throw httpError(404, 'This invite is no longer valid');
  }
  await query(
    `INSERT INTO "PlanMember" (id, "planId", "userId", role, rsvp)
     SELECT $1, $2, $3, 'member', 'interested'
     WHERE NOT EXISTS (SELECT 1 FROM "PlanMember" WHERE "planId" = $2 AND "userId" = $3)`,
    [createId(), row.planId, userId],
  );
  await audit(userId, 'plan_invite_accepted', 'plan', row.planId, {});
  return getPlan(req, row.planId);
}

export async function createCircle(req, body) {
  await requireFlag('circles');
  const userId = requireUser(req);
  if (!body.adultConfirmed) throw httpError(400, 'Confirm you are 18 or older to create a circle');
  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, 'Circle name is required');
  if (body.visibility === 'public') {
    throw httpError(403, 'Public circles stay off until moderation review is in place. Use an invite-only circle.');
  }
  const planId = body.planId ? String(body.planId) : null;
  const eventId = body.eventId ? String(body.eventId) : null;
  if (!planId && !eventId) throw httpError(400, 'Link this circle to a plan or an event.');
  if (planId) {
    const plan = await query(
      `SELECT p.id FROM "Plan" p
       JOIN "PlanMember" m ON m."planId" = p.id
       WHERE p.id = $1 AND (m."userId"::text = $2 OR p."ownerUserId"::text = $2)`,
      [planId, String(userId)],
    );
    if (!plan.rows?.length && !isSuper(req)) throw httpError(403, 'You can only link a plan you belong to.');
  }
  let official = false;
  if (body.official) {
    if (!eventId) throw httpError(400, 'An official community has to be linked to an event.');
    const event = await query(`SELECT "createdBy" FROM "Event" WHERE id::text = $1`, [eventId]);
    if (!event.rows?.length) throw httpError(404, 'Event not found');
    if (Number(event.rows[0].createdBy) !== Number(userId) && !isSuper(req)) {
      throw httpError(403, 'Only the event organizer can make this the official community.');
    }
    official = true;
  } else if (eventId) {
    const event = await query(`SELECT id FROM "Event" WHERE id::text = $1`, [eventId]);
    if (!event.rows?.length) throw httpError(404, 'Event not found');
  }
  const id = createId();
  await query(
    `INSERT INTO "Circle" (id, "planId", "eventId", name, "ownerUserId", visibility, official)
     VALUES ($1, $2, $3, $4, $5, 'invite_only', $6)`,
    [id, planId, eventId, name.slice(0, 80), userId, official],
  );
  await query(
    `INSERT INTO "CircleMembership" (id, "circleId", "userId", role, status, "adultConfirmed")
     VALUES ($1, $2, $3, 'owner', 'active', TRUE)`,
    [createId(), id, userId],
  );
  await audit(userId, 'circle_created', 'circle', id, {});
  return getCircle(req, id);
}

async function circleMember(req, circleId) {
  const userId = requireUser(req);
  const circle = await query(`SELECT * FROM "Circle" WHERE id = $1`, [circleId]);
  const row = circle.rows?.[0];
  if (!row) throw httpError(404, 'Circle not found');
  const member = await query(
    `SELECT * FROM "CircleMembership" WHERE "circleId" = $1 AND "userId" = $2`,
    [circleId, userId],
  );
  const membership = member.rows?.[0];
  if (await blockedEither(userId, row.ownerUserId)) throw httpError(403, 'You cannot access this circle');
  const blockedByMember = await query(
    `SELECT 1 FROM "UserBlock" ub
     JOIN "CircleMembership" m ON m."circleId" = $1 AND m.status = 'active'
     WHERE ub."blockerUserId"::text = m."userId"::text AND ub."blockedUserId"::text = $2
     LIMIT 1`,
    [circleId, String(userId)],
  );
  if (blockedByMember.rows?.length && !isSuper(req)) throw httpError(403, 'You cannot access this circle');
  if ((!membership || membership.status !== 'active') && !isSuper(req)) {
    throw httpError(403, 'This circle is invite-only');
  }
  return { circle: row, userId, membership, isOwner: row.ownerUserId === userId || isSuper(req) };
}

async function notifyCircleMembers(circleId, exceptUserId, payload) {
  const members = await query(
    `SELECT u.email
     FROM "CircleMembership" m
     JOIN "User" u ON u.id::text = m."userId"::text
     LEFT JOIN "NotificationPreference" p ON p."userId"::text = m."userId"::text
     WHERE m."circleId" = $1
       AND m.status = 'active'
       AND m."userId"::text <> $2
       AND COALESCE(p.reminders, TRUE) = TRUE`,
    [circleId, String(exceptUserId)],
  ).catch(() => ({ rows: [] }));
  for (const member of members.rows || []) {
    await sendPushToEmail(member.email, payload).catch(() => null);
  }
}

export async function getCircle(req, circleId) {
  const { circle, userId, isOwner } = await circleMember(req, circleId);
  const members = await query(
    `SELECT m."userId", m.role,
            COALESCE(NULLIF(BTRIM(u.name), ''), 'Member') AS "displayName",
            pm.rsvp AS rsvp,
            EXISTS (
              SELECT 1 FROM "Order" o
              WHERE o."eventId"::text = $2
                AND o."userId"::text = m."userId"::text
                AND lower(COALESCE(o.status, '')) IN ('paid', 'completed', 'success')
            ) AS "hasTicket"
     FROM "CircleMembership" m
     LEFT JOIN "User" u ON u.id::text = m."userId"::text
     LEFT JOIN "PlanMember" pm
       ON pm."planId" = $3 AND pm."userId"::text = m."userId"::text
     WHERE m."circleId" = $1 AND m.status = 'active'`,
    [circleId, circle.eventId ? String(circle.eventId) : '', circle.planId || ''],
  );
  const visible = [];
  for (const member of members.rows || []) {
    if (await blockedEither(userId, member.userId)) continue;
    visible.push({
      userId: member.userId,
      name: member.displayName,
      role: member.role,
      rsvp: member.rsvp || null,
      hasTicket: Boolean(member.hasTicket),
    });
  }
  const event = circle.eventId
    ? await query(`SELECT title FROM "Event" WHERE id::text = $1`, [String(circle.eventId)]).catch(() => ({ rows: [] }))
    : { rows: [] };
  const plan = circle.planId
    ? await query(`SELECT name FROM "Plan" WHERE id = $1`, [circle.planId]).catch(() => ({ rows: [] }))
    : { rows: [] };
  const invites = isOwner
    ? await query(
      `SELECT token, "expiresAt" FROM "CircleInvite"
       WHERE "circleId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > NOW()
       ORDER BY "createdAt" DESC`,
      [circleId],
    ).catch(() => ({ rows: [] }))
    : { rows: [] };
  return {
    id: circle.id,
    name: circle.name,
    eventId: circle.eventId,
    eventTitle: event.rows?.[0]?.title || null,
    planId: circle.planId,
    planName: plan.rows?.[0]?.name || null,
    official: Boolean(circle.official),
    visibility: circle.visibility,
    isOwner,
    members: visible,
    invites: (invites.rows || []).map((row) => ({ token: row.token, expiresAt: row.expiresAt })),
    policy: 'Invite-only. No public chat. Phone numbers are never shown. Interest is not a ticket. Circles are for adults 18+.',
  };
}

export async function listCircles(req) {
  const userId = requireUser(req);
  const result = await query(
    `SELECT c.id, c.name, c."eventId", c."planId", c."ownerUserId", c.visibility, c.official,
            e.title AS "eventTitle", p.name AS "planName"
     FROM "Circle" c
     JOIN "CircleMembership" m ON m."circleId" = c.id
     LEFT JOIN "Event" e ON e.id::text = c."eventId"
     LEFT JOIN "Plan" p ON p.id = c."planId"
     WHERE m."userId" = $1 AND m.status = 'active'
     ORDER BY c."createdAt" DESC`,
    [userId],
  );
  return result.rows || [];
}

export async function inviteToCircle(req, circleId) {
  const { isOwner, userId } = await circleMember(req, circleId);
  if (!isOwner) throw httpError(403, 'Only the circle owner can invite');
  const value = token();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO "CircleInvite" (token, "circleId", "expiresAt", "createdBy") VALUES ($1, $2, $3, $4)`,
    [value, circleId, expires.toISOString(), userId],
  );
  return { token: value, expiresAt: expires.toISOString() };
}

export async function revokeCircleInvite(req, circleId, inviteToken) {
  const { isOwner } = await circleMember(req, circleId);
  if (!isOwner) throw httpError(403, 'Only the circle owner can revoke invites');
  await query(`UPDATE "CircleInvite" SET "revokedAt" = NOW() WHERE token = $1 AND "circleId" = $2`, [
    inviteToken,
    circleId,
  ]);
  return { revoked: true };
}

export async function deleteCircle(req, circleId) {
  const { circle, userId } = await circleMember(req, circleId);
  if (Number(circle.ownerUserId) !== Number(userId) && !isSuper(req)) {
    throw httpError(403, 'Only the circle owner can delete this circle.');
  }
  const pool = getPool();
  if (!pool) throw httpError(500, 'Something went wrong. Please try again.');
  const id = String(circleId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await execOptional(client, `DELETE FROM "CircleInvite" WHERE "circleId"::text = $1`, [id]);
    await execOptional(client, `DELETE FROM "CircleMembership" WHERE "circleId"::text = $1`, [id]);
    await execOptional(client, `DELETE FROM "ModerationRecord" WHERE "circleId"::text = $1`, [id]);
    const removed = await client.query(`DELETE FROM "Circle" WHERE id::text = $1`, [id]);
    if (!removed.rowCount) {
      await client.query('ROLLBACK');
      throw httpError(404, 'Circle not found');
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw err;
  } finally {
    client.release();
  }
  await audit(userId, 'circle_deleted', 'circle', id, {});
  return { deleted: true };
}

export async function leaveCircle(req, circleId) {
  const { userId, circle } = await circleMember(req, circleId);
  if (circle.ownerUserId === userId) throw httpError(400, 'The owner can revoke invites instead of leaving');
  await query(`UPDATE "CircleMembership" SET status = 'left' WHERE "circleId" = $1 AND "userId" = $2`, [
    circleId,
    userId,
  ]);
  return { left: true };
}

export async function previewCircleInvite(inviteToken) {
  const result = await query(
    `SELECT i."expiresAt", i."revokedAt", c.name FROM "CircleInvite" i
     JOIN "Circle" c ON c.id = i."circleId" WHERE i.token = $1`,
    [inviteToken],
  );
  const row = result.rows?.[0];
  if (!row || row.revokedAt || new Date(row.expiresAt).getTime() < Date.now()) {
    throw httpError(404, 'This invite is no longer valid');
  }
  return {
    name: row.name,
    expiresAt: row.expiresAt,
    policy: 'Private circle. Member lists are not public. You must confirm you are 18 or older.',
  };
}

export async function acceptCircleInvite(req, inviteToken, adultConfirmed) {
  const userId = requireUser(req);
  if (!adultConfirmed) throw httpError(400, 'Confirm you are 18 or older to join');
  const result = await query(`SELECT * FROM "CircleInvite" WHERE token = $1`, [inviteToken]);
  const row = result.rows?.[0];
  if (!row || row.revokedAt || new Date(row.expiresAt).getTime() < Date.now()) {
    throw httpError(404, 'This invite is no longer valid');
  }
  const circle = await query(`SELECT "ownerUserId" FROM "Circle" WHERE id = $1`, [row.circleId]);
  if (await blockedEither(userId, circle.rows?.[0]?.ownerUserId)) throw httpError(403, 'You cannot join this circle');
  await query(
    `INSERT INTO "CircleMembership" (id, "circleId", "userId", role, status, "adultConfirmed")
     VALUES ($1, $2, $3, 'member', 'active', TRUE)
     ON CONFLICT ("circleId", "userId") DO UPDATE SET status = 'active', "adultConfirmed" = TRUE`,
    [createId(), row.circleId, userId],
  );
  const joined = await getCircle(req, row.circleId);
  const person = await query(`SELECT name FROM "User" WHERE id::text = $1`, [String(userId)]).catch(() => ({ rows: [] }));
  const name = String(person.rows?.[0]?.name || '').trim() || 'Someone';
  await notifyCircleMembers(row.circleId, userId, {
    title: joined.name || 'Private circle',
    body: `${name} joined the circle.`,
    data: { circleId: String(row.circleId) },
  });
  return joined;
}

export async function blockUser(req, blockedUserId) {
  const userId = requireUser(req);
  const other = Number(blockedUserId);
  if (!other || other === userId) throw httpError(400, 'Choose someone else to block');
  await query(
    `INSERT INTO "UserBlock" ("blockerUserId", "blockedUserId") VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, other],
  );
  await query(
    `UPDATE "CircleMembership" SET status = 'blocked'
     WHERE "userId"::text = $2
       AND "circleId" IN (
         SELECT "circleId" FROM "CircleMembership"
         WHERE "userId"::text = $1 AND status = 'active'
       )`,
    [String(userId), String(other)],
  );
  await audit(userId, 'user_blocked', 'user', other, {});
  return { blocked: true };
}

export async function reportContent(req, body) {
  const userId = requireUser(req);
  const reason = String(body.reason || '').trim();
  if (reason.length < 4) throw httpError(400, 'Describe the problem in a few words');
  const id = createId();
  await query(
    `INSERT INTO "ModerationRecord"
      (id, "reporterUserId", "targetUserId", "circleId", "eventId", "reviewId", "mediaId", kind, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      userId,
      body.targetUserId != null ? Number(body.targetUserId) : null,
      body.circleId || null,
      body.eventId ? String(body.eventId) : null,
      body.reviewId || null,
      body.mediaId || null,
      String(body.kind || 'report').slice(0, 40),
      reason.slice(0, 500),
    ],
  );
  if (body.reviewId) {
    await query(`UPDATE "EventReview" SET status = 'reported' WHERE id = $1`, [body.reviewId]).catch(() => null);
  }
  if (body.mediaId) {
    await query(`UPDATE "MediaAsset" SET status = 'removed' WHERE id = $1`, [body.mediaId]).catch(() => null);
  }
  await audit(userId, 'report_created', 'moderation', id, { kind: body.kind || 'report' });
  return { id, status: 'open' };
}

async function attendedOrder(userId, eventId) {
  const result = await query(
    `SELECT o.id
     FROM "Order" o
     WHERE o."eventId"::text = $1
       AND o."userId" = $2
       AND LOWER(COALESCE(o.status, '')) IN ('paid', 'completed', 'success')
     ORDER BY o."createdAt" DESC
     LIMIT 1`,
    [String(eventId), userId],
  );
  return result.rows?.[0] || null;
}

export async function upsertReview(req, eventId, body) {
  await requireFlag('post_event');
  const userId = requireUser(req);
  const order = await attendedOrder(userId, eventId);
  const stamp = await query(
    `SELECT id FROM "AttendanceStamp" WHERE "userId" = $1 AND "eventId" = $2 LIMIT 1`,
    [userId, String(eventId)],
  ).catch(() => ({ rows: [] }));
  if (!order && !stamp.rows?.length) {
    throw httpError(403, 'Only people with a paid ticket or a validated admission can review as an attendee');
  }
  const rating = Number(body.rating);
  if (rating < 1 || rating > 5) throw httpError(400, 'Rating must be from 1 to 5');
  const id = createId();
  await query(
    `INSERT INTO "EventReview" (id, "eventId", "userId", "orderId", rating, body, attended, status)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'published')
     ON CONFLICT ("eventId", "userId") DO UPDATE SET
       rating = EXCLUDED.rating,
       body = EXCLUDED.body,
       "updatedAt" = NOW(),
       status = 'published'`,
    [id, String(eventId), userId, order?.id ? String(order.id) : null, rating, body.body ? String(body.body).slice(0, 800) : null],
  );
  await audit(userId, 'review_submitted', 'event', eventId, { rating });
  return listReviews(eventId);
}

export async function listReviews(eventId) {
  const result = await query(
    `SELECT id, rating, body, attended, "createdAt"
     FROM "EventReview"
     WHERE "eventId" = $1 AND status = 'published'
     ORDER BY "createdAt" DESC LIMIT 50`,
    [String(eventId)],
  );
  const rows = result.rows || [];
  const count = rows.length;
  const average = count ? Math.round((rows.reduce((s, r) => s + Number(r.rating), 0) / count) * 10) / 10 : null;
  return {
    count,
    average,
    moderation: 'Reviews are limited to paid or admitted attendees. Reported reviews are hidden from this list.',
    reviews: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      attended: true,
      createdAt: r.createdAt,
    })),
  };
}

export async function passportFor(req) {
  await requireFlag('passport');
  const userId = requireUser(req);
  const privacy = await query(`SELECT hidden FROM "PassportPrivacy" WHERE "userId" = $1`, [userId]);
  const hidden = privacy.rows?.[0] ? Boolean(privacy.rows[0].hidden) : true;
  const stamps = await query(
    `SELECT s.id, s."eventId", s."awardedAt", s.source, e.title
     FROM "AttendanceStamp" s
     LEFT JOIN "Event" e ON e.id::text = s."eventId"
     WHERE s."userId" = $1
     ORDER BY s."awardedAt" DESC`,
    [userId],
  );
  const perks = await query(
    `SELECT p.id, p.title, p.description, p.quota, p."redeemedCount", p."validUntil", p."eventId", p.status
     FROM "Perk" p
     WHERE p.status = 'approved'
       AND (p."validUntil" IS NULL OR p."validUntil" > NOW())
       AND p."redeemedCount" < p.quota
     ORDER BY p."createdAt" DESC LIMIT 30`,
  );
  return {
    hidden,
    stamps: stamps.rows || [],
    perks: perks.rows || [],
    note: 'Stamps are awarded once per validated admission. Perks are organizer-funded benefits, not cash or a wallet.',
  };
}

export async function setPassportHidden(req, hidden) {
  const userId = requireUser(req);
  await query(
    `INSERT INTO "PassportPrivacy" ("userId", hidden) VALUES ($1, $2)
     ON CONFLICT ("userId") DO UPDATE SET hidden = EXCLUDED.hidden`,
    [userId, Boolean(hidden)],
  );
  return { hidden: Boolean(hidden) };
}

export async function publicPassport(userId) {
  const privacy = await query(`SELECT hidden FROM "PassportPrivacy" WHERE "userId" = $1`, [userId]);
  if (!privacy.rows?.length || privacy.rows[0].hidden !== false) {
    throw httpError(404, 'This passport is private');
  }
  const stamps = await query(
    `SELECT COUNT(*)::int AS count FROM "AttendanceStamp" WHERE "userId" = $1`,
    [userId],
  );
  return {
    userId,
    attendedCount: stamps.rows?.[0]?.count || 0,
    note: 'Shared summary only. Ticket codes and order amounts are not included.',
  };
}

export async function redeemPerk(req, perkId) {
  const userId = requireUser(req);
  const perk = await query(`SELECT * FROM "Perk" WHERE id = $1`, [perkId]);
  const row = perk.rows?.[0];
  if (!row || row.status !== 'approved') throw httpError(404, 'This benefit is not available');
  if (row.validUntil && new Date(row.validUntil).getTime() < Date.now()) throw httpError(400, 'This benefit has expired');
  if (Number(row.redeemedCount) >= Number(row.quota)) throw httpError(400, 'This benefit is fully claimed');
  const stamp = await query(
    `SELECT id FROM "AttendanceStamp" WHERE "userId" = $1 AND ($2::text IS NULL OR "eventId" = $2) LIMIT 1`,
    [userId, row.eventId],
  );
  if (!stamp.rows?.length) throw httpError(403, 'Redeem this after a validated admission');
  const event = row.eventId ? await loadEvent(row.eventId) : null;
  if (event && String(event.listingStatus) === 'cancelled') throw httpError(400, 'The event was cancelled');
  const inserted = await query(
    `INSERT INTO "PerkRedemption" (id, "perkId", "userId", "stampId")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("perkId", "userId") DO NOTHING
     RETURNING id`,
    [createId(), perkId, userId, stamp.rows[0].id],
  );
  if (!inserted.rows?.length) throw httpError(400, 'You already redeemed this benefit');
  await query(`UPDATE "Perk" SET "redeemedCount" = "redeemedCount" + 1 WHERE id = $1 AND "redeemedCount" < quota`, [
    perkId,
  ]);
  await audit(userId, 'perk_redeemed', 'perk', perkId, {});
  return { redeemed: true };
}

export async function exportMine(req) {
  const userId = requireUser(req);
  const [favorites, follows, plans, stamps, reviews, prefs] = await Promise.all([
    query(`SELECT "eventId", "createdAt" FROM "Favorite" WHERE "userId" = $1`, [userId]),
    query(`SELECT "organizerName", "notifyNextEvent" FROM "OrganizerFollow" WHERE "userId" = $1`, [userId]),
    query(`SELECT id, name, status FROM "Plan" WHERE "ownerUserId" = $1`, [userId]),
    query(`SELECT "eventId", "awardedAt" FROM "AttendanceStamp" WHERE "userId" = $1`, [userId]),
    query(`SELECT "eventId", rating, body FROM "EventReview" WHERE "userId" = $1`, [userId]),
    getNotificationPrefs(req),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    favorites: favorites.rows,
    follows: follows.rows,
    plans: plans.rows,
    stamps: stamps.rows,
    reviews: reviews.rows,
    notificationPreferences: prefs,
  };
}

export async function trackAnalytics(req, body) {
  const name = String(body.name || '').trim().slice(0, 64);
  if (!/^[a-z0-9_]+$/.test(name)) throw httpError(400, 'Unknown analytics event');
  const allowed = new Set([
    'landing_view',
    'referral_open',
    'city_collection_view',
    'search_submitted',
    'filter_applied',
    'result_empty',
    'event_detail_view',
    'event_share',
    'event_save',
    'checkout_started',
    'payment_pending',
    'payment_confirmed',
    'payment_failed',
    'order_refunded',
    'ticket_issued',
    'checkin_valid',
    'checkin_duplicate',
    'experience_attended',
    'passport_awarded',
    'follow_created',
    'organizer_started',
    'verification_submitted',
    'first_event_published',
    'event_republished',
    'plan_created',
    'plan_invite_accepted',
    'vote_submitted',
    'promoter_conversion',
    'report_created',
    'review_submitted',
  ]);
  if (!allowed.has(name)) throw httpError(400, 'Unknown analytics event');
  const { safeProps } = await import('./access.js');
  await query(
    `INSERT INTO "AnalyticsEvent" (id, name, "anonId", "userId", "eventId", "citySlug", props)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      createId(),
      name,
      body.anonId ? String(body.anonId).slice(0, 64) : null,
      userIdOf(req),
      body.eventId ? String(body.eventId) : null,
      body.citySlug ? String(body.citySlug).slice(0, 40) : null,
      JSON.stringify(safeProps(body.props)),
    ],
  );
  return { ok: true };
}

export async function suggestionsFor(req) {
  const follows = await listFollows(req).catch(() => []);
  const names = new Set(follows.map((f) => String(f.organizerName || '').toLowerCase()));
  const searched = await searchEvents({ page: 1, pageSize: 20 });
  const matched = names.size
    ? searched.events.filter((e) => names.has(String(e.organizer || '').toLowerCase()))
    : [];
  return {
    fromFollows: matched.slice(0, 8),
    nearby: searched.events.slice(0, 8),
  };
}
