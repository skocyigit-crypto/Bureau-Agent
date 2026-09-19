/**
 * Trois defauts d'ecran, de la meme famille : un etat garde d'un enregistrement
 * a l'autre.
 *
 * 1. `organisations.tsx` — ouvrir la facturation ou le dossier juridique d'une
 *    organisation n'effacait pas ce qui avait ete charge pour la PRECEDENTE.
 *    Quand la lecture echouait, les factures ou les documents d'avant
 *    restaient affiches sous le nom de la nouvelle, et les actions — accepter
 *    un document, agir sur une facture — portaient sur eux.
 *
 * 2. `users.tsx` — le formulaire d'edition initialisait le telephone a `""`,
 *    et le serveur applique tout champ different de `undefined` : chaque
 *    modification d'un utilisateur EFFACAIT son numero. La liste ne renvoyait
 *    d'ailleurs pas ce champ, donc l'ecran ne pouvait pas le pre-remplir.
 *
 * 3. `organisations.tsx` — le montant en tete d'une facture affichait
 *    `totalAmount`, qui est le HORS TAXES (le schema le dit explicitement) :
 *    20 % de moins que la somme reclamee.
 *
 * Ces controles lisent la SOURCE. Ils ne prouvent pas le rendu, mais ils
 * verrouillent exactement les lignes qui portaient le defaut — et le sabotage
 * les fait tomber.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dirname, "..");
const organisations = readFileSync(join(src, "pages", "organisations.tsx"), "utf8");
const utilisateurs = readFileSync(join(src, "pages", "users.tsx"), "utf8");
const authServeur = readFileSync(
  join(src, "..", "..", "api-server", "src", "routes", "auth.ts"), "utf8",
);

describe("les fenetres ne gardent plus l'organisation precedente", () => {
  const ouvrirFacturation = organisations.slice(
    organisations.indexOf("const openBilling"),
    organisations.indexOf("const handleCreate"),
  );
  const ouvrirJuridique = organisations.slice(
    organisations.indexOf("const openLegalDetail"),
    organisations.indexOf("const handleAcceptDocument"),
  );

  it("la facturation efface les factures d'avant", () => {
    expect(
      ouvrirFacturation,
      "sinon les factures d'une autre entreprise s'affichent sous ce nom",
    ).toMatch(/setOrgBilling\(null\)/);
  });

  it("le dossier juridique efface les documents d'avant", () => {
    expect(ouvrirJuridique).toMatch(/setLegalDetailDocs\(\[\]\)/);
  });

  it("une lecture qui echoue est signalee, pas silencieuse", () => {
    expect(ouvrirFacturation).toMatch(/setBillingErreur\(true\)/);
    expect(ouvrirJuridique).toMatch(/setLegalDetailErreur\(true\)/);
  });

  it("le `else` manquant sur `res.ok` est comble des deux cotes", () => {
    // C'est lui qui laissait l'ancien contenu en place sans rien dire.
    expect(ouvrirFacturation).toMatch(/\}\s*else\s*\{/);
    expect(ouvrirJuridique).toMatch(/\}\s*else\s*\{/);
  });

  it("l'ecran a de quoi afficher cet echec", () => {
    expect(organisations).toMatch(/chargementEchoue/);
  });
});

describe("modifier un utilisateur n'efface plus son telephone", () => {
  it("le formulaire part du numero existant", () => {
    expect(
      utilisateurs,
      "initialise a « », il etait envoye vide — et le serveur l'appliquait",
    ).not.toMatch(/departement: user\.departement \|\| "", telephone: "" \}/);
  });

  it("il le lit sur l'utilisateur", () => {
    expect(utilisateurs).toMatch(/telephone: user\.telephone \|\| ""/);
  });

  it("le type de l'ecran connait ce champ", () => {
    expect(utilisateurs).toMatch(/telephone: string \| null;/);
  });

  it("et la liste du serveur le renvoie enfin", () => {
    // Sans cela, l'ecran n'a rien a pre-remplir: le correctif cote client
    // seul ne suffirait pas.
    const liste = authServeur.slice(
      authServeur.indexOf("const users = await db.select({"),
      authServeur.indexOf("res.json({ users, total: users.length });"),
    );
    expect(liste).toMatch(/telephone: usersTable\.telephone/);
  });
});

describe("le montant d'une facture est celui qui est reclame", () => {
  it("le hors taxes n'est plus affiche en tete", () => {
    const enTete = organisations.slice(
      organisations.indexOf("Le montant en tete est ce que le client DOIT"),
      organisations.indexOf("billingDialog.forfait"),
    );
    expect(enTete, "le HT montre 20 % de moins que la somme reclamee").toMatch(/inv\.totalTtc/);
  });

  it("les factures anterieures a la TVA restent lisibles", () => {
    // Leur `totalTtc` vaut zero: afficher zero serait un autre mensonge.
    expect(organisations).toMatch(/Number\(inv\.totalTtc \?\? 0\) > 0 \? Number\(inv\.totalTtc\) : Number\(inv\.totalAmount\)/);
  });

  it("le type porte la distinction, pour qu'elle ne se reperde pas", () => {
    expect(organisations).toMatch(/Total HORS TAXES/);
    expect(organisations).toMatch(/totalTtc\?: string;/);
  });
});
