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
import { cleLimiteApplicative, rateLimitKey } from "./lib/request-ip";
import { recordHttpStatus } from "./services/health-agents-external";
import { limiteCorpsBase64, TAILLE_MAX_BASE64_MO } from "./lib/limites-televersement";
import { consommeBudgetIa } from "./services/limite-ia-chemins";
import { resolveAllowedOrigins } from "./lib/origines-autorisees";

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
  // VoiceLive needs these capture features, but only from our own origin.
  // `=()` disables getUserMedia/getDisplayMedia before the browser can even
  // show its permission prompt.
  "camera=(self)",
  "cross-origin-isolated=()",
  "display-capture=(self)",
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
  "microphone=(self)",
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

// Comptage des codes de reponse pour l'agent de sante "taux d'erreurs".
// Place avant le reste de la chaine pour observer TOUTES les reponses, y
// compris celles rendues par les limiteurs (429) et les erreurs (500) — ce
// sont precisement les deux signaux qui avaient manque lors des incidents.
// Cout: un increment en memoire par requete, aucune ecriture en base.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () => {
    try { recordHttpStatus(res.statusCode); } catch { /* ne jamais casser une reponse */ }
  });
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
// La resolution vit desormais dans `lib/origines-autorisees`, parce qu'il en
// existait une SECONDE, incomplete, dans le point d'entree WebSocket de la
// voix — construite a partir des seules variables Replit, absentes de Cloud
// Run, donc vide et sans effet en production. Deux listes pour la meme
// question donnent tot ou tard deux reponses.
//
// Si la liste reste vide en production, on hard-fail plutot que de deployer
// un service accidentellement ouvert a toutes les origines.

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
  keyGenerator: cleLimiteApplicative,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requetes. Veuillez reessayer plus tard." },
  validate: { xForwardedForHeader: false, ip: false },
});

const aiLimiter = rateLimit({
  keyGenerator: cleLimiteApplicative,
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite d'analyse IA atteinte. Veuillez reessayer dans une minute." },
  validate: { xForwardedForHeader: false, ip: false },
});

const strictLimiter = rateLimit({
  keyGenerator: cleLimiteApplicative,
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
  keyGenerator: rateLimitKey,
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
    // Repli sur l'IP quand le corps n'est pas exploitable: passer par
    // rateLimitKey pour que l'IPv6 soit regroupee par prefixe, sinon ce repli
    // serait contournable en changeant d'adresse a chaque requete.
    return rateLimitKey(req);
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

// Les limites de corps DERIVENT de la taille de fichier annoncee, elles ne
// sont plus choisies a cote. Le fichier voyage en base64 (inflation d'un
// tiers): a 15mb de corps, seuls ~11 Mo de fichier passaient, alors que
// l'application en annonce davantage — et le refus venait du lecteur de corps,
// donc AVANT le message qui explique la limite. L'utilisateur voyait un echec
// sans phrase sur un fichier que l'interface lui presentait comme acceptable.
//
// `/api/documents` demandait 40mb, au-dessus du plafond de requete de Cloud Run
// (32 Mio): les huit derniers megaoctets n'ont jamais ete atteignables.
app.use("/api/document-ai", express.json({ limit: limiteCorpsBase64(TAILLE_MAX_BASE64_MO) }));
app.use("/api/documents", express.json({ limit: limiteCorpsBase64(TAILLE_MAX_BASE64_MO) }));
// Scan antivirus cote client : le contenu est transmis en base64 (inflation
// ~33%). On accorde une limite dediee superieure au plafond global de 1mb.
app.use("/api/security/scan-document", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Rapports de violation CSP.
//
// Montes ICI, avant la protection CSRF et la detection de menaces: un
// navigateur envoie un rapport SANS jeton CSRF et sans session, donc la
// chaine habituelle le rejetterait — et la mesure qu'on cherche a faire
// n'arriverait jamais. Meme raison que pour le webhook Stripe juste
// au-dessus.
//
// Les deux types de contenu que les navigateurs emploient sont declares:
// `application/csp-report` pour l'ancien `report-uri`, `application/reports+json`
// pour l'API Reporting. Sans eux, `express.json` ne lit pas le corps et la
// route recevrait des rapports vides.
import cspReportRouter from "./routes/csp-report";
app.use("/api", express.json({ type: ["application/csp-report", "application/reports+json"], limit: "64kb" }));
app.use("/api", cspReportRouter);

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
    // "lax" et non "strict".
    //
    // Avec "strict", le cookie n'est PAS envoye lorsqu'on arrive depuis un
    // autre site — y compris sur une navigation legitime. Deux consequences
    // concretes:
    //   - le retour de Google OAuth (accounts.google.com -> /google-oauth/
    //     callback) arrivait sans session, et le callback repondait
    //     `not_authenticated`: la connexion Google ne pouvait pas aboutir ;
    //   - un utilisateur ouvrant l'application depuis un lien d'e-mail
    //     (licence, reinitialisation) etait vu comme deconnecte au premier
    //     chargement — d'ou des 401 sur /api/auth/me.
    //
    // "lax" envoie le cookie sur les navigations de premier niveau en GET,
    // jamais sur une requete POST cross-site: la protection CSRF reste
    // effective, et elle est de toute facon doublee par la verification
    // d'Origin dans middleware/security.ts (csrfProtection).
    sameSite: "lax",
    path: "/",
  },
});

app.use(sessionMiddleware);

// Guardian WAF — tüm gelen istekleri denetler (en önce çalışır)
app.use(guardian);
app.use(ipProtection);

// Le budget IA (15 appels/minute) ne doit etre consomme que par ce qui
// appelle un modele : voir services/limite-ia-chemins.ts. Les lectures d etat
// restent bornees par le limiteur general.
app.use("/api/ai", (req: Request, res: Response, next: NextFunction) => {
  if (!consommeBudgetIa(req.method, req.path)) return next();
  return aiLimiter(req, res, next);
});
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
    logger.warn({ err: err }, "Error after headers sent");
    return;
  }

  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;

  if (isServerError) {
    logger.error({
      // L'objet, pas seulement son message: pino le serialise avec son type,
      // sa pile ET sa chaine de causes. C'est la cause qui porte l'information
      // utile — un `Failed query: ...` ne dit pas pourquoi la requete a
      // echoue; son `cause` dit « Connection terminated ». Ce gestionnaire
      // voit TOUTES les 500 du service: ce qu'il perd ici n'est recuperable
      // nulle part ailleurs.
      err,
      stack: err.stack,
      code: err.code,
      method: _req.method,
      url: _req.originalUrl,
    }, "Server error");
  } else {
    logger.warn({ err: err, status }, "Client error");
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
    res.status(status).json({ err: err || "Erreur inconnue" });
  }
});

export default app;
