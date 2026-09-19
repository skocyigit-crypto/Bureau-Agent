/**
 * L'ecran d'abonnement mobile decrivait une reponse qui n'existe pas.
 *
 * `GET /api/my-subscription` emet `organisation {id, name, actif}`, `limits`,
 * `usage {users, contacts, calls}` et un abonnement dont le montant s'appelle
 * `price`. L'ecran lisait `organisation.maxUsers`, `organisation.currentUsers`,
 * `organisation.plan`, `usage.tasks`, `usage.messages`, `usage.documents`,
 * `features` et `subscription.amount` — aucun de ces champs n'est emis.
 *
 * Ce qui en decoulait, mesure du 19/09 :
 *
 *  - `UsageBar` appelait `used.toLocaleString()` sur `undefined`. C'est une
 *    TypeError pendant le rendu : l'ecran entier tombait, pas seulement la
 *    barre. C'est le « abonnement.tsx fait planter l'application » de l'audit.
 *  - la barre de licences calculait `undefined / undefined`, donc une largeur
 *    « NaN% ».
 *  - le montant de l'abonnement affichait « — » pour tout le monde.
 *  - le bloc des fonctions incluses ne s'affichait jamais.
 *  - les cles de `PLAN_COLORS` etaient inventees (« pro », « business »,
 *    « enterprise », « trial ») : aucune ne correspondait aux plans du produit
 *    (essai, starter, professionnel, entreprise), donc tout abonnement
 *    retombait sur « Starter », en gris, quel que soit le plan souscrit.
 *
 * Ces controles lisent la source de l'ecran ET celle de la route, pour que la
 * divergence entre les deux redevienne visible si elle revient.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ecran = readFileSync(
  join(import.meta.dirname, "..", "..", "app", "abonnement.tsx"), "utf8",
);

/**
 * L'ecran, commentaires retires.
 *
 * Les controles « ce champ n'est plus lu » portent sur le CODE. Les
 * commentaires de ce fichier-la nomment justement les champs fautifs, pour dire
 * ce qui a ete corrige : les laisser dans la matiere mesuree ferait echouer le
 * controle a cause de sa propre explication.
 */
const code = ecran
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

const route = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "api-server", "src", "routes", "my-subscription.ts"),
  "utf8",
);
const plans = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "lib", "db", "src", "schema", "subscriptions.ts"),
  "utf8",
);

describe("le controle mesure bien du code", () => {
  it("les commentaires sont retires, mais le fichier reste substantiel", () => {
    // Garde-fou du controle lui-meme: si le filtrage vidait la source, les
    // assertions « ce champ n'est plus lu » passeraient pour rien.
    expect(code.length).toBeGreaterThan(5000);
    expect(code).toContain("UsageBar");
  });
});

describe("l'ecran ne lit plus des champs que le serveur n'emet pas", () => {
  for (const champ of ["organisation.maxUsers", "organisation.currentUsers", "organisation.plan"]) {
    it(`il ne lit plus \`${champ}\``, () => {
      expect(code, "le serveur n'emet que id, name et actif").not.toContain(`data.${champ}`);
    });
  }

  for (const compteur of ["usage.tasks", "usage.messages", "usage.documents"]) {
    it(`il ne trace plus la barre \`${compteur}\``, () => {
      expect(
        code,
        "un compteur absent rendait `undefined.toLocaleString()`, donc tout l'ecran en erreur",
      ).not.toContain(`data.${compteur}`);
    });
  }

  it("il ne lit plus `features`, qui n'est pas emis", () => {
    expect(code).not.toMatch(/data\.features/);
  });

  it("le montant vient de `price`, le nom reellement emis", () => {
    expect(code).toMatch(/data\.subscription\.price/);
    expect(route, "si la route renommait ce champ, ce controle doit tomber").toMatch(/price: sub\.price/);
  });
});

describe("les compteurs affiches sont ceux que le serveur sait compter", () => {
  it("les utilisateurs viennent de `usage.users`", () => {
    expect(code).toMatch(/data\.usage\?\.users/);
  });

  it("le plafond vient de `limits.maxUsers`", () => {
    expect(code).toMatch(/data\.limits\?\.maxUsers/);
  });

  it("la route emet bien ces deux-la", () => {
    expect(route).toMatch(/users: userCount\?\.count/);
    expect(route).toMatch(/maxUsers: sub\?\.maxUsers/);
  });

  it("les barres restantes ont leur plafond", () => {
    expect(code).toMatch(/total=\{data\.limits\?\.maxContacts\}/);
    expect(code).toMatch(/total=\{data\.limits\?\.maxCallsPerMonth\}/);
  });
});

describe("plus de largeur « NaN% »", () => {
  it("la barre de licences se garde d'un plafond nul", () => {
    expect(
      code,
      "`x / 0` donne l'infini et `undefined / undefined` donne NaN: la mise en page refuse les deux",
    ).toMatch(/\(data\.limits\?\.maxUsers \?\? 0\) > 0 \?/);
  });

  it("`UsageBar` ramene un compteur absent a zero", () => {
    expect(code).toMatch(/Number\.isFinite\(Number\(used\)\)/);
  });

  it("et n'appelle plus `toLocaleString` sur la valeur recue", () => {
    expect(code, "c'est cet appel qui faisait tomber l'ecran").not.toMatch(/used\.toLocaleString/);
  });
});

describe("les plans affiches sont ceux du produit", () => {
  for (const cle of ["essai", "starter", "professionnel", "entreprise"]) {
    it(`« ${cle} » est un plan du produit, et l'ecran le connait`, () => {
      expect(plans, `${cle} n'est plus un plan du produit`).toMatch(new RegExp(`^  ${cle}: \\{`, "m"));
      expect(code, `l'ecran retombe sur un autre plan pour ${cle}`).toMatch(new RegExp(`^  ${cle}:`, "m"));
    });
  }

  it("les cles inventees ont disparu", () => {
    for (const fausse of ["business", "enterprise", "gratuit", "trial"]) {
      expect(code, `« ${fausse} » n'existe pas: tout abonnement retombait sur Starter`)
        .not.toMatch(new RegExp(`^  ${fausse}:\\s*\\{`, "m"));
    }
  });

  it("le plan est lu sur l'abonnement, pas sur l'organisation", () => {
    expect(code).toMatch(/data\?\.subscription\?\.plan/);
  });
});
