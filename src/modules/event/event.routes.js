import { Router } from 'express';
import multer from 'multer';
import * as eventController from './event.controller.js';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files are allowed'));
  },
});

router.get('/', eventController.list);
router.get('/feed/joscity', eventController.listForJoscity);
router.get('/:id', eventController.getById);
router.post('/upload-image', authMiddleware, upload.single('image'), eventController.uploadImage);
router.post('/', authMiddleware, eventController.create);
router.patch('/:id', authMiddleware, eventController.update);
router.put('/:id', authMiddleware, eventController.update);
router.patch('/:id/trending', authMiddleware, eventController.toggleTrending);
router.delete('/:id', authMiddleware, eventController.remove);

export default router;
