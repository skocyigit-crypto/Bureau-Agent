/**
 * Une connexion qui tombe pendant qu'un client est PRETE ne fait pas tomber
 * le processus.
 *
 * pg-pool retire son ecouteur d'erreur quand il prete un client : un verrou
 * consultatif tenu pendant un cycle, ou une transaction coupee par
 * idle_in_transaction_session_timeout, emettait 'error' sans ecouteur — une
 * exception non rattrapee, l'instance arretee. Signale par les sessions
 * Kaverd et BatiFlow (29/09), constate chez elles en production.
 */
import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

describe("clients pretes par le pool", () => {
  it("un client prete garde son propre ecouteur d'erreur", async () => {
    const c = await pool.connect();
    try {
      expect(c.listenerCount("error")).toBeGreaterThan(0);
    } finally {
      c.release();
    }
  });

  it("une erreur de connexion sur un client prete ne leve pas d'exception", async () => {
    const c = await pool.connect();
    try {
      expect(() => c.emit("error", new Error("[test] connexion coupee"))).not.toThrow();
    } finally {
      c.release(true);
    }
  });

  it("apres retour au pool, le client reste surveille (ecouteur du pool et le sien)", async () => {
    const c = await pool.connect();
    c.release();
    expect(c.listenerCount("error")).toBeGreaterThanOrEqual(1);
  });
});
