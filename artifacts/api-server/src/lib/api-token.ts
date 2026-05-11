/**
 * Bearer-token stateless API auth, dedie aux clients non-navigateur
 * (application mobile Expo principalement). Le web continue a utiliser
 * la session-cookie traditionnelle (`__Host-` + SameSite + Secure).
 *
 * Choix d'implementation:
 *
 *   - HMAC-SHA256 avec rotation multi-secret (meme primitive que
 *     `voice-command.ts`) au lieu d'introduire `jsonwebtoken`. Cela:
 *       - reutilise `SESSION_SECRETS` deja mis en place + ses garanties
 *         de timing-safety (boucle constante);
 *       - evite une dependance supplementaire et donc une CVE de plus
 *         a surveiller;
 *       - garde la logique de rotation alignee avec le reste du serveur
 *         (un seul env, une seule politique).
 *
 *   - Charge utile minimale: `userId`, `userRole`, `organisationId`,
 *     `userEmail`, `prenom`, `nom`, `iat`, `exp`. Strictement les
 *     champs que `req.session` exposait deja, pour que les routes en
 *     aval restent identiques.
 *
 *   - TTL par defaut: 30 jours. Long parce que l'app mobile ne peut
 *     pas relancer un flot OAuth interactif aussi souvent qu'un
 *     navigateur. Si l'utilisateur change son mot de passe, la route
 *     correspondante doit (a faire dans une iteration future) ajouter
 *     `tokenInvalidatedAt` sur l'utilisateur et le middleware doit
 *     verifier `iat >= tokenInvalidatedAt`. C'est une evolution non
 *     bloquante; le token reste opaque cote client.
 *
 *   - Format: `<base64url(payload)>.<base64url(hmac)>`. Pas de header
 *     JWT separe (`alg`, `typ`) parce qu'il n'y a qu'un seul algo
 *     accepte cote serveur — refuser tout sauf HMAC-SHA256 evite la
 *     classe entiere des attaques `alg=none`.
 */
import crypto from "crypto";

export interface ApiTokenPayload {
  userId: number;
  userRole: string;
  organisationId?: number;
  userEmail: string;
  prenom?: string;
  nom?: string;
  iat: number;
  exp: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 16;

function getSecrets(): string[] {
  const out: string[] = [];
  const list = process.env.SESSION_SECRETS;
  if (list) {
    for (const p of list.split(",").map((s) => s.trim())) {
      if (p.length >= MIN_SECRET_LENGTH) out.push(p);
    }
  }
  for (const env of ["SESSION_SECRET", "JWT_SECRET"]) {
    const v = process.env[env];
    if (v && v.length >= MIN_SECRET_LENGTH && !out.includes(v)) out.push(v);
  }
  if (out.length > 0) return out;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRETS (ou SESSION_SECRET / JWT_SECRET) est requis en production pour signer les tokens API.",
    );
  }
  return ["dev-api-token-secret-do-not-use-in-prod-aaaaaaaa"];
}

export function mintApiToken(
  base: Omit<ApiTokenPayload, "iat" | "exp">,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const now = Date.now();
  const payload: ApiTokenPayload = { ...base, iat: now, exp: now + ttlMs };
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecrets()[0])
    .update(json)
    .digest("base64url");
  return `${json}.${sig}`;
}

export function verifyApiToken(token: string): ApiTokenPayload | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const idx = token.indexOf(".");
  const json = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!json || !sig) return null;

  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }

  // Boucle a temps constant: aucun short-circuit sur la 1re reussite,
  // pour que le total de travail ne depende que du nombre de secrets
  // actifs, pas du secret qui a effectivement signe le token.
  let matched = false;
  for (const secret of getSecrets()) {
    const expected = crypto
      .createHmac("sha256", secret)
      .update(json)
      .digest();
    if (
      expected.length === sigBuf.length &&
      crypto.timingSafeEqual(expected, sigBuf)
    ) {
      matched = true;
    }
  }
  if (!matched) return null;

  let payload: ApiTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload.userId !== "number" ||
    typeof payload.userRole !== "string" ||
    typeof payload.userEmail !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (Date.now() >= payload.exp) return null;

  return payload;
}

/**
 * Header HTTP standard: `Authorization: Bearer <token>`. Renvoie le token
 * brut ou `null` si l'en-tete est absent / mal forme.
 */
export function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!m) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}
