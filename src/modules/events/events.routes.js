import express from 'express';
import multer from 'multer';
import * as eventsController from './events.controller.js';
import * as streamController from '../stream/stream.controller.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files are allowed'));
  },
});

router.get('/', eventsController.listEvents);
router.get('/:id/live-status', streamController.getLiveStatus);
router.get('/:id/stream', streamController.getStreamAccess);
router.get('/:id', eventsController.getEvent);
router.post('/upload-image', requireAuth, upload.single('image'), eventsController.uploadImage);
router.post('/', requireAuth, eventsController.createEvent);
router.patch('/:id/trending', requireAuth, eventsController.setTrending);
router.patch('/:id', requireAuth, eventsController.updateEvent);
router.put('/:id', requireAuth, eventsController.updateEvent);
router.delete('/:id', requireAuth, eventsController.deleteEvent);

export default router;
