import { Router } from 'express';
import * as heroController from './hero/hero.controller.js';
import * as everyoneController from './everyone/everyone.controller.js';
import * as whyChooseUsController from './whyChooseUs/whyChooseUs.controller.js';
import * as trendingController from './trending/trending.controller.js';
import * as joinController from './join/join.controller.js';
import * as footerController from './footer/footer.controller.js';

const router = Router();

router.get('/hero', heroController.getHero);
router.get('/everyone', everyoneController.getEveryone);
router.get('/whyChooseUs', whyChooseUsController.getWhyChooseUs);
router.get('/trending', trendingController.getTrending);
router.get('/join', joinController.getJoin);
router.get('/footer', footerController.getFooter);

export default router;
