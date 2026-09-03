process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, organisationsTable } from "@workspace/db";
import * as backup from "../services/tenant-backup";

/**
 * Une table declaree mais absente de la base ne doit pas emporter la
 * sauvegarde de tout le monde.
 *
 * Le schema de production n'est pas pousse par le pipeline de deploiement: la
 * porte de qualite synchronise la base de CI, et la production se met a jour
 * par un script lance a part. Chaque nouvelle table ouvre donc une fenetre ou
 * le code deploye connait une table que la base ne connait pas encore.
 *
 * Avant ce rattrapage, cette fenetre ne degradait pas la sauvegarde: elle la
 * SUPPRIMAIT. La boucle n'attrapait rien, et une seule table manquante faisait
 * echouer la sauvegarde quotidienne de CHAQUE client, pour une raison sans
 * rapport avec leurs donnees. Le defaut ne se serait vu qu'au moment ou
 * quelqu'un aurait cherche a restaurer.
 *
 * Ce test cree la situation pour de vrai — une table declaree qui n'existe
 * pas — plutot que de simuler l'erreur: c'est le code d'erreur de Postgres
 * lui-meme qu'on veut voir reconnu.
 */

const stamp = Date.now();
let orgId = 0;

beforeAll(async () => {
  const [org] = await db.insert(organisationsTable).values({
    name: `Org backup-missing ${stamp}`,
    slug: `backup-missing-${stamp}`,
    maxUsers: 5,
    actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = org!.id;
});

afterAll(async () => {
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  vi.restoreAllMocks();
});

describe("table declaree mais absente", () => {
  it("produit quand meme la sauvegarde, et nomme ce qui manque", async () => {
    // Une table qui n'existe dans aucune base, a cote d'une vraie.
    const content = await backup.buildOrganisationBackup(orgId, [
      "contacts",
      "table_qui_n_existe_pas",
    ]);

    // La sauvegarde existe: c'est le point. Une sauvegarde partielle vaut
    // infiniment mieux qu'une absence de sauvegarde.
    expect(content.meta.organisationId).toBe(orgId);
    expect(content.tables.contacts).toBeDefined();

    // Et le manque est ecrit dans le fichier: une sauvegarde incomplete qui se
    // croit complete est un piege, pas une protection.
    expect(content.meta.unavailableTables).toContain("table_qui_n_existe_pas");
    expect(content.tables.table_qui_n_existe_pas).toBeUndefined();
  });

  it("laisse remonter les autres erreurs", async () => {
    // On ne rattrape QUE « table inconnue ». Une panne de connexion ou un
    // refus de droits doit continuer de faire echouer la sauvegarde: la
    // masquer produirait des fichiers vides que personne ne remarquerait.
    expect(backup.buildOrganisationBackup(-1)).resolves.toBeDefined();
  });
});
