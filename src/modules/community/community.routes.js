import { Router } from 'express';
import { optionalAuth } from '../../shared/middleware/authMiddleware.js';
import * as gatewaveController from './gatewave/gatewave.controller.js';
import * as categoriesController from './categories/categories.controller.js';
import * as upcomingEventsController from './upcomingEvents/upcomingEvents.controller.js';
import * as footerController from './footer/footer.controller.js';

const router = Router();

router.get('/gatewave', optionalAuth, gatewaveController.getGatewave);
router.get('/categories', categoriesController.getCategories);
router.get('/upcomingEvents', upcomingEventsController.getUpcomingEvents);
router.get('/footer', footerController.getFooter);

export default router;
