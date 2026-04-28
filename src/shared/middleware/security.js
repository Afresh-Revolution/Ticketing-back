import cors from "cors";
import { config } from "../config/env.js";

function normalizeOrigin(origin) {
  return String(origin || "")
    .replace(/\/$/, "")
    .toLowerCase();
}

const allowedOrigins = new Set(
  (config.corsOrigins || []).map(normalizeOrigin).filter(Boolean),
);

export const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server requests (no Origin header)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(normalizeOrigin(origin)))
      return callback(null, true);
    return callback(new Error("CORS_ORIGIN_DENIED"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
};

export function applySecurityMiddleware(app) {
  app.set("trust proxy", 1);

  app.disable("x-powered-by");

  app.use(cors(corsOptions));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (config.nodeEnv === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains; preload",
      );
    }
    next();
  });

  app.use((req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (
      ["POST", "PUT", "PATCH"].includes(req.method) &&
      contentType &&
      !String(contentType).toLowerCase().includes("application/json") &&
      !String(contentType)
        .toLowerCase()
        .includes("application/x-www-form-urlencoded")
    ) {
      return res.status(415).json({ error: "Unsupported Media Type" });
    }
    return next();
  });
}

export function createRateLimit({ windowMs, max, message }) {
  const store = new Map();

  return (req, res, next) => {
    const ip =
      req.ip ||
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "unknown";
    const key = `${String(ip)}:${req.path}`;
    const now = Date.now();

    const bucket = store.get(key);
    if (!bucket || now > bucket.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message || "Too many requests" });
    }

    return next();
  };
}
