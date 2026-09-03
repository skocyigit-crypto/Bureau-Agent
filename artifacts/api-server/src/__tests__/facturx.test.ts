import { describe, expect, it } from "vitest";

import {
  FACTURX_PROFILE_BASIC,
  buildFacturXXml,
  parseAddress,
} from "../services/facturx";

/**
 * Factur-X — ce que le XML DOIT contenir.
 *
 * Une facture electronique se trompe en silence. Elle part, le serveur repond
 * 200, l'ecran affiche un PDF correct — et c'est le receveur qui rejette,
 * parfois des semaines plus tard, parfois sans le dire. Rien du cote emetteur
 * ne fait de bruit. C'est exactement le profil de defaut que ce depot attrape
 * par des tests plutot que par de la relecture.
 *
 * Trois familles de risques sont verrouillees ici:
 *
 *  1. Le PDF et le XML doivent porter les MEMES montants. Ils sont produits
 *     par deux chemins differents; le jour ou l'un recalculera de son cote,
 *     l'ecart ne se verra sur aucun ecran.
 *  2. La categorie de TVA dit QUI doit la taxe. Une autoliquidation annoncee
 *     « S » au lieu de « AE » fausse la comptabilite du client, pas la notre,
 *     et le PDF continuera d'afficher la bonne mention en francais.
 *  3. Le XML doit rester du XML. Un nom de societe contenant « & » suffit a
 *     produire un document que le receveur jette en bloc.
 */

const SELLER: Record<string, string | null> = {
  name: "SK GROUP",
  legalForm: "SAS",
  capital: "10 000 EUR",
  address: "17 rue Saint-Exupery\n67500 Haguenau",
  siret: "12345678901234",
  tvaNumber: "FR12345678901",
  email: "contact@example.fr",
  phone: "+33 3 88 00 00 00",
};

const INVOICE = {
  reference: "FA-2026-0042",
  clientName: "Jean Client",
  clientCompany: "ACME SARL",
  clientAddress: "5 avenue des Tilleuls\n75011 Paris",
  currency: "EUR",
  createdAt: new Date("2026-09-03T08:00:00Z"),
  dueDate: new Date("2026-10-03T00:00:00Z"),
  items: [
    { description: "Prestation de conseil", quantity: 2, unitPrice: 500, taxRate: 20 },
    { description: "Fourniture", quantity: 1, unitPrice: 100, taxRate: 5.5 },
  ],
};

const NOW = new Date("2026-09-03T10:00:00Z");

function build(overrides: Record<string, unknown> = {}, seller = SELLER) {
  return buildFacturXXml({ ...INVOICE, ...overrides } as never, seller as never, NOW);
}

/** Contenu textuel de la premiere occurrence d'une balise. */
function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return m ? m[1]! : null;
}

function all(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))].map((m) => m[1]!);
}

describe("enveloppe du document", () => {
  it("declare le profil BASIC, seul profil annonce et tenu", () => {
    const { xml, profile } = build();
    // Annoncer EN 16931 sans en fournir les champs ferait attendre au receveur
    // des donnees qui n'arriveront pas.
    expect(profile).toBe(FACTURX_PROFILE_BASIC);
    expect(xml).toContain(`<ram:ID>${FACTURX_PROFILE_BASIC}</ram:ID>`);
  });

  it("porte le numero de facture, le type 380 et la date au format 102", () => {
    const { xml } = build();
    expect(pick(xml, "ram:ID")).toBe(FACTURX_PROFILE_BASIC); // le premier est le profil
    expect(xml).toContain("<ram:ID>FA-2026-0042</ram:ID>");
    expect(pick(xml, "ram:TypeCode")).toBe("380");
    // Format 102 = AAAAMMJJ. Une date ISO complete serait refusee.
    expect(xml).toContain('<udt:DateTimeString format="102">20260903</udt:DateTimeString>');
  });

  it("place l'echeance quand elle existe, et l'omet sinon", () => {
    expect(build().xml).toContain('format="102">20261003<');
    // Un element de conditions de paiement vide serait invalide: mieux vaut
    // ne pas l'emettre du tout.
    expect(build({ dueDate: null }).xml).not.toContain("SpecifiedTradePaymentTerms");
  });
});

describe("identification des parties", () => {
  it("donne le SIRET sous le schema 0002 et la TVA sous le schema VA", () => {
    const { xml } = build();
    // Ces schemeID ne sont pas decoratifs: ils disent au receveur COMMENT
    // interpreter le numero. Un SIRET annonce sans 0002 n'est qu'une chaine.
    expect(xml).toContain('<ram:ID schemeID="0002">12345678901234</ram:ID>');
    expect(xml).toContain('<ram:ID schemeID="FR12345678901</ram:ID>'.replace("FR", 'VA">FR'));
  });

  it("omet l'identification legale plutot que d'emettre un SIRET vide", () => {
    const { xml, warnings } = build({}, { ...SELLER, siret: null });
    expect(xml).not.toContain("SpecifiedLegalOrganization");
    expect(warnings.some((w) => w.includes("SIRET"))).toBe(true);
  });

  it("structure les adresses et impose un code pays", () => {
    const { xml } = build();
    expect(xml).toContain("<ram:PostcodeCode>67500</ram:PostcodeCode>");
    expect(xml).toContain("<ram:CityName>Haguenau</ram:CityName>");
    expect(xml).toContain("<ram:PostcodeCode>75011</ram:PostcodeCode>");
    // BR-09: le code pays est obligatoire. FR est l'hypothese sure ici.
    expect(all(xml, "ram:CountryID")).toEqual(["FR", "FR"]);
  });

  it("signale une adresse qu'il n'a pas su structurer, au lieu d'inventer", () => {
    // Un code postal devine faux voyage jusque dans la comptabilite du client.
    const { warnings } = build({ clientAddress: "chez Martin, au fond du chemin" });
    expect(warnings.some((w) => w.includes("client"))).toBe(true);
  });
});

describe("montants: le XML et le PDF disent la meme chose", () => {
  it("reprend les totaux calcules, sans les recalculer", () => {
    const { xml } = build();
    // 2 x 500 = 1000 HT a 20 % -> 200 ; 1 x 100 a 5,5 % -> 5,50
    expect(pick(xml, "ram:LineTotalAmount")).toBe("1000.00");
    expect(pick(xml, "ram:TaxBasisTotalAmount")).toBe("1100.00");
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">205.50</ram:TaxTotalAmount>');
    expect(pick(xml, "ram:GrandTotalAmount")).toBe("1305.50");
    expect(pick(xml, "ram:DuePayableAmount")).toBe("1305.50");
  });

  it("deduit l'acompte deja regle du montant restant du", () => {
    const { xml } = build({ paidAmount: 305.5 });
    expect(pick(xml, "ram:TotalPrepaidAmount")).toBe("305.50");
    expect(pick(xml, "ram:DuePayableAmount")).toBe("1000.00");
  });

  it("ventile la TVA par taux, un bloc par taux", () => {
    const { xml } = build();
    const rates = all(xml, "ram:RateApplicablePercent");
    // Deux au niveau document + un par ligne.
    expect(rates.filter((r) => r === "20")).toHaveLength(2);
    expect(rates.filter((r) => r === "5.5")).toHaveLength(2);
    // 20 et non 20.00: le format doit rester numerique, pas decoratif.
    expect(rates).not.toContain("20.00");
  });

  it("n'emet ni assiette ni montant de TVA au niveau ligne", () => {
    // La CII les interdit a ce niveau; les emettre fait rejeter au schema.
    const { xml } = build();
    const ligne = xml.slice(
      xml.indexOf("<ram:IncludedSupplyChainTradeLineItem>"),
      xml.indexOf("</ram:IncludedSupplyChainTradeLineItem>"),
    );
    expect(ligne).toContain("<ram:CategoryCode>S</ram:CategoryCode>");
    expect(ligne).not.toContain("BasisAmount");
    expect(ligne).not.toContain("CalculatedAmount");
  });

  it("numerote les lignes et code la quantite avec une unite", () => {
    const { xml } = build();
    expect(all(xml, "ram:LineID")).toEqual(["1", "2"]);
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">2.00</ram:BilledQuantity>');
  });
});

describe("categorie de TVA: qui doit la taxe", () => {
  it("code une facture ordinaire en S", () => {
    expect(all(build().xml, "ram:CategoryCode").every((c) => c === "S")).toBe(true);
  });

  it("code l'autoliquidation en AE, avec son motif", () => {
    // Le PDF affiche deja la mention en francais; le receveur, lui, ne lit que
    // ce code. Une autoliquidation annoncee « S » lui ferait deduire une TVA
    // qui n'a jamais ete facturee.
    const { xml } = build({ isAutoliquidation: true });
    expect(all(xml, "ram:CategoryCode").every((c) => c === "AE")).toBe(true);
    expect(xml).toContain("283-2 nonies");
    expect(pick(xml, "ram:GrandTotalAmount")).toBe("1100.00"); // TTC = HT
  });

  it("code la franchise en base en E, avec l'article qui la fonde", () => {
    const { xml } = build({
      items: [{ description: "Prestation", quantity: 1, unitPrice: 100, taxRate: 0 }],
    });
    expect(all(xml, "ram:CategoryCode").every((c) => c === "E")).toBe(true);
    expect(xml).toContain("293 B");
  });

  it("donne toujours un motif quand la categorie n'est pas S", () => {
    // BR-E-10 / BR-AE-10 / BR-Z-10: sans motif, le receveur ne peut pas
    // justifier sa propre declaration.
    for (const overrides of [{ isAutoliquidation: true }, {
      items: [{ description: "x", quantity: 1, unitPrice: 10, taxRate: 0 }],
    }]) {
      const { xml } = build(overrides);
      expect(xml).toContain("<ram:ExemptionReason>");
    }
  });
});

describe("le XML doit rester du XML", () => {
  it("echappe les caracteres qui casseraient le document", () => {
    const { xml } = build({
      clientCompany: 'Dupont & Fils <"SARL">',
      items: [{ description: "Conseil & audit", quantity: 1, unitPrice: 10, taxRate: 20 }],
    });
    expect(xml).toContain("Dupont &amp; Fils &lt;&quot;SARL&quot;&gt;");
    expect(xml).toContain("Conseil &amp; audit");
    // Aucune esperluette nue ne doit subsister.
    expect(xml).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
  });

  it("retire les caracteres de controle, interdits en XML 1.0", () => {
    const { xml } = build({ clientCompany: "ACME SARL" });
    expect(xml).toContain("ACME SARL");
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("produit un document analysable de bout en bout", () => {
    const { xml } = build();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);

    // On empile reellement les balises plutot que d'en compter deux especes.
    // Compter laisse passer le cas qui compte: deux erreurs qui s'annulent,
    // c'est-a-dire un document mal imbrique dont les totaux tombent juste.
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z]+:[A-Za-z]+)[^>]*?(\/?)>/g)) {
      const [, closing, name, selfClosing] = m;
      if (selfClosing === "/") continue;
      if (closing === "/") expect(stack.pop(), `</${name}> ferme la mauvaise balise`).toBe(name);
      else stack.push(name!);
    }
    expect(stack, "balises restees ouvertes").toEqual([]);
  });
});

describe("analyse d'adresse", () => {
  it("reconnait le pays en derniere ligne", () => {
    expect(parseAddress("1 rue X\n1000 Bruxelles\nBelgique").countryCode).toBe("BE");
    expect(parseAddress("1 rue X\n75000 Paris").countryCode).toBe("FR");
  });

  it("reconnait un code postal precede d'un prefixe pays", () => {
    const a = parseAddress("1 rue X\nF-67500 Haguenau");
    expect(a.postcode).toBe("67500");
    expect(a.city).toBe("Haguenau");
  });

  it("garde les lignes de voie separees de la localite", () => {
    const a = parseAddress("Batiment B\n17 rue Saint-Exupery\n67500 Haguenau");
    expect(a.lines).toEqual(["Batiment B", "17 rue Saint-Exupery"]);
  });

  it("ne devine rien quand il n'y a rien a deviner", () => {
    const a = parseAddress(null);
    expect(a).toEqual({ lines: [], postcode: null, city: null, countryCode: "FR" });
  });
});
