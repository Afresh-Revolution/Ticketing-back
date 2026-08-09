import express from 'express';
import * as userController from './user.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { createRateLimit } from '../../shared/middleware/security.js';

const router = express.Router();

const deleteAccountRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many account deletion attempts. Please try again later.',
});

router.get('/orders', requireAuth, userController.getMyOrders);
router.delete('/orders/:orderId', requireAuth, userController.deleteMyOrder);
router.delete(
  '/account',
  deleteAccountRateLimit,
  requireAuth,
  userController.deleteAccount,
);

export default router;
