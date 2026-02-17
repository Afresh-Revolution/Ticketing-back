import { query } from '../../../shared/config/db.js';

const SECTION_DEFAULT = {
  title: 'Trending Now',
  subtitle: "Don't miss out on the hottest events happening this week.",
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatDateLabel(date) {
  const d = new Date(date);
  const month = MONTHS[d.getUTCMonth()] || 'N/A';
  const day = d.getUTCDate();
  return `${month} ${day}`;
}

function formatPrice(price, currency = 'N') {
  if (price == null) return null;
  const c = currency || 'N';
  return `Starting From ${c} ${Number(price).toLocaleString()}`;
}

export const trendingModel = {
  async get() {
    const { rows: events } = await query(
      'SELECT * FROM "Event" ORDER BY date ASC LIMIT 6'
    );
    const cards = events.map((e) => ({
      eventId: e.id,
      title: e.title,
      imageUrl: e.imageUrl ?? null,
      category: e.category ?? null,
      dateFormatted: formatDateLabel(e.date),
      date: e.date,
      location: e.venue ?? null,
      time: e.startTime ?? null,
      price: e.price,
      currency: e.currency ?? 'N',
      priceLabel: formatPrice(e.price, e.currency),
      ctaText: 'Get Tickets',
    }));
    return {
      ...SECTION_DEFAULT,
      events: cards,
    };
  },
};
