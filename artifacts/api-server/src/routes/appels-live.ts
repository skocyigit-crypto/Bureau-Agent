/**
 * APPELS EN DIRECT : liste, detail (transcription, etape de l'agent, contexte
 * de l'appelant), capacite de reprise, reprise, et actions depuis l'ecran
 * (tache, note, rendez-vous de decouverte) rattachees a l'appel.
 *
 * Ressource TENANT : tout est borne a l'organisation de la session
 * (`getOrgId`). Un CallSid d'une autre organisation rend 404 — pas 403 : dire
 * « existe mais pas pour vous » apprendrait a un inconnu quels appels existent.
 *
 * Aucun secret fournisseur ne sort de ces routes (services/appel-live projette
 * champ par champ). L'ecran interroge toutes les ~4 s : le SSE est propre a une
 * instance Cloud Run, un tour traite par une autre instance n'y passerait pas.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, calendarEventsTable, notesInternesTable, tasksTable, voiceCallSessionsTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { logAudit } from "./audit";
import { capaciteReprise, detailAppel, lierActionAppel, listerAppelsEnDirect, reprendreAppel } from "../services/appel-live";

const router: IRouter = Router();

const CALL_SID = /^[A-Za-z0-9_-]{6,64}$/;

function callSidValide(v: unknown): string | null {
  const s = String(v ?? "");
  return CALL_SID.test(s) ? s : null;
}

/** Un compte en lecture seule regarde ; il ne reprend pas un appel et n'ecrit rien. */
function peutAgir(req: Request): boolean {
  return req.session?.userRole !== "lecture_seule";
}

function texte(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function sessionDeLOrganisation(orgId: number, callSid: string) {
  const [r] = await db.select({ id: voiceCallSessionsTable.id, state: voiceCallSessionsTable.state })
    .from(voiceCallSessionsTable)
    .where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)))
    .limit(1);
  return r ?? null;
}

router.get("/appels-live", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  res.json({ appels: await listerAppelsEnDirect(orgId) });
});

// Avant `/:callSid` : sinon « capacite » serait lu comme un CallSid.
router.get("/appels-live/capacite", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  res.json(await capaciteReprise(orgId, req.session.userId!));
});

router.get("/appels-live/:callSid", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const callSid = callSidValide(req.params.callSid);
  const d = callSid ? await detailAppel(orgId, callSid) : null;
  if (!d) { res.status(404).json({ error: "Appel introuvable" }); return; }
  res.json(d);
});

const STATUT_REPRISE: Record<string, number> = {
  introuvable: 404,
  deja_repris: 409,
  termine: 409,
  aucun_fournisseur: 409,
  fournisseur_incomplet: 409,
  aucun_numero: 409,
  cible_inconnue: 400,
  twilio: 502,
};

router.post("/appels-live/:callSid/devral", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  if (!peutAgir(req)) { res.status(403).json({ error: "Lecture seule" }); return; }
  const callSid = callSidValide(req.params.callSid);
  if (!callSid) { res.status(404).json({ error: "Appel introuvable" }); return; }
  const cible = texte(req.body?.cible, 80) || "moi";
  const issue = await reprendreAppel(orgId, req.session.userId!, callSid, cible);
  if (issue.ok) {
    await logAudit(req.session.userId, req.session.userEmail, "appel.repris", "voice_call", callSid, { cible: issue.cible.id }, req.ip, req.get("user-agent"), orgId);
    res.json({ ok: true, cible: issue.cible });
    return;
  }
  if (issue.code === "twilio") {
    // L'echec aussi laisse une trace : quelqu'un a voulu reprendre, l'appel est reste a l'IA.
    await logAudit(req.session.userId, req.session.userEmail, "appel.reprise_echouee", "voice_call", callSid, { cible, raison: issue.raison }, req.ip, req.get("user-agent"), orgId);
  }
  res.status(STATUT_REPRISE[issue.code] ?? 400).json({ ok: false, code: issue.code, raison: issue.raison ?? null });
});

router.post("/appels-live/:callSid/tache", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  if (!peutAgir(req)) { res.status(403).json({ error: "Lecture seule" }); return; }
  const callSid = callSidValide(req.params.callSid);
  const s = callSid ? await sessionDeLOrganisation(orgId, callSid) : null;
  if (!s || !callSid) { res.status(404).json({ error: "Appel introuvable" }); return; }
  const titre = texte(req.body?.titre, 200);
  if (!titre) { res.status(400).json({ error: "Titre requis" }); return; }
  const e = (s.state ?? {}) as Record<string, any>;
  const [t] = await db.insert(tasksTable).values({
    organisationId: orgId,
    title: titre,
    description: [texte(req.body?.description, 2000), `Appel ${callSid}`].filter(Boolean).join("\n\n"),
    relatedContactId: typeof e.callerContactId === "number" ? e.callerContactId : null,
    createdBy: req.session.userId ?? null,
  }).returning({ id: tasksTable.id });
  await lierActionAppel(orgId, callSid, "tache", t!.id);
  await logAudit(req.session.userId, req.session.userEmail, "create", "task", String(t!.id), { callSid, source: "appel_live" }, req.ip, req.get("user-agent"), orgId);
  res.status(201).json({ id: t!.id });
});

router.post("/appels-live/:callSid/note", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  if (!peutAgir(req)) { res.status(403).json({ error: "Lecture seule" }); return; }
  const callSid = callSidValide(req.params.callSid);
  const s = callSid ? await sessionDeLOrganisation(orgId, callSid) : null;
  if (!s || !callSid) { res.status(404).json({ error: "Appel introuvable" }); return; }
  const contenu = texte(req.body?.contenu, 5000);
  if (!contenu) { res.status(400).json({ error: "Contenu requis" }); return; }
  const [n] = await db.insert(notesInternesTable).values({
    organisationId: orgId,
    userId: req.session.userId ?? null,
    title: `Appel ${callSid}`,
    content: contenu,
    tags: ["appel", callSid],
  }).returning({ id: notesInternesTable.id });
  await lierActionAppel(orgId, callSid, "note", n!.id);
  await logAudit(req.session.userId, req.session.userEmail, "create", "note_interne", String(n!.id), { callSid, source: "appel_live" }, req.ip, req.get("user-agent"), orgId);
  res.status(201).json({ id: n!.id });
});

router.post("/appels-live/:callSid/rdv-decouverte", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  if (!peutAgir(req)) { res.status(403).json({ error: "Lecture seule" }); return; }
  const callSid = callSidValide(req.params.callSid);
  const s = callSid ? await sessionDeLOrganisation(orgId, callSid) : null;
  if (!s || !callSid) { res.status(404).json({ error: "Appel introuvable" }); return; }
  const debut = new Date(String(req.body?.debut ?? ""));
  if (Number.isNaN(debut.getTime())) { res.status(400).json({ error: "Date de debut invalide" }); return; }
  const minutes = Math.min(Math.max(Number(req.body?.dureeMinutes) || 60, 15), 480);
  const e = (s.state ?? {}) as Record<string, any>;
  // Visite de decouverte : il n'y a pas encore d'affaire, donc pas de projetId.
  const [ev] = await db.insert(calendarEventsTable).values({
    organisationId: orgId,
    title: texte(req.body?.titre, 200) || "Visite de découverte",
    description: [texte(req.body?.description, 2000), `Appel ${callSid}`].filter(Boolean).join("\n\n"),
    type: "rendez_vous",
    startDate: debut,
    endDate: new Date(debut.getTime() + minutes * 60_000),
    location: texte(req.body?.lieu, 300) || null,
    relatedContactId: typeof e.callerContactId === "number" ? e.callerContactId : null,
    contactName: typeof e.callerName === "string" ? e.callerName : null,
    contactPhone: typeof e.callerNumber === "string" ? e.callerNumber : null,
    createdBy: req.session.userId ?? null,
  }).returning({ id: calendarEventsTable.id });
  await lierActionAppel(orgId, callSid, "rdv", ev!.id);
  await logAudit(req.session.userId, req.session.userEmail, "create", "calendar_event", String(ev!.id), { callSid, source: "appel_live" }, req.ip, req.get("user-agent"), orgId);
  res.status(201).json({ id: ev!.id });
});

export default router;
