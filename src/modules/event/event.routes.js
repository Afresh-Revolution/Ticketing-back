import { Router } from 'express';
import * as eventController from './event.controller.js';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';

const router = Router();

router.get('/', eventController.list);
router.get('/:id', eventController.getById);
router.post('/', authMiddleware, eventController.create);
router.patch('/:id', authMiddleware, eventController.update);
router.delete('/:id', authMiddleware, eventController.remove);

export default router;
