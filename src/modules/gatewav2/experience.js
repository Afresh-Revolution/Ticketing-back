import crypto from 'node:crypto';
import { query, createId, getPool } from '../../shared/config/db.js';
import { sendPushToEmail } from '../../shared/services/push.service.js';
import { httpError, userIdOf, isSuper, audit, safeProps } from './access.js';
import { circleMember, getCircle, getPlan, notifyCircleMembers, planAccess } from './community.js';
import {
  budgetSummary,
  canAddMemory,
  canRemoveMember,
  canTransition,
  canonicalRsvp,
  circlePowers,
  displayRsvp,
  httpsUrl,
  inviteStatusFor,
  inviteUsable,
  normalizeLifecycle,
  singleChoiceBallot,
  tallyPoll,
  ticketStatusFor,
  validateBudgetItem,
  validateCircleBody,
  validatePlanBody,
} from './experienceRules.js';

function token() {
  return crypto.randomBytes(18).toString('hex');
}

async function optionalQuery(sql, params) {
  try {
    return await query(sql, params);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703' || err?.code === '42804') return { rows: [] };
    throw err;
  }
}

async function optionalExec(sql, params) {
  try {
    await query(sql, params);
    return true;
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703' || err?.code === '23505') return false;
    throw err;
  }
}

export async function recordFeature(req, name, props = {}) {
  const userId = userIdOf(req);
  await optionalExec(
    `INSERT INTO "AnalyticsEvent" (id, name, "anonId", "userId", "eventId", "citySlug", props)
     VALUES ($1, $2, NULL, $3, $4, NULL, $5::jsonb)`,
    [
      createId(),
      String(name).slice(0, 64),
      userId,
      props.eventId ? String(props.eventId) : null,
      JSON.stringify(safeProps(props)),
    ],
  );
}

export async function recordActivity({ circleId, planId, kind, actorUserId, summary }) {
  await optionalExec(
    `INSERT INTO "CircleActivity" (id, "circleId", "planId", kind, "actorUserId", summary)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [createId(), circleId || null, planId || null, kind, actorUserId ?? null, String(summary || '').slice(0, 180)],
  );
}

async function notifyPlanMembers(planId, exceptUserId, payload) {
  const members = await optionalQuery(
    `SELECT u.email
     FROM "PlanMember" m
     JOIN "User" u ON u.id::text = m."userId"::text
     LEFT JOIN "NotificationPreference" p ON p."userId"::text = m."userId"::text
     WHERE m."planId" = $1
       AND m."userId"::text <> $2
       AND COALESCE(p.reminders, TRUE) = TRUE`,
    [planId, String(exceptUserId)],
  );
  for (const member of members.rows || []) {
    await sendPushToEmail(member.email, payload).catch(() => null);
  }
}

async function planEditors(req, planId) {
  const access = await planAccess(req, planId);
  let powers = null;
  if (access.plan.circleId) {
    try {
      const circle = await circleMember(req, access.plan.circleId);
      powers = circlePowers(circle.circle, circle.membership, circle.isOwner);
    } catch {
      powers = null;
    }
  }
  return { ...access, powers, canManage: access.isOwner || Boolean(powers?.moderate) };
}

function money(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount);
}

async function applyPlanColumns(id, body) {
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  await optionalExec(
    `UPDATE "Plan"
     SET kind = COALESCE($2, kind),
         "circleId" = $3,
         "activityType" = $4,
         "eventId" = $5,
         location = $6,
         "startsAt" = $7,
         lifecycle = COALESCE($8, lifecycle),
         "perPerson" = $9,
         "clientRequestId" = COALESCE($10, "clientRequestId"),
         "budgetMin" = COALESCE($11, "budgetMin"),
         "budgetMax" = COALESCE($12, "budgetMax"),
         notes = COALESCE($13, notes)
     WHERE id = $1`,
    [
      id,
      body.kind ? String(body.kind) : null,
      body.circleId ? String(body.circleId) : null,
      body.activityType ? String(body.activityType) : null,
      body.eventId ? String(body.eventId) : null,
      body.location ? String(body.location).slice(0, 160) : null,
      startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt.toISOString() : null,
      body.lifecycle ? normalizeLifecycle(body.lifecycle) : null,
      money(body.perPerson),
      body.clientRequestId ? String(body.clientRequestId).slice(0, 64) : null,
      money(body.budgetMin),
      money(body.budgetMax),
      body.notes != null ? String(body.notes).slice(0, 500) : null,
    ],
  );
}

async function attachPlanToCircle(req, planId, circleId, userId) {
  if (!circleId) return;
  const access = await circleMember(req, circleId);
  const powers = circlePowers(access.circle, access.membership, access.isOwner);
  if (!powers.createPlans && !access.isOwner) throw httpError(403, 'You cannot add a plan to this circle.');
  await optionalExec(`UPDATE "Plan" SET "circleId" = $2 WHERE id = $1`, [planId, circleId]);
  if (!access.circle.planId) {
    await optionalExec(`UPDATE "Circle" SET "planId" = $2 WHERE id = $1 AND "planId" IS NULL`, [circleId, planId]);
  }
  await recordActivity({
    circleId,
    planId,
    kind: 'plan_created',
    actorUserId: userId,
    summary: 'A plan was added to the circle',
  });
}

export async function finishNewPlan(req, id, body) {
  const userId = userIdOf(req);
  const kind = body.kind === 'personal' ? 'personal' : 'group';
  const lifecycle = body.lifecycle ? normalizeLifecycle(body.lifecycle) : (kind === 'personal' ? 'confirmed' : 'voting');
  await applyPlanColumns(id, { ...body, kind, lifecycle, circleId: kind === 'personal' ? null : body.circleId });
  if (kind === 'group' && body.circleId) await attachPlanToCircle(req, id, String(body.circleId), userId);
  const items = Array.isArray(body.budgetItems) ? body.budgetItems : [];
  for (const item of items.slice(0, 12)) {
    const problem = validateBudgetItem(item);
    if (problem) continue;
    await optionalExec(
      `INSERT INTO "PlanBudgetItem" (id, "planId", category, label, amount, "createdBy") VALUES ($1, $2, $3, $4, $5, $6)`,
      [createId(), id, String(item.category || 'custom'), item.label ? String(item.label).slice(0, 80) : null, Math.round(Number(item.amount) || 0), userId],
    );
  }
  const alternatives = Array.isArray(body.alternatives) ? body.alternatives.filter((row) => row && (row.label || row.proposedDate)) : [];
  if (kind === 'group' && alternatives.length && lifecycle !== 'draft') {
    const pollId = createId();
    const inserted = await optionalExec(
      `INSERT INTO "PlanPoll" (id, "planId", question, kind, "createdBy") VALUES ($1, $2, $3, 'custom', $4)`,
      [pollId, id, 'Which option works?', userId],
    );
    if (inserted) {
      for (const option of alternatives.slice(0, 8)) {
        await query(
          `INSERT INTO "PlanOption" (id, "planId", "eventId", "proposedDate", label, "pollId", kind)
           VALUES ($1, $2, $3, $4, $5, $6, 'custom')`,
          [
            createId(),
            id,
            option.eventId ? String(option.eventId) : null,
            option.proposedDate || null,
            option.label ? String(option.label).slice(0, 120) : null,
            pollId,
          ],
        ).catch((err) => {
          if (err?.code !== '42703') throw err;
        });
      }
      await recordActivity({ circleId: body.circleId || null, planId: id, kind: 'poll_started', actorUserId: userId, summary: 'A poll started' });
    }
  }
  if (lifecycle !== 'draft' && body.circleId) {
    await notifyCircleMembers(String(body.circleId), userId, {
      title: 'New plan',
      body: `${String(body.name || 'A plan').slice(0, 80)} is ready to vote on.`,
      data: { planId: String(id), circleId: String(body.circleId) },
    });
  }
  await recordFeature(req, 'plan_created', { planId: id, kind });
}

export async function finishNewCircle(req, id, body) {
  const problem = validateCircleBody(body, { creating: false });
  if (problem) throw httpError(400, problem);
  const cover = httpsUrl(body.coverUrl);
  const avatar = httpsUrl(body.avatarUrl);
  if (cover.error || avatar.error) throw httpError(400, cover.error || avatar.error);
  await optionalExec(
    `UPDATE "Circle"
     SET description = $2,
         "coverUrl" = $3,
         "avatarUrl" = $4,
         category = COALESCE($5, category),
         "memberCanCreatePlans" = COALESCE($6, "memberCanCreatePlans"),
         "memberCanInvite" = COALESCE($7, "memberCanInvite")
     WHERE id = $1`,
    [
      id,
      body.description != null ? String(body.description).slice(0, 280) : null,
      cover.url,
      avatar.url,
      body.category ? String(body.category).toLowerCase() : 'friends',
      body.memberCanCreatePlans == null ? true : Boolean(body.memberCanCreatePlans),
      body.memberCanInvite == null ? false : Boolean(body.memberCanInvite),
    ],
  );
  await recordFeature(req, 'circle_created', { circleId: id });
}

export async function findExistingPlanRequest(userId, clientRequestId) {
  if (!clientRequestId) return null;
  const found = await optionalQuery(
    `SELECT id FROM "Plan" WHERE "ownerUserId" = $1 AND "clientRequestId" = $2 LIMIT 1`,
    [userId, String(clientRequestId).slice(0, 64)],
  );
  return found.rows?.[0]?.id || null;
}

async function loadEventBrief(eventId) {
  if (!eventId) return null;
  const event = await optionalQuery(
    `SELECT id::text AS id, title, "imageUrl" FROM "Event" WHERE id::text = $1`,
    [String(eventId)],
  );
  const row = event.rows?.[0];
  if (!row) return { id: String(eventId), missing: true, title: null, imageUrl: null, ticketPrice: null, available: false };
  const tickets = await optionalQuery(
    `SELECT MIN(tt.price)::int AS price,
            COALESCE(SUM(GREATEST(COALESCE(tt.quantity, 0) - COALESCE(tt.sold, 0), 0)), 0)::int AS remaining
     FROM "TicketType" tt WHERE tt."eventId"::text = $1`,
    [String(eventId)],
  );
  const price = tickets.rows?.[0]?.price;
  const remaining = Number(tickets.rows?.[0]?.remaining || 0);
  return {
    id: row.id,
    title: row.title || null,
    imageUrl: row.imageUrl || null,
    ticketPrice: price == null ? null : Number(price),
    available: remaining > 0,
    missing: false,
  };
}

async function bookingMap(eventId, userIds) {
  const ids = (userIds || []).map((id) => String(id)).filter(Boolean);
  if (!eventId || !ids.length) return new Map();
  const [orders, stamps] = await Promise.all([
    optionalQuery(
      `SELECT "userId"::text AS "userId", lower(COALESCE(status, '')) AS status
       FROM "Order"
       WHERE "eventId"::text = $1 AND "userId"::text = ANY($2::text[])`,
      [String(eventId), ids],
    ),
    optionalQuery(
      `SELECT "userId"::text AS "userId" FROM "AttendanceStamp"
       WHERE "eventId"::text = $1 AND "userId"::text = ANY($2::text[])`,
      [String(eventId), ids],
    ),
  ]);
  const stamped = new Set((stamps.rows || []).map((row) => String(row.userId)));
  const map = new Map();
  for (const id of ids) map.set(id, ticketStatusFor(null, stamped.has(id)));
  for (const row of orders.rows || []) {
    const current = map.get(String(row.userId)) || 'none';
    const next = ticketStatusFor(row.status, stamped.has(String(row.userId)));
    map.set(String(row.userId), current === 'checked_in' ? 'checked_in' : next);
  }
  return map;
}

async function maybeRemind(plan, exceptUserId) {
  const lifecycle = normalizeLifecycle(plan.lifecycle || plan.status);
  if (!plan.startsAt || plan.reminderSentAt) return;
  if (lifecycle !== 'upcoming' && lifecycle !== 'confirmed') return;
  const when = new Date(plan.startsAt).getTime();
  if (!Number.isFinite(when)) return;
  const delta = when - Date.now();
  if (delta < 0 || delta > 24 * 60 * 60 * 1000) return;
  const marked = await optionalExec(
    `UPDATE "Plan" SET "reminderSentAt" = NOW() WHERE id = $1 AND "reminderSentAt" IS NULL`,
    [plan.id],
  );
  if (!marked) return;
  await notifyPlanMembers(plan.id, exceptUserId, {
    title: plan.name || 'Upcoming plan',
    body: 'This plan is coming up within a day.',
    data: { planId: String(plan.id) },
  });
}

async function noteBookings(plan, bookings, actorUserId) {
  if (!plan.eventId) return;
  for (const [userId, status] of bookings.entries()) {
    if (status !== 'paid' && status !== 'checked_in') continue;
    const existing = await optionalQuery(
      `SELECT 1 FROM "CircleActivity"
       WHERE "planId" = $1 AND "actorUserId"::text = $2 AND kind = 'booking_confirmed' LIMIT 1`,
      [plan.id, String(userId)],
    );
    if (existing.rows?.length) continue;
    await recordActivity({
      circleId: plan.circleId,
      planId: plan.id,
      kind: 'booking_confirmed',
      actorUserId: Number(userId),
      summary: 'A ticket was confirmed',
    });
  }
}

export async function enrichPlan(req, plan, shaped, viewerId) {
  await maybeRemind(plan, viewerId);
  const [polls, items, comments, memories, media, activity] = await Promise.all([
    optionalQuery(`SELECT * FROM "PlanPoll" WHERE "planId" = $1 ORDER BY "createdAt" ASC`, [plan.id]),
    optionalQuery(`SELECT * FROM "PlanBudgetItem" WHERE "planId" = $1 ORDER BY "createdAt" ASC`, [plan.id]),
    optionalQuery(
      `SELECT c.*, COALESCE(NULLIF(BTRIM(u.name), ''), 'Member') AS "displayName"
       FROM "PlanComment" c
       LEFT JOIN "User" u ON u.id::text = c."userId"::text
       WHERE c."planId" = $1
       ORDER BY c."createdAt" ASC
       LIMIT 80`,
      [plan.id],
    ),
    optionalQuery(`SELECT * FROM "ExperienceMemory" WHERE "planId" = $1 ORDER BY "createdAt" DESC`, [plan.id]),
    optionalQuery(
      `SELECT media.* FROM "ExperienceMedia" media
       JOIN "ExperienceMemory" memory ON memory.id = media."memoryId"
       WHERE memory."planId" = $1
       ORDER BY media."createdAt" ASC`,
      [plan.id],
    ),
    optionalQuery(
      `SELECT * FROM "CircleActivity" WHERE "planId" = $1 ORDER BY "createdAt" DESC LIMIT 40`,
      [plan.id],
    ),
  ]);
  const event = await loadEventBrief(plan.eventId);
  const bookings = await bookingMap(plan.eventId, (shaped.members || []).map((member) => member.userId));
  await noteBookings(plan, bookings, viewerId);
  const access = await planEditors(req, plan.id).catch(() => ({ canManage: shaped.ownerUserId === viewerId, powers: null }));
  const going = (shaped.members || []).filter((member) => canonicalRsvp(member.rsvp) === 'going').length;
  const budget = budgetSummary(items.rows, plan.budgetMin, plan.budgetMax, plan.perPerson, going);
  const pollRows = [];
  for (const poll of polls.rows || []) {
    if (poll.closesAt && !poll.closedAt && !poll.deadlineNotified && new Date(poll.closesAt).getTime() < Date.now()) {
      await optionalExec(`UPDATE "PlanPoll" SET "deadlineNotified" = TRUE WHERE id = $1 AND "deadlineNotified" = FALSE`, [poll.id]);
      await notifyPlanMembers(plan.id, viewerId, {
        title: plan.name || 'Plan poll',
        body: 'A poll deadline has passed.',
        data: { planId: String(plan.id) },
      });
    }
    const options = (shaped.options || []).filter((option) => option.pollId === poll.id);
    const votes = options.flatMap((option) => (option.votes || []).map((vote) => ({ ...vote, optionId: option.id })));
    const tally = tallyPoll(options, votes);
    const closed = Boolean(poll.closedAt) || (poll.closesAt && new Date(poll.closesAt).getTime() < Date.now());
    pollRows.push({
      id: poll.id,
      question: poll.question,
      kind: poll.kind,
      closesAt: poll.closesAt,
      closedAt: poll.closedAt,
      closed,
      tie: tally.tie,
      leaders: tally.leaders,
      options: tally.options.map((row) => ({
        ...row,
        eventId: options.find((option) => option.id === row.id)?.eventId || null,
        proposedDate: options.find((option) => option.id === row.id)?.proposedDate || null,
        mine: (options.find((option) => option.id === row.id)?.votes || []).some((vote) => Number(vote.userId) === Number(viewerId) && (vote.choice === 'yes' || vote.choice === row.id)),
      })),
    });
  }
  const suggestions = (shaped.options || []).filter((option) => !option.pollId);
  const memoryRows = (memories.rows || []).map((memory) => ({
    id: memory.id,
    userId: memory.userId,
    title: memory.title || plan.name,
    note: memory.note || '',
    rating: memory.rating,
    createdAt: memory.createdAt,
    photos: (media.rows || []).filter((item) => item.memoryId === memory.id).map((item) => ({
      id: item.id,
      imageUrl: item.imageUrl,
      userId: item.userId,
      mine: Number(item.userId) === Number(viewerId),
    })),
  }));
  const members = (shaped.members || []).map((member) => {
    const status = bookings.get(String(member.userId)) || 'none';
    return {
      ...member,
      rsvp: canonicalRsvp(member.rsvp) || member.rsvp || 'invited',
      rsvpLabel: displayRsvp(member.rsvp),
      inviteStatus: inviteStatusFor(member.rsvp),
      ticketStatus: status,
      verifiedAttendance: status === 'checked_in',
    };
  });
  return {
    ...shaped,
    kind: plan.kind || 'group',
    circleId: plan.circleId || null,
    activityType: plan.activityType || null,
    eventId: plan.eventId || null,
    location: plan.location || null,
    startsAt: plan.startsAt || null,
    lifecycle: normalizeLifecycle(plan.lifecycle || plan.status),
    perPerson: plan.perPerson ?? null,
    canManage: Boolean(access.canManage),
    members,
    suggestions,
    polls: pollRows,
    budget: {
      ...budget,
      min: plan.budgetMin,
      max: plan.budgetMax,
      items: (items.rows || []).map((item) => ({
        id: item.id,
        category: item.category,
        label: item.label,
        amount: Number(item.amount) || 0,
      })),
      note: 'Estimates only. A ticket is paid separately by each person.',
    },
    event,
    comments: (comments.rows || []).map((comment) => ({
      id: comment.id,
      userId: comment.userId,
      name: comment.displayName || 'Member',
      body: comment.body,
      kind: comment.kind || 'comment',
      createdAt: comment.createdAt,
      mine: Number(comment.userId) === Number(viewerId),
    })),
    activity: (activity.rows || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      createdAt: row.createdAt,
    })),
    memories: memoryRows,
    viewerVerifiedAttendance: (bookings.get(String(viewerId)) || 'none') === 'checked_in',
  };
}

export async function enrichCircle(req, circle, shaped, viewerId) {
  const membership = (shaped.members || []).find((member) => Number(member.userId) === Number(viewerId));
  const powers = circlePowers(circle, { ...membership, userId: viewerId, role: membership?.role }, shaped.isOwner);
  const [plans, activity, memories, media] = await Promise.all([
    optionalQuery(
      `SELECT id, name, location, "startsAt", lifecycle, status, "eventId", kind,
              (SELECT COUNT(*)::int FROM "PlanMember" m WHERE m."planId" = "Plan".id) AS participants,
              (SELECT COUNT(*)::int FROM "PlanMember" m WHERE m."planId" = "Plan".id AND m.rsvp = 'going') AS going,
              (SELECT COUNT(*)::int FROM "PlanMember" m WHERE m."planId" = "Plan".id AND m.rsvp = 'maybe') AS maybe,
              (SELECT COUNT(*)::int FROM "PlanMember" m WHERE m."planId" = "Plan".id AND m.rsvp = 'not_going') AS declined
       FROM "Plan"
       WHERE "circleId" = $1
       ORDER BY "startsAt" ASC NULLS LAST, "createdAt" DESC
       LIMIT 30`,
      [circle.id],
    ),
    optionalQuery(
      `SELECT * FROM "CircleActivity" WHERE "circleId" = $1 ORDER BY "createdAt" DESC LIMIT 40`,
      [circle.id],
    ),
    optionalQuery(
      `SELECT memory.*, plan.name AS "planName", plan.location, plan."startsAt", plan."eventId"
       FROM "ExperienceMemory" memory
       JOIN "Plan" plan ON plan.id = memory."planId"
       WHERE plan."circleId" = $1
       ORDER BY memory."createdAt" DESC
       LIMIT 20`,
      [circle.id],
    ),
    optionalQuery(
      `SELECT media.* FROM "ExperienceMedia" media
       JOIN "ExperienceMemory" memory ON memory.id = media."memoryId"
       JOIN "Plan" plan ON plan.id = memory."planId"
       WHERE plan."circleId" = $1`,
      [circle.id],
    ),
  ]);
  const eventIds = [...new Set((plans.rows || []).map((row) => row.eventId).filter(Boolean))];
  const images = new Map();
  if (eventIds.length) {
    const events = await optionalQuery(
      `SELECT id::text AS id, title, "imageUrl" FROM "Event" WHERE id::text = ANY($1::text[])`,
      [eventIds],
    );
    for (const row of events.rows || []) images.set(String(row.id), row);
  }
  return {
    ...shaped,
    description: circle.description || '',
    coverUrl: circle.coverUrl || null,
    avatarUrl: circle.avatarUrl || null,
    category: circle.category || 'friends',
    memberCanCreatePlans: circle.memberCanCreatePlans !== false,
    memberCanInvite: Boolean(circle.memberCanInvite),
    powers,
    memberCount: (shaped.members || []).length,
    plans: (plans.rows || []).map((row) => {
      const image = images.get(String(row.eventId || ''));
      return {
        id: row.id,
        name: row.name,
        location: row.location || null,
        startsAt: row.startsAt || null,
        lifecycle: normalizeLifecycle(row.lifecycle || row.status),
        kind: row.kind || 'group',
        eventId: row.eventId || null,
        imageUrl: image?.imageUrl || null,
        eventTitle: image?.title || null,
        participants: Number(row.participants || 0),
        going: Number(row.going || 0),
        maybe: Number(row.maybe || 0),
        declined: Number(row.declined || 0),
      };
    }),
    activity: (activity.rows || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      createdAt: row.createdAt,
    })),
    memories: (memories.rows || []).map((memory) => ({
      id: memory.id,
      planId: memory.planId,
      title: memory.title || memory.planName,
      note: memory.note || '',
      rating: memory.rating,
      location: memory.location || null,
      startsAt: memory.startsAt || null,
      eventId: memory.eventId || null,
      photos: (media.rows || []).filter((item) => item.memoryId === memory.id).map((item) => ({
        id: item.id,
        imageUrl: item.imageUrl,
      })),
    })),
  };
}

export async function updateCircle(req, circleId, body) {
  const access = await circleMember(req, circleId);
  const powers = circlePowers(access.circle, access.membership, access.isOwner);
  if (!powers.manageSettings) throw httpError(403, 'Only the owner can change circle settings.');
  const problem = validateCircleBody({ ...access.circle, ...body, adultConfirmed: true }, { creating: false });
  if (problem) throw httpError(400, problem);
  if (body.visibility === 'public') throw httpError(403, 'Public circles stay off until moderation review is in place.');
  const cover = httpsUrl(body.coverUrl != null ? body.coverUrl : access.circle.coverUrl);
  const avatar = httpsUrl(body.avatarUrl != null ? body.avatarUrl : access.circle.avatarUrl);
  if (cover.error || avatar.error) throw httpError(400, cover.error || avatar.error);
  if (body.name) {
    await query(`UPDATE "Circle" SET name = $2 WHERE id = $1`, [circleId, String(body.name).trim().slice(0, 80)]);
  }
  await optionalExec(
    `UPDATE "Circle"
     SET description = $2,
         "coverUrl" = $3,
         "avatarUrl" = $4,
         category = COALESCE($5, category),
         "memberCanCreatePlans" = COALESCE($6, "memberCanCreatePlans"),
         "memberCanInvite" = COALESCE($7, "memberCanInvite")
     WHERE id = $1`,
    [
      circleId,
      body.description != null ? String(body.description).slice(0, 280) : access.circle.description || null,
      body.coverUrl != null ? cover.url : access.circle.coverUrl || null,
      body.avatarUrl != null ? avatar.url : access.circle.avatarUrl || null,
      body.category ? String(body.category).toLowerCase() : null,
      body.memberCanCreatePlans == null ? null : Boolean(body.memberCanCreatePlans),
      body.memberCanInvite == null ? null : Boolean(body.memberCanInvite),
    ],
  );
  await audit(access.userId, 'circle_updated', 'circle', circleId, {});
  return getCircle(req, circleId);
}

export async function setCircleRole(req, circleId, memberId, role) {
  const access = await circleMember(req, circleId);
  const powers = circlePowers(access.circle, access.membership, access.isOwner);
  if (!powers.assignRoles) throw httpError(403, 'Only the owner can change roles.');
  const next = String(role || '');
  if (next !== 'admin' && next !== 'member') throw httpError(400, 'Choose admin or member.');
  if (Number(memberId) === Number(access.circle.ownerUserId)) throw httpError(400, 'Transfer ownership to change the owner.');
  const updated = await query(
    `UPDATE "CircleMembership" SET role = $3
     WHERE "circleId" = $1 AND "userId" = $2 AND status = 'active' AND role <> 'owner'`,
    [circleId, Number(memberId), next],
  );
  if (!updated.rowCount) throw httpError(404, 'That member is not in this circle.');
  await audit(access.userId, 'circle_role_changed', 'circle', circleId, { role: next });
  return getCircle(req, circleId);
}

export async function transferCircle(req, circleId, memberId) {
  const access = await circleMember(req, circleId);
  const powers = circlePowers(access.circle, access.membership, access.isOwner);
  if (!powers.transfer) throw httpError(403, 'Only the owner can transfer this circle.');
  const nextId = Number(memberId);
  if (!nextId || nextId === Number(access.userId)) throw httpError(400, 'Choose another member.');
  const pool = getPool();
  if (!pool) throw httpError(500, 'Something went wrong. Please try again.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query(
      `UPDATE "Circle" SET "ownerUserId" = $2 WHERE id = $1 AND "ownerUserId" = $3`,
      [circleId, nextId, access.userId],
    );
    if (!moved.rowCount && !isSuper(req)) throw httpError(403, 'Only the owner can transfer this circle.');
    const member = await client.query(
      `UPDATE "CircleMembership" SET role = 'owner', status = 'active'
       WHERE "circleId" = $1 AND "userId" = $2 AND status = 'active'`,
      [circleId, nextId],
    );
    if (!member.rowCount) throw httpError(404, 'That person is not an active member.');
    await client.query(
      `UPDATE "CircleMembership" SET role = 'admin'
       WHERE "circleId" = $1 AND "userId" = $3 AND $3::text <> $2::text`,
      [circleId, nextId, access.userId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await recordActivity({ circleId, kind: 'member_joined', actorUserId: access.userId, summary: 'Ownership was transferred' });
  await audit(access.userId, 'circle_transferred', 'circle', circleId, {});
  return getCircle(req, circleId);
}

export async function removeCircleMember(req, circleId, memberId) {
  const access = await circleMember(req, circleId);
  const powers = circlePowers(access.circle, access.membership, access.isOwner);
  const target = await query(
    `SELECT role, "userId" FROM "CircleMembership" WHERE "circleId" = $1 AND "userId" = $2 AND status = 'active'`,
    [circleId, Number(memberId)],
  );
  const row = target.rows?.[0];
  if (!row) throw httpError(404, 'That member is not in this circle.');
  if (!canRemoveMember(powers, access.userId, row)) throw httpError(403, 'You cannot remove that member.');
  await query(
    `UPDATE "CircleMembership" SET status = 'left' WHERE "circleId" = $1 AND "userId" = $2`,
    [circleId, Number(memberId)],
  );
  await audit(access.userId, 'circle_member_removed', 'circle', circleId, {});
  return getCircle(req, circleId);
}

export async function inviteCircleByEmail(req, circleId, email) {
  const access = await circleMember(req, circleId);
  const powers = circlePowers(access.circle, access.membership, access.isOwner);
  if (!powers.invite) throw httpError(403, 'You do not have permission to invite people.');
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw httpError(400, 'Enter the email on their Gatewav account.');
  const user = await query(`SELECT id, email, name FROM "User" WHERE lower(email) = $1 LIMIT 1`, [address]);
  if (!user.rows?.length) throw httpError(404, 'No Gatewav account uses that email.');
  const value = token();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const saved = await optionalExec(
    `INSERT INTO "CircleInvite" (token, "circleId", "expiresAt", "createdBy", email, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [value, circleId, expires.toISOString(), access.userId, address],
  );
  if (!saved) throw httpError(500, 'We couldn\'t send that invite. Please try again.');
  await sendPushToEmail(user.rows[0].email, {
    title: 'Circle invitation',
    body: `You're invited to ${access.circle.name}.`,
    data: { circleId: String(circleId), inviteToken: value },
  }).catch(() => null);
  await recordFeature(req, 'circle_invite_sent', { circleId });
  await audit(access.userId, 'circle_invite_created', 'circle', circleId, {});
  return { token: value, expiresAt: expires.toISOString(), email: address };
}

export async function inboxCircleInvites(req) {
  const userId = userIdOf(req);
  if (userId == null) throw httpError(401, 'Sign in to continue.');
  const rows = await optionalQuery(
    `SELECT i.token, i."expiresAt", c.id AS "circleId", c.name
     FROM "CircleInvite" i
     JOIN "Circle" c ON c.id = i."circleId"
     JOIN "User" u ON u.id::text = $1
     WHERE i."revokedAt" IS NULL
       AND i."expiresAt" > NOW()
       AND lower(COALESCE(i.email, '')) = lower(u.email)
       AND COALESCE(i.status, 'pending') = 'pending'`,
    [String(userId)],
  );
  return (rows.rows || []).filter((row) => inviteUsable(row)).map((row) => ({
    token: row.token,
    expiresAt: row.expiresAt,
    circleId: row.circleId,
    name: row.name,
  }));
}

export async function rejectCircleInvite(req, inviteToken) {
  const userId = userIdOf(req);
  if (userId == null) throw httpError(401, 'Sign in to continue.');
  const result = await query(`SELECT * FROM "CircleInvite" WHERE token = $1`, [inviteToken]);
  const row = result.rows?.[0];
  if (!inviteUsable(row)) throw httpError(404, 'This invite is no longer valid');
  if (!row.email) throw httpError(400, 'A shared link is cancelled by the circle, not declined.');
  const me = await query(`SELECT email FROM "User" WHERE id::text = $1`, [String(userId)]);
  if (String(me.rows?.[0]?.email || '').toLowerCase() !== String(row.email).toLowerCase()) {
    throw httpError(403, 'This invite was sent to a different account.');
  }
  await optionalExec(
    `UPDATE "CircleInvite" SET "revokedAt" = NOW(), status = 'rejected' WHERE token = $1`,
    [inviteToken],
  );
  return { rejected: true };
}

export async function noteCircleJoined(req, circleId, userId) {
  await recordActivity({ circleId, kind: 'member_joined', actorUserId: userId, summary: 'A new member joined' });
  await recordFeature(req, 'circle_invite_accepted', { circleId });
  await recordFeature(req, 'circle_member_joined', { circleId });
}

export async function updatePlan(req, planId, body) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'You cannot edit this plan.');
  const problem = validatePlanBody({ ...access.plan, ...body, name: body.name || access.plan.name });
  if (problem) throw httpError(400, problem);
  const previousStart = access.plan.startsAt ? new Date(access.plan.startsAt).toISOString() : null;
  const previousLocation = access.plan.location || '';
  if (body.circleId && body.circleId !== access.plan.circleId) {
    await attachPlanToCircle(req, planId, String(body.circleId), access.userId);
  }
  await applyPlanColumns(planId, {
    kind: body.kind || access.plan.kind,
    circleId: body.circleId !== undefined ? body.circleId : access.plan.circleId,
    activityType: body.activityType !== undefined ? body.activityType : access.plan.activityType,
    eventId: body.eventId !== undefined ? body.eventId : access.plan.eventId,
    location: body.location !== undefined ? body.location : access.plan.location,
    startsAt: body.startsAt !== undefined ? body.startsAt : access.plan.startsAt,
    lifecycle: body.lifecycle || access.plan.lifecycle || access.plan.status,
    perPerson: body.perPerson !== undefined ? body.perPerson : access.plan.perPerson,
    budgetMin: body.budgetMin !== undefined ? body.budgetMin : access.plan.budgetMin,
    budgetMax: body.budgetMax !== undefined ? body.budgetMax : access.plan.budgetMax,
    notes: body.notes !== undefined ? body.notes : access.plan.notes,
  });
  if (body.name) await query(`UPDATE "Plan" SET name = $2 WHERE id = $1`, [planId, String(body.name).trim().slice(0, 120)]);
  const nextStart = body.startsAt ? new Date(body.startsAt).toISOString() : previousStart;
  const nextLocation = body.location != null ? String(body.location) : previousLocation;
  if ((body.startsAt && nextStart !== previousStart) || (body.location != null && nextLocation !== previousLocation)) {
    await optionalExec(`UPDATE "Plan" SET "reminderSentAt" = NULL WHERE id = $1`, [planId]);
    await notifyPlanMembers(planId, access.userId, {
      title: access.plan.name || 'Plan updated',
      body: 'The date or location changed.',
      data: { planId: String(planId) },
    });
  }
  return getPlan(req, planId);
}

export async function transitionPlan(req, planId, body) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'You cannot change this plan.');
  const next = String(body.lifecycle || body.status || '');
  if (!canTransition(access.plan.lifecycle || access.plan.status, next, access.plan.kind || 'group')) {
    throw httpError(400, 'That status change is not allowed.');
  }
  const lifecycle = normalizeLifecycle(next);
  if (body.optionId && lifecycle === 'confirmed') {
    const option = await query(`SELECT * FROM "PlanOption" WHERE id = $1 AND "planId" = $2`, [String(body.optionId), planId]);
    const row = option.rows?.[0];
    if (row?.label) await optionalExec(`UPDATE "Plan" SET location = COALESCE(location, $2) WHERE id = $1`, [planId, String(row.label).slice(0, 160)]);
    if (row?.proposedDate) {
      await optionalExec(`UPDATE "Plan" SET "startsAt" = COALESCE("startsAt", $2) WHERE id = $1`, [planId, row.proposedDate]);
    }
  }
  await optionalExec(`UPDATE "Plan" SET lifecycle = $2, status = $3 WHERE id = $1`, [
    planId,
    lifecycle,
    lifecycle === 'cancelled' ? 'cancelled' : 'open',
  ]);
  const labels = {
    confirmed: ['Plan confirmed', 'The plan is confirmed. Tickets are still bought separately.'],
    upcoming: ['Plan coming up', 'The plan is now upcoming.'],
    in_progress: ['Plan started', 'The plan is in progress.'],
    completed: ['Plan completed', 'The plan is complete. Add a memory if you want.'],
    cancelled: ['Plan cancelled', 'This plan was cancelled.'],
  };
  if (labels[lifecycle]) {
    await notifyPlanMembers(planId, access.userId, {
      title: labels[lifecycle][0],
      body: labels[lifecycle][1],
      data: { planId: String(planId) },
    });
    await recordActivity({
      circleId: access.plan.circleId,
      planId,
      kind: lifecycle === 'completed' ? 'experience_completed' : lifecycle === 'confirmed' ? 'plan_confirmed' : 'plan_cancelled',
      actorUserId: access.userId,
      summary: labels[lifecycle][1],
    });
  }
  if (lifecycle === 'confirmed') await recordFeature(req, 'plan_confirmed', { planId });
  if (lifecycle === 'completed') await recordFeature(req, 'plan_completed', { planId });
  await audit(access.userId, 'plan_transition', 'plan', planId, { lifecycle });
  return getPlan(req, planId);
}

export async function convertPlan(req, planId) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'You cannot change this plan.');
  await optionalExec(`UPDATE "Plan" SET kind = 'group', lifecycle = CASE WHEN lifecycle = 'draft' THEN 'voting' ELSE lifecycle END WHERE id = $1`, [planId]);
  await recordFeature(req, 'plan_created', { planId, kind: 'group' });
  return getPlan(req, planId);
}

export async function createPoll(req, planId, body) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'You cannot add a poll.');
  const question = String(body.question || '').trim();
  if (!question) throw httpError(400, 'Ask a question for the poll.');
  const kind = ['date', 'location', 'activity', 'event', 'custom'].includes(body.kind) ? body.kind : 'custom';
  const options = Array.isArray(body.options) ? body.options.filter((option) => option && (option.label || option.proposedDate || option.eventId)) : [];
  if (options.length < 2) throw httpError(400, 'Add at least two choices.');
  const closesAt = body.closesAt ? new Date(body.closesAt) : null;
  if (body.closesAt && Number.isNaN(closesAt.getTime())) throw httpError(400, 'That deadline is not a valid date.');
  const pollId = createId();
  await query(
    `INSERT INTO "PlanPoll" (id, "planId", question, kind, "closesAt", "createdBy") VALUES ($1, $2, $3, $4, $5, $6)`,
    [pollId, planId, question.slice(0, 140), kind, closesAt ? closesAt.toISOString() : null, access.userId],
  );
  for (const option of options.slice(0, 8)) {
    await query(
      `INSERT INTO "PlanOption" (id, "planId", "eventId", "proposedDate", label, "pollId", kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        createId(),
        planId,
        option.eventId ? String(option.eventId) : null,
        option.proposedDate || null,
        option.label ? String(option.label).slice(0, 120) : null,
        pollId,
        kind,
      ],
    );
  }
  await recordActivity({ circleId: access.plan.circleId, planId, kind: 'poll_started', actorUserId: access.userId, summary: 'A poll started' });
  await notifyPlanMembers(planId, access.userId, {
    title: access.plan.name || 'New poll',
    body: question.slice(0, 120),
    data: { planId: String(planId) },
  });
  await recordFeature(req, 'plan_poll_created', { planId });
  return getPlan(req, planId);
}

export async function castPollVote(req, planId, pollId, optionId) {
  const access = await planAccess(req, planId);
  const poll = await query(`SELECT * FROM "PlanPoll" WHERE id = $1 AND "planId" = $2`, [pollId, planId]);
  const row = poll.rows?.[0];
  if (!row) throw httpError(404, 'Poll not found');
  if (row.closedAt) throw httpError(400, 'This poll is closed.');
  if (row.closesAt && new Date(row.closesAt).getTime() < Date.now()) throw httpError(400, 'This poll deadline has passed.');
  const options = await query(`SELECT id FROM "PlanOption" WHERE "pollId" = $1 AND "planId" = $2`, [pollId, planId]);
  const ballot = singleChoiceBallot((options.rows || []).map((option) => option.id), optionId);
  if (ballot.error) throw httpError(400, ballot.error);
  const pool = getPool();
  if (!pool) throw httpError(500, 'Something went wrong. Please try again.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ballot.deleteOptionIds.length) {
      await client.query(
        `DELETE FROM "PlanVote" WHERE "userId" = $1 AND "optionId" = ANY($2::text[])`,
        [access.userId, ballot.deleteOptionIds],
      );
    }
    await client.query(
      `INSERT INTO "PlanVote" (id, "optionId", "userId", choice) VALUES ($1, $2, $3, 'yes')
       ON CONFLICT ("optionId", "userId") DO UPDATE SET choice = 'yes'`,
      [createId(), ballot.optionId, access.userId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await recordFeature(req, 'plan_vote_submitted', { planId });
  return getPlan(req, planId);
}

export async function closePoll(req, planId, pollId) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'You cannot close this poll.');
  const updated = await query(
    `UPDATE "PlanPoll" SET "closedAt" = NOW() WHERE id = $1 AND "planId" = $2 AND "closedAt" IS NULL`,
    [pollId, planId],
  );
  if (!updated.rowCount) {
    const exists = await query(`SELECT id FROM "PlanPoll" WHERE id = $1 AND "planId" = $2`, [pollId, planId]);
    if (!exists.rows?.length) throw httpError(404, 'Poll not found');
  }
  await recordActivity({ circleId: access.plan.circleId, planId, kind: 'poll_completed', actorUserId: access.userId, summary: 'A poll closed' });
  await notifyPlanMembers(planId, access.userId, {
    title: access.plan.name || 'Poll closed',
    body: 'Poll results are ready.',
    data: { planId: String(planId) },
  });
  return getPlan(req, planId);
}

export async function addBudgetItem(req, planId, body) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'You cannot edit the budget.');
  const problem = validateBudgetItem(body);
  if (problem) throw httpError(400, problem);
  await query(
    `INSERT INTO "PlanBudgetItem" (id, "planId", category, label, amount, "createdBy") VALUES ($1, $2, $3, $4, $5, $6)`,
    [createId(), planId, String(body.category || 'custom'), body.label ? String(body.label).slice(0, 80) : null, Math.round(Number(body.amount) || 0), access.userId],
  );
  return getPlan(req, planId);
}

export async function deleteBudgetItem(req, planId, itemId) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'You cannot edit the budget.');
  await query(`DELETE FROM "PlanBudgetItem" WHERE id = $1 AND "planId" = $2`, [itemId, planId]);
  return getPlan(req, planId);
}

export async function addPlanComment(req, planId, body) {
  const access = await planAccess(req, planId);
  const text = String(body.body || '').trim();
  if (text.length < 1) throw httpError(400, 'Write a comment first.');
  if (text.length > 500) throw httpError(400, 'Keep the comment under 500 characters.');
  const kind = body.kind === 'announcement' && access.isOwner ? 'announcement' : 'comment';
  await query(
    `INSERT INTO "PlanComment" (id, "planId", "userId", body, kind) VALUES ($1, $2, $3, $4, $5)`,
    [createId(), planId, access.userId, text, kind],
  );
  return getPlan(req, planId);
}

export async function saveMemory(req, planId, body) {
  const access = await planAccess(req, planId);
  const plan = access.plan;
  if (!canAddMemory(plan.lifecycle || plan.status)) throw httpError(400, 'Memories open after the plan is completed.');
  const rating = body.rating == null || body.rating === '' ? null : Number(body.rating);
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw httpError(400, 'Rate from 1 to 5.');
  const note = body.note != null ? String(body.note).slice(0, 500) : null;
  const id = createId();
  await query(
    `INSERT INTO "ExperienceMemory" (id, "planId", "circleId", "userId", title, note, rating)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("planId", "userId") DO UPDATE SET note = EXCLUDED.note, rating = EXCLUDED.rating, title = EXCLUDED.title`,
    [id, planId, plan.circleId || null, access.userId, plan.name, note, rating],
  );
  await recordActivity({
    circleId: plan.circleId,
    planId,
    kind: 'experience_completed',
    actorUserId: access.userId,
    summary: 'A memory was added',
  });
  await recordFeature(req, 'experience_memory_added', { planId });
  return getPlan(req, planId);
}

export async function addMemoryPhoto(req, planId, memoryId, imageUrl) {
  const access = await planAccess(req, planId);
  if (!canAddMemory(access.plan.lifecycle || access.plan.status)) throw httpError(400, 'Memories open after the plan is completed.');
  const photo = httpsUrl(imageUrl);
  if (photo.error || !photo.url) throw httpError(400, photo.error || 'Upload a photo first.');
  const memory = await query(
    `SELECT id FROM "ExperienceMemory" WHERE id = $1 AND "planId" = $2 AND "userId" = $3`,
    [memoryId, planId, access.userId],
  );
  if (!memory.rows?.length) throw httpError(404, 'Add your memory before uploading a photo.');
  await query(
    `INSERT INTO "ExperienceMedia" (id, "memoryId", "userId", "imageUrl") VALUES ($1, $2, $3, $4)
     ON CONFLICT ("memoryId", "imageUrl") DO NOTHING`,
    [createId(), memoryId, access.userId, photo.url],
  );
  await recordActivity({
    circleId: access.plan.circleId,
    planId,
    kind: 'photos_added',
    actorUserId: access.userId,
    summary: 'A photo was added',
  });
  return getPlan(req, planId);
}

export async function deleteMemoryPhoto(req, planId, memoryId, mediaId) {
  const access = await planAccess(req, planId);
  await query(
    `DELETE FROM "ExperienceMedia" WHERE id = $1 AND "memoryId" = $2 AND "userId" = $3`,
    [mediaId, memoryId, access.userId],
  );
  return getPlan(req, planId);
}

export async function invitePlanByEmail(req, planId, email) {
  const access = await planEditors(req, planId);
  if (!access.canManage) throw httpError(403, 'Only the plan owner can invite.');
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw httpError(400, 'Enter the email on their Gatewav account.');
  const user = await query(`SELECT id, email FROM "User" WHERE lower(email) = $1 LIMIT 1`, [address]);
  if (!user.rows?.length) throw httpError(404, 'No Gatewav account uses that email.');
  if (access.plan.kind === 'personal') {
    await optionalExec(`UPDATE "Plan" SET kind = 'group' WHERE id = $1`, [planId]);
  }
  await query(
    `INSERT INTO "PlanMember" (id, "planId", "userId", email, role, rsvp)
     SELECT $1, $2, $3, $4, 'member', 'invited'
     WHERE NOT EXISTS (SELECT 1 FROM "PlanMember" WHERE "planId" = $2 AND "userId" = $3)`,
    [createId(), planId, user.rows[0].id, address],
  );
  await sendPushToEmail(user.rows[0].email, {
    title: 'Plan invitation',
    body: `You're invited to ${access.plan.name}.`,
    data: { planId: String(planId) },
  }).catch(() => null);
  await recordFeature(req, 'plan_shared', { planId });
  return getPlan(req, planId);
}

export async function noteRsvp(req, plan, userId, rsvp) {
  await recordActivity({
    circleId: plan.circleId,
    planId: plan.id,
    kind: 'rsvp_changed',
    actorUserId: userId,
    summary: `RSVP updated to ${displayRsvp(rsvp)}`,
  });
  await recordFeature(req, 'plan_rsvp_updated', { planId: plan.id });
  if (plan.circleId) {
    await notifyCircleMembers(plan.circleId, userId, {
      title: plan.name || 'Plan RSVP',
      body: `Someone is now ${displayRsvp(rsvp).toLowerCase()}.`,
      data: { planId: String(plan.id) },
    });
  }
}

export async function plansCircleMetrics(req) {
  if (!isSuper(req)) throw httpError(403, 'Only a super admin can view these metrics.');
  const [circles, plans, invites, orders, analytics, repeatPlans, retention] = await Promise.all([
    optionalQuery(
      `SELECT
         COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '7 days')::int AS created_7d,
         COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days')::int AS created_30d,
         COUNT(*)::int AS total
       FROM "Circle"`,
    ),
    optionalQuery(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(lifecycle, status, 'voting') IN ('confirmed', 'upcoming', 'in_progress', 'completed'))::int AS confirmed,
         COUNT(*) FILTER (WHERE COALESCE(lifecycle, status, 'voting') NOT IN ('draft', 'cancelled'))::int AS active,
         COALESCE(AVG(members)::int, 0) AS avg_members
       FROM (
         SELECT p.id, p.lifecycle, p.status, COUNT(m.id)::int AS members
         FROM "Plan" p
         LEFT JOIN "PlanMember" m ON m."planId" = p.id
         GROUP BY p.id
       ) counted`,
    ),
    optionalQuery(
      `SELECT
         (SELECT COUNT(*)::int FROM "CircleInvite") AS circle_invites,
         (SELECT COUNT(*)::int FROM "CircleMembership" WHERE role <> 'owner') AS circle_joins,
         (SELECT COUNT(*)::int FROM "PlanInvite") AS plan_invites,
         (SELECT COUNT(*)::int FROM "PlanMember" WHERE role <> 'owner') AS plan_joins`,
    ),
    optionalQuery(
      `SELECT COUNT(DISTINCT o.id)::int AS conversions
       FROM "Order" o
       JOIN "Plan" p ON p."eventId" IS NOT NULL AND p."eventId"::text = o."eventId"::text
       JOIN "PlanMember" m ON m."planId" = p.id AND m."userId"::text = o."userId"::text
       WHERE lower(COALESCE(o.status, '')) IN ('paid', 'completed', 'success')`,
    ),
    optionalQuery(
      `SELECT name, COUNT(*)::int AS count
       FROM "AnalyticsEvent"
       WHERE name IN ('plan_event_opened', 'plan_ticket_checkout_started', 'plan_ticket_purchase_confirmed', 'circle_created', 'plan_created')
       GROUP BY name`,
    ),
    optionalQuery(
      `SELECT COUNT(*)::int AS people
       FROM (
         SELECT "ownerUserId" FROM "Plan" GROUP BY "ownerUserId" HAVING COUNT(*) > 1
       ) repeated`,
    ),
    optionalQuery(
      `SELECT
         COUNT(*) FILTER (WHERE returned_7)::int AS retained_7d,
         COUNT(*) FILTER (WHERE returned_30)::int AS retained_30d,
         COUNT(*)::int AS feature_users
       FROM (
         SELECT u.id,
           EXISTS (
             SELECT 1 FROM "AnalyticsEvent" a
             WHERE a."userId"::text = u.id::text
               AND a."createdAt" > u.first_at + INTERVAL '1 day'
               AND a."createdAt" < u.first_at + INTERVAL '8 days'
           ) AS returned_7,
           EXISTS (
             SELECT 1 FROM "AnalyticsEvent" a
             WHERE a."userId"::text = u.id::text
               AND a."createdAt" > u.first_at + INTERVAL '1 day'
               AND a."createdAt" < u.first_at + INTERVAL '31 days'
           ) AS returned_30
         FROM (
           SELECT "userId"::text AS id, MIN("createdAt") AS first_at
           FROM "AnalyticsEvent"
           WHERE name IN ('circle_created', 'plan_created', 'circle_member_joined', 'plan_rsvp_updated')
             AND "userId" IS NOT NULL
           GROUP BY "userId"
         ) u
       ) cohort`,
    ),
  ]);
  const circleRow = circles.rows?.[0] || {};
  const planRow = plans.rows?.[0] || {};
  const inviteRow = invites.rows?.[0] || {};
  const activated = await optionalQuery(
    `SELECT COUNT(*)::int AS count FROM "Circle" c
     WHERE (SELECT COUNT(*) FROM "CircleMembership" m WHERE m."circleId" = c.id AND m.status = 'active') > 1
        OR EXISTS (SELECT 1 FROM "Plan" p WHERE p."circleId" = c.id)`,
  );
  const names = {};
  for (const row of analytics.rows || []) names[row.name] = row.count;
  const circleInvites = Number(inviteRow.circle_invites || 0);
  const planInvites = Number(inviteRow.plan_invites || 0);
  return {
    circleCreation7d: Number(circleRow.created_7d || 0),
    circleCreation30d: Number(circleRow.created_30d || 0),
    circles: Number(circleRow.total || 0),
    circleActivation: Number(activated.rows?.[0]?.count || 0),
    averageParticipants: Number(planRow.avg_members || 0),
    planConfirmationRate: Number(planRow.total || 0) ? Number(planRow.confirmed || 0) / Number(planRow.total || 1) : 0,
    activePlans: Number(planRow.active || 0),
    inviteAcceptanceRate: (circleInvites + planInvites)
      ? (Number(inviteRow.circle_joins || 0) + Number(inviteRow.plan_joins || 0)) / (circleInvites + planInvites)
      : 0,
    eventViewsFromPlans: Number(names.plan_event_opened || 0),
    ticketCheckoutsFromPlans: Number(names.plan_ticket_checkout_started || 0),
    ticketPurchasesFromPlans: Number(names.plan_ticket_purchase_confirmed || 0) || Number(orders.rows?.[0]?.conversions || 0),
    repeatPlanCreators: Number(repeatPlans.rows?.[0]?.people || 0),
    retention7d: Number(retention.rows?.[0]?.retained_7d || 0),
    retention30d: Number(retention.rows?.[0]?.retained_30d || 0),
    featureUsers: Number(retention.rows?.[0]?.feature_users || 0),
  };
}
