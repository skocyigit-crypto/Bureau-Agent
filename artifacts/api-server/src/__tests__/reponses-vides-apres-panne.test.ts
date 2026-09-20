/**
 * Le jumeau serveur du defaut le plus repandu du produit.
 *
 * Cote ecran, `if (res.ok)` sans `else` a ete traque jusqu'a une liste
 * d'exceptions nommees (`buro-ajani/src/test/echecs-silencieux.test.ts`).
 * Cote serveur, le meme silence existe sous une autre forme, et il est PIRE :
 * la route rattrape son erreur et repond 200 avec une collection vide. Un
 * client parfaitement ecrit, qui verifie `res.ok` comme il faut, n'a alors
 * aucun moyen de savoir. La rigueur de l'ecran est annulee a la source.
 *
 * Quatre routes du tableau de bord le faisaient :
 *
 *  - `/dashboard/anomaly-stream` repondait « 0 critique, 0 alerte » — une
 *    reassurance fabriquee a partir d'une panne, rafraichie toutes les
 *    60 secondes et affichee en grand. `/dashboard/smart-pulse`, quinze
 *    lignes plus haut dans le meme fichier, repond 500 dans le meme cas.
 *  - `/dashboard/week-comparison` rendait un graphique a plat, lu comme « il
 *    ne s'est rien passe cette semaine ». `dashboard.tsx` traitait DEJA le
 *    cas d'erreur — `setError(true)` — mais ce traitement etait inatteignable.
 *  - `/dashboard/team-members` annoncait une equipe vide.
 *  - `/dashboard/predictions` rendait des previsions absentes.
 *
 * Trois des quatre ne journalisaient meme pas l'erreur : rien, nulle part, ne
 * disait que la lecture avait echoue.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = join(import.meta.dirname, "..", "routes");

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return p.endsWith(".ts") && !p.includes(".test.") ? [p] : [];
  });
}

/**
 * Le corps exact d'un `catch`, accolades comptees.
 *
 * Une fenetre de N lignes s'est revelee inutilisable ici : les routes IA
 * rattrapent une erreur DANS une boucle, journalisent, continuent — et la
 * reponse de succes, avec ses `[]` parfaitement legitimes, tombe dix lignes
 * plus bas. Trois faux positifs sur cinq. Un controle qui crie au loup finit
 * desactive, et c'est le vrai defaut qui passe ensuite.
 */
function corpsDuCatch(lignes: string[], debut: number): string | null {
  const texte = lignes.slice(debut).join("\n");
  const ouvrante = texte.indexOf("{");
  if (ouvrante === -1) return null;
  let profondeur = 0;
  for (let i = ouvrante; i < texte.length; i++) {
    if (texte[i] === "{") profondeur++;
    else if (texte[i] === "}") {
      profondeur--;
      if (profondeur === 0) return texte.slice(ouvrante, i + 1);
    }
  }
  return null;
}

/**
 * Les reponses vides servies APRES une panne, `fichier.ts#rang`.
 *
 * Le rang est celui de la reponse DANS SON FICHIER, pas un numero de ligne.
 * Designer une exception par sa ligne rend la liste fausse des qu'on modifie
 * quoi que ce soit plus haut dans le meme fichier — ajouter une garde de role
 * a `calls.ts` a suffi a la faire echouer sur une exception inchangee. Une
 * liste qui se declare fausse a chaque remaniement finit mise a jour
 * mecaniquement, sans que personne relise ce qu'elle protege ; c'est-a-dire
 * qu'elle ne protege plus rien.
 *
 * Un bloc qui pose un statut 4xx ou 5xx ne ment pas, quoi qu'il mette dans le
 * corps ; c'est le 200 qui fait croire que la question a recu sa reponse.
 */
function reponsesVides(): string[] {
  const out: string[] = [];
  for (const f of fichiers(ROUTES)) {
    const lignes = readFileSync(f, "utf8").split(/\r?\n/);
    const nom = f.split(/[\\/]/).slice(-1)[0];
    let rang = 0;
    lignes.forEach((l, i) => {
      if (!/catch\s*\(/.test(l)) return;
      const bloc = corpsDuCatch(lignes, i);
      if (bloc === null) return;
      if (/res\.status\([45]\d\d\)/.test(bloc)) return;
      // Un corps qui porte un drapeau `error` explicite n'est pas un silence:
      // le client peut le lire, et il le lit — `google-workspace.tsx` branche
      // ses quatre cartes sur `error === "non_connecte"` pour afficher
      // « Connectez votre compte » au lieu d'une liste vide. C'est la reponse
      // degradee HONNETE, et elle a sa place.
      if (/res\.json\(\s*\{[^}]*\berror\s*:/.test(bloc)) return;
      if (!/res\.json\(\s*(?:\[\]|\{[^}]*\[\])/.test(bloc)) return;
      out.push(`${nom}#${++rang}`);
    });
  }
  return out.sort();
}

/**
 * Ce qui reste, examine.
 *
 * Le critere est celui des ecrans : est-ce que la reponse AFFIRME quelque
 * chose de faux ? Une liste de suggestions vide ne dit rien — la saisie
 * manuelle reste possible, et les deux journalisent l'echec. « Zero alerte
 * critique », si.
 */
const EXCEPTIONS = [
  // Recherche d'entreprise a la frappe (API externe INSEE): la saisie
  // manuelle reste ouverte, et l'echec est journalise sur place.
  "organisations.ts#1",
  // Suggestions de recherche web: meme cas, meme journalisation.
  "web-search.ts#1",
  // Taches Google: le compte EST connecte, c'est le scope Tasks qui manque
  // sur d'anciens jetons. Repondre « non_connecte » afficherait a tort
  // « Connectez votre compte » alors que Gmail, Agenda et Drive marchent.
  // L'arbitrage est ecrit sur place, et l'echec est journalise.
  "google-workspace.ts#1",
  // Briefing d'appel: le corps DIT « Informations non disponibles » a
  // l'endroit meme ou l'utilisateur le lit, et l'erreur est journalisee. Le
  // texte ne pretend pas qu'il n'y avait rien a dire.
  "calls.ts#1",
] as const;

describe("une panne ne se deguise pas en resultat vide", () => {
  it("le releve trouve bien quelque chose a controler", () => {
    // Sans ce garde-fou, une detection cassee ferait passer l'assertion
    // suivante sans rien garantir.
    expect(reponsesVides().length, "plus rien de detecte: la detection est cassee").toBeGreaterThan(0);
  });

  it("aucune route ne sert du vide en 200 en dehors des exceptions", () => {
    const nouvelles = reponsesVides().filter((e) => !(EXCEPTIONS as readonly string[]).includes(e));
    expect(
      nouvelles,
      `une panne y est servie comme un resultat vide: ${nouvelles.join(", ")}`,
    ).toEqual([]);
  });

  it("et aucune exception qui n'existe plus", () => {
    const actuelles = reponsesVides();
    const disparues = EXCEPTIONS.filter((e) => !actuelles.includes(e));
    expect(
      disparues,
      `ces exceptions n'ont plus lieu d'etre, les retirer: ${disparues.join(", ")}`,
    ).toEqual([]);
  });
});

describe("les quatre routes du tableau de bord disent leur panne", () => {
  const source = readFileSync(join(ROUTES, "dashboard.ts"), "utf8");

  const cas = [
    ["anomaly-stream", "Erreur flux d'anomalies"],
    ["week-comparison", "Erreur comparaison hebdomadaire"],
    ["team-members", "Erreur membres d'equipe"],
    ["predictions", "Erreur previsions"],
  ] as const;

  for (const [route, message] of cas) {
    it(`${route} repond 500 plutot qu'un vide rassurant`, () => {
      expect(source, `${route}: le message d'erreur a disparu`).toContain(message);
      const i = source.indexOf(message);
      const alentours = source.slice(Math.max(0, i - 200), i + 100);
      expect(alentours, `${route}: le message existe mais sans statut d'erreur`).toMatch(/res\.status\(500\)/);
    });
  }

  it("et chacune journalise l'echec", () => {
    // Trois des quatre ne journalisaient rien du tout: la panne n'existait
    // nulle part, ni a l'ecran ni dans les journaux.
    for (const marqueur of [
      "[AnomalyStream] error:",
      "[Dashboard] comparaison hebdomadaire illisible",
      "[Dashboard] membres d'equipe illisibles",
      "[Dashboard] previsions illisibles",
    ]) {
      expect(source, `journalisation manquante: ${marqueur}`).toContain(marqueur);
    }
  });
});
