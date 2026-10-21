import { query } from '../../shared/config/db.js';
import { loadEvent } from './access.js';

const PAGE_MAX = 30;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function weekendRange(now = new Date()) {
  const day = now.getDay();
  const fridayOffset = day <= 5 ? 5 - day : 5 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (day === 0) start.setDate(start.getDate() - 2);
  else if (day === 6) start.setDate(start.getDate() - 1);
  else start.setDate(start.getDate() + fridayOffset);
  if (day >= 1 && day <= 4) {
    // upcoming Friday
  }
  const end = new Date(start);
  end.setDate(start.getDate() + 2);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function whenRange(when, from, to) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  if (when === 'today') return { start: startOfDay, end: endOfDay };
  if (when === 'tonight') {
    const start = new Date(now);
    start.setHours(17, 0, 0, 0);
    return { start, end: endOfDay };
  }
  if (when === 'weekend') return weekendRange(now);
  if (when === 'range' && from && to) {
    const start = new Date(from);
    const end = new Date(to);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }
  return null;
}

function availabilityOf(row) {
  const status = String(row.listingStatus || 'published').toLowerCase();
  const capacity = num(row.capacity);
  const sold = num(row.sold);
  if (status === 'cancelled') return 'cancelled';
  if (!row.isPublished && status !== 'cancelled') return 'unpublished';
  if (capacity > 0 && sold >= capacity) return 'sold_out';
  if (capacity > 0 && capacity - sold <= Math.max(3, Math.round(capacity * 0.1))) return 'limited';
  return 'available';
}

function imageUrlsOf(row) {
  let imageUrls = row.imageUrls;
  if (typeof imageUrls === 'string') {
    try {
      imageUrls = JSON.parse(imageUrls);
    } catch {
      imageUrls = [];
    }
  }
  if (!Array.isArray(imageUrls)) imageUrls = [];
  return imageUrls.map((url) => String(url || '').trim()).filter(Boolean).slice(0, 3);
}

function publicEvent(row, originLat, originLng) {
  const imageUrls = imageUrlsOf(row);
  const availability = availabilityOf(row);
  const distanceKm =
    originLat != null && originLng != null && row.latitude != null && row.longitude != null
      ? Math.round(haversineKm(originLat, originLng, Number(row.latitude), Number(row.longitude)) * 10) / 10
      : null;
  return {
    id: String(row.id),
    title: row.title,
    date: row.date,
    endDate: row.endDate ?? null,
    startTime: row.startTime ?? null,
    endTime: row.endTime ?? null,
    category: row.category || 'Other',
    location: row.location || row.venue || '',
    venue: row.venue ?? null,
    city: row.city || null,
    citySlug: row.citySlug || null,
    price: num(row.startingPrice ?? row.price),
    startingPrice: num(row.startingPrice ?? row.price),
    currency: 'NGN',
    imageUrl: imageUrls[0] || row.imageUrl || null,
    imageUrls: imageUrls.length ? imageUrls : row.imageUrl ? [row.imageUrl] : [],
    organizer: row.organizer || null,
    verifiedOrganizer: Boolean(row.verifiedOrganizer),
    availability,
    purchasable: availability === 'available' || availability === 'limited',
    eventType: row.eventType || row.format || 'in-person',
    format: row.format || row.eventType || 'in-person',
    isRecurring: Boolean(row.isRecurring),
    recurrenceFrequency: row.recurrenceFrequency || 'none',
    recurrenceWeekday: row.recurrenceWeekday || null,
    recurrenceUntil: row.recurrenceUntil || null,
    accessibility: row.accessibility || null,
    skillLevel: row.skillLevel || null,
    timezone: row.timezone || 'Africa/Lagos',
    distanceKm,
    ticketsSold: num(row.sold),
    isTrending: Boolean(row.isTrending),
  };
}

export async function listCities() {
  const result = await query(
    `SELECT slug, name, state, country, timezone, latitude, longitude, "isPilot"
     FROM "City" ORDER BY "isPilot" DESC, name ASC`,
  );
  return result.rows || [];
}

async function verifiedCreatorIds() {
  const result = await query(
    `SELECT DISTINCT "userId" FROM "VerificationCase" WHERE status = 'approved'`,
  ).catch(() => ({ rows: [] }));
  return new Set((result.rows || []).map((r) => String(r.userId)));
}

export async function searchEvents(params) {
  const page = Math.max(1, num(params.page, 1));
  const pageSize = Math.min(PAGE_MAX, Math.max(1, num(params.pageSize, 20)));
  const idFilter = params.ids
    ? new Set(String(params.ids).split(',').map((id) => id.trim()).filter(Boolean))
    : null;
  const idList = idFilter ? [...idFilter] : null;
  const result = await query(
    `SELECT
       e.*,
       COALESCE((
         SELECT MIN(tt.price)::int FROM "TicketType" tt WHERE tt."eventId"::text = e.id::text
       ), e.price, 0) AS "startingPrice",
       COALESCE((
         SELECT SUM(tt.quantity)::int FROM "TicketType" tt WHERE tt."eventId"::text = e.id::text
       ), 0) AS capacity,
       COALESCE((
         SELECT SUM(oi.quantity)::int
         FROM "Order" o
         JOIN "OrderItem" oi ON oi."orderId"::text = o.id::text
         WHERE o."eventId"::text = e.id::text
           AND LOWER(COALESCE(o.status, '')) IN ('paid', 'completed', 'success')
       ), 0) AS sold
     FROM "Event" e
     WHERE (COALESCE(e."isPublished", TRUE) = TRUE
        OR LOWER(COALESCE(e."listingStatus", '')) = 'cancelled')
       ${idList ? 'AND e.id::text = ANY($1::text[])' : ''}
     ORDER BY e."date" ASC NULLS LAST
     LIMIT 400`,
    idList ? [idList] : [],
  ).catch(() => ({ rows: [] }));

  const verified = params.verified === 'true' || params.verified === true ? await verifiedCreatorIds() : null;
  const range = whenRange(params.when, params.from, params.to);
  const q = String(params.q || '').trim().toLowerCase();
  const city = String(params.city || '').trim().toLowerCase();
  const category = String(params.category || '').trim().toLowerCase();
  const maxPrice = params.maxPrice != null && params.maxPrice !== '' ? num(params.maxPrice, NaN) : null;
  const originLat = params.lat != null && params.lat !== '' ? num(params.lat, NaN) : null;
  const originLng = params.lng != null && params.lng !== '' ? num(params.lng, NaN) : null;
  const radius = params.radiusKm != null && params.radiusKm !== '' ? num(params.radiusKm, NaN) : null;
  const hasOrigin = Number.isFinite(originLat) && Number.isFinite(originLng);

  let rows = result.rows || [];
  rows = rows.filter((row) => {
    if (idFilter && !idFilter.has(String(row.id))) return false;
    const listing = String(row.listingStatus || 'published').toLowerCase();
    if (listing === 'draft') return false;
    if (params.includeCancelled !== 'true' && listing === 'cancelled' && params.when) {
      /* cancelled still listed unless a caller asks to hide them */
    }
    if (city) {
      const blob = `${row.citySlug || ''} ${row.location || ''} ${row.venue || ''}`.toLowerCase();
      if (row.citySlug?.toLowerCase() !== city && !blob.includes(city.replace(/-/g, ' ')) && !blob.includes(city)) {
        return false;
      }
    }
    if (category && category !== 'all' && String(row.category || '').toLowerCase() !== category) return false;
    if (q) {
      const blob = `${row.title || ''} ${row.location || ''} ${row.organizer || ''} ${row.category || ''}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (params.free === 'true') {
      const price = num(row.startingPrice ?? row.price);
      if (price > 0) return false;
    }
    if (maxPrice != null && Number.isFinite(maxPrice) && num(row.startingPrice ?? row.price) > maxPrice) return false;
    if (params.recurring === 'true' && !row.isRecurring) return false;
    if (params.format && String(row.format || row.eventType || '').toLowerCase() !== String(params.format).toLowerCase()) {
      return false;
    }
    if (params.accessibility === 'true' && !String(row.accessibility || '').trim()) return false;
    if (verified && !verified.has(String(row.createdBy))) return false;
    if (range && row.date) {
      const when = new Date(row.date);
      if (Number.isNaN(when.getTime()) || when < range.start || when > range.end) return false;
    }
    if (hasOrigin && Number.isFinite(radius)) {
      if (row.latitude == null || row.longitude == null) {
        if (!city) return false;
      } else if (haversineKm(originLat, originLng, Number(row.latitude), Number(row.longitude)) > radius) {
        return false;
      }
    }
    return true;
  });

  rows.sort((a, b) => {
    const av = availabilityOf(a) === 'cancelled' ? 1 : 0;
    const bv = availabilityOf(b) === 'cancelled' ? 1 : 0;
    if (av !== bv) return av - bv;
    return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
  });

  const total = rows.length;
  const slice = rows.slice((page - 1) * pageSize, page * pageSize).map((row) =>
    publicEvent(row, hasOrigin ? originLat : null, hasOrigin ? originLng : null),
  );
  return { events: slice, page, pageSize, total };
}

export async function collectionBySlug(slug) {
  const found = await query(`SELECT * FROM "CuratedCollection" WHERE slug = $1 AND "isPublished" = TRUE`, [
    slug,
  ]);
  const collection = found.rows?.[0];
  if (!collection) return null;
  const pinned = await query(
    `SELECT "eventId" FROM "CollectionEvent" WHERE "collectionId" = $1 ORDER BY "sortOrder" ASC, "eventId" ASC`,
    [collection.id],
  );
  const ids = (pinned.rows || []).map((r) => String(r.eventId));
  let events = [];
  if (ids.length) {
    const pinnedSearch = await searchEvents({ page: 1, pageSize: 30, ids: ids.join(',') });
    const byId = new Map(pinnedSearch.events.map((e) => [e.id, e]));
    events = ids.map((id) => byId.get(id)).filter(Boolean);
  }
  if (!events.length && collection.kind === 'weekend') {
    const weekend = await searchEvents({
      city: collection.citySlug || 'jos',
      when: 'weekend',
      page: 1,
      pageSize: 30,
    });
    events = weekend.events;
  }
  return {
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description,
    citySlug: collection.citySlug,
    kind: collection.kind,
    events,
  };
}

export async function listCollections() {
  const result = await query(
    `SELECT id, slug, title, "citySlug", description, kind FROM "CuratedCollection"
     WHERE "isPublished" = TRUE ORDER BY "sortOrder" ASC, title ASC`,
  );
  return result.rows || [];
}

export async function publicEventDetail(eventId) {
  const event = await loadEvent(eventId);
  if (!event || (event.isPublished === false && String(event.listingStatus) !== 'cancelled')) return null;
  const searched = await searchEvents({ page: 1, pageSize: 30, q: '', includeCancelled: 'true' });
  const card = searched.events.find((e) => e.id === String(event.id));
  const base = card || publicEvent({ ...event, capacity: 0, sold: 0, startingPrice: event.price }, null, null);
  return {
    ...base,
    description: event.description || '',
    safetyNotes: event.safetyNotes || null,
    contactNotes: event.contactNotes || null,
    ageGuidance: event.ageGuidance || null,
    skillLevel: event.skillLevel || null,
    accessibility: event.accessibility || null,
    timezone: event.timezone || 'Africa/Lagos',
    terms: 'Tickets are sold per person. Fees shown before payment are the amount charged. Refunds follow the event refund policy and are not instant.',
  };
}

export function frontendBase() {
  return (process.env.FRONTEND_URL || 'https://gatewav.com').replace(/\/$/, '');
}

export function shareHtml(event) {
  const base = frontendBase();
  const url = `${base}/#/event/${encodeURIComponent(event.id)}`;
  const title = String(event.title || 'GateWav event').replace(/[<>&]/g, '');
  const description = String(event.description || `${title} on GateWav`).slice(0, 180).replace(/[<>&]/g, '');
  const image = event.imageUrl || `${base}/og-image.png`;
  const json = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: event.date || undefined,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus:
      event.availability === 'cancelled'
        ? 'https://schema.org/EventCancelled'
        : 'https://schema.org/EventScheduled',
    location: {
      '@type': 'Place',
      name: event.venue || event.location || event.citySlug || 'Venue',
      address: event.location || undefined,
    },
    image: image ? [image] : undefined,
    description,
    offers: {
      '@type': 'Offer',
      price: event.startingPrice ?? event.price ?? 0,
      priceCurrency: 'NGN',
      availability:
        event.availability === 'sold_out'
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/InStock',
      url,
    },
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} · GateWav</title>
  <link rel="canonical" href="${url}" />
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">${JSON.stringify(json)}</script>
  <meta http-equiv="refresh" content="0;url=${url}" />
</head>
<body>
  <p><a href="${url}">${title}</a></p>
  <p>Open in the GateWav app with gatewav://event/${event.id} or continue on the web. No account is required to view this listing.</p>
</body>
</html>`;
}
