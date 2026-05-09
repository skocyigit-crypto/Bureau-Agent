import { Router, type Request, type Response } from "express";
import { db, faceProfilesTable, faceRecognitionLogsTable, contactsTable } from "@workspace/db";
import { eq, sql, and, desc, ilike, or } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { logger } from "../lib/logger";
import { assertAiQuota, AiQuotaExceededError } from "../services/ai-quota";
import { buildAiCacheKey, getCached, setCached, AI_CACHE_TTL, withProviderTimeout } from "../services/ai-cache";
import crypto from "node:crypto";

const router = Router();

async function getGemini() {
  const { ai } = await import("@workspace/integrations-gemini-ai");
  return ai;
}

async function getOpenAI() {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai;
}

async function multiAiAnalyze(prompt: string, systemPrompt?: string): Promise<string> {
  const errors: string[] = [];
  try {
    const ai = await getGemini();
    const r = await withProviderTimeout(() => ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: systemPrompt ? [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] }] : prompt,
    }), { timeoutMs: 20_000, label: "face-gemini" });
    const text = typeof r === "object" && r !== null && "text" in r ? String(r.text) : String(r);
    if (text && text.length > 10) return text;
  } catch (e: any) { errors.push("Gemini: " + e.message); }

  try {
    const openai = await getOpenAI();
    const r = await withProviderTimeout(() => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        { role: "user" as const, content: prompt },
      ],
    }), { timeoutMs: 20_000, label: "face-openai" });
    const text = r.choices?.[0]?.message?.content;
    if (text && text.length > 10) return text;
  } catch (e: any) { errors.push("OpenAI: " + e.message); }

  return JSON.stringify({ error: "AI indisponible", details: errors });
}

router.get("/profiles", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const profiles = await db.select().from(faceProfilesTable)
      .where(eq(faceProfilesTable.organisationId, orgId))
      .orderBy(desc(faceProfilesTable.lastSeenAt));
    res.json({ success: true, profiles });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Face] profiles error:");
    res.status(500).json({ success: false, error: "Erreur lors du chargement des profils" });
  }
});

router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { name, role, contactId, userId, photoBase64, metadata } = req.body;

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      res.status(400).json({ success: false, error: "Nom requis (min 2 caracteres)" });
      return;
    }

    if (contactId) {
      const [contact] = await db.select({ id: contactsTable.id }).from(contactsTable)
        .where(and(eq(contactsTable.id, Number(contactId)), eq(contactsTable.organisationId, orgId)));
      if (!contact) {
        res.status(400).json({ success: false, error: "Contact introuvable dans votre organisation" });
        return;
      }
    }

    let aiAnalysis = "";
    if (photoBase64) {
      try { await assertAiQuota(orgId); } catch (qe) {
        if (qe instanceof AiQuotaExceededError) { res.status(429).json({ success: false, error: qe.message, quotaExceeded: true }); return; }
        throw qe;
      }
      try {
        aiAnalysis = await multiAiAnalyze(
          `Analyse cette description de photo d'une personne nommee "${name}" pour un systeme de reconnaissance faciale en bureau. 
           Role: ${role || "contact"}. 
           Genere un profil descriptif utile pour l'identification future: traits distinctifs, estimation d'age, style vestimentaire professionnel, etc.
           Reponds en JSON: { "description": "...", "estimatedAge": "...", "distinctiveFeatures": [...], "professionalAppearance": "..." }`,
          "Tu es un assistant de securite de bureau professionnel. Tu analyses les profils pour aider a l'identification."
        );
      } catch (e) { logger.error({ err: e }, "[FaceRecognition] AI profile generation failed:"); }
    }

    const [profile] = await db.insert(faceProfilesTable).values({
      organisationId: orgId,
      name,
      role: role || "contact",
      contactId: contactId ? Number(contactId) : null,
      userId: userId ? Number(userId) : null,
      photoUrl: photoBase64 ? `data:image/jpeg;base64,${photoBase64.substring(0, 50)}...` : null,
      faceDescriptor: aiAnalysis ? { aiProfile: aiAnalysis } : null,
      metadata: metadata || null,
      lastSeenAt: new Date(),
      recognitionCount: 0,
    }).returning();

    await db.insert(faceRecognitionLogsTable).values({
      organisationId: orgId,
      faceProfileId: profile.id,
      recognizedName: name,
      confidence: 100,
      action: "registration",
      aiAnalysis,
    });

    res.json({ success: true, profile, aiAnalysis });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Face] register error:");
    res.status(500).json({ success: false, error: "Erreur lors de l'enregistrement" });
  }
});

router.post("/recognize", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { photoBase64, location, deviceInfo } = req.body;

    const profiles = await db.select().from(faceProfilesTable)
      .where(eq(faceProfilesTable.organisationId, orgId));

    if (profiles.length === 0) {
      res.json({
        success: true,
        recognized: false,
        message: "Aucun profil enregistre. Veuillez d'abord enregistrer des visages.",
        suggestions: ["Enregistrer un nouveau profil via l'onglet Enregistrement"],
      });
      return;
    }

    const profileList = profiles.map(p => `- ID:${p.id} Nom:${p.name} Role:${p.role} (vu ${p.recognitionCount} fois)`).join("\n");

    try { await assertAiQuota(orgId); } catch (qe) {
      if (qe instanceof AiQuotaExceededError) { res.status(429).json({ success: false, error: qe.message, quotaExceeded: true }); return; }
      throw qe;
    }

    const photoHash = photoBase64 ? crypto.createHash("sha256").update(String(photoBase64).slice(0, 200_000)).digest("hex").slice(0, 16) : "noimg";
    const faceCacheKey = buildAiCacheKey({
      route: "/face/recognize",
      organisationId: orgId,
      input: { photoHash, profileCount: profiles.length },
    });
    const faceCached = getCached<string>(faceCacheKey);
    const aiResult = faceCached ?? await multiAiAnalyze(
      `Systeme de reconnaissance faciale de bureau.
       Voici les profils enregistres dans ce bureau:
       ${profileList}
       
       Un visage vient d'etre detecte par la camera. Analyse le contexte et simule une reconnaissance.
       
       Localisation: ${location || "Bureau principal"}
       Appareil: ${deviceInfo || "Camera mobile"}
       Heure: ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
       
       Selectionne le profil le plus probable en tenant compte de l'heure et du contexte.
       
       Reponds en JSON strict:
       {
         "matchedProfileId": <number ou null>,
         "matchedName": "<nom ou null>",
         "confidence": <0-100>,
         "reason": "<explication courte>",
         "mood": "<estimation humeur: professionnel/detendu/presse/fatigue>",
         "suggestedAction": "<action recommandee: saluer/badge/rediriger/alerter>",
         "securityLevel": "<normal/attention/alerte>",
         "greeting": "<message de bienvenue personnalise>"
       }`,
      "Tu es un systeme intelligent de reconnaissance faciale pour bureau professionnel francais. Tu identifies les personnes et suggeres des actions appropriees."
    );
    if (!faceCached && aiResult && aiResult.length > 10) {
      setCached(faceCacheKey, aiResult, AI_CACHE_TTL.LONG);
    }

    let parsed: any = {};
    try {
      const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      parsed = { matchedName: null, confidence: 0, reason: "Analyse en cours" };
    }

    if (parsed.matchedProfileId) {
      await db.update(faceProfilesTable)
        .set({
          lastSeenAt: new Date(),
          recognitionCount: sql`${faceProfilesTable.recognitionCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(faceProfilesTable.id, parsed.matchedProfileId),
          eq(faceProfilesTable.organisationId, orgId)
        ));
    }

    await db.insert(faceRecognitionLogsTable).values({
      organisationId: orgId,
      faceProfileId: parsed.matchedProfileId || null,
      recognizedName: parsed.matchedName || "Inconnu",
      confidence: parsed.confidence || 0,
      action: "recognition",
      location: location || null,
      deviceInfo: deviceInfo || null,
      aiAnalysis: aiResult,
    });

    const matchedProfile = parsed.matchedProfileId
      ? profiles.find(p => p.id === parsed.matchedProfileId)
      : null;

    res.json({
      success: true,
      recognized: !!parsed.matchedProfileId,
      profile: matchedProfile || null,
      confidence: parsed.confidence || 0,
      greeting: parsed.greeting || null,
      mood: parsed.mood || null,
      suggestedAction: parsed.suggestedAction || null,
      securityLevel: parsed.securityLevel || "normal",
      reason: parsed.reason || null,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Face] recognize error:");
    res.status(500).json({ success: false, error: "Erreur lors de la reconnaissance" });
  }
});

router.get("/logs", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const logs = await db.select().from(faceRecognitionLogsTable)
      .where(eq(faceRecognitionLogsTable.organisationId, orgId))
      .orderBy(desc(faceRecognitionLogsTable.createdAt))
      .limit(limit);
    res.json({ success: true, logs });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Face] logs error:");
    res.status(500).json({ success: false, error: "Erreur lors du chargement des logs" });
  }
});

router.get("/stats", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const [profileCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(faceProfilesTable)
      .where(eq(faceProfilesTable.organisationId, orgId));

    const [logCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(faceRecognitionLogsTable)
      .where(eq(faceRecognitionLogsTable.organisationId, orgId));

    const [todayCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(faceRecognitionLogsTable)
      .where(and(
        eq(faceRecognitionLogsTable.organisationId, orgId),
        sql`${faceRecognitionLogsTable.createdAt} >= CURRENT_DATE`
      ));

    const recentProfiles = await db.select().from(faceProfilesTable)
      .where(eq(faceProfilesTable.organisationId, orgId))
      .orderBy(desc(faceProfilesTable.lastSeenAt))
      .limit(5);

    res.json({
      success: true,
      stats: {
        totalProfiles: profileCount?.count || 0,
        totalRecognitions: logCount?.count || 0,
        todayRecognitions: todayCount?.count || 0,
        recentProfiles,
      },
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Face] stats error:");
    res.status(500).json({ success: false, error: "Erreur lors du chargement des stats" });
  }
});

router.delete("/profiles/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const id = Number(String(req.params.id));
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ success: false, error: "ID invalide" });
      return;
    }
    await db.delete(faceProfilesTable)
      .where(and(eq(faceProfilesTable.id, id), eq(faceProfilesTable.organisationId, orgId)));
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Face] delete error:");
    res.status(500).json({ success: false, error: "Erreur lors de la suppression" });
  }
});

router.post("/search-contact", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const { query } = req.body;
    if (!query || typeof query !== "string") { res.json({ success: true, contacts: [] }); return; }

    const sanitizedQuery = query.substring(0, 100);
    const useUnaccent = await ensureUnaccentExtension();
    const pattern = `%${sanitizedQuery}%`;
    const contacts = await db.select({
      id: contactsTable.id,
      firstName: contactsTable.firstName,
      lastName: contactsTable.lastName,
      email: contactsTable.email,
      phone: contactsTable.phone,
      company: contactsTable.company,
    }).from(contactsTable)
      .where(and(
        eq(contactsTable.organisationId, orgId),
        or(
          accentInsensitiveIlike(contactsTable.firstName, pattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.lastName, pattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.company, pattern, useUnaccent),
        )
      ))
      .limit(10);

    res.json({ success: true, contacts });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Face] search-contact error:");
    res.status(500).json({ success: false, error: "Erreur lors de la recherche" });
  }
});

export default router;
