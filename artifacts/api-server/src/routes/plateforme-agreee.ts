/**
 * Raccordement a la plateforme agreee (PA) et transmission des factures.
 *
 * GET    /plateforme-agreee               — le raccordement, sans le secret
 * PUT    /plateforme-agreee               — enregistrer / modifier
 * DELETE /plateforme-agreee               — retirer
 * POST   /plateforme-agreee/test          — jeton + disponibilite, sans rien deposer
 * POST   /factures-client/:id/transmettre — deposer la facture emise
 * POST   /plateforme-agreee/suivi         — rafraichir les accuses en attente
 * GET    /plateforme-agreee/recues        — factures recues par la plateforme
 *
 * Tout est reserve aux administrateurs : deposer une facture sur la
 * plateforme la transmet a l'acheteur et a l'administration fiscale, et le
 * raccordement porte un secret qui engage l'entreprise.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, facturesClientTable, plateformesAgreeesTable } from "@workspace/db";
import { requireRole } from "../middleware/auth";
import { getOrgId } from "../middleware/tenant";
import { encryptSensitiveData } from "../lib/crypto";
import { assertSafePublicUrl } from "../lib/ssrf-guard";
import { isIssued } from "../services/invoice-numbering";
import { invoiceFileName } from "../services/invoice-pdf";
import { pdfFacturX } from "../services/facture-document";
import { raccordementDe, rafraichirAccuses } from "../services/plateforme-agreee-suivi";
import {
  ErreurPA,
  deposerFacture,
  oublierJeton,
  rechercherFlux,
  trackingIdFacture,
  verifierDisponibilite,
} from "../services/plateforme-agreee";

const router: IRouter = Router();
const ADMIN = requireRole("administrateur", "super_admin");

/** Une adresse de plateforme : https, publique (garde anti-SSRF), sans identifiants dans l'URL. */
export async function adresseValide(brute: unknown): Promise<string | null> {
  if (typeof brute !== "string" || !brute.trim()) return null;
  try {
    const url = await assertSafePublicUrl(brute.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function erreurPA(res: Response, err: unknown, repli: string): void {
  if (err instanceof ErreurPA) {
    res.status(502).json({ error: err.messagePublic });
    return;
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    res.status(504).json({ error: "La plateforme n'a pas repondu a temps." });
    return;
  }
  res.status(502).json({ error: repli });
}

router.get("/plateforme-agreee", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const [ligne] = await db.select().from(plateformesAgreeesTable).where(eq(plateformesAgreeesTable.organisationId, orgId));
  if (!ligne) { res.json({ configure: false }); return; }
  res.json({
    configure: true,
    nom: ligne.nom,
    urlFlow: ligne.urlFlow,
    urlJeton: ligne.urlJeton,
    clientId: ligne.clientId,
    // Jamais le secret, ni chiffre ni en clair : seulement qu'il existe.
    secretEnregistre: Boolean(ligne.clientSecretChiffre),
    actif: ligne.actif,
  });
});

router.put("/plateforme-agreee", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const nom = typeof b.nom === "string" ? b.nom.trim().slice(0, 120) : "";
  const clientId = typeof b.clientId === "string" ? b.clientId.trim().slice(0, 255) : "";
  const secret = typeof b.clientSecret === "string" ? b.clientSecret.trim() : "";
  const urlFlow = await adresseValide(b.urlFlow);
  const urlJeton = await adresseValide(b.urlJeton);
  if (!nom || !clientId) { res.status(400).json({ error: "Le nom de la plateforme et l'identifiant client sont obligatoires." }); return; }
  if (!urlFlow || !urlJeton) { res.status(400).json({ error: "Les adresses doivent etre des URL https publiques." }); return; }

  const [existant] = await db.select().from(plateformesAgreeesTable).where(eq(plateformesAgreeesTable.organisationId, orgId));
  if (!existant && !secret) { res.status(400).json({ error: "Le secret client est obligatoire." }); return; }

  const valeurs = {
    nom, urlFlow, urlJeton, clientId,
    actif: b.actif === false ? false : true,
    // Secret vide a la modification = inchange (le formulaire ne le reaffiche jamais).
    ...(secret ? { clientSecretChiffre: encryptSensitiveData(secret) } : {}),
  };
  if (existant) {
    await db.update(plateformesAgreeesTable).set(valeurs).where(eq(plateformesAgreeesTable.id, existant.id));
    oublierJeton({ organisationId: orgId, urlJeton: existant.urlJeton, clientId: existant.clientId, urlFlow: "", clientSecret: "" });
  } else {
    await db.insert(plateformesAgreeesTable).values({ organisationId: orgId, ...valeurs, clientSecretChiffre: encryptSensitiveData(secret) });
  }
  res.json({ ok: true });
});

router.delete("/plateforme-agreee", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  await db.delete(plateformesAgreeesTable).where(eq(plateformesAgreeesTable.organisationId, orgId));
  res.json({ ok: true });
});

router.post("/plateforme-agreee/test", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const r = await raccordementDe(getOrgId(req));
  if (!r) { res.status(404).json({ error: "Aucune plateforme raccordee." }); return; }
  try {
    await verifierDisponibilite(r);
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "[pa] test du raccordement en echec");
    erreurPA(res, err, "Le raccordement n'a pas pu etre verifie.");
  }
});

router.post("/factures-client/:id/transmettre", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID invalide." }); return; }

  const [facture] = await db.select().from(facturesClientTable)
    .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
  if (!facture) { res.status(404).json({ error: "Facture non trouvee." }); return; }
  // Un brouillon n'est pas une facture : son numero et son contenu peuvent encore changer.
  if (!isIssued(facture.status)) { res.status(409).json({ error: "Seule une facture emise peut etre transmise." }); return; }
  // Deja deposee et non rejetee : la redeposer creerait un doublon chez l'acheteur.
  if (facture.paFlowId && facture.paStatut !== "Error") {
    res.status(409).json({ error: "Cette facture a deja ete transmise.", flowId: facture.paFlowId, statut: facture.paStatut });
    return;
  }
  const r = await raccordementDe(orgId);
  if (!r) { res.status(409).json({ error: "Aucune plateforme agreee n'est raccordee. Renseignez-la dans les parametres." }); return; }

  try {
    const { pdf } = await pdfFacturX(facture, orgId);
    const flux = await deposerFacture(r, pdf, invoiceFileName(facture.reference), trackingIdFacture(orgId, facture.reference));
    const statut = flux.acknowledgement?.status ?? "Pending";
    await db.update(facturesClientTable).set({
      paFlowId: flux.flowId,
      paStatut: statut,
      paTransmiseLe: new Date(),
      paDetail: flux.acknowledgement?.details ?? null,
    }).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    res.status(202).json({ flowId: flux.flowId, statut });
  } catch (err) {
    req.log.warn({ err, factureId: id }, "[pa] depot de facture en echec");
    erreurPA(res, err, "La facture n'a pas pu etre transmise.");
  }
});

router.post("/plateforme-agreee/suivi", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const r = await raccordementDe(orgId);
  if (!r) { res.status(404).json({ error: "Aucune plateforme raccordee." }); return; }
  try {
    res.json({ misesAJour: await rafraichirAccuses(orgId, r) });
  } catch (err) {
    req.log.warn({ err }, "[pa] suivi des accuses en echec");
    erreurPA(res, err, "Le suivi n'a pas pu etre mis a jour.");
  }
});

router.get("/plateforme-agreee/recues", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const r = await raccordementDe(getOrgId(req));
  if (!r) { res.status(404).json({ error: "Aucune plateforme raccordee." }); return; }
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  try {
    const { results, nextCursor } = await rechercherFlux(r, { flowDirection: ["In"], flowType: ["SupplierInvoice"] }, { limit: 50, cursor });
    res.json({
      factures: results.map((f) => ({
        flowId: f.flowId, nom: f.name, recueLe: f.submittedAt, misAJourLe: f.updatedAt,
        format: f.flowSyntax, statut: f.acknowledgement?.status ?? null,
      })),
      nextCursor: nextCursor ?? null,
    });
  } catch (err) {
    req.log.warn({ err }, "[pa] liste des factures recues en echec");
    erreurPA(res, err, "Les factures recues n'ont pas pu etre lues.");
  }
});

export default router;
