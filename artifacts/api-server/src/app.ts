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
import { hydrateFromBearer } from "./middleware/auth";
import { guardian } from "./middleware/guardian";
import { resolveClientIp } from "./lib/request-ip";

const app: Express = express();

app.set("trust proxy", 1);

const isProduction = process.env.NODE_ENV === "production";

// CSP for API responses. The /api/* surface is JSON-only, so the policy is
// intentionally tighter than the SPA CSP (script-src 'none' — there is no
// case where the API legitimately serves HTML+inline JS):
//   - baseUri 'none'     blocks <base> tag injection in any future HTML response
//   - formAction 'none'  there are no <form> targets here
//   - frameAncestors     'none' prevents clickjacking + replaces X-Frame-Options
//   - upgradeInsecureRequests in production only (causes false positives in dev)
// En developpement Replit, l'iframe Canvas charge depuis *.spock.replit.dev.
// On garde frame-ancestors strict en prod, mais on relache pour permettre
// l'apercu Replit en dev (sinon le proxy preview reflete les pages d'API
// dans un iframe et ecran blanc). La JSON API n'est de toute facon jamais
// embarquee directement par les utilisateurs finaux.
const FRAME_ANCESTORS_DEV = ["'self'", "https://*.replit.dev", "https://*.repl.co", "https://replit.com", "https://*.spock.replit.dev"];

const cspDirectives: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "https:"],
  connectSrc: ["'self'"],
  fontSrc: ["'self'", "https:"],
  objectSrc: ["'none'"],
  mediaSrc: ["'self'"],
  frameSrc: ["'none'"],
  frameAncestors: isProduction ? ["'none'"] : FRAME_ANCESTORS_DEV,
  baseUri: ["'none'"],
  formAction: ["'none'"],
};
if (isProduction) {
  cspDirectives.upgradeInsecureRequests = [];
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
  // COOP/CORP isolate the JSON API from cross-origin window references and
  // sub-resource embedding. En prod: same-origin (strictest). En dev: CORP
  // doit etre cross-origin sinon l'iframe Replit (cross-site) ne peut pas
  // recevoir les reponses JSON depuis l'API meme via fetch -> ecran blanc.
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: isProduction ? "same-origin" : "cross-origin" },
  hsts: {
    // 2 ans (63072000s) — exigence du Chrome HSTS preload list. Le precedent
    // 1 an etait conforme RFC mais hors limites pour la soumission preload.
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
  },
  // CSP `frame-ancestors` est deja la defense moderne. XFO DENY est strictement
  // plus fort mais ignore les whitelists CSP -> on le desactive en dev pour
  // permettre l'apercu Replit, et on le reactive en prod via helmet OU le
  // reverse proxy de deploiement (deploy/Caddyfile).
  frameguard: isProduction ? { action: "deny" } : false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  noSniff: true,
  xssFilter: true,
}));

// Permissions-Policy (anciennement Feature-Policy). Helmet n'a pas de helper
// pour ce header, on l'ajoute manuellement. Pour une API JSON server-side
// pure, AUCUNE de ces capacites navigateur ne devrait etre activee.
// `interest-cohort=()` neutralise le tracking FLoC/Topics que Chrome tente
// d'activer par defaut.
//
// NB: les directives suivantes ont ete retirees apres avoir genere des
// warnings "Unrecognized feature" en console (Chromium les a deprecees ou
// renommees): ambient-light-sensor, battery, document-domain,
// execution-while-not-rendered, execution-while-out-of-viewport,
// navigation-override, web-share. Conserver uniquement les directives
// reconnues evite la pollution de la console et n'affaiblit pas la
// politique — un nom inconnu est de toute facon ignore par le navigateur.
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "cross-origin-isolated=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "identity-credentials-get=()",
  "idle-detection=()",
  "interest-cohort=()",
  "keyboard-map=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "sync-xhr=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  // Defense-in-depth: relique Adobe Flash mais toujours exigee par les
  // outils de scan SAST (ASVS V14.4.5). `none` interdit Flash/Acrobat
  // de charger une crossdomain.xml politique cross-origin sur ce domaine.
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  next();
});

// Cache-Control strict pour TOUTES les reponses /api/auth/*: aucun proxy
// intermediaire, CDN, navigateur ou extension ne doit cacher une reponse
// authentifiee (donnees de session, profil, tokens). Sans cet en-tete,
// un proxy partage peut servir le profil de l'utilisateur A a
// l'utilisateur B (incident classique de fuite de session).
//   - no-store: jamais sur disque
//   - no-cache: revalidation systematique
//   - must-revalidate: si stale, refus de servir
//   - private: jamais dans un cache partage
app.use("/api/auth", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(
  pinoHttp({
    logger,
    // Reduit la verbosite des healthchecks/probes
    autoLogging: {
      ignore: (req) => {
        const u = (req.url || "").split("?")[0];
        return u === "/api/healthz" || u === "/api/health" || u === "/healthz";
      },
    },
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

// ── CORS allowlist resolution ──────────────────────────────────────────────
// En production, on REFUSE le mode "reflect=true" (Access-Control-Allow-Origin
// echoant l'Origin du client) car associe a `credentials: true` il revient a
// desactiver toute protection CORS. Donc une allowlist explicite est requise.
//
// Resolution dans cet ordre:
//   1. ALLOWED_ORIGINS env (CSV) — override explicite par l'admin.
//   2. REPLIT_DOMAINS env (CSV) — fournie automatiquement par la plateforme
//      Replit en deploiement (custom domain ou .replit.app). On y ajoute le
//      schema https:// et on dedupe.
//   3. PUBLIC_URL / APP_URL — fallback final si l'admin n'a configure que ca.
// Si APRES ces trois passes la liste reste vide en production, on hard-fail
// pour eviter un deploiement accidentellement world-CORS.
function resolveAllowedOrigins(): string[] {
  const out = new Set<string>();
  const explicit = process.env.ALLOWED_ORIGINS;
  if (explicit) {
    explicit.split(",").map(o => o.trim()).filter(Boolean).forEach(o => out.add(o));
  }
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    replitDomains.split(",").map(d => d.trim()).filter(Boolean).forEach(d => {
      // REPLIT_DOMAINS vient sans schema -> on prefixe https.
      const url = d.startsWith("http://") || d.startsWith("https://") ? d : `https://${d}`;
      out.add(url);
    });
  }
  for (const envName of ["PUBLIC_URL", "APP_URL", "REPLIT_DEPLOYMENT_URL"]) {
    const v = process.env[envName];
    if (v) {
      try {
        out.add(new URL(v).origin);
      } catch { /* ignore malformed */ }
    }
  }
  // Expo dev sert le bundle mobile depuis un sous-domaine distinct
  // (`...expo.spock.replit.dev`). Sans cette entree, le preview web mobile
  // recoit un preflight 204 sans Access-Control-Allow-Origin et le navigateur
  // bloque silencieusement le POST de login (seul l'OPTIONS apparait dans
  // les logs — symptome typique).
  const expoDom = process.env.REPLIT_EXPO_DEV_DOMAIN;
  if (expoDom && expoDom.trim() !== "") {
    const url = expoDom.startsWith("http") ? expoDom : `https://${expoDom}`;
    out.add(url.replace(/\/+$/, ""));
  }
  // Auto-deriver le sous-domaine Expo a partir de REPLIT_DOMAINS si
  // REPLIT_EXPO_DEV_DOMAIN n'est pas defini (insertion de `.expo` avant
  // `.spock.replit.dev` ou `.replit.dev`).
  const replitDomainsForExpo = process.env.REPLIT_DOMAINS;
  if (replitDomainsForExpo) {
    replitDomainsForExpo.split(",").map(d => d.trim()).filter(Boolean).forEach(d => {
      const expoVariant = d
        .replace(/\.spock\.replit\.dev$/, ".expo.spock.replit.dev")
        .replace(/^([^.]+)\.replit\.dev$/, "$1.expo.replit.dev");
      if (expoVariant !== d) {
        out.add(`https://${expoVariant}`);
      }
    });
  }
  return Array.from(out);
}

const allowedOrigins = resolveAllowedOrigins();

if (isProduction && allowedOrigins.length === 0) {
  logger.error(
    "FATAL: aucune origine autorisee detectee en production. Definir ALLOWED_ORIGINS, REPLIT_DOMAINS ou PUBLIC_URL.",
  );
  process.exit(1);
}

if (allowedOrigins.length > 0) {
  logger.info({ allowedOrigins }, "[CORS] Origines autorisees");
}

app.use(cors({
  // En production: liste blanche stricte. En dev: reflexion (true) pour confort.
  origin: allowedOrigins.length > 0 ? allowedOrigins : (isProduction ? false : true),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  // Expose rate-limit headers to the SPA so it can render a precise
  // "trop de requetes — reessayer dans Xs" UX instead of a generic 429.
  // These are safe to expose (no auth material).
  exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
  credentials: true,
  maxAge: 86400,
}));

const generalLimiter = rateLimit({
  keyGenerator: resolveClientIp,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes. Veuillez reessayer plus tard." },
  validate: { xForwardedForHeader: false, ip: false },
});

const aiLimiter = rateLimit({
  keyGenerator: resolveClientIp,
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite d'analyse IA atteinte. Veuillez reessayer dans une minute." },
  validate: { xForwardedForHeader: false, ip: false },
});

const strictLimiter = rateLimit({
  keyGenerator: resolveClientIp,
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes d'ecriture. Veuillez reessayer plus tard." },
  validate: { xForwardedForHeader: false, ip: false },
});

// Webhooks Twilio (WhatsApp entrant + secretaire vocale). Ces endpoints
// arrivent TOUS depuis les IPs de Twilio: une limite par IP (comme
// strictLimiter) serait partagee entre TOUS les tenants et pourrait etrangler
// du trafic legitime, ou inversement laisser un seul expediteur inonder le
// serveur. On limite donc par EXPEDITEUR (AccountSid + numero From/Caller),
// extrait du corps deja parse (urlencoded). Cela protege contre l'inondation
// d'un emetteur sans penaliser les autres. Repli sur l'IP si le corps n'est pas
// exploitable.
// Garde-fou de FLOOD coarse, TOUJOURS active, AVANT le limiteur par expediteur.
// Le webhookLimiter ci-dessous derive sa cle de champs du CORPS (AccountSid,
// From/Caller/WaId) — donc FORGEABLES avant la validation de signature. Un
// attaquant pourrait faire varier ces champs a chaque requete pour generer une
// infinite de cles depuis une seule IP et contourner toute limite. Comme les
// webhooks Twilio sont par ailleurs exclus du limiteur generique base sur l'IP,
// il faut une borne par IP qu'on ne peut PAS falsifier. Plafond volontairement
// haut (flood evident, ~10 req/s) pour ne pas etrangler le trafic Twilio
// legitime agrege sur ses IPs sortantes partagees, tout en stoppant une
// inondation depuis une IP unique (y compris du trafic non signe / invalide).
const webhookIpFloodGuard = rateLimit({
  keyGenerator: resolveClientIp,
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes webhook. Veuillez ralentir." },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes webhook. Veuillez ralentir." },
  keyGenerator: (req: Request): string => {
    const b = (req.body ?? {}) as Record<string, string>;
    const sid = typeof b.AccountSid === "string" ? b.AccountSid : "";
    const from =
      (typeof b.From === "string" && b.From) ||
      (typeof b.Caller === "string" && b.Caller) ||
      (typeof b.WaId === "string" && b.WaId) ||
      "";
    if (sid || from) return `twilio:${sid}:${from}`;
    return resolveClientIp(req);
  },
  validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
});

// Vrai pour les POST sur les webhooks Twilio entrants (WhatsApp + voix). Sert a
// la fois a appliquer le webhookLimiter dedie et a exclure ces chemins du
// limiteur generique base sur l'IP.
function isTwilioWebhook(req: Request): boolean {
  if (req.method !== "POST") return false;
  const p = req.path;
  const ou = req.originalUrl.split("?")[0];
  return (
    p === "/whatsapp/twilio/inbound" ||
    ou === "/api/whatsapp/twilio/inbound" ||
    p.startsWith("/voice/twilio/") ||
    ou.startsWith("/api/voice/twilio/")
  );
}

// Stripe webhook needs RAW body (signature verification) — must come BEFORE express.json
import { stripeWebhookRouter } from "./routes/stripe";
app.use(stripeWebhookRouter);

app.use("/api/document-ai", express.json({ limit: "15mb" }));
app.use("/api/documents", express.json({ limit: "40mb" }));
// Scan antivirus cote client : le contenu est transmis en base64 (inflation
// ~33%). On accorde une limite dediee superieure au plafond global de 1mb.
app.use("/api/security/scan-document", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

import { protoPollutionGuard } from "./middleware/proto-pollution";
app.use(protoPollutionGuard);

app.use(hpp());

app.disable("x-powered-by");

const PgStore = connectPgSimple(session);

// `__Host-` prefix is a browser-enforced cookie name lock that GUARANTEES:
//   - Secure flag is set (no plaintext leak over HTTP)
//   - No Domain attribute (blocks subdomain cookie injection / fixation)
//   - Path=/ is required
// In production we use the locked variant; in dev we keep the plain name
// because `__Host-` requires Secure which can't be set on plain http://.
// Any place that reads/writes this cookie by name MUST use SESSION_COOKIE_NAME.
export const SESSION_COOKIE_NAME = isProduction ? "__Host-adb.sid" : "adb.sid";

export const sessionMiddleware = session({
  store: new PgStore({
    conString: process.env.DATABASE_URL,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60,
  }),
  name: SESSION_COOKIE_NAME,
  // Secret rotation: SESSION_SECRETS (comma-separated, newest first) is preferred.
  // express-session signs new cookies with secrets[0] but accepts ANY entry as
  // valid during verification — so operators can rotate by:
  //   1. Prepending a fresh secret:  SESSION_SECRETS=NEW,OLD
  //   2. Letting maxAge (24h) expire all OLD-signed cookies
  //   3. Removing OLD:  SESSION_SECRETS=NEW
  // No user is logged out, no downtime. SESSION_SECRET (singular) remains
  // supported for backward compatibility.
  secret: (() => {
    const list = process.env.SESSION_SECRETS;
    if (list) {
      const parts = list.split(",").map((s) => s.trim()).filter((s) => s.length >= 16);
      if (parts.length === 0) {
        logger.error("FATAL: SESSION_SECRETS defini mais aucune entree valide (>=16 chars).");
        process.exit(1);
      }
      return parts;
    }
    const s = process.env.SESSION_SECRET;
    if (s) return s;
    if (isProduction) {
      logger.error("FATAL: SESSION_SECRET (ou SESSION_SECRETS) est requis en production.");
      process.exit(1);
    }
    const devSecret = crypto.randomBytes(32).toString("hex");
    logger.warn("[Security] SESSION_SECRET non defini — cle aleatoire generee (dev uniquement).");
    return devSecret;
  })(),
  resave: false,
  saveUninitialized: false,
  // rolling=false volontairement: PgStore ferait un UPDATE par requete (amplification d'ecriture).
  // La fenetre fixe maxAge=24h + logout explicite + invalidation au reset suffisent.
  rolling: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    path: "/",
  },
});

app.use(sessionMiddleware);

// Guardian WAF — tüm gelen istekleri denetler (en önce çalışır)
app.use(guardian);
app.use(ipProtection);

app.use("/api/ai", aiLimiter);
// /api/voice englobe les webhooks voix Twilio (/api/voice/twilio/*). Ceux-ci
// NE doivent PAS passer par aiLimiter (base sur l'IP) sinon tous les tenants
// partageant les IPs sortantes de Twilio s'etranglent mutuellement — c'est
// exactement le probleme que webhookLimiter (par expediteur) corrige. On les
// exclut donc ici; ils sont limites plus bas par webhookLimiter.
app.use("/api/voice", (req: Request, res: Response, next: NextFunction) => {
  if (isTwilioWebhook(req)) return next();
  return aiLimiter(req, res, next);
});
app.use("/api/document-ai", aiLimiter);
app.use("/api/commandant", aiLimiter);
app.use("/api/calls", (req: Request, res: Response, next: NextFunction) => {
  const aiPaths = ["/ai-agent-respond", "/ai-agent-save", "/ai-coaching"];
  if (req.method === "POST" && (aiPaths.some(p => req.path === p) || /^\/[0-9]+\/process\/?$/.test(req.path))) {
    return aiLimiter(req, res, next);
  }
  return next();
});
// Webhooks Twilio: garde-fou de flood par IP (non falsifiable, toujours actif)
// PUIS limiteur par expediteur (equite entre tenants). Les deux s'appliquent
// avant le limiteur generique base sur l'IP, dont ces chemins sont ensuite
// exclus.
app.use("/api/whatsapp/twilio/inbound", webhookIpFloodGuard, webhookLimiter);
// TEMPORARY debug route — verifies X-Real-Client-IP propagation end-to-end
// (2026-07-14 incident investigation). Remove after confirming.
app.get("/api/_debug_ip", (req: Request, res: Response) => {
  res.json({
    resolved: resolveClientIp(req),
    xRealClientIp: req.headers["x-real-client-ip"] ?? null,
    xForwardedFor: req.headers["x-forwarded-for"] ?? null,
    reqIp: req.ip,
  });
});

app.use("/api/voice/twilio", webhookIpFloodGuard, webhookLimiter);
app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
  // Les webhooks Twilio sont deja limites par expediteur (webhookLimiter).
  // Les exclure du limiteur generique base sur l'IP evite d'etrangler tous les
  // tenants qui partagent les IPs sortantes de Twilio.
  if (isTwilioWebhook(req)) {
    return next();
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return strictLimiter(req, _res, next);
  }
  return generalLimiter(req, _res, next);
});

app.use("/api", threatDetection);
app.use("/api", csrfProtection);

// Hydrate req.session from a Bearer token (mobile/API clients) before any
// route handler runs. Previously this only happened inside requireAuth /
// requireSuperAdmin / requireRole, so routes that check `req.session.userId`
// directly (auth/me, mfa/*, logout, ...) never saw a Bearer-authenticated
// user and always answered 401 for mobile clients. No-op when a cookie
// session already carries a userId or no Bearer token is present.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  hydrateFromBearer(req).then(() => next()).catch(next);
});

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
