import crypto from "crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, apiKeysTable, usersTable } from "@workspace/db";
import { encryptSensitiveData, hashSensitiveData } from "./crypto";

// ---------------------------------------------------------------------------
// Clés API entrantes (Faz 1). Authentifient des appels programmatiques vers
// NOTRE API via `Authorization: Bearer adb_live_...`. Modèle de stockage :
//   - keyHash      : SHA-256 de la clé complète -> lookup O(1) à l'auth.
//   - keyEncrypted : copie réversible CHIFFRÉE au repos (fonction « révéler »).
//   - keyPrefix    : préfixe lisible affiché dans l'UI sans révéler la clé.
//
// Une clé authentifie AU NOM de son créateur (createdByUserId) : on hydrate la
// session avec l'identité/rôle de cet utilisateur, ce qui réutilise toutes les
// gardes existantes (requireTenant, requireRole...). L'application des `scopes`
// est laissée à une tâche de suivi — la clé hérite aujourd'hui des droits de
// son créateur.
// ---------------------------------------------------------------------------

export const API_KEY_PREFIX = "adb_live_";
const RANDOM_BYTES = 32;
const PREFIX_DISPLAY_LEN = API_KEY_PREFIX.length + 6;
const TOUCH_THROTTLE_SECONDS = 60;

export interface GeneratedApiKey {
  /** Clé complète en clair — à renvoyer une seule fois à l'appelant. */
  full: string;
  /** Préfixe lisible (ex: "adb_live_a1b2c3"). */
  prefix: string;
  /** SHA-256 de la clé complète (colonne key_hash). */
  hash: string;
  /** Clé complète chiffrée au repos (colonne key_encrypted). */
  encrypted: string;
}

/** Génère une nouvelle clé API et ses formes dérivées (hash, chiffré, préfixe). */
export function generateApiKey(): GeneratedApiKey {
  const full = API_KEY_PREFIX + crypto.randomBytes(RANDOM_BYTES).toString("base64url");
  return {
    full,
    prefix: full.slice(0, PREFIX_DISPLAY_LEN),
    hash: hashSensitiveData(full),
    encrypted: encryptSensitiveData(full),
  };
}

export interface ApiKeyAuthContext {
  apiKeyId: number;
  userId: number;
  userRole: string;
  organisationId: number;
  userEmail: string;
  prenom: string;
  nom: string;
}

// `adb_live_` + base64url(32 octets aléatoires) sans padding = 43 caractères
// exactement (Math.ceil(32*8/6)). Une plage large (20-128) tolère une future
// rotation de longueur de clé sans casser cette validation.
const API_KEY_SUFFIX_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Vrai si le token a la FORME d'une clé API de cette application (préfixe +
 * charset/longueur plausibles).
 *
 * Cette validation est deliberement bon marche (regex, pas de DB) car
 * `hydrateFromBearer` (middleware/auth.ts) l'appelle desormais sur CHAQUE
 * requete `/api/*`, y compris les routes publiques non authentifiees. Sans
 * ce filtre, n'importe quel `Authorization: Bearer adb_live_<junk>` forcerait
 * un SELECT Postgres par requete meme sur un endpoint public — un vecteur
 * d'amplification DB bon marche pour un attaquant. Le filtre ne remplace pas
 * la verification cryptographique (hash SHA-256 en base) dans
 * `authenticateApiKey`, il evite juste de l'atteindre pour du bruit evident.
 */
export function looksLikeApiKey(token: string): boolean {
  if (!token.startsWith(API_KEY_PREFIX)) return false;
  return API_KEY_SUFFIX_PATTERN.test(token.slice(API_KEY_PREFIX.length));
}

/**
 * Authentifie une clé API. Retourne le contexte (identité du créateur + org)
 * si la clé est valide, active, non expirée et que son créateur est actif et
 * rattaché à la même organisation. Sinon `null`.
 *
 * Lookup par SHA-256 : un attaquant devrait connaître le préimage de la clé,
 * la comparaison se fait sur le digest indexé (pas sur le secret).
 */
export async function authenticateApiKey(token: string): Promise<ApiKeyAuthContext | null> {
  if (!looksLikeApiKey(token)) return null;
  const hash = hashSensitiveData(token);

  const [key] = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, hash));
  if (!key) return null;

  // Révoquée ?
  if (key.revokedAt) return null;
  // Expirée ?
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return null;
  // Sans créateur identifiable, on ne peut pas dériver un contexte utilisateur.
  if (!key.createdByUserId) return null;

  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      email: usersTable.email,
      prenom: usersTable.prenom,
      nom: usersTable.nom,
      actif: usersTable.actif,
      organisationId: usersTable.organisationId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, key.createdByUserId));

  if (!user || !user.actif) return null;
  // Défense en profondeur : la clé et son porteur doivent partager l'org.
  if (user.organisationId !== key.organisationId) return null;

  // Marque l'usage (throttlé pour éviter une écriture par requête).
  void touchLastUsed(key.id);

  return {
    apiKeyId: key.id,
    userId: user.id,
    userRole: user.role,
    organisationId: key.organisationId,
    userEmail: user.email,
    prenom: user.prenom,
    nom: user.nom,
  };
}

/**
 * Met à jour `last_used_at` au plus une fois par fenêtre de throttle. Best
 * effort : les erreurs sont avalées (l'auth ne doit pas échouer à cause d'une
 * écriture d'horodatage).
 */
async function touchLastUsed(apiKeyId: number): Promise<void> {
  try {
    await db
      .update(apiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKeysTable.id, apiKeyId),
          or(
            isNull(apiKeysTable.lastUsedAt),
            sql`${apiKeysTable.lastUsedAt} < now() - make_interval(secs => ${TOUCH_THROTTLE_SECONDS})`,
          ),
        ),
      );
  } catch {
    // Ignoré volontairement.
  }
}
