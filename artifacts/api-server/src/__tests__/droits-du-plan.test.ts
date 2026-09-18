/**
 * L'echelle de prix doit exister dans le code, pas seulement sur la vitrine.
 *
 * Mesure du 18/09 : `aiEnabled`, `stockEnabled` et `automationEnabled` etaient
 * ecrits en base a la souscription, affiches en badges dans l'espace client —
 * et lus par personne. Aucun middleware, aucune route ne les consultait.
 *
 *  - Le plan Starter (29 EUR HT) accedait a tout ce que le plan Professionnel
 *    (79 EUR HT) facture : l'ecart de prix ne correspondait a aucun ecart de
 *    produit. Pour une societe mise en vente, c'est autant un probleme de
 *    valeur qu'un probleme de verite.
 *  - A l'inverse, l'ecran d'abonnement annoncait « IA inactive » pendant
 *    l'essai alors que les ecrans d'IA fonctionnaient : le logiciel se
 *    decrivait mal lui-meme.
 *
 * L'essai, lui, ouvre tout : chaque carte de tarifs porte le bouton « Essai
 * gratuit 14 jours », et c'est la seule demonstration que le visiteur
 * obtienne. Un essai ampute de ce que la vitrine vend ne convertit personne.
 * Ce sont les volumes qui le bornent, pas les fonctions.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, organisationsTable, subscriptionsTable, PLANS } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { checkLicense, invalidateLicenseCache } from "../middleware/license-check";
import { accesFonction, fonctionRequise, planOuvre } from "../services/droits-plan";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");

describe("chaque chemin sait de quelle fonction il releve", () => {
  it("l'assistant releve de l'IA", () => expect(fonctionRequise("/api/ai/analyse")).toBe("ia"));
  it("le commandant aussi", () => expect(fonctionRequise("/api/commandant/briefing")).toBe("ia"));
  it("les automatisations sont une fonction distincte", () =>
    expect(fonctionRequise("/api/automations")).toBe("automations"));
  it("le stock aussi", () => expect(fonctionRequise("/api/stock/articles")).toBe("stock"));

  it("un chemin inclus dans tous les plans n'est rattache a rien", () => {
    expect(fonctionRequise("/api/contacts")).toBeNull();
    expect(fonctionRequise("/api/factures-client")).toBeNull();
  });

  it("un prefixe ne capture pas un chemin qui lui ressemble", () => {
    // « /api/aide » commence par « /api/ai » en simple comparaison de chaines.
    expect(fonctionRequise("/api/aide"), "un ecran sans rapport serait bloque").toBeNull();
    expect(fonctionRequise("/api/stockage-fichiers")).toBeNull();
  });

  it("la chaine de requete ne trompe pas la reconnaissance", () =>
    expect(fonctionRequise("/api/ai?mode=resume")).toBe("ia"));
});

describe("ce que chaque plan ouvre", () => {
  it("Starter n'a pas l'IA : c'est ce que la page de tarifs annonce", () =>
    expect(planOuvre("starter", "ia")).toBe(false));

  it("Starter a le suivi de stock, qui lui est vendu", () =>
    expect(planOuvre("starter", "stock")).toBe(true));

  it("Professionnel ouvre les trois", () => {
    for (const f of ["ia", "stock", "automations"] as const) {
      expect(planOuvre("professionnel", f), `Professionnel devrait inclure ${f}`).toBe(true);
    }
  });

  it("l'essai montre le produit entier", () => {
    for (const f of ["ia", "stock", "automations"] as const) {
      expect(planOuvre("essai", f), `un essai sans ${f} ne demontre rien`).toBe(true);
    }
  });

  it("un plan inconnu n'ouvre rien : on n'invente pas de droits", () =>
    expect(planOuvre("plan-inexistant", "ia")).toBe(false));
});

describe("le verdict rendu au client", () => {
  it("laisse passer ce que le plan inclut", () =>
    expect(accesFonction("professionnel", "/api/ai/analyse").allowed).toBe(true));

  it("laisse passer tout chemin hors fonctions payantes, meme sur Starter", () =>
    expect(accesFonction("starter", "/api/contacts").allowed).toBe(true));

  it("refuse l'IA a Starter", () => {
    const v = accesFonction("starter", "/api/ai/analyse");
    expect(v.allowed, "Starter accede a ce que Professionnel facture").toBe(false);
    expect(v.reason).toBe("fonction_non_incluse:ia");
  });

  it("dit QUELLE fonction manque et ou la trouver", () => {
    const v = accesFonction("starter", "/api/automations");
    expect(v.message, "un refus sans motif envoie le client au support").toMatch(/automatisations/i);
    expect(v.message).toMatch(/abonnement/i);
  });
});

describe("la regle est branchee, et sur le plan", () => {
  const middleware = readFileSync(
    join(RACINE, "artifacts", "api-server", "src", "middleware", "license-check.ts"), "utf8",
  );

  it("le controle de licence l'applique", () => {
    expect(
      middleware,
      "sans cet appel, les colonnes restent decoratives comme avant",
    ).toMatch(/accesFonction\(sub\.plan, path\)/);
  });

  it("il lit le plan, pas la photographie stockee a la souscription", () => {
    // Les colonnes sont ecrites une fois puis jamais mises a jour: s'y fier
    // figerait les droits des comptes existants a l'ancienne definition de
    // l'offre et imposerait une migration a chaque ajustement.
    const service = readFileSync(
      join(RACINE, "artifacts", "api-server", "src", "services", "droits-plan.ts"), "utf8",
    );
    expect(service).toMatch(/PLANS\[plan as PlanKey\]/);
    expect(service, "le service ne doit pas dependre des colonnes de l'abonnement").not.toMatch(/sub\.aiEnabled/);
  });

  it("la vitrine et le code disent le meme prix pour Starter", () => {
    const home = readFileSync(join(RACINE, "artifacts", "tanitim", "src", "pages", "home.tsx"), "utf8");
    expect(home).toContain(`${PLANS.starter.price}€`);
  });
});

/**
 * Le controle reel, sur une organisation en base.
 *
 * La suite ci-dessus lit du code source: elle dit que l'appel EXISTE, pas
 * qu'il AGIT. Verifie en sabotant `license-check.ts` (`if (false && ...)`):
 * les treize controles statiques restaient verts. Un test qui ne tombe pas
 * quand on remet le defaut ne prouve rien — d'ou ceux-ci, qui passent par
 * `checkLicense` et par la base.
 */
describe("checkLicense applique vraiment les droits du plan", () => {
  const marque = Date.now();
  const creees: number[] = [];

  async function orgAvecPlan(plan: string): Promise<number> {
    const [org] = await db.insert(organisationsTable).values({
      name: `Droits ${plan} ${marque}`,
      slug: `droits-${plan}-${marque}`,
      maxUsers: 5,
      actif: true,
    }).returning({ id: organisationsTable.id });
    await db.insert(subscriptionsTable).values({
      organisationId: org.id,
      plan,
      status: "active",
      licenseKey: `DROITS-${plan}-${marque}`,
      maxUsers: 5,
      maxContacts: 100,
      maxCallsPerMonth: 100,
      price: "0",
      // Volontairement a l'oppose du plan: le verdict doit ignorer ces
      // colonnes, qui ne sont qu'une photographie prise a la souscription.
      aiEnabled: plan === "starter",
      stockEnabled: false,
      automationEnabled: plan === "starter",
    });
    creees.push(org.id);
    invalidateLicenseCache(org.id);
    return org.id;
  }

  afterAll(async () => {
    if (creees.length === 0) return;
    await db.delete(subscriptionsTable).where(inArray(subscriptionsTable.organisationId, creees));
    await db.delete(organisationsTable).where(inArray(organisationsTable.id, creees));
  });

  it("refuse l'IA a une organisation Starter", async () => {
    const id = await orgAvecPlan("starter");
    const v = await checkLicense(id, "POST", "/api/ai/analyse");
    expect(v.allowed, "Starter accede a ce que Professionnel facture").toBe(false);
    expect(v.reason).toBe("fonction_non_incluse:ia");
  });

  it("refuse aussi en lecture : une analyse IA coute un appel fournisseur", async () => {
    const id = creees[0];
    const v = await checkLicense(id, "GET", "/api/ai/insights");
    expect(v.allowed).toBe(false);
  });

  it("laisse Starter travailler partout ailleurs", async () => {
    const id = creees[0];
    expect((await checkLicense(id, "POST", "/api/contacts")).allowed).toBe(true);
  });

  it("ouvre l'IA au plan Professionnel", async () => {
    const id = await orgAvecPlan("professionnel");
    expect((await checkLicense(id, "POST", "/api/ai/analyse")).allowed).toBe(true);
  });

  it("ouvre tout a l'essai, qui doit demontrer le produit", async () => {
    const id = await orgAvecPlan("essai");
    for (const chemin of ["/api/ai/analyse", "/api/stock/articles", "/api/automations"]) {
      expect((await checkLicense(id, "POST", chemin)).allowed, `essai bloque sur ${chemin}`).toBe(true);
    }
  });

  it("ignore la colonne stockee quand elle contredit le plan", async () => {
    // L'abonnement Professionnel a ete seme avec automationEnabled = false.
    const id = creees[1];
    expect(
      (await checkLicense(id, "POST", "/api/automations")).allowed,
      "les droits suivent une copie figee au lieu du plan",
    ).toBe(true);
  });
});

/**
 * Les ecrans doivent annoncer ce que le serveur autorise.
 *
 * Deux routes rendaient les fonctions depuis les COLONNES de l'abonnement
 * (`/api/my-subscription`, `/api/subscription/usage`). Un compte d'essai
 * ouvert avant ce changement porte `aiEnabled = false` en base: l'espace
 * client lui aurait annonce « IA inactive » pendant que le serveur lui ouvre
 * l'IA. Un logiciel qui se decrit mal fait perdre au client ce qu'il paie.
 */
describe("l'espace client annonce les fonctions du plan", () => {
  for (const fichier of ["my-subscription.ts", "subscriptions.ts"]) {
    it(`${fichier} ne lit plus la colonne stockee`, () => {
      const source = readFileSync(
        join(RACINE, "artifacts", "api-server", "src", "routes", fichier), "utf8",
      );
      expect(
        source,
        "l'ecran repartirait de la photographie prise a la souscription",
      ).not.toMatch(/aiEnabled: (sub|subscription)\?\.aiEnabled/);
    });
  }

  it("les trois fonctions d'un plan connu sont celles de PLANS", () => {
    for (const [cle, plan] of Object.entries(PLANS)) {
      expect(planOuvre(cle, "ia"), `${cle}: IA`).toBe(plan.aiEnabled);
      expect(planOuvre(cle, "stock"), `${cle}: stock`).toBe(plan.stockEnabled);
      expect(planOuvre(cle, "automations"), `${cle}: automatisations`).toBe(plan.automationEnabled);
    }
  });
});
