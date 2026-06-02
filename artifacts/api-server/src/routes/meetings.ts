import { Router } from "express";
import { db, projetsTable, tasksTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { assertAiQuota, invalidateQuotaCache } from "../services/ai-quota";
import { recordAiUsage, GEMINI_PRO_MODEL } from "../services/ai-utils";

const router = Router();

// ---------------------------------------------------------------------------
// Haversine distance in km between two GPS points
// ---------------------------------------------------------------------------
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// POST /api/meetings/compile
// Body: { notes: string, transcript?: string, latitude?: number, longitude?: number }
// ---------------------------------------------------------------------------
router.post("/meetings/compile", async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    const userId = req.session?.userId;
    if (!orgId || !userId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const { notes, transcript, latitude, longitude } = req.body as {
      notes?: string;
      transcript?: string;
      latitude?: number;
      longitude?: number;
    };

    if (!notes || notes.trim().length < 10) {
      res.status(400).json({ error: "Les notes de reunion sont requises (min 10 caracteres)." });
      return;
    }

    const safeNotes = notes.substring(0, 8000);
    const safeTranscript = transcript ? transcript.substring(0, 12000) : null;

    // -----------------------------------------------------------------------
    // AI: Compile meeting
    // -----------------------------------------------------------------------
    await assertAiQuota(orgId);

    const geminiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    const geminiBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";

    if (!geminiKey) {
      res.status(503).json({ error: "IA non configuree. Ajoutez AI_INTEGRATIONS_GEMINI_API_KEY." });
      return;
    }

    const inputText = safeTranscript
      ? `NOTES:\n${safeNotes}\n\nTRANSCRIPT:\n${safeTranscript}`
      : `NOTES:\n${safeNotes}`;

    const prompt = `Tu es un assistant expert en gestion de projets et de chantiers. Analyse ce compte-rendu de reunion et reponds en JSON strict.

${inputText}

Reponds UNIQUEMENT avec ce JSON (sans markdown, sans backticks) :
{
  "resume": "Résumé concis de la reunion en 2-3 phrases",
  "pointsCles": [
    "Point cle 1",
    "Point cle 2"
  ],
  "decisionsActees": [
    "Decision 1"
  ],
  "actionItems": [
    {
      "titre": "Titre de la tache",
      "description": "Details optionnels",
      "priorite": "haute|moyenne|basse",
      "echeanceJours": 7,
      "assigneA": "nom si mentionne ou null"
    }
  ]
}

Regles:
- pointsCles: 3 a 8 points importants discutes
- decisionsActees: decisions formelles prises (peut etre vide)
- actionItems: taches concretes a realiser (1 a 10 maximum)
- echeanceJours: nombre de jours a partir d'aujourd'hui (1=demain, 7=semaine prochaine, 30=mois prochain)
- priorite: "haute" si urgent/critique, "basse" si secondaire, "moyenne" sinon`;

    const t0 = Date.now();
    const aiRes = await fetch(
      `${geminiBase}/v1beta/models/${GEMINI_PRO_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      }
    );

    const aiData = await aiRes.json() as any;
    const rawText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const durationMs = Date.now() - t0;

    await recordAiUsage({
      organisationId: orgId,
      userId,
      provider: "gemini",
      model: GEMINI_PRO_MODEL,
      route: "/api/meetings/compile",
      inputTokens: aiData?.usageMetadata?.promptTokenCount || 0,
      outputTokens: aiData?.usageMetadata?.candidatesTokenCount || 0,
      durationMs,
    });
    await invalidateQuotaCache(orgId);

    // Parse AI response
    let parsed: any;
    try {
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn("[Meetings] AI response parse failed, using fallback");
      parsed = {
        resume: rawText.substring(0, 300) || "Compilation non disponible.",
        pointsCles: [],
        decisionsActees: [],
        actionItems: [],
      };
    }

    const resume: string = parsed.resume || "";
    const pointsCles: string[] = Array.isArray(parsed.pointsCles) ? parsed.pointsCles.slice(0, 10) : [];
    const decisionsActees: string[] = Array.isArray(parsed.decisionsActees) ? parsed.decisionsActees.slice(0, 10) : [];
    const actionItems: any[] = Array.isArray(parsed.actionItems) ? parsed.actionItems.slice(0, 10) : [];

    // -----------------------------------------------------------------------
    // Create tasks from action items
    // -----------------------------------------------------------------------
    const tasksCreated: { id: number; titre: string; priorite: string; echeance: string | null }[] = [];

    for (const item of actionItems) {
      if (!item.titre || typeof item.titre !== "string") continue;
      const title = item.titre.substring(0, 255);
      const description = item.description ? String(item.description).substring(0, 1000) : null;
      const priority = ["haute", "moyenne", "basse"].includes(item.priorite) ? item.priorite : "moyenne";
      const days = typeof item.echeanceJours === "number" && item.echeanceJours > 0 ? item.echeanceJours : 7;
      const dueDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      try {
        const [inserted] = await db.insert(tasksTable).values({
          organisationId: orgId,
          title: `[Réunion] ${title}`,
          description: description || `Tache issue du compte-rendu de reunion du ${new Date().toLocaleDateString("fr-FR")}`,
          status: "en_attente",
          priority,
          dueDate,
          assignedTo: item.assigneA && item.assigneA !== "null" ? String(item.assigneA).substring(0, 100) : null,
          createdBy: userId,
        }).returning({ id: tasksTable.id });

        if (inserted) {
          tasksCreated.push({
            id: inserted.id,
            titre: title,
            priorite: priority,
            echeance: dueDate.toLocaleDateString("fr-FR"),
          });
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, "[Meetings] Task creation failed:");
      }
    }

    // -----------------------------------------------------------------------
    // Find nearest chantier (project) by geolocation
    // -----------------------------------------------------------------------
    let chantierLePlusProche: {
      id: number;
      titre: string;
      adresse: string | null;
      status: string;
      distanceKm: number;
    } | null = null;

    if (typeof latitude === "number" && typeof longitude === "number") {
      const projets = await db
        .select({
          id: projetsTable.id,
          title: projetsTable.title,
          address: projetsTable.address,
          status: projetsTable.status,
          latitude: projetsTable.latitude,
          longitude: projetsTable.longitude,
        })
        .from(projetsTable)
        .where(
          and(
            eq(projetsTable.organisationId, orgId),
            isNotNull(projetsTable.latitude),
            isNotNull(projetsTable.longitude)
          )
        );

      let minDist = Infinity;
      for (const p of projets) {
        if (p.latitude == null || p.longitude == null) continue;
        const dist = haversineKm(latitude, longitude, p.latitude, p.longitude);
        if (dist < minDist) {
          minDist = dist;
          chantierLePlusProche = {
            id: p.id,
            titre: p.title,
            adresse: p.address,
            status: p.status,
            distanceKm: Math.round(dist * 100) / 100,
          };
        }
      }

      // Only return if within 50km (reasonable field meeting range)
      if (chantierLePlusProche && chantierLePlusProche.distanceKm > 50) {
        chantierLePlusProche = null;
      }
    }

    res.json({
      success: true,
      resume,
      pointsCles,
      decisionsActees,
      actionItems,
      tasksCreees: tasksCreated,
      chantierLePlusProche,
      compiledAt: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ err: error }, "[Meetings] compile error:");
    res.status(500).json({ error: "Erreur lors de la compilation de la reunion." });
  }
});

// ---------------------------------------------------------------------------
// GET /api/meetings/chantiers — list projects with GPS coords for the map picker
// ---------------------------------------------------------------------------
router.get("/meetings/chantiers", async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const projets = await db
      .select({
        id: projetsTable.id,
        title: projetsTable.title,
        address: projetsTable.address,
        status: projetsTable.status,
        latitude: projetsTable.latitude,
        longitude: projetsTable.longitude,
        priority: projetsTable.priority,
        progress: projetsTable.progress,
      })
      .from(projetsTable)
      .where(eq(projetsTable.organisationId, orgId));

    res.json({ chantiers: projets });
  } catch (error: any) {
    logger.error({ err: error }, "[Meetings] chantiers list error:");
    res.status(500).json({ error: "Erreur lors de la recuperation des chantiers." });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/meetings/chantiers/:id/location — set GPS coords on a project
// ---------------------------------------------------------------------------
router.patch("/meetings/chantiers/:id/location", async (req, res): Promise<void> => {
  try {
    const orgId = req.session?.organisationId;
    if (!orgId) { res.status(401).json({ error: "Non authentifie" }); return; }

    const id = parseInt(req.params.id);
    const { latitude, longitude } = req.body as { latitude?: number; longitude?: number };

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      res.status(400).json({ error: "latitude et longitude requis (nombres)" });
      return;
    }

    await db
      .update(projetsTable)
      .set({ latitude, longitude })
      .where(and(eq(projetsTable.id, id), eq(projetsTable.organisationId, orgId)));

    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error }, "[Meetings] set location error:");
    res.status(500).json({ error: "Erreur lors de la mise a jour de la localisation." });
  }
});

export default router;
