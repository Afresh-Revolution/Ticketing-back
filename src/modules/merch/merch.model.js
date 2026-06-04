import { query, getPool } from '../../shared/config/db.js';

let merchTablesChecked = false;
let merchTablesExist = false;

export async function merchTablesReady() {
  if (merchTablesChecked) return merchTablesExist;
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'event_merch' LIMIT 1`
    );
    merchTablesExist = rows.length > 0;
  } catch {
    merchTablesExist = false;
  }
  merchTablesChecked = true;
  return merchTablesExist;
}

function formatMerchRow(row, colors, images) {
  return {
    id: row.id,
    eventId: row.event_id,
    availability: row.availability,
    description: row.description,
    types: row.types || [],
    customType: row.custom_type,
    sameAmount: row.same_amount,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : null,
    colors: colors.map((c) => ({
      id: c.id,
      colorName: c.color_name,
      quantityAvailable: Number(c.quantity_available),
    })),
    images: images.map((img) => ({
      id: img.id,
      imageUrl: img.image_url,
      quantityAvailable: Number(img.quantity_available),
      unitPrice: img.unit_price != null ? Number(img.unit_price) : null,
      sortOrder: Number(img.sort_order),
    })),
  };
}

export async function fetchMerchByEventId(eventId) {
  if (!(await merchTablesReady())) return [];
  const eventKey = String(eventId);
  const merchRes = await query(
    `SELECT * FROM event_merch WHERE event_id::text = $1 ORDER BY sort_order ASC, created_at ASC`,
    [eventKey]
  );
  if (merchRes.rows.length === 0) return [];

  const ids = merchRes.rows.map((r) => r.id);
  const colorsRes = await query(
    `SELECT * FROM event_merch_colors WHERE merch_id = ANY($1::uuid[])`,
    [ids]
  );
  const imagesRes = await query(
    `SELECT * FROM event_merch_images WHERE merch_id = ANY($1::uuid[]) ORDER BY sort_order ASC`,
    [ids]
  );

  const colorsByMerch = new Map();
  for (const c of colorsRes.rows) {
    if (!colorsByMerch.has(c.merch_id)) colorsByMerch.set(c.merch_id, []);
    colorsByMerch.get(c.merch_id).push(c);
  }
  const imagesByMerch = new Map();
  for (const img of imagesRes.rows) {
    if (!imagesByMerch.has(img.merch_id)) imagesByMerch.set(img.merch_id, []);
    imagesByMerch.get(img.merch_id).push(img);
  }

  return merchRes.rows.map((m) =>
    formatMerchRow(m, colorsByMerch.get(m.id) || [], imagesByMerch.get(m.id) || [])
  );
}

export async function fetchMerchById(merchId) {
  if (!(await merchTablesReady())) return null;
  const res = await query('SELECT * FROM event_merch WHERE id = $1', [merchId]);
  if (res.rows.length === 0) return null;
  const m = res.rows[0];
  const colors = await query('SELECT * FROM event_merch_colors WHERE merch_id = $1', [merchId]);
  const images = await query(
    'SELECT * FROM event_merch_images WHERE merch_id = $1 ORDER BY sort_order ASC',
    [merchId]
  );
  return formatMerchRow(m, colors.rows, images.rows);
}

function normalizeMerchItem(item, index) {
  return {
    availability: item.availability,
    description: String(item.description || '').trim(),
    types: Array.isArray(item.types) ? item.types.map(String) : [],
    customType: item.customType ?? item.custom_type ?? null,
    sameAmount: Boolean(item.sameAmount ?? item.same_amount ?? true),
    unitPrice:
      item.unitPrice != null
        ? Number(item.unitPrice)
        : item.unit_price != null
          ? Number(item.unit_price)
          : null,
    sortOrder: Number(item.sortOrder ?? item.sort_order ?? index),
    colors: (item.colors || []).map((c) => ({
      colorName: String(c.colorName ?? c.color_name ?? c.color ?? '').trim(),
      quantityAvailable: Number(c.quantityAvailable ?? c.quantity_available ?? c.quantity ?? 0),
    })).filter((c) => c.colorName),
    images: (item.images || []).slice(0, 5).map((img, i) => ({
      imageUrl: String(img.imageUrl ?? img.image_url ?? '').trim(),
      quantityAvailable: Number(img.quantityAvailable ?? img.quantity_available ?? img.quantity ?? 0),
      unitPrice:
        img.unitPrice != null
          ? Number(img.unitPrice)
          : img.unit_price != null
            ? Number(img.unit_price)
            : null,
      sortOrder: Number(img.sortOrder ?? img.sort_order ?? i),
    })).filter((img) => img.imageUrl),
  };
}

export async function replaceMerchForEvent(eventId, rawItems) {
  if (!(await merchTablesReady())) {
    throw new Error('Merch tables are not installed. Run db/migrations/016_event_merch.sql');
  }
  const eventKey = String(eventId);
  const items = (Array.isArray(rawItems) ? rawItems : []).map(normalizeMerchItem);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM event_merch WHERE event_id::text = $1', [eventKey]);

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item.availability) continue;

      const merchRes = await client.query(
        `INSERT INTO event_merch (
          event_id, availability, description, types, custom_type,
          same_amount, unit_price, sort_order
        ) VALUES ($1, $2::merch_availability, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          eventKey,
          item.availability,
          item.description,
          item.types,
          item.customType,
          item.sameAmount,
          item.unitPrice,
          item.sortOrder ?? index,
        ]
      );
      const merchId = merchRes.rows[0].id;

      for (const c of item.colors) {
        await client.query(
          `INSERT INTO event_merch_colors (merch_id, color_name, quantity_available)
           VALUES ($1, $2, $3)`,
          [merchId, c.colorName, c.quantityAvailable]
        );
      }

      for (const img of item.images) {
        await client.query(
          `INSERT INTO event_merch_images (
            merch_id, image_url, quantity_available, unit_price, sort_order
          ) VALUES ($1, $2, $3, $4, $5)`,
          [merchId, img.imageUrl, img.quantityAvailable, img.unitPrice, img.sortOrder]
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return fetchMerchByEventId(eventKey);
}

export async function decrementMerchStock(client, lines) {
  for (const line of lines) {
    if (!line.imageId) continue;
    const r = await client.query(
      `UPDATE event_merch_images
       SET quantity_available = quantity_available - $1
       WHERE id = $2 AND quantity_available >= $1
       RETURNING id`,
      [line.quantity, line.imageId]
    );
    if (r.rowCount === 0) throw new Error('Insufficient stock for selected merch');
  }
}

export async function createMerchOrder(payload) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `INSERT INTO merch_orders (
        event_id, full_name, email, phone, address, total_amount, status, payment_method
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        String(payload.eventId),
        payload.fullName,
        payload.email,
        payload.phone || null,
        payload.address || null,
        payload.totalAmount,
        payload.status,
        payload.paymentMethod,
      ]
    );
    const order = orderRes.rows[0];

    for (const line of payload.lines) {
      await client.query(
        `INSERT INTO merch_order_items (
          order_id, merch_id, image_id, color_name, type_name, quantity, unit_price, line_total
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          order.id,
          line.merchId,
          line.imageId,
          line.colorName,
          line.typeName,
          line.quantity,
          line.unitPrice,
          line.lineTotal,
        ]
      );
    }

    if (payload.status === 'paid') {
      await decrementMerchStock(client, payload.lines);
    }

    await client.query('COMMIT');
    return {
      id: order.id,
      totalAmount: Number(order.total_amount),
      status: order.status,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function findMerchOrderById(orderId) {
  const { rows } = await query('SELECT * FROM merch_orders WHERE id = $1', [orderId]);
  return rows[0] || null;
}

export async function updateMerchOrderStatus(orderId, status, paystackReference) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query('SELECT * FROM merch_orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const prev = orderRes.rows[0];

    if (status === 'paid' && prev.status !== 'paid') {
      const itemsRes = await client.query(
        'SELECT image_id, quantity FROM merch_order_items WHERE order_id = $1',
        [orderId]
      );
      await decrementMerchStock(
        client,
        itemsRes.rows.map((r) => ({ imageId: r.image_id, quantity: r.quantity }))
      );
    }

    await client.query(
      `UPDATE merch_orders
       SET status = $1,
           paystack_reference = COALESCE($2, paystack_reference),
           updated_at = NOW()
       WHERE id = $3`,
      [status, paystackReference ?? null, orderId]
    );
    await client.query('COMMIT');
    return { ...prev, status };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getMerchOrderItems(orderId) {
  const { rows } = await query(
    `SELECT moi.*, em.description AS merch_description, emi.image_url
     FROM merch_order_items moi
     JOIN event_merch em ON em.id = moi.merch_id
     LEFT JOIN event_merch_images emi ON emi.id = moi.image_id
     WHERE moi.order_id = $1`,
    [orderId]
  );
  return rows;
}

export async function createSaveRequest(data) {
  const { rows } = await query(
    `INSERT INTO merch_save_requests (event_id, merch_id, full_name, email, message)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.eventId, data.merchId, data.fullName, data.email, data.message || null]
  );
  return rows[0];
}

export async function updateSaveRequestStatus(id, status, reviewedBy) {
  const { rows } = await query(
    `UPDATE merch_save_requests
     SET status = $1, reviewed_at = NOW(), reviewed_by = $2
     WHERE id = $3 RETURNING *`,
    [status, reviewedBy ?? null, id]
  );
  return rows[0] || null;
}

export async function listMerchOrdersForAdmin(userId, role) {
  if (!(await merchTablesReady())) return [];
  const isSuper = role === 'superadmin' || userId === 0 || userId === '0';
  let sql = `
    SELECT mo.*, e.title AS event_title
    FROM merch_orders mo
    LEFT JOIN "Event" e ON e.id::text = mo.event_id::text
  `;
  const params = [];
  if (!isSuper && userId != null) {
    params.push(String(userId));
    sql += ` WHERE e."createdBy"::text = $${params.length}`;
  }
  sql += ' ORDER BY mo.created_at DESC LIMIT 200';
  const { rows } = await query(sql, params);
  return rows;
}

export async function listSaveRequestsForAdmin(userId, role) {
  if (!(await merchTablesReady())) return [];
  const isSuper = role === 'superadmin' || userId === 0 || userId === '0';
  let sql = `
    SELECT msr.*, e.title AS event_title, em.description AS merch_description
    FROM merch_save_requests msr
    LEFT JOIN "Event" e ON e.id::text = msr.event_id::text
    LEFT JOIN event_merch em ON em.id = msr.merch_id
  `;
  const params = [];
  if (!isSuper && userId != null) {
    params.push(String(userId));
    sql += ` WHERE e."createdBy"::text = $${params.length}`;
  }
  sql += ' ORDER BY msr.created_at DESC LIMIT 200';
  const { rows } = await query(sql, params);
  return rows;
}
