import { prisma } from '../../../../shared/config/db.js';

export const bookedPayModel = {
  getBooking: (id) => prisma.ticket.findUnique({ where: { id }, include: { event: true } }),
};
