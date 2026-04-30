import express from 'express';
import * as ordersController from './orders.controller.js';
import { optionalAuth } from '../../middleware/auth.js';

const router = express.Router();

router.post('/', optionalAuth, ordersController.createOrder);
router.post('/validate-coupon', optionalAuth, ordersController.validateCoupon);
router.post('/coupon-preview', optionalAuth, ordersController.validateCoupon);
router.post('/initialize-payment', optionalAuth, ordersController.initializePayment);
router.post('/verify', ordersController.verifyOrder);
router.post('/manual-payment-notify', optionalAuth, ordersController.notifyManualPayment);

export default router;
