import { prisma } from '../../../../shared/config/db.js';

export const payedModel = {
  getTicket: (id) => prisma.ticket.findUnique({ where: { id }, include: { event: true } }),
};
