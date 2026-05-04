import "dotenv/config";

// Optional: allow outbound HTTPS with self-signed/invalid certs (e.g. corporate proxy, Resend).
// Set ALLOW_INSECURE_TLS_OUTBOUND=1 only if you get "self-signed certificate in certificate chain" from email/APIs.
if (process.env.ALLOW_INSECURE_TLS_OUTBOUND === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import express from "express";
import { config } from "./shared/config/env.js";
import { ensureUserSequence, ensureTopUserColumns } from "./shared/config/db.js";
import {
  applySecurityMiddleware,
  createRateLimit,
} from "./shared/middleware/security.js";
import * as authController from "./modules/auth/auth.controller.js";
import authRoutes from "./modules/auth/auth.routes.js";
import landingRoutes from "./modules/landing/landing.routes.js";
import ordersRoutes from "./modules/orders/orders.routes.js";
import eventsRoutes from "./modules/events/events.routes.js";
import userRoutes from "./modules/user/user.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";

const app = express();
applySecurityMiddleware(app);
app.use(express.json({ limit: "100kb" }));

const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many auth requests. Please try again later.",
});
const adminRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many admin requests. Please slow down.",
});
const paymentRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many payment-related requests. Please retry shortly.",
});

// Organizer signup (Become an Organizer) – ensure these are always available
app.post("/api/auth/organizer-signup", authController.organizerSignup);
app.post("/api/auth/organizer-verify-otp", authController.organizerVerifyOtp);

app.use("/api/auth", authRateLimit, authRoutes);
app.use("/api/landing", landingRoutes);
app.use("/api/orders", paymentRateLimit, ordersRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRateLimit, adminRoutes);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = config.port;
ensureUserSequence()
  .then(() => ensureTopUserColumns())
  .then(() => {
    app.listen(port, () => {
      console.log(`Ticketing-back listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
