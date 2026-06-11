import { query } from '../config/db.js';

/** @typedef {{ name: string; deliveryMode: string; quantity: number }} TicketEmailItem */

/**
 * Load event fields needed for ticket confirmation emails.
 * @param {string|number} eventId
 */
export async function loadEventForTicketEmail(eventId) {
  if (eventId == null || String(eventId).trim() === '') return null;
  const result = await query(
    `SELECT id, title, date, "endDate", "startTime", "endTime", location, venue, "eventType"
     FROM "Event"
     WHERE id::text = $1
     LIMIT 1`,
    [String(eventId)]
  ).catch(() => ({ rows: [] }));
  return result.rows?.[0] || null;
}

/**
 * Order line items with ticket type name and delivery mode.
 * @param {string|number} orderId
 * @returns {Promise<TicketEmailItem[]>}
 */
export async function loadOrderTicketItems(orderId) {
  const result = await query(
    `SELECT COALESCE(tt.name, 'General') AS name,
            COALESCE(tt."deliveryMode", 'in_person') AS "deliveryMode",
            COALESCE(oi.quantity, 1)::int AS quantity
     FROM "OrderItem" oi
     LEFT JOIN "TicketType" tt ON tt.id::text = oi."ticketTypeId"::text
     WHERE oi."orderId"::text = $1`,
    [String(orderId)]
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row) => ({
    name: String(row.name || 'General').trim() || 'General',
    deliveryMode: String(row.deliveryMode || 'in_person').toLowerCase(),
    quantity: Math.max(1, Number(row.quantity) || 1),
  }));
}

/**
 * Build sendTicketEmail payload from an order row + optional event override.
 * @param {object} params
 * @param {object} params.order
 * @param {string} params.ticketCode
 * @param {object} [params.eventRow]
 * @param {TicketEmailItem[]} [params.ticketItems]
 */
/**
 * Resolve delivery mode for a walk-in / manual sale by ticket name.
 * @param {string|number} eventId
 * @param {string} ticketTypeName
 * @returns {Promise<TicketEmailItem>}
 */
export async function loadWalkInTicketItem(eventId, ticketTypeName) {
  const name = String(ticketTypeName || 'General').trim() || 'General';
  const result = await query(
    `SELECT name, COALESCE("deliveryMode", 'in_person') AS "deliveryMode"
     FROM "TicketType"
     WHERE "eventId"::text = $1
       AND LOWER(TRIM(COALESCE(name, ''))) = LOWER(TRIM($2))
     LIMIT 1`,
    [String(eventId), name]
  ).catch(() => ({ rows: [] }));
  const row = result.rows?.[0];
  return {
    name: row?.name || name,
    deliveryMode: String(row?.deliveryMode || 'in_person').toLowerCase(),
    quantity: 1,
  };
}

export function buildTicketEmailPayload({
  order,
  ticketCode,
  eventRow = null,
  ticketItems = [],
}) {
  const event = eventRow || {};
  const eventType = String(event.eventType ?? order.event_type ?? 'in-person').toLowerCase();
  const fallbackDeliveryMode = eventType === 'online' ? 'online' : 'in_person';
  const items =
    ticketItems.length > 0
      ? ticketItems
      : (order.ticketTypes || []).map((name) => ({
          name: String(name),
          deliveryMode: fallbackDeliveryMode,
          quantity: 1,
        }));

  return {
    to: order.email,
    fullName: order.fullName || order.full_name,
    ticketCode,
    eventId: order.eventId ?? order.event_id ?? event.id,
    eventTitle: event.title ?? order.event_title ?? order.eventTitle,
    eventDate: event.date ?? order.event_date ?? order.eventDate,
    eventEndDate: event.endDate ?? order.event_end_date ?? null,
    eventStartTime: event.startTime ?? order.start_time ?? null,
    eventEndTime: event.endTime ?? order.end_time ?? null,
    eventType: event.eventType ?? order.event_type ?? 'in-person',
    eventLocation: event.location ?? order.location ?? null,
    eventVenue: event.venue ?? order.venue ?? null,
    ticketItems: items,
    ticketTypes: items.map((i) => i.name),
  };
}
