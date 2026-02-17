import { prisma } from '../../shared/config/db.js';

export const authModel = {
  findUserByEmail: (email) => prisma.user.findUnique({ where: { email } }),
  createUser: (data) => prisma.user.create({ data }),
  findUserById: (id) => prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true } }),
};
