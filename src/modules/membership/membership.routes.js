import express from 'express';
import * as membershipController from './membership.controller.js';
import { authMiddleware, authorizeRole } from '../../shared/middleware/authMiddleware.js';

const router = express.Router();

// Public Plans
router.get('/plans', membershipController.getPlans);

// Protected User Routes
router.post('/', authMiddleware, membershipController.createMembership);
router.get('/my', authMiddleware, membershipController.getMyMembership);

// Admin Routes (Plans)
router.post('/plans', authMiddleware, authorizeRole(['admin', 'superadmin']), membershipController.createPlan);
router.patch('/plans/:id', authMiddleware, authorizeRole(['admin', 'superadmin']), membershipController.updatePlan);

// Admin Routes (Memberships)
router.get('/', authMiddleware, authorizeRole(['admin', 'superadmin']), membershipController.getAllMemberships);
router.patch('/:id', authMiddleware, authorizeRole(['admin', 'superadmin']), membershipController.updateMembershipStatus);

export default router;
