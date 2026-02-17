import { Router } from 'express';
import * as orderController from './order.controller.js';
import { optionalAuth } from '../../shared/middleware/authMiddleware.js';

const router = Router();

// Create order (optional auth to attach user if logged in)
router.post('/', optionalAuth, orderController.create);

// Verify payment
router.post('/verify', orderController.verify);

export default router;
