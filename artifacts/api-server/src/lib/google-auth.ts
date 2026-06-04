import crypto from "crypto";
import { google } from "googleapis";
import { eq } from "drizzle-orm";
import {
  db,
  googleOAuthTokensTable,
  googleAppCredentialsTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { encryptSensitiveData, decryptSensitiveData, isEncrypted } from "./crypto";

// ---------------------------------------------------------------------------
// Jetons OAuth Google (access_token / refresh_token) chiffres AU REPOS via la
// couche canonique lib/crypto (AES-256-GCM, cle DATA_ENCRYPTION_KEY). Le
// refresh_token est un secret long terme : en clair, une fuite de la base
// donnerait acces aux comptes Gmail/Agenda/Drive de TOUS les clients connectes.
// decryptToken tolere les anciennes valeurs en clair (migration progressive :
// decryptSensitiveData renvoie tel quel ce qui n'est pas chiffre).
// ---------------------------------------------------------------------------
export function encryptToken(plain: string): string {
  return encryptSensitiveData(plain);
}
export function decryptToken(value: string | null | undefined): string | null {
  return value == null ? null : decryptSensitiveData(value);
}

// Chiffre une valeur SI elle n'est pas deja chiffree (idempotent, null-safe).
// Utile quand on reecrit une ligne en conservant une valeur existante (ex.
// callback OAuth sans nouveau refresh_token) : on ne doit jamais re-persister
// du clair legacy ni double-chiffrer un blob existant.
export function ensureEncryptedToken(value: string | null | undefined): string | null {
  if (value == null) return null;
  return isEncrypted(value) ? value : encryptToken(value);
}

// Re-chiffrement opportuniste : une ligne anterieure au chiffrement au repos
// peut encore contenir des jetons EN CLAIR. Le refresh_token (secret long terme)
// n'est presque jamais reecrit par le flux de refresh — sans ce backfill paresseux
// il resterait en clair indefiniment. On chiffre donc en place tout jeton non
// chiffre au PREMIER acces. Best-effort : un echec est logge sans interrompre
// l'appelant ; une fois chiffre, l'appel est un no-op sans ecriture.
export async function ensureTokenRowEncrypted(row: {
  id: number;
  accessToken: string | null;
  refreshToken: string | null;
}): Promise<void> {
  const updates: { accessToken?: string; refreshToken?: string } = {};
  if (row.accessToken && !isEncrypted(row.accessToken)) {
    updates.accessToken = encryptToken(row.accessToken);
  }
  if (row.refreshToken && !isEncrypted(row.refreshToken)) {
    updates.refreshToken = encryptToken(row.refreshToken);
  }
  if (!updates.accessToken && !updates.refreshToken) return;
  try {
    await db
      .update(googleOAuthTokensTable)
      .set(updates)
      .where(eq(googleOAuthTokensTable.id, row.id));
  } catch (err) {
    logger.warn({ err, tokenId: row.id }, "[google-auth] re-chiffrement opportuniste du jeton echoue");
  }
}

// ---------------------------------------------------------------------------
// Chiffrement au repos du client_secret Google (modele "bring your own
// credentials"). AES-256-GCM, cle derivee de SESSION_SECRET. Format stocke :
// "<iv_hex>:<authTag_hex>:<ciphertext_hex>".
// ---------------------------------------------------------------------------

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET requis pour chiffrer les identifiants Google.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Format de secret chiffre invalide.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return dec.toString("utf8");
}

// ---------------------------------------------------------------------------
// Resolution de l'URI de redirection (doit etre enregistree dans l'application
// OAuth Google de chaque client).
// ---------------------------------------------------------------------------

export function getGoogleRedirectUri(): string {
  const path = "/api/google-oauth/callback";

  // 1. Override explicite par l'admin.
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;

  // 2. URL publique configuree manuellement (self-hosting / domaine custom).
  const publicBase = process.env.PUBLIC_URL || process.env.APP_URL;
  if (publicBase) return `${publicBase.replace(/\/$/, "")}${path}`;

  // 3. REPLIT_DOMAINS — fournie automatiquement par Replit EN DEPLOIEMENT
  //    (custom domain ou .replit.app). C'est la SEULE source correcte en
  //    production : REPLIT_DEV_DOMAIN n'y est pas defini, donc sans ce cas
  //    la resolution retombait sur <slug>.repl.co / localhost et Google
  //    rejetait le consentement avec redirect_uri_mismatch. On prend le
  //    premier domaine et on prefixe https (REPLIT_DOMAINS vient sans schema).
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const first = replitDomains.split(",").map(d => d.trim()).filter(Boolean)[0];
    if (first) {
      const base = first.startsWith("http://") || first.startsWith("https://") ? first : `https://${first}`;
      return `${base.replace(/\/$/, "")}${path}`;
    }
  }

  // 4. Domaine de developpement Replit.
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}${path}`;

  // 5. Anciens repls.
  if (process.env.REPL_SLUG) return `https://${process.env.REPL_SLUG}.repl.co${path}`;

  // 6. Dernier recours (dev local hors Replit).
  return `http://localhost${path}`;
}

// ---------------------------------------------------------------------------
// Resolution des identifiants OAuth par organisation, avec repli optionnel sur
// les variables d'environnement (compatibilite legacy / application partagee).
// ---------------------------------------------------------------------------

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  source: "org" | "env";
}

export async function getOrgGoogleCredentials(
  organisationId: number | null | undefined,
  opts: { envFallback?: boolean; envOnly?: boolean } = {},
): Promise<GoogleCredentials | null> {
  const { envFallback = true, envOnly = false } = opts;

  // Modele SaaS centralise : `envOnly` impose les identifiants GLOBAUX du serveur
  // et ignore toute ligne org legacy (google_app_credentials), garantissant qu'un
  // seul client OAuth est utilise pour toute la plateforme.
  if (envOnly) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret, source: "env" };
    }
    return null;
  }

  if (organisationId) {
    try {
      const rows = await db
        .select()
        .from(googleAppCredentialsTable)
        .where(eq(googleAppCredentialsTable.organisationId, organisationId))
        .limit(1);
      if (rows.length > 0 && rows[0].clientId && rows[0].clientSecretEnc) {
        try {
          const clientSecret = decryptSecret(rows[0].clientSecretEnc);
          return { clientId: rows[0].clientId, clientSecret, source: "org" };
        } catch (err) {
          logger.error({ err, organisationId }, "[google-auth] dechiffrement du client_secret echoue");
        }
      }
    } catch (err) {
      logger.error({ err, organisationId }, "[google-auth] lecture des identifiants org echouee");
    }
  }

  if (envFallback) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (clientId && clientSecret) {
      return { clientId, clientSecret, source: "env" };
    }
  }

  return null;
}

export async function getOrgIdForUser(userId: number): Promise<number | null> {
  try {
    const rows = await db
      .select({ organisationId: usersTable.organisationId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    return rows[0]?.organisationId ?? null;
  } catch (err) {
    logger.error({ err, userId }, "[google-auth] resolution organisation echouee");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Client OAuth2 pret a l'emploi pour un utilisateur : recupere ses jetons,
// resout les identifiants de SON organisation, et configure le client googleapis
// (qui rafraichit automatiquement l'access_token via le refresh_token).
// Renvoie null si aucun jeton ou aucun identifiant disponible.
// ---------------------------------------------------------------------------

export async function getAuthClientForUser(userId: number) {
  const tokens = await db
    .select()
    .from(googleOAuthTokensTable)
    .where(eq(googleOAuthTokensTable.userId, userId))
    .limit(1);
  if (tokens.length === 0) return null;

  await ensureTokenRowEncrypted(tokens[0]);

  const orgId = tokens[0].organisationId ?? (await getOrgIdForUser(userId));
  // Modele centralise : on rafraichit les jetons avec le MEME client global qui
  // les a emis (env), jamais un client org legacy.
  const creds = await getOrgGoogleCredentials(orgId, { envOnly: true });
  if (!creds) return null;

  const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, getGoogleRedirectUri());
  oauth2Client.setCredentials({
    access_token: decryptToken(tokens[0].accessToken),
    refresh_token: decryptToken(tokens[0].refreshToken),
  });
  return oauth2Client;
}
