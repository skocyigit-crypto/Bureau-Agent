/**
 * LE PLANNING : rendez-vous, plan d'equipe, plan de travaux (plan du 29/09,
 * section 7). Ressource TENANT, bornee a l'organisation de la session.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, projetsTable, taskDependancesTable, tasksTable } from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { fermeraitUneBoucle, vueEquipe, vueRendezVous, vueTravaux } from "../services/planning";
import { logAudit } from "./audit";

const router: IRouter = Router();
const JOUR = 86_400_000;
const MAX_JOURS = 92;

function numero(v: unknown): number | null {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Periode demandee (`du`, `au` en ISO) ; par defaut la semaine en cours. Bornee a 92 jours. */
function periode(req: Request): { du: Date; au: Date } | null {
  const maintenant = new Date();
  const du = req.query.du ? new Date(String(req.query.du)) : new Date(maintenant.getTime() - 1 * JOUR);
  const au = req.query.au ? new Date(String(req.query.au)) : new Date(du.getTime() + 7 * JOUR);
  if (Number.isNaN(du.getTime()) || Number.isNaN(au.getTime()) || au.getTime() < du.getTime()) return null;
  if (au.getTime() - du.getTime() > MAX_JOURS * JOUR) return null;
  return { du, au };
}

router.get("/planning/rendez-vous", async (req: Request, res: Response): Promise<void> => {
  const p = periode(req);
  if (!p) { res.status(400).json({ error: "Periode invalide (du <= au, 92 jours au plus)." }); return; }
  try {
    res.json({ rendezVous: await vueRendezVous(getOrgId(req), p.du, p.au), du: p.du, au: p.au });
  } catch (err: any) {
    req.log.error({ err }, "Erreur planning rendez-vous");
    res.status(500).json({ error: "Les rendez-vous n'ont pas pu etre lus." });
  }
});

router.get("/planning/equipe", async (req: Request, res: Response): Promise<void> => {
  const p = periode(req);
  if (!p) { res.status(400).json({ error: "Periode invalide (du <= au, 92 jours au plus)." }); return; }
  try {
    res.json({ equipe: await vueEquipe(getOrgId(req), p.du, p.au), du: p.du, au: p.au });
  } catch (err: any) {
    req.log.error({ err }, "Erreur planning equipe");
    res.status(500).json({ error: "Le plan d'equipe n'a pas pu etre lu." });
  }
});

router.get("/planning/travaux", async (req: Request, res: Response): Promise<void> => {
  const projetId = req.query.projetId === undefined ? undefined : numero(req.query.projetId);
  if (projetId === null) { res.status(400).json({ error: "projetId invalide." }); return; }
  try {
    res.json(await vueTravaux(getOrgId(req), projetId ?? undefined));
  } catch (err: any) {
    req.log.error({ err }, "Erreur planning travaux");
    res.status(500).json({ error: "Le plan de travaux n'a pas pu etre lu." });
  }
});

/**
 * Debut et echeance d'une tache, depuis le plan de travaux. Route dediee : le
 * corps de PATCH /tasks est valide par un schema genere depuis la specification
 * OpenAPI, qui ne porte pas encore `startDate`.
 */
router.post("/planning/taches/:id/dates", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = numero(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID invalide." }); return; }
  const lire = (v: unknown): Date | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const debut = lire(req.body?.debut);
  const fin = lire(req.body?.fin);
  if ((req.body?.debut !== undefined && debut === undefined) || (req.body?.fin !== undefined && fin === undefined)) {
    res.status(400).json({ error: "Date invalide." }); return;
  }
  try {
    const [t] = await db.select({ debut: tasksTable.startDate, fin: tasksTable.dueDate }).from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.organisationId, orgId))).limit(1);
    if (!t) { res.status(404).json({ error: "Tache non trouvee." }); return; }
    const d = debut !== undefined ? debut : t.debut;
    const f = fin !== undefined ? fin : t.fin;
    if (d && f && new Date(f).getTime() < new Date(d).getTime()) {
      res.status(400).json({ error: "L'echeance precede le debut.", code: "dates_inversees" }); return;
    }
    const set: Record<string, unknown> = {};
    if (debut !== undefined) set.startDate = debut;
    if (fin !== undefined) set.dueDate = fin;
    if (Object.keys(set).length === 0) { res.status(400).json({ error: "Rien a modifier." }); return; }
    const [maj] = await db.update(tasksTable).set(set)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.organisationId, orgId)))
      .returning({ id: tasksTable.id, debut: tasksTable.startDate, fin: tasksTable.dueDate });
    res.json({ tache: maj });
  } catch (err: any) {
    req.log.error({ err }, "Erreur dates de tache");
    res.status(500).json({ error: "Les dates n'ont pas pu etre enregistrees." });
  }
});

/**
 * Creer une tache DE CHANTIER, avec ses dates.
 *
 * Le corps de POST /tasks est valide par un schema genere depuis la
 * specification OpenAPI, qui ne porte ni `projetId` ni `startDate` : aucune
 * route ne permettait donc de rattacher une tache a un chantier (seule la
 * saisie vocale de chantier le faisait). Le plan de travaux restait vide pour
 * qui n'utilisait pas la voix.
 */
router.post("/planning/taches", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const projetId = numero(req.body?.projetId);
  const titre = String(req.body?.titre ?? "").trim();
  if (projetId === null) { res.status(400).json({ error: "Chantier obligatoire." }); return; }
  if (!titre) { res.status(400).json({ error: "Intitule obligatoire." }); return; }
  const debut = req.body?.debut ? new Date(String(req.body.debut)) : null;
  const fin = req.body?.fin ? new Date(String(req.body.fin)) : null;
  if ((debut && Number.isNaN(debut.getTime())) || (fin && Number.isNaN(fin.getTime()))) { res.status(400).json({ error: "Date invalide." }); return; }
  if (debut && fin && fin.getTime() < debut.getTime()) { res.status(400).json({ error: "L'echeance precede le debut.", code: "dates_inversees" }); return; }
  try {
    const [p] = await db.select({ id: projetsTable.id }).from(projetsTable)
      .where(and(eq(projetsTable.id, projetId), eq(projetsTable.organisationId, orgId))).limit(1);
    if (!p) { res.status(400).json({ error: "Reference inconnue dans votre organisation : projetId" }); return; }
    const [t] = await db.insert(tasksTable).values({
      organisationId: orgId, projetId, title: titre,
      assignedTo: req.body?.responsable ? String(req.body.responsable).trim() || null : null,
      startDate: debut, dueDate: fin, status: "en_attente", priority: "moyenne",
      createdBy: req.session?.userId ?? null,
    }).returning();
    await logAudit(req.session?.userId, req.session?.userEmail, "planning.tache_creee", "task", String(t!.id),
      { projetId }, req.ip, req.get("user-agent"), orgId).catch(() => {});
    res.status(201).json({ tache: t });
  } catch (err: any) {
    req.log.error({ err }, "Erreur creation de tache de chantier");
    res.status(500).json({ error: "La tache n'a pas pu etre creee." });
  }
});

/** Rattacher une tache existante a un chantier (ou l'en detacher : `projetId: null`). */
router.post("/planning/taches/:id/chantier", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = numero(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID invalide." }); return; }
  const detacher = req.body?.projetId === null || req.body?.projetId === "";
  const projetId = detacher ? null : numero(req.body?.projetId);
  if (!detacher && projetId === null) { res.status(400).json({ error: "projetId invalide." }); return; }
  try {
    if (projetId !== null) {
      const [p] = await db.select({ id: projetsTable.id }).from(projetsTable)
        .where(and(eq(projetsTable.id, projetId), eq(projetsTable.organisationId, orgId))).limit(1);
      if (!p) { res.status(400).json({ error: "Reference inconnue dans votre organisation : projetId" }); return; }
    }
    const l = await db.update(tasksTable).set({ projetId })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.organisationId, orgId)))
      .returning({ id: tasksTable.id, projetId: tasksTable.projetId });
    if (l.length === 0) { res.status(404).json({ error: "Tache non trouvee." }); return; }
    res.json({ tache: l[0] });
  } catch (err: any) {
    req.log.error({ err }, "Erreur rattachement de tache");
    res.status(500).json({ error: "Le rattachement n'a pas pu etre fait." });
  }
});

/** « `id` attend la fin de `dependDe` ». Refuse une boucle et une tache d'une autre organisation. */
router.post("/planning/taches/:id/attend", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const tacheId = numero(req.params.id);
  const dependDe = numero(req.body?.dependDe);
  if (tacheId === null || dependDe === null) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const deux = await db.select({ id: tasksTable.id }).from(tasksTable)
      .where(and(eq(tasksTable.organisationId, orgId), inArray(tasksTable.id, [tacheId, dependDe])));
    if (deux.length !== (tacheId === dependDe ? 1 : 2)) { res.status(404).json({ error: "Tache non trouvee." }); return; }
    const liens = await db.select({ tacheId: taskDependancesTable.tacheId, dependDe: taskDependancesTable.dependDe })
      .from(taskDependancesTable).where(eq(taskDependancesTable.organisationId, orgId));
    if (fermeraitUneBoucle(liens, tacheId, dependDe)) {
      res.status(409).json({
        error: "Ce lien fermerait une boucle : aucune des taches ne pourrait commencer.",
        code: "boucle",
      });
      return;
    }
    const [lien] = await db.insert(taskDependancesTable).values({ organisationId: orgId, tacheId, dependDe })
      .onConflictDoNothing().returning();
    if (!lien) { res.status(200).json({ dejaLie: true }); return; }
    await logAudit(req.session?.userId, req.session?.userEmail, "planning.lien_ajoute", "task", String(tacheId),
      { dependDe }, req.ip, req.get("user-agent"), orgId).catch(() => {});
    res.status(201).json({ lien });
  } catch (err: any) {
    req.log.error({ err }, "Erreur lien de tache");
    res.status(500).json({ error: "Le lien n'a pas pu etre enregistre." });
  }
});

router.delete("/planning/liens/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = numero(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const l = await db.delete(taskDependancesTable)
      .where(and(eq(taskDependancesTable.id, id), eq(taskDependancesTable.organisationId, orgId))).returning();
    if (l.length === 0) { res.status(404).json({ error: "Lien non trouve." }); return; }
    await logAudit(req.session?.userId, req.session?.userEmail, "planning.lien_retire", "task", String(l[0]!.tacheId),
      { dependDe: l[0]!.dependDe }, req.ip, req.get("user-agent"), orgId).catch(() => {});
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur retrait de lien");
    res.status(500).json({ error: "Le lien n'a pas pu etre retire." });
  }
});

export default router;
