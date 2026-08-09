import express from 'express';
import * as ordersController from './orders.controller.js';
import { getMyOrders } from '../user/user.controller.js';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';

const router = express.Router();

router.get('/', requireAuth, getMyOrders);
router.get('/manual-payment-details', ordersController.getManualPaymentDetailsHandler);
router.post('/', optionalAuth, ordersController.createOrder);
router.post('/validate-coupon', optionalAuth, ordersController.validateCoupon);
router.post('/coupon-preview', optionalAuth, ordersController.validateCoupon);
router.post('/initialize-payment', optionalAuth, ordersController.initializePayment);
router.post('/verify', ordersController.verifyOrder);
router.post('/manual-payment-notify', optionalAuth, ordersController.notifyManualPayment);
// Webhook is mounted in index.js with express.raw for signature verification.

export default router;
