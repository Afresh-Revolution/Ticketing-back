import bcrypt from 'bcryptjs';
import { getPool } from '../../shared/config/db.js';
import { userPageModel } from './userPage/userPage.model.js';

/** GET /api/user/orders - paid tickets for the signed-in user (by account id or purchase email) */
export async function getMyOrders(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const profile = await userPageModel.getProfile(userId);
    const userEmail = profile?.email ?? req.user?.email ?? '';
    if (!userEmail) {
      return res.status(400).json({ error: 'Account email not found' });
    }
    await userPageModel.linkGuestOrdersToUser(userId, userEmail);
    const orders = await userPageModel.getMyOrders(userId, userEmail);
    const list = orders.map((o) => ({
      id: String(o.id),
      eventId: o.eventId != null ? String(o.eventId) : null,
      fullName: o.fullName,
      email: o.email,
      totalAmount: o.totalAmount,
      status: o.status,
      createdAt: o.createdAt,
      ticketCode: o.ticketCode ?? null,
      event: o.event
        ? {
            title: o.event.title,
            description: o.event.description,
            date: o.event.date,
            endDate: o.event.endDate ?? null,
            endTime: o.event.endTime ?? null,
            venue: o.event.venue ?? o.event.location ?? '',
            location: o.event.location ?? null,
            imageUrl: o.event.imageUrl,
            category: o.event.category,
            startTime: o.event.startTime,
            eventType: o.event.eventType ?? 'in-person',
            isLive: Boolean(o.event.isLive),
          }
        : null,
      items: (o.items || []).map((i) => ({
        ticketName: i.ticketName ?? i.name ?? 'Ticket',
        quantity: Number(i.quantity) || 0,
        price: Number(i.price) || 0,
        deliveryMode: i.deliveryMode ?? 'in_person',
      })),
    }));
    return res.json(list);
  } catch (err) {
    console.error('[user.controller] getMyOrders:', err?.message || err);
    return res.json([]);
  }
}

/**
 * DELETE /api/user/orders/:orderId
 * Hard-deletes the order and its line items from the DB.
 * Only the signed-in owner (by userId or matching purchase email) may delete.
 */
export async function deleteMyOrder(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) {
      return res.status(400).json({ error: 'Order id is required' });
    }

    const profile = await userPageModel.getProfile(userId);
    const userEmail = String(profile?.email ?? req.user?.email ?? '')
      .trim()
      .toLowerCase();
    if (!userEmail) {
      return res.status(400).json({ error: 'Account email not found' });
    }

    await userPageModel.linkGuestOrdersToUser(userId, userEmail);

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const owned = await client.query(
        `SELECT id FROM "Order"
         WHERE id::text = $1
           AND (
             "userId"::text = $2
             OR LOWER(TRIM(COALESCE(email, ''))) = $3
           )
         LIMIT 1`,
        [orderId, String(userId), userEmail]
      );

      if (!owned.rows?.[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Ticket not found' });
      }

      await tryQuery(client, `DELETE FROM "OrderItem" WHERE "orderId"::text = $1`, [orderId]);
      const deleted = await client.query(`DELETE FROM "Order" WHERE id::text = $1 RETURNING id`, [
        orderId,
      ]);

      if (!deleted.rows?.[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Ticket not found' });
      }

      await client.query('COMMIT');
      return res.json({ message: 'Ticket deleted', id: orderId });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[user.controller] deleteMyOrder:', err?.message || err);
    return res.status(500).json({ error: err.message || 'Failed to delete ticket' });
  }
}

/** Run SQL that may fail on missing tables/columns — ignore those errors. */
async function tryQuery(client, text, params = []) {
  try {
    return await client.query(text, params);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/does not exist|undefined column|relation .* does not exist/i.test(msg)) {
      return null;
    }
    throw err;
  }
}

/**
 * DELETE /api/user/account
 * Body: { password: string }
 *
 * HARD DELETE only — permanently removes the User row.
 * Never soft-deletes / suspends. Related credentials and account-owned rows are removed;
 * financial order rows are unlinked (and buyer PII anonymized) so history can remain for compliance.
 */
export async function deleteAccount(req, res) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  const userId = req.userId;
  const role = req.userRole || 'user';
  const { password } = req.body || {};

  if (userId == null || userId === '' || Number(userId) === 0) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (role === 'superadmin') {
    return res.status(403).json({
      error: 'Super admin accounts cannot be deleted from this endpoint.',
    });
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'Password is required to delete your account' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let userResult;
    try {
      userResult = await client.query(
        `SELECT id, email, role, "passwordHash", "password"
         FROM "User" WHERE id = $1 FOR UPDATE`,
        [userId],
      );
    } catch {
      userResult = await client.query(
        `SELECT id, email, role, "passwordHash"
         FROM "User" WHERE id = $1 FOR UPDATE`,
        [userId],
      );
    }

    const user = userResult.rows?.[0];
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const storedHash = user.passwordHash || user.password || null;
    if (!storedHash) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'This account has no password on file. Contact support to delete it.',
      });
    }

    const valid = await bcrypt.compare(password.trim(), storedHash);
    if (!valid) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Invalid password' });
    }

    const idParam = user.id;
    const idText = String(user.id);
    const email = String(user.email || '');
    const anonEmail = `deleted+${idText}@deleted.gatewav.invalid`;

    // --- Hard-delete account-owned data / clear FK blockers (never soft-suspend) ---

    // Auth OTPs for this email
    await tryQuery(
      client,
      `DELETE FROM "VerificationCode" WHERE LOWER(email) = LOWER($1)`,
      [email],
    );

    // Cascade-owned rows (explicit hard deletes)
    await tryQuery(client, `DELETE FROM "BankAccount" WHERE "userId"::text = $1`, [idText]);
    await tryQuery(client, `DELETE FROM "Membership" WHERE "userId"::text = $1`, [idText]);
    // Withdrawal.userId is NOT NULL without ON DELETE — must hard-delete these rows
    await tryQuery(client, `DELETE FROM "Withdrawal" WHERE "userId"::text = $1`, [idText]);

    // Unlink (do not delete) content that must remain for other users / finance
    await tryQuery(
      client,
      `UPDATE "Event" SET "createdBy" = NULL WHERE "createdBy"::text = $1`,
      [idText],
    );
    await tryQuery(
      client,
      `UPDATE "WalkInSale" SET "recordedBy" = NULL WHERE "recordedBy"::text = $1`,
      [idText],
    );

    // Unlink + anonymize buyer PII on this account's orders (retain financial/ticket rows)
    await tryQuery(
      client,
      `UPDATE "Order"
       SET "userId" = NULL,
           "fullName" = 'Deleted User',
           "email" = $2,
           "phone" = NULL,
           "address" = NULL,
           "updatedAt" = NOW()
       WHERE "userId"::text = $1
          OR (LOWER(TRIM("email")) = LOWER(TRIM($3)))`,
      [idText, anonEmail, email],
    );
    await tryQuery(
      client,
      `UPDATE "Ticket" SET "userId" = NULL WHERE "userId"::text = $1`,
      [idText],
    );

    // HARD DELETE the account row — this is the only account-deletion path
    const deleted = await client.query(
      `DELETE FROM "User" WHERE id = $1 RETURNING id, email`,
      [idParam],
    );
    if (!deleted.rows?.length) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Failed to hard-delete account' });
    }

    // Confirm the row is gone (no soft-delete residue)
    const stillThere = await client.query(`SELECT id FROM "User" WHERE id = $1`, [idParam]);
    if (stillThere.rows?.length) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Account hard-delete verification failed' });
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Your account has been permanently deleted.',
      deleted: true,
      hardDelete: true,
      id: deleted.rows[0].id,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('[user.controller] deleteAccount:', err?.message || err);
    const msg = String(err?.message || '');
    if (/foreign key|violates|restrict/i.test(msg)) {
      return res.status(409).json({
        error:
          'Could not hard-delete this account because related records could not be cleared. Email info@gatewav.com with your account email.',
      });
    }
    return res.status(500).json({ error: 'Failed to delete account' });
  } finally {
    client.release();
  }
}
