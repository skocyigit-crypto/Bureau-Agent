// Wave 3 — Suivi des employes (geofence + ping mobile + vue admin temps reel).
//
// Routes :
//   * GET    /geofences                         (admin) — liste des zones
//   * POST   /geofences                         (admin) — creer une zone
//   * PATCH  /geofences/:id                     (admin) — renommer / deplacer / activer
//   * DELETE /geofences/:id                     (admin) — soft delete (isActive=false)
//   * POST   /location/ping                     (any auth) — mobile envoie sa position
//   * GET    /admin/team-locations              (admin) — etat courant de chaque employe
//   * GET    /admin/team-locations/history      (admin) — journal d'evenements (max 30j)
//
// IMPORTANT KVKK / RGPD : tout est tenant-scope, seul le role administrateur+
// peut lire les positions. Les employes ne voient pas leurs collegues.

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import {
  db,
  geofencesTable,
  userLocationStateTable,
  locationEventsTable,
  usersTable,
} from "@workspace/db";
import { requireTenant, getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { broadcaster } from "../services/broadcaster";
import { zodErrorResponse } from "../lib/zod-error";

const router: IRouter = Router();

// Anti-DoS sur /location/ping : un client mobile honnete envoie 1 ping
// toutes les 30-60s. On autorise 60 pings/minute par utilisateur (assez
// large pour bursts d'enter/exit + retry offline) et on tombe en 429
// au-dela. Cle = userId si disponible, sinon IP — un attaquant non
// authentifie est de toute facon arrete par requireTenant en amont.
const pingLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const uid = req.session?.userId;
    return uid ? `u:${uid}` : `ip:${req.ip || "unknown"}`;
  },
  message: { error: "Trop de pings de position. Reessayez dans une minute." },
});

// Toute la surface d'API necessite une org. Les guards admin sont ajoutes
// route par route (le ping mobile lui n'exige pas le role admin).
router.use("/geofences", requireTenant);
router.use("/location", requireTenant);
router.use("/admin/team-locations", requireTenant);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Distance en metres entre 2 points GPS (formule Haversine, suffisamment
// precise sur quelques kilometres pour des geofences de PME).
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Validation lat/lng + rayon. Rayon borne entre 20m (limite GPS realiste)
// et 50km (au dela ce n'est plus une "zone" mais une region entiere).
const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const geofenceBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(20).max(50_000).default(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
});

const geofencePatchSchema = geofenceBodySchema.partial();

const pingBodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).optional(),
  battery: z.number().int().min(0).max(100).optional(),
  isMoving: z.boolean().optional(),
  // Le client peut envoyer un timestamp (offline buffer). Si absent ou
  // futur, on utilise l'horloge serveur — on refuse l'horodatage client
  // dans le futur pour eviter d'empoisonner le journal.
  at: z.string().datetime().optional(),
});

const historyQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  geofenceId: z.coerce.number().int().positive().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  event: z.enum(["enter", "exit", "ping"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// GEOFENCES (admin only)
// ---------------------------------------------------------------------------

router.get("/geofences", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const rows = await db
      .select()
      .from(geofencesTable)
      .where(eq(geofencesTable.organisationId, orgId))
      .orderBy(desc(geofencesTable.isActive), desc(geofencesTable.createdAt));
    res.json({ geofences: rows });
  } catch (err) {
    req.log.error({ err }, "[Locations] Erreur liste geofences");
    res.status(500).json({ error: "Erreur lors de la recuperation des zones." });
  }
});

router.post("/geofences", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  const parsed = geofenceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  try {
    const orgId = getOrgId(req);
    const userId = req.session?.userId;
    const [row] = await db.insert(geofencesTable).values({
      organisationId: orgId,
      name: parsed.data.name,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      radiusM: parsed.data.radiusM,
      color: parsed.data.color ?? "#3b82f6",
      isActive: parsed.data.isActive ?? true,
      createdBy: userId ?? null,
    }).returning();
    res.status(201).json({ geofence: row });
  } catch (err) {
    req.log.error({ err }, "[Locations] Erreur creation geofence");
    res.status(500).json({ error: "Erreur lors de la creation de la zone." });
  }
});

router.patch("/geofences/:id", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const parsed = geofencePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  try {
    const orgId = getOrgId(req);
    const [row] = await db
      .update(geofencesTable)
      .set(parsed.data)
      .where(and(eq(geofencesTable.id, id), eq(geofencesTable.organisationId, orgId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Zone introuvable." });
      return;
    }
    res.json({ geofence: row });
  } catch (err) {
    req.log.error({ err }, "[Locations] Erreur mise a jour geofence");
    res.status(500).json({ error: "Erreur lors de la mise a jour de la zone." });
  }
});

router.delete("/geofences/:id", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  try {
    const orgId = getOrgId(req);
    // Soft delete : on conserve la zone pour que l'historique d'evenements
    // garde une reference lisible. Mettre isActive=false suffit a la sortir
    // du calcul enter/exit cote /location/ping.
    const [row] = await db
      .update(geofencesTable)
      .set({ isActive: false })
      .where(and(eq(geofencesTable.id, id), eq(geofencesTable.organisationId, orgId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Zone introuvable." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "[Locations] Erreur suppression geofence");
    res.status(500).json({ error: "Erreur lors de la suppression de la zone." });
  }
});

// ---------------------------------------------------------------------------
// PING mobile : tous les employes connectes
// ---------------------------------------------------------------------------

router.post("/location/ping", pingLimiter, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Non authentifie." });
    return;
  }
  const parsed = pingBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  try {
    const orgId = getOrgId(req);
    const now = new Date();
    // Refuse les horodatages dans le futur (anti-empoisonnement). Si le
    // client envoie un timestamp dans le passe (offline buffer), on le
    // garde — sinon on prend l'horloge serveur.
    let at = now;
    if (parsed.data.at) {
      const parsedAt = new Date(parsed.data.at);
      if (parsedAt.getTime() <= now.getTime() + 60_000) at = parsedAt;
    }
    const { lat, lng, accuracyM, battery, isMoving } = parsed.data;

    // 1) Calculer les zones contenant ce point (parmi les zones actives de l'org).
    const activeGeofences = await db
      .select({ id: geofencesTable.id, lat: geofencesTable.lat, lng: geofencesTable.lng, radiusM: geofencesTable.radiusM })
      .from(geofencesTable)
      .where(and(eq(geofencesTable.organisationId, orgId), eq(geofencesTable.isActive, true)));

    const insideNow = activeGeofences
      .filter((g) => distanceMeters(lat, lng, g.lat, g.lng) <= g.radiusM)
      .map((g) => g.id);

    // 2) Charger l'etat precedent. Filtre compose (userId + orgId) :
    // protege contre une derive de tenant (user reaffecte / session
    // obsolete) qui ferait calculer un diff enter/exit a partir d'un
    // etat appartenant a une ancienne org.
    const [prev] = await db
      .select()
      .from(userLocationStateTable)
      .where(and(
        eq(userLocationStateTable.userId, userId),
        eq(userLocationStateTable.organisationId, orgId),
      ))
      .limit(1);

    const prevIds: number[] = Array.isArray(prev?.currentGeofenceIds) ? prev!.currentGeofenceIds : [];
    const entered = insideNow.filter((id) => !prevIds.includes(id));
    const exited = prevIds.filter((id) => !insideNow.includes(id));

    // 3+4) Upsert atomique de l'etat + insertion du journal dans la meme
    // transaction. On utilise INSERT ... ON CONFLICT (user_id) DO UPDATE
    // pour eviter la course "deux pings concurrents -> deux INSERT ->
    // unique violation" sur les premiers pings d'un nouvel utilisateur.
    const eventsToInsert: Array<{ event: "enter" | "exit" | "ping"; geofenceId: number | null }> = [];
    for (const gid of entered) eventsToInsert.push({ event: "enter", geofenceId: gid });
    for (const gid of exited) eventsToInsert.push({ event: "exit", geofenceId: gid });
    if (eventsToInsert.length === 0) eventsToInsert.push({ event: "ping", geofenceId: null });

    await db.transaction(async (tx) => {
      await tx
        .insert(userLocationStateTable)
        .values({
          organisationId: orgId, userId,
          lastLat: lat, lastLng: lng, lastAccuracyM: accuracyM ?? null, lastAt: at,
          currentGeofenceIds: insideNow,
          battery: battery ?? null,
          isMoving: isMoving ?? false,
        })
        .onConflictDoUpdate({
          target: userLocationStateTable.userId,
          set: {
            organisationId: orgId,
            lastLat: lat, lastLng: lng, lastAccuracyM: accuracyM ?? null, lastAt: at,
            currentGeofenceIds: insideNow,
            battery: battery ?? null,
            isMoving: isMoving ?? false,
          },
        });
      await tx.insert(locationEventsTable).values(
        eventsToInsert.map((e) => ({
          organisationId: orgId, userId,
          geofenceId: e.geofenceId,
          event: e.event,
          lat, lng, accuracyM: accuracyM ?? null, at,
        })),
      );
    });

    // 5) SSE : signal d'invalidation generique uniquement.
    // IMPORTANT KVKK : le canal /sync/events est ouvert a tous les
    // utilisateurs authentifies de l'org (collegues inclus). On NE
    // diffuse donc NI lat/lng, NI userId concerne, NI ids de geofence
    // entrees/sorties — ces informations seraient suffisantes a un
    // collegue pour reconstituer qui bouge / quand / vers quelle zone.
    // On envoie un simple "geofence-stale" et la page admin (gated
    // requireRole administrateur) re-fetchera /admin/team-locations.
    if (entered.length > 0 || exited.length > 0) {
      broadcaster.broadcast(orgId, {
        type: "checkin", action: "updated",
        meta: { kind: "geofence" },
      });
    }

    res.json({ ok: true, insideGeofenceIds: insideNow, entered, exited });
  } catch (err) {
    req.log.error({ err }, "[Locations] Erreur ping");
    res.status(500).json({ error: "Erreur lors de l'enregistrement de la position." });
  }
});

// ---------------------------------------------------------------------------
// ADMIN : etat courant + historique (admin only)
// ---------------------------------------------------------------------------

router.get("/admin/team-locations", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    const states = await db
      .select({
        userId: userLocationStateTable.userId,
        lastLat: userLocationStateTable.lastLat,
        lastLng: userLocationStateTable.lastLng,
        lastAccuracyM: userLocationStateTable.lastAccuracyM,
        lastAt: userLocationStateTable.lastAt,
        currentGeofenceIds: userLocationStateTable.currentGeofenceIds,
        battery: userLocationStateTable.battery,
        isMoving: userLocationStateTable.isMoving,
        userPrenom: usersTable.prenom,
        userNom: usersTable.nom,
        userEmail: usersTable.email,
        userRole: usersTable.role,
      })
      .from(userLocationStateTable)
      .innerJoin(usersTable, eq(usersTable.id, userLocationStateTable.userId))
      .where(eq(userLocationStateTable.organisationId, orgId));

    // Charger toutes les zones referencees pour enrichir la reponse cote
    // client (evite N+1 dans l'UI admin).
    const refIds = Array.from(new Set(states.flatMap((s) => s.currentGeofenceIds || [])));
    const geofences = refIds.length > 0
      ? await db
          .select({ id: geofencesTable.id, name: geofencesTable.name, color: geofencesTable.color })
          .from(geofencesTable)
          .where(and(eq(geofencesTable.organisationId, orgId), inArray(geofencesTable.id, refIds)))
      : [];
    res.json({ states, geofences });
  } catch (err) {
    req.log.error({ err }, "[Locations] Erreur liste team-locations");
    res.status(500).json({ error: "Erreur lors de la recuperation des positions." });
  }
});

router.get("/admin/team-locations/history", requireRole("administrateur"), async (req: Request, res: Response): Promise<void> => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  try {
    const orgId = getOrgId(req);
    const { userId, geofenceId, from, to, event, limit, offset } = parsed.data;

    // Garde retention 30 jours : on borne le `from` au plus a 30j en arriere
    // pour eviter qu'un admin scanne tout l'historique d'un coup et eviter
    // de retourner des donnees qu'on s'est engages a purger.
    const minFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fromDate = from ? new Date(from) : minFrom;
    const effectiveFrom = fromDate < minFrom ? minFrom : fromDate;

    const conds = [
      eq(locationEventsTable.organisationId, orgId),
      gte(locationEventsTable.at, effectiveFrom),
    ];
    if (to) conds.push(lte(locationEventsTable.at, new Date(to)));
    if (userId) conds.push(eq(locationEventsTable.userId, userId));
    if (geofenceId) conds.push(eq(locationEventsTable.geofenceId, geofenceId));
    if (event) conds.push(eq(locationEventsTable.event, event));

    const rows = await db
      .select()
      .from(locationEventsTable)
      .where(and(...conds))
      .orderBy(desc(locationEventsTable.at))
      .limit(limit)
      .offset(offset);
    res.json({ events: rows, retentionDays: 30 });
  } catch (err) {
    req.log.error({ err }, "[Locations] Erreur historique");
    res.status(500).json({ error: "Erreur lors de la recuperation de l'historique." });
  }
});

// Suppression silencieuse de la valeur inutilisee (eslint).
void latLngSchema;

export default router;
