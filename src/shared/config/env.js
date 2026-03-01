import 'dotenv/config';

const corsOrigin = process.env.CORS_ORIGIN || '';
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFrom: process.env.RESEND_FROM || 'Gatewave <onboarding@resend.dev>',
  frontendBaseUrl: (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  corsOrigins: corsOrigin ? corsOrigin.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
};
