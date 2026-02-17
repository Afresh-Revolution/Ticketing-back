import { prisma } from '../../../shared/config/db.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatEventDate(date) {
  const d = new Date(date);
  const dayName = DAYS[d.getUTCDay()];
  const month = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  return `${dayName}, ${month} ${day}`;
}

const DEFAULT_HEADER = {
  logoText: 'Gatewave',
  logoUrl: null,
  navLinks: [
    { id: 'home', text: 'Home', href: '/community' },
    { id: 'explore', text: 'Explore', href: '/events' },
    { id: 'my-tickets', text: 'My Tickets', href: '/user/tickets' },
  ],
};

export const gatewaveModel = {
  async get(user = null) {
    const header = {
      ...DEFAULT_HEADER,
      profile: user
        ? {
            id: user.id,
            name: user.name || user.email,
            email: user.email,
            profileHref: '/user/profile',
            avatarUrl: null,
          }
        : null,
    };

    const featuredEventRow = await prisma.event.findFirst({
      where: { date: { gte: new Date() } },
      orderBy: { date: 'asc' },
    });

    const featuredEvent = featuredEventRow
      ? {
          tag: 'FEATURED EVENT',
          tagIcon: 'fire',
          eventId: featuredEventRow.id,
          title: featuredEventRow.title,
          dateFormatted: formatEventDate(featuredEventRow.date),
          date: featuredEventRow.date,
          location: featuredEventRow.venue ?? '',
          backgroundImageUrl: featuredEventRow.imageUrl ?? null,
          getTicketsText: 'Get Tickets',
          getTicketsHref: `/events/${featuredEventRow.id}`,
        }
      : {
          tag: 'FEATURED EVENT',
          tagIcon: 'fire',
          eventId: null,
          title: 'No featured event',
          dateFormatted: null,
          date: null,
          location: null,
          backgroundImageUrl: null,
          getTicketsText: 'Get Tickets',
          getTicketsHref: '/events',
        };

    return {
      header,
      featuredEvent,
    };
  },
};
