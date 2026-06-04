/**
 * PostgreSQL repository for event merch.
 * Expects a pg Pool passed from the main app.
 */

export async function deleteMerchForEvent(pool, eventId) {
  await pool.query('DELETE FROM event_merch WHERE event_id = $1', [eventId]);
}

export async function insertMerchForEvent(pool, eventId, merchItems) {
  if (!Array.isArray(merchItems) || merchItems.length === 0) return [];
  const saved = [];
  for (const item of merchItems) {
    const merchRes = await pool.query(
      `INSERT INTO event_merch (
        event_id, availability, description, types, custom_type,
        same_amount, unit_price, sort_order
      ) VALUES ($1, $2::merch_availability, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        eventId,
        item.availability,
        item.description || '',
        item.types || [],
        item.customType || null,
        Boolean(item.sameAmount),
        item.unitPrice ?? null,
        item.sortOrder ?? 0,
      ]
    );
    const merch = merchRes.rows[0];
    const merchId = merch.id;

    for (const c of item.colors || []) {
      await pool.query(
        `INSERT INTO event_merch_colors (merch_id, color_name, quantity_available)
         VALUES ($1, $2, $3)`,
        [merchId, c.colorName, c.quantityAvailable ?? 0]
      );
    }

    const imageRows = [];
    for (const img of item.images || []) {
      const imgRes = await pool.query(
        `INSERT INTO event_merch_images (
          merch_id, image_url, quantity_available, unit_price, sort_order
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [
          merchId,
          img.imageUrl,
          img.quantityAvailable ?? 0,
          img.unitPrice ?? null,
          img.sortOrder ?? 0,
        ]
      );
      imageRows.push(imgRes.rows[0]);
    }

    saved.push({ ...merch, images: imageRows });
  }
  return saved;
}

export async function replaceMerchForEvent(pool, eventId, merchItems) {
  await pool.query('DELETE FROM event_merch WHERE event_id = $1', [eventId]);
  return insertMerchForEvent(pool, eventId, merchItems);
}

export async function fetchMerchByEventId(pool, eventId) {
  const merchRes = await pool.query(
    `SELECT * FROM event_merch WHERE event_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [eventId]
  );
  if (merchRes.rows.length === 0) return [];

  const ids = merchRes.rows.map((r) => r.id);
  const colorsRes = await pool.query(
    `SELECT * FROM event_merch_colors WHERE merch_id = ANY($1::uuid[])`,
    [ids]
  );
  const imagesRes = await pool.query(
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

  return merchRes.rows.map((m) => formatMerchRow(m, colorsByMerch.get(m.id) || [], imagesByMerch.get(m.id) || []));
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

export async function fetchMerchById(pool, merchId) {
  const res = await pool.query('SELECT * FROM event_merch WHERE id = $1', [merchId]);
  if (res.rows.length === 0) return null;
  const m = res.rows[0];
  const colors = await pool.query('SELECT * FROM event_merch_colors WHERE merch_id = $1', [merchId]);
  const images = await pool.query(
    'SELECT * FROM event_merch_images WHERE merch_id = $1 ORDER BY sort_order ASC',
    [merchId]
  );
  return formatMerchRow(m, colors.rows, images.rows);
}

/** @param {import('pg').Pool | import('pg').PoolClient} db */
export async function decrementMerchStock(db, items, { manageTransaction = false } = {}) {
  const run = async (q) => {
    for (const line of items) {
      if (line.imageId) {
        const r = await q(
          `UPDATE event_merch_images
           SET quantity_available = quantity_available - $1
           WHERE id = $2 AND quantity_available >= $1
           RETURNING id`,
          [line.quantity, line.imageId]
        );
        if (r.rowCount === 0) throw new Error('Insufficient stock for selected merch image');
      }
    }
  };
  if (manageTransaction) {
    await db.query('BEGIN');
    try {
      await run(db.query.bind(db));
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
    return;
  }
  await run(db.query.bind(db));
}
