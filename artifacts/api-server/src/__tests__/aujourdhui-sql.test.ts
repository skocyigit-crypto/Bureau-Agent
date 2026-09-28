/**
 * « Aujourd'hui » en SQL est celui de l'entreprise, pas celui de Postgres.
 *
 * Mesure du 28/09 (piege signale par la session Assise) : la connexion ne fixe
 * pas de fuseau, la session Postgres est donc en UTC. `DATE(col) =
 * CURRENT_DATE` y designe encore HIER entre minuit et 2 h a Paris : le
 * briefing vocal, « combien d'appels aujourd'hui », « mon agenda du jour » et
 * le compteur de reconnaissances faciales du jour comptaient la veille.
 * `aujourdhui-local.test.ts` garde le meme defaut cote JavaScript.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { bornesDuJour, jourLocal } from "../lib/jour-local";

const SRC = join(import.meta.dirname, "..");
const H = 3600_000;

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) { if (nom !== "__tests__") out.push(...fichiers(p)); }
    else if (nom.endsWith(".ts")) out.push(p);
  }
  return out;
}
const SOURCES = fichiers(SRC).map((f) => ({ rel: relative(SRC, f).replace(/\\/g, "/"), texte: readFileSync(f, "utf8") }));
const gabaritsSql = (src: string) => [...src.matchAll(/\bsql(?:<[^>]*>)?`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]!);

/** Le jour de la SESSION Postgres, quelle que soit l'ecriture. */
const JOUR_DE_SESSION = /\bcurrent_date\b|\bnow\(\)\s*::\s*date\b|\bcurrent_timestamp\s*::\s*date\b|\blocaltimestamp\b|date_trunc\(\s*'day'\s*,\s*(now\(\)|current_timestamp)\s*\)/i;

describe("aucun « aujourd'hui » de session dans les gabarits sql", () => {
  it("l'instrument lit les gabarits sql (garde-fou)", () => {
    expect(SOURCES.flatMap((s) => gabaritsSql(s.texte)).length).toBeGreaterThan(100);
  });

  it("l'instrument reconnait chaque ecriture du defaut (controle)", () => {
    for (const ecrit of [
      "DATE(${}) = CURRENT_DATE", "${} >= current_date", "created_at::date = now()::date",
      "x >= date_trunc('day', now())", "x::date = CURRENT_TIMESTAMP::date",
    ]) expect(JOUR_DE_SESSION.test(ecrit), ecrit).toBe(true);
    expect(JOUR_DE_SESSION.test("${} >= now() - interval '1 day'")).toBe(false);
  });

  it("aucun gabarit sql du serveur ne prend le jour de la session", () => {
    const fautifs = SOURCES.flatMap((s) => gabaritsSql(s.texte)
      .filter((g) => JOUR_DE_SESSION.test(g))
      .map((g) => `${s.rel}: ${g.trim().slice(0, 90)}`));
    expect(fautifs, "comparer a bornesDuJour() (lib/jour-local)").toEqual([]);
  });

  it("les ecrans corriges passent par bornesDuJour", () => {
    for (const f of ["routes/voice-command.ts", "routes/face-recognition.ts"]) {
      expect(SOURCES.find((s) => s.rel === f)!.texte, f).toMatch(/bornesDuJour\(\)/);
    }
  });
});

describe("bornesDuJour", () => {
  it("00:30 a Paris l'ete : le jour de Paris, alors que la date UTC est encore la veille", () => {
    const instant = new Date("2026-09-28T22:30:00Z"); // 29/09 00:30 a Paris
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-28");
    const { debut, fin } = bornesDuJour(instant);
    expect(debut.toISOString()).toBe("2026-09-28T22:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-09-29T22:00:00.000Z");
    expect(jourLocal(debut)).toBe("2026-09-29");
  });

  it("01:59 a Paris l'hiver : minuit de Paris est 23:00 UTC la veille", () => {
    const { debut, fin } = bornesDuJour(new Date("2026-12-15T00:59:00Z"));
    expect(debut.toISOString()).toBe("2026-12-14T23:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-12-15T23:00:00.000Z");
  });

  it("23:59 a Paris : encore le meme jour", () => {
    const { debut, fin } = bornesDuJour(new Date("2026-09-29T21:59:00Z"));
    expect(debut.toISOString()).toBe("2026-09-28T22:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-09-29T22:00:00.000Z");
  });

  it("passage a l'heure d'ete (29/03/2026) : une journee de 23 h", () => {
    const { debut, fin } = bornesDuJour(new Date("2026-03-29T10:00:00Z"));
    expect(debut.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(fin.getTime() - debut.getTime()).toBe(23 * H);
  });

  it("retour a l'heure d'hiver (25/10/2026) : une journee de 25 h", () => {
    const { debut, fin } = bornesDuJour(new Date("2026-10-25T21:30:00Z"));
    expect(debut.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(fin.getTime() - debut.getTime()).toBe(25 * H);
  });

  it("l'instant est toujours dans ses bornes [debut, fin[, sur toute une annee", () => {
    const depart = Date.UTC(2026, 0, 1);
    for (let t = depart; t < depart + 366 * 24 * H; t += 7 * H + 13 * 60_000) {
      const { debut, fin } = bornesDuJour(new Date(t));
      expect(debut.getTime() <= t && t < fin.getTime(), new Date(t).toISOString()).toBe(true);
      expect(jourLocal(debut)).toBe(jourLocal(new Date(t)));
      expect(jourLocal(new Date(fin.getTime() - 1))).toBe(jourLocal(new Date(t)));
    }
  });

  it("deux jours consecutifs se touchent sans chevauchement ni trou", () => {
    const a = bornesDuJour(new Date("2026-10-24T12:00:00Z"));
    const b = bornesDuJour(new Date("2026-10-25T12:00:00Z"));
    expect(a.fin.getTime()).toBe(b.debut.getTime());
  });
});
