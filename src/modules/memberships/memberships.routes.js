const express = require('express');
const membershipsController = require('./memberships.controller');
const { requireAuth, requireSuperAdmin } = require('../../middleware/auth');

const router = express.Router();

router.get('/plans', membershipsController.getPlans);
router.post('/plans', requireAuth, requireSuperAdmin, membershipsController.createPlan);
router.patch('/plans/:id', requireAuth, requireSuperAdmin, membershipsController.updatePlan);
router.post('/', requireAuth, membershipsController.createMembership);
router.get('/my', requireAuth, membershipsController.getMyMembership);
router.post('/cancel', requireAuth, membershipsController.cancelMembership);
router.post('/resubscribe', requireAuth, membershipsController.resubscribeMembership);

module.exports = router;
