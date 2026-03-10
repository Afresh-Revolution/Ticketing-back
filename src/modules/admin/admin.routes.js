import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';
import * as adminController from './admin.controller.js';

const router = Router();

router.get('/dashboard', authMiddleware, adminController.getDashboard);
router.get('/events', authMiddleware, adminController.listAdminEvents);
router.get('/events/:eventId', authMiddleware, adminController.getAdminEvent);
router.get('/events/:eventId/orders', authMiddleware, adminController.getEventOrders);
router.get('/sales', authMiddleware, adminController.getSales);

export default router;
