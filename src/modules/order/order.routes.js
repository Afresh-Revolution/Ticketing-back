import { Router } from 'express';
import * as orderController from './order.controller.js';
import { getMyOrders } from '../user/user.controller.js';
import { optionalAuth } from '../../shared/middleware/authMiddleware.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

// List current user's paid tickets (fallback for GET /api/user/orders)
router.get('/', requireAuth, getMyOrders);

router.get('/manual-payment-details', orderController.getManualPaymentDetailsHandler);

// Create order (optional auth to attach user if logged in)
router.post('/', optionalAuth, orderController.create);
router.post('/validate-coupon', optionalAuth, orderController.validateCoupon);
router.post('/coupon-preview', optionalAuth, orderController.validateCoupon);
router.post('/initialize-payment', optionalAuth, orderController.initializePayment);
router.post('/manual-payment-notify', optionalAuth, orderController.manualPaymentNotify);

// Verify payment
router.post('/verify', orderController.verify);

export default router;
