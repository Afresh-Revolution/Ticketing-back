import express from 'express';
import cors from 'cors';
import { config } from './shared/config/env.js';
import { prisma } from './shared/config/db.js';
import { errorHandler } from './shared/middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import landingRoutes from './modules/landing/landing.routes.js';
import communityRoutes from './modules/community/community.routes.js';
import bookingRoutes from './modules/booking/booking.routes.js';
import userRoutes from './modules/user/user.routes.js';
import eventRoutes from './modules/event/event.routes.js';

const app = express();

app.use(cors({
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health
app.get('/health', async (req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
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
app.use('/api/auth', authRoutes);
app.use('/api/landing', landingRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/user', userRoutes);
app.use('/api/events', eventRoutes);

app.get('/api', (req, res) => {
  res.json({
    name: 'Gatewave API',
    version: '1.0',
    endpoints: ['/api/auth', '/api/landing', '/api/community', '/api/booking', '/api/user', '/api/events'],
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use(errorHandler);

export default app;
