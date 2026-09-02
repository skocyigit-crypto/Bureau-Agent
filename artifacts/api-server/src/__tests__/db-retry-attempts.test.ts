import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { withDbRetry } from "../lib/db-retry";

/**
 * Combien de connexions mortes une tache de fond peut traverser.
 *
 * Sur Cloud Run, une instance de fond est gelee entre deux requetes: ses
 * minuteurs ne tournent plus, donc le pool ne recycle rien, pendant que le
 * serveur ferme les connexions oisives. Au reveil, le pool detient plusieurs
 * connexions mortes, et `node-postgres` n'en ecarte une qu'au moment ou elle
 * echoue: CHAQUE tentative en elimine une seule.
 *
 * Avec trois essais et un pool de huit, une tache pouvait donc tomber trois
 * fois de suite sur une connexion morte et abandonner. Mesure sur six heures:
 * des echecs definitifs sur sept taches de fond distinctes, et la moitie des
 * cycles d'insights perdue — pas sur une erreur SQL, sur l'etablissement de la
 * connexion.
 *
 * Ce que ce test protege: le nombre d'essais, et surtout le fait qu'il ne
 * s'applique QU'AUX erreurs de connexion. Reessayer une erreur SQL serait bien
 * pire que le probleme d'origine.
 */

function connectionError(message: string): Error {
  return new Error(message);
}

describe("reprise sur connexion morte", () => {
  it("traverse plusieurs connexions mortes avant d'abandonner", async () => {
    // Quatre connexions mortes d'affilee: l'ancien plafond de trois essais
    // laissait tomber la tache ici.
    let calls = 0;
    const result = await withDbRetry(async () => {
      calls += 1;
      if (calls <= 4) throw connectionError("Connection terminated unexpectedly");
      return "ok";
    }, { baseDelayMs: 1 });

    expect(result).toBe("ok");
    expect(calls).toBe(5);
  });

  it("finit par abandonner: une base morte reste une panne", async () => {
    // La reprise ne doit pas masquer indefiniment une base indisponible.
    let calls = 0;
    await expect(
      withDbRetry(async () => {
        calls += 1;
        throw connectionError("timeout exceeded when trying to connect");
      }, { baseDelayMs: 1 }),
    ).rejects.toThrow(/timeout exceeded/);

    expect(calls).toBe(5);
  });

  it("ne reessaie JAMAIS une erreur SQL", async () => {
    // Rejouer une contrainte violee ou une syntaxe fautive ne corrige rien et
    // peut dupliquer un effet. Seule la connexion est reprise.
    let calls = 0;
    await expect(
      withDbRetry(async () => {
        calls += 1;
        throw new Error('duplicate key value violates unique constraint "x"');
      }, { baseDelayMs: 1 }),
    ).rejects.toThrow(/duplicate key/);

    expect(calls, "une erreur SQL a ete rejouee").toBe(1);
  });

  it("reste reglable la ou l'attente n'est pas acceptable", async () => {
    // Un appelant qui fait patienter un utilisateur peut resserrer.
    let calls = 0;
    await expect(
      withDbRetry(async () => {
        calls += 1;
        throw connectionError("Connection terminated unexpectedly");
      }, { attempts: 2, baseDelayMs: 1 }),
    ).rejects.toThrow();

    expect(calls).toBe(2);
  });
});
