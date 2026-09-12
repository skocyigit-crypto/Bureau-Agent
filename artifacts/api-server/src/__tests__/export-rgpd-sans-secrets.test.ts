process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

/**
 * L'export RGPD est le seul fichier que l'application remet a l'exterieur.
 *
 * `data-protection-flow-static` verrouille deja la SOURCE: les colonnes y sont
 * enumerees une par une, jamais `select()` complet, parce que les tables
 * traversees contiennent une empreinte de mot de passe, un secret MFA, des
 * jetons OAuth et un jeton de notification d'appareil.
 *
 * Mais une regle lue dans le code n'est pas une sortie mesuree. Entre les deux
 * il y a tout ce qu'un `select()` explicite ne controle pas: une jointure qui
 * ramene une ligne entiere, un `...reste` dans une transformation, un champ
 * ajoute plus tard a une table deja exportee. Le jour ou l'un de ces chemins
 * s'ouvre, la source paraitra toujours correcte.
 *
 * Ce test regarde donc le FICHIER: il demande l'export d'un utilisateur qui
 * possede reellement un mot de passe et un secret MFA en base, et verifie
 * qu'aucun des deux n'en ressort.
 *
 * Un export qui fuite n'est pas une erreur d'affichage: c'est une violation de
 * donnees, remise de la main a la main a la personne qui l'a demandee.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

import { db, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

/** Noms de champs qui ne doivent jamais apparaitre dans le fichier remis. */
const JAMAIS_EXPORTES = [
  "passwordHash", "password_hash",
  "mfaSecret", "mfa_secret",
  "resetToken", "reset_token",
  "accessToken", "access_token",
  "refreshToken", "refresh_token",
  "clientSecret", "client_secret",
  "pushToken", "push_token",
  "apiKey", "api_key",
];

let orgId = 0;

afterAll(async () => {
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

describe("l'export RGPD remis a la personne", () => {
  it("ne contient aucun secret, et n'est pas vide", async () => {
    const [org] = await db
      .insert(organisationsTable)
      .values({
        name: "Verification export RGPD",
        slug: `export-rgpd-${Date.now()}`,
        email: `export-rgpd-${Date.now()}@exemple.test`,
        maxUsers: 3,
        actif: true,
      })
      .returning({ id: organisationsTable.id });
    orgId = org.id;

    // L'utilisateur possede VRAIMENT les secrets: sans cela, leur absence dans
    // l'export ne prouverait rien.
    const [user] = await db
      .insert(usersTable)
      .values({
        organisationId: orgId,
        email: `personne-${Date.now()}@exemple.test`,
        passwordHash: "$2a$10$empreinte.qui.ne.doit.jamais.sortir.dans.un.export",
        mfaSecret: "SECRETMFAQUINEDOITPASSORTIR",
        nom: "Durand",
        prenom: "Marie",
        role: "agent",
        actif: true,
      })
      .returning({ id: usersTable.id, email: usersTable.email });

    const token = mintApiToken({
      userId: user.id,
      userRole: "agent",
      organisationId: orgId,
      userEmail: user.email,
      prenom: "Marie",
      nom: "Durand",
    });

    const reponse = await request(app)
      .get("/api/data-protection/my-data")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "http://localhost");

    expect(reponse.status).toBe(200);

    const fichier = JSON.stringify(reponse.body);

    // Garde-fou: un export vide ne contiendrait evidemment aucun secret. On
    // verifie d'abord qu'il y a bien quelque chose a inspecter.
    expect(fichier.length, "export vide: l'absence de secret ne prouverait rien").toBeGreaterThan(200);

    const fuites = JAMAIS_EXPORTES.filter((champ) =>
      new RegExp(`"${champ}"\\s*:`, "i").test(fichier),
    );
    expect(
      fuites,
      "ces champs sont remis a la personne dans son export: c'est une violation de donnees",
    ).toEqual([]);

    // Les VALEURS aussi, pas seulement les noms de champs: un secret renomme
    // resterait un secret. C'est le controle que le test statique ne peut pas
    // faire, puisqu'il ne voit jamais de donnees.
    expect(fichier, "l'empreinte du mot de passe ressort sous un autre nom").not.toContain("$2a$10$empreinte");
    expect(fichier, "le secret MFA ressort sous un autre nom").not.toContain("SECRETMFAQUINEDOITPASSORTIR");
  });
});
