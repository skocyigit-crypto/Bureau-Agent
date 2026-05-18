import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";

const MALICIOUS_PATTERNS = [
  /<script[\s>]/i,
  /javascript:/i,
  /on(load|error|click|mouseover|focus|blur|submit|change|input|keydown|keyup|keypress)\s*=/i,
  /data:\s*text\/html/i,
  /vbscript:/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*javascript/i,
  /eval\s*\(/i,
  /document\.(cookie|domain|write)/i,
  /window\.(location|open)/i,
  /\.constructor\s*\(/i,
  /fromCharCode/i,
  /innerHTML/i,
  /outerHTML/i,
  /insertAdjacentHTML/i,
];

const SQL_INJECTION_PATTERNS = [
  /('\s*(OR|AND)\s+')/i,
  /(UNION\s+SELECT)/i,
  /(DROP\s+TABLE)/i,
  /(INSERT\s+INTO)/i,
  /(DELETE\s+FROM)/i,
  /(UPDATE\s+\w+\s+SET)/i,
  /(;\s*(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE))/i,
  /(--\s*$)/m,
  /(\/\*[\s\S]*?\*\/)/,
  /(\bEXEC\b|\bEXECUTE\b)\s/i,
  /(xp_cmdshell|sp_executesql)/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[\/\\]/,
  /%2e%2e[%2f%5c]/i,
  /\.\.%2f/i,
  /%2e%2e\//i,
  /\.\.\\/,
  /\.\.%5c/i,
];

const COMMAND_INJECTION_PATTERNS = [
  /[;&|`$](?![\s]*$)/,
  /\$\(.*\)/,
  /`[^`]*`/,
];

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/\//g, "&#x2F;");
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const cleanKey = key.replace(/[<>"'&]/g, "");
    cleaned[cleanKey] = sanitizeValue(val);
  }
  return cleaned;
}

function detectThreatInValue(value: unknown, path: string): string | null {
  if (typeof value === "string") {
    for (const p of MALICIOUS_PATTERNS) {
      if (p.test(value)) return `XSS detecte dans ${path}: ${p.source}`;
    }
    for (const p of SQL_INJECTION_PATTERNS) {
      if (p.test(value)) return `Injection SQL detectee dans ${path}: ${p.source}`;
    }
    for (const p of PATH_TRAVERSAL_PATTERNS) {
      if (p.test(value)) return `Traversee de chemin detectee dans ${path}`;
    }
    for (const p of COMMAND_INJECTION_PATTERNS) {
      if (p.test(value)) return `Injection de commande detectee dans ${path}`;
    }
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const t = detectThreatInValue(value[i], `${path}[${i}]`);
      if (t) return t;
    }
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const t = detectThreatInValue(v, `${path}.${k}`);
      if (t) return t;
    }
  }
  return null;
}

const ipBlacklist = new Map<string, { count: number; until: number; permanent: boolean }>();
const ipRequestLog = new Map<string, number[]>();

const THREAT_THRESHOLD = 5;
const BAN_DURATION_MS = 30 * 60 * 1000;
const PERMANENT_BAN_THRESHOLD = 15;
const BURST_WINDOW_MS = 1000;
const BURST_MAX_REQUESTS = 300;

function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function isIpBlacklisted(ip: string): boolean {
  const entry = ipBlacklist.get(ip);
  if (!entry) return false;
  if (entry.permanent) return true;
  if (Date.now() < entry.until) return true;
  ipBlacklist.delete(ip);
  return false;
}

function recordThreat(ip: string, reason: string, req: Request): void {
  const entry = ipBlacklist.get(ip) || { count: 0, until: 0, permanent: false };
  entry.count++;
  if (entry.count >= PERMANENT_BAN_THRESHOLD) {
    entry.permanent = true;
    entry.until = Infinity;
  } else if (entry.count >= THREAT_THRESHOLD) {
    entry.until = Date.now() + BAN_DURATION_MS * Math.min(entry.count - THREAT_THRESHOLD + 1, 10);
  }
  ipBlacklist.set(ip, entry);

  const userId = req.session?.userId || null;
  const severity = entry.count >= THREAT_THRESHOLD ? "critical" as const : "warning" as const;

  logger.warn({
    security: true,
    event: "threat_detected",
    ip,
    reason,
    threatCount: entry.count,
    banned: entry.count >= THREAT_THRESHOLD,
    permanent: entry.permanent,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.headers["user-agent"],
    userId,
  }, `[SECURITE] Menace detectee: ${reason}`);

  logSecurityEvent(
    "threat_detected",
    ip,
    userId,
    `${reason} (${req.method} ${req.originalUrl}) [tentative #${entry.count}]`,
    severity,
  );
}

function checkBurstRate(ip: string): boolean {
  const now = Date.now();
  const timestamps = ipRequestLog.get(ip) || [];
  const recent = timestamps.filter(t => now - t < BURST_WINDOW_MS);
  recent.push(now);
  ipRequestLog.set(ip, recent.slice(-100));
  return recent.length > BURST_MAX_REQUESTS;
}

export function ipProtection(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);

  if (isIpBlacklisted(ip)) {
    logger.warn({ security: true, ip, event: "blocked_request" },
      "[SECURITE] Requete bloquee - IP sur liste noire");
    res.status(403).json({ error: "Acces refuse. Votre adresse IP a ete bloquee pour activite suspecte." });
    return;
  }

  if (checkBurstRate(ip)) {
    res.status(429).json({ error: "Trop de requetes simultanees detectees." });
    return;
  }

  next();
}

export function threatDetection(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);

  if (req.body && typeof req.body === "object") {
    const threat = detectThreatInValue(req.body, "body");
    if (threat) {
      recordThreat(ip, threat, req);
      res.status(400).json({
        error: "Contenu potentiellement dangereux detecte. La requete a ete bloquee.",
        code: "THREAT_DETECTED",
      });
      return;
    }
  }

  if (req.query) {
    const threat = detectThreatInValue(req.query, "query");
    if (threat) {
      recordThreat(ip, threat, req);
      res.status(400).json({
        error: "Parametre potentiellement dangereux detecte.",
        code: "THREAT_DETECTED",
      });
      return;
    }
  }

  if (req.params) {
    const threat = detectThreatInValue(req.params, "params");
    if (threat) {
      recordThreat(ip, threat, req);
      res.status(400).json({
        error: "Parametre de chemin potentiellement dangereux detecte.",
        code: "THREAT_DETECTED",
      });
      return;
    }
  }

  const url = req.originalUrl || req.url;
  for (const p of PATH_TRAVERSAL_PATTERNS) {
    if (p.test(url)) {
      recordThreat(ip, "Traversee de chemin dans URL", req);
      res.status(400).json({ error: "URL invalide detectee." });
      return;
    }
  }

  const urlPath = url.split("?")[0];
  for (const p of COMMAND_INJECTION_PATTERNS) {
    if (p.test(urlPath)) {
      recordThreat(ip, "Injection de commande dans URL", req);
      res.status(400).json({ error: "URL invalide detectee." });
      return;
    }
  }

  next();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Bypass for telephony webhooks: they are authenticated via signature/HMAC
  // (Twilio x-twilio-signature, Vonage/Telnyx shared secret) and never include Origin/Referer.
  if (req.path.startsWith("/telephony/webhook/") || req.originalUrl.startsWith("/api/telephony/webhook/")) {
    return next();
  }

  // CSRF bypass for local development. Previously this was a bare
  // `NODE_ENV !== "production"` check, which silently disabled CSRF on any
  // preview/staging environment that forgot to set NODE_ENV=production.
  // Now we require an explicit opt-in flag (DISABLE_CSRF_DEV=1) AND
  // NODE_ENV !== "production" — fail-closed by default everywhere else.
  if (process.env.NODE_ENV !== "production" && process.env.DISABLE_CSRF_DEV === "1") {
    return next();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;

  if (!origin && !referer) {
    const ip = getClientIp(req);
    logger.warn({
      security: true,
      event: "csrf_no_origin",
      method: req.method,
      url: req.originalUrl,
      ip,
    }, "[SECURITE] Requete sans origin/referer bloquee");
    logSecurityEvent("csrf_blocked", ip, req.session?.userId || null,
      `Requete sans origin/referer (${req.method} ${req.originalUrl})`, "warning");
    res.status(403).json({ error: "Requete non autorisee - origine manquante." });
    return;
  }

  // Resolution multi-source identique a app.ts pour rester coherent en
  // deploiement Replit ou un admin n'aurait configure que REPLIT_DOMAINS
  // ou PUBLIC_URL (pas de ALLOWED_ORIGINS explicite). Sinon on rejetterait
  // les requetes legitimes du SPA hebergé sur le meme domaine.
  const allowedOrigins: string[] = [];
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean).forEach(o => allowedOrigins.push(o));
  }
  if (process.env.REPLIT_DOMAINS) {
    process.env.REPLIT_DOMAINS.split(",").map(d => d.trim()).filter(Boolean).forEach(d => {
      allowedOrigins.push(d.startsWith("http") ? d : `https://${d}`);
    });
  }
  for (const envName of ["PUBLIC_URL", "APP_URL", "REPLIT_DEPLOYMENT_URL"] as const) {
    const v = process.env[envName];
    if (v) {
      try { allowedOrigins.push(new URL(v).origin); } catch { /* ignore */ }
    }
  }
  // Expo (mobile preview) sert depuis un sous-domaine distinct
  // (`...expo.spock.replit.dev`). Sans cette entree, le POST /api/auth/login
  // depuis l'app mobile est bloque par la verif CSRF (403 "non autorise"),
  // alors que CORS le laisse passer. Doit rester aligne avec la resolution
  // dans app.ts.
  const expoDom = process.env.REPLIT_EXPO_DEV_DOMAIN;
  if (expoDom && expoDom.trim() !== "") {
    allowedOrigins.push(expoDom.startsWith("http") ? expoDom : `https://${expoDom}`);
  }
  if (process.env.REPLIT_DOMAINS) {
    process.env.REPLIT_DOMAINS.split(",").map(d => d.trim()).filter(Boolean).forEach(d => {
      const expoVariant = d
        .replace(/\.spock\.replit\.dev$/, ".expo.spock.replit.dev")
        .replace(/^([^.]+)\.replit\.dev$/, "$1.expo.replit.dev");
      if (expoVariant !== d) allowedOrigins.push(`https://${expoVariant}`);
    });
  }

  const requestOrigin = origin || (referer ? new URL(referer).origin : "");

  if (host && requestOrigin) {
    try {
      const originHost = new URL(requestOrigin).host;
      if (originHost === host || allowedOrigins.some(ao => {
        try { return new URL(ao).host === originHost; } catch { return false; }
      })) {
        return next();
      }
    } catch { /* invalid URL - fall through to reject */ }
  }

  const ip = getClientIp(req);
  logger.warn({
    security: true,
    event: "csrf_origin_mismatch",
    origin: requestOrigin,
    host,
    method: req.method,
    url: req.originalUrl,
    ip,
  }, "[SECURITE] Origine CSRF non correspondante");
  logSecurityEvent("csrf_blocked", ip, req.session?.userId || null,
    `Origine CSRF invalide: ${requestOrigin} (${req.method} ${req.originalUrl})`, "warning");
  res.status(403).json({ error: "Requete non autorisee - origine invalide." });
}

const DANGEROUS_FILE_SIGNATURES: Array<{ name: string; magic: Buffer; offset?: number }> = [
  { name: "EXE/DLL (MZ)", magic: Buffer.from([0x4D, 0x5A]) },
  { name: "ELF executable", magic: Buffer.from([0x7F, 0x45, 0x4C, 0x46]) },
  { name: "Java class", magic: Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]) },
  { name: "Mach-O binary", magic: Buffer.from([0xFE, 0xED, 0xFA, 0xCE]) },
  { name: "Mach-O 64-bit", magic: Buffer.from([0xFE, 0xED, 0xFA, 0xCF]) },
  { name: "COM executable", magic: Buffer.from([0xE9]) },
  { name: "Windows Script", magic: Buffer.from("WScript") },
  { name: "PowerShell", magic: Buffer.from("powershell") },
  { name: "Batch script", magic: Buffer.from("@echo") },
  { name: "Shell script", magic: Buffer.from("#!/") },
  { name: "VBS script", magic: Buffer.from("CreateObject") },
  { name: "PHP script", magic: Buffer.from("<?php") },
  { name: "RAR archive (may contain malware)", magic: Buffer.from([0x52, 0x61, 0x72, 0x21]) },
];

const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".dll", ".bat", ".cmd", ".com", ".scr", ".pif", ".vbs", ".vbe",
  ".js", ".jse", ".wsf", ".wsh", ".ps1", ".psm1", ".msi", ".msp",
  ".hta", ".cpl", ".inf", ".reg", ".rgs", ".sct", ".shb", ".sys",
  ".lnk", ".jar", ".class", ".sh", ".bash", ".php", ".py", ".rb",
  ".pl", ".cgi", ".asp", ".aspx", ".jsp", ".war", ".ear",
]);

const EICAR_SIGNATURE = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const MALWARE_TEXT_PATTERNS = [
  /WScript\.Shell/i,
  /ActiveXObject/i,
  /Shell\.Application/i,
  /Scripting\.FileSystemObject/i,
  /cmd\.exe/i,
  /powershell\s*-/i,
  /\bInvoke-Expression\b/i,
  /\bInvoke-WebRequest\b/i,
  /\bDownloadFile\b/i,
  /\bDownloadString\b/i,
  /\bStart-Process\b/i,
  /\bNet\.WebClient\b/i,
  /base64_decode\s*\(/i,
  /system\s*\(\s*["']/i,
  /exec\s*\(\s*["']/i,
  /passthru\s*\(/i,
  /shell_exec\s*\(/i,
  /proc_open\s*\(/i,
  /popen\s*\(/i,
  /\bcurl\s+-o\b/i,
  /\bwget\s+/i,
  /chmod\s+[0-7]{3,4}\b/i,
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
  /\brm\s+-rf\b/i,
  /\bmkfifo\b/i,
  /\bnc\s+-[elp]/i,
  /\bnetcat\b/i,
  /\breverse\s*shell\b/i,
];

export interface ScanResult {
  safe: boolean;
  threats: string[];
  fileType: string | null;
  sha256: string;
  size: number;
  scannedAt: string;
}

export function scanFileBuffer(buffer: Buffer, filename?: string): ScanResult {
  const result: ScanResult = {
    safe: true,
    threats: [],
    fileType: null,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    size: buffer.length,
    scannedAt: new Date().toISOString(),
  };

  if (buffer.length === 0) {
    result.threats.push("Fichier vide");
    result.safe = false;
    return result;
  }

  if (buffer.length > 50 * 1024 * 1024) {
    result.threats.push("Fichier trop volumineux (>50MB)");
    result.safe = false;
    return result;
  }

  if (filename) {
    const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      result.threats.push(`Extension de fichier dangereuse: ${ext}`);
      result.safe = false;
    }
  }

  for (const sig of DANGEROUS_FILE_SIGNATURES) {
    const offset = sig.offset || 0;
    const slice = buffer.subarray(offset, offset + sig.magic.length);
    if (slice.equals(sig.magic)) {
      result.threats.push(`Signature binaire dangereuse detectee: ${sig.name}`);
      result.fileType = sig.name;
      result.safe = false;
    }
  }

  const textPreview = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf-8");

  if (textPreview.includes(EICAR_SIGNATURE)) {
    result.threats.push("Signature EICAR de test antivirus detectee");
    result.safe = false;
  }

  for (const pattern of MALWARE_TEXT_PATTERNS) {
    if (pattern.test(textPreview)) {
      result.threats.push(`Motif de code malveillant detecte: ${pattern.source}`);
      result.safe = false;
    }
  }

  const nullBytes = buffer.filter(b => b === 0).length;
  const nullRatio = nullBytes / buffer.length;
  if (nullRatio > 0.3 && buffer.length > 100) {
    const isPdf = buffer.subarray(0, 5).toString() === "%PDF-";
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
    if (!isPdf && !isZip) {
      result.threats.push("Contenu binaire suspect (ratio d'octets nuls eleve)");
      result.safe = false;
    }
  }

  if (result.safe) {
    result.fileType = detectSafeFileType(buffer);
  }

  return result;
}

function detectSafeFileType(buffer: Buffer): string {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return "JPEG";
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString() === "PNG") return "PNG";
  if (buffer.subarray(0, 4).toString() === "%PDF") return "PDF";
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) return "ZIP/XLSX/DOCX";
  if (buffer.subarray(0, 4).toString() === "GIF8") return "GIF";
  if (buffer.subarray(0, 4).toString() === "RIFF") return "WEBP/AVI";
  return "inconnu";
}

export function scanBase64Content(base64: string, filename?: string): ScanResult {
  try {
    const buffer = Buffer.from(base64, "base64");
    return scanFileBuffer(buffer, filename);
  } catch {
    return {
      safe: false,
      threats: ["Encodage base64 invalide"],
      fileType: null,
      sha256: "",
      size: 0,
      scannedAt: new Date().toISOString(),
    };
  }
}

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_ITERATIONS = 100000;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, KEY_ITERATIONS, 32, "sha512");
}

function getEncryptionSecret(): string {
  const secret = process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Cle de chiffrement non configuree (DATA_ENCRYPTION_KEY)");
  }
  return secret;
}

export function encryptSensitiveData(plaintext: string): string {
  const secret = getEncryptionSecret();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return `enc:v1:${combined.toString("base64")}`;
}

export function decryptSensitiveData(ciphertext: string): string {
  if (!ciphertext.startsWith("enc:v1:")) {
    return ciphertext;
  }
  const secret = getEncryptionSecret();
  const combined = Buffer.from(ciphertext.slice(7), "base64");
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const key = deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf-8");
}

export function hashSensitiveData(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

const securityEvents: Array<{
  timestamp: string;
  type: string;
  ip: string;
  userId: number | null;
  details: string;
  severity: "info" | "warning" | "critical";
}> = [];

const MAX_SECURITY_EVENTS = 10000;

export function logSecurityEvent(
  type: string,
  ip: string,
  userId: number | null,
  details: string,
  severity: "info" | "warning" | "critical" = "warning",
): void {
  const event = {
    timestamp: new Date().toISOString(),
    type,
    ip,
    userId,
    details,
    severity,
  };

  securityEvents.push(event);
  if (securityEvents.length > MAX_SECURITY_EVENTS) {
    securityEvents.splice(0, securityEvents.length - MAX_SECURITY_EVENTS);
  }

  if (severity === "critical") {
    logger.error({ security: true, ...event }, `[SECURITE CRITIQUE] ${details}`);
  } else if (severity === "warning") {
    logger.warn({ security: true, ...event }, `[SECURITE] ${details}`);
  }
}

export function getSecurityEvents(limit = 100, severity?: string): typeof securityEvents {
  let filtered = securityEvents;
  if (severity) {
    filtered = filtered.filter(e => e.severity === severity);
  }
  return filtered.slice(-limit).reverse();
}

export function getSecurityStats(): {
  totalEvents: number;
  critical: number;
  warning: number;
  info: number;
  blacklistedIps: number;
  permanentBans: number;
  last24h: number;
} {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  let permanent = 0;
  ipBlacklist.forEach(v => { if (v.permanent) permanent++; });
  return {
    totalEvents: securityEvents.length,
    critical: securityEvents.filter(e => e.severity === "critical").length,
    warning: securityEvents.filter(e => e.severity === "warning").length,
    info: securityEvents.filter(e => e.severity === "info").length,
    blacklistedIps: ipBlacklist.size,
    permanentBans: permanent,
    last24h: securityEvents.filter(e => e.timestamp >= dayAgo).length,
  };
}

export function getBlacklistedIps(): Array<{ ip: string; count: number; permanent: boolean; until: string }> {
  const result: Array<{ ip: string; count: number; permanent: boolean; until: string }> = [];
  ipBlacklist.forEach((v, ip) => {
    result.push({
      ip,
      count: v.count,
      permanent: v.permanent,
      until: v.permanent ? "permanent" : new Date(v.until).toISOString(),
    });
  });
  return result;
}

export function unblockIp(ip: string): boolean {
  return ipBlacklist.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  ipRequestLog.forEach((timestamps, ip) => {
    const recent = timestamps.filter(t => now - t < 60000);
    if (recent.length === 0) {
      ipRequestLog.delete(ip);
    } else {
      ipRequestLog.set(ip, recent);
    }
  });
}, 60000);
