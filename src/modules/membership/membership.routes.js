import express from 'express';
import * as membershipController from './membership.controller.js';
import { authenticateToken, authorizeRole } from '../../shared/middleware/authMiddleware.js'; // Assuming these exist

const router = express.Router();

// Public Plans
router.get('/plans', membershipController.getPlans);

// Protected User Routes
router.post('/', authenticateToken, membershipController.createMembership);
router.get('/my', authenticateToken, membershipController.getMyMembership);

// Admin Routes (Plans)
router.post('/plans', authenticateToken, authorizeRole(['admin', 'superadmin']), membershipController.createPlan);
router.patch('/plans/:id', authenticateToken, authorizeRole(['admin', 'superadmin']), membershipController.updatePlan);

// Admin Routes (Memberships)
router.get('/', authenticateToken, authorizeRole(['admin', 'superadmin']), membershipController.getAllMemberships);
router.patch('/:id', authenticateToken, authorizeRole(['admin', 'superadmin']), membershipController.updateMembershipStatus);

export default router;
