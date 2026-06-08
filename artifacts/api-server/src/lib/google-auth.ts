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
// Client OAuth2 "nu" (sans jetons utilisateur), construit a partir des
// identifiants GLOBAUX du serveur (modele SaaS centralise). Sert au flux de
// consentement (auth-url / callback) ou l'on n'a pas encore de jetons. Source
// unique de construction du client : remplace les anciens helpers dupliques
// `getOAuth2ClientForOrg` / `getOAuth2Client` eparpilles dans les routes/services.
// Renvoie null si les identifiants serveur ne sont pas configures.
// ---------------------------------------------------------------------------

export async function createOAuthClient(organisationId?: number | null) {
  const creds = await getOrgGoogleCredentials(organisationId ?? null, { envOnly: true });
  if (!creds) return null;
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, getGoogleRedirectUri());
}

// ---------------------------------------------------------------------------
// Client OAuth2 pret a l'emploi pour un utilisateur : recupere ses jetons,
// resout les identifiants GLOBAUX (env), et configure le client googleapis.
//
// Rafraichissement UNIFIE : on positionne `expiry_date` pour que la librairie
// sache quand le jeton est perime et le rafraichisse PROACTIVEMENT (sans cela
// elle pouvait envoyer un access_token expire -> 401). L'ecouteur `tokens`
// persiste alors le nouvel access_token (et l'eventuel refresh_token) CHIFFRE en
// base, pour TOUTES les surfaces Google. Cela remplace les blocs manuels
// "verifier expiresAt + refreshAccessToken + UPDATE" qui etaient dupliques dans
// chaque service (calendar-sync, auto-pointage, ...).
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

  // Modele centralise : on rafraichit les jetons avec le MEME client global qui
  // les a emis (env), jamais un client org legacy.
  const oauth2Client = await createOAuthClient(tokens[0].organisationId);
  if (!oauth2Client) return null;

  oauth2Client.setCredentials({
    access_token: decryptToken(tokens[0].accessToken),
    refresh_token: decryptToken(tokens[0].refreshToken),
    // Permet a la librairie de rafraichir proactivement quand le jeton est perime.
    expiry_date: tokens[0].expiresAt ? tokens[0].expiresAt.getTime() : undefined,
  });

  // Persistance automatique des jetons rafraichis (chiffres). Google ne renvoie
  // un refresh_token que rarement (premiere autorisation) : on ne l'ecrase que
  // s'il est present, sinon on conserve l'existant.
  oauth2Client.on("tokens", (refreshed) => {
    const updates: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: Date;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (refreshed.access_token) updates.accessToken = encryptToken(refreshed.access_token);
    if (refreshed.refresh_token) updates.refreshToken = encryptToken(refreshed.refresh_token);
    if (refreshed.expiry_date) updates.expiresAt = new Date(refreshed.expiry_date);
    if (!updates.accessToken && !updates.refreshToken) return;
    db.update(googleOAuthTokensTable)
      .set(updates)
      .where(eq(googleOAuthTokensTable.userId, userId))
      .catch((err) =>
        logger.warn({ err, userId }, "[google-auth] persistance du jeton rafraichi echouee"),
      );
  });

  return oauth2Client;
}

// ---------------------------------------------------------------------------
// Fabriques par service : "userId -> client API Google pret a l'emploi" (ou
// null si le compte n'est pas connecte). Point d'entree UNIQUE et identique pour
// toutes les applications Google — les routes/services ne construisent plus
// jamais `google.xxx({ auth })` a la main ni ne gerent l'OAuth eux-memes.
// ---------------------------------------------------------------------------

export async function getGmailForUser(userId: number) {
  const auth = await getAuthClientForUser(userId);
  return auth ? google.gmail({ version: "v1", auth }) : null;
}

export async function getCalendarForUser(userId: number) {
  const auth = await getAuthClientForUser(userId);
  return auth ? google.calendar({ version: "v3", auth }) : null;
}

export async function getDriveForUser(userId: number) {
  const auth = await getAuthClientForUser(userId);
  return auth ? google.drive({ version: "v3", auth }) : null;
}

export async function getDocsForUser(userId: number) {
  const auth = await getAuthClientForUser(userId);
  return auth ? google.docs({ version: "v1", auth }) : null;
}

export async function getSheetsForUser(userId: number) {
  const auth = await getAuthClientForUser(userId);
  return auth ? google.sheets({ version: "v4", auth }) : null;
}

export async function getTasksForUser(userId: number) {
  const auth = await getAuthClientForUser(userId);
  return auth ? google.tasks({ version: "v1", auth }) : null;
}
