/**
 * Deux defauts mobiles, trouves par l'audit ecran par ecran du 19/09.
 *
 * 1. `app/notifications.tsx` — l'ecran se vidait des qu'UNE tache etait en
 *    retard. Le parametre de la boucle s'appelait `t`, comme la fonction de
 *    traduction : il la MASQUAIT. `t("notificationsScreen.overdueTask")`
 *    appelait donc la tache comme une fonction, la TypeError etait avalee par
 *    un `catch {}`, et `setNotifications` n'etait jamais atteint. L'ecran
 *    affichait « aucune notification » — en jetant au passage les appels
 *    manques et les messages deja collectes. Le defaut ne se voit pas a la
 *    lecture rapide : le code est syntaxiquement irreprochable, et le seul
 *    symptome est un ecran vide.
 *
 * 2. `app/notes-internes.tsx` — modifier ou epingler une note envoyait
 *    `PATCH /api/notes-internes/{id}`. Le serveur n'expose que `PUT` et
 *    `DELETE` : 404 a chaque fois. Aucun `res.ok` n'etait lu, aucun `catch` :
 *    l'editeur se fermait, la note n'etait pas enregistree, et rien ne le
 *    disait. Le web, lui, utilise `PUT` — c'est le mobile seul qui divergeait.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(import.meta.dirname, "..", "..", "app");
const SERVEUR = join(
  import.meta.dirname, "..", "..", "..",
  "api-server", "src", "routes",
);

describe("l'ecran des notifications ne masque plus la fonction de traduction", () => {
  const source = readFileSync(join(APP, "notifications.tsx"), "utf8");

  it("la boucle des taches en retard n'utilise plus `t` comme parametre", () => {
    expect(
      source,
      "un parametre nomme `t` masque la traduction: l'ecran se vide des la premiere tache en retard",
    ).not.toMatch(/\(\s*t\s*:\s*any\s*\)\s*=>/);
  });

  it("aucune boucle du fichier ne nomme son parametre `t`", () => {
    // Le defaut peut revenir par une autre boucle: on verrouille la propriete,
    // pas la ligne.
    const boucles = [...source.matchAll(/\.(?:forEach|map|filter|find|some)\(\s*\(([^),:]+)/g)]
      .map((m) => m[1].trim());
    expect(boucles.length, "aucune boucle lue: ce controle ne prouve rien").toBeGreaterThan(2);
    expect(boucles, `parametre nomme « t »: ${boucles.join(", ")}`).not.toContain("t");
  });

  it("la traduction reste appelee dans la boucle, donc le masquage etait fatal", () => {
    // Si `t(...)` n'y etait pas appele, le masquage serait inoffensif et ce
    // controle n'aurait pas lieu d'etre.
    expect(source).toMatch(/title: t\("notificationsScreen\.overdueTask"\)/);
  });
});

describe("le mobile appelle la methode que le serveur expose", () => {
  const mobile = readFileSync(join(APP, "notes-internes.tsx"), "utf8");
  const serveur = readFileSync(join(SERVEUR, "notes-internes.ts"), "utf8");

  const methodesServeur = new Set(
    [...serveur.matchAll(/router\.(get|post|put|patch|delete)\("\/notes-internes\/:id"/g)]
      .map((m) => m[1].toUpperCase()),
  );

  it("le serveur expose bien PUT et pas PATCH", () => {
    expect(methodesServeur.has("PUT")).toBe(true);
    expect(
      methodesServeur.has("PATCH"),
      "si le serveur acceptait PATCH, ce defaut n'existerait pas",
    ).toBe(false);
  });

  it("toutes les ecritures du mobile sur cette ressource utilisent une methode exposee", () => {
    const appels = [...mobile.matchAll(/api\/notes-internes\/\$\{[^}]+\}`,\s*\{\s*\n?\s*method: "(\w+)"/g)]
      .map((m) => m[1]);
    expect(appels.length, "aucun appel lu: ce controle ne prouve rien").toBeGreaterThan(1);
    for (const methode of appels) {
      expect(
        methodesServeur.has(methode),
        `le mobile envoie ${methode}, le serveur n'expose que ${[...methodesServeur].join(", ")} — 404 silencieux`,
      ).toBe(true);
    }
  });
});

describe("une liste vide et une lecture ratee ne se confondent plus", () => {
  /**
   * Les deux se ressemblent a l'ecran — une liste vide — mais ne disent pas la
   * meme chose : « vous n'avez aucun utilisateur » est une information, « je
   * n'ai pas pu lire » est une panne. Confondre les deux amene a conclure
   * qu'il n'y a rien a faire.
   */
  const composant = readFileSync(join(APP, "..", "components", "EmptyState.tsx"), "utf8");

  it("l'etat vide sait dire qu'il s'agit d'un echec", () => {
    expect(composant).toMatch(/erreur\?: boolean;/);
    expect(composant).toMatch(/common\.lectureEchoueeTitre/);
  });

  it("il change aussi d'icone, pour que la difference se voie", () => {
    expect(composant).toMatch(/erreur \? "alert-circle" : icon/);
  });

  for (const ecran of ["audit-log.tsx", "integrations.tsx", "users.tsx", "calendar.tsx", "rappels.tsx"]) {
    it(`${ecran} le signale`, () => {
      const source = readFileSync(join(APP, ecran), "utf8");
      expect(source, `${ecran}: le drapeau n'est pas transmis`).toMatch(/erreur=\{lectureEchouee\}/);
      // Les DEUX chemins d'echec, et la remise a zero avant la lecture.
      expect((source.match(/setLectureEchouee\(true\)/g) ?? []).length,
        `${ecran}: refus du serveur et erreur reseau doivent tous deux le lever`).toBe(2);
      expect(source).toMatch(/setLectureEchouee\(false\)/);
    });
  }
});

describe("un interrupteur ne ment pas sur un reglage qu'on n'a pas lu", () => {
  const securite = readFileSync(join(APP, "securite.tsx"), "utf8");

  it("une lecture ratee est retenue", () => {
    // Sans cela, l'interrupteur restait sur sa valeur par defaut — ETEINT — et
    // l'utilisateur lisait « le rapport hebdomadaire est desactive », qui est
    // une affirmation, alors que la question n'avait pas pu etre posee.
    expect((securite.match(/setReglageIllisible\(true\)/g) ?? []).length).toBe(2);
  });

  it("tant qu'on ne sait pas, on ne laisse pas toucher", () => {
    expect(securite).toMatch(/disabled=\{weeklyEmailSaving \|\| reglageIllisible\}/);
  });

  it("et on le dit a la place de la description", () => {
    expect(securite).toMatch(/reglageIllisible \? t\("common\.lectureEchoueeAide"\)/);
  });

  it("une lecture reussie efface l'avertissement", () => {
    expect(securite).toMatch(/setReglageIllisible\(false\)/);
  });
});

describe("la file d'approbation ne dit pas « rien a valider » sans avoir lu", () => {
  const source = readFileSync(join(APP, "file-approbation.tsx"), "utf8");

  it("l'echec de lecture est retenu, sur les deux chemins", () => {
    // Cette file contient des envois vers les CLIENTS — relances, factures —
    // qui attendent une validation humaine. Les croire absents, c'est les
    // laisser en plan.
    expect((source.match(/setLectureEchouee\(true\)/g) ?? []).length).toBe(2);
  });

  it("et il est affiche a la place de « rien a approuver »", () => {
    expect(source).toMatch(/lectureEchouee \? \(/);
    expect(source).toMatch(/common\.lectureEchoueeTitre/);
  });

  it("une lecture reussie l'efface", () => {
    expect(source).toMatch(/setLectureEchouee\(false\)/);
  });
});
