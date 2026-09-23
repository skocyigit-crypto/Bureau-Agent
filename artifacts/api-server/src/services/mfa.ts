import { generateSecret, generateURI, verifySync } from "otplib";
import { createHash, randomInt } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import QRCode from "qrcode";

export function generateMfaSecret(): string {
  return generateSecret();
}

export function buildMfaOtpAuthUrl(email: string, secret: string, issuer = "Ajant Bureau"): string {
  return generateURI({ issuer, label: email, secret });
}

export async function buildMfaQrDataUrl(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}

export function verifyMfaToken(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const result = verifySync({ token: cleaned, secret, epochTolerance: 30 });
    return !!(result && (result as any).valid === true);
  } catch {
    return false;
  }
}

/**
 * Le pas de temps TOTP auquel le code correspond, ou null s'il est faux.
 */
export function pasMfaValide(token: string, secret: string): number | null {
  if (!token || !secret) return null;
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  try {
    const r = verifySync({ token: cleaned, secret, epochTolerance: 30 }) as { valid?: boolean; timeStep?: number };
    return r && r.valid === true && Number.isInteger(r.timeStep) ? (r.timeStep as number) : null;
  } catch {
    return null;
  }
}

/**
 * Verifie un code TOTP ET le consomme : un code deja utilise est refuse.
 *
 * RFC 6238 §5.2 : le verificateur ne doit pas accepter deux fois le meme
 * code. Sans cette regle, un code intercepte en meme temps que le mot de passe
 * (hameconnage en temps reel, epaule) restait rejouable pendant toute sa
 * fenetre de validite — trente secondes, plus la tolerance.
 *
 * Le dernier pas accepte est garde EN BASE, et la mise a jour est atomique
 * (UPDATE ... WHERE dernier_pas < pas RETURNING) : l'API tourne sur plusieurs
 * instances, et deux soumissions simultanees du meme code ne passent pas
 * toutes les deux.
 */
export async function consommerCodeMfa(userId: number, token: string, secret: string): Promise<boolean> {
  const pas = pasMfaValide(token, secret);
  if (pas === null) return false;
  const lignes = await db.update(usersTable)
    .set({ mfaDernierPas: pas })
    .where(and(eq(usersTable.id, userId), or(isNull(usersTable.mfaDernierPas), lt(usersTable.mfaDernierPas, pas))))
    .returning({ id: usersTable.id });
  return lignes.length > 0;
}

/*
 * Codes de secours.
 *
 * Sans eux, un utilisateur qui perd son telephone perd son compte : seul le
 * support peut le rouvrir, et la tentation est alors de le faire sur simple
 * demande — ce qui annule la double authentification. Dix codes a usage
 * unique, montres une seule fois ; seules leurs empreintes sont gardees.
 *
 * Alphabet sans 0/O, 1/I/L : un code recopie a la main depuis un papier.
 * 31^10 ≈ 8·10^14 combinaisons, derriere le limiteur et le verrouillage de
 * la connexion : un SHA-256 sans sel suffit, un hachage lent n'ajoute rien.
 */
const ALPHABET_SECOURS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const NOMBRE_CODES_SECOURS = 10;

/** Dix codes neufs, au format ABCDE-FGHJK. */
export function genererCodesSecours(n = NOMBRE_CODES_SECOURS): string[] {
  return Array.from({ length: n }, () => {
    let c = "";
    for (let i = 0; i < 10; i++) c += ALPHABET_SECOURS[randomInt(ALPHABET_SECOURS.length)];
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}

/** Forme canonique d'une saisie (casse, espaces, tirets ignores) ; null si ce n'en est pas un. */
export function normaliserCodeSecours(saisie: string): string | null {
  if (typeof saisie !== "string") return null;
  const n = saisie.toUpperCase().replace(/[\s-]/g, "");
  if (n.length !== 10) return null;
  for (const ch of n) if (!ALPHABET_SECOURS.includes(ch)) return null;
  return n;
}

export function empreinteCodeSecours(code: string): string {
  return createHash("sha256").update(normaliserCodeSecours(code) ?? code).digest("hex");
}

/**
 * Consomme un code de secours : il est retire de la liste dans la meme
 * instruction qui verifie sa presence, donc deux soumissions simultanees du
 * meme code ne passent pas toutes les deux.
 */
export async function consommerCodeSecours(userId: number, saisie: string): Promise<boolean> {
  const code = normaliserCodeSecours(saisie);
  if (!code) return false;
  const h = empreinteCodeSecours(code);
  const lignes = await db.update(usersTable)
    .set({ mfaCodesSecours: sql`${usersTable.mfaCodesSecours} - ${h}::text` })
    .where(and(eq(usersTable.id, userId), sql`jsonb_exists(${usersTable.mfaCodesSecours}, ${h}::text)`))
    .returning({ id: usersTable.id });
  return lignes.length > 0;
}

/**
 * Second facteur a la connexion ou a la desactivation : un code a six
 * chiffres est un TOTP, toute autre saisie est essayee comme code de secours.
 */
export async function verifierSecondFacteur(
  userId: number, saisie: string, secret: string,
): Promise<"totp" | "secours" | null> {
  if (typeof saisie !== "string") return null;
  if (/^\s*\d{6}\s*$/.test(saisie)) return (await consommerCodeMfa(userId, saisie, secret)) ? "totp" : null;
  return (await consommerCodeSecours(userId, saisie)) ? "secours" : null;
}
