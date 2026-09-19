/**
 * Journal des reglements: enregistrer, corriger, prouver.
 *
 * Trois routes, et la troisieme est celle qui compte lors d'un controle.
 *
 *   POST /encaissements            enregistre un reglement (ajout seul)
 *   POST /encaissements/annuler    contre-passe une ecriture (ajout seul)
 *   GET  /encaissements/verifier   refait tout le calcul et dit si la chaine tient
 *
 * Il n'existe deliberement NI PATCH NI DELETE. Ce n'est pas un oubli: le 3° bis
 * du I de l'article 286 du CGI exige l'inalterabilite des donnees de reglement,
 * et une route de modification la rendrait impossible a affirmer, quels que
 * soient les controles poses autour. Une correction s'ecrit, elle ne s'efface
 * pas.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, cloturesComptablesTable, encaissementsTable, facturesClientTable, organisationsTable } from "@workspace/db";

import { getOrgId } from "../middleware/tenant";
import { requireRole } from "../middleware/auth";
import { logAudit } from "./audit";
import {
  preparerEcriture,
  soldeFacture,
  verifierChaine,
  type EcritureChainee,
} from "../services/chainage-encaissements";
import { calculerCloture, periodeClose, verifierConservation } from "../services/cloture-comptable";
import { enregistrerEncaissement } from "../services/encaissement-enregistrement";
import { deriveInvoiceStatus } from "../services/invoice-status";
import { construireArchive, nomArchive } from "../services/archivage-comptable";
import { nomAttestation, redigerAttestation } from "../services/attestation-conformite";

const router: IRouter = Router();


/**
 * Qui peut toucher au journal de caisse.
 *
 * Mesure du 19/09: aucune garde de role propre. Le plancher global
 * (`requireMutationRole`, routes/index.ts) empechait bien `lecture_seule`
 * d ECRIRE, mais il laisse passer GET par construction: n importe quel compte
 * de l organisation pouvait telecharger l archive comptable et l attestation,
 * c est-a-dire l integralite des reglements. Et le plancher s arretant a
 * « agent ou plus », un agent pouvait contre-passer une ecriture et CLOTURER
 * une periode — operation irreversible par construction.
 *
 * L encaissement reste ouvert aux agents: constater un reglement sur un
 * chantier fait partie de leur travail. Tout le reste remonte au
 * responsable: une contre-passation marque le journal de facon definitive,
 * une cloture ne se defait pas, et l archive comme l attestation sont les
 * pieces qu on remet a un controleur — elles contiennent l integralite des
 * reglements de l organisation.
 */
const encaisseur = requireRole("super_admin", "administrateur", "agent");
const responsableComptable = requireRole("super_admin", "administrateur");

const MOYENS = ["especes", "virement", "cheque", "carte", "prelevement", "autre"] as const;

/**
 * Moyen reserve a la reprise d'anteriorite. Il ne figure pas dans MOYENS: on ne
 * doit pas pouvoir le choisir a la saisie, sinon un encaissement ordinaire
 * pourrait se deguiser en solde reporte.
 */
const MOYEN_REPRISE = "reprise";

/** Convertit les lignes de la base en ecritures chainables. */
function enEcritures(lignes: (typeof encaissementsTable.$inferSelect)[]): EcritureChainee[] {
  return lignes.map((l) => ({
    numero: l.numero,
    organisationId: l.organisationId,
    factureId: l.factureId,
    montantCentimes: l.montantCentimes,
    devise: l.devise,
    moyen: l.moyen,
    // L'horodatage entre dans l'empreinte: il doit ressortir de la base sous
    // exactement la meme forme qu'a l'ecriture, sinon le recalcul echoue sur
    // une difference de format et non sur une falsification.
    dateEncaissement: l.dateEncaissement.toISOString(),
    sens: l.sens as "encaissement" | "annulation",
    annuleNumero: l.annuleNumero,
    empreintePrecedente: l.empreintePrecedente,
    empreinte: l.empreinte,
  }));
}

/**
 * Ce dont la fonction a besoin: lire et mettre a jour. Type STRUCTUREL, pour
 * qu'une transaction Drizzle passe sans `as` — un `as` est un controle qu'on
 * desactive, et il n'a rien a faire sur le chemin d'une ecriture comptable.
 */
type Executeur = Pick<typeof db, "select" | "update">;

/** Le montant encaisse, recalcule depuis le journal et remis dans le cache d'affichage. */
async function rafraichirCache(orgId: number, factureId: number, tx: Executeur = db) {
  const lignes = await tx.select().from(encaissementsTable)
    .where(and(eq(encaissementsTable.organisationId, orgId), eq(encaissementsTable.factureId, factureId)))
    .orderBy(encaissementsTable.numero);
  const centimes = soldeFacture(enEcritures(lignes), factureId);

  // Le STATUT suit lui aussi la chaine, et dans les deux sens.
  //
  // Seul `paidAmount` etait reecrit ici. Apres une contre-passation, la
  // facture restait donc « payee » alors que le journal ne portait plus aucun
  // reglement: elle sortait du filtre des impayes, cessait d'etre relancee, et
  // le montant disparaissait des tableaux de bord — le contraire exact de ce
  // qu'une annulation est censee produire.
  const [avant] = await tx.select({
    status: facturesClientTable.status,
    totalAmount: facturesClientTable.totalAmount,
    dueDate: facturesClientTable.dueDate,
  }).from(facturesClientTable)
    .where(and(eq(facturesClientTable.id, factureId), eq(facturesClientTable.organisationId, orgId)));

  const paye = (centimes / 100).toFixed(2);
  let statut: string | null = null;
  if (avant) {
    statut = deriveInvoiceStatus({
      status: avant.status,
      totalAmount: avant.totalAmount,
      paidAmount: paye,
      dueDate: avant.dueDate,
    });
    // `deriveInvoiceStatus` ne rend rien quand le reglement ne dicte plus le
    // statut. Une facture « payee » qui ne l'est plus doit pourtant repartir:
    // on la remet a l'etat emis, que l'echeance pourra rebasculer.
    if (!statut && avant.status === "payee" && Number(paye) < Number(avant.totalAmount)) {
      statut = "envoyee";
    }
  }

  await tx.update(facturesClientTable)
    .set({
      paidAmount: paye,
      ...(statut ? { status: statut } : {}),
      ...(statut && statut !== "payee" ? { paidAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(facturesClientTable.id, factureId), eq(facturesClientTable.organisationId, orgId)));
}

router.post("/encaissements", encaisseur, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { factureId, montant, moyen, dateEncaissement } = req.body ?? {};

  const centimes = Math.round(Number(montant) * 100);
  if (!Number.isFinite(centimes) || centimes <= 0) {
    res.status(400).json({ error: "Montant invalide: un encaissement est strictement positif." });
    return;
  }
  if (!MOYENS.includes(moyen)) {
    res.status(400).json({ error: `Moyen de paiement invalide (${MOYENS.join(", ")}).` });
    return;
  }
  const quand = dateEncaissement ? new Date(dateEncaissement) : new Date();
  if (Number.isNaN(quand.getTime())) {
    res.status(400).json({ error: "Date d'encaissement invalide." });
    return;
  }
  // Un encaissement est un fait CONSTATE: il ne se date pas dans l'avenir.
  // Mesure du 18/09 sur le banc: une date en 2090 etait acceptee, et entrait
  // dans la chaine d'empreintes — donc impossible a corriger autrement que par
  // une ecriture d'annulation. La tolerance d'un jour absorbe les decalages de
  // fuseau d'un client qui saisit « aujourd'hui » depuis un autre continent.
  if (quand.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    res.status(400).json({ error: "Date d'encaissement dans le futur: un encaissement se constate, il ne s'annonce pas." });
    return;
  }
  // Un encaissement superieur au reste a payer est presque toujours une faute
  // de frappe (1000 pour 100). Il reste possible — un client paie parfois trop
  // — mais il doit etre VOULU: sans `forcer`, on refuse en disant le reste du.
  const forcer = req.body?.forcer === true;

  try {
    // L ECRITURE VIT DANS UN SERVICE (services/encaissement-enregistrement.ts).
    //
    // Elle etait ecrite ici, et les routes d administration ecrivaient de leur
    // cote le cache paidAmount sans creer aucune ecriture — donc un reglement
    // que la chaine ignorait, et que le prochain encaissement effacait. Une
    // seule facon d encaisser, pour toutes les portes.
    const resultat = await enregistrerEncaissement({
      organisationId: orgId,
      factureId: Number(factureId),
      montantCentimes: centimes,
      moyen,
      quand,
      forcer,
      createdBy: req.session?.userId ?? null,
    });

    if (!resultat.ok && resultat.code === "facture_introuvable") { res.status(404).json({ error: "Facture introuvable." }); return; }
    if (!resultat.ok && resultat.code === "depasse_reste_a_payer") {
      const resteCentimes = resultat.resteCentimes;
      res.status(409).json({
        error: resteCentimes === 0
          ? "Cette facture est deja entierement reglee."
          : `Ce montant depasse le reste a payer (${(resteCentimes / 100).toFixed(2)}).`,
        resteAPayer: (resteCentimes / 100).toFixed(2),
        code: "depasse_reste_a_payer",
        remediation: "Corrigez le montant, ou renvoyez la demande avec `forcer: true` s il s agit reellement d un trop-percu.",
      });
      return;
    }
    if (!resultat.ok) {
      res.status(409).json({
        error: `La periode ${resultat.periode} est close: aucun encaissement ne peut y etre ajoute.`,
        remediation: "Enregistrez l encaissement a sa date reelle, ou passez par une ecriture sur la periode ouverte.",
      });
      return;
    }

    await logAudit(req.session?.userId, req.session?.userEmail, "encaissement_enregistre",
      "encaissement", String(resultat.numero),
      { factureId: Number(factureId), montantCentimes: centimes, moyen }, req.ip, req.get("user-agent"), orgId);

    res.status(201).json({ numero: resultat.numero, empreinte: resultat.empreinte });
  } catch (err: any) {
    req.log.error({ err }, "Erreur enregistrement encaissement");
    res.status(500).json({ error: "Erreur lors de l enregistrement." });
  }
});

router.post("/encaissements/annuler", responsableComptable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const numero = Number(req.body?.numero);
  if (!Number.isInteger(numero) || numero < 1) {
    res.status(400).json({ error: "Numero d'ecriture invalide." });
    return;
  }

  try {
    const resultat = await db.transaction(async (tx) => {
      const [cible] = await tx.select().from(encaissementsTable)
        .where(and(eq(encaissementsTable.organisationId, orgId), eq(encaissementsTable.numero, numero)));
      if (!cible) return { erreur: "Ecriture introuvable." as const };
      if (cible.sens === "annulation") return { erreur: "Une annulation ne s'annule pas." as const };

      // Une ecriture ne se contre-passe qu'UNE fois.
      //
      // Rien ne l'empechait. Le solde, lui, ne bougeait pas — `soldeFacture`
      // ecarte les numeros annules par un ensemble, donc annuler deux fois
      // donne le meme montant qu'annuler une fois. C'est precisement ce qui
      // rendait le defaut invisible: aucun total ne s'en plaignait.
      //
      // Le journal, lui, gardait deux contre-passations pour un seul
      // reglement. Il est en AJOUT SEUL et chaine: ces lignes ne se retirent
      // pas, elles consomment des numeros de sequence, et l'archive remise a
      // un controleur montre deux annulations du meme encaissement — ce qui
      // ressemble exactement a ce que l'inalterabilite est censee empecher.
      const [dejaAnnulee] = await tx.select({ numero: encaissementsTable.numero })
        .from(encaissementsTable)
        .where(and(
          eq(encaissementsTable.organisationId, orgId),
          eq(encaissementsTable.sens, "annulation"),
          eq(encaissementsTable.annuleNumero, cible.numero),
        )).limit(1);
      if (dejaAnnulee) return { erreur: "Cette ecriture est deja annulee." as const };

      // Une periode close refuse la contre-passation comme elle refuse
      // l'encaissement: une cloture qui fige un cumul que l'on peut encore
      // diminuer ne fige rien, et l'anti-fraude redeviendrait contournable.
      const cloturesConnues = await tx.select().from(cloturesComptablesTable)
        .where(eq(cloturesComptablesTable.organisationId, orgId));
      const periodeFermee = periodeClose(
        new Date().toISOString(),
        cloturesConnues.map((c) => ({
          organisationId: c.organisationId,
          type: c.type as "journaliere" | "mensuelle" | "annuelle",
          periode: c.periode,
          premierNumero: c.premierNumero,
          dernierNumero: c.dernierNumero,
          nbEcritures: c.nbEcritures,
          totalPeriodeCentimes: c.totalPeriodeCentimes,
          totalCumuleCentimes: c.totalCumuleCentimes,
          empreintePrecedente: c.empreintePrecedente,
          empreinte: c.empreinte,
        })),
      );
      if (periodeFermee) return { erreurPeriode: String(periodeFermee.periode) };

      const [derniere] = await tx.select().from(encaissementsTable)
        .where(eq(encaissementsTable.organisationId, orgId))
        .orderBy(desc(encaissementsTable.numero)).limit(1);

      const quand = new Date();
      const ecriture = preparerEcriture({
        organisationId: orgId,
        factureId: cible.factureId,
        // Le montant inverse: la contre-passation dit ce qu'elle retire.
        montantCentimes: -cible.montantCentimes,
        devise: cible.devise,
        moyen: cible.moyen,
        dateEncaissement: quand.toISOString(),
        sens: "annulation",
        annuleNumero: cible.numero,
      }, derniere ? { numero: derniere.numero, empreinte: derniere.empreinte } : null);

      await tx.insert(encaissementsTable).values({
        organisationId: ecriture.organisationId,
        numero: ecriture.numero,
        factureId: ecriture.factureId,
        montantCentimes: ecriture.montantCentimes,
        devise: ecriture.devise,
        moyen: ecriture.moyen,
        dateEncaissement: quand,
        sens: ecriture.sens,
        annuleNumero: ecriture.annuleNumero,
        empreintePrecedente: ecriture.empreintePrecedente,
        empreinte: ecriture.empreinte,
        createdBy: req.session?.userId ?? null,
      });

      if (cible.factureId) await rafraichirCache(orgId, cible.factureId, tx);
      return { numero: ecriture.numero, annule: cible.numero };
    });

    if ("erreur" in resultat) { res.status(400).json({ error: resultat.erreur }); return; }
    if ("erreurPeriode" in resultat) {
      res.status(409).json({
        error: `La periode ${resultat.erreurPeriode} est close: aucune contre-passation ne peut y etre ajoutee.`,
        remediation: "Corrigez par une ecriture sur la periode ouverte.",
      });
      return;
    }

    await logAudit(req.session?.userId, req.session?.userEmail, "encaissement_annule",
      "encaissement", String(resultat.numero), { annuleNumero: resultat.annule },
      req.ip, req.get("user-agent"), orgId);

    res.status(201).json(resultat);
  } catch (err: any) {
    req.log.error({ err }, "Erreur annulation encaissement");
    res.status(500).json({ error: "Erreur lors de l'annulation." });
  }
});

/**
 * Refait tout le calcul et dit si la chaine tient.
 *
 * C'est la route qu'on montre a un controleur, et celle qu'il faut pouvoir
 * lancer soi-meme avant qu'il n'arrive. Elle ne prouve pas que les montants
 * sont justes — elle prouve qu'ils n'ont pas ete modifies apres coup, ce qui
 * est exactement ce que demande l'inalterabilite.
 */
router.get("/encaissements/verifier", responsableComptable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const lignes = await db.select().from(encaissementsTable)
      .where(eq(encaissementsTable.organisationId, orgId))
      .orderBy(encaissementsTable.numero);

    const verdict = verifierChaine(enEcritures(lignes), orgId);

    await logAudit(req.session?.userId, req.session?.userEmail, "journal_reglements_verifie",
      "encaissement", undefined, { intacte: verdict.intacte, verifiees: verdict.verifiees },
      req.ip, req.get("user-agent"), orgId);

    res.json({
      ...verdict,
      total: lignes.length,
      fondement: "Article 286-I-3° bis du CGI — inalterabilite des donnees de reglement.",
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur verification journal des reglements");
    res.status(500).json({ error: "Erreur lors de la verification." });
  }
});

/**
 * Clot une periode: fige le total cumule et scelle la cloture.
 *
 * Une cloture ne se defait pas. C'est le point: un cumul qu'on pourrait
 * rouvrir ne fige rien, et la condition de conservation de l'article
 * 286-I-3° bis ne serait plus satisfaite.
 */
router.post("/encaissements/cloturer", responsableComptable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const type = String(req.body?.type ?? "journaliere") as "journaliere" | "mensuelle" | "annuelle";
  if (!["journaliere", "mensuelle", "annuelle"].includes(type)) {
    res.status(400).json({ error: "Type de cloture invalide (journaliere, mensuelle, annuelle)." });
    return;
  }
  const periode = String(req.body?.periode ?? "");
  // `\d`, pas `d`: les antislashs avaient disparu de ces deux expressions, qui
  // ne reconnaissaient donc plus que les chaines litterales « dddd »,
  // « dddd-dd » et « dddd-dd-dd ». Mesure du 18/09: « 2026-09 » etait refuse.
  // Autrement dit, AUCUNE periode reelle ne pouvait etre close — la cloture,
  // qui est la condition de conservation de l'article 286-I-3° bis du CGI,
  // etait injoignable, et le seul message rendu disait « Periode invalide ».
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(periode)) {
    res.status(400).json({ error: "Periode invalide (AAAA, AAAA-MM ou AAAA-MM-JJ)." });
    return;
  }

  try {
    const resultat = await db.transaction(async (tx) => {
      const [existante] = await tx.select().from(cloturesComptablesTable)
        .where(and(
          eq(cloturesComptablesTable.organisationId, orgId),
          eq(cloturesComptablesTable.type, type),
          eq(cloturesComptablesTable.periode, periode),
        ));
      if (existante) return { deja: existante.empreinte as string };

      const lignes = await tx.select().from(encaissementsTable)
        .where(eq(encaissementsTable.organisationId, orgId))
        .orderBy(encaissementsTable.numero);

      const [precedente] = await tx.select().from(cloturesComptablesTable)
        .where(and(eq(cloturesComptablesTable.organisationId, orgId), eq(cloturesComptablesTable.type, type)))
        .orderBy(desc(cloturesComptablesTable.periode)).limit(1);

      const cloture = calculerCloture(orgId, type, periode, enEcritures(lignes),
        precedente ? {
          organisationId: precedente.organisationId,
          type: precedente.type as "journaliere" | "mensuelle" | "annuelle",
          periode: precedente.periode,
          premierNumero: precedente.premierNumero,
          dernierNumero: precedente.dernierNumero,
          nbEcritures: precedente.nbEcritures,
          totalPeriodeCentimes: precedente.totalPeriodeCentimes,
          totalCumuleCentimes: precedente.totalCumuleCentimes,
          empreintePrecedente: precedente.empreintePrecedente,
          empreinte: precedente.empreinte,
        } : null);

      await tx.insert(cloturesComptablesTable).values({
        organisationId: cloture.organisationId,
        type: cloture.type,
        periode: cloture.periode,
        premierNumero: cloture.premierNumero,
        dernierNumero: cloture.dernierNumero,
        nbEcritures: cloture.nbEcritures,
        totalPeriodeCentimes: cloture.totalPeriodeCentimes,
        totalCumuleCentimes: cloture.totalCumuleCentimes,
        empreintePrecedente: cloture.empreintePrecedente,
        empreinte: cloture.empreinte,
        clotureePar: req.session?.userId ?? null,
      });

      return { cloture };
    });

    if ("deja" in resultat) {
      // Une periode close le reste: on ne la reclot pas, et on ne renvoie pas
      // d'erreur non plus — l'appelant voulait qu'elle soit close, elle l'est.
      res.json({ deja: true, empreinte: resultat.deja });
      return;
    }

    await logAudit(req.session?.userId, req.session?.userEmail, "cloture_comptable",
      "cloture", `${type}:${periode}`,
      { nbEcritures: resultat.cloture.nbEcritures, totalCumuleCentimes: resultat.cloture.totalCumuleCentimes },
      req.ip, req.get("user-agent"), orgId);

    res.status(201).json(resultat.cloture);
  } catch (err: any) {
    req.log.error({ err }, "Erreur cloture comptable");
    res.status(500).json({ error: "Erreur lors de la cloture." });
  }
});

/**
 * Confronte les clotures au journal: detecte une SUPPRESSION d'ecriture.
 *
 * La verification de la chaine (/encaissements/verifier) detecte une
 * modification. Celle-ci detecte ce qu'elle laisse passer: des ecritures
 * retirees de la fin du journal, qui laissent une chaine parfaitement valide.
 */
router.get("/encaissements/conservation", responsableComptable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const type = String(req.query.type ?? "journaliere") as "journaliere" | "mensuelle" | "annuelle";
  try {
    const lignes = await db.select().from(encaissementsTable)
      .where(eq(encaissementsTable.organisationId, orgId))
      .orderBy(encaissementsTable.numero);
    const clotures = await db.select().from(cloturesComptablesTable)
      .where(and(eq(cloturesComptablesTable.organisationId, orgId), eq(cloturesComptablesTable.type, type)))
      .orderBy(cloturesComptablesTable.periode);

    const verdict = verifierConservation(
      clotures.map((c) => ({
        organisationId: c.organisationId,
        type: c.type as "journaliere" | "mensuelle" | "annuelle",
        periode: c.periode,
        premierNumero: c.premierNumero,
        dernierNumero: c.dernierNumero,
        nbEcritures: c.nbEcritures,
        totalPeriodeCentimes: c.totalPeriodeCentimes,
        totalCumuleCentimes: c.totalCumuleCentimes,
        empreintePrecedente: c.empreintePrecedente,
        empreinte: c.empreinte,
      })),
      enEcritures(lignes),
      orgId,
    );

    res.json({
      ...verdict,
      cloturesVerifiees: clotures.length,
      fondement: "Article 286-I-3° bis du CGI — conservation des donnees de reglement.",
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur verification conservation");
    res.status(500).json({ error: "Erreur lors de la verification." });
  }
});

/**
 * Produit l'archive d'une periode et la remet en telechargement.
 *
 * Le fichier est autonome: il porte les ecritures, les clotures, son empreinte,
 * et le MODE D'EMPLOI qui permet de tout recalculer a la main. Un controle peut
 * survenir six ans plus tard (art. L102 B du LPF): a cette date, l'editeur peut
 * avoir disparu. Une archive qui exigerait d'installer ce logiciel pour etre
 * lue ne serait pas une archive, ce serait une dependance.
 */
router.get("/encaissements/archive", responsableComptable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const type = String(req.query.type ?? "annuelle") as "journaliere" | "mensuelle" | "annuelle";
  const periode = String(req.query.periode ?? "");
  if (!["journaliere", "mensuelle", "annuelle"].includes(type)) {
    res.status(400).json({ error: "Type de periode invalide." });
    return;
  }
  // Meme antislash perdu qu'a la cloture: l'archive comptable — celle qu'on
  // remet a un controleur — etait tout aussi injoignable.
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(periode)) {
    res.status(400).json({ error: "Periode invalide (AAAA, AAAA-MM ou AAAA-MM-JJ)." });
    return;
  }

  try {
    const lignes = await db.select().from(encaissementsTable)
      .where(eq(encaissementsTable.organisationId, orgId))
      .orderBy(encaissementsTable.numero);
    const clotures = await db.select().from(cloturesComptablesTable)
      .where(and(eq(cloturesComptablesTable.organisationId, orgId), eq(cloturesComptablesTable.type, type)))
      .orderBy(cloturesComptablesTable.periode);

    const archive = construireArchive(
      orgId, type, periode,
      enEcritures(lignes),
      clotures.map((c) => ({
        organisationId: c.organisationId,
        type: c.type as "journaliere" | "mensuelle" | "annuelle",
        periode: c.periode,
        premierNumero: c.premierNumero,
        dernierNumero: c.dernierNumero,
        nbEcritures: c.nbEcritures,
        totalPeriodeCentimes: c.totalPeriodeCentimes,
        totalCumuleCentimes: c.totalCumuleCentimes,
        empreintePrecedente: c.empreintePrecedente,
        empreinte: c.empreinte,
      })),
      new Date().toISOString(),
    );

    // L'empreinte est journalisee: elle permet, plus tard, de confirmer qu'un
    // fichier presente est bien celui qui a ete produit ce jour-la.
    await logAudit(req.session?.userId, req.session?.userEmail, "archive_reglements_produite",
      "archive", `${type}:${periode}`,
      { empreinte: archive.empreinte, nbEcritures: archive.nbEcritures, octets: archive.octets },
      req.ip, req.get("user-agent"), orgId);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nomArchive(orgId, type, periode)}"`);
    // L'empreinte voyage aussi en en-tete: on peut la noter sans ouvrir le
    // fichier, et la comparer plus tard.
    res.setHeader("X-Archive-Empreinte", archive.empreinte);
    res.send(archive.contenu);
  } catch (err: any) {
    req.log.error({ err }, "Erreur production archive");
    res.status(500).json({ error: "Erreur lors de la production de l'archive." });
  }
});

/**
 * Remet au client son attestation de conformite.
 *
 * C'est la piece qu'il devra produire en cas de controle, et celle qui le
 * protege de l'amende de 7 500 € prevue pour l'usage d'un logiciel non
 * conforme. Elle est nominative: une attestation generique ne prouverait rien
 * sur l'exemplaire installe chez lui.
 *
 * Le texte est genere a partir de l'identite reelle de l'organisation, pas
 * saisi a la main: une attestation dont le beneficiaire serait mal orthographie
 * perdrait sa valeur au moment ou elle sert.
 */
router.get("/encaissements/attestation", responsableComptable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const [org] = await db.select({
      name: organisationsTable.name,
      siret: organisationsTable.siret,
    }).from(organisationsTable).where(eq(organisationsTable.id, orgId));
    if (!org) { res.status(404).json({ error: "Organisation introuvable." }); return; }

    const emiseLe = new Date().toISOString();
    const client = { raisonSociale: org.name ?? `Organisation ${orgId}`, siret: org.siret ?? null };
    const texte = redigerAttestation({
      editeur: {
        raisonSociale: process.env.EDITEUR_RAISON_SOCIALE ?? "Ajant Bureau",
        siret: process.env.EDITEUR_SIRET ?? null,
        adresse: process.env.EDITEUR_ADRESSE ?? null,
      },
      client,
      logiciel: "Ajant Bureau",
      version: process.env.BUILD_SHA ?? "dev",
      emiseLe,
    });

    await logAudit(req.session?.userId, req.session?.userEmail, "attestation_conformite_emise",
      "attestation", emiseLe.slice(0, 10), { version: process.env.BUILD_SHA ?? "dev" },
      req.ip, req.get("user-agent"), orgId);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nomAttestation(client, emiseLe)}"`);
    res.send(texte);
  } catch (err: any) {
    req.log.error({ err }, "Erreur emission attestation");
    res.status(500).json({ error: "Erreur lors de l'emission de l'attestation." });
  }
});

/**
 * Reprise d'anteriorite: faire entrer dans le journal ce qui etait deja encaisse.
 *
 * Le journal commence vide, alors que des factures portent deja un montant
 * regle dans l'ancienne colonne. Deux mauvaises reponses, et une bonne.
 *
 * MAUVAISE 1 — ne rien faire. Les soldes disparaitraient du journal, les
 * factures apparaitraient impayees, et le cumul des clotures serait faux des
 * le premier jour.
 *
 * MAUVAISE 2 — fabriquer une ecriture par paiement passe, avec une date et un
 * moyen inventes. Un journal dont les premieres lignes sont de la fiction ne
 * vaut rien: il affirmerait des faits qu'on ne connait pas, dans le document
 * meme qui sert a prouver qu'on n'invente pas.
 *
 * BONNE — l'a-nouveau, comme en comptabilite: UNE ecriture par facture, datee
 * du jour de la reprise, portant le moyen `reprise`, qui dit exactement ce
 * qu'on sait — « a cette date, ce montant etait deja encaisse » — et rien de
 * plus. Elle n'usurpe aucune date et ne pretend a aucun moyen de paiement.
 *
 * Idempotente: une facture deja reprise ne l'est pas deux fois.
 */
router.post("/encaissements/reprise", responsableComptable, async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const resultat = await db.transaction(async (tx) => {
      // Factures portant un montant regle non nul.
      const factures = await tx.select({
        id: facturesClientTable.id,
        paidAmount: facturesClientTable.paidAmount,
        devise: facturesClientTable.currency,
      }).from(facturesClientTable)
        .where(eq(facturesClientTable.organisationId, orgId));

      // Celles qui ont deja une ecriture de reprise: on ne reprend pas deux fois.
      const dejaReprises = new Set(
        (await tx.select({ factureId: encaissementsTable.factureId })
          .from(encaissementsTable)
          .where(and(
            eq(encaissementsTable.organisationId, orgId),
            eq(encaissementsTable.moyen, MOYEN_REPRISE),
          ))).map((r) => r.factureId),
      );

      const [derniere] = await tx.select().from(encaissementsTable)
        .where(eq(encaissementsTable.organisationId, orgId))
        .orderBy(desc(encaissementsTable.numero)).limit(1);

      let precedent = derniere ? { numero: derniere.numero, empreinte: derniere.empreinte } : null;
      const quand = new Date();
      let creees = 0;
      let totalCentimes = 0;

      for (const f of factures) {
        if (dejaReprises.has(f.id)) continue;
        const centimes = Math.round(Number(f.paidAmount ?? 0) * 100);
        if (!Number.isFinite(centimes) || centimes <= 0) continue;

        const ecriture = preparerEcriture({
          organisationId: orgId,
          factureId: f.id,
          montantCentimes: centimes,
          devise: f.devise ?? "EUR",
          moyen: MOYEN_REPRISE,
          dateEncaissement: quand.toISOString(),
          sens: "encaissement",
          annuleNumero: null,
        }, precedent);

        await tx.insert(encaissementsTable).values({
          organisationId: ecriture.organisationId,
          numero: ecriture.numero,
          factureId: ecriture.factureId,
          montantCentimes: ecriture.montantCentimes,
          devise: ecriture.devise,
          moyen: ecriture.moyen,
          dateEncaissement: quand,
          sens: ecriture.sens,
          annuleNumero: ecriture.annuleNumero,
          empreintePrecedente: ecriture.empreintePrecedente,
          empreinte: ecriture.empreinte,
          createdBy: req.session?.userId ?? null,
        });

        precedent = { numero: ecriture.numero, empreinte: ecriture.empreinte };
        creees += 1;
        totalCentimes += centimes;
      }

      return { creees, totalCentimes, facturesExaminees: factures.length };
    });

    await logAudit(req.session?.userId, req.session?.userEmail, "reprise_anteriorite",
      "encaissement", undefined, resultat, req.ip, req.get("user-agent"), orgId);

    res.json({
      ...resultat,
      note: "Une ecriture de reprise par facture, datee du jour, moyen « reprise ». " +
        "Aucune date ni aucun moyen de paiement passe n'a ete invente.",
    });
  } catch (err: any) {
    req.log.error({ err }, "Erreur reprise d'anteriorite");
    res.status(500).json({ error: "Erreur lors de la reprise." });
  }
});

export default router;
