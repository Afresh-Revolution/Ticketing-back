import { query } from '../config/db.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function savePushToken({ token, email, userId, trendingEnabled }) {
  const value = String(token || '').trim();
  if (!value.startsWith('ExponentPushToken[') && !value.startsWith('ExpoPushToken[')) return;
  const normalizedEmail = String(email || '').trim().toLowerCase() || null;
  await query(
    `INSERT INTO push_tokens (token, email, user_id, trending_enabled, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (token) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, push_tokens.email),
           user_id = COALESCE(EXCLUDED.user_id, push_tokens.user_id),
           trending_enabled = EXCLUDED.trending_enabled,
           updated_at = NOW()`,
    [value, normalizedEmail, userId != null ? String(userId) : null, trendingEnabled !== false]
  );
}

export async function sendPushToEmail(email, { title, body, data }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !title) return;
  let rows = [];
  try {
    const result = await query(
      `SELECT token FROM push_tokens WHERE email = $1`,
      [normalized]
    );
    rows = result.rows || [];
  } catch (err) {
    console.error('[push] lookup:', err.message);
    return;
  }
  if (!rows.length) return;
  const messages = rows.map((row) => ({
    to: row.token,
    title,
    body: body || '',
    data: data || {},
    sound: 'default',
  }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[push] send failed', res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.error('[push] send:', err.message);
  }
}

export function paymentDecisionCopy(status, subject) {
  const next = String(status || '').toLowerCase();
  if (next === 'paid' || next === 'approved') {
    return {
      title: 'Payment approved',
      body: `Your ${subject} payment was approved.`,
    };
  }
  if (next === 'cancelled' || next === 'rejected') {
    return {
      title: 'Payment not approved',
      body: `Your ${subject} payment was not approved.`,
    };
  }
  return {
    title: 'Payment update',
    body: `Your ${subject} payment is now ${next || 'updated'}.`,
  };
}
