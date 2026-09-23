/**
 * Le fichier de virements remis a la banque (pain.001.001.09).
 *
 * Une remise se juge sur deux choses : la banque l'accepte, et elle paie les
 * bonnes personnes. Les controles portent donc sur la STRUCTURE (la banque
 * rejette en bloc un fichier mal forme, sans dire quelle ligne l'a fait
 * tomber) et sur les MONTANTS (le total de controle est ce que la banque
 * verifie avant d'executer).
 *
 * Le XML est relu par un vrai parseur, jamais par une expression reguliere :
 * un test qui se contenterait de chercher une chaine validerait une balise
 * jamais fermee.
 */
import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import {
  type BeneficiaireVirement,
  ErreurVirement, bicValide, construireVirementSepa, ibanValide, normaliserIban,
} from "../services/virement-sepa";

// `parseTagValue: false` : sans cela le parseur rend 300.3 pour « 300.30 » et
// masquerait justement le defaut qu'on cherche — la banque, elle, lit le texte.
const parseur = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, parseAttributeValue: false });

// IBAN de test : cles 97 verifiees a la main avant d'etre ecrites ici.
const IBAN_ENTREPRISE = "FR7630006000011234567890189";
const IBAN_FOURNISSEUR = "FR1420041010050500013M02606";
const IBAN_SOUS_TRAITANT = "DE89370400440532013000";

const demandeType = (beneficiaires: BeneficiaireVirement[] = [
  { reference: "DEP-1", nom: "Materiaux du Sud", iban: IBAN_FOURNISSEUR, montant: 1234.56, libelle: "Facture F-2026-118" },
]) => ({
  donneur: { nom: "Ajant Bureau SAS", iban: IBAN_ENTREPRISE, bic: "AGRIFRPP" },
  beneficiaires,
  dateExecution: "2026-10-05",
  maintenant: new Date("2026-09-23T08:30:00.000Z"),
  identifiantRemise: "REMISE-2026-09-23-1",
});

const doc = (xml: string) => parseur.parse(xml).Document.CstmrCdtTrfInitn;
const transactions = (xml: string) => {
  const t = doc(xml).PmtInf.CdtTrfTxInf;
  return Array.isArray(t) ? t : [t];
};

describe("IBAN", () => {
  it("accepte des IBAN reels, quelle que soit leur mise en forme", () => {
    expect(ibanValide(IBAN_ENTREPRISE)).toBe(true);
    expect(ibanValide("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(ibanValide("fr76-3000-6000-0112-3456-7890-189")).toBe(true);
    expect(ibanValide(IBAN_SOUS_TRAITANT), "un IBAN allemand, la zone SEPA depasse la France").toBe(true);
  });

  it("refuse un chiffre change : c'est tout l'interet de la cle", () => {
    // Une faute de frappe ne revient pas : l'argent part chez quelqu'un d'autre.
    expect(ibanValide("FR7630006000011234567890188")).toBe(false);
    expect(ibanValide("FR7630006000011234567890179")).toBe(false);
  });

  it("refuse ce qui n'a pas la forme d'un IBAN", () => {
    for (const mauvais of ["", "FR76", "1234567890", "FRXX30006000011234567890189", "FR76 3000 !!!"]) {
      expect(ibanValide(mauvais), mauvais).toBe(false);
    }
  });

  it("la normalisation ne garde que les caracteres utiles", () => {
    expect(normaliserIban(" fr76 3000-6000 ")).toBe("FR7630006000");
  });

  it("le BIC accepte les deux longueurs de la norme", () => {
    expect(bicValide("AGRIFRPP")).toBe(true);
    expect(bicValide("AGRIFRPPXXX")).toBe(true);
    expect(bicValide("AGRIFR")).toBe(false);
    expect(bicValide("1GRIFRPP")).toBe(false);
  });
});

describe("le fichier produit", () => {
  it("est un XML pain.001.001.09 valide, relu par un parseur", () => {
    const { xml } = construireVirementSepa(demandeType());
    const document = parseur.parse(xml).Document;
    expect(document["@_xmlns"]).toBe("urn:iso:std:iso:20022:tech:xsd:pain.001.001.09");
    expect(document.CstmrCdtTrfInitn.GrpHdr.MsgId).toBe("REMISE-2026-09-23-1");
  });

  it("porte le nombre et le total de controle, en-tete et remise", () => {
    const { xml, nombre, total } = construireVirementSepa(demandeType([
      { reference: "A", nom: "Alpha", iban: IBAN_FOURNISSEUR, montant: 100.10 },
      { reference: "B", nom: "Beta", iban: IBAN_SOUS_TRAITANT, montant: 200.20 },
    ]));
    const d = doc(xml);
    expect(nombre).toBe(2);
    expect(total).toBe("300.30");
    expect(String(d.GrpHdr.NbOfTxs)).toBe("2");
    expect(String(d.GrpHdr.CtrlSum)).toBe("300.30");
    // La banque compare les deux : un ecart fait rejeter la remise entiere.
    expect(String(d.PmtInf.NbOfTxs)).toBe("2");
    expect(String(d.PmtInf.CtrlSum)).toBe("300.30");
  });

  it("additionne en centimes : 0.1 + 0.2 ne doit pas faire 0.30000000000000004", () => {
    const { total } = construireVirementSepa(demandeType([
      { reference: "A", nom: "Alpha", iban: IBAN_FOURNISSEUR, montant: 0.1 },
      { reference: "B", nom: "Beta", iban: IBAN_SOUS_TRAITANT, montant: 0.2 },
    ]));
    expect(total).toBe("0.30");
  });

  it("donne a chaque paiement sa reference de bout en bout, pour le rapprochement", () => {
    const { xml } = construireVirementSepa(demandeType([
      { reference: "DEP-42", nom: "Alpha", iban: IBAN_FOURNISSEUR, montant: 10, libelle: "F-2026-42" },
    ]));
    const t = transactions(xml)[0];
    expect(t.PmtId.EndToEndId).toBe("DEP-42");
    expect(t.RmtInf.Ustrd).toBe("F-2026-42");
    expect(t.Amt.InstdAmt["@_Ccy"]).toBe("EUR");
    expect(String(t.Amt.InstdAmt["#text"])).toBe("10.00");
    expect(t.CdtrAcct.Id.IBAN).toBe(IBAN_FOURNISSEUR);
  });

  it("sans BIC, la remise reste valide : le BIC n'est plus exige en SEPA", () => {
    const { xml } = construireVirementSepa({
      ...demandeType([{ reference: "A", nom: "Alpha", iban: IBAN_FOURNISSEUR, montant: 10 }]),
      donneur: { nom: "Ajant Bureau SAS", iban: IBAN_ENTREPRISE },
    });
    expect(doc(xml).PmtInf.DbtrAgt.FinInstnId.Othr.Id).toBe("NOTPROVIDED");
    expect(transactions(xml)[0].CdtrAgt).toBeUndefined();
  });

  it("l'apostrophe et l'esperluette d'un nom d'entreprise ne cassent pas le fichier", () => {
    const { xml } = construireVirementSepa(demandeType([
      { reference: "A", nom: "Dupont & Fils <SARL> d'Oc", iban: IBAN_FOURNISSEUR, montant: 10 },
    ]));
    // Le parseur rend le texte d'origine : l'echappement a tenu.
    expect(transactions(xml)[0].Cdtr.Nm).toBe("Dupont & Fils <SARL> d'Oc");
  });

  it("borne les longueurs de la norme au lieu de faire rejeter la remise", () => {
    const { xml } = construireVirementSepa(demandeType([
      { reference: "R".repeat(60), nom: "N".repeat(120), iban: IBAN_FOURNISSEUR, montant: 10, libelle: "L".repeat(200) },
    ]));
    const t = transactions(xml)[0];
    expect(String(t.Cdtr.Nm).length).toBe(70);
    expect(String(t.PmtId.EndToEndId).length).toBe(35);
    expect(String(t.RmtInf.Ustrd).length).toBe(140);
  });

  it("la date d'execution est celle demandee", () => {
    const { xml } = construireVirementSepa(demandeType());
    expect(doc(xml).PmtInf.ReqdExctnDt.Dt).toBe("2026-10-05");
    expect(doc(xml).PmtInf.PmtTpInf.SvcLvl.Cd).toBe("SEPA");
    expect(doc(xml).PmtInf.ChrgBr).toBe("SLEV");
  });
});

describe("ce que la remise refuse de produire", () => {
  const echoue = (demande: Parameters<typeof construireVirementSepa>[0], motif: RegExp) => {
    let erreur: unknown;
    try { construireVirementSepa(demande); } catch (e) { erreur = e; }
    expect(erreur, "aucune erreur levee").toBeInstanceOf(ErreurVirement);
    expect((erreur as ErreurVirement).message).toMatch(motif);
  };

  it("un IBAN de beneficiaire faux arrete tout le fichier", () => {
    // Une remise a moitie juste est rejetee EN BLOC par la banque : mieux vaut
    // nommer la ligne fautive ici que chercher dans un rejet bancaire.
    echoue(demandeType([{ reference: "A", nom: "Alpha", iban: "FR7630006000011234567890188", montant: 10 }]), /IBAN invalide pour Alpha/);
  });

  it("l'IBAN de l'entreprise est verifie aussi, et renvoie aux parametres", () => {
    echoue({ ...demandeType(), donneur: { nom: "X", iban: "FR00" } }, /IBAN de l'entreprise/);
  });

  it("un montant nul, negatif ou absurde ne part pas", () => {
    for (const montant of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      echoue(demandeType([{ reference: "A", nom: "Alpha", iban: IBAN_FOURNISSEUR, montant }]), /Montant invalide/);
    }
  });

  it("deux lignes de meme reference sont refusees : le rapprochement serait ambigu", () => {
    echoue(demandeType([
      { reference: "DEP-7", nom: "Alpha", iban: IBAN_FOURNISSEUR, montant: 10 },
      { reference: "DEP-7", nom: "Beta", iban: IBAN_SOUS_TRAITANT, montant: 20 },
    ]), /Deux paiements portent la reference DEP-7/);
  });

  it("un beneficiaire sans nom, une date mal ecrite, une remise vide", () => {
    echoue(demandeType([{ reference: "A", nom: "   ", iban: IBAN_FOURNISSEUR, montant: 10 }]), /sans nom/);
    echoue({ ...demandeType(), dateExecution: "05/10/2026" }, /AAAA-MM-JJ/);
    echoue(demandeType([]), /Aucun paiement/);
  });

  it("un BIC malforme est refuse avant d'atteindre la banque", () => {
    echoue(demandeType([{ reference: "A", nom: "Alpha", iban: IBAN_FOURNISSEUR, bic: "FR76", montant: 10 }]), /BIC invalide pour Alpha/);
  });
});
