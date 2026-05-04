import express from 'express';
import * as landingController from './landing.controller.js';

const router = express.Router();

router.get('/top-users', landingController.getTopUsers);
router.get('/top_users', landingController.getTopUsers);
router.get('/videos', landingController.getLandingVideos);

export default router;
