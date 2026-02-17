import { prisma } from '../../../shared/config/db.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const CATEGORY_SLUG_TO_NAME = {
  music: 'Music',
  tech: 'Tech',
  food: 'Food',
  art: 'Art',
  nightlife: 'Nightlife',
};

const SECTION_DEFAULT = {
  title: 'Upcoming Events',
  seeAllText: 'See All',
  seeAllHref: '/events',
};

function formatDateBadge(date) {
  const d = new Date(date);
  const month = MONTHS[d.getUTCMonth()] ?? 'N/A';
  const day = d.getUTCDate();
  return `${month} ${day}`;
}

function formatPrice(price, currency = 'N') {
  if (price == null) return null;
  const c = currency === 'N' ? '₦' : currency;
  return `${c}${Number(price).toLocaleString()}`;
}

function mapEventToCard(e) {
  return {
    eventId: e.id,
    title: e.title,
    imageUrl: e.imageUrl ?? null,
    dateFormatted: formatDateBadge(e.date),
    date: e.date,
    category: e.category ?? null,
    location: e.venue ?? null,
    time: e.startTime ?? null,
    price: e.price,
    currency: e.currency ?? 'N',
    priceLabel: e.price != null ? `Starting from ${formatPrice(e.price, e.currency)}` : null,
    getTicketsText: 'Get Tickets',
    getTicketsHref: `/events/${e.id}`,
  };
}

export const upcomingEventsModel = {
  async get(opts = {}) {
    const where = { date: { gte: new Date() } };
    if (opts.category) {
      const slug = String(opts.category).toLowerCase();
      const name = CATEGORY_SLUG_TO_NAME[slug] ?? opts.category;
      where.category = name;
    }
    const limit = Math.min(opts.limit ?? 10, 50);
    const events = await prisma.event.findMany({
      where,
      orderBy: { date: 'asc' },
      take: limit,
    });
    const cards = events.map(mapEventToCard);
    return {
      ...SECTION_DEFAULT,
      events: cards,
    };
  },
};
