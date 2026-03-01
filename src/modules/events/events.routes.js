import express from 'express';
import * as eventsController from './events.controller.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

router.get('/', eventsController.listEvents);
router.get('/:id', eventsController.getEvent);
router.post('/', requireAuth, eventsController.createEvent);
router.patch('/:id', requireAuth, eventsController.updateEvent);
router.patch('/:id/trending', requireAuth, eventsController.setTrending);
router.delete('/:id', requireAuth, eventsController.deleteEvent);

export default router;
