import crypto from "crypto";

// ---------------------------------------------------------------------------
// Chiffrement au repos AES-256-GCM (durci). Implementation CANONIQUE et unique
// pour tout secret persiste : secrets d'integration (cle API CRM, token OAuth
// tiers...), cles API sortantes et secrets de signature des webhooks.
//
// Format stocke :
//   "enc:v1:" + base64( salt(32) | iv(16) | authTag(16) | ciphertext )
//
// Proprietes de securite :
// - cle derivee par PBKDF2 (sha512, 100k iterations) a partir d'un salt
//   ALEATOIRE PROPRE A CHAQUE chiffrement -> deux chiffrements du meme texte
//   produisent des sorties differentes (pas de correlation) ;
// - IV (nonce) aleatoire par chiffrement ;
// - authTag GCM verifie integrite + authenticite au dechiffrement : toute
//   alteration d'un octet (ou mauvaise cle) fait echouer le dechiffrement au
//   lieu de rendre des donnees silencieusement corrompues.
// ---------------------------------------------------------------------------

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_ITERATIONS = 100000;
const KEY_LENGTH = 32;
const VERSION_PREFIX = "enc:v1:";
// Taille minimale d'un blob valide : salt + iv + authTag (ciphertext peut etre
// vide -> une chaine vide chiffree reste dechiffrable, pas de +1 ici).
const MIN_PAYLOAD_BYTES = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, KEY_ITERATIONS, KEY_LENGTH, "sha512");
}

function getEncryptionSecret(): string {
  const dedicated = process.env.DATA_ENCRYPTION_KEY;
  if (dedicated && dedicated.length >= 16) return dedicated;

  // En production on EXIGE une cle dediee et STABLE. Se rabattre sur
  // SESSION_SECRET couplerait le dechiffrement des secrets long-terme (secrets
  // de signature webhook, cles API, secrets d'integration) a la rotation de
  // session -> au prochain changement de SESSION_SECRET, tous ces secrets
  // deviendraient indechiffrables.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATA_ENCRYPTION_KEY (>= 16 caracteres) requis en production pour chiffrer les secrets persistes.",
    );
  }

  // Hors production uniquement : repli pratique sur SESSION_SECRET.
  const fallback = process.env.SESSION_SECRET;
  if (!fallback || fallback.length < 16) {
    throw new Error(
      "Cle de chiffrement non configuree ou trop courte (definir DATA_ENCRYPTION_KEY, >= 16 caracteres).",
    );
  }
  return fallback;
}

/** Vrai si la valeur est deja un blob chiffre par cette couche. */
export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(VERSION_PREFIX);
}

export function encryptSensitiveData(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSensitiveData attend une chaine de caracteres.");
  }
  const secret = getEncryptionSecret();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return `${VERSION_PREFIX}${combined.toString("base64")}`;
}

export function decryptSensitiveData(ciphertext: string): string {
  // Tolerance migration : une valeur jamais chiffree est rendue telle quelle,
  // ce qui permet de basculer progressivement d'anciennes donnees en clair.
  if (!isEncrypted(ciphertext)) {
    return ciphertext;
  }
  const secret = getEncryptionSecret();
  let combined: Buffer;
  try {
    combined = Buffer.from(ciphertext.slice(VERSION_PREFIX.length), "base64");
  } catch {
    throw new Error("Donnees chiffrees invalides (encodage base64).");
  }
  if (combined.length < MIN_PAYLOAD_BYTES) {
    throw new Error("Donnees chiffrees corrompues ou tronquees.");
  }
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  );
  const encrypted = combined.subarray(
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
  );
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Tag d'authentification GCM invalide.");
  }
  const key = deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  try {
    return (
      decipher.update(encrypted, undefined, "utf-8") + decipher.final("utf-8")
    );
  } catch {
    // GCM : echec de verification du tag (cle erronee ou donnees alterees).
    throw new Error(
      "Echec du dechiffrement : donnees alterees ou cle de chiffrement invalide.",
    );
  }
}

export function hashSensitiveData(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
