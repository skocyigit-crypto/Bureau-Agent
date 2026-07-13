import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

export function generateMfaSecret(): string {
  return generateSecret();
}

export function buildMfaOtpAuthUrl(email: string, secret: string, issuer = "Agent de Bureau"): string {
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
