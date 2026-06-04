import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import { CreateApiKeyBody } from "@workspace/api-zod";
import { getOrgId } from "../middleware/tenant";
import { zodErrorResponse } from "../lib/zod-error";
import { decryptSensitiveData } from "../lib/crypto";
import { generateApiKey } from "../lib/api-key-auth";
import { logAudit } from "./audit";

// Clés API entrantes (Faz 1). CRUD tenant-scoped. La clé complète n'est
// renvoyée qu'à la création ; ensuite seul le préfixe est listé. La révélation
// ultérieure déchiffre la copie au repos (modèle « reveal » assumé).
//
// SÉCURITÉ — contrôle d'accès intra-tenant : une clé API authentifie en tant
// que son créateur (cf. middleware/auth.ts). Sans garde de propriété, n'importe
// quel membre de l'organisation pourrait lister/révéler/révoquer la clé d'un
// autre utilisateur et donc usurper son rôle (élévation de privilège). On
// restreint donc list/reveal/revoke au **propriétaire** de la clé, avec
// dérogation pour les rôles admin (administrateur / super_admin) qui gèrent
// l'ensemble du parc de leur organisation.

const router: IRouter = Router();

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
      keyEncrypted: generated.encrypted,
      scopes: parsed.data.scopes ?? [],
      expiresAt,
      createdByUserId: userId,
    })
    .returning();

  res.status(201).json({ ...toSummary(row), key: generated.full });
});

router.post("/api-keys/:id/reveal", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Identifiant invalide." });
    return;
  }
  const orgId = getOrgId(req);
  const userId = req.session?.userId ?? null;
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.organisationId, orgId)));
  if (!row) {
    res.status(404).json({ error: "Clé API introuvable." });
    return;
  }
  // Seul le propriétaire (ou un admin) peut révéler la clé en clair.
  if (row.createdByUserId !== userId && !isOrgAdmin(req)) {
    res.status(403).json({ error: "Accès refusé." });
    return;
  }
  // La révélation d'un secret est une action sensible : on l'audite.
  await logAudit(
    userId ?? undefined,
    req.session?.userEmail as string | undefined,
    "api_key_reveal",
    "api_key",
    String(row.id),
    { name: row.name, keyPrefix: row.keyPrefix },
    req.ip,
    req.get("user-agent"),
    orgId,
  );
  res.json({ id: row.id, key: decryptSensitiveData(row.keyEncrypted) });
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
