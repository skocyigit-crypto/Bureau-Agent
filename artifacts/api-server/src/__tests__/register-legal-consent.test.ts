process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
// La verification d'origine (CSRF) refuse tout appel sans origine connue: sans
// cette ligne le test mesurerait le pare-feu, pas la regle qu'il vise.
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost";

import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, like } from "drizzle-orm";
import { db, legalAgreementsTable, organisationsTable } from "@workspace/db";

import app from "../app";

/**
 * Les CGV posent que « toute commande vaut acceptation sans reserve des
 * presentes ». Encore faut-il que l'acheteur ait pu les lire: l'article 1119
 * du Code civil ecarte des conditions generales qui n'ont pas ete portees a sa
 * connaissance. L'inscription n'en disait pas un mot — la clause etait
 * inopposable, et c'est le vendeur qui en portait le risque.
 *
 * Ces tests fixent les deux moities: on ne peut pas creer de compte sans
 * accepter, et l'acceptation laisse une trace exploitable (qui, quand, quelle
 * version). Une acceptation qu'on ne peut pas prouver ne vaut pas mieux que
 * pas d'acceptation.
 */

const stamp = Date.now();
const created: number[] = [];

afterAll(async () => {
  // Nettoyage « au mieux », comme les autres tests de ce dossier: une ligne
  // residuelle ne doit pas faire echouer la suite. Les identifiants portent
  // l'horodatage du run, donc rien ne se telescope d'une execution a l'autre.
  try {
    for (const id of created) {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    }
  } catch {
    // Une contrainte residuelle (abonnement, facture d'inscription) peut
    // retenir la ligne. Ce n'est pas ce que ce test mesure.
  }
});

function payload(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    orgName: `Org consent ${suffix}`,
    firstName: "Jean",
    lastName: "Dupont",
    email: `consent-${suffix}@example.test`,
    password: "Kestrel7Vagon",
    ...extra,
  };
}

describe("acceptation des conditions a l'inscription", () => {
  it("refuse la creation quand la case n'est pas cochee", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .set("Origin", "http://localhost")
      .send(payload(`refus-${stamp}`));

    expect(res.status).toBe(400);
    expect(res.body.champ).toBe("acceptedTerms");
  });

  it("refuse aussi une valeur qui n'est pas un vrai consentement", async () => {
    // `"true"`, `1`, `"on"`: un formulaire mal cable enverrait cela, et
    // l'accepter reviendrait a inventer un consentement.
    for (const valeur of ["true", 1, "on", null]) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("Origin", "http://localhost")
        .send(payload(`type-${stamp}`, { acceptedTerms: valeur }));
      expect(res.status, `valeur ${JSON.stringify(valeur)}`).toBe(400);
    }
  });

  it("laisse une trace de l'acceptation: qui, quand, quelle version", async () => {
    const email = `consent-ok-${stamp}@example.test`;
    const res = await request(app)
      .post("/api/auth/register")
      .set("Origin", "http://localhost")
      .send(payload(`ok-${stamp}`, { email, acceptedTerms: true }));

    expect(res.status).toBe(201);
    const orgId = res.body.organisation?.id;
    expect(orgId).toBeTruthy();
    created.push(orgId);

    const accords = await db.select()
      .from(legalAgreementsTable)
      .where(eq(legalAgreementsTable.organisationId, orgId));

    // Les deux documents que l'ecran fait accepter, pas seulement l'un d'eux.
    const types = accords.map((a) => a.documentType).sort();
    expect(types).toEqual(["cgu", "cgv"]);

    for (const accord of accords) {
      expect(accord.acceptedAt, "sans date, l'acceptation n'est pas datable").toBeTruthy();
      expect(accord.acceptedBy).toBe(email.toLowerCase());
      // La version compte: accepter « les CGV » sans dire lesquelles ne prouve
      // rien le jour ou elles changent.
      expect(accord.documentVersion).toBeTruthy();
    }
  });

  it("n'ecrit aucune trace quand l'inscription echoue", async () => {
    // Une preuve de consentement pour un compte qui n'existe pas serait pire
    // qu'aucune preuve: elle ferait croire a un engagement.
    await request(app)
      .post("/api/auth/register")
      .set("Origin", "http://localhost")
      .send(payload(`echec-${stamp}`, { acceptedTerms: true, email: "pas-un-email" }));

    const orphelins = await db.select({ id: legalAgreementsTable.id })
      .from(legalAgreementsTable)
      .where(and(
        eq(legalAgreementsTable.acceptedBy, "pas-un-email"),
        like(legalAgreementsTable.notes, "%inscription%"),
      ));
    expect(orphelins).toEqual([]);
  });
});
