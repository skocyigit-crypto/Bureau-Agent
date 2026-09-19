/**
 * L'ecran Abonnement : personne ne pouvait resilier, et le montant etait faux.
 *
 * Deux defauts mesures le 19/09, sur le seul ecran ou un client gere ce qu'il
 * paie. Pour un produit mis en vente, ce sont les deux pires endroits.
 *
 * 1. LA REPONSE ETAIT LUE AU MAUVAIS NIVEAU. Le serveur repond
 *    `{ subscription: {...}, organisation }` (routes/subscriptions.ts) ;
 *    l'ecran stockait l'ENVELOPPE. Tous les champs lus ensuite — plan,
 *    statut, fin d'essai, cle de licence — valaient donc `undefined`, et
 *    surtout `subscription.stripeSubscriptionId` aussi. Or c'est lui qui
 *    conditionne l'affichage de « Gerer mon abonnement », « Annuler » et
 *    « Reprendre » : ces trois boutons ne s'affichaient JAMAIS. Aucun client
 *    ne pouvait resilier depuis le produit.
 *
 * 2. LE MONTANT AFFICHE ETAIT LE HORS TAXES. `invoices.totalAmount` porte le
 *    HT — le schema le dit explicitement, `totalTtc` etant « la somme
 *    reellement due ». Le client lisait donc 20 % de moins que ce qui avait
 *    ete preleve, sans la mention « HT » qui l'aurait averti.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const ecran = readFileSync(
  join(RACINE, "artifacts", "buro-ajani", "src", "pages", "settings", "tab-abonnement.tsx"), "utf8",
);
const routeServeur = readFileSync(
  join(RACINE, "artifacts", "api-server", "src", "routes", "subscriptions.ts"), "utf8",
);
const schemaFactures = readFileSync(
  join(RACINE, "lib", "db", "src", "schema", "invoices.ts"), "utf8",
);

describe("l'ecran lit la reponse au niveau ou le serveur l'ecrit", () => {
  it("le serveur enveloppe bien l'abonnement", () => {
    // Si le serveur cessait d'envelopper, le defaut disparaitrait et ce
    // controle n'aurait plus de raison d'etre: on le verrouille aussi.
    expect(routeServeur, "l'enveloppe a change de forme").toMatch(/res\.json\(\{\s*\n?\s*subscription: \{/);
  });

  it("l'ecran deballe l'enveloppe avant de stocker", () => {
    expect(
      ecran,
      "l'enveloppe etait stockee telle quelle: plan, statut et stripeSubscriptionId valaient undefined",
    ).toMatch(/corps\?\.subscription \?\? corps/);
  });

  it("il ne stocke plus la reponse brute", () => {
    expect(ecran).not.toMatch(/setSubscription\(await subRes\.json\(\)\)/);
  });

  it("les boutons de gestion dependent toujours de stripeSubscriptionId", () => {
    // C'est la condition que le defaut rendait fausse: si elle disparaissait,
    // le test ci-dessus ne protegerait plus rien.
    expect(ecran).toMatch(/subscription\.stripeSubscriptionId/);
  });
});

describe("le montant affiche est celui qui a ete preleve", () => {
  it("le schema dit bien que totalAmount est hors taxes", () => {
    expect(schemaFactures, "si totalAmount devenait le TTC, ce correctif serait a revoir")
      .toMatch(/Total HORS TAXES/);
    expect(schemaFactures).toMatch(/totalTtc.*Total toutes taxes comprises|Total toutes taxes comprises/s);
  });

  it("la liste n'affiche plus le hors taxes", () => {
    expect(
      ecran,
      "le client lisait 20 % de moins que ce qui lui a ete preleve",
    ).not.toMatch(/parseFloat\(inv\.totalAmount\)\.toFixed\(2\)/);
  });

  it("elle passe par une fonction qui prefere le TTC", () => {
    expect(ecran).toMatch(/montantDu\(inv\)/);
    expect(ecran).toMatch(/Number\(inv\.totalTtc \?\? 0\)/);
  });

  it("et retombe sur le HT pour les lignes anterieures a la TVA", () => {
    // Ces factures portent un totalTtc a zero: le HT etait alors bien le
    // montant reclame. Afficher zero serait un autre mensonge.
    expect(ecran).toMatch(/ttc > 0 \? ttc : Number\(inv\.totalAmount\)/);
  });
});
