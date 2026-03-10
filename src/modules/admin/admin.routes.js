import { Router } from 'express';
import * as adminController from './admin.controller.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';

const router = Router();

router.get('/dashboard', requireAuth, adminController.getDashboard);
router.get('/admins', requireAuth, requireSuperAdmin, adminController.listAdmins);
router.get('/sales', requireAuth, adminController.getSales);
router.get('/events', requireAuth, adminController.listAdminEvents);
router.get('/events/:eventId/orders', requireAuth, adminController.getEventOrders);
router.patch('/events/:eventId/visibility', requireAuth, adminController.patchEventVisibility);
router.get('/events/:eventId', requireAuth, adminController.getAdminEvent);
router.get('/withdraw', requireAuth, adminController.getWithdrawPage);
router.post('/withdraw/:eventId', requireAuth, adminController.createWithdrawal);
router.get('/banks', requireAuth, adminController.getBanks);
router.get('/bank-account', requireAuth, adminController.getBankAccount);
router.post('/bank-account', requireAuth, adminController.saveBankAccount);
router.get('/top-users', requireAuth, adminController.listTopUsers);
router.post('/top-users', requireAuth, adminController.createTopUser);
router.patch('/top-users/:id', requireAuth, adminController.updateTopUser);
router.delete('/top-users/:id', requireAuth, adminController.deleteTopUser);
router.get('/password-change-status', requireAuth, adminController.getPasswordChangeStatus);
router.post('/verify-password', requireAuth, adminController.verifyPassword);
router.post('/change-password', requireAuth, adminController.changePassword);

export default router;
