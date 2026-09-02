import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Un bannissement doit valoir pour les trois instances, pas pour une.
 *
 * Mesure faite sur le service en production: `maxScale=3`, `concurrency=80`.
 * Le Guardian tenait pourtant sa liste dans une `Map` de module — une liste
 * par processus. Un attaquant banni sur une instance restait servi par les
 * deux autres, et surtout le compteur d'escalade (5 min, 15, 1 h, 6 h, 1 jour,
 * puis definitif au sixieme manquement) repartait de zero d'une instance a
 * l'autre: reparti sur trois, il pouvait accumuler quinze manquements sans
 * jamais devenir definitif.
 *
 * Deux exigences se contredisent et expliquent la forme du module. Le Guardian
 * s'execute sur CHAQUE requete, donc la lecture doit rester synchrone et en
 * memoire. Mais la verite doit etre commune, donc l'ecriture doit aller en
 * base. La resolution: ecriture traversante, lecture locale, resynchronisation
 * paresseuse entre deux requetes.
 *
 * Et une contrainte de survie: ce module ne doit JAMAIS casser le Guardian. Le
 * schema de production se pousse a la main dans ce depot; si la table manque,
 * un pare-feu qui tombe serait bien pire que le defaut qu'on corrige.
 */

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

const state = vi.hoisted(() => ({
  rows: [] as any[],
  selectError: null as Error | null,
  insertError: null as Error | null,
  inserts: [] as any[],
  conflictSets: [] as any[],
}));

vi.mock("@workspace/db", () => {
  const selectChain = () => {
    const self: any = {
      from: () => self,
      where: () => (state.selectError ? Promise.reject(state.selectError) : Promise.resolve(state.rows)),
    };
    return self;
  };
  return {
    db: {
      select: () => selectChain(),
      insert: () => ({
        values: (v: any) => ({
          onConflictDoUpdate: (cfg: any) => {
            if (state.insertError) return Promise.reject(state.insertError);
            state.inserts.push(v);
            state.conflictSets.push(cfg.set);
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve({ rowCount: 3 }) }),
    },
    ipBansTable: { ip: "ip", count: "count", until: "until", permanent: "permanent", reasons: "reasons" },
  };
});

const warn = vi.fn();
vi.mock("../lib/logger", () => ({
  logger: { warn: (...a: any[]) => warn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const store = await import("../services/ip-ban-store");

beforeEach(() => {
  state.rows = [];
  state.selectError = null;
  state.insertError = null;
  state.inserts = [];
  state.conflictSets = [];
  warn.mockReset();
  store.resetIpBanStoreState();
});

describe("ecriture partagee", () => {
  it("enregistre un bannissement temporaire avec sa date de fin", async () => {
    const until = Date.now() + 900_000;
    await store.persistBan("203.0.113.9", { count: 2, until, permanent: false, reasons: ["scan"] });

    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].ip).toBe("203.0.113.9");
    expect(state.inserts[0].until).toEqual(new Date(until));
    expect(state.inserts[0].permanent).toBe(false);
  });

  it("traduit un bannissement definitif en `until: null`", async () => {
    // Le Guardian represente « sans fin » par Infinity, qui n'a pas
    // d'equivalent en timestamp: la base porte le drapeau, pas une date.
    await store.persistBan("203.0.113.9", { count: 6, until: Infinity, permanent: true, reasons: [] });

    expect(state.inserts[0].until).toBeNull();
    expect(state.inserts[0].permanent).toBe(true);
  });

  it("incremente le compteur EN BASE et non depuis la memoire locale", async () => {
    // Tout l'objet de l'exercice: trois instances qui bannissent deux fois
    // chacune doivent totaliser six manquements — donc un bannissement
    // definitif — et non trois compteurs a deux.
    await store.persistBan("203.0.113.9", { count: 2, until: Date.now() + 1000, permanent: false, reasons: [] });

    const set = state.conflictSets[0];
    expect(String(set.count)).not.toBe("2");
    expect(JSON.stringify(set.count)).toMatch(/count/);
  });
});

describe("lecture partagee", () => {
  it("rend les bannissements actifs sous la forme attendue par le Guardian", async () => {
    const until = new Date(Date.now() + 600_000);
    state.rows = [
      { ip: "1.2.3.4", count: 3, until, permanent: false, reasons: ["bot"] },
      { ip: "5.6.7.8", count: 9, until: null, permanent: true, reasons: [] },
    ];

    const bans = await store.loadActiveBans();
    expect(bans.get("1.2.3.4")).toEqual({ count: 3, until: until.getTime(), permanent: false, reasons: ["bot"] });
    // Definitif: Infinity, la forme que le Guardian compare a Date.now().
    expect(bans.get("5.6.7.8")!.until).toBe(Infinity);
  });
});

describe("survie quand la table manque", () => {
  it("ne jette pas et laisse le Guardian vivant", async () => {
    state.insertError = new Error('relation "ip_bans" does not exist');
    await expect(
      store.persistBan("1.2.3.4", { count: 1, until: Date.now(), permanent: false, reasons: [] }),
    ).resolves.toBeUndefined();
  });

  it("dit une fois quoi faire, puis se tait", async () => {
    // Le Guardian tourne sur chaque requete: un avertissement par requete
    // noierait les journaux le jour ou ils servent.
    state.selectError = new Error('relation "ip_bans" does not exist');
    await store.loadActiveBans();
    await store.loadActiveBans();
    await store.loadActiveBans();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toContain("gcp-schema-push");
  });

  it("cesse d'interroger la base apres un echec, au lieu de reessayer sans fin", async () => {
    state.selectError = new Error("base injoignable");
    await store.loadActiveBans();

    state.selectError = null;
    state.rows = [{ ip: "1.2.3.4", count: 1, until: new Date(Date.now() + 1000), permanent: false, reasons: [] }];
    // Toujours en periode de repli: on ne retente pas avant dix minutes.
    await expect(store.loadActiveBans()).resolves.toEqual(new Map());
  });
});

describe("resynchronisation paresseuse", () => {
  it("ne bloque pas la requete en cours", () => {
    state.rows = [];
    const apply = vi.fn();
    // Retour synchrone: la requete continue immediatement, la mise a jour
    // profitera a la suivante.
    expect(store.refreshIfStale(apply)).toBeUndefined();
  });

  it("ne relit pas la base a chaque requete", async () => {
    let reads = 0;
    state.rows = [];
    const apply = () => { reads++; };
    store.refreshIfStale(apply);
    await new Promise((r) => setTimeout(r, 5));
    const first = reads;
    store.refreshIfStale(apply);
    store.refreshIfStale(apply);
    await new Promise((r) => setTimeout(r, 5));
    // Une lecture toutes les trente secondes suffit: le Guardian sert des
    // milliers de requetes dans cet intervalle.
    expect(reads).toBe(first);
  });
});
