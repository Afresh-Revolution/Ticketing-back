import { prisma } from '../../../shared/config/db.js';

export const userPageModel = {
  getProfile: (userId) =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
  getTickets: (userId) =>
    prisma.ticket.findMany({
      where: { userId },
      include: { event: true },
      orderBy: { createdAt: 'desc' },
    }),
};
