import 'dotenv/config';

const required = ['DATABASE_URL', 'DIRECT_URL'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`[config] Missing env: ${missing.join(', ')}. Using defaults may cause runtime errors.`);
}

/** Comma-separated list of allowed origins for CORS, e.g. "http://localhost:5173,https://myapp.vercel.app" */
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:3000'];

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  directUrl: process.env.DIRECT_URL,
  isDev: process.env.NODE_ENV !== 'production',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins,
};
