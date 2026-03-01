const express = require('express');
const { requireAuth } = require('../../middleware/auth');

const router = express.Router();

// GET /api/events (public list; ?trending=true&take=3)
router.get('/', (req, res) => {
  res.json([]);
});

// GET /api/events/:id (public event detail)
router.get('/:id', (req, res) => {
  res.status(404).json({ error: 'Event not found' });
});

// POST /api/events (admin create)
router.post('/', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Events create not implemented; add Event table and controller' });
});

// PATCH /api/events/:id (admin update)
router.patch('/:id', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// DELETE /api/events/:id
router.delete('/:id', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// PATCH /api/events/:id/trending
router.patch('/:id/trending', requireAuth, (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
