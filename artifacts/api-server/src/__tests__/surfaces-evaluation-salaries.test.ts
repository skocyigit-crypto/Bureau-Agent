/**
 * TOUTES les surfaces qui evaluent des salaries, tenues a la meme regle.
 *
 * POURQUOI UN TEST TRANSVERSAL PLUTOT QUE TROIS TESTS SEPARES
 *
 * Ce produit evalue des salaries a TROIS endroits, decouverts l'un apres
 * l'autre — et chacun avait un manque different:
 *
 *   workforce-agent          role verifie, mais AUCUNE trace (#154)
 *   performance              trace absente ET aucun controle de role: un
 *                            compte `lecture_seule` lisait les heures et les
 *                            pauses de tous ses collegues (#159)
 *   workforce-intelligence   role verifie, aucune trace
 *
 * Trois fichiers de tests separes auraient verrouille trois surfaces et
 * laisse la quatrieme sortir sans rien. Or c'est exactement ce qui s'est
 * passe: la regle existait dans `workforce-agent` quand `performance` a ete
 * ecrit, et personne ne l'a vue.
 *
 * Ce fichier enumere donc les surfaces et applique la meme exigence a toutes.
 * Ajouter une quatriere sans la declarer ici fait tomber le dernier test.
 *
 * CE QUI EST EXIGE, ET POURQUOI
 *
 *   - un plancher de role: ces donnees decrivent des personnes, pas
 *     l'application. Le role le plus bas (`lecture_seule`) ne doit jamais
 *     les atteindre;
 *   - une trace d'audit: l'article 5.2 du RGPD porte sur le TRAITEMENT, pas
 *     sur le stockage. Une analyse qui ne conserve rien doit quand meme
 *     pouvoir dire qui l'a demandee, quand, et sur combien de personnes.
 *
 * CE QUE CE FICHIER NE COUVRE PAS, ET QUI RESTE DU
 *
 * Consultation prealable du CSE (Code du travail, art. L2312-38),
 * information prealable des salaries (art. L1222-4), analyse d'impact
 * (AIPD), et l'interdiction de l'art. 22 RGPD de fonder une decision a effets
 * significatifs sur le seul traitement automatise. Rien de cela ne s'ecrit en
 * TypeScript.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = join(import.meta.dirname, "..", "routes");
const lire = (f: string) => readFileSync(join(ROUTES, f), "utf8");

/** Les surfaces connues qui evaluent nominativement des salaries. */
const SURFACES = [
  { fichier: "workforce-agent.ts", action: "workforce_evaluation_generated" },
  { fichier: "performance.ts", action: "performance_report_generated" },
  { fichier: "workforce-intelligence.ts", action: "workforce_intelligence_generated" },
  // Quatrieme surface, trouvee PAR ce fichier: `/commandant/employee-quality`
  // agrege taches, actions journalisees et — via `checkins` —
  // `totalMinutes` / `breakMinutes`, par salarie nomme. Elle n avait aucun
  // controle de role: `requireMutationRole`, pose plus haut dans le routeur,
  // ne couvre que les changements d etat et laisse passer les GET.
  { fichier: "ai-commandant.ts", action: "employee_quality_generated" },
] as const;

describe.each(SURFACES)("$fichier", ({ fichier, action }) => {
  const source = lire(fichier);

  it("reserve l'acces aux responsables", () => {
    // `lecture_seule` et `agent` ne doivent jamais atteindre les donnees
    // d'activite nominatives de leurs collegues.
    expect(
      /requireRole\(/.test(source),
      "aucun controle de role: n'importe quel compte authentifie peut lire " +
        "les donnees d'activite de tous ses collegues.",
    ).toBe(true);
    expect(source).toMatch(/"(super_admin|administrateur)"/);
  });

  it("n'ouvre pas la porte aux agents", () => {
    // Le defaut le plus probable n'est pas l'absence de garde, c'est une
    // garde elargie « parce qu'un agent en avait besoin ».
    const gardes = source.match(/requireRole\([^)]*\)/g) ?? [];
    for (const g of gardes) {
      expect(g, `garde trop large: ${g}`).not.toContain('"agent"');
      expect(g, `garde trop large: ${g}`).not.toContain('"lecture_seule"');
    }
  });

  it("laisse une trace nommee", () => {
    expect(source).toContain("logAudit(");
    expect(
      source,
      `l'action d'audit ${action} a disparu: le journal deviendrait illisible ` +
        "le jour ou un salarie exerce son droit d'acces.",
    ).toContain(action);
  });

  it("la trace dit sur combien de personnes", () => {
    // « une evaluation a eu lieu » ne suffit pas: la portee du traitement
    // fait partie de ce qui doit pouvoir etre demontre.
    const i = source.indexOf(action);
    expect(i).toBeGreaterThan(0);
    const bloc = source.slice(i, i + 500);
    expect(
      /employeeCount|employeId|periode/.test(bloc),
      "la trace ne dit rien de la portee du traitement.",
    ).toBe(true);
  });

  it("une trace impossible a ecrire ne prive pas du resultat", () => {
    // L'inverse serait pire: refuser le rapport parce qu'une ecriture
    // secondaire a echoue.
    const i = source.indexOf("logAudit(");
    const bloc = source.slice(i, i + 900);
    expect(bloc).toContain(".catch(");
  });
});

describe("aucune quatrieme surface n'echappe a la regle", () => {
  it("tout fichier de route qui lit nom ET prenom de plusieurs salaries est declare ici", () => {
    // LE TEST QUI COMPTE LE PLUS.
    //
    // Les trois surfaces ont ete trouvees l'une apres l'autre, chacune avec
    // un manque different. Verrouiller les trois sans se demander s'il y en a
    // une quatrieme reproduirait exactement l'erreur qui les a laissees
    // passer.
    //
    // Heuristique volontairement large: un fichier de route qui selectionne
    // `usersTable.prenom` ET `usersTable.nom` construit une liste nominative
    // de salaries. Il y en a peu, et chacun merite d'etre regarde.
    const declares = new Set<string>(SURFACES.map((s) => s.fichier));

    // EXEMPTIONS, avec leur raison. Une liste d exemptions vaut mieux qu une
    // heuristique plus fine: elle garde le filet large et oblige a JUSTIFIER
    // chaque sortie, plutot qu a la rendre invisible.
    const exemptes: Record<string, string> = {
      // Lit UNE personne (`const [user] = ...`) pour son propre contexte. Le
      // `count()` d utilisateurs qui declenche l heuristique est un effectif,
      // pas une liste nominative.
      "ai-analysis.ts": "lit un seul utilisateur; le comptage est un effectif",
      // Le registre RGPD lui-meme. Il construit bien une liste nominative —
      // c est l export des donnees d une personne qui exerce ses droits. Le
      // contraire d un probleme: ce fichier existe pour les satisfaire.
      "data-protection.ts": "machinerie des droits RGPD (acces, portabilite)",
    };

    const suspects: string[] = [];

    for (const f of readdirSync(ROUTES)) {
      if (!f.endsWith(".ts") || declares.has(f) || f in exemptes) continue;
      const src = lire(f);
      // Heuristique affinee apres mesure: lire nom+prenom d UNE personne est
      // banal (son propre profil). Ce qui compte, c est de construire un
      // ROSTER — une liste nominative a l echelle de l organisation.
      const nominatif =
        src.includes("usersTable.prenom") &&
        src.includes("usersTable.nom") &&
        src.includes("eq(usersTable.organisationId");
      if (!nominatif) continue;
      // Une liste nominative n'est un probleme que si elle est AGREGEE avec
      // de l'activite: l'annuaire de l'organisation, lui, est legitime.
      const agrege = /count\(\)|sum\(|score/i.test(src);
      if (agrege) suspects.push(f);
    }

    expect(
      suspects,
      "ces fichiers agregent de l'activite par salarie nomme sans figurer " +
        "dans SURFACES. Soit ils sont legitimes et il faut les ajouter avec " +
        "leur action d'audit, soit ils evaluent des salaries sans garde-fou.",
    ).toEqual([]);
  });

  it("les trois surfaces connues existent toujours", () => {
    // Garde-fou du garde-fou: si un fichier est renomme, les tests
    // ci-dessus passeraient sur un ensemble vide.
    for (const { fichier } of SURFACES) {
      expect(() => lire(fichier), `${fichier} a disparu`).not.toThrow();
    }
    expect(SURFACES.length).toBe(4);
  });
});

describe("le registre RGPD declare ce traitement", () => {
  const registre = lire("data-protection.ts");

  it("la categorie existe", () => {
    expect(registre).toContain("Évaluations automatisées de salariés");
  });

  it("elle compte les deux tables qui conservent des rapports", () => {
    // La troisieme surface ne conserve rien: elle lit, analyse et rend. Il
    // n'y a donc rien a compter pour elle — mais le traitement existe, et
    // c'est la description qui le couvre.
    expect(registre).toContain("aiAgentReportsTable");
    expect(registre).toContain("performanceReportsTable");
  });

  it("les obligations hors code restent nommees", () => {
    const i = registre.indexOf("Évaluations automatisées de salariés");
    const bloc = registre.slice(Math.max(0, i - 2500), i + 800);
    expect(bloc).toContain("L2312-38");
    expect(bloc).toContain("L1222-4");
    expect(bloc).toMatch(/AIPD|DPIA/);
  });
});
