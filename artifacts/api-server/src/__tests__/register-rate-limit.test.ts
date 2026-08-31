/**
 * Une saisie refusee ne doit pas consommer le quota d'inscription.
 *
 * L'inscription est limitee a cinq tentatives par heure. Le limiteur comptait
 * TOUTES les requetes, y compris celles rejetees a la validation. Trois
 * erreurs de formulaire ordinaires — nom manquant, mot de passe trop court,
 * adresse mal tapee — suffisaient donc a bloquer la creation d'un compte
 * pendant une heure, avec pour seule reponse « Reessayez dans une heure » au
 * lieu du champ a corriger.
 *
 * Sur un formulaire d'inscription, cela ne protege de rien: une saisie
 * invalide ne cree rien et n'apprend rien a un attaquant. Ce qu'il faut
 * plafonner, c'est le 409 « cet email existe deja », la seule reponse qui
 * permettrait d'enumerer les comptes — et il continue de compter.
 *
 * Test A BASE DE DONNEES: il importe l'application complete. Aucune ecriture:
 * toutes les requetes sont rejetees avant d'atteindre la base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
// La verification CSRF exige une origine, et compare son hote a l'en-tete
// Host. Supertest ecoute sur `127.0.0.1:<port ephemere>`, qui ne peut pas
// correspondre a une origine ecrite d'avance: on declare donc explicitement
// celle du test comme autorisee. Le middleware relit cette variable a chaque
// requete, la poser ici suffit.
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost";

import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

/** Adresse IP unique par test: le quota est compte par client. */
function post(ip: string, body: Record<string, unknown>) {
  return request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost")
    .set("X-Forwarded-For", ip)
    .send(body);
}

describe("quota d'inscription", () => {
  it("ne compte pas les saisies invalides", async () => {
    const ip = `10.10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

    // Huit tentatives ratees d'affilee, soit bien plus que le plafond de cinq.
    for (let i = 0; i < 8; i++) {
      const res = await post(ip, { orgName: "" });
      expect(
        res.status,
        `tentative ${i + 1}: la personne est bloquee apres une simple erreur de saisie`,
      ).toBe(400);
    }

    // Et la neuvieme reste une erreur de saisie, pas un blocage.
    const last = await post(ip, { orgName: "A" });
    expect(last.status).toBe(400);
  });

  it("repond ce qu'il faut corriger, pas seulement un refus", async () => {
    const ip = `10.11.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

    const noOrg = await post(ip, {});
    expect(noOrg.body.error).toMatch(/organisation/i);

    const noName = await post(ip, { orgName: "Test SARL" });
    expect(noName.body.error).toMatch(/nom/i);

    const badEmail = await post(ip, { orgName: "Test SARL", firstName: "A", lastName: "B", email: "pasunemail" });
    expect(badEmail.body.error).toMatch(/email/i);
  });

  it("plafonne toujours ce qui n'est pas une erreur de saisie", async () => {
    // Le limiteur reste actif: seul un 400 est exempte. La configuration est
    // verifiee ici parce qu'un test qui epuiserait reellement le quota
    // dependrait de l'horloge et deviendrait intermittent.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes/register.ts", import.meta.url), "utf8"),
    );
    expect(src).toMatch(/skipFailedRequests: true/);
    expect(src).toMatch(/requestWasSuccessful: \(_req, res\) => res\.statusCode !== 400/);
    expect(src).toMatch(/max: 5/);
  });
});
