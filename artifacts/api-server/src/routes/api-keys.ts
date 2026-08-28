import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import { CreateApiKeyBody } from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { zodErrorResponse } from "../lib/zod-error";
import { generateApiKey, HASH_ONLY_KEY_SENTINEL } from "../lib/api-key-auth";
import { logAudit } from "./audit";
import { requireRole } from "../middleware/auth";

// Clés API entrantes (Faz 1). CRUD tenant-scoped, à AFFICHAGE UNIQUE : la clé
// complète n'est renvoyée qu'à la création, ensuite seul le préfixe est listé.
// Il n'existe plus de « reveal » : aucune copie déchiffrable n'est conservée
// (colonne key_encrypted remplie par HASH_ONLY_KEY_SENTINEL), pour qu'une
// compromission « base + clé de chiffrement » ne rende pas les clés.
//
// SÉCURITÉ — une clé API authentifie en tant que son créateur (cf.
// middleware/auth.ts) et les `scopes` enregistrés ne sont PAS encore appliqués
// par les routes en aval : en émettre une revient donc à déléguer l'intégralité
// de l'autorité du compte. Tant que les scopes ne sont pas appliqués, la
// gestion des clés est réservée aux administrateurs de l'organisation
// (garde ci-dessous), et non simplement à leur propriétaire.

const router: IRouter = Router();

// API scopes are persisted but are not yet enforced by downstream routes.
// Until scope enforcement exists, issuing/revealing a key is equivalent to
// delegating the creator's complete account authority and is therefore an
// administrator-only operation.
router.use("/api-keys", requireRole("super_admin", "administrateur"));

const ADMIN_ROLES = new Set(["administrateur", "super_admin"]);

/** Vrai si la session courante a un rôle d'administration de l'organisation. */
function isOrgAdmin(req: Request): boolean {
  const role = req.session?.userRole as string | undefined;
  return role ? ADMIN_ROLES.has(role) : false;
}

/** Sérialise une ligne clé API vers la forme résumé (jamais la clé complète). */
function toSummary(row: typeof apiKeysTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

router.get("/api-keys", async (req, res) => {
  const orgId = getOrgId(req);
  const admin = isOrgAdmin(req);
  const userId = req.session?.userId;
  // Un membre standard sans userId résolu ne peut posséder aucune clé.
  if (!admin && typeof userId !== "number") {
    res.json([]);
    return;
  }
  // Un admin voit toutes les clés de l'organisation ; un membre standard ne
  // voit que les siennes (évite la divulgation des IDs de clés d'autrui, qui
  // sont la cible d'une révélation/révocation non autorisée).
  const where = admin
    ? eq(apiKeysTable.organisationId, orgId)
    : and(
        eq(apiKeysTable.organisationId, orgId),
        eq(apiKeysTable.createdByUserId, userId as number),
      );
  const rows = await db
    .select()
    .from(apiKeysTable)
    .where(where)
    .orderBy(desc(apiKeysTable.createdAt));
  res.json(rows.map(toSummary));
});

router.post("/api-keys", async (req, res) => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(zodErrorResponse(parsed.error));
    return;
  }
  const orgId = getOrgId(req);
  const userId = req.session?.userId ?? null;

  let expiresAt: Date | null = null;
  if (parsed.data.expiresAt) {
    const d = new Date(parsed.data.expiresAt);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "Date d'expiration invalide." });
      return;
    }
    expiresAt = d;
  }

  const generated = generateApiKey();

  const [row] = await db
    .insert(apiKeysTable)
    .values({
      organisationId: orgId,
      name: parsed.data.name,
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      keyEncrypted: HASH_ONLY_KEY_SENTINEL,
      scopes: parsed.data.scopes ?? [],
      expiresAt,
      createdByUserId: userId,
    })
    .returning();

  res.status(201).json({ ...toSummary(row), key: generated.full });
});

// Conservée uniquement pour répondre proprement aux clients déjà déployés qui
// appellent encore cette route : elle ne peut plus rien révéler, puisque plus
// aucun chiffré réutilisable n'est stocké (cf. HASH_ONLY_KEY_SENTINEL).
router.post("/api-keys/:id/reveal", (_req, res) => {
  // Les clés sont à affichage unique. Renvoyer l'ancien matériel chiffré
  // transformerait une compromission « base + clé de chiffrement » en
  // récupération d'identifiants.
  res.status(410).json({
    error: "Les cles API ne sont affichees qu'une seule fois. Revoquez puis recreez la cle.",
    code: "api_key_reveal_removed",
  });
});

router.delete("/api-keys/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const orgId = getOrgId(req);
  const userId = req.session?.userId ?? null;

  // Vérifie d'abord l'existence + la propriété (org + créateur, sauf admin)
  // avant toute mutation : un membre standard ne peut révoquer que ses clés.
  const [existing] = await db
    .select({
      id: apiKeysTable.id,
      name: apiKeysTable.name,
      keyPrefix: apiKeysTable.keyPrefix,
      createdByUserId: apiKeysTable.createdByUserId,
      revokedAt: apiKeysTable.revokedAt,
    })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.organisationId, orgId)));
  if (!existing) {
    res.status(404).json({ error: "Clé API introuvable." });
    return;
  }
  if (existing.createdByUserId !== userId && !isOrgAdmin(req)) {
    res.status(403).json({ error: "Accès refusé." });
    return;
  }

  // Révocation douce : on horodate revokedAt (la clé reste en base pour
  // l'audit mais n'authentifie plus). Idempotent — ne ré-écrit pas si déjà
  // révoquée.
  const [row] = await db
    .update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeysTable.id, id),
        eq(apiKeysTable.organisationId, orgId),
        isNull(apiKeysTable.revokedAt),
      ),
    )
    .returning({ id: apiKeysTable.id });

  // row absent => déjà révoquée (no-op idempotent). L'existence est déjà
  // confirmée plus haut, donc plus de 404 possible ici.
  if (row) {
    await logAudit(
      userId ?? undefined,
      req.session?.userEmail as string | undefined,
      "api_key_revoke",
      "api_key",
      String(existing.id),
      { name: existing.name, keyPrefix: existing.keyPrefix },
      req.ip,
      req.get("user-agent"),
      orgId,
    );
  }
  res.status(204).end();
});

export default router;
