import express from 'express';
import * as adminController from './admin.controller.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

router.get('/dashboard', requireAuth, adminController.getDashboard);
router.get('/admins', requireAuth, adminController.listAdmins);
router.delete('/admins/:id', requireAuth, adminController.deleteAdmin);
router.get('/sales', requireAuth, adminController.getSales);
router.get('/events', requireAuth, adminController.listAdminEvents);
router.get('/events/:eventId/orders', requireAuth, adminController.getEventOrders);
router.post('/verify-ticket', requireAuth, adminController.verifyTicket);
router.get('/banks', requireAuth, adminController.getBanks);
router.get('/bank-account', requireAuth, adminController.getBankAccount);
router.post('/bank-account', requireAuth, adminController.saveBankAccount);
router.get('/withdraw', requireAuth, adminController.listWithdrawals);
router.post('/withdraw/:eventId', requireAuth, adminController.createWithdrawal);
router.get('/top-users', requireAuth, adminController.listTopUsers);
router.post('/top-users', requireAuth, adminController.createTopUser);
router.patch('/top-users/:id', requireAuth, adminController.updateTopUser);
router.delete('/top-users/:id', requireAuth, adminController.deleteTopUser);
router.get('/password-change-status', requireAuth, adminController.getPasswordChangeStatus);
router.post('/verify-password', requireAuth, adminController.verifyPassword);
router.post('/change-password', requireAuth, adminController.changePassword);

export default router;
