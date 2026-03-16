import 'dotenv/config';

const corsOrigin = process.env.CORS_ORIGIN || '';
const frontendBaseUrl = (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const defaultCorsOrigins = [
  frontendBaseUrl,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://gatewav.com',
  'https://www.gatewav.com',
];
const resendApiKey = process.env.RESEND_API_KEY || '';
const resendFrom = process.env.RESEND_FROM || 'Gatewav <onboarding@gatewav.com>';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  resendApiKey,
  resendFrom,
  resend: { apiKey: resendApiKey, from: resendFrom },
  frontendBaseUrl,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  corsOrigins: corsOrigin
    ? corsOrigin.split(',').map((s) => s.trim()).filter(Boolean)
    : [...new Set(defaultCorsOrigins)],
};
