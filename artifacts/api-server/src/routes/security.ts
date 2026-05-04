import { Router } from "express";
import { requireRole } from "../middleware/auth";
import {
  getSecurityEvents,
  getSecurityStats,
  getBlacklistedIps,
  unblockIp,
  scanBase64Content,
  logSecurityEvent,
} from "../middleware/security";
import {
  getGuardianStats,
  getGuardianEvents,
  getGuardianBannedIps,
  getGuardianThreatProfiles,
  unbanGuardianIp,
} from "../middleware/guardian";

const router = Router();

const requireAdmin = requireRole("super_admin", "administrateur");

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
  const userId = (req.session as any)?.userId;
  if (unblockIp(ip)) {
    logSecurityEvent("ip_unblocked", ip, userId, `IP ${ip} debloquee par admin ${userId}`, "info");
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
  const userId = (req.session as any)?.userId;
  if (!result.safe) {
    logSecurityEvent(
      "file_threat_detected",
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket?.remoteAddress || "unknown",
      userId,
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
  const userId = (req.session as any)?.userId;
  if (unbanGuardianIp(ip)) {
    logSecurityEvent("guardian_ip_unbanned", ip, userId, `Guardian IP ${ip} engeli kaldırıldı`, "info");
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
