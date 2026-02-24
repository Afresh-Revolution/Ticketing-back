import 'dotenv/config';

const required = ['DATABASE_URL'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`[config] Missing env: ${missing.join(', ')}. Using defaults may cause runtime errors.`);
}

/** Comma-separated list of allowed origins for CORS, e.g. "http://localhost:5173,https://myapp.vercel.app" */
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  : [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://ticketing-wu55t.ondigitalocean.app',
      'https://gatewav.com',
    ];

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  directUrl: process.env.DIRECT_URL,
  isDev: process.env.NODE_ENV !== 'production',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.RESEND_FROM || 'Gatewave <onboarding@resend.dev>',
  },
  /** Optional: if set, GET /api/events/feed/joscity requires this key via X-API-Key or Authorization: Bearer <key> */
  joscityApiKey: process.env.JOSCITY_API_KEY || '',
  /** Base URL for resolving relative event cover URLs (used in JOSCITY feed). */
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://ticketing-back.onrender.com',
  /** Frontend base URL for "Get tickets" links in JOSCITY feed (e.g. https://gatewav.com). */
  publicFrontendUrl: process.env.PUBLIC_FRONTEND_URL || '',
};

