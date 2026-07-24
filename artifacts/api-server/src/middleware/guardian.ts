/**
 * guardian.ts  —  Kapsamlı WAF (Web Application Firewall) Güvenlik Katmanı
 *
 * Bu middleware tüm gelen istekleri gerçek zamanlı olarak denetler ve şunları önler:
 *   1. Bilinen saldırı araçları (sqlmap, nikto, burp suite, nmap, ...)
 *   2. Honeypot tuzakları (/.env, /wp-admin, /phpmyadmin, ...)
 *   3. Şüpheli URL kalıpları (PHP shell'leri, traversal, backup dosyaları, ...)
 *   4. JSON Bomba saldırıları (derin iç içe JSON, binlerce anahtar)
 *   5. HTTP anomalileri (dev büyük header'lar, garip yöntemler)
 *   6. Davranışsal parmak izi (path tarayıcılar, otomatik probe'lar)
 *   7. Otonom ban yükseltme (tekrarlayan saldırganlar için kalıcı blok)
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import { logSecurityEvent } from "./security";
import { resolveClientIp } from "../lib/request-ip";

// ── Bilinen saldırı aracı User-Agent kalıpları ────────────────────────────────
const ATTACK_TOOL_PATTERNS: RegExp[] = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /burp(?:\s*suite)?/i,
  /metasploit/i,
  /dirbuster/i,
  /\bdirb\b/i,
  /gobuster/i,
  /ffuf/i,
  /hydra/i,
  /medusa/i,
  /nessus/i,
  /openvas/i,
  /w3af/i,
  /havij/i,
  /acunetix/i,
  /appscan/i,
  /webinspect/i,
  /nuclei/i,
  /zgrab/i,
  /shodan\.io/i,
  /masscdn/i,
  /\bfuzzer\b/i,
  /\bscanner\b/i,
  /\bexploit\b/i,
  /wfuzz/i,
  /\bwpscan\b/i,
  /\barachni\b/i,
  /\bvega\b/i,
  /joomscan/i,
  /\bcommix\b/i,
  /xsser/i,
  /beef\s*xss/i,
  /sqlninja/i,
  /\bzeroscanner\b/i,
  /\bparos\b/i,
  /\bwebscarab\b/i,
];

// ── Honeypot: meşru kullanıcıların ASLA erişmeyeceği yollar ─────────────────
const HONEYPOT_EXACT: Set<string> = new Set([
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.env.development",
  "/.env.staging",
  "/.env.backup",
  "/.env.old",
  "/.env.bak",
  "/wp-admin",
  "/wp-login.php",
  "/wp-config.php",
  "/wp-cron.php",
  "/xmlrpc.php",
  "/phpmyadmin",
  "/phpmyadmin/",
  "/pma",
  "/pma/",
  "/myadmin",
  "/mysql",
  "/admin.php",
  "/shell.php",
  "/webshell.php",
  "/c99.php",
  "/r57.php",
  "/eval.php",
  "/cmd.php",
  "/.git/config",
  "/.git/HEAD",
  "/.git/index",
  "/.gitignore",
  "/.svn/entries",
  "/.htaccess",
  "/.htpasswd",
  "/config.php",
  "/database.php",
  "/db.php",
  "/connect.php",
  "/backup.zip",
  "/backup.sql",
  "/dump.sql",
  "/database.sql",
  "/db_backup.sql",
  "/server-status",
  "/server-info",
  "/cgi-bin",
  "/etc/passwd",
  "/etc/shadow",
  "/proc/self/environ",
]);

const HONEYPOT_PREFIX: string[] = [
  "/wp-",
  "/wordpress/",
  "/drupal/",
  "/joomla/",
  "/typo3/",
  "/.well-known/pki-validation/",
  "/vendor/phpunit/",
  "/telescope/",
  "/horizon/",
  "/solr/",
  "/jenkins/",
  "/.aws/",
  "/.ssh/",
];

// ── Şüpheli URL regex kalıpları ───────────────────────────────────────────────
const SUSPICIOUS_PATH_PATTERNS: RegExp[] = [
  /\.\.(\/|%2f|\\|%5c)/i,          // path traversal
  /\.(php[0-9]?|asp|aspx|jsp|cgi|pl|rb|py)(\?|$|\/)/i,  // server-side scripts
  /\/(etc|proc|sys)\/(passwd|shadow|hosts|issue|crontab)/i,
  /\/?(wp-content|wp-includes)/i,
  /(shell|cmd|webshell|backdoor)\.(php|asp|jsp)/i,
  /\.(bak|old|backup|orig|save|swp|tmp)(\?|$)/i,
  /~[\w\-]+\/?(\.bash|\.profile|\.ssh)?/,
  /\/\.(DS_Store|bash_history|zsh_history|npmrc|yarnrc)/i,
];

// ── İzin verilen HTTP yöntemleri ──────────────────────────────────────────────
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

// ── Guardian IP blok listesi (saldırganlar için hızlı erişim) ─────────────────
interface GuardianBlock {
  count: number;
  until: number;
  permanent: boolean;
  reasons: string[];
}
const guardianBlocklist = new Map<string, GuardianBlock>();

// ── Davranışsal parmak izi per-IP ─────────────────────────────────────────────
interface IpProfile {
  requests: number[];
  uniquePaths: Set<string>;
  errors: number;
  blocked: number;
  firstSeen: number;
  lastSeen: number;
  threatScore: number;
  labels: Set<string>;
}
const ipProfiles = new Map<string, IpProfile>();

// ── Guardian istatistikleri ───────────────────────────────────────────────────
export const guardianStats = {
  totalInspected: 0,
  totalBlocked: 0,
  attackToolsDetected: 0,
  honeypotTriggered: 0,
  suspiciousPaths: 0,
  jsonBombsBlocked: 0,
  httpAnomalies: 0,
  behavioralBlocks: 0,
  autobanCount: 0,
  startedAt: new Date().toISOString(),
};

// ── Guardian olay akışı (son 500 olay) ───────────────────────────────────────
export interface GuardianEvent {
  timestamp: string;
  ip: string;
  type: string;
  details: string;
  path: string;
  method: string;
  ua?: string;
  severity: "critical" | "warning" | "info";
  blocked: boolean;
}
const guardianEvents: GuardianEvent[] = [];
const MAX_EVENTS = 500;

function pushEvent(event: GuardianEvent): void {
  guardianEvents.unshift(event);
  if (guardianEvents.length > MAX_EVENTS) guardianEvents.length = MAX_EVENTS;
}

// ── Dahili / loopback IP'ler (Guardian'dan muaf) ────────────────────────────
// "169.254." (RFC 3927 link-local) ekli: Cloud Run mimarimizde web servisi
// (Caddy) ile api servisi ayrı container'lar ve web->api cagrilari HTTPS
// uzerinden Cloud Run'in genel ucuna gidiyor. O hop'ta Cloud Run'in kendi
// ic altyapisi X-Forwarded-For'u TUM proxy'li trafik icin AYNI paylasilan
// 169.254.169.x adresine indirgeyebiliyor — yani gercek ziyaretcinin IP'si
// degil, Cloud Run'in kendi dahili adresi. Bunu Guardian'dan muaf tutmazsak,
// (site uzerinden) herhangi bir trafik patlamasi bu tek adresi banliyor ve
// TUM kullanicilari (web sitesindeki HERKESI) 5dk-kalici araliginda kilitliyor
// — 2026-07-14'te canli ortamda tam da bu yasandi (bkz. AI_AUTOMATION_ROADMAP.md).
// Bilinen tavizde: bu hop icin Guardian'in IP-bazli bot/anomali tespiti artik
// calismiyor (butun proxy'li trafik bu tek adresten geliyormus gibi
// gorunuyor). Kabul edilebilir — "herkesi kilitleme" riski cok daha kotu.
const LOOPBACK_PREFIXES = ["127.", "::1", "::ffff:127.", "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "192.168.", "169.254."];

function isInternalIp(ip: string): boolean {
  return LOOPBACK_PREFIXES.some(p => ip.startsWith(p)) || ip === "::1" || ip === "unknown";
}

// ── Yardımcı: IP adresi al ───────────────────────────────────────────────────
const getIp = resolveClientIp;

// ── Guardian ban (kendi blok listesine ekle + paylaşılan olay log'a yaz) ─────
function banIp(ip: string, reason: string, req: Request): void {
  const entry = guardianBlocklist.get(ip) ?? { count: 0, until: 0, permanent: false, reasons: [] };
  entry.count++;
  entry.reasons = [...new Set([...entry.reasons, reason])].slice(-5);

  const BAN_MINUTES = [5, 15, 60, 360, 1440]; // eskalasyon: 5dk→15→1sa→6sa→1gün
  if (entry.count >= 6) {
    entry.permanent = true;
    entry.until = Infinity;
    guardianStats.autobanCount++;
  } else {
    const minuteIdx = Math.min(entry.count - 1, BAN_MINUTES.length - 1);
    entry.until = Date.now() + BAN_MINUTES[minuteIdx] * 60_000;
  }

  guardianBlocklist.set(ip, entry);

  const userId = req.session?.userId ?? null;
  logSecurityEvent(
    entry.permanent ? "guardian_permanent_ban" : "guardian_temp_ban",
    ip,
    userId,
    `[GUARDIAN] ${reason} (ihlal #${entry.count})`,
    "critical",
  );

  logger.warn({
    security: true, guardian: true, event: "guardian_ban",
    ip, reason, count: entry.count, permanent: entry.permanent,
    until: entry.permanent ? "permanent" : new Date(entry.until).toISOString(),
  }, `[GUARDIAN] IP yasaklandı: ${ip}`);
}

function isGuardianBanned(ip: string): GuardianBlock | null {
  const entry = guardianBlocklist.get(ip);
  if (!entry) return null;
  if (entry.permanent) return entry;
  if (Date.now() < entry.until) return entry;
  guardianBlocklist.delete(ip);
  return null;
}

// ── IP profili al/oluştur ────────────────────────────────────────────────────
function getProfile(ip: string): IpProfile {
  if (!ipProfiles.has(ip)) {
    ipProfiles.set(ip, {
      requests: [],
      uniquePaths: new Set(),
      errors: 0,
      blocked: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      threatScore: 0,
      labels: new Set(),
    });
  }
  return ipProfiles.get(ip)!;
}

export function recordRequest(ip: string, path: string): void {
  const p = getProfile(ip);
  const now = Date.now();
  p.requests.push(now);
  p.lastSeen = now;
  p.uniquePaths.add(path.split("?")[0]);
  // 5 dakikadan eski kayıtları temizle
  p.requests = p.requests.filter(t => now - t < 300_000);
}

// ── Davranışsal anomali eşikleri (ortam bazlı) ────────────────────────────────
// Production: dar eşikler — kötüye kullanım hızla durdurulsun.
// Development/test: gevşek eşikler — yoğun e2e/test trafikleri ban yemesin.
const IS_PROD = process.env.NODE_ENV === "production";
const ANOMALY_THRESHOLDS = {
  reqPer10s: IS_PROD ? 50 : 120,
  reqPer60s: IS_PROD ? 200 : 500,
  uniquePathsBurst: IS_PROD ? 100 : 200,
  uniquePathsBurstReq60s: IS_PROD ? 50 : 100,
  errorBurst: IS_PROD ? 40 : 80,
};

/**
 * Seuils appliqués à une session AUTHENTIFIÉE.
 *
 * Le tableau de bord ouvre en parallèle de nombreux widgets (smart-pulse,
 * recent-activity, anomaly-stream, flux SSE...). Une simple ouverture de page
 * dépassait donc les 50 requêtes/10 s prévues pour détecter un bot : quatre
 * rafales suffisaient à faire monter le score de menace à 60 et à bannir
 * l'adresse. Des clients légitimes se retrouvaient en 403 sur toute
 * l'application — incident observé en production le 2026-07-24, avec un
 * navigateur Chrome réel bloqué jusque sur /api/healthz.
 *
 * Un scanner anonyme n'a pas de session : relever le budget des seuls
 * utilisateurs connectés conserve la détection là où elle sert, sans punir
 * l'usage normal. Les limiteurs de débit par route continuent de s'appliquer,
 * ainsi que toutes les autres règles du WAF (injection, honeypots, etc.).
 */
const AUTHENTICATED_THRESHOLDS = {
  reqPer10s: IS_PROD ? 200 : 400,
  reqPer60s: IS_PROD ? 800 : 1500,
  uniquePathsBurst: IS_PROD ? 250 : 400,
  uniquePathsBurstReq60s: IS_PROD ? 150 : 250,
  errorBurst: IS_PROD ? 80 : 160,
};

// ── Davranışsal anomali tespiti ───────────────────────────────────────────────
export function detectBehavioralAnomaly(ip: string, authenticated: boolean): string | null {
  const p = getProfile(ip);
  const now = Date.now();
  const last60s = p.requests.filter(t => now - t < 60_000).length;
  const last10s = p.requests.filter(t => now - t < 10_000).length;
  const limits = authenticated ? AUTHENTICATED_THRESHOLDS : ANOMALY_THRESHOLDS;

  if (last10s > limits.reqPer10s) return `Aşırı istek hızı: ${last10s} istek/10sn (bot davranışı)`;
  if (last60s > limits.reqPer60s) return `Yüksek istek hacmi: ${last60s} istek/dk`;
  if (p.uniquePaths.size > limits.uniquePathsBurst && last60s > limits.uniquePathsBurstReq60s) return `Path tarayıcı tespit edildi: ${p.uniquePaths.size} benzersiz yol`;
  if (p.errors > limits.errorBurst) return `Otomatik hata taraması: ${p.errors} hata yanıtı`;

  return null;
}

// ── JSON bomba tespiti ────────────────────────────────────────────────────────
function getJsonDepth(obj: unknown, maxDepth = 25, depth = 0): number {
  if (depth > maxDepth) return depth;
  if (typeof obj !== "object" || obj === null) return depth;
  let max = depth;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const d = getJsonDepth(v, maxDepth, depth + 1);
    if (d > max) max = d;
    if (max > maxDepth) return max;
  }
  return max;
}

function countJsonKeys(obj: unknown, limit = 5000, count = 0): number {
  if (count > limit) return count;
  if (typeof obj !== "object" || obj === null) return count;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    count++;
    if (count > limit) return count;
    count = countJsonKeys(v, limit, count);
  }
  return count;
}

// ── Ana Guardian middleware ───────────────────────────────────────────────────
export function guardian(req: Request, res: Response, next: NextFunction): void {
  const ip = getIp(req);
  const path = req.path ?? "/";
  const method = req.method ?? "GET";
  const ua = (req.headers["user-agent"] ?? "").slice(0, 256);
  const normalPath = path.toLowerCase().replace(/\/+$/, "") || "/";

  guardianStats.totalInspected++;

  // ── Dahili IP'ler muaf (loopback, private networks, health checks) ───────────
  if (isInternalIp(ip)) {
    next();
    return;
  }

  // ── 0. Guardian ban listesi kontrolü ────────────────────────────────────────
  // La sonde de santé reste toujours joignable: elle ne divulgue rien et sert à
  // la supervision. Un bannissement la rendait muette (403), ce qui faisait
  // passer un service parfaitement sain pour hors service.
  const banned = normalPath !== "/api/healthz" && isGuardianBanned(ip);
  if (banned) {
    guardianStats.totalBlocked++;
    res.status(403).json({
      error: "Accès refusé. Activité malveillante détectée.",
      code: "GUARDIAN_BANNED",
    });
    return;
  }

  // ── 1. Bilinen saldırı araçları tespiti ──────────────────────────────────────
  if (ua.length > 0) {
    for (const pattern of ATTACK_TOOL_PATTERNS) {
      if (pattern.test(ua)) {
        guardianStats.attackToolsDetected++;
        guardianStats.totalBlocked++;

        const event: GuardianEvent = {
          timestamp: new Date().toISOString(),
          ip, path, method,
          type: "attack_tool",
          details: `Saldırı aracı tespit edildi: ${ua.slice(0, 100)}`,
          ua: ua.slice(0, 100),
          severity: "critical",
          blocked: true,
        };
        pushEvent(event);
        banIp(ip, `Saldırı aracı: ${pattern.source}`, req);

        logger.error({ security: true, guardian: true, ip, ua: ua.slice(0, 100), path }, "[GUARDIAN] Saldırı aracı engellendi");
        res.status(403).json({ error: "Accès refusé.", code: "ATTACK_TOOL" });
        return;
      }
    }
  }

  // ── 2. Honeypot tuzağı ───────────────────────────────────────────────────────
  // /api prefix'i soy — Express'in tüm yollar için aynı honeypot listesini kullanabilmesi için
  const strippedPath = normalPath.replace(/^\/api/, "") || "/";
  const isHoneypot =
    HONEYPOT_EXACT.has(normalPath) || HONEYPOT_EXACT.has(strippedPath) ||
    HONEYPOT_EXACT.has(normalPath + "/") || HONEYPOT_EXACT.has(strippedPath + "/") ||
    HONEYPOT_PREFIX.some(p => normalPath.startsWith(p) || strippedPath.startsWith(p));

  if (isHoneypot) {
    guardianStats.honeypotTriggered++;
    guardianStats.totalBlocked++;

    pushEvent({
      timestamp: new Date().toISOString(),
      ip, path, method, ua: ua.slice(0, 80),
      type: "honeypot",
      details: `Honeypot tuzağı tetiklendi: ${path}`,
      severity: "critical",
      blocked: true,
    });
    banIp(ip, `Honeypot: ${path}`, req);

    logger.error({ security: true, guardian: true, ip, path }, "[GUARDIAN] Honeypot tetiklendi");
    res.status(404).json({ error: "Not found." });
    return;
  }

  // ── 3. Şüpheli URL kalıpları ──────────────────────────────────────────────────
  const fullUrl = req.originalUrl ?? path;
  for (const pattern of SUSPICIOUS_PATH_PATTERNS) {
    if (pattern.test(fullUrl)) {
      guardianStats.suspiciousPaths++;
      guardianStats.totalBlocked++;

      pushEvent({
        timestamp: new Date().toISOString(),
        ip, path, method,
        type: "suspicious_path",
        details: `Şüpheli yol kalıbı: ${fullUrl.slice(0, 100)}`,
        severity: "warning",
        blocked: true,
      });
      banIp(ip, `Şüpheli yol: ${path.slice(0, 60)}`, req);
      res.status(400).json({ error: "Requête invalide.", code: "SUSPICIOUS_PATH" });
      return;
    }
  }

  // ── 4. İzin verilmeyen HTTP yöntemi ──────────────────────────────────────────
  if (!ALLOWED_METHODS.has(method)) {
    guardianStats.httpAnomalies++;
    guardianStats.totalBlocked++;

    pushEvent({
      timestamp: new Date().toISOString(),
      ip, path, method,
      type: "http_anomaly",
      details: `İzin verilmeyen HTTP yöntemi: ${method}`,
      severity: "warning",
      blocked: true,
    });
    res.status(405).json({ error: "Méthode non autorisée.", code: "METHOD_NOT_ALLOWED" });
    return;
  }

  // ── 5. Aşırı büyük başlık tespiti ────────────────────────────────────────────
  const headerSize = Buffer.byteLength(JSON.stringify(req.headers));
  if (headerSize > 16_384) { // 16 KB
    guardianStats.httpAnomalies++;
    guardianStats.totalBlocked++;

    pushEvent({
      timestamp: new Date().toISOString(),
      ip, path, method,
      type: "http_anomaly",
      details: `Aşırı büyük başlıklar: ${headerSize} bayt`,
      severity: "warning",
      blocked: true,
    });
    banIp(ip, `Oversized headers: ${headerSize}B`, req);
    res.status(431).json({ error: "En-têtes de requête trop grands.", code: "HEADERS_TOO_LARGE" });
    return;
  }

  // ── 6. JSON bomba koruması ────────────────────────────────────────────────────
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    const depth = getJsonDepth(req.body, 25);
    if (depth > 25) {
      guardianStats.jsonBombsBlocked++;
      guardianStats.totalBlocked++;

      pushEvent({
        timestamp: new Date().toISOString(),
        ip, path, method,
        type: "json_bomb",
        details: `JSON bomba: ${depth} seviye iç içe`,
        severity: "critical",
        blocked: true,
      });
      banIp(ip, `JSON bomba (derinlik ${depth})`, req);
      res.status(400).json({ error: "Structure de données invalide.", code: "JSON_BOMB" });
      return;
    }

    const keyCount = countJsonKeys(req.body, 5000);
    if (keyCount > 5000) {
      guardianStats.jsonBombsBlocked++;
      guardianStats.totalBlocked++;

      pushEvent({
        timestamp: new Date().toISOString(),
        ip, path, method,
        type: "json_bomb",
        details: `JSON bomba: ${keyCount} anahtar`,
        severity: "critical",
        blocked: true,
      });
      banIp(ip, `JSON bomba (${keyCount} anahtar)`, req);
      res.status(400).json({ error: "Structure de données invalide.", code: "JSON_BOMB" });
      return;
    }
  }

  // ── 7. Boş User-Agent (log, engelleme) ───────────────────────────────────────
  if (!ua || ua.length < 4) {
    guardianStats.httpAnomalies++;
    pushEvent({
      timestamp: new Date().toISOString(),
      ip, path, method,
      type: "http_anomaly",
      details: "Eksik veya geçersiz User-Agent",
      severity: "info",
      blocked: false,
    });
    // Sadece log - health check'leri engellemiyoruz
  }

  // ── 8. Davranışsal profil güncelle ve anomali tespiti ─────────────────────────
  recordRequest(ip, path);

  // `guardian` est monté APRÈS `sessionMiddleware` (cf. app.ts): la session est
  // donc déjà résolue et permet de distinguer un utilisateur connecté d'un
  // visiteur anonyme.
  const isAuthenticated = !!(req.session as { userId?: number } | undefined)?.userId;
  const anomaly = detectBehavioralAnomaly(ip, isAuthenticated);
  if (anomaly) {
    const profile = getProfile(ip);
    profile.threatScore += 15;
    guardianStats.behavioralBlocks++;

    if (profile.threatScore >= 60) {
      guardianStats.totalBlocked++;
      pushEvent({
        timestamp: new Date().toISOString(),
        ip, path, method,
        type: "behavioral_block",
        details: `Davranışsal tehdit skoru kritik: ${profile.threatScore} — ${anomaly}`,
        severity: "critical",
        blocked: true,
      });
      banIp(ip, anomaly, req);
      res.status(429).json({
        error: "Activité suspecte détectée. Accès temporairement restreint.",
        code: "BEHAVIORAL_BLOCK",
      });
      return;
    }

    pushEvent({
      timestamp: new Date().toISOString(),
      ip, path, method,
      type: "behavioral_anomaly",
      details: `Davranış anomalisi (skor: ${profile.threatScore}): ${anomaly}`,
      severity: "warning",
      blocked: false,
    });
  }

  next();
}

// ── Guardian stats API ────────────────────────────────────────────────────────
export function getGuardianStats() {
  const now = Date.now();
  const last60min = guardianEvents.filter(
    e => now - new Date(e.timestamp).getTime() < 3_600_000
  ).length;
  const last5min = guardianEvents.filter(
    e => now - new Date(e.timestamp).getTime() < 300_000
  ).length;

  return {
    ...guardianStats,
    bannedIpsActive: guardianBlocklist.size,
    permanentBans: [...guardianBlocklist.values()].filter(v => v.permanent).length,
    eventsLast60min: last60min,
    eventsLast5min: last5min,
    uptime: Math.floor(process.uptime()),
  };
}

export function getGuardianEvents(limit = 50): GuardianEvent[] {
  return guardianEvents.slice(0, limit);
}

export function getGuardianBannedIps(): Array<{
  ip: string;
  count: number;
  permanent: boolean;
  until: string;
  reasons: string[];
}> {
  const result: ReturnType<typeof getGuardianBannedIps> = [];
  guardianBlocklist.forEach((entry, ip) => {
    result.push({
      ip,
      count: entry.count,
      permanent: entry.permanent,
      until: entry.permanent ? "permanent" : new Date(entry.until).toISOString(),
      reasons: entry.reasons,
    });
  });
  return result.sort((a, b) => b.count - a.count);
}

export function getGuardianThreatProfiles(limit = 20): Array<{
  ip: string;
  requests: number;
  uniquePaths: number;
  errors: number;
  threatScore: number;
  firstSeen: string;
  lastSeen: string;
  labels: string[];
}> {
  const profiles: ReturnType<typeof getGuardianThreatProfiles> = [];
  ipProfiles.forEach((p, ip) => {
    if (p.threatScore > 0) {
      profiles.push({
        ip,
        requests: p.requests.length,
        uniquePaths: p.uniquePaths.size,
        errors: p.errors,
        threatScore: p.threatScore,
        firstSeen: new Date(p.firstSeen).toISOString(),
        lastSeen: new Date(p.lastSeen).toISOString(),
        labels: [...p.labels],
      });
    }
  });
  return profiles.sort((a, b) => b.threatScore - a.threatScore).slice(0, limit);
}

export function unbanGuardianIp(ip: string): boolean {
  return guardianBlocklist.delete(ip);
}

// ── Bellek temizleme ──────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  // Süresi dolmuş yasakları temizle
  guardianBlocklist.forEach((entry, ip) => {
    if (!entry.permanent && now >= entry.until) guardianBlocklist.delete(ip);
  });
  // Eski IP profillerini temizle (6 saatten fazla görülmeyenleri)
  ipProfiles.forEach((p, ip) => {
    if (now - p.lastSeen > 6 * 3_600_000) ipProfiles.delete(ip);
  });
}, 10 * 60_000); // her 10 dakikada bir
