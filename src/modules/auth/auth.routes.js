const express = require('express');
const authController = require('./auth.controller');
const { requireAuth, requireSuperAdmin } = require('../../middleware/auth');

const router = express.Router();

router.post('/signin', authController.signIn);
router.post('/signup', authController.signUp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/resend-verification', authController.resendVerification);
router.post('/create-admin', requireAuth, requireSuperAdmin, authController.createAdmin);
router.post('/organizer-signup', authController.organizerSignup);
router.post('/organizer-verify-otp', authController.organizerVerifyOtp);

module.exports = router;
