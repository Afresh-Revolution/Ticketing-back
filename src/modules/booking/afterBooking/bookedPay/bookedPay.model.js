import { query } from '../../../../shared/config/db.js';

export const bookedPayModel = {
  async getBooking(id) {
    const { rows: ticketRows } = await query('SELECT * FROM "Ticket" WHERE id = $1', [id]);
    const ticket = ticketRows[0];
    if (!ticket) return null;
    const { rows: eventRows } = await query('SELECT * FROM "Event" WHERE id = $1', [ticket.eventId]);
    const event = eventRows[0];
    return {
      ...ticket,
      event: event
        ? {
            id: event.id,
            title: event.title,
            description: event.description,
            date: event.date,
            venue: event.venue,
            imageUrl: event.imageUrl,
            category: event.category,
            startTime: event.startTime,
            price: event.price,
            currency: event.currency,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
          }
        : null,
    };
  },
};
