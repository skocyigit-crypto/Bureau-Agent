/**
 * Ce que la page de tarifs promet doit exister dans le produit.
 *
 * Trois affirmations vendaient ce que le produit ne fait pas, et deux d'entre
 * elles etaient dementies par notre propre code:
 *
 *   - « Appels illimites » et « 50 000 contacts illimites » alors que le
 *     moteur de facturation facture le depassement (3 € par tranche de 100
 *     appels, 2 € par tranche de 100 contacts). Promettre sans limite ce qu'on
 *     fait payer au-dela d'une limite;
 *   - « SLA Garanti 99.9% » alors que l'article 6 des CGV pose que « l'editeur
 *     ne souscrit aucun engagement chiffre de disponibilite »;
 *   - « Support prioritaire 24/7 » alors que les memes CGV decrivent un support
 *     joignable par e-mail, sans plage horaire souscrite.
 *
 * En cas de contradiction entre la page et le contrat, c'est l'interpretation
 * favorable au client qui prevaut (art. 1190 du Code civil): le chiffre affiche
 * pouvait etre oppose a l'editeur.
 *
 * Ce test tient la page et les plafonds ensemble. Un plafond qui change dans
 * `PLANS` sans que la page suive redeviendrait un mensonge — silencieux, parce
 * que rien d'autre ne les compare.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les plafonds sont lus dans la SOURCE du schema, pas importes.
 *
 * Le site vitrine ne depend pas de `@workspace/db` et n'a aucune raison d'en
 * dependre: c'est une page de presentation, pas l'application. Mais la verite
 * des chiffres vit la-bas, et un test qui recopierait les valeurs ne
 * verifierait que sa propre copie.
 */
const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, "../../../../lib/db/src/schema/subscriptions.ts"),
  "utf8",
);

type Plan = { maxUsers: number; maxContacts: number; maxCallsPerMonth: number; price: number };

function lirePlan(cle: string): Plan {
  // Decoupage par bornes de texte plutot que par expression reguliere
  // construite a la volee: le bloc d'un plan va de sa cle a l'accolade
  // fermante en debut de ligne, et cela se lit sans echappement douteux.
  const debut = SCHEMA.indexOf(`  ${cle}: {`);
  if (debut < 0) throw new Error(`plan introuvable dans le schema: ${cle}`);
  const fin = SCHEMA.indexOf("\n  },", debut);
  const bloc = SCHEMA.slice(debut, fin < 0 ? undefined : fin);

  const nombre = (champ: string): number => {
    const ligne = bloc.split("\n").find((l) => l.trim().startsWith(`${champ}:`));
    const valeur = ligne?.match(/(-?\d+(?:\.\d+)?)/)?.[1];
    if (valeur === undefined) throw new Error(`${champ} introuvable pour ${cle}`);
    return Number(valeur);
  };
  return {
    maxUsers: nombre("maxUsers"),
    maxContacts: nombre("maxContacts"),
    maxCallsPerMonth: nombre("maxCallsPerMonth"),
    price: nombre("price"),
  };
}

const PLANS: Record<string, Plan> = {
  starter: lirePlan("starter"),
  professionnel: lirePlan("professionnel"),
  entreprise: lirePlan("entreprise"),
};

const PAGE = fs.readFileSync(
  path.resolve(__dirname, "home.tsx"),
  "utf8",
);

/** Le texte affiche, commentaires retires: un commentaire ne vend rien. */
const TEXTE = PAGE.replace(/\/\/[^\n]*/g, "").replace(/\/\*[^]*?\*\//g, "");

/** « 100000 » s'ecrit « 100 000 » sur la page, avec une espace insecable ou non. */
function formats(n: number): string[] {
  const brut = String(n);
  const groupe = brut.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return [brut, groupe, groupe.replace(/ /g, " "), groupe.replace(/ /g, "&nbsp;")];
}

describe("la page de tarifs dit la verite", () => {
  it("ne promet rien d'illimite", () => {
    // Aucun plan n'est illimite: les trois ont un plafond, et le depassement
    // est facture. Le mot n'a donc aucune place ici.
    const occurrences = TEXTE.match(/illimit/gi) ?? [];
    expect(
      occurrences,
      "un plan annonce « illimite » alors que le moteur de facturation facture le depassement",
    ).toEqual([]);
  });

  it("n'annonce pas de disponibilite chiffree que les CGV refusent", () => {
    const cgv = fs.readFileSync(path.resolve(__dirname, "cgv.tsx"), "utf8");
    const cgvPromet = /99[.,]9/.test(cgv);
    const pagePromet = /99[.,]9/.test(TEXTE);
    expect(
      pagePromet && !cgvPromet,
      "la page affiche un taux de disponibilite que les CGV ne souscrivent pas",
    ).toBe(false);
  });

  it("n'annonce pas d'horaires de support que les CGV ne couvrent pas", () => {
    const cgv = fs.readFileSync(path.resolve(__dirname, "cgv.tsx"), "utf8");
    const cgvPromet = /24\s*\/\s*7/.test(cgv);
    const pagePromet = /24\s*\/\s*7/.test(TEXTE);
    expect(
      pagePromet && !cgvPromet,
      "la page annonce une permanence 24/7 absente des CGV",
    ).toBe(false);
  });

  it("affiche les plafonds reellement appliques", () => {
    // Le lien qui manquait: la page et `PLANS` vivaient chacun de leur cote.
    for (const cle of ["starter", "professionnel", "entreprise"] as const) {
      const plan = PLANS[cle];
      for (const [libelle, valeur] of [
        ["utilisateurs", plan.maxUsers],
        ["contacts", plan.maxContacts],
        ["appels", plan.maxCallsPerMonth],
      ] as const) {
        const present = formats(valeur).some((f) => TEXTE.includes(f));
        expect(
          present,
          `le plafond ${libelle} du plan ${cle} (${valeur}) ne figure pas sur la page`,
        ).toBe(true);
      }
    }
  });

  it("affiche les prix reellement factures", () => {
    for (const cle of ["starter", "professionnel", "entreprise"] as const) {
      expect(
        TEXTE.includes(`${PLANS[cle].price}€`),
        `le prix du plan ${cle} (${PLANS[cle].price} €) ne figure pas sur la page`,
      ).toBe(true);
    }
  });
});
