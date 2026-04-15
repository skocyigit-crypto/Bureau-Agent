import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import hpp from "hpp";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import router from "./routes";
import crypto from "crypto";
import { logger } from "./lib/logger";
import { ipProtection, threatDetection, csrfProtection } from "./middleware/security";

const app: Express = express();

app.set("trust proxy", 1);

const isProduction = process.env.NODE_ENV === "production";

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  noSniff: true,
  xssFilter: true,
}));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : undefined;

app.use(cors({
  origin: allowedOrigins || true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
}));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes. Veuillez reessayer plus tard." },
  validate: { xForwardedForHeader: false, ip: false },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite d'analyse IA atteinte. Veuillez reessayer dans une minute." },
  validate: { xForwardedForHeader: false, ip: false },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes d'ecriture. Veuillez reessayer plus tard." },
  validate: { xForwardedForHeader: false, ip: false },
});

app.use("/api/document-ai", express.json({ limit: "15mb" }));
app.use("/api/documents", express.json({ limit: "40mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(hpp());

app.disable("x-powered-by");

const PgStore = connectPgSimple(session);

app.use(session({
  store: new PgStore({
    conString: process.env.DATABASE_URL,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60,
  }),
  name: "adb.sid",
  secret: (() => {
    const s = process.env.SESSION_SECRET;
    if (s) return s;
    if (isProduction) {
      console.error("FATAL: SESSION_SECRET est requis en production.");
      process.exit(1);
    }
    const devSecret = crypto.randomBytes(32).toString("hex");
    console.warn("[Security] SESSION_SECRET non defini — cle aleatoire generee (dev uniquement).");
    return devSecret;
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    path: "/",
  },
}));

app.use(ipProtection);

app.use("/api/ai", aiLimiter);
app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return strictLimiter(req, _res, next);
  }
  return generalLimiter(req, _res, next);
});

app.use("/api", threatDetection);
app.use("/api", csrfProtection);

app.use("/api", router);

app.use((err: Error & { status?: number; statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    logger.warn({ err: err.message }, "Error after headers sent");
    return;
  }

  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;

  if (isServerError) {
    logger.error({
      err: err.message,
      stack: err.stack,
      code: err.code,
      method: _req.method,
      url: _req.originalUrl,
    }, "Server error");
  } else {
    logger.warn({ err: err.message, status }, "Client error");
  }

  if (err.code === "EBADCSRFTOKEN") {
    res.status(403).json({ error: "Session invalide. Veuillez rafraîchir la page." });
    return;
  }

  if (err.message?.includes("ECONNREFUSED") || err.message?.includes("ECONNRESET")) {
    res.status(503).json({ error: "Service temporairement indisponible. Veuillez réessayer." });
    return;
  }

  if (isProduction && isServerError) {
    res.status(status).json({ error: "Une erreur interne est survenue." });
  } else {
    res.status(status).json({ error: err.message || "Erreur inconnue" });
  }
});

export default app;
