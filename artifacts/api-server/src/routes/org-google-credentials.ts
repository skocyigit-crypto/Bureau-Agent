/**
 * Identifiants OAuth Google PROPRES A L'ORGANISATION (BYOC).
 *
 * `lib/google-auth.ts` les lit deja depuis `google_app_credentials` et sait les
 * dechiffrer, la table existe, `encryptSecret` existe — mais AUCUN chemin ne les
 * y ecrivait. Le seul moyen de brancher Google etait donc les variables
 * d'environnement de la plateforme, partagees par tous les clients: soit le
 * proprietaire configure une application Google pour tout le monde, soit
 * personne n'a Gmail, Drive et Calendar. Ce fichier ferme le trou: chaque
 * organisation peut deposer sa propre application OAuth.
 *
 * Le secret client n'est JAMAIS relu par l'API. Il est chiffre a l'ecriture
 * (AES-256-GCM) et la lecture ne renvoie que sa presence et l'identifiant
 * public, jamais la valeur.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, googleAppCredentialsTable } from "@workspace/db";
import { requireRole } from "../middleware/auth";
import { getOrgId } from "../middleware/tenant";
import { encryptSecret, getGoogleRedirectUri } from "../lib/google-auth";

const router: IRouter = Router();

/** Un identifiant client Google ressemble a `123-abc.apps.googleusercontent.com`. */
const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i;
/** Les secrets emis par Google commencent par `GOCSPX-`; on reste tolerant. */
const MIN_SECRET_LENGTH = 10;

/** Ne montre que la forme de l'identifiant, jamais le secret. */
function maskClientId(clientId: string): string {
  const [prefix] = clientId.split("-");
  return `${prefix}-…apps.googleusercontent.com`;
}

router.get("/org-google-credentials", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [row] = await db.select({
      clientId: googleAppCredentialsTable.clientId,
      updatedAt: googleAppCredentialsTable.updatedAt,
    }).from(googleAppCredentialsTable).where(eq(googleAppCredentialsTable.organisationId, orgId));

    res.json({
      configured: !!row,
      clientIdMasked: row ? maskClientId(row.clientId) : null,
      updatedAt: row?.updatedAt ?? null,
      // A recopier tel quel dans la console Google: une URI qui ne correspond
      // pas au caractere pres fait echouer le consentement avec
      // `redirect_uri_mismatch`, sans autre indice.
      redirectUri: getGoogleRedirectUri(),
      usesPlatformFallback: !row && !!process.env.GOOGLE_CLIENT_ID,
    });
  } catch (err: any) {
    req.log.error({ err }, "[org-google-credentials] lecture impossible");
    res.status(500).json({ error: "Erreur lors de la lecture des identifiants." });
  }
});

router.put("/org-google-credentials", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const clientId = String(req.body?.clientId ?? "").trim();
  const clientSecret = String(req.body?.clientSecret ?? "").trim();

  if (!CLIENT_ID_PATTERN.test(clientId)) {
    res.status(400).json({ error: "Identifiant client invalide: il se termine par .apps.googleusercontent.com." });
    return;
  }
  if (clientSecret.length < MIN_SECRET_LENGTH) {
    res.status(400).json({ error: "Secret client invalide." });
    return;
  }

  try {
    // Le chiffrement derive sa cle de SESSION_SECRET: sans lui, mieux vaut
    // refuser que stocker un secret en clair.
    const clientSecretEnc = encryptSecret(clientSecret);
    const now = new Date();

    await db.insert(googleAppCredentialsTable)
      .values({ organisationId: orgId, clientId, clientSecretEnc, updatedAt: now })
      .onConflictDoUpdate({
        target: googleAppCredentialsTable.organisationId,
        set: { clientId, clientSecretEnc, updatedAt: now },
      });

    req.log.info({ orgId }, "[org-google-credentials] identifiants enregistres");
    res.json({ configured: true, clientIdMasked: maskClientId(clientId), redirectUri: getGoogleRedirectUri() });
  } catch (err: any) {
    req.log.error({ err }, "[org-google-credentials] ecriture impossible");
    res.status(500).json({ error: err?.message || "Erreur lors de l'enregistrement." });
  }
});

router.delete("/org-google-credentials", requireRole("administrateur", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    await db.delete(googleAppCredentialsTable).where(eq(googleAppCredentialsTable.organisationId, orgId));
    req.log.info({ orgId }, "[org-google-credentials] identifiants supprimes");
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "[org-google-credentials] suppression impossible");
    res.status(500).json({ error: "Erreur lors de la suppression." });
  }
});

export default router;
