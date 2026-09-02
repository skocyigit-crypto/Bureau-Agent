/**
 * Sauvegardes vues par le CLIENT: lister, declencher, telecharger, supprimer.
 *
 * Tout est borne a l'organisation de la session (`getOrgId`), y compris le
 * telechargement: un identifiant de sauvegarde appartenant a une autre
 * organisation repond 404, jamais le fichier.
 *
 * Reserve aux roles d'administration de l'organisation: une sauvegarde
 * contient l'integralite des donnees clients, contacts et factures — ce n'est
 * pas un export que tout utilisateur doit pouvoir emporter.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, organisationBackupsTable, organisationsTable } from "@workspace/db";
import { requireRole } from "../middleware/auth";
import { getOrgId } from "../middleware/tenant";
import {
  backupFileName,
  createOrganisationBackup,
  DEFAULT_RETENTION,
  EXCLUDED_TABLES,
  readStoredBackup,
  REDACTED_COLUMNS,
  TENANT_TABLES,
} from "../services/tenant-backup";

const router: IRouter = Router();

/**
 * Une sauvegarde manuelle lit toute la base du client: on en autorise une par
 * quart d'heure, sinon un double-clic (ou un script) declenche autant de scans
 * complets.
 */
const MANUAL_COOLDOWN_MS = 15 * 60 * 1000;

router.get("/my-backups", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const rows = await db.select({
      id: organisationBackupsTable.id,
      origin: organisationBackupsTable.origin,
      rowCount: organisationBackupsTable.rowCount,
      sizeBytes: organisationBackupsTable.sizeBytes,
      tableCounts: organisationBackupsTable.tableCounts,
      checksum: organisationBackupsTable.checksum,
      createdAt: organisationBackupsTable.createdAt,
    })
      .from(organisationBackupsTable)
      .where(eq(organisationBackupsTable.organisationId, orgId))
      .orderBy(desc(organisationBackupsTable.createdAt))
      .limit(60);

    res.json({
      backups: rows,
      retention: DEFAULT_RETENTION,
      coverage: {
        tables: TENANT_TABLES.length + 1,
        redactedColumns: [...REDACTED_COLUMNS].sort(),
        excludedTables: EXCLUDED_TABLES,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "[my-backups] liste impossible");
    res.status(500).json({ error: "Erreur lors de la recuperation des sauvegardes." });
  }
});

router.post("/my-backups", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [last] = await db.select({ createdAt: organisationBackupsTable.createdAt })
      .from(organisationBackupsTable)
      .where(and(
        eq(organisationBackupsTable.organisationId, orgId),
        eq(organisationBackupsTable.origin, "manual"),
      ))
      .orderBy(desc(organisationBackupsTable.createdAt))
      .limit(1);

    if (last?.createdAt) {
      const elapsed = Date.now() - new Date(last.createdAt).getTime();
      if (elapsed < MANUAL_COOLDOWN_MS) {
        const minutes = Math.ceil((MANUAL_COOLDOWN_MS - elapsed) / 60000);
        res.status(429).json({ error: `Une sauvegarde vient d'etre prise. Reessayez dans ${minutes} min.` });
        return;
      }
    }

    const saved = await createOrganisationBackup(orgId, {
      origin: "manual",
      userId: req.session?.userId ?? null,
    });
    res.status(201).json({ backup: saved });
  } catch (err: any) {
    req.log.error({ err }, "[my-backups] creation impossible");
    res.status(500).json({ error: err?.message || "Erreur lors de la creation de la sauvegarde." });
  }
});

router.get("/my-backups/:id/download", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const [row] = await db.select()
      .from(organisationBackupsTable)
      .where(and(
        eq(organisationBackupsTable.id, id),
        eq(organisationBackupsTable.organisationId, orgId),
      ));
    if (!row) { res.status(404).json({ error: "Sauvegarde introuvable." }); return; }

    const { json, valid } = readStoredBackup({ content: row.content, checksum: row.checksum });
    if (!valid) {
      // Une empreinte qui ne correspond plus veut dire contenu abime: mieux
      // vaut le dire que livrer un fichier dont on ne repond pas.
      req.log.error({ backupId: id, orgId }, "[my-backups] empreinte invalide");
      res.status(500).json({ error: "Sauvegarde corrompue: empreinte invalide." });
      return;
    }

    const [org] = await db.select({ name: organisationsTable.name })
      .from(organisationsTable).where(eq(organisationsTable.id, orgId));

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Length", String(row.content.length));
    res.setHeader("X-Backup-Checksum", row.checksum);
    res.setHeader("Content-Disposition", `attachment; filename="${backupFileName(org?.name ?? null, new Date(row.createdAt))}"`);
    // On renvoie le gzip stocke tel quel: `json` n'a servi qu'a verifier
    // l'empreinte avant de livrer.
    void json;
    res.end(row.content);
  } catch (err: any) {
    req.log.error({ err }, "[my-backups] telechargement impossible");
    res.status(500).json({ error: "Erreur lors du telechargement." });
  }
});

router.delete("/my-backups/:id", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const deleted = await db.delete(organisationBackupsTable)
      .where(and(
        eq(organisationBackupsTable.id, id),
        eq(organisationBackupsTable.organisationId, orgId),
      ))
      .returning({ id: organisationBackupsTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Sauvegarde introuvable." }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "[my-backups] suppression impossible");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
