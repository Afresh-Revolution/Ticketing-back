import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authMiddleware } from '../../shared/middleware/authMiddleware.js';

const router = Router();

router.get('/login-form', authController.getLoginForm);
router.post('/signup', authController.signUp);
router.post('/signin', authController.signIn);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/resend-verification', authController.resendVerification);
router.post('/create-admin', authMiddleware, authController.createAdmin);

export default router;
