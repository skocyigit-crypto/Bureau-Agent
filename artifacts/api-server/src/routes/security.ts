import { Router } from "express";
import { requireRole } from "../middleware/auth";
import {
  getSecurityEvents,
  getSecurityStats,
  getBlacklistedIps,
  unblockIp,
  scanBase64Content,
  scanBase64ContentFull,
  logSecurityEvent,
} from "../middleware/security";
import {
  getGuardianStats,
  getGuardianEvents,
  getGuardianBannedIps,
  getGuardianThreatProfiles,
  unbanGuardianIp,
} from "../middleware/guardian";
import { analyzeUrlFull, isSafeBrowsingConfigured } from "../services/url-safety";
import { isMalwareEngineConfigured, getMalwareEngineName } from "../services/file-malware";
import { recordSecurityScan, getRecentSecurityScans, getOrgScanSummary } from "../services/security-scans";
import {
  listSecurityEntries,
  addSecurityEntry,
  removeSecurityEntry,
  applyDomainListToUrl,
  type ListEntryType,
  type ListKind,
} from "../services/security-lists";
import { emitSecurityAlert, getRecentAlerts } from "../services/security-alerts";
import { detectPii, looksLikeText, type PiiResult } from "../services/pii-detection";
import { computeSecurityScore } from "../services/security-score";
import { loadSecurityScoreInput } from "../services/security-score-input";
import { db, organisationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const requireAdmin = requireRole("super_admin", "administrateur");

// ── API securite cote CLIENT (tenant, tout utilisateur authentifie) ───────────
// requireTenant est deja applique en amont (routes/index.ts), donc
// req.session.organisationId est garanti present ici.

/** Scanne une URL (heuristique + Google Safe Browsing si configure). */
router.post("/security/scan-url", async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== "string" || url.length > 2048) {
    res.status(400).json({ error: "URL a scanner requise." });
    return;
  }
  try {
    let result = await analyzeUrlFull(url.trim());
    const orgId = req.session?.organisationId;
    const userId = req.session?.userId;
    if (orgId) {
      // Les listes personnalisees de l'org ont le dernier mot sur le verdict.
      result = await applyDomainListToUrl(orgId, result);
      recordSecurityScan({
        orgId,
        userId: userId ?? null,
        kind: "url",
        target: result.displayUrl,
        verdict: result.risk === "safe" ? "safe" : result.risk === "suspicious" ? "suspicious" : "dangerous",
        details: result.reasons.join("; "),
      });
      // Scan manuel: l'utilisateur est devant son ecran -> pas de WhatsApp,
      // mais on alimente le flux temps reel (buffer + SSE) des autres postes.
      emitSecurityAlert({
        orgId,
        kind: "url",
        verdict: result.risk === "dangerous" ? "dangerous" : "safe",
        target: result.displayUrl,
        detail: result.reasons[0],
        notifyWhatsApp: false,
      });
    }
    res.json(result);
  } catch {
    res.status(500).json({ error: "Erreur lors de l'analyse de l'URL." });
  }
});

/** Scanne un document encode en base64 (antivirus heuristique). */
// Plafond de taille decodee (10 Mo) — borne l'abus et la consommation memoire.
const MAX_SCAN_DECODED_BYTES = 10 * 1024 * 1024;
// Garde grossiere sur la longueur encodee, evaluee AVANT la regex pour ne pas
// faire tourner le validateur sur une chaine demesuree.
const MAX_SCAN_BASE64_CHARS = Math.ceil(MAX_SCAN_DECODED_BYTES / 3) * 4 + 4;
// Strict: uniquement un prefixe data-URI base64 valide est retire.
const DATA_URI_BASE64_RE = /^data:[^,]*;base64,/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

router.post("/security/scan-document", async (req, res) => {
  const { content, filename } = req.body ?? {};
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "Contenu a scanner requis (base64)." });
    return;
  }
  // On ne retire QUE un prefixe data-URI base64 strict; tout autre contenu est
  // traite tel quel comme du base64 (pas de slice generique sur la 1ere virgule).
  const b64 = content.replace(DATA_URI_BASE64_RE, "");
  if (b64.length > MAX_SCAN_BASE64_CHARS) {
    res.status(413).json({ error: "Fichier trop volumineux (max 10 Mo)." });
    return;
  }
  if (!BASE64_RE.test(b64) || b64.length % 4 !== 0) {
    res.status(400).json({ error: "Contenu base64 invalide." });
    return;
  }
  // Taille decodee exacte = (len / 4) * 3 - padding.
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const decodedBytes = (b64.length / 4) * 3 - padding;
  if (decodedBytes > MAX_SCAN_DECODED_BYTES) {
    res.status(413).json({ error: "Fichier trop volumineux (max 10 Mo)." });
    return;
  }
  const result = await scanBase64ContentFull(b64, typeof filename === "string" ? filename : undefined);

  // Detection RGPD: sur les fichiers texte uniquement (le binaire produirait
  // des faux positifs). Fail-soft: une erreur PII ne casse pas le scan antivirus.
  let pii: PiiResult | undefined;
  try {
    const buffer = Buffer.from(b64, "base64");
    if (looksLikeText(buffer)) {
      pii = detectPii(buffer.toString("utf8"));
    }
  } catch { /* ignore: le verdict antivirus prime */ }

  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (orgId) {
    recordSecurityScan({
      orgId,
      userId: userId ?? null,
      kind: "file",
      target: typeof filename === "string" ? filename : "fichier",
      verdict: result.safe ? "safe" : "dangerous",
      details: result.threats.join("; "),
      engine: result.engine,
    });
    emitSecurityAlert({
      orgId,
      kind: "file",
      verdict: result.safe ? "safe" : "dangerous",
      target: typeof filename === "string" ? filename : "fichier",
      detail: result.threats[0],
      notifyWhatsApp: false,
    });
  }
  res.json({ ...result, pii });
});

/** Analyse un texte libre a la recherche de donnees personnelles (RGPD). */
const MAX_SCAN_TEXT_CHARS = 2_000_000;
router.post("/security/scan-text", (req, res) => {
  const { text } = req.body ?? {};
  if (typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Texte à analyser requis." });
    return;
  }
  if (text.length > MAX_SCAN_TEXT_CHARS) {
    res.status(413).json({ error: "Texte trop volumineux (max 2 Mo)." });
    return;
  }
  const pii = detectPii(text);
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (orgId && pii.hasPii) {
    // Les donnees detectees ne sont JAMAIS journalisees en clair: on ne garde
    // que le resume (categories + comptes), deja masque cote service.
    recordSecurityScan({
      orgId,
      userId: userId ?? null,
      kind: "file",
      target: "Texte analysé (RGPD)",
      verdict: "suspicious",
      details: pii.summary,
    });
  }
  res.json(pii);
});

/** Etat de la protection (couches actives + compteurs) pour l'organisation. */
router.get("/security/protection-status", (req, res) => {
  const orgId = req.session?.organisationId;
  const summary = orgId ? getOrgScanSummary(orgId) : { total: 0, dangerous: 0, suspicious: 0, last24h: 0 };
  const recent = orgId ? getRecentSecurityScans(orgId, 20) : [];
  res.json({
    layers: {
      fileAntivirus: { active: true, label: "Antivirus fichiers (signatures + heuristique)" },
      malwareEngine: {
        active: isMalwareEngineConfigured(),
        label: getMalwareEngineName()
          ? `Moteur antivirus ${getMalwareEngineName()}`
          : "Moteur antivirus externe (VirusTotal)",
      },
      urlHeuristic: { active: true, label: "Analyse heuristique des liens" },
      safeBrowsing: { active: isSafeBrowsingConfigured(), label: "Google Safe Browsing" },
      emailScan: { active: true, label: "Analyse anti-phishing des emails" },
      phoneReputation: { active: true, label: "Reputation des appels entrants" },
      whatsappScan: { active: true, label: "Scanner WhatsApp (liens & fichiers)" },
      customLists: { active: true, label: "Listes personnalisees (blocage/autorisation)" },
      piiDetection: { active: true, label: "Detection RGPD (donnees personnelles)" },
      xssSqlProtection: { active: true, label: "Protection XSS / injection SQL" },
      waf: { active: true, label: "Pare-feu applicatif (Guardian WAF)" },
      encryption: { active: true, label: "Chiffrement AES-256-GCM" },
    },
    summary,
    recentScans: recent,
  });
});

/** Alertes de securite recentes (menaces dangereuses) pour l'organisation. */
router.get("/security/alerts", (req, res) => {
  const orgId = req.session?.organisationId;
  const alerts = orgId ? getRecentAlerts(orgId, 20) : [];
  res.json({ alerts });
});

/** Score de securite agrege (0-100) + recommandations actionnables. */
router.get("/security/score", async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }

  const input = await loadSecurityScoreInput(orgId, req.log);
  const result = computeSecurityScore(input);
  res.json(result);
});

// ── Reglages securite (opt-in synthese hebdomadaire par email) ────────────────
router.get("/security/settings", async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }
  const [org] = await db
    .select({ weeklySecurityEmail: organisationsTable.weeklySecurityEmail })
    .from(organisationsTable)
    .where(eq(organisationsTable.id, orgId))
    .limit(1);
  res.json({ weeklySecurityEmail: org?.weeklySecurityEmail ?? false });
});

router.patch("/security/settings", requireAdmin, async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }
  const { weeklySecurityEmail } = req.body ?? {};
  if (typeof weeklySecurityEmail !== "boolean") {
    res.status(400).json({ error: "weeklySecurityEmail doit etre un booleen." });
    return;
  }
  await db
    .update(organisationsTable)
    .set({ weeklySecurityEmail })
    .where(eq(organisationsTable.id, orgId));
  res.json({ weeklySecurityEmail });
});

// ── Listes personnalisees (domaines + telephones bloques/autorises) ───────────
router.get("/security/lists", async (req, res) => {
  const orgId = req.session?.organisationId;
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }
  res.json({ entries: await listSecurityEntries(orgId) });
});

router.post("/security/lists", async (req, res) => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }
  const { entryType, listKind, value, note } = req.body ?? {};
  if (entryType !== "domain" && entryType !== "phone") {
    res.status(400).json({ error: "Type invalide (domain ou phone)." });
    return;
  }
  if (listKind !== "block" && listKind !== "allow") {
    res.status(400).json({ error: "Liste invalide (block ou allow)." });
    return;
  }
  if (!value || typeof value !== "string" || value.length > 300) {
    res.status(400).json({ error: "Valeur a ajouter requise." });
    return;
  }
  try {
    const entry = await addSecurityEntry({
      orgId,
      userId: userId ?? null,
      entryType: entryType as ListEntryType,
      listKind: listKind as ListKind,
      value,
      note: typeof note === "string" ? note.slice(0, 200) : null,
    });
    res.json(entry);
  } catch {
    res.status(400).json({ error: "Valeur invalide." });
  }
});

router.delete("/security/lists/:id", async (req, res) => {
  const orgId = req.session?.organisationId;
  const id = parseInt(String(req.params.id), 10);
  if (!orgId || !Number.isFinite(id)) {
    res.status(400).json({ error: "Requete invalide." });
    return;
  }
  const ok = await removeSecurityEntry(orgId, id);
  if (ok) res.json({ success: true });
  else res.status(404).json({ error: "Entree introuvable." });
});

// ── Mevcut güvenlik API'leri ──────────────────────────────────────────────────
router.get("/security/dashboard", requireAdmin, (_req, res) => {
  const stats = getSecurityStats();
  const recentEvents = getSecurityEvents(20);
  const blacklisted = getBlacklistedIps();
  res.json({ stats, recentEvents, blacklistedIps: blacklisted });
});

router.get("/security/events", requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
  const severity = req.query.severity as string | undefined;
  const events = getSecurityEvents(limit, severity);
  res.json({ events, total: events.length });
});

router.get("/security/stats", requireAdmin, (_req, res) => {
  const stats = getSecurityStats();
  res.json(stats);
});

router.get("/security/blacklist", requireAdmin, (_req, res) => {
  const ips = getBlacklistedIps();
  res.json({ blacklistedIps: ips, total: ips.length });
});

router.delete("/security/blacklist/:ip", requireAdmin, (req, res) => {
  const ip = String(req.params.ip);
  const userId = req.session?.userId;
  if (unblockIp(ip)) {
    logSecurityEvent("ip_unblocked", ip, userId ?? null, `IP ${ip} debloquee par admin ${userId}`, "info");
    res.json({ success: true, message: `IP ${ip} debloquee.` });
  } else {
    res.status(404).json({ error: "IP non trouvee dans la liste noire." });
  }
});

router.post("/security/scan", requireAdmin, (req, res) => {
  const { content, filename } = req.body;
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "Contenu a scanner requis (base64)." });
    return;
  }
  const result = scanBase64Content(content, filename);
  const userId = req.session?.userId;
  if (!result.safe) {
    logSecurityEvent(
      "file_threat_detected",
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown",
      userId ?? null,
      `Fichier dangereux detecte: ${filename || "inconnu"} - ${result.threats.join(", ")}`,
      "critical",
    );
  }
  res.json(result);
});

router.get("/security/health", requireAdmin, (_req, res) => {
  const stats = getSecurityStats();
  const gStats = getGuardianStats();
  const threatLevel =
    stats.critical > 0 || gStats.totalBlocked > 0 ? "alerte" :
    stats.warning > 10 ? "attention" : "sain";
  res.json({
    status: threatLevel,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage().heapUsed,
    securityLevel:
      stats.critical > 5 ? "critique" :
      stats.critical > 0 ? "eleve" :
      stats.warning > 10 ? "modere" : "normal",
    stats,
    guardian: gStats,
  });
});

// ── Guardian WAF API'leri ─────────────────────────────────────────────────────

router.get("/security/guardian/stats", requireAdmin, (_req, res) => {
  res.json(getGuardianStats());
});

router.get("/security/guardian/events", requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const type = req.query.type as string | undefined;
  let events = getGuardianEvents(200);
  if (type) events = events.filter(e => e.type === type);
  res.json({ events: events.slice(0, limit), total: events.length });
});

router.get("/security/guardian/banned", requireAdmin, (_req, res) => {
  res.json({ bannedIps: getGuardianBannedIps() });
});

router.get("/security/guardian/profiles", requireAdmin, (_req, res) => {
  res.json({ profiles: getGuardianThreatProfiles(30) });
});

router.delete("/security/guardian/banned/:ip", requireAdmin, (req, res) => {
  const ip = String(req.params.ip);
  const userId = req.session?.userId;
  if (unbanGuardianIp(ip)) {
    logSecurityEvent("guardian_ip_unbanned", ip, userId ?? null, `Guardian IP ${ip} engeli kaldırıldı`, "info");
    res.json({ success: true, message: `IP ${ip} Guardian engel listesinden kaldırıldı.` });
  } else {
    res.status(404).json({ error: "IP Guardian engel listesinde bulunamadı." });
  }
});

// ── Birleşik özet endpoint (dashboard için) ──────────────────────────────────
router.get("/security/overview", requireAdmin, (_req, res) => {
  const legacyStats = getSecurityStats();
  const guardianData = getGuardianStats();
  const recentEvents = getGuardianEvents(30);
  const legacyEvents = getSecurityEvents(20);
  const bannedIps = getGuardianBannedIps();
  const legacyBlacklist = getBlacklistedIps();
  const profiles = getGuardianThreatProfiles(10);

  res.json({
    guardian: guardianData,
    legacy: legacyStats,
    recentGuardianEvents: recentEvents,
    recentLegacyEvents: legacyEvents,
    bannedIps,
    legacyBlacklist,
    threatProfiles: profiles,
    summary: {
      totalBlocked: guardianData.totalBlocked + legacyStats.blacklistedIps,
      activeBans: bannedIps.length + legacyBlacklist.length,
      criticalEvents: legacyStats.critical + recentEvents.filter(e => e.severity === "critical").length,
      attackToolsDetected: guardianData.attackToolsDetected,
      honeypotTriggers: guardianData.honeypotTriggered,
    },
  });
});

export default router;
