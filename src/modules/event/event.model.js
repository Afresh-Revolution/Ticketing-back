import { prisma } from '../../shared/config/db.js';

export const eventModel = {
  findMany: (opts = {}) => prisma.event.findMany({ ...opts, orderBy: { date: 'asc' } }),
  findById: (id, includeTickets = false) =>
    prisma.event.findUnique({
      where: { id },
      ...(includeTickets && { include: { tickets: true } }),
    }),
  create: (data) => prisma.event.create({ data }),
  update: (id, data) => prisma.event.update({ where: { id }, data }),
  delete: (id) => prisma.event.delete({ where: { id } }),
};
