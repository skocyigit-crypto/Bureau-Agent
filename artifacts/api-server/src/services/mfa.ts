import { generateSecret, generateURI, verifySync } from "otplib";
import { and, eq, isNull, lt, or } from "drizzle-orm";
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
