/**
 * La sante des comptes clients, calculee a partir des factures reelles.
 *
 * Mesure du 19/09 : la table `compte_client` (36 colonnes — encours, impaye,
 * balance agee 30/60/90, score de sante, niveau de risque, limite de credit)
 * n'est remplie PAR AUCUN CODE. Zero `insert` dans tout le depot ; la seule
 * ecriture existante met a jour `lastReminderAt` sur des lignes qui ne sont
 * jamais creees.
 *
 * Elle etait pourtant lue a quinze endroits : tableau de bord du risque
 * client, fiche client 360, export CSV remis au client, relances. Encours
 * total, montant en retard, comptes critiques et score moyen s'affichaient
 * donc a zero — non pas « aucune donnee », mais des CHIFFRES, presentes avec
 * l'assurance d'un calcul. Ce n'est pas une panne : c'est un mensonge
 * silencieux sur un chemin d'argent, et le genre de defaut qu'un acheteur
 * decouvre apres coup.
 *
 * Ce module ne cree pas la table manquante : il rend inutile de la remplir.
 * Tout ce qu'elle promettait se deduit des factures, qui sont la source de
 * verite et sont, elles, bien ecrites. Le calcul est PUR — entrees egales,
 * sortie egale — donc verifiable sans base.
 */

/** Une facture, reduite a ce qui sert au calcul. */
export interface FactureSante {
  clientName: string;
  contactId: number | null;
  /** Montant total TTC, en euros. */
  totalAmount: string | number;
  /** Deja regle, en euros. */
  paidAmount: string | number | null;
  status: string;
  dueDate: Date | string | null;
}

export interface CompteClientCalcule {
  clientName: string;
  contactId: number | null;
  /** Reste du, toutes factures ouvertes confondues. */
  solde: number;
  /** Part du solde dont l'echeance est passee. */
  montantEnRetard: number;
  /** Balance agee, en jours de retard. */
  agingO30: number;
  aging31a60: number;
  aging61a90: number;
  aging90plus: number;
  /** Nombre de factures ouvertes, et combien sont en retard. */
  facturesOuvertes: number;
  facturesEnRetard: number;
  /** Retard le plus ancien, en jours. */
  joursRetardMax: number;
  healthScore: number;
  riskLevel: "sain" | "surveille" | "eleve" | "critique";
}

export interface SyntheseComptes {
  avgHealth: number;
  critical: number;
  high: number;
  totalOutstanding: number;
  totalOverdue: number;
  comptes: CompteClientCalcule[];
}

/** Statuts qui ne portent aucune creance: rien a recouvrer. */
const STATUTS_CLOS = new Set(["payee", "annulee", "brouillon"]);

const centimes = (v: string | number | null | undefined): number =>
  Math.round(Number(v ?? 0) * 100);

/**
 * Le score part de 100 et descend avec ce qui inquiete reellement un
 * creancier: la PART du solde qui est en retard, et l'ANCIENNETE du plus vieux
 * retard. Un client qui doit beaucoup mais paie a l'heure n'est pas un risque;
 * un client qui doit peu depuis cent jours en est un.
 */
export function scoreSante(partEnRetard: number, joursRetardMax: number): number {
  const penaliteMontant = Math.min(50, Math.round(partEnRetard * 50));
  const penaliteAge =
    joursRetardMax >= 90 ? 40
      : joursRetardMax >= 60 ? 28
        : joursRetardMax >= 30 ? 16
          : joursRetardMax > 0 ? 6
            : 0;
  return Math.max(0, Math.min(100, 100 - penaliteMontant - penaliteAge));
}

export function niveauRisque(score: number): CompteClientCalcule["riskLevel"] {
  if (score < 40) return "critique";
  if (score < 60) return "eleve";
  if (score < 85) return "surveille";
  return "sain";
}

/**
 * Regroupe les factures par client et rend l'etat de chaque compte.
 *
 * Le regroupement se fait sur `contactId` quand il existe, sinon sur le nom:
 * une facture peut etre emise a un client qui n'est pas encore une fiche
 * contact, et l'ignorer ferait disparaitre sa creance du tableau.
 */
export function calculerComptesClients(
  factures: FactureSante[],
  maintenant: Date = new Date(),
): SyntheseComptes {
  const parClient = new Map<string, CompteClientCalcule>();

  for (const f of factures) {
    if (STATUTS_CLOS.has(f.status)) continue;

    const resteCentimes = centimes(f.totalAmount) - centimes(f.paidAmount);
    if (resteCentimes <= 0) continue;

    const cle = f.contactId !== null && f.contactId !== undefined
      ? `id:${f.contactId}`
      : `nom:${(f.clientName ?? "").trim().toLowerCase()}`;

    let compte = parClient.get(cle);
    if (!compte) {
      compte = {
        clientName: f.clientName ?? "",
        contactId: f.contactId ?? null,
        solde: 0, montantEnRetard: 0,
        agingO30: 0, aging31a60: 0, aging61a90: 0, aging90plus: 0,
        facturesOuvertes: 0, facturesEnRetard: 0, joursRetardMax: 0,
        healthScore: 100, riskLevel: "sain",
      };
      parClient.set(cle, compte);
    }

    compte.solde += resteCentimes;
    compte.facturesOuvertes += 1;

    const echeance = f.dueDate ? new Date(f.dueDate) : null;
    if (echeance && !Number.isNaN(echeance.getTime()) && echeance < maintenant) {
      const jours = Math.floor((maintenant.getTime() - echeance.getTime()) / 86400000);
      compte.montantEnRetard += resteCentimes;
      compte.facturesEnRetard += 1;
      compte.joursRetardMax = Math.max(compte.joursRetardMax, jours);
      if (jours <= 30) compte.agingO30 += resteCentimes;
      else if (jours <= 60) compte.aging31a60 += resteCentimes;
      else if (jours <= 90) compte.aging61a90 += resteCentimes;
      else compte.aging90plus += resteCentimes;
    }
  }

  const comptes: CompteClientCalcule[] = [];
  for (const c of parClient.values()) {
    const part = c.solde > 0 ? c.montantEnRetard / c.solde : 0;
    c.healthScore = scoreSante(part, c.joursRetardMax);
    c.riskLevel = niveauRisque(c.healthScore);
    // Les montants repassent en euros: c'est l'unite de tout ce qui les lit.
    c.solde = c.solde / 100;
    c.montantEnRetard = c.montantEnRetard / 100;
    c.agingO30 /= 100; c.aging31a60 /= 100; c.aging61a90 /= 100; c.aging90plus /= 100;
    comptes.push(c);
  }

  comptes.sort((a, b) => a.healthScore - b.healthScore || b.solde - a.solde);

  const totalOutstanding = comptes.reduce((s, c) => s + c.solde, 0);
  const totalOverdue = comptes.reduce((s, c) => s + c.montantEnRetard, 0);

  return {
    // Sans aucun compte ouvert, la sante moyenne est 100: il n'y a rien a
    // recouvrer. Repondre 0 ferait passer une organisation a jour pour la
    // plus en danger de toutes — c'est ce que faisait la table vide.
    avgHealth: comptes.length
      ? Math.round(comptes.reduce((s, c) => s + c.healthScore, 0) / comptes.length)
      : 100,
    critical: comptes.filter((c) => c.riskLevel === "critique").length,
    high: comptes.filter((c) => c.riskLevel === "eleve").length,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    totalOverdue: Math.round(totalOverdue * 100) / 100,
    comptes,
  };
}

/**
 * Charge les factures ouvertes d'une organisation et rend l'etat de ses
 * comptes clients.
 *
 * Volontairement ici, et non dans chaque route: dix lectures de
 * `compte_client` etaient disseminees dans ai-analysis.ts, et c'est ce qui a
 * permis a la table vide de rester invisible aussi longtemps. Une seule
 * source, un seul endroit ou la corriger.
 */
export async function chargerComptesClients(orgId: number): Promise<SyntheseComptes> {
  const { db, facturesClientTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const factures = await db.select({
    clientName: facturesClientTable.clientName,
    contactId: facturesClientTable.contactId,
    totalAmount: facturesClientTable.totalAmount,
    paidAmount: facturesClientTable.paidAmount,
    status: facturesClientTable.status,
    dueDate: facturesClientTable.dueDate,
  }).from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
  return calculerComptesClients(factures);
}

/** Le compte d'un contact donne, ou `null` s'il ne doit rien. */
export async function compteDuContact(orgId: number, contactId: number): Promise<CompteClientCalcule | null> {
  const synthese = await chargerComptesClients(orgId);
  return synthese.comptes.find((c) => c.contactId === contactId) ?? null;
}
