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

const router = Router();

const requireAdmin = requireRole("super_admin", "administrateur");

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
  const ip = req.params.ip;
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
  const status = stats.critical > 0 ? "alerte" : stats.warning > 10 ? "attention" : "sain";
  res.json({
    status,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage().heapUsed,
    securityLevel: stats.critical > 5 ? "critique" :
                   stats.critical > 0 ? "eleve" :
                   stats.warning > 10 ? "modere" : "normal",
    stats,
  });
});

export default router;
