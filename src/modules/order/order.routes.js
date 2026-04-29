import { Router } from 'express';
import * as orderController from './order.controller.js';
import { optionalAuth } from '../../shared/middleware/authMiddleware.js';

const router = Router();

// Create order (optional auth to attach user if logged in)
router.post('/', optionalAuth, orderController.create);
router.post('/validate-coupon', optionalAuth, orderController.validateCoupon);
router.post('/coupon-preview', optionalAuth, orderController.validateCoupon);
router.post('/initialize-payment', optionalAuth, orderController.initializePayment);

// Verify payment
router.post('/verify', orderController.verify);

export default router;
