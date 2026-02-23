import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';
import {
  getDashboardStats,
  getAdminEvents,
  getSales,
  getAdmins,
  deleteAdmin,
  deleteEventOrders,
  verifyTicket,
  getWithdrawPage,
  withdrawEvent,
  getBankAccount,
  saveBankAccount,
  getPaystackBanks,
  getTopUsersAdmin,
  createTopUser,
  updateTopUser,
  deleteTopUser,
} from './admin.controller.js';

const router = Router();

// Dashboard
router.get('/dashboard', authMiddleware, getDashboardStats);

// Events (super admin: all + creator name; others: own only)
router.get('/events', authMiddleware, getAdminEvents);

// Sales
router.get('/sales', authMiddleware, getSales);

// Admins list (super admin only)
router.get('/admins', authMiddleware, getAdmins);
// Delete an admin account (super admin only)
router.delete('/admins/:userId', authMiddleware, deleteAdmin);

// Delete all sales/orders for an event
router.delete('/events/:eventId/orders', authMiddleware, deleteEventOrders);

// Verify ticket (scan) – all admins
router.post('/verify-ticket', authMiddleware, verifyTicket);

// Withdraw page data
router.get('/withdraw', authMiddleware, getWithdrawPage);

// Initiate withdrawal for an event
router.post('/withdraw/:eventId', authMiddleware, withdrawEvent);

// Bank account management
router.get('/bank-account', authMiddleware, getBankAccount);
router.post('/bank-account', authMiddleware, saveBankAccount);

// Paystack bank list (for dropdown)
router.get('/banks', authMiddleware, getPaystackBanks);

// Top users (landing carousel)
router.get('/top-users', authMiddleware, getTopUsersAdmin);
router.post('/top-users', authMiddleware, createTopUser);
router.patch('/top-users/:id', authMiddleware, updateTopUser);
router.delete('/top-users/:id', authMiddleware, deleteTopUser);

export default router;
