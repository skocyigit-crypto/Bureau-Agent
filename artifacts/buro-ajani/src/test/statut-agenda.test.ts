/**
 * Un evenement d'agenda ne s'affiche jamais avec un code de statut brut.
 *
 * Mesure du 28/09 : la secretaire telephonique inscrivait ses rendez-vous
 * « a_confirmer ». L'agenda ne connait que confirme / en_attente / annule /
 * reporte : le badge montrait « a_confirmer » tel quel, et la fenetre
 * d'edition une liste de statuts vide. La secretaire ecrit desormais
 * « confirme » (apres le « oui » de l'appelant) ; les anciens rendez-vous
 * restent en base et passent par `statutAgenda`.
 *
 * Le dernier bloc lit le SERVEUR : tout statut qu'une route ecrit dans
 * `calendar_events` doit avoir un libelle a l'ecran, dans chaque langue.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { statutAgenda } from "@/lib/statut-agenda";

const WEB = join(import.meta.dirname, "..");
const API = join(import.meta.dirname, "..", "..", "..", "api-server", "src");
const LANGUES = ["fr", "en", "tr", "es", "de", "ar"] as const;

const libelles = (l: string) =>
  (JSON.parse(readFileSync(join(WEB, "i18n", "locales", `${l}.json`), "utf8")).calendar?.statuses ?? {}) as Record<string, string>;
const statutsEcran = Object.keys(libelles("fr"));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) { if (nom !== "__tests__") out.push(...sources(p)); }
    else if (nom.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Statuts litteraux ecrits par `.insert(calendarEventsTable).values({...})`. */
function statutsEcritsParLeServeur(): Map<string, string> {
  const trouves = new Map<string, string>();
  for (const f of sources(API)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.insert\(calendarEventsTable\)\s*\.values\(/g)) {
      let i = m.index! + m[0].length, prof = 1;
      const debut = i;
      while (i < src.length && prof > 0) {
        if (src[i] === "(") prof++;
        else if (src[i] === ")") prof--;
        i++;
      }
      for (const s of src.slice(debut, i).matchAll(/\bstatus:\s*"([a-z_]+)"/g)) trouves.set(s[1]!, f.slice(API.length + 1));
    }
  }
  // Les rendez-vous proposes par un modele sont construits par
  // `rendezVousPropose` (services/sortie-ia.ts) puis inseres avec
  // `.values(valeurs)` : le statut n'est pas dans la parenthese. Sans cette
  // lecture, l'instrument perdait `en_attente` et tombait sous son plancher.
  const constructeur = readFileSync(join(API, "services", "sortie-ia.ts"), "utf8");
  const corps = constructeur.slice(constructeur.indexOf("export function rendezVousPropose"));
  for (const s of corps.slice(0, corps.indexOf("\n}\n")).matchAll(/\bstatus:\s*"([a-z_]+)"/g)) trouves.set(s[1]!, "services/sortie-ia.ts");
  return trouves;
}

describe("statutAgenda", () => {
  it("un ancien rendez-vous « a_confirmer » s'affiche « en attente »", () => {
    expect(statutAgenda("a_confirmer")).toBe("en_attente");
  });

  it.each(["confirme", "en_attente", "annule", "reporte"])("« %s » est rendu tel quel", (s) => {
    expect(statutAgenda(s)).toBe(s);
  });

  it("un statut absent reste absent (pas de statut invente)", () => {
    expect(statutAgenda(null)).toBeNull();
    expect(statutAgenda(undefined)).toBeUndefined();
    expect(statutAgenda("")).toBe("");
  });

  it("le resultat de l'ancien statut a un libelle dans les six langues", () => {
    for (const l of LANGUES) expect(libelles(l)[statutAgenda("a_confirmer") as string], l).toBeTruthy();
  });
});

describe("l'ecran d'agenda passe par statutAgenda", () => {
  const page = readFileSync(join(WEB, "pages", "calendar.tsx"), "utf8");

  it("les evenements recus du serveur sont normalises avant affichage", () => {
    expect(page).toMatch(/data\.events \|\| \[\]\)\.map\(\(e: any\) => \(\{ \.\.\.e, status: statutAgenda\(e\.status\)/);
  });

  it("chaque statut propose a l'edition a un libelle dans chaque langue", () => {
    const proposes = [...page.slice(page.indexOf("const STATUSES"), page.indexOf("];", page.indexOf("const STATUSES")))
      .matchAll(/value: "([a-z_]+)"/g)].map((m) => m[1]!);
    expect(proposes.length).toBeGreaterThanOrEqual(4);
    for (const l of LANGUES) for (const s of proposes) expect(libelles(l)[s], `${l}:${s}`).toBeTruthy();
  });
});

describe("ce que le serveur ecrit, l'ecran sait l'afficher", () => {
  const ecrits = statutsEcritsParLeServeur();

  it("l'instrument trouve les ecritures du serveur (garde-fou)", () => {
    // Routes calendrier, assistant, secretaire telephonique… : au moins une
    // demi-douzaine d'insertions portent un statut litteral.
    expect(ecrits.size).toBeGreaterThanOrEqual(2);
    expect(ecrits.get("confirme")).toBeDefined();
  });

  it("la secretaire telephonique n'ecrit plus « a_confirmer »", () => {
    expect([...ecrits.entries()].filter(([s]) => s === "a_confirmer")).toEqual([]);
  });

  it("tout statut ecrit dans calendar_events a un libelle a l'ecran", () => {
    const inconnus = [...ecrits.entries()]
      .filter(([s]) => !statutsEcran.includes(statutAgenda(s) as string))
      .map(([s, f]) => `${f}: ${s}`);
    expect(inconnus).toEqual([]);
  });
});
