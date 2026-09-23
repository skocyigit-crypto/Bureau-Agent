/**
 * L'ecran des depenses : saisir un IBAN, produire la remise de virements.
 *
 * Le serveur sait produire le fichier ; sans champ pour l'IBAN et sans bouton,
 * la fonction n'existe pas pour l'utilisateur. La lecon vient de la double
 * authentification, dont les routes ont vecu des mois sans ecran.
 *
 * Un point de FOND est verifie ici : le libelle ne doit pas laisser croire
 * qu'un paiement a ete fait. Produire un fichier n'est pas payer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const ECRAN = SRC("pages", "depenses.tsx");
const LANGUES = ["fr", "en", "es", "de", "tr", "ar"] as const;
const locale = (l: string) => JSON.parse(SRC("i18n", "locales", `${l}.json`)) as Record<string, any>;

describe("la remise se declenche depuis l'ecran", () => {
  it("le bouton appelle la route du serveur, en POST", () => {
    const i = ECRAN.indexOf("const remiseSepa");
    expect(i, "la fonction de remise est absente").toBeGreaterThan(0);
    const corps = ECRAN.slice(i, i + 1400);
    expect(corps).toContain("/api/depenses/virement-sepa");
    expect(corps).toContain('method: "POST"');
    expect(corps).toContain('credentials: "include"');
  });

  it("elle n'envoie que les depenses a payer qui portent un IBAN", () => {
    const i = ECRAN.indexOf("const remiseSepa");
    expect(ECRAN.slice(i, i + 400)).toMatch(/paymentStatus === "a_payer" && d\.vendorIban/);
  });

  it("le fichier est propose au telechargement, puis l'URL est liberee", () => {
    const i = ECRAN.indexOf("const remiseSepa");
    const corps = ECRAN.slice(i, i + 1600);
    expect(corps).toContain("URL.createObjectURL");
    expect(corps).toContain("URL.revokeObjectURL");
    expect(corps).toMatch(/download = `virements_/);
  });

  it("la remise est confirmee avant d'etre produite", () => {
    const i = ECRAN.indexOf("const remiseSepa");
    const corps = ECRAN.slice(i, i + 700);
    expect(corps).toContain("if (!(await confirmAction({");
    expect(corps.indexOf("confirmAction")).toBeLessThan(corps.indexOf("fetch("));
  });

  it("un refus du serveur nomme les fournisseurs en cause", () => {
    // Le serveur rend la liste des depenses sans IBAN : la taire obligerait a
    // les chercher une par une.
    const i = ECRAN.indexOf("const remiseSepa");
    expect(ECRAN.slice(i, i + 1400)).toMatch(/depenses\.map\(\(x: \{ fournisseur: string \}\) => x\.fournisseur\)/);
  });

  it("le bouton n'apparait pas quand il n'y a rien a payer", () => {
    expect(ECRAN).toMatch(/tab === "ledger" && payables\.length > 0 && \(/);
  });
});

describe("la saisie des coordonnees bancaires", () => {
  it("les deux champs existent et sont relies a leur etiquette", () => {
    for (const id of ["depense-iban", "depense-bic"]) {
      expect(ECRAN, `champ ${id}`).toContain(`<Input id="${id}"`);
      expect(ECRAN, `etiquette ${id}`).toContain(`htmlFor="${id}"`);
    }
  });

  it("l'aide de saisie de l'IBAN est reliee par aria-describedby", () => {
    expect(ECRAN).toContain('aria-describedby="depense-iban-aide"');
    expect(ECRAN).toContain('id="depense-iban-aide"');
  });

  it("le formulaire transporte l'IBAN dans les deux sens", () => {
    expect(ECRAN).toContain("vendorIban: d.vendorIban ||");
    expect(ECRAN).toMatch(/interface EditForm \{[\s\S]{0,120}vendorIban: string;/);
  });
});

describe("ce que les libelles promettent", () => {
  for (const l of LANGUES) {
    it(`${l} : les libelles existent`, () => {
      const v = locale(l).depenses?.virement;
      expect(v, `depenses.virement absent en ${l}`).toBeTruthy();
      for (const c of ["generate", "generateFor", "confirmTitle", "confirmDesc", "ready", "readyDesc", "error"]) {
        expect(String(v[c] ?? ""), `${l}.${c}`).not.toBe("");
      }
      const f = locale(l).depenses?.form;
      for (const c of ["vendorIban", "vendorIbanHint", "vendorBic"]) {
        expect(String(f?.[c] ?? ""), `${l}.form.${c}`).not.toBe("");
      }
      expect(v.generateFor).toContain("{{count}}");
      expect(v.confirmDesc).toContain("{{count}}");
    });
  }

  it("aucun libelle n'annonce un paiement : le fichier se depose a la banque", () => {
    // Un « paiement effectue » serait faux : rien n'est paye tant que la
    // banque n'a pas execute la remise, et la depense reste « a payer ».
    for (const l of LANGUES) {
      const v = locale(l).depenses.virement;
      expect(String(v.ready).toLowerCase(), l).not.toMatch(/paye(e|es)?\b|paid|odendi|bezahlt|pagado|مدفوع/);
    }
    expect(String(locale("fr").depenses.virement.readyDesc)).toMatch(/banque/i);
    expect(String(locale("fr").depenses.virement.confirmDesc)).toMatch(/rien n'est paye/i);
  });
});
