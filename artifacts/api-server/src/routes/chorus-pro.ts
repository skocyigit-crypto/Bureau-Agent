/**
 * Raccordement a Chorus Pro et depot des factures adressees au secteur public.
 *
 * GET    /chorus-pro                     — le raccordement, sans les secrets
 * PUT    /chorus-pro                     — enregistrer / modifier
 * DELETE /chorus-pro                     — retirer
 * POST   /chorus-pro/test                — jeton PISTE + compte technique
 * POST   /chorus-pro/structure           — verifier qu'un SIRET public est raccorde
 * POST   /factures-client/:id/chorus     — deposer la facture emise
 * POST   /chorus-pro/suivi               — rafraichir l'etat des depots en cours
 *
 * Reserve aux administrateurs : deposer une facture l'envoie a l'acheteur
 * public, et le raccordement porte deux secrets qui engagent l'entreprise.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db, facturesClientTable, raccordementsChorusProTable } from "@workspace/db";
import { requireRole } from "../middleware/auth";
import { getOrgId } from "../middleware/tenant";
import { encryptSensitiveData } from "../lib/crypto";
import { isIssued } from "../services/invoice-numbering";
import { invoiceFileName } from "../services/invoice-pdf";
import { pdfFacturX } from "../services/facture-document";
import { adresseValide } from "./plateforme-agreee";
import {
  ErreurChorus,
  consulterCompteRendu,
  deposerFluxFacture,
  oublierJetonChorus,
  raccordementChorusDe,
  rechercherStructure,
  verifierRaccordementChorus,
} from "../services/chorus-pro";

const router: IRouter = Router();
const ADMIN = requireRole("administrateur", "super_admin");

/**
 * Etats de flux qui ne bougeront plus : inutile de les redemander a Chorus Pro.
 * La liste vient des comptes rendus observes ; un etat inconnu est donc traite
 * comme « en cours », ce qui fait seulement une consultation de plus.
 */
export const ETATS_TERMINAUX = ["INTEGRE", "REJETE", "IN_INTEGRE", "IN_REJETE"];

export function etatTermine(etat: string | null | undefined): boolean {
  return !!etat && ETATS_TERMINAUX.includes(etat.toUpperCase());
}

function erreurChorus(res: Response, err: unknown, repli: string): void {
  if (err instanceof ErreurChorus) {
    res.status(502).json({ error: err.messagePublic });
    return;
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    res.status(504).json({ error: "Chorus Pro n'a pas repondu a temps." });
    return;
  }
  res.status(502).json({ error: repli });
}

router.get("/chorus-pro", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const [ligne] = await db.select().from(raccordementsChorusProTable)
    .where(eq(raccordementsChorusProTable.organisationId, orgId));
  if (!ligne) { res.json({ configure: false }); return; }
  res.json({
    configure: true,
    urlBase: ligne.urlBase,
    urlJeton: ligne.urlJeton,
    clientId: ligne.clientId,
    compteTechnique: ligne.compteTechnique,
    idUtilisateurCourant: ligne.idUtilisateurCourant,
    syntaxeFlux: ligne.syntaxeFlux,
    // Jamais les secrets, ni chiffres ni en clair : seulement qu'ils existent.
    secretEnregistre: Boolean(ligne.clientSecretChiffre),
    motDePasseEnregistre: Boolean(ligne.motDePasseTechniqueChiffre),
    actif: ligne.actif,
  });
});

router.put("/chorus-pro", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const texte = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const clientId = texte(b.clientId, 255);
  const compteTechnique = texte(b.compteTechnique, 255);
  const syntaxeFlux = texte(b.syntaxeFlux, 60);
  const secret = typeof b.clientSecret === "string" ? b.clientSecret.trim() : "";
  const motDePasse = typeof b.motDePasseTechnique === "string" ? b.motDePasseTechnique.trim() : "";
  const urlBase = await adresseValide(b.urlBase);
  const urlJeton = await adresseValide(b.urlJeton);
  const idUtilisateur = Number.parseInt(String(b.idUtilisateurCourant ?? ""), 10);

  if (!clientId || !compteTechnique) {
    res.status(400).json({ error: "L'identifiant PISTE et le compte technique Chorus Pro sont obligatoires." });
    return;
  }
  if (!syntaxeFlux) { res.status(400).json({ error: "La syntaxe de flux est obligatoire." }); return; }
  if (!urlBase || !urlJeton) { res.status(400).json({ error: "Les adresses doivent etre des URL https publiques." }); return; }

  const [existant] = await db.select().from(raccordementsChorusProTable)
    .where(eq(raccordementsChorusProTable.organisationId, orgId));
  if (!existant && (!secret || !motDePasse)) {
    res.status(400).json({ error: "Le secret PISTE et le mot de passe du compte technique sont obligatoires." });
    return;
  }

  const valeurs = {
    urlBase, urlJeton, clientId, compteTechnique, syntaxeFlux,
    idUtilisateurCourant: Number.isInteger(idUtilisateur) && idUtilisateur > 0 ? idUtilisateur : null,
    actif: b.actif === false ? false : true,
    // Secret vide a la modification = inchange (le formulaire ne le reaffiche jamais).
    ...(secret ? { clientSecretChiffre: encryptSensitiveData(secret) } : {}),
    ...(motDePasse ? { motDePasseTechniqueChiffre: encryptSensitiveData(motDePasse) } : {}),
  };

  if (existant) {
    await db.update(raccordementsChorusProTable).set(valeurs)
      .where(eq(raccordementsChorusProTable.id, existant.id));
    // Les identifiants ont pu changer : le jeton en cache ne vaut plus.
    oublierJetonChorus({
      organisationId: orgId, urlJeton: existant.urlJeton, clientId: existant.clientId,
      urlBase: "", clientSecret: "", compteTechnique: "", motDePasseTechnique: "", syntaxeFlux: "",
    });
  } else {
    await db.insert(raccordementsChorusProTable).values({
      organisationId: orgId, ...valeurs,
      clientSecretChiffre: encryptSensitiveData(secret),
      motDePasseTechniqueChiffre: encryptSensitiveData(motDePasse),
    });
  }
  res.json({ ok: true });
});

router.delete("/chorus-pro", ADMIN, async (req: Request, res: Response): Promise<void> => {
  await db.delete(raccordementsChorusProTable)
    .where(eq(raccordementsChorusProTable.organisationId, getOrgId(req)));
  res.json({ ok: true });
});

router.post("/chorus-pro/test", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const r = await raccordementChorusDe(getOrgId(req));
  if (!r) { res.status(404).json({ error: "Aucun raccordement Chorus Pro." }); return; }
  try {
    res.json(await verifierRaccordementChorus(r));
  } catch (err) {
    req.log.warn({ err }, "[chorus] test du raccordement en echec");
    erreurChorus(res, err, "Le raccordement n'a pas pu etre verifie.");
  }
});

router.post("/chorus-pro/structure", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const r = await raccordementChorusDe(getOrgId(req));
  if (!r) { res.status(404).json({ error: "Aucun raccordement Chorus Pro." }); return; }
  const siret = typeof req.body?.siret === "string" ? req.body.siret : "";
  try {
    res.json(await rechercherStructure(r, siret));
  } catch (err) {
    req.log.warn({ err }, "[chorus] recherche de structure en echec");
    erreurChorus(res, err, "La structure n'a pas pu etre recherchee.");
  }
});

router.post("/factures-client/:id/chorus", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID invalide." }); return; }

  const [facture] = await db.select().from(facturesClientTable)
    .where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
  if (!facture) { res.status(404).json({ error: "Facture non trouvee." }); return; }
  // Un brouillon n'est pas une facture : son numero peut encore changer.
  if (!isIssued(facture.status)) { res.status(409).json({ error: "Seule une facture emise peut etre deposee." }); return; }
  // Deja deposee et non rejetee : la redeposer creerait un doublon chez l'acheteur.
  if (facture.chorusNumeroFlux && !/REJET/i.test(facture.chorusEtat ?? "")) {
    res.status(409).json({
      error: "Cette facture a deja ete deposee sur Chorus Pro.",
      numeroFluxDepot: facture.chorusNumeroFlux, etat: facture.chorusEtat,
    });
    return;
  }
  const r = await raccordementChorusDe(orgId);
  if (!r) { res.status(409).json({ error: "Aucun raccordement Chorus Pro. Renseignez-le dans les parametres." }); return; }

  try {
    const { pdf } = await pdfFacturX(facture, orgId);
    const depot = await deposerFluxFacture(r, pdf, invoiceFileName(facture.reference));
    await db.update(facturesClientTable).set({
      chorusNumeroFlux: depot.numeroFluxDepot,
      chorusEtat: "DEPOSE",
      chorusDeposeeLe: new Date(),
    }).where(and(eq(facturesClientTable.id, id), eq(facturesClientTable.organisationId, orgId)));
    res.status(202).json({ numeroFluxDepot: depot.numeroFluxDepot, etat: "DEPOSE" });
  } catch (err) {
    req.log.warn({ err, factureId: id }, "[chorus] depot de facture en echec");
    erreurChorus(res, err, "La facture n'a pas pu etre deposee sur Chorus Pro.");
  }
});

router.post("/chorus-pro/suivi", ADMIN, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const r = await raccordementChorusDe(orgId);
  if (!r) { res.status(404).json({ error: "Aucun raccordement Chorus Pro." }); return; }

  // Seules les factures deposees dont l'etat n'est pas encore definitif.
  const enCours = await db.select().from(facturesClientTable).where(and(
    eq(facturesClientTable.organisationId, orgId),
    isNotNull(facturesClientTable.chorusNumeroFlux),
    or(isNull(facturesClientTable.chorusEtat), eq(facturesClientTable.chorusEtat, "DEPOSE")),
  ));

  let misesAJour = 0;
  for (const facture of enCours) {
    try {
      const cr = await consulterCompteRendu(r, facture.chorusNumeroFlux!, facture.chorusDeposeeLe?.toISOString().slice(0, 10));
      if (!cr.etatCourantFlux || cr.etatCourantFlux === facture.chorusEtat) continue;
      await db.update(facturesClientTable).set({ chorusEtat: cr.etatCourantFlux })
        .where(and(eq(facturesClientTable.id, facture.id), eq(facturesClientTable.organisationId, orgId)));
      misesAJour += 1;
    } catch (err) {
      // Une facture illisible n'interrompt pas le suivi des autres : le
      // silence sur une seule vaut mieux qu'un suivi qui s'arrete au premier
      // incident et laisse tout le reste perime.
      req.log.warn({ err, factureId: facture.id }, "[chorus] compte rendu illisible");
    }
  }
  res.json({ misesAJour, examinees: enCours.length });
});

export default router;
