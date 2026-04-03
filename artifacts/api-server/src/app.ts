import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator as erlIpKeyGen } from "express-rate-limit";
import hpp from "hpp";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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

const getClientKey = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.ip || "unknown";
  return erlIpKeyGen(raw);
};

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes. Veuillez reessayer plus tard." },
  keyGenerator: getClientKey,
  validate: { xForwardedForHeader: false },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite d'analyse IA atteinte. Veuillez reessayer dans une minute." },
  keyGenerator: getClientKey,
  validate: { xForwardedForHeader: false },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes d'ecriture. Veuillez reessayer plus tard." },
  keyGenerator: getClientKey,
  validate: { xForwardedForHeader: false },
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(hpp());

app.disable("x-powered-by");

app.use("/api/ai", aiLimiter);
app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return strictLimiter(req, _res, next);
  }
  return generalLimiter(req, _res, next);
});

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message }, "Unhandled error");

  if (isProduction) {
    res.status(500).json({ error: "Une erreur interne est survenue." });
  } else {
    res.status(500).json({ error: err.message });
  }
});

export default app;
