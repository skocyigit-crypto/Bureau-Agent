/**
 * Tests de régression du moteur de webhooks sortants (helpers purs critiques).
 *
 * Ces fonctions sont au cœur de la SÉCURITÉ et de la CORRECTION des livraisons :
 *   1. signPayload : signature HMAC-SHA256 sur `${timestampSec}.${body}` —
 *      un receveur la recalcule pour authentifier l'appel et rejeter les rejeux.
 *      Toute régression silencieuse casserait toutes les vérifications côté
 *      clients (ou pire, validerait des charges falsifiées).
 *   2. backoffSeconds : backoff exponentiel BORNÉ (ne doit jamais dépasser le
 *      plafond, ni revenir sous la base).
 *   3. eventName : nom d'événement externe stable, en filtrant les "ping".
 */
import { beforeAll, describe, expect, it } from "vitest";
import crypto from "crypto";

// Le module importe @workspace/db (pool paresseux) ; on fixe une clé de
// chiffrement déterministe avant import par cohérence avec les autres suites.
beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY ??= "test-data-encryption-key-0123456789";
});

const { signPayload, backoffSeconds, eventName } = await import("../services/webhook-service");

describe("webhook — signPayload (HMAC-SHA256)", () => {
  it("déterministe : mêmes entrées -> même signature hex", () => {
    const a = signPayload("secret", 1700000000, '{"x":1}');
    const b = signPayload("secret", 1700000000, '{"x":1}');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("correspond à l'implémentation HMAC de référence sur `${ts}.${body}`", () => {
    const ts = 1700000123;
    const body = '{"event":"contact.created"}';
    const expected = crypto
      .createHmac("sha256", "topsecret")
      .update(`${ts}.${body}`)
      .digest("hex");
    expect(signPayload("topsecret", ts, body)).toBe(expected);
  });

  it("le timestamp fait partie de la signature (anti-rejeu)", () => {
    const body = '{"x":1}';
    expect(signPayload("secret", 1700000000, body)).not.toBe(
      signPayload("secret", 1700000001, body),
    );
  });

  it("un secret différent produit une signature différente", () => {
    expect(signPayload("secretA", 1, "b")).not.toBe(signPayload("secretB", 1, "b"));
  });
});

describe("webhook — backoffSeconds (exponentiel borné)", () => {
  it("croît exponentiellement depuis la base (60s)", () => {
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(120);
    expect(backoffSeconds(3)).toBe(240);
    expect(backoffSeconds(4)).toBe(480);
  });

  it("ne dépasse jamais le plafond de 6h", () => {
    const cap = 6 * 60 * 60;
    expect(backoffSeconds(50)).toBe(cap);
    expect(backoffSeconds(1000)).toBe(cap);
  });

  it("reste >= base même pour un n° de tentative dégénéré", () => {
    expect(backoffSeconds(0)).toBe(60);
    expect(backoffSeconds(-5)).toBe(60);
  });
});

describe("webhook — eventName", () => {
  it("compose type.action", () => {
    expect(eventName({ type: "contact", action: "created" })).toBe("contact.created");
    expect(eventName({ type: "task", action: "updated" })).toBe("task.updated");
  });

  it("ignore les événements ping (type ou action)", () => {
    expect(eventName({ type: "ping", action: "ping" })).toBeNull();
    expect(eventName({ type: "contact", action: "ping" })).toBeNull();
  });
});
