/**
 * payment-matching.ts — rapprocher un virement recu et une facture, sans se
 * tromper de client.
 *
 * L'ancien rapprochement additionnait des points: montant exact +50, nom du
 * payeur proche du nom de l'organisation +40, reference bancaire contenant la
 * periode +10 — et appliquait automatiquement des 50. Or 50, c'est le MONTANT
 * SEUL. Tous les clients d'un meme forfait paient exactement la meme somme:
 * deux abonnes a 29 EUR produisent deux virements identiques au centime, et le
 * premier trouve fermait la facture de l'autre.
 *
 * Une erreur de rapprochement ne se voit pas: la facture passe a « payee », le
 * client credite a tort ne reclame rien, et le client reellement debiteur
 * continue de recevoir des relances pour une facture que le systeme croit
 * soldee. C'est le genre de faute qu'on decouvre en fin d'exercice.
 *
 * La regle est donc: on n'applique automatiquement QUE ce qui est certain.
 *
 *   - une REFERENCE de facture trouvee dans le libelle du virement identifie
 *     une facture et une seule. C'est le seul motif d'application automatique;
 *   - tout le reste — montant, nom du payeur — devient une SUGGESTION que le
 *     super-admin valide. Une suggestion coute une seconde de lecture; un
 *     mauvais rapprochement coute un exercice comptable.
 *
 * Cette regle est aussi ce qui rend l'automatisation possible: la litterature
 * du rapprochement bancaire donne 85 a 95 % d'appariement automatique quand la
 * remise porte une reference structuree, contre 50 a 60 % sans. Le levier
 * n'est pas un algorithme plus malin, c'est de demander la reference au
 * moment du paiement.
 */

export interface PaiementRecu {
  /** Libelle/reference fournis par la banque. */
  bankRef?: string | null;
  /** Nom du donneur d'ordre. */
  payerName?: string | null;
  /** Ligne brute du releve, quand elle existe. */
  rawLine?: string | null;
  /** Montant recu. */
  amount: number;
}

export interface FactureOuverte {
  id: number;
  organisationId: number;
  /** Numero de facture (`FAC-2026-000001`). */
  reference?: string | null;
  /** Montant reellement du: TTC quand il existe, HT pour les factures anterieures. */
  duMontant: number;
  /** Raison sociale du client, pour le rapprochement par nom. */
  orgName?: string | null;
}

export type Motif = "reference" | "montant_et_nom" | "montant_seul";

export interface Appariement {
  factureId: number;
  organisationId: number;
  motif: Motif;
  /** Indicatif, pour l'affichage et le journal. L'application automatique ne depend QUE du motif. */
  confiance: number;
}

export interface Resultat {
  /** Rapprochement certain, applicable sans relecture. `null` s'il n'y en a pas. */
  automatique: Appariement | null;
  /** Rapprochements plausibles, a valider par un humain. */
  suggestions: Appariement[];
}

/** Normalise pour comparer: majuscules, sans separateurs ni accents. */
function normaliser(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Tout ce que la banque nous transmet en texte, concatene et normalise. */
function texteDuVirement(p: PaiementRecu): string {
  return normaliser([p.bankRef, p.rawLine, p.payerName].filter(Boolean).join(" "));
}

/** Deux montants au centime pres. */
function memeMontant(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

export function apparier(paiement: PaiementRecu, factures: FactureOuverte[]): Resultat {
  const texte = texteDuVirement(paiement);

  // 1. La reference. Une reference de facture est unique par construction: si
  //    elle figure dans le libelle, il n'y a rien a deviner.
  const parReference = factures.filter((f) => {
    const ref = f.reference ? normaliser(f.reference) : "";
    // Une reference trop courte matcherait par hasard (« FAC1 » dans un IBAN).
    return ref.length >= 6 && texte.includes(ref);
  });

  if (parReference.length === 1) {
    const f = parReference[0];
    return {
      automatique: { factureId: f.id, organisationId: f.organisationId, motif: "reference", confiance: 100 },
      suggestions: [],
    };
  }
  if (parReference.length > 1) {
    // Deux references dans un meme virement: un paiement groupe. On ne devine
    // pas la repartition — c'est exactement le cas ou un humain doit trancher.
    return {
      automatique: null,
      suggestions: parReference.map((f) => ({
        factureId: f.id, organisationId: f.organisationId, motif: "reference", confiance: 60,
      })),
    };
  }

  // 2. Sans reference: on ne fait plus que proposer.
  const memeSomme = factures.filter((f) => memeMontant(f.duMontant, paiement.amount));
  const payeur = paiement.payerName ? normaliser(paiement.payerName) : "";

  const avecNom = memeSomme.filter((f) => {
    if (!payeur || !f.orgName) return false;
    const org = normaliser(f.orgName);
    return org.length >= 4 && (payeur.includes(org) || org.includes(payeur));
  });

  if (avecNom.length > 0) {
    return {
      automatique: null,
      suggestions: avecNom.map((f) => ({
        factureId: f.id, organisationId: f.organisationId, motif: "montant_et_nom", confiance: 70,
      })),
    };
  }

  return {
    automatique: null,
    suggestions: memeSomme.map((f) => ({
      factureId: f.id, organisationId: f.organisationId, motif: "montant_seul", confiance: 40,
    })),
  };
}
