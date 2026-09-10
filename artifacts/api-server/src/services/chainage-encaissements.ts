/**
 * chainage-encaissements.ts — rendre un encaissement inalterable, et le prouver.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le 3° bis du I de l'article 286 du CGI impose aux assujettis qui enregistrent
 * les reglements de leurs clients d'utiliser un logiciel satisfaisant quatre
 * conditions: INALTERABILITE, SECURISATION, CONSERVATION, ARCHIVAGE. L'amende
 * est de 7 500 € PAR LOGICIEL non conforme, et elle frappe l'entreprise qui
 * l'utilise — c'est-a-dire le client, pas l'editeur.
 *
 * Le champ d'application est decisif ici: une entreprise dont la totalite du
 * chiffre d'affaires est realisee avec des professionnels est EXCLUE, parce que
 * le B2B est obligatoirement facture. Mais une entreprise qui encaisse aussi
 * des PARTICULIERS y entre. Or les artisans du batiment — le coeur de clientele
 * de ce produit — travaillent presque tous pour des particuliers en plus de
 * leurs clients professionnels. Une large part des utilisateurs est donc dans
 * le champ.
 *
 * ETAT MESURE AVANT CE FICHIER
 *
 * Les encaissements n'existaient pas en tant qu'ecritures: ils vivaient dans
 * une seule colonne modifiable, `factures_client.paid_amount`, explicitement
 * exclue des champs geles apres emission. Un montant encaisse pouvait donc
 * etre augmente, diminue ou remis a zero SANS AUCUNE TRACE. C'est exactement
 * ce que l'inalterabilite interdit, et c'est le premier point que regarde un
 * controle.
 *
 * CE QUE FAIT LE CHAINAGE
 *
 * Chaque ecriture porte l'empreinte de la precedente. Modifier une ecriture
 * ancienne change son empreinte, donc casse le chainon suivant, donc toute la
 * suite: la falsification cesse d'etre discrete pour devenir arithmetiquement
 * detectable. C'est le mecanisme retenu par la norme NF525 et par la doctrine
 * de l'administration.
 *
 * Une correction ne se fait JAMAIS en modifiant une ecriture: elle se fait par
 * une ecriture INVERSE, qui s'ajoute a la suite. C'est la regle comptable
 * ordinaire (on ne gomme pas, on contre-passe), et c'est aussi ce qui rend le
 * chainage tenable.
 *
 * Module PUR: aucune I/O, aucune dependance a la base. C'est ce qui permet de
 * verifier une chaine entiere dans un test, et a un controleur de refaire le
 * calcul lui-meme.
 */
import { createHash } from "node:crypto";

export type SensEcriture = "encaissement" | "annulation";

/** Une ecriture du journal des reglements, telle qu'elle est chainee. */
export interface EcritureEncaissement {
  /** Numero de suite dans l'organisation, strictement croissant, sans trou. */
  numero: number;
  organisationId: number;
  /** La facture reglee. Nul pour un encaissement pas encore rapproche. */
  factureId: number | null;
  /**
   * Montant en CENTIMES, entier.
   *
   * Pas un flottant, pas une chaine: l'empreinte doit etre reproductible a
   * l'octet pres, et `0.1 + 0.2` ne vaut pas `0.3` en binaire. Un controleur
   * qui refait le calcul doit retrouver exactement la meme empreinte, sinon la
   * preuve ne prouve rien.
   */
  montantCentimes: number;
  devise: string;
  moyen: string;
  /** Horodatage de l'encaissement, ISO 8601 en UTC. */
  dateEncaissement: string;
  sens: SensEcriture;
  /** Pour une annulation: le numero de l'ecriture contre-passee. */
  annuleNumero: number | null;
  /** Empreinte de l'ecriture precedente, ou la graine pour la premiere. */
  empreintePrecedente: string;
}

/**
 * Graine de la chaine d'une organisation.
 *
 * Elle depend de l'organisation: sans cela, deux organisations qui
 * commenceraient par le meme encaissement auraient la meme empreinte
 * initiale, et une ecriture pourrait etre deplacee de l'une a l'autre sans
 * casser aucun chainon.
 */
export function graine(organisationId: number): string {
  return createHash("sha256")
    .update(`ajant-bureau:journal-reglements:v1:org:${organisationId}`)
    .digest("hex");
}

/**
 * Representation canonique d'une ecriture, avant hachage.
 *
 * L'ordre des champs et leur format sont FIGES. Un JSON.stringify sur un objet
 * ne l'est pas — l'ordre des cles depend de leur ordre d'insertion, et une
 * refonte innocente du code changerait toutes les empreintes, invalidant des
 * annees de journal. On ecrit donc les champs a la main, dans un ordre decide
 * une fois.
 *
 * `null` s'ecrit chaine vide: un separateur present mais vide se distingue
 * d'un champ absent, et le nombre de separateurs reste constant.
 */
export function formeCanonique(e: EcritureEncaissement): string {
  return [
    "v1",
    String(e.numero),
    String(e.organisationId),
    e.factureId === null ? "" : String(e.factureId),
    String(e.montantCentimes),
    e.devise,
    e.moyen,
    e.dateEncaissement,
    e.sens,
    e.annuleNumero === null ? "" : String(e.annuleNumero),
    e.empreintePrecedente,
  ].join("|");
}

/** Empreinte d'une ecriture. */
export function empreinteDe(e: EcritureEncaissement): string {
  return createHash("sha256").update(formeCanonique(e), "utf8").digest("hex");
}

export interface EcritureChainee extends EcritureEncaissement {
  empreinte: string;
}

export type MotifRupture =
  | "numero_non_consecutif"
  | "chainon_rompu"
  | "empreinte_incorrecte"
  | "organisation_etrangere";

export interface Verdict {
  intacte: boolean;
  /** Le numero de la premiere ecriture fautive, ou null si la chaine tient. */
  premiereRupture: number | null;
  motif: MotifRupture | null;
  /** En clair, ce qui ne va pas — un controleur doit pouvoir le lire. */
  explication: string | null;
  /** Nombre d'ecritures verifiees avant la rupture (ou en tout). */
  verifiees: number;
}

/**
 * Verifie une chaine entiere.
 *
 * Renvoie le PREMIER point de rupture, pas la liste de tous: apres une
 * rupture, tout ce qui suit est faux par construction, et une liste de mille
 * erreurs identiques ne dit rien de plus que la premiere.
 *
 * Les ecritures doivent etre fournies dans l'ordre des numeros.
 */
export function verifierChaine(
  ecritures: EcritureChainee[],
  organisationId: number,
): Verdict {
  let attendue = graine(organisationId);

  for (let i = 0; i < ecritures.length; i += 1) {
    const e = ecritures[i];

    if (e.organisationId !== organisationId) {
      return {
        intacte: false,
        premiereRupture: e.numero,
        motif: "organisation_etrangere",
        explication:
          `L'ecriture n° ${e.numero} appartient a l'organisation ${e.organisationId}, ` +
          `pas a ${organisationId}. Une ecriture ne peut pas changer de journal.`,
        verifiees: i,
      };
    }

    // La suite doit etre continue: un trou signale une ecriture supprimee, et
    // une suppression est precisement ce que l'inalterabilite interdit.
    if (e.numero !== i + 1) {
      return {
        intacte: false,
        premiereRupture: e.numero,
        motif: "numero_non_consecutif",
        explication:
          `Le journal saute du n° ${i} au n° ${e.numero}: une ecriture manque. ` +
          `Une correction se fait par ecriture inverse, jamais par suppression.`,
        verifiees: i,
      };
    }

    if (e.empreintePrecedente !== attendue) {
      return {
        intacte: false,
        premiereRupture: e.numero,
        motif: "chainon_rompu",
        explication:
          `L'ecriture n° ${e.numero} ne s'accroche pas a la precedente. ` +
          `Une ecriture anterieure a ete modifiee ou retiree.`,
        verifiees: i,
      };
    }

    const recalculee = empreinteDe(e);
    if (recalculee !== e.empreinte) {
      return {
        intacte: false,
        premiereRupture: e.numero,
        motif: "empreinte_incorrecte",
        explication:
          `Le contenu de l'ecriture n° ${e.numero} ne correspond plus a son empreinte: ` +
          `un champ a ete modifie apres coup.`,
        verifiees: i,
      };
    }

    attendue = e.empreinte;
  }

  return {
    intacte: true,
    premiereRupture: null,
    motif: null,
    explication: null,
    verifiees: ecritures.length,
  };
}

/**
 * Prepare l'ecriture suivante d'une chaine.
 *
 * `precedente` est l'empreinte de la derniere ecriture du journal, ou null si
 * le journal est vide.
 */
export function preparerEcriture(
  base: Omit<EcritureEncaissement, "numero" | "empreintePrecedente">,
  precedente: { numero: number; empreinte: string } | null,
): EcritureChainee {
  const ecriture: EcritureEncaissement = {
    ...base,
    numero: precedente ? precedente.numero + 1 : 1,
    empreintePrecedente: precedente ? precedente.empreinte : graine(base.organisationId),
  };
  return { ...ecriture, empreinte: empreinteDe(ecriture) };
}

/**
 * Solde d'une facture d'apres le journal, en centimes.
 *
 * Le solde se CALCULE, il ne se stocke pas. Une colonne `paid_amount`
 * modifiable est precisement ce qui a rendu le montant encaisse alterable: on
 * la garde comme cache d'affichage, jamais comme source de verite.
 */
export function soldeFacture(ecritures: EcritureChainee[], factureId: number): number {
  let total = 0;
  const annulees = new Set(
    ecritures.filter((e) => e.sens === "annulation" && e.annuleNumero !== null).map((e) => e.annuleNumero!),
  );
  for (const e of ecritures) {
    if (e.factureId !== factureId) continue;
    if (e.sens === "annulation") continue;
    if (annulees.has(e.numero)) continue;
    total += e.montantCentimes;
  }
  return total;
}
