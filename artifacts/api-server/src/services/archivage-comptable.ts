/**
 * archivage-comptable.ts — la quatrieme condition, et la seule qui doit
 * survivre au logiciel.
 *
 * Le 3° bis du I de l'article 286 du CGI exige l'ARCHIVAGE des donnees de
 * reglement, avec une periodicite au plus annuelle. L'archive fige une periode:
 * elle n'est plus modifiable, elle porte sa propre signature, et — c'est le
 * point que l'on oublie le plus souvent — elle doit rester LISIBLE SANS LE
 * LOGICIEL.
 *
 * Un controle peut survenir six ans plus tard (art. L102 B du LPF). A cette
 * date, l'editeur peut avoir disparu, le produit avoir change trois fois de
 * format, l'abonnement du client avoir pris fin. Une archive qui exigerait
 * d'installer Ajant Bureau pour etre lue ne serait pas une archive: ce serait
 * une dependance.
 *
 * D'ou la forme retenue: du JSON, avec des noms de champs explicites, et un
 * MODE D'EMPLOI en francais inclus dans le fichier lui-meme. N'importe qui
 * disposant d'un ordinateur doit pouvoir recalculer les empreintes et
 * confirmer que rien n'a bouge. La preuve ne doit dependre de personne.
 *
 * Module PUR: aucune I/O, aucune base. C'est ce qui permet a un tiers de
 * refaire exactement le meme calcul.
 */
import { createHash } from "node:crypto";

import { empreinteDe, type EcritureChainee } from "./chainage-encaissements";
import { empreinteCloture, periodeDe, type ClotureScellee, type TypeCloture } from "./cloture-comptable";

export interface ArchiveComptable {
  /** Le contenu du fichier, tel qu'il sera remis. */
  contenu: string;
  /** Empreinte du contenu. C'est elle qu'on conserve en base et qu'on compare. */
  empreinte: string;
  nbEcritures: number;
  nbClotures: number;
  totalCentimes: number;
  octets: number;
}

/**
 * Le mode d'emploi inclus dans chaque archive.
 *
 * Ecrit pour quelqu'un qui n'a jamais vu ce logiciel et qui doit verifier
 * l'archive avec ce qu'il a sous la main. Il decrit la forme canonique parce
 * que sans elle, le recalcul est impossible: l'ordre des champs et le
 * separateur ne se devinent pas.
 */
const MODE_D_EMPLOI = [
  "Cette archive contient les reglements encaisses sur la periode indiquee, et les",
  "clotures comptables qui les couvrent. Elle est produite en application du 3° bis",
  "du I de l'article 286 du code general des impots.",
  "",
  "VERIFIER L'ARCHIVE SANS AUCUN LOGICIEL PARTICULIER",
  "",
  "1. Empreinte du fichier: retirez le champ `empreinte_archive` de l'objet racine,",
  "   serialisez le reste en JSON avec deux espaces d'indentation et les cles dans",
  "   l'ordre ou elles apparaissent, puis calculez SHA-256 du resultat en UTF-8.",
  "   Le resultat doit etre egal a `empreinte_archive`.",
  "",
  "2. Empreinte d'une ecriture: concatenez les champs suivants, separes par le",
  "   caractere | , puis calculez SHA-256 du resultat en UTF-8:",
  "     v1 | numero | organisation | facture | montant_centimes | devise | moyen |",
  "     date | sens | annule_numero | empreinte_precedente",
  "   Un champ vide s'ecrit comme une chaine vide (deux separateurs se suivent).",
  "   Le resultat doit etre egal au champ `empreinte` de l'ecriture.",
  "",
  "3. Chainage: le champ `empreinte_precedente` de chaque ecriture doit etre egal",
  "   au champ `empreinte` de l'ecriture qui la precede. Une rupture signifie",
  "   qu'une ecriture a ete modifiee ou retiree.",
  "",
  "4. Totaux: le champ `total_cumule_centimes` de la derniere cloture doit etre",
  "   egal a la somme des `montant_centimes` de toutes les ecritures depuis",
  "   l'origine. Un ecart signifie que des ecritures ont disparu.",
  "",
  "Les montants sont en CENTIMES entiers. Une correction n'efface jamais une",
  "ecriture: elle ajoute une ecriture de sens `annulation` portant le montant",
  "oppose.",
].join("\n");

/**
 * Serialisation deterministe de l'archive.
 *
 * L'indentation et l'ordre des cles font partie de la preuve: quelqu'un qui
 * recalcule l'empreinte doit produire exactement les memes octets. On construit
 * donc les objets dans un ordre fixe, et on n'utilise jamais de cles
 * calculees.
 */
function corpsArchive(
  organisationId: number,
  type: TypeCloture,
  periode: string,
  ecritures: EcritureChainee[],
  clotures: ClotureScellee[],
  produiteLe: string,
) {
  return {
    format: "ajant-bureau/archive-reglements",
    version: 1,
    fondement: "Article 286-I-3° bis du CGI — archivage des donnees de reglement.",
    organisation: organisationId,
    type_de_periode: type,
    periode,
    produite_le: produiteLe,
    mode_d_emploi: MODE_D_EMPLOI,
    ecritures: ecritures.map((e) => ({
      numero: e.numero,
      organisation: e.organisationId,
      facture: e.factureId,
      montant_centimes: e.montantCentimes,
      devise: e.devise,
      moyen: e.moyen,
      date: e.dateEncaissement,
      sens: e.sens,
      annule_numero: e.annuleNumero,
      empreinte_precedente: e.empreintePrecedente,
      empreinte: e.empreinte,
    })),
    clotures: clotures.map((c) => ({
      type: c.type,
      periode: c.periode,
      premier_numero: c.premierNumero,
      dernier_numero: c.dernierNumero,
      nb_ecritures: c.nbEcritures,
      total_periode_centimes: c.totalPeriodeCentimes,
      total_cumule_centimes: c.totalCumuleCentimes,
      empreinte_precedente: c.empreintePrecedente,
      empreinte: c.empreinte,
    })),
  };
}

/**
 * Construit l'archive d'une periode.
 *
 * `toutes` doit contenir toutes les ecritures de l'organisation: l'archive
 * porte celles de la periode, mais la verification du cumul a besoin du
 * contexte. Seules les ecritures de la periode sont ecrites dans le fichier.
 */
export function construireArchive(
  organisationId: number,
  type: TypeCloture,
  periode: string,
  toutes: EcritureChainee[],
  clotures: ClotureScellee[],
  produiteLe: string,
): ArchiveComptable {
  const dedans = toutes.filter((e) => periodeDe(e.dateEncaissement, type) === periode);
  const clotturesRetenues = clotures.filter((c) => c.periode <= periode);

  const corps = corpsArchive(organisationId, type, periode, dedans, clotturesRetenues, produiteLe);
  const sansEmpreinte = JSON.stringify(corps, null, 2);
  const empreinte = createHash("sha256").update(sansEmpreinte, "utf8").digest("hex");

  // L'empreinte est ajoutee APRES coup, en fin d'objet: elle porte sur tout ce
  // qui la precede. C'est ce que le mode d'emploi decrit, et c'est ce qui rend
  // le recalcul possible — inclure l'empreinte dans ce qu'elle signe serait
  // circulaire.
  const complet = { ...corps, empreinte_archive: empreinte };
  const contenu = JSON.stringify(complet, null, 2);

  return {
    contenu,
    empreinte,
    nbEcritures: dedans.length,
    nbClotures: clotturesRetenues.length,
    totalCentimes: dedans.reduce((s, e) => s + e.montantCentimes, 0),
    octets: Buffer.byteLength(contenu, "utf8"),
  };
}

export type MotifArchiveInvalide =
  | "json_illisible"
  | "empreinte_archive_absente"
  | "empreinte_archive_incorrecte"
  | "ecriture_alteree"
  | "chainage_rompu";

export interface VerdictArchive {
  valide: boolean;
  motif: MotifArchiveInvalide | null;
  explication: string | null;
  nbEcritures: number;
}

/**
 * Verifie une archive a partir de son SEUL contenu.
 *
 * Aucun acces a la base: c'est exactement ce qu'un tiers peut faire six ans
 * plus tard, avec le fichier et rien d'autre. Si cette fonction disparaissait,
 * le mode d'emploi inclus dans l'archive suffirait a refaire le meme travail a
 * la main.
 */
export function verifierArchive(contenu: string): VerdictArchive {
  let objet: any;
  try {
    objet = JSON.parse(contenu);
  } catch {
    return { valide: false, motif: "json_illisible", explication: "Le fichier n'est pas un JSON valide.", nbEcritures: 0 };
  }

  const empreinteAnnoncee = objet?.empreinte_archive;
  if (typeof empreinteAnnoncee !== "string") {
    return {
      valide: false, motif: "empreinte_archive_absente",
      explication: "Le fichier ne porte pas de champ `empreinte_archive`.", nbEcritures: 0,
    };
  }

  const { empreinte_archive: _ignore, ...sansEmpreinte } = objet;
  const recalculee = createHash("sha256")
    .update(JSON.stringify(sansEmpreinte, null, 2), "utf8")
    .digest("hex");

  if (recalculee !== empreinteAnnoncee) {
    return {
      valide: false, motif: "empreinte_archive_incorrecte",
      explication: "Le contenu de l'archive ne correspond pas a son empreinte: le fichier a ete modifie.",
      nbEcritures: Array.isArray(objet.ecritures) ? objet.ecritures.length : 0,
    };
  }

  // Le fichier est intact. On verifie maintenant qu'il dit la verite: chaque
  // ecriture doit porter l'empreinte de son propre contenu, et s'accrocher a
  // la precedente. Une archive scellee sur des donnees deja fausses serait
  // intacte et mensongere.
  const ecritures: any[] = Array.isArray(objet.ecritures) ? objet.ecritures : [];
  for (let i = 0; i < ecritures.length; i += 1) {
    const e = ecritures[i];
    const recalcul = empreinteDe({
      numero: e.numero,
      organisationId: e.organisation,
      factureId: e.facture ?? null,
      montantCentimes: e.montant_centimes,
      devise: e.devise,
      moyen: e.moyen,
      dateEncaissement: e.date,
      sens: e.sens,
      annuleNumero: e.annule_numero ?? null,
      empreintePrecedente: e.empreinte_precedente,
    });
    if (recalcul !== e.empreinte) {
      return {
        valide: false, motif: "ecriture_alteree",
        explication: `L'ecriture n° ${e.numero} ne correspond pas a son empreinte.`,
        nbEcritures: ecritures.length,
      };
    }
    if (i > 0 && e.empreinte_precedente !== ecritures[i - 1].empreinte) {
      return {
        valide: false, motif: "chainage_rompu",
        explication: `L'ecriture n° ${e.numero} ne s'accroche pas a la precedente.`,
        nbEcritures: ecritures.length,
      };
    }
  }

  // Les clotures aussi: leur empreinte est la preuve du cumul fige.
  const clotures: any[] = Array.isArray(objet.clotures) ? objet.clotures : [];
  for (const c of clotures) {
    const recalcul = empreinteCloture({
      organisationId: objet.organisation,
      type: c.type,
      periode: c.periode,
      premierNumero: c.premier_numero ?? null,
      dernierNumero: c.dernier_numero ?? null,
      nbEcritures: c.nb_ecritures,
      totalPeriodeCentimes: c.total_periode_centimes,
      totalCumuleCentimes: c.total_cumule_centimes,
      empreintePrecedente: c.empreinte_precedente,
    });
    if (recalcul !== c.empreinte) {
      return {
        valide: false, motif: "ecriture_alteree",
        explication: `La cloture ${c.periode} ne correspond pas a son empreinte.`,
        nbEcritures: ecritures.length,
      };
    }
  }

  return { valide: true, motif: null, explication: null, nbEcritures: ecritures.length };
}

/** Nom de fichier remis au client. */
export function nomArchive(organisationId: number, type: TypeCloture, periode: string): string {
  return `reglements-${organisationId}-${type}-${periode}.json`;
}
