process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterEach, describe, expect, it, vi } from "vitest";
import { listenForNotifications, publishNotification } from "@workspace/db";
import { broadcaster, type SyncEvent } from "../services/broadcaster";

/**
 * Le diffuseur vit dans la memoire du processus et le service tourne avec
 * `maxScale=3`. L'affinite de session colle un navigateur a une instance, mais
 * l'evenement nait la ou arrive le travail: un webhook, un cron, ou l'action
 * d'un collegue servie ailleurs. Ces tests fixent les deux moities de la
 * correction — l'evenement distant DOIT atteindre les navigateurs locaux, et
 * il ne doit SURTOUT PAS rejouer les ecouteurs serveur, sinon la meme
 * notification push partirait une fois par instance.
 */

/** Un faux `Response` SSE: on ne garde que ce que le diffuseur ecrit. */
function fakeClient() {
  const written: string[] = [];
  return { written, res: { write: (chunk: string) => { written.push(chunk); return true; } } };
}

const event: SyncEvent = { type: "task", action: "created", resourceId: 42, ts: 123 };

afterEach(() => {
  broadcaster.setRelay(null);
  vi.restoreAllMocks();
});

describe("evenement venu d'une autre instance", () => {
  it("atteint les navigateurs connectes ici", () => {
    const client = fakeClient();
    const unsubscribe = broadcaster.subscribe(7, client.res as never);
    try {
      broadcaster.dispatchRemote(7, event);

      expect(client.written).toHaveLength(1);
      expect(JSON.parse(client.written[0]!.replace(/^data: /, ""))).toMatchObject({
        type: "task", action: "created", resourceId: 42,
      });
    } finally {
      unsubscribe();
    }
  });

  it("ne rejoue PAS les ecouteurs serveur — sinon un push par instance", () => {
    const listener = vi.fn();
    const off = broadcaster.onEvent(listener);
    try {
      broadcaster.dispatchRemote(7, event);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it("ne touche pas les navigateurs d'une autre organisation", () => {
    const mine = fakeClient();
    const neighbour = fakeClient();
    const offMine = broadcaster.subscribe(7, mine.res as never);
    const offNeighbour = broadcaster.subscribe(8, neighbour.res as never);
    try {
      broadcaster.dispatchRemote(7, event);
      expect(mine.written).toHaveLength(1);
      expect(neighbour.written).toHaveLength(0);
    } finally {
      offMine();
      offNeighbour();
    }
  });
});

describe("emission locale", () => {
  it("passe le relai ET les ecouteurs serveur, une seule fois chacun", () => {
    const relay = vi.fn();
    const listener = vi.fn();
    broadcaster.setRelay(relay);
    const off = broadcaster.onEvent(listener);
    try {
      broadcaster.broadcast(7, { type: "task", action: "created" });

      expect(relay).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  it("survit a un relai en panne: la base peut tomber, l'action non", () => {
    const listener = vi.fn();
    broadcaster.setRelay(() => { throw new Error("bus indisponible"); });
    const off = broadcaster.onEvent(listener);
    try {
      expect(() => broadcaster.broadcast(7, { type: "task", action: "created" })).not.toThrow();
      // Le fan-out local doit avoir eu lieu malgre l'echec du relai.
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });
});

describe("transport Postgres", () => {
  it("porte reellement une charge utile d'une connexion a l'autre", async () => {
    const channel = `sync_events_test_${Date.now()}`;
    const received: string[] = [];
    const sub = listenForNotifications(channel, (payload) => { received.push(payload); });

    try {
      // `LISTEN` doit etre effectif avant la publication: sans attente, le
      // test mesurerait la vitesse de connexion, pas le transport.
      const deadline = Date.now() + 10_000;
      let delivered = false;
      while (Date.now() < deadline && !delivered) {
        await publishNotification(channel, JSON.stringify({ hello: "monde" }));
        await new Promise((r) => setTimeout(r, 200));
        delivered = received.length > 0;
      }

      expect(delivered, "aucune notification recue via Postgres").toBe(true);
      expect(JSON.parse(received[0]!)).toEqual({ hello: "monde" });
    } finally {
      await sub.stop();
    }
  }, 20_000);

  it("refuse une charge utile trop grosse plutot que de la tronquer", async () => {
    // `pg_notify` plafonne a 8000 octets; au-dela Postgres jette. Mieux vaut
    // un evenement non relaye qu'une erreur dans le chemin d'emission.
    const onError = vi.fn();
    const ok = await publishNotification("sync_events_test_big", "x".repeat(9000), onError);

    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalled();
  });
});
