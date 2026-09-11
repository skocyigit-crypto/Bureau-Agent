/**
 * Toute tache creee par une IA doit dire qu'elle vient d'une IA.
 *
 * Le defaut d'origine: treize fichiers inseraient directement dans `tasks`,
 * neuf pour le compte d'un agent, et aucun ne le disait. Deux prefixaient le
 * titre (« [Email] ... »), les autres non. Une tache proposee par une machine
 * etait donc indiscernable d'une tache ecrite par un collegue — et l'operateur
 * qui trouvait une tache absurde ne pouvait ni savoir d'ou elle venait, ni
 * couper la source.
 *
 * Ce fichier ne teste pas un comportement: il teste une PROPRIETE DU CODE.
 * C'est volontaire. Un test de comportement verifie que les chemins qu'on a
 * pense a tester marquent bien l'auteur; celui-ci verifie qu'aucun chemin ne
 * peut l'oublier — y compris ceux qu'on ecrira demain.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

/**
 * Fichiers ou une IA decide de creer une tache.
 *
 * La liste est explicite plutot que devinee: c'est elle qu'il faut mettre a
 * jour quand un nouvel agent apparait, et l'oubli se voit en relecture.
 */
const FICHIERS_IA = [
  "routes/ai-agents.ts",
  "routes/ai-analysis.ts",
  "routes/ai-commandant.ts",
  "routes/voice-command.ts",
  "routes/voice-receptionist.ts",
  "routes/voice-site-ops.ts",
  "services/assistant-tools.ts",
  "services/automation-engine.ts",
  "services/call-processor.ts",
  "services/document-ai.ts",
  "routes/meetings.ts",
];

/**
 * Marqueur exige sur une insertion directe qui subsiste dans un fichier d'IA.
 *
 * Il en reste une, legitime: l'import d'un tableau, ou l'humain choisit ligne
 * a ligne ce qu'il importe. Le modele a lu le fichier, mais c'est bien une
 * personne qui a decide — l'attribution par role n'a rien a arbitrer.
 *
 * Le marqueur doit etre ECRIT, pas deduit. C'est la difference entre une
 * exception assumee et un oubli: le controle precedent, par FICHIER, se
 * contentait de trouver `creerTacheIa` quelque part dans le fichier — si bien
 * qu'une seule insertion correcte couvrait toutes les autres. L'insertion
 * d'import passait ainsi inapercue.
 */
const MARQUEUR_SAISIE_HUMAINE = "tache-ia: SAISIE HUMAINE";

function lire(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

describe("la porte unique", () => {
  it("existe et pose l'agent sur chaque tache", () => {
    const porte = lire("services/tache-ia.ts");
    expect(porte).toContain("createdByAgent: demande.agent");
    // La mention suit aussi la tache hors de l'application: dans un courriel
    // de notification, dans un export, dans une capture d'ecran.
    expect(porte).toContain("Propose par");
  });

  it("choisit le destinataire par role, pas au hasard", () => {
    expect(lire("services/tache-ia.ts")).toContain("attribuer(");
  });
});

/**
 * Toutes les insertions de tache du depot, avec le bloc `values({...})` qui
 * les accompagne.
 *
 * La borne est prise au `.returning(` ou au `});` qui SUIT l'ouverture, en
 * comptant les accolades. Une premiere version cherchait naivement le premier
 * `});` et debordait sur l'insertion suivante — le meme defaut qu'un
 * precedent controle de couverture, ou la borne sautait d'une table a l'autre
 * et validait des blocs qu'elle n'avait jamais lus.
 */
function insertionsDeTache(): Array<{ fichier: string; bloc: string; ligne: number }> {
  const resultats: Array<{ fichier: string; bloc: string; ligne: number }> = [];
  for (const dossier of ["routes", "services"]) {
    for (const f of readdirSync(join(SRC, dossier))) {
      if (!f.endsWith(".ts") || f.includes(".test.")) continue;
      const rel = `${dossier}/${f}`;
      const source = lire(rel);
      let depuis = 0;
      for (;;) {
        const i = source.indexOf("insert(tasksTable)", depuis);
        if (i === -1) break;
        const debut = source.indexOf("{", i);
        let profondeur = 0;
        let fin = debut;
        for (let k = debut; k < source.length; k += 1) {
          if (source[k] === "{") profondeur += 1;
          else if (source[k] === "}") {
            profondeur -= 1;
            if (profondeur === 0) { fin = k; break; }
          }
        }
        resultats.push({
          fichier: rel,
          bloc: source.slice(debut, fin + 1),
          ligne: source.slice(0, i).split("\n").length,
        });
        depuis = fin + 1;
      }
    }
  }
  return resultats;
}

describe("toute tache dit qui l'a creee", () => {
  it("trouve bien des insertions a controler", () => {
    // Garde-fou du test lui-meme: si l'extraction tombe a zero — parce que
    // Drizzle change de syntaxe, ou parce qu'on renomme la table — l'assertion
    // suivante passerait pour de mauvaises raisons, et le jour ou quelqu'un
    // oublie l'auteur, personne ne le saurait.
    //
    // Le seuil est bas (4) et le restera: il y avait quatorze insertions avant
    // que les agents ne passent par la porte unique, il en reste cinq, toutes
    // legitimes. Un seuil calque sur l'ancien nombre echouerait a chaque
    // migration reussie — un test ne doit pas punir le progres qu'il a permis.
    expect(insertionsDeTache().length).toBeGreaterThanOrEqual(4);
  });

  it("aucune insertion ne laisse l'auteur inconnu", () => {
    // L'invariant, et il est plus juste que « les agents n'inserent pas »:
    // une tache appartient soit a un humain (`createdBy`), soit a un agent
    // (`createdByAgent`). Ni l'un ni l'autre, c'est une tache qui apparait
    // dans la liste de quelqu'un sans que personne ne puisse dire d'ou elle
    // vient — le defaut exact qu'on corrige.
    const anonymes = insertionsDeTache()
      .filter(({ bloc }) => !/createdBy\s*:/.test(bloc) && !/createdByAgent\s*:/.test(bloc))
      .map(({ fichier, ligne }) => `${fichier}:${ligne}`);

    expect(
      anonymes,
      "ces insertions ne disent ni quel humain ni quel agent a cree la tache",
    ).toEqual([]);
  });

  it("aucune insertion d'un fichier d'IA n'echappe a la porte unique", () => {
    // Controle par INSERTION, et non par fichier. Un agent pourrait poser
    // `createdByAgent` a la main et satisfaire l'invariant precedent: il
    // perdrait l'attribution par role, qui est l'autre moitie du travail. Et
    // un fichier qui appelle correctement la porte a un endroit peut tres
    // bien inserer en direct a un autre — c'etait le cas de l'import.
    const sources = new Map(FICHIERS_IA.map((rel) => [rel, lire(rel)]));
    const contournements = insertionsDeTache()
      .filter(({ fichier }) => sources.has(fichier))
      .filter(({ fichier, bloc }) => {
        const source = sources.get(fichier);
        if (source === undefined) return false;
        // Les lignes qui precedent immediatement l'insertion: le marqueur doit
        // se trouver a cote de ce qu'il justifie, pas en haut du fichier.
        const avant = source.split(bloc)[0].split("\n").slice(-8).join("\n");
        return !avant.includes(MARQUEUR_SAISIE_HUMAINE);
      })
      .map(({ fichier, ligne }) => `${fichier}:${ligne}`);

    expect(
      contournements,
      "ces insertions contournent creerTacheIa sans porter le marqueur de saisie humaine: ni attribution par role, ni mention que l'IA a redige la tache",
    ).toEqual([]);
  });
});

describe("le schema porte la trace", () => {
  it("la colonne existe et n'est pas un simple booleen", () => {
    // Un booleen `creeParIa` aurait rendu impossible de distinguer le
    // depouillement des courriels de l'analyse d'un appel — donc impossible
    // de couper un agent sans couper les autres.
    const schema = readFileSync(
      join(SRC, "..", "..", "..", "lib", "db", "src", "schema", "tasks.ts"),
      "utf8",
    );
    expect(schema).toContain('createdByAgent: text("created_by_agent")');
  });
});
