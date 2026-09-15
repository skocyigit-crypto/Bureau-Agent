/**
 * Trente demarrages simultanes pour huit connexions.
 *
 * LA MESURE
 *
 * Le pool vaut HUIT connexions par instance (`DB_POOL_MAX`), avec une attente
 * plafonnee a dix secondes. Au-dela de huit demandeurs simultanes, les
 * suivants font la queue puis abandonnent sur « timeout exceeded when trying
 * to connect » — une erreur du pool cote client, pas un refus de Postgres.
 *
 * Le fichier de demarrage lancait une trentaine de taches dans le meme tick,
 * dont trois qui posent du DDL (verrous, donc lentes) et une vingtaine de
 * crons qui font un premier passage immediat. Demarrage du 15/09 a 15h54,
 * huit echecs etales sur soixante secondes:
 *
 *     15:54:27  [audit] failed to install append-only triggers
 *     15:54:54  [security] failed to install user-quota trigger
 *     15:55:06  [cloture] echec du passage
 *     15:55:11  Erreur seed admin + [AutoBackup] Erreur critique
 *     15:55:17  [ai-utils] Purge ai_usage failed
 *     15:55:23  deux ticks de cron
 *
 * Ce n'etait pas propre a ce demarrage: meme rafale a 12h42 (douze echecs),
 * avant les changements de la journee. Elle est INTERMITTENTE — elle depend
 * de l'ordre d'arrivee — donc invisible la plupart du temps, et elle se
 * resorbe seule, ce qui acheve de la faire passer inapercue. Entre-temps,
 * une cloture comptable a ete sautee.
 *
 * CE QUE CES TESTS PEUVENT ETABLIR
 *
 * Pas le comportement: reproduire une famine de pool demanderait de vraies
 * connexions concurrentes et resterait dependant de l'ordonnancement. Ce
 * qu'ils verrouillent, c'est la FORME qui a cause la rafale — un amorcage
 * serialise, et le reste qui l'attend. C'est plus faible qu'une verification
 * de comportement, et c'est dit plutot que sous-entendu.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(import.meta.dirname, "..", "index.ts"), "utf8");

/** Les trois amorcages qui posent du DDL ou ecrivent au demarrage. */
const AMORCAGES = ["ensureSuperAdmin", "ensureAuditAppendOnly", "ensureUserQuotaTrigger"];

describe("l'amorcage de la base est serialise", () => {
  it("les trois amorcages sont chaines, pas lances ensemble", () => {
    // `void ensureX()` trois fois de suite, c'est trois demandeurs dans le
    // meme tick. Chaines, c'est un seul a la fois.
    expect(SOURCE).toContain("const amorcageBase = ensureSuperAdmin()");
    expect(SOURCE).toContain(".then(() => ensureAuditAppendOnly())");
    expect(SOURCE).toContain(".then(() => ensureUserQuotaTrigger())");
  });

  it("aucun des trois n'est relance en parallele", () => {
    // Le defaut exact: `void ensureAuditAppendOnly();` a cote de la chaine
    // annulerait la serialisation sans rien casser de visible.
    for (const nom of AMORCAGES) {
      expect(
        new RegExp(`void\\s+${nom}\\(`).test(SOURCE),
        `${nom} est encore lance en parallele`,
      ).toBe(false);
    }
  });

  it("un amorcage incomplet est signale, pas avale", () => {
    // Si le DDL echoue malgre tout, il faut le savoir: c'est la garantie
    // d'inalterabilite du journal d'audit qui repose dessus.
    expect(SOURCE).toContain("amorcage base incomplet");
  });

  it("un amorcage qui echoue n'empeche pas le reste de demarrer", () => {
    // L'erreur inverse serait pire qu'une rafale: une base indisponible
    // trente secondes et plus aucun cron ne demarre de la journee.
    const i = SOURCE.indexOf("const amorcageBase");
    const bloc = SOURCE.slice(i, i + 600);
    expect(bloc).toContain(".catch(");
  });
});

describe("les demarrages de fond attendent l'amorcage", () => {
  it("ils sont places apres la chaine", () => {
    // Sans cela, la serialisation ci-dessus ne servirait a rien: les
    // vingt-cinq suivants se disputeraient les memes huit connexions pendant
    // que le DDL les tient.
    expect(SOURCE).toContain("void amorcageBase.then(() => {");
  });

  it("les taches les plus gourmandes sont bien dans le bloc differe", () => {
    // Nommees une a une: ce sont celles qui ont reellement echoue le 15/09.
    const i = SOURCE.indexOf("void amorcageBase.then(() => {");
    const j = SOURCE.indexOf("attachVoiceLiveWs(server)");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const bloc = SOURCE.slice(i, j);
    for (const tache of [
      "startAutoBackup",
      "startClotureCron",
      "startAiUsagePurgeJob",
      "startAccountRetentionCron",
      "startPaymentMatchingCron",
      "startLocationCleanupCron",
    ]) {
      expect(bloc, `${tache} demarre encore avant l'amorcage`).toContain(tache);
    }
  });

  it("le bloc differe contient l'essentiel des demarrages", () => {
    // Garde-fou de comptage: si quelqu'un sort la moitie des taches du bloc,
    // les tests nominatifs ci-dessus pourraient rester verts.
    const i = SOURCE.indexOf("void amorcageBase.then(() => {");
    const j = SOURCE.indexOf("attachVoiceLiveWs(server)");
    const bloc = SOURCE.slice(i, j);
    const demarrages = (bloc.match(/\bstart[A-Z]\w*\(/g) ?? []).length;
    expect(demarrages, "trop peu de demarrages dans le bloc differe").toBeGreaterThanOrEqual(20);
  });

  it("le WebSocket n'attend pas: il ne touche pas la base", () => {
    // Le retarder ferait echouer les connexions vocales pendant l'amorcage,
    // sans aucune contrepartie.
    const i = SOURCE.indexOf("void amorcageBase.then(() => {");
    const fin = SOURCE.indexOf("});", SOURCE.indexOf("startAppointmentReminderCron();", i));
    const j = SOURCE.indexOf("attachVoiceLiveWs(server)");
    expect(j, "attachVoiceLiveWs est entre dans le bloc differe").toBeGreaterThan(fin);
  });
});

describe("le serveur HTTP reste disponible pendant l'amorcage", () => {
  it("l'ecoute est etablie avant toute tache de fond", () => {
    // Ce sequencement ne doit retarder aucune requete utilisateur: le port
    // est deja ouvert quand l'amorcage commence.
    const ecoute = SOURCE.indexOf("app.listen(port");
    const amorcage = SOURCE.indexOf("const amorcageBase");
    expect(ecoute).toBeGreaterThan(0);
    expect(amorcage).toBeGreaterThan(ecoute);
  });

  it("la verification de sante de la base ne bloque pas l'ecoute", () => {
    // Propriete deja en place, verrouillee au passage: elle est la raison
    // pour laquelle un demarrage lent ne rend pas le service indisponible.
    const i = SOURCE.indexOf("const dbHealthPromise");
    const j = SOURCE.indexOf("app.listen(port");
    expect(i).toBeGreaterThan(0);
    expect(i, "la sante de la base est attendue avant d'ecouter").toBeLessThan(j);
    expect(SOURCE.slice(i, j)).not.toContain("await checkDbHealth");
  });
});
