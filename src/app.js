import express from 'express';
import { config } from './shared/config/env.js';
import { query } from './shared/config/db.js';
import { errorHandler } from './shared/middleware/errorHandler.js';
import { applySecurityMiddleware, createRateLimit } from './shared/middleware/security.js';
import authRoutes from './modules/auth/auth.routes.js';
import landingRoutes from './modules/landing/landing.routes.js';
import communityRoutes from './modules/community/community.routes.js';
import bookingRoutes from './modules/booking/booking.routes.js';
import userRoutes from './modules/user/user.routes.js';
import eventRoutes from './modules/event/event.routes.js';
import orderRoutes from './modules/order/order.routes.js';
import membershipRoutes from './modules/membership/membership.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import merchOrderRoutes, { saveRequestRouter } from './modules/merch/merch.routes.js';

const app = express();

applySecurityMiddleware(app);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

const authRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: 'Too many auth requests. Please try again later.' });
const adminRateLimit = createRateLimit({ windowMs: 60 * 1000, max: 120, message: 'Too many admin requests. Please slow down.' });
const paymentRateLimit = createRateLimit({ windowMs: 60 * 1000, max: 30, message: 'Too many payment-related requests. Please retry shortly.' });

// Health
app.get('/health', async (req, res) => {
  let dbOk = false;
  try {
    await query('SELECT 1');
    dbOk = true;
  } catch {
    // ignore
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbOk ? 'connected' : 'disconnected',
  });
});

// API modules
app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api/landing', landingRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/user', userRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/orders', paymentRateLimit, orderRoutes);
app.use('/api/merch-orders', paymentRateLimit, merchOrderRoutes);
app.use('/api/merch-save-requests', saveRequestRouter);
app.use('/api/memberships', membershipRoutes);
app.use('/api/admin', adminRateLimit, adminRoutes);

app.get('/api', (req, res) => {
  res.json({
    name: 'Gatewave API',
    version: '1.0',
    endpoints: [
      '/api/auth',
      '/api/landing',
      '/api/community',
      '/api/booking',
      '/api/user',
      '/api/events',
      '/api/events/feed/joscity', // JOSCITY integration – GET for event list
    ],
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use(errorHandler);

export default app;
