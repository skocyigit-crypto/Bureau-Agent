/**
 * Toute tache inscrite au declencheur externe doit enregistrer son battement.
 *
 * Ce n'est pas une convention de style. `runDueCrons` decide qu'une tache est
 * due en comparant `lastRunAt` — lu dans `cron_heartbeats` — a son intervalle,
 * et traite explicitement l'absence de ligne comme « jamais executee »:
 *
 *     const due = last === undefined || now - last >= cron.intervalMs;
 *
 * Une tache qui n'ecrit jamais son battement est donc due A CHAQUE PASSAGE du
 * declencheur, pour toujours. Le defaut ne se signale par aucune erreur: la
 * tache fonctionne, elle fonctionne simplement beaucoup trop souvent.
 *
 * Mesure en production (journaux sur 24 h, avant correction): la purge de
 * retention, annoncee quotidienne, etait declenchee a ~144 des 144 ticks —
 * elle reecrivait donc l'historique des appels, les scans de securite et la
 * corbeille cent quarante-quatre fois par jour au lieu d'une. Et comme le
 * diagnostic de sante lit la meme table, elle y etait invisible: le commentaire
 * du fichier affirmait pourtant l'y rendre visible.
 *
 * D'ou ce test de FORME. Le comportement, lui, ne le revelerait pas: rien ne
 * casse: il faudrait compter les executions sur une journee entiere pour s'en
 * apercevoir. C'est exactement le genre de defaut qu'une suite verte laisse
 * passer des annees.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICES = join(import.meta.dirname, "..", "services");

/**
 * Deux exceptions, et seulement deux:
 *
 *   - `cron-registry.ts` DECLARE `registerRunnableCron`; il ne s'inscrit pas;
 *   - `health-agents.ts` DEFINIT `withHeartbeat`, l'enveloppe qui ecrit le
 *     battement pour le compte des autres — son inscription se fait au nom
 *     d'une tache tierce.
 */
const HORS_SUJET = new Set(["cron-registry.ts", "health-agents.ts"]);

function fichiersQuiInscrivent(): string[] {
  return readdirSync(SERVICES)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !HORS_SUJET.has(f))
    .filter((f) => readFileSync(join(SERVICES, f), "utf8").includes("registerRunnableCron("));
}

describe("les taches inscrites au declencheur externe", () => {
  const fichiers = fichiersQuiInscrivent();

  // Garde-fou: si l'extraction cesse de trouver quoi que ce soit (renommage du
  // registre, deplacement du dossier), le test passerait a vide et cesserait
  // silencieusement de proteger quoi que ce soit.
  it("sont bien trouvees par ce test", () => {
    expect(fichiers.length, "aucune inscription trouvee: l'extraction a derive").toBeGreaterThanOrEqual(5);
  });

  it.each(fichiersQuiInscrivent())("%s enregistre son battement", (fichier) => {
    const source = readFileSync(join(SERVICES, fichier), "utf8");
    expect(
      source.includes("recordCronHeartbeat"),
      `${fichier} s'inscrit au declencheur sans jamais ecrire son battement: ` +
        "sa ligne restera absente de cron_heartbeats, donc la tache sera jugee " +
        "due a chaque tick et tournera en boucle au lieu de respecter son intervalle.",
    ).toBe(true);
  });
});

describe("la regle qui rend ce test necessaire", () => {
  it("l'absence de battement vaut bien « jamais executee »", () => {
    // Si cette ligne changeait — par exemple pour considerer une tache inconnue
    // comme non due — le test ci-dessus deviendrait une simple preference de
    // style. On verifie donc la raison, pas seulement la consequence.
    const registre = readFileSync(join(SERVICES, "cron-registry.ts"), "utf8");
    expect(registre).toMatch(/last === undefined \|\| now - last >= cron\.intervalMs/);
  });
});
