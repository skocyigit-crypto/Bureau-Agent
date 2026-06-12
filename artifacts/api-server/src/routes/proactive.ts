import { Router, type Request, type Response } from "express";
import { db, proactiveSuggestionsTable, organisationsTable } from "@workspace/db";
import { and, eq, inArray, desc, or, isNull, type SQL } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import {
  runProactiveForOrg,
  clampInt,
  DEFAULT_MESSAGE_SLA_HOURS,
  DEFAULT_QUIET_CUSTOMER_AFTER_DAYS,
  MESSAGE_SLA_HOURS_MIN,
  MESSAGE_SLA_HOURS_MAX,
  QUIET_CUSTOMER_AFTER_DAYS_MIN,
  QUIET_CUSTOMER_AFTER_DAYS_MAX,
} from "../services/proactive-engine";
import { bumpPreferenceFromFeedback } from "../services/ai-learning";
import { sendInboxReply, runInboxScanForOrg, EMAIL_REPLY_SUGGESTION_TYPE } from "../services/autonomous-inbox";
import { logger } from "../lib/logger";

const router = Router();

const SEVERITY_RANK: Record<string, number> = { urgent: 3, warning: 2, info: 1 };
const STATUSES = ["pending", "accepted", "dismissed", "done"] as const;

// Couche d'apprentissage PAR EMPLOYÉ — règle de confidentialité.
// Une suggestion porte parfois un `userId` (cible personnelle). Un employé ne
// voit/agit QUE sur les suggestions à l'échelle de l'org (userId NULL) + les
// siennes. Un responsable (administrateur / super_admin) voit/agit sur tout.
// Renvoie une condition SQL à intégrer au `and(...)`, ou undefined si aucun
// filtre (responsable) — drizzle ignore les conditions undefined.
function visibilityFilter(req: Request): SQL | undefined {
  const role = req.session?.userRole as string | undefined;
  const isManager = role === "super_admin" || role === "administrateur";
  if (isManager) return undefined;
  const userId = req.session?.userId ?? null;
  if (userId == null) return isNull(proactiveSuggestionsTable.userId);
  return or(
    isNull(proactiveSuggestionsTable.userId),
    eq(proactiveSuggestionsTable.userId, userId),
  );
}

// GET /proactive/suggestions?status=pending — liste les suggestions du tenant.
router.get("/proactive/suggestions", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const statusParam = typeof req.query.status === "string" ? req.query.status : "pending";
    const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : "pending";

    const rows = await db
      .select()
      .from(proactiveSuggestionsTable)
      .where(
        and(
          eq(proactiveSuggestionsTable.organisationId, orgId),
          eq(proactiveSuggestionsTable.status, status),
          visibilityFilter(req),
        ),
      )
      .orderBy(desc(proactiveSuggestionsTable.createdAt))
      .limit(100);

    const sorted = [...rows].sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 0;
      const sb = SEVERITY_RANK[b.severity] ?? 0;
      if (sb !== sa) return sb - sa;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const counts = { urgent: 0, warning: 0, info: 0 };
    for (const r of sorted) {
      if (r.severity in counts) counts[r.severity as keyof typeof counts]++;
    }

    res.json({ suggestions: sorted, total: sorted.length, counts });
  } catch (err) {
    logger.error({ err }, "[proactive] list failed");
    res.status(500).json({ error: "Erreur lors du chargement des suggestions." });
  }
});

async function resolveSuggestion(
  req: Request,
  res: Response,
  status: "accepted" | "dismissed",
): Promise<void> {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }
    const updated = await db
      .update(proactiveSuggestionsTable)
      .set({ status, resolvedAt: new Date(), resolvedByUserId: req.session?.userId ?? null })
      .where(
        and(
          eq(proactiveSuggestionsTable.id, id),
          eq(proactiveSuggestionsTable.organisationId, orgId),
          visibilityFilter(req),
        ),
      )
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ error: "Suggestion introuvable." });
      return;
    }
    res.json({ success: true, suggestion: updated[0] });
  } catch (err) {
    logger.error({ err }, "[proactive] resolve failed");
    res.status(500).json({ error: "Erreur lors de la mise à jour." });
  }
}

router.post("/proactive/suggestions/:id/accept", (req, res) =>
  resolveSuggestion(req, res, "accepted"),
);
router.post("/proactive/suggestions/:id/dismiss", (req, res) =>
  resolveSuggestion(req, res, "dismissed"),
);

// Feedback 👍/👎 — alimente la couche d'apprentissage IA (pilier B).
router.post("/proactive/suggestions/:id/feedback", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    const value = req.body?.value;
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }
    if (value !== "up" && value !== "down") {
      res.status(400).json({ error: "Feedback invalide (up|down)." });
      return;
    }
    const updated = await db
      .update(proactiveSuggestionsTable)
      .set({ feedback: value })
      .where(
        and(
          eq(proactiveSuggestionsTable.id, id),
          eq(proactiveSuggestionsTable.organisationId, orgId),
          visibilityFilter(req),
        ),
      )
      .returning({ id: proactiveSuggestionsTable.id, type: proactiveSuggestionsTable.type });
    if (updated.length === 0) {
      res.status(404).json({ error: "Suggestion introuvable." });
      return;
    }
    // Recompute-on-vote: met à jour la préférence apprise pour ce type (fire-and-forget).
    const suggestionType = updated[0]?.type;
    if (suggestionType) {
      void bumpPreferenceFromFeedback(orgId, "suggestion_type", suggestionType).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[proactive] feedback failed");
    res.status(500).json({ error: "Erreur lors de l'enregistrement du feedback." });
  }
});

// POST /proactive/run — déclenchement manuel (cooldown léger anti-spam).
const RUN_COOLDOWN_MS = 30 * 1000;
const RUN_MAP_MAX = 500;
const lastRunByOrg = new Map<number, number>();
function pruneRunMap(): void {
  if (lastRunByOrg.size <= RUN_MAP_MAX) return;
  while (lastRunByOrg.size > RUN_MAP_MAX) {
    const first = lastRunByOrg.keys().next().value;
    if (first === undefined) break;
    lastRunByOrg.delete(first);
  }
}

// Scan de boîte e-mail autonome : plus coûteux (Gmail + IA) -> cooldown plus long.
const INBOX_SCAN_COOLDOWN_MS = 60 * 1000;
const lastInboxScanByOrg = new Map<number, number>();

router.post("/proactive/run", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = Date.now();
    const last = lastRunByOrg.get(orgId) ?? 0;
    if (now - last < RUN_COOLDOWN_MS) {
      const waitSec = Math.ceil((RUN_COOLDOWN_MS - (now - last)) / 1000);
      res.status(429).json({ error: `Patientez ${waitSec}s avant la prochaine analyse.` });
      return;
    }
    lastRunByOrg.set(orgId, now);
    pruneRunMap();
    const created = await runProactiveForOrg(orgId);
    res.json({ success: true, created });
  } catch (err) {
    logger.error({ err }, "[proactive] run failed");
    res.status(500).json({ error: "Erreur lors de l'analyse proactive." });
  }
});

// POST /proactive/suggestions/:id/send-reply — envoie la réponse APPROUVÉE par
// l'humain pour une suggestion `email_reply_needed`. Le corps édité par
// l'utilisateur prime sur le brouillon IA. Envoi dans le fil Gmail d'origine,
// depuis la boîte qui a reçu l'e-mail (scannedByUserId stocké dans le payload).
// La suggestion passe en `accepted` + feedback 👍 (signal positif d'apprentissage).
// Aucune action autonome : c'est le SEUL chemin d'envoi.
router.post("/proactive/suggestions/:id/send-reply", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "ID invalide." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const editedSubject = typeof body.subject === "string" ? body.subject.trim() : "";
    const editedBody = typeof body.body === "string" ? body.body.trim() : "";
    if (!editedBody) {
      res.status(400).json({ error: "Le corps de la réponse est requis." });
      return;
    }

    const [suggestion] = await db
      .select()
      .from(proactiveSuggestionsTable)
      .where(
        and(
          eq(proactiveSuggestionsTable.id, id),
          eq(proactiveSuggestionsTable.organisationId, orgId),
          eq(proactiveSuggestionsTable.type, EMAIL_REPLY_SUGGESTION_TYPE),
          eq(proactiveSuggestionsTable.status, "pending"),
          visibilityFilter(req),
        ),
      )
      .limit(1);
    if (!suggestion) {
      res.status(404).json({ error: "Suggestion introuvable ou déjà traitée." });
      return;
    }

    const payload = (suggestion.actionPayload ?? {}) as Record<string, unknown>;
    const scannedByUserId = Number(payload.scannedByUserId);
    const to = String(payload.fromEmail || "");
    const threadId = payload.threadId ? String(payload.threadId) : undefined;
    const messageId = payload.messageId ? String(payload.messageId) : undefined;
    const subject = editedSubject || String(payload.draftSubject || payload.subject || "");
    if (!Number.isFinite(scannedByUserId) || scannedByUserId <= 0 || !to) {
      res.status(409).json({ error: "Contexte d'envoi incomplet (boîte ou destinataire manquant)." });
      return;
    }

    // Garde anti-usurpation : l'envoi part de la boîte Gmail `scannedByUserId`
    // (souvent un responsable). Une suggestion à l'échelle de l'org est visible
    // par tous ; sans ce contrôle, un employé pourrait déclencher un envoi depuis
    // la boîte d'autrui. On n'autorise donc que : le propriétaire de la boîte
    // lui-même, OU un responsable (administrateur/super_admin).
    const actingUserId = req.session?.userId ?? null;
    const actingRole = req.session?.userRole as string | undefined;
    const isManager = actingRole === "administrateur" || actingRole === "super_admin";
    if (!isManager && actingUserId !== scannedByUserId) {
      res.status(403).json({ error: "Vous n'êtes pas autorisé à envoyer depuis cette boîte e-mail." });
      return;
    }

    // Réservation ATOMIQUE avant l'envoi (pending -> accepted) : empêche un
    // double envoi sous concurrence (deux clics / deux onglets). Seule la
    // première requête « gagne » le passage de statut ; les autres voient 0 ligne.
    const claimed = await db
      .update(proactiveSuggestionsTable)
      .set({ status: "accepted", resolvedAt: new Date(), resolvedByUserId: actingUserId })
      .where(
        and(
          eq(proactiveSuggestionsTable.id, id),
          eq(proactiveSuggestionsTable.organisationId, orgId),
          eq(proactiveSuggestionsTable.type, EMAIL_REPLY_SUGGESTION_TYPE),
          eq(proactiveSuggestionsTable.status, "pending"),
        ),
      )
      .returning({ id: proactiveSuggestionsTable.id });
    if (claimed.length === 0) {
      res.status(409).json({ error: "Cette réponse a déjà été traitée." });
      return;
    }

    try {
      await sendInboxReply({
        userId: scannedByUserId,
        to,
        subject,
        bodyHtml: editedBody.includes("<") ? editedBody : `<p>${editedBody.replace(/\n/g, "<br>")}</p>`,
        threadId,
        messageId,
      });
    } catch (err) {
      // Échec d'envoi : on REND la suggestion (accepted -> pending) pour que
      // l'utilisateur puisse réessayer ; la réservation atomique est annulée.
      await db
        .update(proactiveSuggestionsTable)
        .set({ status: "pending", resolvedAt: null, resolvedByUserId: null })
        .where(
          and(
            eq(proactiveSuggestionsTable.id, id),
            eq(proactiveSuggestionsTable.organisationId, orgId),
          ),
        );
      if (err instanceof Error && err.message === "mailbox_disconnected") {
        res.status(409).json({ error: "La boîte Gmail liée à cette suggestion est déconnectée." });
        return;
      }
      throw err;
    }

    // Envoi réussi : marque le retour positif (signal d'apprentissage).
    await db
      .update(proactiveSuggestionsTable)
      .set({ feedback: "up" })
      .where(
        and(
          eq(proactiveSuggestionsTable.id, id),
          eq(proactiveSuggestionsTable.organisationId, orgId),
        ),
      );
    // Envoyer une réponse = signal positif fort : renforce la préférence apprise.
    void bumpPreferenceFromFeedback(orgId, "suggestion_type", EMAIL_REPLY_SUGGESTION_TYPE).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[proactive] send-reply failed");
    res.status(500).json({ error: "Erreur lors de l'envoi de la réponse." });
  }
});

// POST /proactive/inbox/scan — déclenchement manuel du scan de boîte e-mail
// autonome pour l'org (cooldown léger anti-spam, partagé avec /run).
router.post("/proactive/inbox/scan", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const now = Date.now();
    const last = lastInboxScanByOrg.get(orgId) ?? 0;
    if (now - last < INBOX_SCAN_COOLDOWN_MS) {
      const waitSec = Math.ceil((INBOX_SCAN_COOLDOWN_MS - (now - last)) / 1000);
      res.status(429).json({ error: `Patientez ${waitSec}s avant le prochain scan.` });
      return;
    }
    lastInboxScanByOrg.set(orgId, now);
    if (lastInboxScanByOrg.size > RUN_MAP_MAX) {
      const first = lastInboxScanByOrg.keys().next().value;
      if (first !== undefined) lastInboxScanByOrg.delete(first);
    }
    const result = await runInboxScanForOrg(orgId);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, "[proactive] inbox scan failed");
    res.status(500).json({ error: "Erreur lors du scan de la boîte e-mail." });
  }
});

// GET /proactive/settings — réglages du moteur pour l'org (activation +
// fenêtres réglables : délai de réponse aux messages, seuil « client silencieux »).
// Renvoie aussi les bornes/défauts pour que l'UI valide et affiche les limites.
router.get("/proactive/settings", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const [org] = await db
      .select({
        enabled: organisationsTable.proactiveEngineEnabled,
        messageSlaHours: organisationsTable.messageSlaHours,
        quietCustomerAfterDays: organisationsTable.quietCustomerAfterDays,
      })
      .from(organisationsTable)
      .where(eq(organisationsTable.id, orgId));
    res.json({
      enabled: org?.enabled ?? true,
      messageSlaHours: clampInt(
        org?.messageSlaHours,
        MESSAGE_SLA_HOURS_MIN,
        MESSAGE_SLA_HOURS_MAX,
        DEFAULT_MESSAGE_SLA_HOURS,
      ),
      quietCustomerAfterDays: clampInt(
        org?.quietCustomerAfterDays,
        QUIET_CUSTOMER_AFTER_DAYS_MIN,
        QUIET_CUSTOMER_AFTER_DAYS_MAX,
        DEFAULT_QUIET_CUSTOMER_AFTER_DAYS,
      ),
      bounds: {
        messageSlaHours: { min: MESSAGE_SLA_HOURS_MIN, max: MESSAGE_SLA_HOURS_MAX, default: DEFAULT_MESSAGE_SLA_HOURS },
        quietCustomerAfterDays: {
          min: QUIET_CUSTOMER_AFTER_DAYS_MIN,
          max: QUIET_CUSTOMER_AFTER_DAYS_MAX,
          default: DEFAULT_QUIET_CUSTOMER_AFTER_DAYS,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, "[proactive] settings get failed");
    res.status(500).json({ error: "Erreur lors du chargement des réglages." });
  }
});

// PATCH /proactive/settings — met à jour les réglages du moteur pour l'org.
// Champs optionnels (mise à jour partielle): `enabled` (bool), `messageSlaHours`
// (int borné), `quietCustomerAfterDays` (int borné). Réservé aux administrateurs
// (réglage org-wide): un agent ne doit pas pouvoir couper ou dérégler la
// surveillance proactive de toute l'organisation.
router.patch("/proactive/settings", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        res.status(400).json({ error: "Champ 'enabled' doit être un booléen." });
        return;
      }
      update.proactiveEngineEnabled = body.enabled;
    }

    if ("messageSlaHours" in body) {
      const n = Number(body.messageSlaHours);
      if (!Number.isFinite(n) || n < MESSAGE_SLA_HOURS_MIN || n > MESSAGE_SLA_HOURS_MAX) {
        res.status(400).json({
          error: `Le délai de réponse doit être un nombre entre ${MESSAGE_SLA_HOURS_MIN} et ${MESSAGE_SLA_HOURS_MAX} heures.`,
        });
        return;
      }
      update.messageSlaHours = Math.round(n);
    }

    if ("quietCustomerAfterDays" in body) {
      const n = Number(body.quietCustomerAfterDays);
      if (!Number.isFinite(n) || n < QUIET_CUSTOMER_AFTER_DAYS_MIN || n > QUIET_CUSTOMER_AFTER_DAYS_MAX) {
        res.status(400).json({
          error: `Le seuil « client silencieux » doit être un nombre entre ${QUIET_CUSTOMER_AFTER_DAYS_MIN} et ${QUIET_CUSTOMER_AFTER_DAYS_MAX} jours.`,
        });
        return;
      }
      update.quietCustomerAfterDays = Math.round(n);
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "Aucun réglage à mettre à jour." });
      return;
    }

    const [saved] = await db
      .update(organisationsTable)
      .set(update)
      .where(eq(organisationsTable.id, orgId))
      .returning({
        enabled: organisationsTable.proactiveEngineEnabled,
        messageSlaHours: organisationsTable.messageSlaHours,
        quietCustomerAfterDays: organisationsTable.quietCustomerAfterDays,
      });
    res.json({
      success: true,
      enabled: saved?.enabled ?? true,
      messageSlaHours: saved?.messageSlaHours ?? DEFAULT_MESSAGE_SLA_HOURS,
      quietCustomerAfterDays: saved?.quietCustomerAfterDays ?? DEFAULT_QUIET_CUSTOMER_AFTER_DAYS,
    });
  } catch (err) {
    logger.error({ err }, "[proactive] settings patch failed");
    res.status(500).json({ error: "Erreur lors de la mise à jour des réglages." });
  }
});

export default router;
