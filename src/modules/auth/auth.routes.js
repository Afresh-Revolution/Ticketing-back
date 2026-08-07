import express from 'express';
import * as authController from './auth.controller.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';

const router = express.Router();

// Organizer (Become an Organizer) – no auth required
router.post('/organizer-signup', authController.organizerSignup);
router.post('/organizer-verify-otp', authController.organizerVerifyOtp);

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    endpoints: [
      'POST /api/auth/signin',
      'POST /api/auth/signup',
      'POST /api/auth/organizer-signup',
      'POST /api/auth/organizer-verify-otp',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password',
      'POST /api/auth/resend-verification',
      'POST /api/auth/delete-account',
    ],
  });
});

router.post('/signin', authController.signIn);
router.post('/signup', authController.signUp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/resend-verification', authController.resendVerification);
router.post('/create-admin', requireAuth, requireSuperAdmin, authController.createAdmin);

/** Alias for clients that prefer POST over DELETE with a body */
router.post('/delete-account', requireAuth, async (req, res, next) => {
  try {
    const { deleteAccount } = await import('../user/user.controller.js');
    return deleteAccount(req, res);
  } catch (err) {
    return next(err);
  }
});

export default router;
