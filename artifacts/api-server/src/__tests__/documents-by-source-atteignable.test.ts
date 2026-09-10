/**
 * `GET /documents/by-source` doit etre ATTEIGNABLE.
 *
 * Express essaie les routes dans l'ordre de declaration. `/documents/:id` est
 * declaree en premier dans `routes/documents.ts`; son handler faisait
 * `parseInt("by-source")` -> NaN -> `res.status(400)` et s'arretait la, sans
 * `next()`. La route litterale, declaree mille lignes plus bas, n'etait donc
 * JAMAIS atteinte — et rien ne le signalait au demarrage.
 *
 * Ce n'etait pas theorique: `artifacts/mobile/app/documents.tsx` construit tout
 * son ecran sur cet appel (`listDocumentsBySource`), le resultat 400 tombait
 * dans un `catch {}` vide, et l'ecran Documents affichait en permanence une
 * liste vide avec des compteurs a zero. L'endpoint est par ailleurs publie
 * dans la spec OpenAPI et le client generé.
 *
 * Le test appelle la route pour de vrai, a travers le routeur reel, et ne
 * regarde que la FORME de la reponse: un corps qui porte `bySource` prouve que
 * c'est le bon handler qui a repondu. Il echoue (400 « ID invalide ») des que
 * le garde `next()` disparait de `/documents/:id`.
 *
 * La session est injectee a la main parce que le sujet du test est le ROUTAGE,
 * pas l'authentification: sans session, les deux routes rendraient le meme 401
 * et le test ne distinguerait rien. Les gardes de role restent en place dans le
 * routeur teste — c'est bien `requireMinAgent` qui laisse passer cet appel.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import express from "express";
import documentsRouter from "../routes/documents";

/** Organisation inexistante: on veut une reponse VIDE, pas des donnees. */
const ORG_INEXISTANTE = 999_999_999;

async function appeler(chemin: string): Promise<{ status: number; body: string }> {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = {
      userId: 1,
      userRole: "administrateur",
      organisationId: ORG_INEXISTANTE,
    };
    (req as unknown as { log: unknown }).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use(documentsRouter);
  const srv = app.listen(0);
  try {
    const port = (srv.address() as { port: number }).port;
    const r = await fetch(`http://127.0.0.1:${port}${chemin}`);
    return { status: r.status, body: await r.text() };
  } finally {
    srv.close();
  }
}

describe("routage des documents", () => {
  it("/documents/by-source n'est pas captee par /documents/:id", async () => {
    const r = await appeler("/documents/by-source");
    expect(
      r.status,
      `la route litterale est masquee par /documents/:id (reponse: ${r.body.slice(0, 120)})`,
    ).toBe(200);
    expect(JSON.parse(r.body)).toHaveProperty("bySource");
  });

  it("un identifiant reellement invalide reste refuse", async () => {
    // Le garde ne doit pas transformer toute saisie en 404 silencieux pour les
    // vrais identifiants: un id numerique inconnu garde son 404 metier.
    const r = await appeler("/documents/424242");
    expect(r.status).toBe(404);
  });
});
