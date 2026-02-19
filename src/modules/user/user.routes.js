import { Router } from 'express';
import * as userPageController from './userPage/userPage.controller.js';
import * as footerController from './footer/footer.controller.js';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/profile', userPageController.getProfile);
router.get('/tickets', userPageController.getMyTickets);
router.get('/orders', userPageController.getMyOrders);
router.get('/footer', footerController.getFooter);

export default router;
