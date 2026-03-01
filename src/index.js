import 'dotenv/config';

// Optional: allow outbound HTTPS with self-signed/invalid certs (e.g. corporate proxy, Resend).
// Set ALLOW_INSECURE_TLS_OUTBOUND=1 only if you get "self-signed certificate in certificate chain" from email/APIs.
if (process.env.ALLOW_INSECURE_TLS_OUTBOUND === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import express from 'express';
import cors from 'cors';
import { config } from './shared/config/env.js';
import * as authController from './modules/auth/auth.controller.js';
import authRoutes from './modules/auth/auth.routes.js';
import landingRoutes from './modules/landing/landing.routes.js';
import ordersRoutes from './modules/orders/orders.routes.js';
import eventsRoutes from './modules/events/events.routes.js';
import userRoutes from './modules/user/user.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Organizer signup (Become an Organizer) – ensure these are always available
app.post('/api/auth/organizer-signup', authController.organizerSignup);
app.post('/api/auth/organizer-verify-otp', authController.organizerVerifyOtp);

app.use('/api/auth', authRoutes);
app.use('/api/landing', landingRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = config.port;
app.listen(port, () => {
  console.log(`Ticketing-back listening on port ${port}`);
});
