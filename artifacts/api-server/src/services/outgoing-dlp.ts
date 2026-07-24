import type { Request, Response } from "express";
import { detectPii, type PiiKind } from "./pii-detection";
import { recordSecurityScan } from "./security-scans";
import { getOrgId } from "../middleware/tenant";

// Categories declenchant une confirmation avant envoi. `email` et `phone` sont
// volontairement exclus: tout mail professionnel en contient, les signaler
// rendrait l'avertissement insignifiant. SIRET/SIREN sont des identifiants
// d'entreprise publics, donc non sensibles.
const DLP_SENSITIVE_KINDS = new Set<PiiKind>(["iban", "card", "nir"]);

/**
 * Controle DLP applique a TOUT depart de courrier, quel que soit le point
 * d'entree. Renvoie `true` quand la reponse a deja ete envoyee et que
 * l'appelant doit s'arreter.
 *
 * L'envoi n'est jamais interdit — transmettre un IBAN est parfois legitime —
 * mais il exige une confirmation explicite au lieu de partir en silence, et la
 * tentative est tracee dans le journal de securite.
 *
 * Ce controle vit dans un service partage parce qu'il existe PLUSIEURS routes
 * capables d'envoyer un e-mail (agent Mail et hub Google Workspace). Une
 * verification recopiee dans une seule d'entre elles laisserait une porte
 * ouverte a cote.
 */
export function dlpBlocksOutgoing(
  req: Request,
  res: Response,
  userId: number,
  to: string,
  subject: string,
  body: string,
): boolean {
  const sensitive = detectPii(`${subject}\n${body}`).findings
    .filter((f) => DLP_SENSITIVE_KINDS.has(f.kind));
  if (sensitive.length === 0) return false;

  const orgId = getOrgId(req);
  const detail = sensitive.map((f) => `${f.label} (${f.count})`).join(", ");
  if (orgId) {
    recordSecurityScan({
      orgId,
      userId,
      kind: "email",
      target: String(to).slice(0, 300),
      verdict: "suspicious",
      details: `Donnees sensibles sortantes: ${detail}`,
      engine: "DLP",
    });
  }
  if (req.body?.confirmSensitive === true) return false;

  res.status(409).json({
    error: "donnees_sensibles",
    message: `Cet e-mail contient des données sensibles : ${detail}. Confirmez l'envoi si c'est volontaire.`,
    findings: sensitive,
  });
  return true;
}
