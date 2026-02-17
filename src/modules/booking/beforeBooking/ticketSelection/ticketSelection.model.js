import { prisma } from '../../../../shared/config/db.js';

export const ticketSelectionModel = {
  getEvent: (eventId) => prisma.event.findUnique({ where: { id: eventId }, include: { tickets: true } }),
};
