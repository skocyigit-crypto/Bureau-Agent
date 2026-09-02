import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Un verrou consultatif appartient a la CONNEXION qui l'a pris.
 *
 * C'est la subtilite que la version precedente de ce module manquait, et elle
 * est invisible a la lecture: le code prenait le verrou avec `db.execute(...)`
 * puis le liberait avec un second `db.execute(...)`. Or `db` est un pool de
 * huit connexions, et chaque `execute` en emprunte une. Quand les deux appels
 * partaient sur deux connexions differentes, Postgres refusait la liberation
 * — personne ne lit ce retour — et le verrou restait detenu par la premiere,
 * jusqu'a la fermeture de celle-ci pour inactivite.
 *
 * Pendant ce temps, chaque cycle suivant du cron protege echouait a prendre le
 * verrou et se sautait lui-meme, en silence. C'est le mode de panne que cette
 * application a deja vecu plusieurs fois — rien ne casse, plus rien ne se
 * produit — et il touchait ici les relances de facture, les sauvegardes par
 * locataire, la secretaire autonome et la facturation.
 *
 * Le defaut etait non deterministe: un pool rend souvent la connexion la plus
 * recemment liberee, donc la meme, et tout marchait. Un test qui se contente
 * d'observer « ca a marche » ne l'aurait jamais vu. Celui-ci verifie donc la
 * seule chose qui compte: prise et liberation sur LE MEME client.
 */

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

interface FakeClient {
  id: number;
  queries: Array<{ text: string; values: any[] }>;
  released: boolean;
}

const state = vi.hoisted(() => ({
  clients: [] as any[],
  nextId: 1,
  acquire: true as boolean,
  connectError: null as Error | null,
}));

vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => {
      if (state.connectError) throw state.connectError;
      const client: FakeClient & { query: any; release: any } = {
        id: state.nextId++,
        queries: [],
        released: false,
        query: async (text: string, values: any[]) => {
          client.queries.push({ text, values });
          if (text.includes("pg_try_advisory_lock")) {
            return { rows: [{ acquired: state.acquire }] };
          }
          return { rows: [{ pg_advisory_unlock: true }] };
        },
        release: () => { client.released = true; },
      };
      state.clients.push(client);
      return client;
    },
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { tryWithLock, withCronLock, CRON_LOCK_NAMESPACE } = await import("../lib/cron-lock");

beforeEach(() => {
  state.clients = [];
  state.nextId = 1;
  state.acquire = true;
  state.connectError = null;
});

describe("tryWithLock", () => {
  it("prend et libere le verrou sur LA MEME connexion", async () => {
    await tryWithLock(4301, 7, async () => {});

    // Une seule connexion empruntee: c'est elle qui detient le verrou, donc
    // c'est elle qui doit le rendre.
    expect(state.clients).toHaveLength(1);
    const [client] = state.clients;
    expect(client.queries).toHaveLength(2);
    expect(client.queries[0].text).toContain("pg_try_advisory_lock");
    expect(client.queries[1].text).toContain("pg_advisory_unlock");
    expect(client.queries[0].values).toEqual([4301, 7]);
    expect(client.queries[1].values).toEqual([4301, 7]);
  });

  it("rend la connexion au pool, meme quand le travail echoue", async () => {
    await expect(
      tryWithLock(4301, 7, async () => { throw new Error("cycle casse"); }),
    ).rejects.toThrow("cycle casse");

    const [client] = state.clients;
    // Une connexion non rendue sur huit, a chaque echec, finirait par epuiser
    // le pool — et l'application entiere avec.
    expect(client.released).toBe(true);
    expect(client.queries[1].text).toContain("pg_advisory_unlock");
  });

  it("n'execute pas le travail quand le verrou est deja pris ailleurs", async () => {
    state.acquire = false;
    const work = vi.fn();
    const got = await tryWithLock(4301, 7, async () => { work(); });

    expect(got).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it("ne tente pas de liberer un verrou qu'il n'a pas obtenu", async () => {
    state.acquire = false;
    await tryWithLock(4301, 7, async () => {});

    const [client] = state.clients;
    expect(client.queries).toHaveLength(1);
    expect(client.released).toBe(true);
  });

  it("dit s'il a obtenu le verrou: une route HTTP doit pouvoir repondre", async () => {
    await expect(tryWithLock(4301, 7, async () => {})).resolves.toBe(true);
    state.acquire = false;
    await expect(tryWithLock(4301, 7, async () => {})).resolves.toBe(false);
  });
});

describe("withCronLock", () => {
  it("garde son contrat: aucun retour, un cycle saute ne previent personne", async () => {
    state.acquire = false;
    const work = vi.fn();
    await expect(withCronLock(4302, 3, async () => { work(); })).resolves.toBeUndefined();
    expect(work).not.toHaveBeenCalled();
  });
});

describe("espaces de noms", () => {
  it("donne un espace distinct a chaque cron", () => {
    // orgId et userId sont de petits entiers sequentiels: sans espace dedie,
    // « daily-digest pour userId=1 » bloquerait « invoice-reminder pour
    // orgId=1 », deux travaux sans rapport.
    const values = Object.values(CRON_LOCK_NAMESPACE);
    expect(new Set(values).size).toBe(values.length);
    // 4242 est pris par call-processor, qui utilise le meme mecanisme.
    expect(values).not.toContain(4242);
  });
});
