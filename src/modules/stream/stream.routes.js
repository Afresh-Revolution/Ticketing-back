/**
 * Mount in the Express app:
 *   import streamRoutes from './modules/stream/stream.routes.js';
 *   app.use('/api/admin/stream', streamRoutes);
 */
import { Router } from 'express';
import * as streamController from './stream.controller.js';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';

const router = Router();

router.get('/events', authMiddleware, streamController.listStreamEvents);
router.get('/events/:eventId', authMiddleware, streamController.getStreamEvent);
router.patch('/events/:eventId', authMiddleware, streamController.updateStreamConfig);
router.post('/events/:eventId/go-live', authMiddleware, streamController.goLive);
router.post('/events/:eventId/end-live', authMiddleware, streamController.endLive);

export default router;
