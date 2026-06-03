import { Router, type IRouter, type Request, type Response } from "express";
import { db, vehiculesTable, projetsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { getOrgId } from "../middleware/tenant";
import { logAudit } from "./audit";

// ─────────────────────────────────────────────────────────────────────────────
// Flotte / Parc matériel (pilier BTP — couche client).
//
// CRUD des véhicules (camions, utilitaires…), borné à l'organisation du tenant
// (getOrgId). La télémétrie (kilométrage, code défaut, seuil d'entretien) sert
// au détecteur déterministe `vehicle_service` du proactive-engine qui émet des
// SUGGESTIONS de rendez-vous d'entretien — JAMAIS d'action autonome.
//
// Monté APRÈS requireTenant (fonctionnalité client, pas backoffice super-admin).
//
// ISOLATION MULTI-TENANT : assignedProjetId pointe vers projets.id (PK globale).
// Toute écriture qui fixe ce lien DOIT vérifier que le chantier appartient à la
// même organisation avant de persister (cf. assertProjetInOrg) — sinon fuite
// cross-tenant. La FK seule ne le garantit pas.
// ─────────────────────────────────────────────────────────────────────────────

const router: IRouter = Router();

const STATUS = ["disponible", "en_service", "maintenance", "hors_service"] as const;

const createSchema = z.object({
  plateNumber: z.string().trim().min(1).max(32),
  brandModel: z.string().trim().min(1).max(120),
  currentMileage: z.number().int().min(0).max(10_000_000).optional().default(0),
  nextServiceMileage: z.number().int().min(0).max(10_000_000).nullable().optional(),
  lastKnownFaultCode: z.string().trim().max(64).optional().default("NONE"),
  assignedProjetId: z.number().int().positive().nullable().optional(),
  status: z.enum(STATUS).optional().default("disponible"),
});

const updateSchema = createSchema.partial();

// Garde cross-tenant : le chantier référencé doit appartenir à l'org. Renvoie
// false si l'id ne correspond à aucun projet de cette organisation.
async function assertProjetInOrg(orgId: number, projetId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: projetsTable.id })
    .from(projetsTable)
    .where(and(eq(projetsTable.id, projetId), eq(projetsTable.organisationId, orgId)))
    .limit(1);
  return !!row;
}

function serialize(v: typeof vehiculesTable.$inferSelect) {
  const serviceDue =
    v.nextServiceMileage != null && v.currentMileage >= v.nextServiceMileage;
  const hasFault = !!v.lastKnownFaultCode && v.lastKnownFaultCode !== "NONE";
  return {
    id: v.id,
    plateNumber: v.plateNumber,
    brandModel: v.brandModel,
    currentMileage: v.currentMileage,
    nextServiceMileage: v.nextServiceMileage,
    lastKnownFaultCode: v.lastKnownFaultCode,
    assignedProjetId: v.assignedProjetId,
    status: v.status,
    serviceDue,
    hasFault,
    needsAttention: serviceDue || hasFault,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

// GET /vehicules — liste des véhicules de l'org.
router.get("/vehicules", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const rows = await db
      .select()
      .from(vehiculesTable)
      .where(eq(vehiculesTable.organisationId, orgId))
      .orderBy(desc(vehiculesTable.updatedAt));
    res.json({ vehicules: rows.map(serialize) });
  } catch (err) {
    req.log.error({ err }, "[vehicules] liste échouée");
    res.status(500).json({ error: "Impossible de charger la flotte." });
  }
});

// POST /vehicules — créer un véhicule.
router.post("/vehicules", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Données invalides.", details: parsed.error.issues });
      return;
    }
    const data = parsed.data;

    if (data.assignedProjetId != null && !(await assertProjetInOrg(orgId, data.assignedProjetId))) {
      res.status(400).json({ error: "Chantier introuvable pour cette organisation." });
      return;
    }

    let row;
    try {
      [row] = await db
        .insert(vehiculesTable)
        .values({
          organisationId: orgId,
          plateNumber: data.plateNumber,
          brandModel: data.brandModel,
          currentMileage: data.currentMileage,
          nextServiceMileage: data.nextServiceMileage ?? null,
          lastKnownFaultCode: data.lastKnownFaultCode,
          assignedProjetId: data.assignedProjetId ?? null,
          status: data.status,
        })
        .returning();
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Un véhicule avec cette immatriculation existe déjà." });
        return;
      }
      throw e;
    }

    await logAudit(
      req.session?.userId,
      req.session?.userEmail,
      "create",
      "vehicule",
      String(row.id),
      { plateNumber: row.plateNumber, brandModel: row.brandModel },
      req.ip,
      req.headers["user-agent"],
      orgId,
    );

    res.status(201).json(serialize(row));
  } catch (err) {
    req.log.error({ err }, "[vehicules] création échouée");
    res.status(500).json({ error: "Impossible d'enregistrer le véhicule." });
  }
});

// PUT /vehicules/:id — mettre à jour un véhicule (incl. kilométrage / code défaut).
router.put("/vehicules/:id", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant invalide." });
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Données invalides.", details: parsed.error.issues });
      return;
    }
    const data = parsed.data;

    const [existing] = await db
      .select({ id: vehiculesTable.id })
      .from(vehiculesTable)
      .where(and(eq(vehiculesTable.id, id), eq(vehiculesTable.organisationId, orgId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Véhicule introuvable." });
      return;
    }

    if (data.assignedProjetId != null && !(await assertProjetInOrg(orgId, data.assignedProjetId))) {
      res.status(400).json({ error: "Chantier introuvable pour cette organisation." });
      return;
    }

    const patch: Partial<typeof vehiculesTable.$inferInsert> = {};
    if (data.plateNumber !== undefined) patch.plateNumber = data.plateNumber;
    if (data.brandModel !== undefined) patch.brandModel = data.brandModel;
    if (data.currentMileage !== undefined) patch.currentMileage = data.currentMileage;
    if (data.nextServiceMileage !== undefined) patch.nextServiceMileage = data.nextServiceMileage;
    if (data.lastKnownFaultCode !== undefined) patch.lastKnownFaultCode = data.lastKnownFaultCode;
    if (data.assignedProjetId !== undefined) patch.assignedProjetId = data.assignedProjetId;
    if (data.status !== undefined) patch.status = data.status;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Aucune donnée à mettre à jour." });
      return;
    }

    let row;
    try {
      [row] = await db
        .update(vehiculesTable)
        .set(patch)
        .where(and(eq(vehiculesTable.id, id), eq(vehiculesTable.organisationId, orgId)))
        .returning();
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23505") {
        res.status(409).json({ error: "Un véhicule avec cette immatriculation existe déjà." });
        return;
      }
      throw e;
    }

    await logAudit(
      req.session?.userId,
      req.session?.userEmail,
      "update",
      "vehicule",
      String(id),
      patch,
      req.ip,
      req.headers["user-agent"],
      orgId,
    );

    res.json(serialize(row));
  } catch (err) {
    req.log.error({ err }, "[vehicules] mise à jour échouée");
    res.status(500).json({ error: "Impossible de mettre à jour le véhicule." });
  }
});

// DELETE /vehicules/:id — supprimer un véhicule.
router.delete("/vehicules/:id", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Identifiant invalide." });
      return;
    }
    const [row] = await db
      .delete(vehiculesTable)
      .where(and(eq(vehiculesTable.id, id), eq(vehiculesTable.organisationId, orgId)))
      .returning({ id: vehiculesTable.id });
    if (!row) {
      res.status(404).json({ error: "Véhicule introuvable." });
      return;
    }

    await logAudit(
      req.session?.userId,
      req.session?.userEmail,
      "delete",
      "vehicule",
      String(id),
      {},
      req.ip,
      req.headers["user-agent"],
      orgId,
    );

    res.json({ deleted: true, id });
  } catch (err) {
    req.log.error({ err }, "[vehicules] suppression échouée");
    res.status(500).json({ error: "Impossible de supprimer le véhicule." });
  }
});

export default router;
