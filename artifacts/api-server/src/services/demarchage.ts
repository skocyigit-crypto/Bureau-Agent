/**
 * Qui peut encore etre demarche, et par quel canal.
 *
 * LE CHANGEMENT QUI A EU LIEU IL Y A CINQ SEMAINES
 *
 * Loi n° 2025-594 du 30 juin 2025, en vigueur depuis le 11 AOUT 2026 :
 * appeler un CONSOMMATEUR a des fins de prospection commerciale sans son
 * consentement prealable — libre, specifique, eclaire et univoque — est
 * desormais interdit. Le regime passe de l'opt-out a l'opt-in, et Bloctel,
 * dont la concession s'achevait a cette date, n'a plus d'objet.
 *
 * L'amende atteint 75 000 EUR pour une personne physique et 375 000 EUR pour
 * une personne morale.
 *
 * CE QUE LE PRODUIT FAISAIT
 *
 * Mesure du 16/09 : ni `contacts` ni `prospects` ne portaient la moindre
 * notion de consentement ou d'opposition. Les 21 fichiers ou apparaissait le
 * mot « consentement » concernaient tous OAuth ou l'inscription — aucun la
 * prospection. Le produit comptait pourtant les appels (`totalCalls`,
 * `lastCallAt`), tenait un pipeline de prospects et proposait des relances.
 *
 * Il ne pouvait pas non plus distinguer un particulier d'un professionnel :
 * `category` est un texte libre dont la valeur par defaut est « autre ». Or
 * c'est exactement cette distinction qui commande la regle — et une PME du
 * BTP travaille couramment pour des particuliers.
 *
 * LES QUATRE REGIMES
 *
 *                    telephone                    email / SMS
 *   particulier      consentement prealable       consentement prealable
 *   professionnel    interet legitime             opposition (opt-out)
 *
 * Le B2B echappe a l'opt-in de l'article L223-1, mais reste soumis au RGPD :
 * information prealable et droit d'opposition.
 *
 * LE DEFAUT EST PRUDENT, ET C'EST UN CHOIX
 *
 * Un type de personne INCONNU est traite comme un particulier. Se tromper
 * dans ce sens coute un appel qu'on ne passe pas; se tromper dans l'autre
 * coute une amende dont le plafond est six chiffres. Le module le dit au lieu
 * de le faire en silence, pour que l'utilisateur renseigne la fiche.
 */

export type TypePersonne = "particulier" | "professionnel" | "inconnu";
export type Canal = "telephone" | "email";
export type Consentement = "accorde" | "refuse" | "inconnu";

export interface ContactDemarchage {
  typePersonne?: string | null;
  prospectionConsent?: string | null;
  prospectionOppositionAt?: Date | string | null;
}

export interface VerdictDemarchage {
  autorise: boolean;
  /** Explication citant la regle applicable. */
  motif: string;
  /** Texte fondateur, pour que le verdict soit verifiable. */
  reference: string;
  /**
   * Vrai quand le verdict repose sur une HYPOTHESE faute d'information —
   * typiquement un type de personne non renseigne.
   */
  aVerifier: boolean;
}

function normaliserType(v: unknown): TypePersonne {
  return v === "particulier" || v === "professionnel" ? v : "inconnu";
}

function normaliserConsentement(v: unknown): Consentement {
  return v === "accorde" || v === "refuse" ? v : "inconnu";
}

function sOppose(v: Date | string | null | undefined): boolean {
  if (v === null || v === undefined || v === "") return false;
  const d = v instanceof Date ? v : new Date(v);
  return !Number.isNaN(d.getTime());
}

export function evaluerDemarchage(
  contact: ContactDemarchage,
  canal: Canal,
): VerdictDemarchage {
  const type = normaliserType(contact.typePersonne);
  const consentement = normaliserConsentement(contact.prospectionConsent);

  // L'OPPOSITION PRIME SUR TOUT, y compris en B2B et y compris sur un
  // consentement anterieur: elle s'exerce a tout moment, et un consentement
  // ancien ne la neutralise pas.
  if (sOppose(contact.prospectionOppositionAt)) {
    return {
      autorise: false,
      motif: "Cette personne s'est opposee a la prospection. L'opposition prime sur tout consentement anterieur.",
      reference: "RGPD art. 21",
      aVerifier: false,
    };
  }

  if (consentement === "refuse") {
    return {
      autorise: false,
      motif: "Le consentement a ete explicitement refuse.",
      reference: "RGPD art. 7",
      aVerifier: false,
    };
  }

  if (type === "professionnel") {
    return {
      autorise: true,
      motif:
        canal === "telephone"
          ? "Professionnel : la prospection telephonique reste fondee sur l'interet legitime. L'opt-in du 11 aout 2026 ne vise que les consommateurs."
          : "Professionnel : prospection electronique possible si le message porte sur son activite, avec un moyen de s'opposer.",
      reference: canal === "telephone" ? "RGPD art. 6.1.f" : "CPCE art. L34-5",
      aVerifier: false,
    };
  }

  // Particulier, ou type inconnu traite comme tel.
  const inconnu = type === "inconnu";
  if (consentement === "accorde") {
    return {
      autorise: true,
      motif: inconnu
        ? "Consentement recueilli. Le type de personne n'est pas renseigne : renseignez-le pour lever le doute."
        : "Consentement prealable recueilli.",
      reference: canal === "telephone" ? "C. conso. art. L223-1" : "CPCE art. L34-5",
      aVerifier: inconnu,
    };
  }

  return {
    autorise: false,
    motif:
      (inconnu
        ? "Type de personne non renseigne : traite comme un particulier, le regime le plus strict. "
        : "") +
      (canal === "telephone"
        ? "Depuis le 11 aout 2026, appeler un consommateur a des fins de prospection exige son consentement prealable (loi n° 2025-594). Bloctel n'a plus d'objet."
        : "La prospection electronique vers un consommateur exige son consentement prealable."),
    reference: canal === "telephone" ? "C. conso. art. L223-1" : "CPCE art. L34-5",
    aVerifier: inconnu,
  };
}

/** Compte les contacts d'une liste qui ne peuvent pas etre demarches. */
export function compterBloques(
  contacts: ContactDemarchage[],
  canal: Canal,
): { bloques: number; aVerifier: number } {
  let bloques = 0;
  let aVerifier = 0;
  for (const c of contacts) {
    const v = evaluerDemarchage(c, canal);
    if (!v.autorise) bloques += 1;
    if (v.aVerifier) aVerifier += 1;
  }
  return { bloques, aVerifier };
}
