import { createId, getPool, query } from '../../shared/config/db.js';
import { audit, httpError, isSuper } from './access.js';

const MESSAGE_LIMIT = 300;

function missingRelation(err) {
  return err?.code === '42P01' || err?.code === '42703';
}

function stamp(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** True after the event's last local day. A missing event counts as ended. */
export function eventHasEnded(event, now = new Date()) {
  if (!event) return true;
  const ref = (event.isRecurring && event.recurrenceUntil) || event.endDate || event.date || null;
  if (!ref) return false;
  const end = new Date(ref);
  if (Number.isNaN(end.getTime())) return false;
  end.setHours(23, 59, 59, 999);
  return end.getTime() < now.getTime();
}

async function loadEventRow(eventId) {
  const result = await query(
    `SELECT id, title, date, "endDate", "isRecurring", "recurrenceUntil", "createdBy"
     FROM "Event" WHERE id::text = $1 LIMIT 1`,
    [String(eventId)],
  );
  return result.rows?.[0] || null;
}

async function access(req, circleId) {
  const community = await import('./community.js');
  return community.circleMember(req, circleId);
}

async function hardDeleteChat(chatId) {
  const pool = getPool();
  if (!pool) throw httpError(500, 'Something went wrong. Please try again.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM "CircleChatMessage" WHERE "chatId" = $1`, [chatId]);
    await client.query(`DELETE FROM "CircleChatRead" WHERE "chatId" = $1`, [chatId]);
    await client.query(`DELETE FROM "CircleChat" WHERE id = $1`, [chatId]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Removes an event chat after that event ends, and a plan chat if the plan is gone. Membership stays. */
export async function purgeEndedCircleChats(circleId) {
  let rows = [];
  try {
    const result = await query(
      `SELECT c.id, c."eventId", c."planId",
              e.id AS "eventRowId", e.date, e."endDate", e."isRecurring", e."recurrenceUntil",
              p.id AS "planRowId"
       FROM "CircleChat" c
       LEFT JOIN "Event" e ON e.id::text = c."eventId"
       LEFT JOIN "Plan" p ON p.id = c."planId"
       WHERE c."circleId" = $1`,
      [circleId],
    );
    rows = result.rows || [];
  } catch (err) {
    if (missingRelation(err)) return false;
    throw err;
  }
  let removed = false;
  for (const row of rows) {
    const planChat = Boolean(row.planId) && !row.eventId;
    if (planChat) {
      if (!row.planRowId) {
        await hardDeleteChat(row.id);
        removed = true;
      }
      continue;
    }
    if (!row.eventRowId || eventHasEnded(row)) {
      await hardDeleteChat(row.id);
      removed = true;
    }
  }
  return removed;
}

async function savedByUser(userId, eventId) {
  const result = await query(
    `SELECT 1 FROM "Favorite" WHERE "userId"::text = $1 AND "eventId"::text = $2 LIMIT 1`,
    [String(userId), String(eventId)],
  );
  return Boolean(result.rows?.length);
}

async function loadPlanRow(planId) {
  const result = await query(`SELECT id, name FROM "Plan" WHERE id = $1`, [planId]);
  return result.rows?.[0] || null;
}

export async function circleChatState(circle, isOwner, userId) {
  const empty = { open: false, eventEnded: false, canStart: false, startKind: null, canLink: Boolean(isOwner) };
  try {
    await purgeEndedCircleChats(circle.id);
    const event = circle.eventId ? await loadEventRow(String(circle.eventId)) : null;
    const eventEnded = Boolean(circle.eventId) && eventHasEnded(event);
    const plan = circle.planId ? await loadPlanRow(circle.planId) : null;
    const chat = await query(`SELECT id FROM "CircleChat" WHERE "circleId" = $1`, [circle.id]);
    const open = Boolean(chat.rows?.length);
    const saved = isOwner && circle.eventId ? await savedByUser(userId, circle.eventId) : false;
    const eventOk = Boolean(isOwner && circle.eventId && !eventEnded && saved);
    const planOk = Boolean(isOwner && plan);
    const startKind = !open && eventOk ? 'event' : !open && planOk ? 'plan' : null;
    return {
      open,
      eventEnded,
      canStart: Boolean(startKind),
      startKind,
      canLink: Boolean(isOwner && !open),
    };
  } catch (err) {
    if (missingRelation(err)) return empty;
    throw err;
  }
}

/** Opens the first chat when a circle is created for an event that has not ended. */
export async function openEventChat(circleId, eventId, userId) {
  const event = await loadEventRow(eventId);
  if (!event || eventHasEnded(event)) return null;
  const id = createId();
  await query(
    `INSERT INTO "CircleChat" (id, "circleId", "eventId", "planId", "startedBy")
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT ("circleId") DO NOTHING`,
    [id, circleId, String(event.id), userId],
  );
  return id;
}

/** Opens a chat for a linked plan. It stays until the plan is deleted. */
export async function openPlanChat(circleId, planId, userId) {
  const plan = await loadPlanRow(planId);
  if (!plan) return null;
  const id = createId();
  const inserted = await query(
    `INSERT INTO "CircleChat" (id, "circleId", "eventId", "planId", "startedBy")
     VALUES ($1, $2, NULL, $3, $4)
     ON CONFLICT ("circleId") DO NOTHING
     RETURNING id`,
    [id, circleId, String(plan.id), userId],
  );
  return inserted.rows?.[0]?.id || null;
}

async function activeChat(circleId) {
  const result = await query(
    `SELECT c.*, e.title AS "eventTitle", p.name AS "planName"
     FROM "CircleChat" c
     LEFT JOIN "Event" e ON e.id::text = c."eventId"
     LEFT JOIN "Plan" p ON p.id = c."planId"
     WHERE c."circleId" = $1`,
    [circleId],
  );
  return result.rows?.[0] || null;
}

function preview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

export async function getCircleChat(req, circleId) {
  const { circle, userId, isOwner } = await access(req, circleId);
  const removed = await purgeEndedCircleChats(circleId);
  const state = await circleChatState({ ...circle, id: circleId }, isOwner, userId);
  const chat = state.open ? await activeChat(circleId) : null;
  if (!chat) {
    const event = circle.eventId ? await loadEventRow(String(circle.eventId)) : null;
    const plan = circle.planId ? await loadPlanRow(circle.planId) : null;
    return {
      open: false,
      removed,
      eventEnded: state.eventEnded,
      canStart: state.canStart,
      startKind: state.startKind,
      eventId: circle.eventId || null,
      eventTitle: event?.title || null,
      planId: circle.planId || null,
      planName: plan?.name || null,
      circleName: circle.name,
      messages: [],
    };
  }
  const messages = await query(
    `SELECT m.id, m."senderUserId", m.body, m."replyToId", m."createdAt",
            COALESCE(NULLIF(BTRIM(u.name), ''), 'Member') AS "senderName",
            parent.body AS "replyToBody",
            COALESCE(NULLIF(BTRIM(parentUser.name), ''), 'Member') AS "replyToSenderName"
     FROM "CircleChatMessage" m
     LEFT JOIN "User" u ON u.id::text = m."senderUserId"::text
     LEFT JOIN "CircleChatMessage" parent ON parent.id = m."replyToId" AND parent."chatId" = m."chatId"
     LEFT JOIN "User" parentUser ON parentUser.id::text = parent."senderUserId"::text
     WHERE m."chatId" = $1
       AND NOT EXISTS (
         SELECT 1 FROM "UserBlock" ub
         WHERE (ub."blockerUserId"::text = $2 AND ub."blockedUserId"::text = m."senderUserId"::text)
            OR (ub."blockedUserId"::text = $2 AND ub."blockerUserId"::text = m."senderUserId"::text)
       )
     ORDER BY m."createdAt" DESC
     LIMIT $3`,
    [chat.id, String(userId), MESSAGE_LIMIT],
  );
  const others = await query(
    `SELECT r."lastReadAt"
     FROM "CircleMembership" mem
     LEFT JOIN "CircleChatRead" r
       ON r."chatId" = $2 AND r."userId"::text = mem."userId"::text
     WHERE mem."circleId" = $1 AND mem.status = 'active' AND mem."userId"::text <> $3`,
    [circleId, chat.id, String(userId)],
  );
  const readers = others.rows || [];
  const ordered = (messages.rows || []).slice().reverse();
  return {
    open: true,
    removed: false,
    eventEnded: false,
    canStart: false,
    startKind: null,
    chatId: chat.id,
    eventId: chat.eventId,
    eventTitle: chat.eventTitle || null,
    planId: chat.planId || null,
    planName: chat.planName || null,
    circleName: circle.name,
    messages: ordered.map((row) => {
      const mine = Number(row.senderUserId) === Number(userId);
      const seen = mine && readers.length > 0 && readers.every((reader) => stamp(reader.lastReadAt) >= stamp(row.createdAt));
      return {
        id: row.id,
        senderId: Number(row.senderUserId),
        senderName: row.senderName,
        body: row.body,
        createdAt: row.createdAt,
        replyToId: row.replyToId || null,
        replyToBody: row.replyToId ? preview(row.replyToBody) : null,
        replyToSenderName: row.replyToId && row.replyToBody ? (row.replyToSenderName || 'Member') : null,
        mine,
        receipt: mine ? (seen ? 'seen' : 'sent') : null,
      };
    }),
  };
}

export async function linkCircleEvent(req, circleId, eventId) {
  const { circle, userId, isOwner } = await access(req, circleId);
  if (!isOwner) throw httpError(403, 'Only the circle owner can link an event.');
  const id = String(eventId || '').trim();
  if (!id) throw httpError(400, 'Choose a saved event.');
  await purgeEndedCircleChats(circleId);
  const event = await loadEventRow(id);
  if (!event) throw httpError(404, 'Event not found');
  if (eventHasEnded(event)) throw httpError(400, 'That event has ended. Link a saved event that is still coming up.');
  if (!isSuper(req) && !(await savedByUser(userId, event.id))) {
    throw httpError(400, 'Save the event first, then link it to this circle.');
  }
  const open = await query(`SELECT "eventId" FROM "CircleChat" WHERE "circleId" = $1`, [circleId]);
  const current = open.rows?.[0];
  if (current && String(current.eventId) !== String(event.id)) {
    throw httpError(409, 'This circle already has a chat. It is removed when that event ends.');
  }
  let official = Boolean(circle.official);
  if (String(circle.eventId || '') !== String(event.id)) {
    const ownsEvent = Number(event.createdBy) === Number(userId) || isSuper(req);
    if (!ownsEvent) official = false;
  }
  await query(`UPDATE "Circle" SET "eventId" = $2, official = $3 WHERE id = $1`, [circleId, String(event.id), official]);
  const community = await import('./community.js');
  return community.getCircle(req, circleId);
}

export async function startCircleChat(req, circleId) {
  const { userId, isOwner } = await access(req, circleId);
  if (!isOwner) throw httpError(403, 'Only the circle owner can start the chat.');
  await purgeEndedCircleChats(circleId);
  const fresh = await query(`SELECT * FROM "Circle" WHERE id = $1`, [circleId]);
  const circle = fresh.rows?.[0];
  const existing = await query(`SELECT id FROM "CircleChat" WHERE "circleId" = $1`, [circleId]);
  if (!existing.rows?.length) {
    const event = circle?.eventId ? await loadEventRow(circle.eventId) : null;
    const eventLive = Boolean(event && !eventHasEnded(event));
    const eventReady = eventLive && (isSuper(req) || await savedByUser(userId, circle.eventId));
    if (eventReady) {
      await query(
        `INSERT INTO "CircleChat" (id, "circleId", "eventId", "planId", "startedBy")
         VALUES ($1, $2, $3, NULL, $4)
         ON CONFLICT ("circleId") DO NOTHING`,
        [createId(), circleId, String(event.id), userId],
      );
      await audit(userId, 'circle_chat_started', 'circle', circleId, { eventId: String(event.id) });
    } else if (circle?.planId) {
      const plan = await loadPlanRow(circle.planId);
      if (!plan) throw httpError(400, 'That plan is no longer available.');
      await query(
        `INSERT INTO "CircleChat" (id, "circleId", "eventId", "planId", "startedBy")
         VALUES ($1, $2, NULL, $3, $4)
         ON CONFLICT ("circleId") DO NOTHING`,
        [createId(), circleId, String(plan.id), userId],
      );
      await audit(userId, 'circle_chat_started', 'circle', circleId, { planId: String(plan.id) });
    } else if (eventLive) {
      throw httpError(400, 'Save this event, link it to the circle, then start the chat.');
    } else if (circle?.eventId) {
      throw httpError(400, 'That event has ended. Link another saved event, or a plan, then start a new chat.');
    } else {
      throw httpError(400, 'Link a plan or a saved event before starting a chat.');
    }
  }
  return getCircleChat(req, circleId);
}

async function requireOpenChat(req, circleId) {
  const member = await access(req, circleId);
  const removed = await purgeEndedCircleChats(circleId);
  const chat = await activeChat(circleId);
  if (!chat) {
    throw httpError(400, removed
      ? 'This chat was removed. Everyone stays in the circle.'
      : 'Start a chat for the linked plan or event before sending a message.');
  }
  return { ...member, chat };
}

export async function sendCircleMessage(req, circleId, body) {
  const { userId, chat, circle } = await requireOpenChat(req, circleId);
  const text = String(body?.body || '').replace(/\u0000/g, '').trim();
  if (!text) throw httpError(400, 'Write a message first.');
  if (text.length > 2000) throw httpError(400, 'That message is too long.');
  let replyToId = body?.replyToId ? String(body.replyToId) : null;
  if (replyToId) {
    const reply = await query(
      `SELECT id FROM "CircleChatMessage" WHERE id = $1 AND "chatId" = $2`,
      [replyToId, chat.id],
    );
    if (!reply.rows?.length) replyToId = null;
  }
  await query(
    `INSERT INTO "CircleChatMessage" (id, "chatId", "senderUserId", body, "replyToId")
     VALUES ($1, $2, $3, $4, $5)`,
    [createId(), chat.id, userId, text, replyToId],
  );
  const community = await import('./community.js');
  const person = await query(`SELECT name FROM "User" WHERE id::text = $1`, [String(userId)]).catch(() => ({ rows: [] }));
  const name = String(person.rows?.[0]?.name || '').trim() || 'Someone';
  await community.notifyCircleMembers(circleId, userId, {
    title: circle.name || 'Private circle',
    body: `${name}: ${preview(text) || 'New message'}`,
    data: { circleId: String(circleId), chat: true },
  });
  return getCircleChat(req, circleId);
}

export async function markCircleChatRead(req, circleId, lastCreatedAt) {
  const { userId, chat } = await requireOpenChat(req, circleId);
  const stampAt = lastCreatedAt ? new Date(lastCreatedAt) : new Date();
  if (Number.isNaN(stampAt.getTime())) throw httpError(400, 'That read time is not valid.');
  await query(
    `INSERT INTO "CircleChatRead" ("chatId", "userId", "lastReadAt")
     VALUES ($1, $2, $3)
     ON CONFLICT ("chatId", "userId")
     DO UPDATE SET "lastReadAt" = GREATEST("CircleChatRead"."lastReadAt", EXCLUDED."lastReadAt")`,
    [chat.id, userId, stampAt.toISOString()],
  );
  return { read: true };
}

export async function deleteCircleMessage(req, circleId, messageId) {
  const { userId, chat } = await requireOpenChat(req, circleId);
  const removed = await query(
    `DELETE FROM "CircleChatMessage"
     WHERE id = $1 AND "chatId" = $2 AND "senderUserId"::text = $3`,
    [String(messageId), chat.id, String(userId)],
  );
  if (!removed.rowCount) throw httpError(404, 'That message is already gone.');
  return getCircleChat(req, circleId);
}
