/**
 * LE DOSSIER DU CHANTIER, L'AVENANT, LE JOURNAL ET LA COMPARAISON PAR AFFAIRE.
 *
 * (Plan du 29/09, sections 6 et 8.)
 *
 * Ressource TENANT : chaque requete est bornee a l'organisation de la session
 * (`getOrgId`), jamais a un `organisationId` choisi par l'appelant. Un numero
 * de chantier d'une autre organisation rend 404 — pas 403 : dire « existe mais
 * pas pour vous » apprend a un inconnu quels numeros existent.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db, avenantsTable, calendarEventsTable, callsTable, devisTable, documentsTable, journalChantierTable, projetsTable,
} from "@workspace/db";
import { getOrgId } from "../middleware/tenant";
import { generateUniqueReference } from "../lib/unique-reference";
import { computeInvoiceTotals, isValidCurrency, parseUserDate } from "../services/invoice-totals";
import {
  avenantExistant, comparaisonParAffaire, dossierChantier, estMarcheInitial, montantsDuChantier,
} from "../services/dossier-chantier";
import { logAudit } from "./audit";
import { archiveDeletedRows, deletionContext } from "../services/trash";

const router: IRouter = Router();

function numero(v: unknown): number | null {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** AAAA-MM-JJ, et une date qui existe vraiment (2026-02-31 est refusee). */
function jourValide(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (s.length !== 10 || s[4] !== "-" || s[7] !== "-") return null;
  const [a, m, j] = s.split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(a) || !Number.isFinite(m) || !Number.isFinite(j)) return null;
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  return s;
}

/** Le chantier existe-t-il DANS cette organisation ? */
async function chantierDeLOrganisation(orgId: number, projetId: number) {
  const [p] = await db
    .select({ id: projetsTable.id, title: projetsTable.title, currency: projetsTable.currency, contactId: projetsTable.contactId, clientName: projetsTable.clientName, clientCompany: projetsTable.clientCompany, clientAddress: projetsTable.address, prospectId: projetsTable.prospectId })
    .from(projetsTable)
    .where(and(eq(projetsTable.id, projetId), eq(projetsTable.organisationId, orgId)))
    .limit(1);
  return p ?? null;
}

/**
 * Le dossier complet : la fiche, les cinq montants avec leurs sources, et le
 * contenu des onglets. UNE requete HTTP pour tout l'ecran — huit onglets qui
 * chargent chacun le leur, ce sont huit chances d'en voir un vide sans savoir
 * si c'est un vide ou une panne.
 */
router.get("/projets/:id/dossier", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = numero(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const dossier = await dossierChantier(orgId, id);
    if (!dossier) { res.status(404).json({ error: "Chantier non trouve." }); return; }
    res.json(dossier);
  } catch (err: any) {
    req.log.error({ err }, "Erreur lecture du dossier de chantier");
    res.status(500).json({ error: "Le dossier du chantier n'a pas pu etre lu." });
  }
});

/** Les montants seuls, quand l'appelant n'a pas besoin des onglets. */
router.get("/projets/:id/montants", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = numero(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const montants = await montantsDuChantier(orgId, id);
    if (!montants) { res.status(404).json({ error: "Chantier non trouve." }); return; }
    res.json({ montants });
  } catch (err: any) {
    req.log.error({ err }, "Erreur lecture des montants du chantier");
    res.status(500).json({ error: "Les montants n'ont pas pu etre lus." });
  }
});

/**
 * LA COMPARAISON PAR AFFAIRE (section 8).
 *
 * Un tableau : par chantier, le prix accepte, les avenants accordes, la depense
 * reelle, le facture et l'encaisse. C'est la seule vue d'ou l'on voit qu'un
 * chantier livre n'a jamais ete facture — la perte la plus courante, et la plus
 * invisible, parce qu'aucun ecran ne mettait les deux chiffres cote a cote.
 */
router.get("/finance/affaires", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  try {
    const lignes = await comparaisonParAffaire(orgId);
    res.json({ lignes, adet: lignes.length });
  } catch (err: any) {
    req.log.error({ err }, "Erreur comparaison par affaire");
    res.status(500).json({ error: "La comparaison n'a pas pu etre calculee." });
  }
});

/**
 * OUVRIR UN AVENANT : chiffrer des travaux supplementaires sur un chantier.
 *
 * Cree un DEVIS en brouillon et le rattache au chantier. Trois choses que cette
 * route ne fait pas, et c'est le coeur du sujet :
 *
 *  - elle ne touche PAS au devis initial. Le prix sur lequel le client s'est
 *    engage reste ce qu'il etait ; le supplement a son propre prix. C'etait le
 *    seul geste possible avant, et il effacait l'engagement ;
 *  - elle n'ajoute rien a l'engage du chantier. Un avenant en brouillon vaut
 *    zero ; il compte le jour ou SON devis est accepte. Le plan l'ecrit :
 *    « Ek iş, teklif ve onay olmadan ana sözleşmenin içine sessizce
 *    eklenmemeli » ;
 *  - elle n'envoie rien au client. L'envoi et l'acceptation restent les gestes
 *    existants du devis, avec leur trace nominative (`devis.acceptedBy`).
 */
router.post("/projets/:id/avenant", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const projetId = numero(req.params.id);
  if (projetId === null) { res.status(400).json({ error: "ID invalide." }); return; }

  const { title, motif, items, description, validUntil, notes, conditions, currency } = req.body ?? {};
  if (!String(title ?? "").trim()) { res.status(400).json({ error: "Le titre est obligatoire." }); return; }
  if (!String(motif ?? "").trim()) {
    res.status(400).json({
      error: "Le motif est obligatoire.",
      code: "motif_manquant",
      remediation: "Dites ce que le client a demande en plus, ou ce qui a ete decouvert : c'est ce qu'on oppose au client qui conteste a la reception.",
    });
    return;
  }
  const lignes = Array.isArray(items) ? items : [];
  if (lignes.length === 0) {
    res.status(400).json({
      error: "Un avenant sans ligne chiffree n'est pas un avenant.",
      code: "lignes_manquantes",
      remediation: "Ajoutez au moins une ligne : un supplement non chiffre ne peut pas etre accepte, donc ne sera pas payable.",
    });
    return;
  }
  const totaux = computeInvoiceTotals(lignes);
  if (totaux.overflow) { res.status(400).json({ error: "Montant trop eleve (depasse la limite autorisee)." }); return; }
  const validUntilDate = parseUserDate(validUntil);
  if (validUntilDate === undefined) { res.status(400).json({ error: "Date de validite invalide." }); return; }

  try {
    const projet = await chantierDeLOrganisation(orgId, projetId);
    if (!projet) { res.status(404).json({ error: "Chantier non trouve." }); return; }
    const devise = currency ?? projet.currency ?? "EUR";
    if (!isValidCurrency(devise)) { res.status(400).json({ error: "Devise invalide (code ISO 4217 attendu)." }); return; }
    // L'engage additionne les avenants au marche : 10 000 USD ajoutes a un
    // chantier en euros deviendraient 10 000 EUR. Une seule devise par chantier.
    if (devise !== projet.currency) {
      res.status(409).json({ error: "Un avenant est dans la devise du chantier.", code: "devise_differente", devise: projet.currency });
      return;
    }

    const existe = async (candidat: string): Promise<boolean> => {
      const [d] = await db.select({ id: devisTable.id }).from(devisTable)
        .where(and(eq(devisTable.organisationId, orgId), eq(devisTable.reference, candidat)));
      return !!d;
    };
    const reference = await generateUniqueReference("AVN", existe);

    // Le devis et son rattachement naissent ensemble. Sans transaction, un
    // echec entre les deux laisserait un devis orphelin qui ressemble a un
    // marche initial : il apparaitrait dans la liste des devis comme une
    // affaire nouvelle, et le chantier ignorerait son propre supplement.
    const cree = await db.transaction(async (tx) => {
      const [devis] = await tx.insert(devisTable).values({
        organisationId: orgId,
        reference,
        title: String(title).trim(),
        description: description ?? `Avenant au chantier « ${projet.title} »`,
        clientName: projet.clientName ?? projet.clientCompany ?? "Client",
        clientCompany: projet.clientCompany ?? null,
        clientAddress: projet.clientAddress ?? null,
        contactId: projet.contactId ?? null,
        prospectId: projet.prospectId ?? null,
        items: totaux.lines,
        subtotal: String(totaux.subtotal),
        taxAmount: String(totaux.taxAmount),
        totalAmount: String(totaux.totalAmount),
        currency: devise,
        status: "brouillon",
        validUntil: validUntilDate,
        notes: notes ?? null,
        conditions: conditions ?? null,
      }).returning();

      const [avenant] = await tx.insert(avenantsTable).values({
        organisationId: orgId,
        projetId,
        devisId: devis!.id,
        motif: String(motif).trim(),
        ouvertPar: req.session?.userId ?? null,
      }).returning();

      return { devis: devis!, avenant: avenant! };
    });

    await logAudit(
      req.session?.userId, req.session?.userEmail,
      "chantier.avenant_ouvert", "avenant", String(cree.avenant.id),
      { projetId, devisId: cree.devis.id, reference, montant: totaux.totalAmount },
      req.ip, req.get("user-agent"), orgId,
    ).catch(() => {});

    res.status(201).json({ avenant: cree.avenant, devis: cree.devis });
  } catch (err: any) {
    req.log.error({ err }, "Erreur ouverture d'un avenant");
    res.status(500).json({ error: "L'avenant n'a pas pu etre ouvert." });
  }
});

/**
 * Rattache un devis DEJA EXISTANT a un chantier comme avenant.
 *
 * Le cas reel : le devis du supplement a ete redige avant qu'on pense a le
 * rattacher. Refuse si ce devis est le marche initial d'un chantier (il serait
 * alors compte deux fois dans l'engage), ou s'il est deja l'avenant d'un autre.
 */
router.post("/projets/:id/avenant/rattacher", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const projetId = numero(req.params.id);
  const devisId = numero(req.body?.devisId);
  const motif = String(req.body?.motif ?? "").trim();
  if (projetId === null || devisId === null) { res.status(400).json({ error: "ID invalide." }); return; }
  if (!motif) { res.status(400).json({ error: "Le motif est obligatoire.", code: "motif_manquant" }); return; }
  try {
    const projet = await chantierDeLOrganisation(orgId, projetId);
    if (!projet) { res.status(404).json({ error: "Chantier non trouve." }); return; }
    const [devis] = await db.select({ id: devisTable.id, reference: devisTable.reference, status: devisTable.status, currency: devisTable.currency })
      .from(devisTable)
      .where(and(eq(devisTable.id, devisId), eq(devisTable.organisationId, orgId)))
      .limit(1);
    if (!devis) { res.status(404).json({ error: "Devis non trouve." }); return; }
    if (devis.currency !== projet.currency) {
      res.status(409).json({ error: "Un avenant est dans la devise du chantier.", code: "devise_differente", devise: projet.currency });
      return;
    }

    const marche = await estMarcheInitial(orgId, devisId);
    if (marche) {
      res.status(409).json({
        error: "Ce devis est le marche initial d'un chantier : il ne peut pas en etre aussi l'avenant.",
        code: "devis_est_marche_initial",
        projetId: marche.id,
      });
      return;
    }
    const deja = await avenantExistant(orgId, devisId);
    if (deja) {
      if (deja.projetId === projetId) { res.status(200).json({ avenant: deja, dejaRattache: true }); return; }
      res.status(409).json({
        error: "Ce devis est deja l'avenant d'un autre chantier.",
        code: "devis_deja_avenant",
        projetId: deja.projetId,
      });
      return;
    }

    let avenant;
    try {
      [avenant] = await db.insert(avenantsTable).values({
        organisationId: orgId, projetId, devisId, motif, ouvertPar: req.session?.userId ?? null,
      }).returning();
    } catch (err: any) {
      // Deux rattachements simultanes : `avenants_devis_uq` a garde le premier.
      const code = err?.code ?? err?.cause?.code;
      if (code !== "23505") throw err;
      const gagnant = await avenantExistant(orgId, devisId);
      if (!gagnant) throw err;
      res.status(200).json({ avenant: gagnant, dejaRattache: true });
      return;
    }

    await logAudit(
      req.session?.userId, req.session?.userEmail,
      "chantier.avenant_rattache", "avenant", String(avenant!.id),
      { projetId, devisId, reference: devis.reference, statutDevis: devis.status },
      req.ip, req.get("user-agent"), orgId,
    ).catch(() => {});
    res.status(201).json({ avenant });
  } catch (err: any) {
    req.log.error({ err }, "Erreur rattachement d'un avenant");
    res.status(500).json({ error: "Le rattachement n'a pas pu etre fait." });
  }
});

/** Retire le rattachement. Le devis reste : on defait un classement, pas un chiffrage. */
router.delete("/avenants/:id", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const id = numero(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const lignes = await db.delete(avenantsTable)
      .where(and(eq(avenantsTable.id, id), eq(avenantsTable.organisationId, orgId)))
      .returning();
    if (lignes.length === 0) { res.status(404).json({ error: "Avenant non trouve." }); return; }
    // A la corbeille, comme toute suppression d une table restaurable : un
    // detachement fait par erreur se reprend.
    await archiveDeletedRows(avenantsTable, lignes, deletionContext(req, orgId));
    await logAudit(
      req.session?.userId, req.session?.userEmail,
      "chantier.avenant_detache", "avenant", String(id),
      { projetId: lignes[0]!.projetId, devisId: lignes[0]!.devisId },
      req.ip, req.get("user-agent"), orgId,
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Erreur detachement d'un avenant");
    res.status(500).json({ error: "Le detachement n'a pas pu etre fait." });
  }
});

/**
 * LE JOURNAL DE CHANTIER : ecrire ce qui s'est passe un jour donne.
 *
 * Une note par chantier et par jour. Un second envoi pour le meme jour MET A
 * JOUR la note existante au lieu d'en creer une seconde : deux recits du meme
 * jour, ce sont deux versions concurrentes du meme fait, et c'est precisement
 * ce qu'on ne peut pas produire devant un differend.
 */
router.post("/projets/:id/journal", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const projetId = numero(req.params.id);
  if (projetId === null) { res.status(400).json({ error: "ID invalide." }); return; }
  const jour = jourValide(req.body?.jour);
  if (!jour) { res.status(400).json({ error: "Jour invalide (AAAA-MM-JJ attendu).", code: "jour_invalide" }); return; }
  const travaux = String(req.body?.travaux ?? "").trim();
  if (!travaux) {
    res.status(400).json({
      error: "Dites ce qui a ete fait : une note de journal sans travaux ne prouve rien.",
      code: "travaux_manquants",
    });
    return;
  }
  const effectifBrut = req.body?.effectif;
  let effectif: number | null = null;
  if (effectifBrut !== undefined && effectifBrut !== null && String(effectifBrut) !== "") {
    const n = Number.parseInt(String(effectifBrut), 10);
    if (!Number.isFinite(n) || n < 0 || n > 999) { res.status(400).json({ error: "Effectif invalide." }); return; }
    effectif = n;
  }

  try {
    const projet = await chantierDeLOrganisation(orgId, projetId);
    if (!projet) { res.status(404).json({ error: "Chantier non trouve." }); return; }

    // Une note ENTREE au journal (non brouillon) ne se reecrit que par son
    // auteur. Sinon le second envoi effacerait le recit du premier sans trace —
    // exactement ce que ce journal existe pour empecher.
    const [existante] = await db.select({ brouillon: journalChantierTable.brouillon, redigePar: journalChantierTable.redigePar })
      .from(journalChantierTable)
      .where(and(eq(journalChantierTable.projetId, projetId), eq(journalChantierTable.jour, jour), eq(journalChantierTable.organisationId, orgId)))
      .limit(1);
    if (existante && !existante.brouillon && existante.redigePar != null && existante.redigePar !== (req.session?.userId ?? null)) {
      res.status(409).json({
        error: "La note de ce jour est deja au journal, ecrite par une autre personne.",
        code: "note_verrouillee",
        remediation: "Demandez a son auteur de la completer, ou ajoutez vos observations dans une tache du chantier.",
      });
      return;
    }

    const valeurs = {
      organisationId: orgId,
      projetId,
      jour,
      meteo: req.body?.meteo ? String(req.body.meteo).trim() : null,
      effectif,
      travaux,
      incidents: req.body?.incidents ? String(req.body.incidents).trim() : null,
      observations: req.body?.observations ? String(req.body.observations).trim() : null,
      brouillon: req.body?.brouillon === true,
      redigePar: req.session?.userId ?? null,
    };

    const [note] = await db.insert(journalChantierTable).values(valeurs)
      .onConflictDoUpdate({
        target: [journalChantierTable.projetId, journalChantierTable.jour],
        set: {
          meteo: valeurs.meteo, effectif: valeurs.effectif, travaux: valeurs.travaux,
          incidents: valeurs.incidents, observations: valeurs.observations,
          brouillon: valeurs.brouillon, redigePar: valeurs.redigePar,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    await logAudit(
      req.session?.userId, req.session?.userEmail,
      "chantier.journal_ecrit", "journal_chantier", String(note!.id),
      { projetId, jour, brouillon: valeurs.brouillon },
      req.ip, req.get("user-agent"), orgId,
    ).catch(() => {});
    res.status(201).json({ note });
  } catch (err: any) {
    req.log.error({ err }, "Erreur ecriture du journal de chantier");
    res.status(500).json({ error: "La note n'a pas pu etre enregistree." });
  }
});

/** Les notes d'un chantier, la plus recente d'abord. */
router.get("/projets/:id/journal", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const projetId = numero(req.params.id);
  if (projetId === null) { res.status(400).json({ error: "ID invalide." }); return; }
  try {
    const projet = await chantierDeLOrganisation(orgId, projetId);
    if (!projet) { res.status(404).json({ error: "Chantier non trouve." }); return; }
    const notes = await db.select().from(journalChantierTable)
      .where(and(eq(journalChantierTable.projetId, projetId), eq(journalChantierTable.organisationId, orgId)))
      .orderBy(sql`${journalChantierTable.jour} desc`)
      .limit(180);
    res.json({ notes, adet: notes.length });
  } catch (err: any) {
    req.log.error({ err }, "Erreur lecture du journal de chantier");
    res.status(500).json({ error: "Le journal n'a pas pu etre lu." });
  }
});

/**
 * Rattache un document deja televerse a un chantier, ou a une note de journal.
 *
 * Les photos de chantier existaient : elles arrivaient dans `documents` sans
 * jamais pouvoir designer le chantier concerne. `entityType`/`entityId`
 * portaient deja ce lien pour d'autres objets, et n'avaient jamais ete utilises
 * avec « projet ».
 */
router.post("/projets/:id/documents/:documentId", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const projetId = numero(req.params.id);
  const documentId = numero(req.params.documentId);
  if (projetId === null || documentId === null) { res.status(400).json({ error: "ID invalide." }); return; }
  const journalId = req.body?.journalId === undefined || req.body?.journalId === null ? null : numero(req.body.journalId);
  if (req.body?.journalId !== undefined && req.body?.journalId !== null && journalId === null) {
    res.status(400).json({ error: "ID de note invalide." }); return;
  }
  try {
    const projet = await chantierDeLOrganisation(orgId, projetId);
    if (!projet) { res.status(404).json({ error: "Chantier non trouve." }); return; }
    if (journalId !== null) {
      const [note] = await db.select({ id: journalChantierTable.id }).from(journalChantierTable)
        .where(and(
          eq(journalChantierTable.id, journalId),
          eq(journalChantierTable.projetId, projetId),
          eq(journalChantierTable.organisationId, orgId),
        )).limit(1);
      if (!note) { res.status(404).json({ error: "Note de journal non trouvee." }); return; }
    }
    // Un document deja rattache a AUTRE chose (une facture, un contact...) ne
    // change pas de proprietaire en silence : il disparaitrait de sa fiche
    // d'origine sans que personne le sache. `remplacer: true` le dit expres.
    const [actuel] = await db.select({ entityType: documentsTable.entityType, entityId: documentsTable.entityId })
      .from(documentsTable)
      .where(and(eq(documentsTable.id, documentId), eq(documentsTable.organisationId, orgId)))
      .limit(1);
    if (!actuel) { res.status(404).json({ error: "Document non trouve." }); return; }
    const dejaIci = actuel.entityType === null
      || (actuel.entityType === "projet" && actuel.entityId === projetId)
      || actuel.entityType === "journal_chantier";
    if (!dejaIci && req.body?.remplacer !== true) {
      res.status(409).json({
        error: "Ce document est deja rattache a un autre enregistrement.",
        code: "document_deja_rattache",
        rattachement: { entityType: actuel.entityType, entityId: actuel.entityId },
        remediation: "Renvoyez avec remplacer: true pour le deplacer vers ce chantier.",
      });
      return;
    }
    const lignes = await db.update(documentsTable)
      .set({
        entityType: journalId !== null ? "journal_chantier" : "projet",
        entityId: journalId !== null ? journalId : projetId,
      })
      .where(and(eq(documentsTable.id, documentId), eq(documentsTable.organisationId, orgId)))
      .returning({ id: documentsTable.id, entityType: documentsTable.entityType, entityId: documentsTable.entityId });
    if (lignes.length === 0) { res.status(404).json({ error: "Document non trouve." }); return; }
    await logAudit(
      req.session?.userId, req.session?.userEmail,
      "chantier.document_rattache", "document", String(documentId),
      { projetId, journalId, avant: actuel },
      req.ip, req.get("user-agent"), orgId,
    ).catch(() => {});
    res.json({ document: lignes[0] });
  } catch (err: any) {
    req.log.error({ err }, "Erreur rattachement d'un document au chantier");
    res.status(500).json({ error: "Le document n'a pas pu etre rattache." });
  }
});

/**
 * Rattacher un appel ou un creneau d'agenda a un chantier (ou l'en detacher).
 *
 * Deux routes dediees plutot qu'un champ de plus dans PATCH /calls et PATCH
 * /calendar/events : ces corps sont valides par des schemas generes depuis la
 * specification OpenAPI, et le rattachement est un geste distinct — « cet appel
 * concerne ce chantier » — qui merite sa trace d'audit propre.
 *
 * Corps : { projetId: number | null }. `null` detache.
 */
async function rattacher(req: Request, res: Response, genre: "appel" | "evenement"): Promise<void> {
  const orgId = getOrgId(req);
  const id = numero(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID invalide." }); return; }
  const brut = req.body?.projetId;
  const detacher = brut === null || brut === "";
  const projetId = detacher ? null : numero(brut);
  if (!detacher && projetId === null) { res.status(400).json({ error: "projetId invalide (nombre ou null)." }); return; }
  try {
    if (projetId !== null && !(await chantierDeLOrganisation(orgId, projetId))) {
      // Meme reponse qu'un chantier inexistant : on ne dit rien des autres organisations.
      res.status(400).json({ error: "Reference inconnue dans votre organisation : projetId" });
      return;
    }
    const lignes = genre === "appel"
      ? await db.update(callsTable).set({ projetId })
          .where(and(eq(callsTable.id, id), eq(callsTable.organisationId, orgId)))
          .returning({ id: callsTable.id, projetId: callsTable.projetId })
      : await db.update(calendarEventsTable).set({ projetId })
          .where(and(eq(calendarEventsTable.id, id), eq(calendarEventsTable.organisationId, orgId)))
          .returning({ id: calendarEventsTable.id, projetId: calendarEventsTable.projetId });
    if (lignes.length === 0) {
      res.status(404).json({ error: genre === "appel" ? "Appel non trouve." : "Evenement non trouve." });
      return;
    }
    await logAudit(
      req.session?.userId, req.session?.userEmail,
      projetId === null ? "chantier.detache" : "chantier.rattache", genre, String(id),
      { projetId },
      req.ip, req.get("user-agent"), orgId,
    ).catch(() => {});
    res.json(lignes[0]);
  } catch (err: any) {
    req.log.error({ err, genre }, "Erreur rattachement au chantier");
    res.status(500).json({ error: "Le rattachement n'a pas pu etre fait." });
  }
}

router.post("/calls/:id/chantier", (req, res) => rattacher(req, res, "appel"));
router.post("/calendar/events/:id/chantier", (req, res) => rattacher(req, res, "evenement"));

export default router;
