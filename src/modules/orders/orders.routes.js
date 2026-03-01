const express = require('express');
const { optionalAuth } = require('../../middleware/auth');

const router = express.Router();

// POST /api/orders (create order; optional auth)
router.post('/', optionalAuth, (req, res) => {
  res.status(501).json({ error: 'Orders not implemented; add Order table and controller' });
});

// POST /api/orders/verify
router.post('/verify', (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
