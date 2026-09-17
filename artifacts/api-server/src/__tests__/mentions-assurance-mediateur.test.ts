/**
 * Les mentions que le BTP doit porter — et le delai qu'il ne peut pas depasser.
 *
 * TROIS OBLIGATIONS QUE LE PRODUIT NE CONNAISSAIT PAS
 *
 * 1. ASSURANCE PROFESSIONNELLE (loi n° 2014-626, dite loi Pinel)
 *    Six informations doivent figurer sur CHAQUE devis et CHAQUE facture d'un
 *    professionnel du batiment soumis a la responsabilite civile decennale :
 *    la mention elle-meme, le nom de l'assureur, son adresse, le numero de
 *    contrat, les activites garanties, la zone geographique couverte.
 *    L'omission d'UNE SEULE caracterise le manquement.
 *
 * 2. MEDIATEUR DE LA CONSOMMATION (C. conso. L616-1, L641-1)
 *    Tout professionnel vendant a des consommateurs doit adherer a un
 *    mediateur agree et en indiquer les coordonnees sur ses documents
 *    commerciaux. Un artisan du batiment travaille couramment pour des
 *    particuliers : ce n'est pas un cas marginal ici.
 *
 * 3. PLAFOND DU DELAI DE PAIEMENT (C. com. L441-10)
 *    60 jours date d'emission, ou 45 jours fin de mois si le contrat le
 *    stipule. Le depassement est sanctionne par une amende administrative
 *    pouvant atteindre 2 000 000 EUR pour une personne morale.
 *
 * CE QUE LE PRODUIT FAISAIT
 *
 * Mesure du 16/09 : aucune de ces trois notions n'existait dans le code. Le
 * seul endroit ou un artisan pouvait les ecrire etait `invoiceFooter`, un
 * champ de texte libre — c'est-a-dire nulle part, du point de vue du produit :
 * rien ne les demandait, rien ne signalait leur absence.
 *
 * LE CHOIX RETENU : AVERTIR, PAS BLOQUER
 *
 * Les mentions manquantes produisent des `warnings`, comme les autres
 * mentions obligatoires deja traitees ici. La facture reste emise : refuser
 * de produire le document d'un utilisateur parce qu'il n'a pas encore saisi
 * son numero de contrat d'assurance ferait plus de degats que l'amende
 * qu'on veut lui eviter. Mais le silence, lui, n'est plus une option.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { describe, expect, it } from "vitest";

import {
  PLAFOND_DELAI_PAIEMENT_JOURS,
  buildInvoiceDocument,
  mentionAssurance,
  mentionMediateur,
  type InvoiceRecord,
  type InvoiceSeller,
} from "../services/invoice-pdf";

const ASSURANCE = {
  assuranceNom: "AXA France IARD",
  assuranceAdresse: "313 Terrasses de l'Arche, 92727 Nanterre",
  assuranceContrat: "RCD-2026-889041",
  assuranceActivites: "Maconnerie, platrerie, carrelage",
  assuranceZone: "France metropolitaine et DOM",
};

const MEDIATEUR = {
  mediateurNom: "CNPM — Mediation de la consommation",
  mediateurAdresse: "27 avenue de la Liberte, 97200 Fort-de-France",
  mediateurUrl: "https://cnpm-mediation-consommation.eu",
};

const VENDEUR: InvoiceSeller = {
  name: "Batiment Durand SARL",
  address: "4 rue du Chantier\n69003 Lyon",
  siret: "90123456700018",
  tvaNumber: "FR12901234567",
  ...ASSURANCE,
  ...MEDIATEUR,
};

const FACTURE: InvoiceRecord = {
  reference: "F-2026-0001",
  clientName: "Client SARL",
  clientAddress: "1 place du Marche\n69001 Lyon",
  clientSiren: "552100554",
  operationCategory: "services",
  items: [{ description: "Travaux", quantity: 1, unitPrice: 1000, taxRate: 20 }],
  createdAt: "2026-09-01T10:00:00Z",
  dueDate: "2026-09-30T10:00:00Z",
};

function mentions(seller: InvoiceSeller, facture: InvoiceRecord = FACTURE): string[] {
  return buildInvoiceDocument(facture, seller).legalMentions;
}
function avertissements(seller: InvoiceSeller, facture: InvoiceRecord = FACTURE): string[] {
  return buildInvoiceDocument(facture, seller).warnings;
}

describe("l'assurance professionnelle est exigee en bloc", () => {
  it("les six informations completes produisent la mention", () => {
    const m = mentionAssurance(VENDEUR);
    expect(m).not.toBeNull();
    expect(m).toContain("Assurance professionnelle");
    expect(m).toContain("AXA France IARD");
    expect(m).toContain("RCD-2026-889041");
    expect(m).toContain("Maconnerie, platrerie, carrelage");
    expect(m).toContain("France metropolitaine et DOM");
  });

  it("il suffit qu'UNE information manque pour qu'aucune mention ne sorte", () => {
    // Le coeur de la regle. Une mention partielle donnerait l'illusion d'etre
    // en regle alors que la DGCCRF caracterise le manquement sur l'omission
    // d'un seul element.
    for (const champ of [
      "assuranceNom", "assuranceAdresse", "assuranceContrat",
      "assuranceActivites", "assuranceZone",
    ] as const) {
      const ampute = { ...VENDEUR, [champ]: null };
      expect(mentionAssurance(ampute), `${champ} manquant`).toBeNull();
    }
  });

  it("une chaine vide ou d'espaces ne vaut pas une information", () => {
    // Un champ rempli d'espaces est la maniere la plus courante de passer un
    // controle de presence sans rien avoir renseigne.
    expect(mentionAssurance({ ...VENDEUR, assuranceContrat: "" })).toBeNull();
    expect(mentionAssurance({ ...VENDEUR, assuranceContrat: "   " })).toBeNull();
  });

  it("la mention apparait dans les mentions legales de la facture", () => {
    expect(mentions(VENDEUR).some((m) => m.includes("Assurance professionnelle"))).toBe(true);
  });

  it("son absence est signalee, la facture restant emise", () => {
    const doc = buildInvoiceDocument(FACTURE, { ...VENDEUR, assuranceContrat: null });
    expect(doc.warnings.some((w) => /assurance professionnelle/i.test(w))).toBe(true);
    // La facture existe malgre tout: bloquer la production ferait plus de
    // degats que l'amende qu'on cherche a eviter.
    expect(doc.reference).toBe("F-2026-0001");
    expect(doc.lines.length).toBeGreaterThan(0);
  });
});

describe("le mediateur de la consommation", () => {
  it("le nom seul suffit a produire la mention", () => {
    // L'adresse et l'URL sont utiles mais c'est l'identite du mediateur qui
    // permet au consommateur de le saisir.
    const m = mentionMediateur({ mediateurNom: "CNPM" });
    expect(m).not.toBeNull();
    expect(m).toContain("CNPM");
  });

  it("la mention dit au consommateur que la saisine est gratuite", () => {
    expect(mentionMediateur(VENDEUR)).toMatch(/gratuit/i);
  });

  it("l'adresse et l'URL sont reprises quand elles existent", () => {
    const m = mentionMediateur(VENDEUR)!;
    expect(m).toContain("97200 Fort-de-France");
    expect(m).toContain("https://cnpm-mediation-consommation.eu");
  });

  it("sans mediateur, un avertissement est emis", () => {
    const w = avertissements({ ...VENDEUR, mediateurNom: null });
    expect(w.some((x) => /mediateur/i.test(x))).toBe(true);
  });

  it("avec mediateur, plus aucun avertissement a son sujet", () => {
    // L'erreur symetrique compte: un avertissement qui ne disparait jamais
    // cesse d'etre lu, et emporte les autres avec lui.
    expect(avertissements(VENDEUR).some((x) => /mediateur/i.test(x))).toBe(false);
  });
});

describe("le plafond legal du delai de paiement", () => {
  it("le plafond retenu est celui du Code de commerce", () => {
    expect(PLAFOND_DELAI_PAIEMENT_JOURS).toBe(60);
  });

  it("un delai de 30 jours ne declenche rien", () => {
    const w = avertissements(VENDEUR, {
      ...FACTURE, createdAt: "2026-09-01T10:00:00Z", dueDate: "2026-10-01T10:00:00Z",
    });
    expect(w.some((x) => /delai de paiement/i.test(x))).toBe(false);
  });

  it("exactement 60 jours passe encore", () => {
    // La borne compte: signaler a 60 jours ferait crier au loup sur le delai
    // maximal parfaitement legal.
    const w = avertissements(VENDEUR, {
      ...FACTURE, createdAt: "2026-09-01T10:00:00Z", dueDate: "2026-10-31T10:00:00Z",
    });
    expect(w.some((x) => /delai de paiement/i.test(x))).toBe(false);
  });

  it("90 jours est signale, avec le nombre de jours", () => {
    const w = avertissements(VENDEUR, {
      ...FACTURE, createdAt: "2026-09-01T10:00:00Z", dueDate: "2026-11-30T10:00:00Z",
    });
    const ligne = w.find((x) => /delai de paiement/i.test(x));
    expect(ligne, "un delai de 90 jours n'a pas ete signale").toBeTruthy();
    expect(ligne).toContain("90 jours");
    expect(ligne).toContain("L441-10");
  });

  it("une facture sans echeance ne declenche pas CE reproche", () => {
    // Elle en declenche un autre — l'echeance est elle-meme obligatoire — et
    // les deux ne doivent pas se confondre.
    const w = avertissements(VENDEUR, { ...FACTURE, dueDate: null });
    expect(w.some((x) => /delai de paiement/i.test(x))).toBe(false);
    expect(w.some((x) => /echeance/i.test(x))).toBe(true);
  });

  it("une echeance anterieure a l'emission ne declenche pas non plus", () => {
    // Un delai negatif n'est pas un depassement de plafond; le signaler
    // comme tel enverrait l'utilisateur chercher au mauvais endroit.
    const w = avertissements(VENDEUR, {
      ...FACTURE, createdAt: "2026-09-01T10:00:00Z", dueDate: "2026-08-01T10:00:00Z",
    });
    expect(w.some((x) => /delai de paiement/i.test(x))).toBe(false);
  });
});

describe("un vendeur complet ne produit aucun reproche", () => {
  it("aucun avertissement quand tout est renseigne", () => {
    // Garde-fou global: si cette liste n'est jamais vide, les avertissements
    // deviennent du bruit et personne ne les lit plus.
    expect(avertissements(VENDEUR)).toEqual([]);
  });
});
