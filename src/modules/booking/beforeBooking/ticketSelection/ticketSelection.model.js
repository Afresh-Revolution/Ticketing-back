import { query } from '../../../../shared/config/db.js';

function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    venue: row.venue,
    imageUrl: row.imageUrl,
    category: row.category,
    startTime: row.startTime,
    price: row.price,
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tickets: row.tickets ?? [],
  };
}

export const ticketSelectionModel = {
  async getEvent(eventId) {
    const { rows: eventRows } = await query('SELECT * FROM "Event" WHERE id = $1', [eventId]);
    const event = rowToEvent(eventRows[0]);
    if (!event) return null;
    const { rows: ticketRows } = await query('SELECT * FROM "Ticket" WHERE "eventId" = $1', [eventId]);
    event.tickets = ticketRows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      userId: r.userId,
      email: r.email,
      quantity: r.quantity,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    return event;
  },
};
