/**
 * Tests de regression du classement de pertinence partage (helpers/relevance).
 *
 * Ce module est la SOURCE UNIQUE de verite utilisee par les outils de
 * resolution nom -> id de l'assistant (find_contact, find_task, find_event,
 * find_recent_call, find_project). Ces outils transforment un nom parle en un
 * id de base de donnees AVANT toute ecriture, en prenant le PREMIER resultat
 * classe. Une modification silencieuse des paliers de score ou du tri
 * score-puis-recence pourrait changer quel enregistrement l'assistant choisit
 * en premier. Cette suite verrouille :
 *   1. l'ordre relatif des paliers RELEVANCE (exact > prefixe > sous-chaine
 *      > paliers de champ) ;
 *   2. rankByRelevance : tri par score, departage par recence, decoupe limit ;
 *   3. scorePhoneMatch : exact vs partiel vs requete trop courte ;
 *   4. prepareQuery / normText : repli d'accents et de casse.
 */
import { describe, expect, it, vi } from "vitest";
import {
  RELEVANCE,
  normText,
  digitsOnly,
  prepareQuery,
  scorePhoneMatch,
  byCreatedAtDesc,
  rankByRelevance,
} from "../helpers/relevance";

// ---------------------------------------------------------------------------
// Stub @workspace/db BEFORE assistant-tools is imported so the find_* tools can
// be executed in-process without a real database. The chainable stub captures
// the WHERE condition handed to `.where(...)` so the test can introspect which
// columns each tool actually queries. db.execute() throws so
// ensureUnaccentExtension() resolves to `false` -> accentInsensitiveIlike()
// falls back to a plain ilike() (simpler, column-bearing SQL nodes to walk).
// ---------------------------------------------------------------------------
const dbStub = vi.hoisted(() => {
  const captured: { where?: unknown } = {};
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    from: () => chain,
    where: (cond: unknown) => {
      captured.where = cond;
      return chain;
    },
    orderBy: () => chain,
    limit: async () => [],
  });
  const db = {
    execute: async () => {
      throw new Error("db stub: no unaccent extension in tests");
    },
    select: () => chain,
  };
  return { captured, db };
});
vi.mock("@workspace/db", () => ({ db: dbStub.db, documentsTable: {} }));

const { Column, SQL, getTableColumns } = await import("drizzle-orm");
const {
  contactsTable,
  tasksTable,
  projetsTable,
  calendarEventsTable,
  callsTable,
} = await import("@workspace/db/schema");
const { getTool } = await import("../services/assistant-tools");
const { scoreContact, scoreTask, scoreEvent, scoreCall, scoreProject } =
  await import("../helpers/tool-scorers");

describe("RELEVANCE — ordre relatif des paliers", () => {
  it("respecte exact > prefixe > sous-chaine pour le champ primaire", () => {
    expect(RELEVANCE.EXACT).toBeGreaterThan(RELEVANCE.PREFIX);
    expect(RELEVANCE.PREFIX).toBeGreaterThan(RELEVANCE.SUBSTRING);
  });

  it("classe les paliers exacts (entier > champ > telephone-partiel)", () => {
    expect(RELEVANCE.EXACT).toBeGreaterThan(RELEVANCE.PHONE_EXACT);
    expect(RELEVANCE.PHONE_EXACT).toBeGreaterThan(RELEVANCE.FIELD_EXACT);
    expect(RELEVANCE.FIELD_EXACT).toBeGreaterThan(RELEVANCE.COMPANY_EXACT);
  });

  it("place les prefixes au-dessus des sous-chaines", () => {
    // PHONE_PARTIAL > PREFIX > FULL_PREFIX > SUBSTRING > FIELD_SUBSTRING > DESC_SUBSTRING
    expect(RELEVANCE.COMPANY_EXACT).toBeGreaterThan(RELEVANCE.PHONE_PARTIAL);
    expect(RELEVANCE.PHONE_PARTIAL).toBeGreaterThan(RELEVANCE.PREFIX);
    expect(RELEVANCE.PREFIX).toBeGreaterThan(RELEVANCE.FULL_PREFIX);
    expect(RELEVANCE.FULL_PREFIX).toBeGreaterThan(RELEVANCE.SUBSTRING);
    expect(RELEVANCE.SUBSTRING).toBeGreaterThan(RELEVANCE.FIELD_SUBSTRING);
    expect(RELEVANCE.FIELD_SUBSTRING).toBeGreaterThan(RELEVANCE.DESC_SUBSTRING);
  });

  it("verrouille la chaine de paliers complete strictement decroissante", () => {
    const tiers = [
      RELEVANCE.EXACT,
      RELEVANCE.PHONE_EXACT,
      RELEVANCE.FIELD_EXACT,
      RELEVANCE.COMPANY_EXACT,
      RELEVANCE.PHONE_PARTIAL,
      RELEVANCE.PREFIX,
      RELEVANCE.FULL_PREFIX,
      RELEVANCE.SUBSTRING,
      RELEVANCE.FIELD_SUBSTRING,
      RELEVANCE.DESC_SUBSTRING,
    ];
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i - 1]).toBeGreaterThan(tiers[i]);
    }
    // Tous les paliers restent positifs (0 est reserve a "pas de match").
    expect(Math.min(...tiers)).toBeGreaterThan(0);
  });
});

describe("normText — repli accents + casse", () => {
  it("supprime les accents et passe en minuscules", () => {
    expect(normText("Léveque")).toBe("leveque");
    expect(normText("ÉÀÎ")).toBe("eai");
  });

  it("coupe les espaces de bord", () => {
    expect(normText("  Ali Yilmaz  ")).toBe("ali yilmaz");
  });

  it("gere null / undefined sans planter", () => {
    expect(normText(null)).toBe("");
    expect(normText(undefined)).toBe("");
  });
});

describe("digitsOnly — extraction des chiffres", () => {
  it("ne conserve que les chiffres", () => {
    expect(digitsOnly("+33 6 12 34 56 78")).toBe("33612345678");
    expect(digitsOnly("(555) 123-4567")).toBe("5551234567");
  });

  it("gere les valeurs nulles", () => {
    expect(digitsOnly(null)).toBe("");
    expect(digitsOnly(undefined)).toBe("");
  });
});

describe("prepareQuery — pre-normalisation de la requete", () => {
  it("calcule la forme texte (accents + casse) et la forme chiffres", () => {
    const q = prepareQuery("Réunion Cuisine");
    expect(q.nq).toBe("reunion cuisine");
    expect(q.nqDigits).toBe("");
  });

  it("extrait les chiffres d'une requete telephonique", () => {
    const q = prepareQuery("06 12 34 56 78");
    expect(q.nq).toBe("06 12 34 56 78");
    expect(q.nqDigits).toBe("0612345678");
  });
});

describe("scorePhoneMatch — exact vs partiel vs trop court", () => {
  it("retourne PHONE_EXACT quand les chiffres correspondent exactement", () => {
    expect(scorePhoneMatch("+33 6 12 34 56 78", "33612345678")).toBe(
      RELEVANCE.PHONE_EXACT,
    );
  });

  it("retourne PHONE_PARTIAL quand le numero contient la requete", () => {
    expect(scorePhoneMatch("+33612345678", "345")).toBe(RELEVANCE.PHONE_PARTIAL);
  });

  it("retourne 0 quand la requete est trop courte (< 3 chiffres)", () => {
    expect(scorePhoneMatch("+33612345678", "33")).toBe(0);
  });

  it("retourne 0 quand le numero est vide ou absent", () => {
    expect(scorePhoneMatch("", "345")).toBe(0);
    expect(scorePhoneMatch(null, "345")).toBe(0);
  });

  it("retourne 0 quand il n'y a pas de correspondance", () => {
    expect(scorePhoneMatch("+33612345678", "999")).toBe(0);
  });

  it("priorise l'exact sur le partiel pour un meme numero", () => {
    const phone = "0612345678";
    const exact = scorePhoneMatch(phone, "0612345678");
    const partial = scorePhoneMatch(phone, "345");
    expect(exact).toBeGreaterThan(partial);
  });
});

describe("byCreatedAtDesc — departage par recence", () => {
  it("classe le plus recent en premier", () => {
    const older = { createdAt: new Date("2024-01-01T00:00:00Z") };
    const newer = { createdAt: new Date("2024-06-01T00:00:00Z") };
    expect(byCreatedAtDesc(older, newer)).toBeGreaterThan(0);
    expect(byCreatedAtDesc(newer, older)).toBeLessThan(0);
    expect(byCreatedAtDesc(newer, newer)).toBe(0);
  });
});

describe("rankByRelevance — tri, departage, decoupe", () => {
  interface Row {
    id: string;
    s: number;
    createdAt: Date;
  }
  const mk = (id: string, s: number, iso: string): Row => ({
    id,
    s,
    createdAt: new Date(iso),
  });

  it("classe par score decroissant", () => {
    const rows = [
      mk("a", 30, "2024-01-01T00:00:00Z"),
      mk("b", 90, "2024-01-01T00:00:00Z"),
      mk("c", 50, "2024-01-01T00:00:00Z"),
    ];
    const ranked = rankByRelevance(rows, (r) => r.s, { limit: 10 });
    expect(ranked.map((x) => x.row.id)).toEqual(["b", "c", "a"]);
    expect(ranked.map((x) => x.score)).toEqual([90, 50, 30]);
  });

  it("departage les scores egaux par recence (plus recent d'abord)", () => {
    const rows = [
      mk("old", 50, "2024-01-01T00:00:00Z"),
      mk("new", 50, "2024-12-01T00:00:00Z"),
      mk("mid", 50, "2024-06-01T00:00:00Z"),
    ];
    const ranked = rankByRelevance(rows, (r) => r.s, { limit: 10 });
    expect(ranked.map((x) => x.row.id)).toEqual(["new", "mid", "old"]);
  });

  it("applique le score AVANT la recence", () => {
    const rows = [
      mk("recentLow", 10, "2025-01-01T00:00:00Z"),
      mk("oldHigh", 90, "2020-01-01T00:00:00Z"),
    ];
    const ranked = rankByRelevance(rows, (r) => r.s, { limit: 10 });
    expect(ranked[0]!.row.id).toBe("oldHigh");
  });

  it("decoupe au nombre limite apres tri", () => {
    const rows = [
      mk("a", 10, "2024-01-01T00:00:00Z"),
      mk("b", 90, "2024-01-01T00:00:00Z"),
      mk("c", 50, "2024-01-01T00:00:00Z"),
      mk("d", 70, "2024-01-01T00:00:00Z"),
    ];
    const ranked = rankByRelevance(rows, (r) => r.s, { limit: 2 });
    expect(ranked.map((x) => x.row.id)).toEqual(["b", "d"]);
  });

  it("accepte un departage personnalise", () => {
    const rows = [
      mk("a", 50, "2024-01-01T00:00:00Z"),
      mk("b", 50, "2024-12-01T00:00:00Z"),
    ];
    // Departage alphabetique inverse pour prouver que l'option est respectee.
    const ranked = rankByRelevance(rows, (r) => r.s, {
      limit: 10,
      tiebreak: (x, y) => y.id.localeCompare(x.id),
    });
    expect(ranked.map((x) => x.row.id)).toEqual(["b", "a"]);
  });

  it("retourne un tableau vide pour une entree vide", () => {
    expect(rankByRelevance([], (r: Row) => r.s, { limit: 5 })).toEqual([]);
  });
});

/**
 * Garde anti-derive: les champs filtres en SQL == les champs lus par le scorer.
 *
 * Chaque outil find_* fait DEUX choses qui doivent rester synchronisees :
 *   1. il construit une clause WHERE `or(ilike(col, ...), ...)` qui decide
 *      QUELS enregistrements remontent de la base ;
 *   2. il reclasse ces enregistrements en memoire via un scorer pur
 *      (scoreContact / scoreTask / ...) qui decide LEQUEL est choisi en premier.
 *
 * Si un champ est filtre mais jamais score (queried-but-unscored), il ne pourra
 * jamais gagner le classement. S'il est score mais jamais filtre
 * (scored-but-unqueried), l'enregistrement ne remontera jamais pour etre score.
 * Les tests unitaires du scorer seul ne voient pas la requete, donc ils ne
 * peuvent pas attraper cette derive. Ce test relie les deux cotes :
 *   - cote SQL : on execute reellement l'outil (db stub) et on inspecte la
 *     condition WHERE capturee, en ne gardant que les colonnes operandes d'un
 *     ILIKE (le filtre de recherche), pas le garde-tenant `=` ni les filtres
 *     de statut/date ;
 *   - cote scorer : on appelle le scorer avec une ligne Proxy qui enregistre
 *     chaque champ lu.
 * Les deux ensembles doivent etre strictement egaux. Ajouter un champ de
 * recherche d'un seul cote fait echouer ce test bruyamment.
 */
describe("find_* — derive champ SQL <-> champ scorer", () => {
  // Map identite Column -> nom de propriete JS (firstName, clientCompany, ...),
  // partagee par les cinq tables interrogees par les outils find_*.
  const columnToKey = new Map<unknown, string>();
  for (const table of [
    contactsTable,
    tasksTable,
    projetsTable,
    calendarEventsTable,
    callsTable,
  ]) {
    for (const [key, col] of Object.entries(getTableColumns(table))) {
      columnToKey.set(col, key);
    }
  }

  /** Un noeud SQL est un comparateur ILIKE si l'un de ses fragments le dit. */
  function isIlikeNode(node: InstanceType<typeof SQL>): boolean {
    return node.queryChunks.some(
      (c) =>
        Array.isArray((c as { value?: unknown }).value) &&
        ((c as { value: unknown[] }).value as string[])
          .join("")
          .toLowerCase()
          .includes("ilike"),
    );
  }

  /**
   * Collecte les colonnes operandes d'un ILIKE dans la condition WHERE. On ne
   * retient une colonne que si son noeud SQL parent direct est un ILIKE, ce qui
   * exclut le garde-tenant `organisation_id = ?` et les filtres `status = ?` /
   * `start_date >= ?`.
   */
  function collectIlikeColumns(node: unknown, out: Set<unknown>): void {
    if (!(node instanceof SQL)) return;
    const ilikeHere = isIlikeNode(node);
    for (const chunk of node.queryChunks) {
      if (chunk instanceof Column) {
        if (ilikeHere) out.add(chunk);
      } else if (chunk instanceof SQL) {
        collectIlikeColumns(chunk, out);
      }
    }
  }

  async function sqlFilterFields(toolName: string): Promise<Set<string>> {
    const tool = getTool(toolName);
    if (!tool) throw new Error(`outil introuvable: ${toolName}`);
    dbStub.captured.where = undefined;
    await tool.execute({ query: "alpha 123456" }, { orgId: 1, userId: 1 });
    const cols = new Set<unknown>();
    collectIlikeColumns(dbStub.captured.where, cols);
    return new Set(
      [...cols].map((c) => {
        const key = columnToKey.get(c);
        if (!key) throw new Error("colonne ILIKE non mappee a une cle JS");
        return key;
      }),
    );
  }

  // Une requete avec du texte ET des chiffres pour que les branches telephone
  // des scorers lisent bien le champ phone/phoneNumber.
  const PROBE = prepareQuery("alpha 123456");

  function scorerReadFields(
    scorer: (row: never, q: typeof PROBE) => number,
  ): Set<string> {
    const read = new Set<string>();
    const row = new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === "string") read.add(prop);
          return undefined;
        },
      },
    );
    scorer(row as never, PROBE);
    return read;
  }

  const CASES = [
    { tool: "find_contact", scorer: scoreContact },
    { tool: "find_task", scorer: scoreTask },
    { tool: "find_project", scorer: scoreProject },
    { tool: "find_event", scorer: scoreEvent },
    { tool: "find_recent_call", scorer: scoreCall },
  ] as const;

  it.each(CASES)(
    "$tool: champs filtres SQL == champs lus par le scorer",
    async ({ tool, scorer }) => {
      const sql = await sqlFilterFields(tool);
      const scored = scorerReadFields(scorer);
      // Garde-fou: chaque outil filtre ET score au moins un champ.
      expect(sql.size).toBeGreaterThan(0);
      expect(scored.size).toBeGreaterThan(0);
      // Egalite stricte des deux ensembles -> aucun champ filtre-mais-non-score
      // ni score-mais-non-filtre.
      expect([...sql].sort()).toEqual([...scored].sort());
    },
  );
});
