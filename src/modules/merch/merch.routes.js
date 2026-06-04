import { Router } from 'express';
import * as merchController from './merch.controller.js';
import { optionalAuth } from '../../shared/middleware/authMiddleware.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

router.post('/', optionalAuth, merchController.createOrder);
router.post('/initialize-payment', optionalAuth, merchController.initializePayment);
router.post('/verify', merchController.verifyPayment);
router.post('/manual-payment-notify', merchController.manualPaymentNotify);

export const saveRequestRouter = Router();
saveRequestRouter.post('/', merchController.createSaveRequest);

export const adminMerchRouter = Router();
adminMerchRouter.get('/merch-orders', requireAuth, merchController.adminListOrders);
adminMerchRouter.patch('/merch-orders/:id/status', requireAuth, merchController.adminUpdateOrderStatus);
adminMerchRouter.delete('/merch-orders/:id', requireAuth, merchController.adminDeleteOrder);
adminMerchRouter.get('/merch-save-requests', requireAuth, merchController.adminListSaveRequests);
adminMerchRouter.patch('/merch-save-requests/:id/status', requireAuth, merchController.adminUpdateSaveRequestStatus);

export default router;
