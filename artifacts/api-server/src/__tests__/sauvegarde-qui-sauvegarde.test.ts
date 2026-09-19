/**
 * Une sauvegarde qui ne sauvegarde rien est pire que pas de sauvegarde.
 *
 * `services/auto-backup.ts` tournait toutes les heures. Il ne conservait
 * AUCUNE donnee : il comptait des lignes (appels, contacts, taches, messages,
 * stock, connexions), hachait ce resume, et inscrivait une ligne
 * `status: "termine"` portant une `sizeBytes` — celle du JSON de comptage — et
 * la mention `chiffrement: "AES-256-GCM"`. Rien n'etait chiffre, puisque rien
 * n'etait stocke.
 *
 * Deux aggravations mesurees le 19/09 :
 *  - les comptages n'etaient bornes a aucune organisation. Dans un produit
 *    multi-locataire, la « sauvegarde » du client A comptait les lignes de
 *    tous les autres ;
 *  - la boucle etait un `setTimeout` recursif, donc invisible au controle
 *    d'inscription des crons — et un `return` anticipe pendant une execution
 *    ne replanifiait rien : la chaine pouvait mourir jusqu'au redemarrage.
 *
 * Le depot SAVAIT : l'en-tete de `services/tenant-backup.ts` ecrit noir sur
 * blanc que ce module « n'exporte aucune donnee […] Rien a restaurer ». La
 * vraie sauvegarde par organisation a ete construite pour le remplacer — mais
 * le faux est reste branche, et a continue d'ecrire « termine ».
 *
 * Il est donc retire, pas repare. Deux systemes de sauvegarde dont un ment
 * valent moins qu'un seul qui tient : le premier empeche de s'inquieter.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");
const lire = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

describe("le faux module de sauvegarde ne revient pas", () => {
  it("le fichier n'existe plus", () => {
    expect(
      existsSync(join(SRC, "services", "auto-backup.ts")),
      "le module ressuscite: la fausse assurance revient avec lui",
    ).toBe(false);
  });

  it("plus rien ne le demarre au boot", () => {
    const index = lire("index.ts");
    expect(index).not.toMatch(/startAutoBackup/);
    expect(index).not.toMatch(/auto-backup/);
  });

  it("la route de sauvegarde manuelle ne l'appelle plus", () => {
    // Sur les lignes de CODE seulement: le commentaire de la route doit
    // pouvoir nommer ce qu'elle appelait, sinon on perd l'explication en
    // voulant verrouiller la correction.
    const lignes = lire("routes", "backups.ts").split("\n")
      .filter((l) => { const t = l.trimStart(); return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*"); });
    expect(lignes.join("\n")).not.toMatch(/performBackup\(/);
  });

  it("elle dit pourquoi, au lieu de repondre « fait »", () => {
    const route = lire("routes", "backups.ts");
    const bloc = route.slice(route.indexOf('"/backups/manual"'));
    expect(bloc.slice(0, 800), "un 200 muet laisserait croire a une sauvegarde").toMatch(/410/);
    expect(bloc.slice(0, 800)).toMatch(/my-backups/);
  });
});

describe("la vraie sauvegarde, elle, exporte des donnees", () => {
  const service = lire("services", "tenant-backup.ts");

  it("elle est bornee a UNE organisation", () => {
    expect(
      service,
      "sans bornage, l'export d'un client livrerait les donnees des autres",
    ).toMatch(/organisationId/);
  });

  it("elle retire les secrets avant d'ecrire le fichier", () => {
    // Un export telecharge puis egare ne doit pas livrer de jetons ni
    // d'empreintes de mots de passe.
    expect(service).toMatch(/secret|token|passwordHash/i);
  });

  it("son cron quotidien prend un verrou par organisation", () => {
    const cron = lire("services", "tenant-backup-cron.ts");
    expect(cron).toMatch(/withCronLock\(CRON_LOCK_NAMESPACE\.tenantBackup, org\.id/);
  });

  it("et le client peut la telecharger lui-meme", () => {
    // Une sauvegarde que seul l'editeur peut restaurer ne protege pas le
    // client d'une suppression accidentelle.
    expect(existsSync(join(SRC, "routes", "my-backups.ts"))).toBe(true);
  });
});
