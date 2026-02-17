import { Router } from 'express';
import { prisma } from '../../shared/config/db.js';
import { optionalAuth } from '../../shared/middleware/authMiddleware.js';
import * as imageController from './beforeBooking/image/image.controller.js';
import * as artController from './beforeBooking/art/art.controller.js';
import * as ticketSelectionController from './beforeBooking/ticketSelection/ticketSelection.controller.js';
import * as bookedPayController from './afterBooking/bookedPay/bookedPay.controller.js';
import * as payedController from './afterBooking/payed/payed.controller.js';

const router = Router();

router.get('/before/image', imageController.getImage);
router.get('/before/art', artController.getArt);
router.get('/before/ticketSelection', ticketSelectionController.getTicketSelection);
router.get('/after/booked/:ticketId', bookedPayController.getBookedPay);
router.get('/after/payed/:ticketId', payedController.getPayed);

router.post('/tickets', optionalAuth, async (req, res, next) => {
  try {
    const { eventId, email, quantity = 1 } = req.body;
    if (!eventId || !email) return res.status(400).json({ error: 'eventId and email are required' });
    const ticket = await prisma.ticket.create({
      data: {
        eventId,
        email,
        userId: req.user?.id ?? null,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
      },
    });
    res.status(201).json(ticket);
  } catch (e) {
    next(e);
  }
});

export default router;
