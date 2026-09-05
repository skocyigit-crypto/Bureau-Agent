/**
 * La collecte des violations CSP.
 *
 * La politique de l'application est en `Report-Only` depuis le 2026-09-03, le
 * temps que les parcours authentifies aient ete ouverts un a un. Mais elle ne
 * signalait a personne: sans `report-uri`, un rapport de violation ne va nulle
 * part. La politique attendait une preuve que rien ne pouvait produire.
 *
 * Ce que ces tests verrouillent tient en deux points, et le second compte
 * autant que le premier:
 *
 *  - les DEUX formats de rapport sont lus. L'ancien (`report-uri`,
 *    `{"csp-report": {...}}`, cles en tirets) et l'API Reporting (un TABLEAU
 *    de `{type, body}`, cles en camelCase). N'en lire qu'un, c'est ne rien
 *    recevoir de la moitie du parc — et croire que tout va bien;
 *  - l'adresse de la page est amputee de sa partie requete. Un rapport dit ou
 *    la violation s'est produite; il n'a pas a dire que le visiteur
 *    consultait `/factures?client=Durand&token=...`. Un journal de securite ne
 *    doit pas devenir un journal de navigation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { assainirUrl, normaliserRapport } from "../routes/csp-report";

const racine = resolve(import.meta.dirname, "../../../..");
const lire = (p: string) => readFileSync(resolve(racine, p), "utf8");

describe("normalisation des rapports", () => {
  it("lit l'ancien format report-uri", () => {
    const [v] = normaliserRapport({
      "csp-report": {
        "document-uri": "https://app.agentdebureau.fr/factures",
        "violated-directive": "script-src",
        "effective-directive": "script-src",
        "blocked-uri": "https://exemple-tiers.fr/mouchard.js",
        "line-number": 42,
      },
    });
    expect(v.document).toBe("https://app.agentdebureau.fr/factures");
    expect(v.directive).toBe("script-src");
    expect(v.bloque).toBe("https://exemple-tiers.fr/mouchard.js");
    expect(v.ligne).toBe(42);
  });

  it("lit le format de l'API Reporting", () => {
    // Un tableau, des cles en camelCase: rien de commun avec le format
    // precedent, alors que le navigateur choisit sans nous demander.
    const violations = normaliserRapport([
      {
        type: "csp-violation",
        body: {
          documentURL: "https://app.agentdebureau.fr/documents",
          effectiveDirective: "img-src",
          blockedURL: "https://cdn-tiers.fr/pixel.gif",
          disposition: "report",
        },
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].directive).toBe("img-src");
    expect(violations[0].bloque).toBe("https://cdn-tiers.fr/pixel.gif");
    expect(violations[0].disposition).toBe("report");
  });

  it("retire la partie requete de toute adresse", () => {
    // Le cas concret: un identifiant client et un jeton dans l'URL.
    expect(assainirUrl("https://app.agentdebureau.fr/factures?client=Durand&token=abc123"))
      .toBe("https://app.agentdebureau.fr/factures");
    expect(assainirUrl("https://app.agentdebureau.fr/devis#section-3"))
      .toBe("https://app.agentdebureau.fr/devis");

    const [v] = normaliserRapport({
      "csp-report": {
        "document-uri": "https://app.agentdebureau.fr/contacts?recherche=Marie+Durand",
        "effective-directive": "connect-src",
      },
    });
    expect(v.document, "le terme de recherche ne doit pas atteindre le journal")
      .toBe("https://app.agentdebureau.fr/contacts");
  });

  it("ne se laisse pas dicter la taille de ce qu'il journalise", () => {
    // Le corps vient du client: il peut etre enorme, ou absurde.
    const [v] = normaliserRapport({
      "csp-report": {
        "document-uri": "https://app.agentdebureau.fr/" + "a".repeat(5000),
        "effective-directive": "b".repeat(5000),
      },
    });
    expect(v.document!.length).toBeLessThanOrEqual(300);
    expect(v.directive!.length).toBeLessThanOrEqual(300);
  });

  it("ignore ce qui n'est pas un rapport", () => {
    // La route est publique: elle recevra du bruit.
    expect(normaliserRapport(null)).toEqual([]);
    expect(normaliserRapport("bonjour")).toEqual([]);
    expect(normaliserRapport({})).toEqual([]);
    expect(normaliserRapport([{ type: "deprecation", body: {} }])).toEqual([]);
  });
});

describe("branchement de la politique", () => {
  it("la politique designe la route qui la recoit", () => {
    // Sans cette directive, tout le reste de ce fichier est du code mort:
    // aucun rapport ne serait jamais envoye.
    expect(lire("deploy/csp.policy")).toContain("report-uri /api/csp-report");
  });

  it("les deux Caddyfile portent la meme politique", () => {
    const politique = lire("deploy/csp.policy").trim();
    for (const f of ["deploy/Caddyfile.cloudrun", "deploy/Caddyfile"]) {
      expect(lire(f), `${f} a derive`).toContain(politique);
    }
  });

  it("la route est montee avant la protection CSRF", () => {
    // Un navigateur n'envoie pas de jeton CSRF avec un rapport. Montee apres,
    // la route repondrait 403 a chaque rapport — et le silence ressemblerait
    // exactement a « aucune violation ».
    //
    // On compare les MONTAGES, pas les mentions: la premiere version de ce
    // test cherchait `csrfProtection` avec `indexOf` et tombait sur la ligne
    // d'import, en haut du fichier. Il declarait donc la route mal placee
    // alors qu'elle etait bien placee — un test qui mesure autre chose que ce
    // qu'il annonce.
    const app = lire("artifacts/api-server/src/app.ts");
    const posRoute = app.indexOf('app.use("/api", cspReportRouter)');
    const posCsrf = app.indexOf('app.use("/api", csrfProtection)');
    expect(posRoute, "montage de la route CSP introuvable").toBeGreaterThan(-1);
    expect(posCsrf, "montage de csrfProtection introuvable").toBeGreaterThan(-1);
    expect(posRoute, "la route CSP doit etre montee avant csrfProtection").toBeLessThan(posCsrf);
  });

  it("les deux types de contenu des navigateurs sont acceptes", () => {
    const app = lire("artifacts/api-server/src/app.ts");
    expect(app).toContain("application/csp-report");
    expect(app).toContain("application/reports+json");
  });
});
