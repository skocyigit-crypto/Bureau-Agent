/**
 * Stripe : un double clic (ou un rejeu reseau) ne cree pas deux clients ni
 * deux sessions de paiement pour le meme achat.
 *
 * Mesure du 28/09 : aucun appel Stripe ne portait de cle d'idempotence. Deux
 * requetes simultanees de « Passer a l'offre » creaient deux clients Stripe
 * pour la meme organisation (le second orphelin) et deux sessions ouvertes.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleIdempotence } from "../routes/stripe";

const SRC = readFileSync(join(import.meta.dirname, "..", "routes", "stripe.ts"), "utf8");

describe("cle d'idempotence Stripe", () => {
  it("memes usage, organisation et donnees : meme cle (le rejeu obtient le meme objet)", () => {
    const d = { email: "a@b.fr", name: "Duval", metadata: { organisationId: "7" } };
    expect(cleIdempotence("client", 7, d)).toBe(cleIdempotence("client", 7, { ...d }));
  });

  it("une autre organisation, un autre usage ou d'autres donnees : une autre cle", () => {
    const d = { email: "a@b.fr" };
    const base = cleIdempotence("client", 7, d);
    expect(cleIdempotence("client", 8, d)).not.toBe(base);
    expect(cleIdempotence("checkout", 7, d)).not.toBe(base);
    expect(cleIdempotence("client", 7, { email: "c@d.fr" })).not.toBe(base);
  });

  it("la cle respecte les limites de Stripe (255 caracteres, sans donnee personnelle en clair)", () => {
    const k = cleIdempotence("client", 123456, { email: "personne.tres.longue@exemple-de-domaine.fr".repeat(20) });
    expect(k.length).toBeLessThanOrEqual(255);
    expect(k).toMatch(/^[a-z0-9-]+$/);
    expect(k).not.toMatch(/personne/);
  });

  it("la creation du client et celle de la session passent une cle", () => {
    const client = SRC.slice(SRC.indexOf("stripe.customers.create("), SRC.indexOf("customerId = customer.id"));
    expect(client).toMatch(/idempotencyKey: cleIdempotence\("client", orgId/);
    const session = SRC.slice(SRC.indexOf("stripe.checkout.sessions.create("), SRC.indexOf("res.json({ url: session.url"));
    expect(session).toMatch(/idempotencyKey: cleIdempotence\("checkout", orgId/);
  });
});
