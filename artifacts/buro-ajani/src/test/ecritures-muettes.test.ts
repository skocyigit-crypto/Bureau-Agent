/**
 * L'autre forme du meme defaut : `catch {}` sur une ecriture.
 *
 * `echecs-silencieux.test.ts` garde le cas ou le serveur REPOND une erreur.
 * Celui-ci garde le cas ou la requete n'aboutit meme pas — reseau coupe,
 * session expiree, serveur injoignable. Le bloc `catch` est alors vide : la
 * boite de dialogue se ferme, le formulaire est reinitialise, la liste est
 * rechargee sans la nouvelle ligne, et rien ne dit pourquoi.
 *
 * C'est pire que le premier cas, parce que la saisie est PERDUE : le
 * formulaire a deja ete vide au moment ou l'on decouvre que rien n'est
 * enregistre.
 *
 * Comme l'autre, c'est un CLIQUET. Les reparer tous d'un coup serait une
 * modification massive et peu sure ; empecher le nombre de monter est
 * immediat, et chaque correction fait baisser le plafond.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plafond courant. A BAISSER a chaque correction — jamais a monter.
 *
 * 19/09 : 43 au premier comptage, puis 34. Traites les enregistrements de
 * formulaire ou la saisie etait perdue sans un mot (contacts, appels, agenda,
 * messages) et les trois actions de pointage.
 *
 * `messages.tsx:283` reste volontairement muet : il marque un message comme lu
 * en arriere-plan, sans que l utilisateur ait rien demande. Un avertissement y
 * serait du bruit, et l operation se refait au prochain affichage.
 */
const PLAFOND = 34;

const RACINES = [
  join(import.meta.dirname, "..", "..", "..", "mobile", "app"),
  join(import.meta.dirname, "..", "pages"),
];

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return p.endsWith(".tsx") && !p.includes(".test.") ? [p] : [];
  });
}

/**
 * Les `catch {}` vides qui suivent une ECRITURE.
 *
 * La fenetre de 22 lignes remonte jusqu'a l'appel : au-dela, le `catch`
 * appartient vraisemblablement a autre chose. Les lectures sont volontairement
 * hors du compte — une liste vide se voit, une saisie perdue non.
 */
function muettes(): Array<{ fichier: string; ligne: number }> {
  const out: Array<{ fichier: string; ligne: number }> = [];
  for (const racine of RACINES) {
    for (const f of fichiers(racine)) {
      const lignes = readFileSync(f, "utf8").split(/\r?\n/);
      lignes.forEach((l, i) => {
        if (!/\} catch \{\s*\}/.test(l)) return;
        const avant = lignes.slice(Math.max(0, i - 22), i).join("\n");
        if (!/await (create|update|delete)\w+\(|method: "(POST|PUT|PATCH|DELETE)"/.test(avant)) return;
        out.push({ fichier: f, ligne: i + 1 });
      });
    }
  }
  return out;
}

describe("une saisie perdue ne doit plus l'etre en silence", () => {
  const releve = muettes();

  it("le comptage trouve bien quelque chose a compter", () => {
    // Garde-fou du controle: une detection tombee a zero ferait passer
    // l'assertion suivante sans rien garantir.
    expect(releve.length, "plus rien de detecte: la detection est cassee").toBeGreaterThan(5);
  });

  it("leur nombre ne depasse pas le plafond", () => {
    const apercu = releve.slice(0, 5)
      .map((r) => `${r.fichier.split(/[\\/]/).slice(-2).join("/")}:${r.ligne}`).join(", ");
    expect(
      releve.length,
      `une nouvelle ecriture muette a ete ajoutee. Par exemple: ${apercu}`,
    ).toBeLessThanOrEqual(PLAFOND);
  });

  it("le plafond suit la realite: il doit etre baisse quand on corrige", () => {
    expect(
      PLAFOND - releve.length,
      `${releve.length} ecritures muettes pour un plafond de ${PLAFOND}: abaisser PLAFOND`,
    ).toBeLessThanOrEqual(3);
  });

  it("les enregistrements de formulaire deja traites disent leur echec", () => {
    // Ce sont ceux ou la saisie etait perdue: le formulaire venait d'etre vide.
    const traites = [
      join("(tabs)", "contacts.tsx"),
      join("(tabs)", "calls.tsx"),
      "calendar.tsx",
    ];
    for (const nom of traites) {
      const source = readFileSync(join(RACINES[0]!, nom), "utf8");
      expect(
        source,
        `${nom}: l'echec d'un enregistrement y est redevenu muet`,
      ).toMatch(/catch \{ Alert\.alert\(t\("common\.error"\), t\("common\.actionFailed"\)\); \}/);
    }
  });
});

/**
 * Troisieme forme, propre au mobile : la reponse n'est simplement pas lue.
 *
 * `fetchAuth` ne leve PAS sur un refus du serveur — il rend la reponse, comme
 * `fetch`. Un `await fetchAuth(..., { method: "POST" })` dont on ignore le
 * resultat traite donc un 403, un 404 ou un 409 comme une reussite : l'ecran
 * se ferme, la liste se recharge, et l'utilisateur en conclut que c'est fait.
 *
 * C'est la forme la plus trompeuse des trois, parce qu'elle produit une fausse
 * CONFIRMATION la ou les deux autres ne produisent rien.
 */
describe("une ecriture mobile lit la reponse du serveur", () => {
  /** Plafond courant. A BAISSER a chaque correction — jamais a monter. */
  //
  // 19/09 : 14 au premier comptage, puis 2. Les deux qui restent sont des
  // choix, ecrits sur place :
  //   - `documents.tsx`, l arret d un scan groupe — le serveur s arrete de
  //     toute facon ;
  //   - `rappels.tsx`, « tout marquer comme lu » en arriere-plan — un
  //     avertissement y serait du bruit, et l operation se refait.
  const PLAFOND_REPONSES = 2;

  function ignorees(): string[] {
    const out: string[] = [];
    for (const f of fichiers(RACINES[0]!)) {
      const lignes = readFileSync(f, "utf8").split(/\r?\n/);
      lignes.forEach((l, i) => {
        // `await fetchAuth(...)` dont le resultat n'est affecte a rien.
        if (!/^\s*await fetchAuth\(/.test(l)) return;
        if (!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(lignes.slice(i, i + 5).join("\n"))) return;
        out.push(`${f.split(/[\\/]/).slice(-1)[0]}:${i + 1}`);
      });
    }
    return out;
  }

  it("le comptage trouve bien quelque chose a compter", () => {
    expect(ignorees().length, "detection cassee").toBeGreaterThan(0);
  });

  it("leur nombre ne depasse pas le plafond", () => {
    const liste = ignorees();
    expect(
      liste.length,
      `une ecriture ignore a nouveau la reponse du serveur: ${liste.join(", ")}`,
    ).toBeLessThanOrEqual(PLAFOND_REPONSES);
  });

  it("les ecrans deja traites n'y reviennent pas", () => {
    // Assertion sur le COMPTE de ces fichiers, et non sur la simple presence
    // d'un `if (!r.ok)` quelque part: en retirer un sur trois passerait
    // inapercu, et c'est exactement la regression qu'on veut voir.
    const liste = ignorees();
    for (const nom of ["notes-internes.tsx", "users.tsx", "calendar.tsx", "gmail-agent.tsx", "organisations.tsx", "prospects.tsx", "whatsapp-thread.tsx"]) {
      const restantes = liste.filter((e) => e.startsWith(`${nom}:`));
      expect(restantes, `${nom}: une ecriture y ignore a nouveau la reponse`).toEqual([]);
    }
  });
});

describe("les deux exceptions restantes sont des choix, pas des oublis", () => {
  /**
   * Une exception qui n'est pas justifiee sur place redevient un oubli a la
   * relecture suivante. Ces deux-la portent leur raison dans le fichier ; ce
   * controle verifie qu'elle y reste, et qu'on ne l'etend pas en silence.
   */
  it("l'arret d'un scan groupe explique pourquoi il n'attend rien", () => {
    const source = readFileSync(join(RACINES[0]!, "documents.tsx"), "utf8");
    expect(source).toMatch(/Le serveur s'arrêtera de toute façon/);
  });

  it("« tout marquer comme lu » ne bloque pas sur un echec", () => {
    // Optimiste et repetable: l'operation se refait au prochain affichage.
    const source = readFileSync(join(RACINES[0]!, "rappels.tsx"), "utf8");
    expect(source).toMatch(/notifications\/read-all/);
    expect(source).toMatch(/\.catch\(\(\) => null\)/);
  });
});
