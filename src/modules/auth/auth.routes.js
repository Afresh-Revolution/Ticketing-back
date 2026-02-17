import { Router } from 'express';
import * as authController from './auth.controller.js';

const router = Router();

router.get('/login-form', authController.getLoginForm);
router.post('/signup', authController.signUp);
router.post('/signin', authController.signIn);

export default router;
