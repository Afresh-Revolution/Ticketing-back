import { Router } from 'express';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';
import {
  getDashboardStats,
  getSales,
  getWithdrawPage,
  withdrawEvent,
  getBankAccount,
  saveBankAccount,
  getPaystackBanks,
} from './admin.controller.js';

const router = Router();

// Dashboard
router.get('/dashboard', authMiddleware, getDashboardStats);

// Sales reports
router.get('/sales', authMiddleware, getSales);

// Withdraw page data
router.get('/withdraw', authMiddleware, getWithdrawPage);

// Initiate withdrawal for an event
router.post('/withdraw/:eventId', authMiddleware, withdrawEvent);

// Bank account management
router.get('/bank-account', authMiddleware, getBankAccount);
router.post('/bank-account', authMiddleware, saveBankAccount);

// Paystack bank list (for dropdown)
router.get('/banks', authMiddleware, getPaystackBanks);

export default router;
