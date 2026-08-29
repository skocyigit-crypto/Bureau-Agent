import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Coherence entre les durees de conservation ANNONCEES et ce que le code
 * applique reellement.
 *
 * C'est l'ecart le plus couteux d'une politique de confidentialite, parce
 * qu'il ne se voit nulle part: la page promet une duree, personne ne verifie
 * jamais qu'un traitement l'applique, et le manquement au principe de
 * limitation de la conservation (RGPD art. 5.1.e) ne se manifeste que le jour
 * ou quelqu'un demande des comptes.
 *
 * Deux ecarts reels ont ete corriges et sont figes ici:
 *
 *  1. « Enregistrements d'appels : max. 12 mois » etait publie alors qu'aucune
 *     purge n'existait — les seuls crons enregistres etaient la secretaire
 *     autonome et les relances de facture.
 *  2. Les journaux d'audit sont rendus non supprimables par des declencheurs
 *     PostgreSQL et contiennent des donnees personnelles. Les annoncer comme
 *     des « logs a 12 mois » etait une promesse que l'architecture rendait
 *     intenable; ils ont desormais leur propre ligne, avec la base legale.
 *
 * Verification statique: le but est d'empecher qu'on retire la purge, ou qu'on
 * reecrive la page sans regarder ce que fait le code.
 */

const SRC = join(import.meta.dirname, "..");
const TANITIM = join(SRC, "..", "..", "..", "artifacts", "tanitim", "src", "pages");

const read = (p: string) => readFileSync(p, "utf8");

describe("purge des enregistrements d'appel", () => {
  const service = read(join(SRC, "services/retention-cron.ts"));

  it("efface le contenu sensible sans detruire la ligne de journal", () => {
    // L'URL et la transcription sont la donnee personnelle sensible; qui a
    // appele qui et quand reste une donnee d'exploitation et de facturation.
    expect(service).toContain("recordingUrl: null");
    expect(service).toContain("transcription: null");
    expect(service).not.toContain("db.delete(telephonyCallLogsTable)");
  });

  it("ne reecrit que les lignes qui portent encore quelque chose", () => {
    // Sans ce filtre, la purge quotidienne reecrirait tout l'historique
    // d'appels de chaque organisation a chaque passage.
    expect(service).toContain("isNotNull(telephonyCallLogsTable.recordingUrl)");
  });

  it("est bien demarree par le serveur", () => {
    // Une purge ecrite mais jamais branchee laisse exactement le probleme
    // qu'elle etait censee resoudre.
    const entry = read(join(SRC, "index.ts"));
    expect(entry).toContain("startRetentionCron");
  });

  it("passe par le registre de crons pour rester observable", () => {
    expect(service).toContain("registerRunnableCron");
  });
});

describe("politique de confidentialite", () => {
  const policy = read(join(TANITIM, "confidentialite.tsx"));

  it("declare les journaux d'audit et leur conservation permanente", () => {
    // Leur immuabilite est une propriete de securite assumee: ce qui manquait,
    // c'etait de le dire aux personnes concernees.
    expect(policy).toContain("Journaux d'audit");
    expect(policy).toMatch(/permanente/);
  });

  it("donne une base legale a cette conservation", () => {
    expect(policy).toMatch(/6\.1\.f|intérêt légitime/);
  });

  it("ne presente plus les journaux d'audit comme des logs a 12 mois", () => {
    // La ligne « Données de log : 12 mois » couvrait implicitement des
    // journaux que l'architecture ne permet pas d'effacer.
    expect(policy).not.toMatch(/<strong>Données de log<\/strong>/);
  });

  it("conserve les autres durees annoncees", () => {
    for (const promesse of ["Données de compte", "Données de facturation", "Enregistrements d'appels"]) {
      expect(policy, `duree manquante: ${promesse}`).toContain(promesse);
    }
  });
});
