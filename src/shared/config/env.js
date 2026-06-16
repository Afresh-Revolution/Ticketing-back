import 'dotenv/config';

const corsOrigin = process.env.CORS_ORIGIN || '';
const nodeEnv = process.env.NODE_ENV || 'development';
const frontendBaseUrl = (
  process.env.FRONTEND_BASE_URL ||
  process.env.PUBLIC_FRONTEND_URL ||
  (nodeEnv === 'production' ? 'https://gatewav.com' : 'http://localhost:5173')
).replace(/\/$/, '');
const defaultCorsOrigins = [
  frontendBaseUrl,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://gatewav.com',
  'https://www.gatewav.com',
  'http://localhost:63823'
];
const resendApiKey = process.env.RESEND_API_KEY || '';
const resendFrom = process.env.RESEND_FROM || 'Gatewav <onboarding@gatewav.com>';
const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY || '';
const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET || '';
const manualPaymentNotifyEmail = String(process.env.MANUAL_PAYMENT_NOTIFY_EMAIL || '').trim();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
  resendApiKey,
  resendFrom,
  resend: { apiKey: resendApiKey, from: resendFrom },
  cloudinaryCloudName,
  cloudinaryApiKey,
  cloudinaryApiSecret,
  manualPaymentNotifyEmail,
  frontendBaseUrl,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  corsOrigins: corsOrigin
    ? corsOrigin.split(',').map((s) => s.trim()).filter(Boolean)
    : [...new Set(defaultCorsOrigins)],
};
