/**
 * Un journal doit recevoir l'ERREUR, pas son message.
 *
 * Pino serialise un `Error` avec son type, sa pile et sa chaine de CAUSES.
 * Passer `err.message` jette tout le reste — or la cause est exactement ce
 * qu'on cherche: un « Failed query: ... » ne dit pas POURQUOI la requete a
 * echoue; son `cause` dit « Connection terminated ».
 *
 * HISTOIRE DE CE TEST, parce qu'elle explique pourquoi il existe.
 *
 * La regle a ete corrigee une premiere fois: 41 appels reecrits, en cherchant
 * `{ err: err.message` exactement. La recherche etait trop etroite. Elle
 * ignorait `err?.message`, `error.message`, `(err as any)?.message` et
 * `err?.message ?? err` — trente-huit appels de plus, dont
 *
 *     services/auto-backup.ts  logger.error({ err: error.message }, "[AutoBackup] Erreur critique:")
 *
 * c'est-a-dire LA LIGNE qui avait motive la correction. Seize echecs de
 * sauvegarde en sept jours n'avaient rien dit de leur cause; j'ai corrige
 * quarante-et-un autres endroits et laisse celui-la.
 *
 * Une correction verifiee a la main s'arrete ou s'arrete l'attention de celui
 * qui la fait. Ce test, lui, ne se lasse pas: il compte, et le compte doit
 * rester a zero.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

/**
 * Un appel de journalisation qui met `<quelque chose>.message` dans `err`,
 * sous toutes ses formes: `err.message`, `err?.message`, `error.message`,
 * `(err as any)?.message`, avec ou sans repli.
 */
const JOURNAL_SANS_CAUSE = /(?:logger|req\.log)\.(?:error|warn|info)\(\{[^}]*\berr:[^,}]*\.message/;

function fichiersSources(dossier: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) {
      if (entree === "__tests__" || entree === "node_modules") continue;
      fichiersSources(chemin, acc);
      continue;
    }
    if (entree.endsWith(".ts") && !entree.endsWith(".test.ts")) acc.push(chemin);
  }
  return acc;
}

describe("les journaux d'erreur", () => {
  const fichiers = fichiersSources(SRC);

  it("le balayage trouve bien les sources", () => {
    // Garde-fou: une extraction vide passerait sans rien verifier, ce qui est
    // exactement la facon dont ce genre de garde meurt en silence.
    expect(fichiers.length, "aucun fichier source parcouru").toBeGreaterThan(100);
  });

  it("ne jettent jamais la cause", () => {
    const fautifs = fichiers
      .map((f) => ({ f, lignes: readFileSync(f, "utf8").split(/\r?\n/) }))
      .flatMap(({ f, lignes }) =>
        lignes
          .map((l, i) => ({ l, i }))
          .filter(({ l }) => JOURNAL_SANS_CAUSE.test(l))
          .map(({ i }) => `${f.slice(f.indexOf("src"))}:${i + 1}`),
      );

    expect(
      fautifs,
      "ces appels passent le message au lieu de l'erreur: la chaine de causes " +
        "sera perdue, et le journal ne dira pas pourquoi la panne a eu lieu",
    ).toEqual([]);
  });

  it("le fichier qui avait motive la correction n'existe plus, et c'est voulu", () => {
    // `services/auto-backup.ts` portait la ligne citee en exemple. Il a ete
    // retire le 19/09: il n'exportait aucune donnee restaurable et inscrivait
    // pourtant `status: "termine"` avec une mention de chiffrement. La vraie
    // sauvegarde par organisation vit dans services/tenant-backup.ts.
    //
    // On verrouille le fait qu'il ne revienne pas: ressusciter ce module
    // remettrait en place la fausse assurance, pas seulement une ligne de
    // journal.
    expect(existsSync(join(SRC, "services", "auto-backup.ts"))).toBe(false);
    const vraie = readFileSync(join(SRC, "services", "tenant-backup.ts"), "utf8");
    expect(vraie, "la vraie sauvegarde doit rester celle qui exporte des donnees").toMatch(/organisation/i);
  });
});

describe("ce qui reste legitime", () => {
  it("une reponse HTTP peut porter le seul message", () => {
    // Envoyer une pile d'execution au client serait l'inverse de ce qu'il
    // faut. Le test ci-dessus ne vise que les appels de journalisation, et
    // cette verification le rappelle: si elle tombait, c'est que la regle
    // serait devenue trop large.
    const source = readFileSync(join(SRC, "services", "telephony-providers.ts"), "utf8");
    expect(source).toMatch(/return \{ success: false, error: err\.message \}/);
  });
});
