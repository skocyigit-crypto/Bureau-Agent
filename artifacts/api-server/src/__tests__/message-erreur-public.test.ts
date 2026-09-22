/**
 * Une reponse d'erreur ne decrit pas l'interieur du produit.
 *
 * Neuf routes renvoyaient `err.message` tel quel dans le corps. Un message
 * d'exception n'est pas un texte pour l'utilisateur : c'est un texte pour le
 * developpeur, et il porte ce qu'il a sous la main.
 *
 *  - Postgres : « duplicate key value violates unique constraint
 *    "factures_client_org_reference_unique" » — noms de tables, de colonnes et
 *    de contraintes ;
 *  - un fournisseur d'envoi (Resend, Twilio) : identifiant de compte, domaine
 *    expediteur, parfois le debut d'une cle ;
 *  - le stockage : un chemin de bucket.
 *
 * Rien de cela n'aide la personne qui a clique, et tout cela decrit
 * l'architecture a quelqu'un qui n'a qu'un compte de son organisation.
 *
 * Le detail va au JOURNAL, en entier. La reponse porte une phrase stable.
 * Hors production, le detail est joint sous `details` — c'est ce dont on a
 * besoin en developpement, et c'etait deja le choix de `routes/ai-analysis.ts`.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { corpsErreur } from "../lib/message-erreur";

const ROUTES = join(import.meta.dirname, "..", "routes");
const ENV_INITIAL = process.env.NODE_ENV;

afterEach(() => { process.env.NODE_ENV = ENV_INITIAL; });

/** Un message d'exception realiste, tel que Postgres le rend. */
const MESSAGE_INTERNE =
  'duplicate key value violates unique constraint "factures_client_org_reference_unique"';

describe("en production, le detail reste au journal", () => {
  it("le corps ne porte que la phrase stable", () => {
    process.env.NODE_ENV = "production";
    const corps = corpsErreur(new Error(MESSAGE_INTERNE), "La sauvegarde n'a pas pu etre creee.");
    expect(corps.error).toBe("La sauvegarde n'a pas pu etre creee.");
    expect(corps.details, "le detail interne part chez le client").toBeUndefined();
  });

  it("le nom de la contrainte ne sort pas", () => {
    process.env.NODE_ENV = "production";
    const corps = corpsErreur(new Error(MESSAGE_INTERNE), "Echec.");
    expect(JSON.stringify(corps)).not.toContain("factures_client_org_reference_unique");
  });

  it("une chaine levee telle quelle ne sort pas non plus", () => {
    process.env.NODE_ENV = "production";
    const corps = corpsErreur("SMTP 535 5.7.8 sender rejected: acct_1a2b3c", "Envoi impossible.");
    expect(JSON.stringify(corps)).not.toContain("acct_1a2b3c");
  });
});

describe("hors production, le detail est joint", () => {
  it("parce que c'est ce dont on a besoin en developpement", () => {
    process.env.NODE_ENV = "development";
    const corps = corpsErreur(new Error(MESSAGE_INTERNE), "Echec.");
    expect(corps.details).toBe(MESSAGE_INTERNE);
  });

  it("la phrase stable reste la, meme avec le detail", () => {
    process.env.NODE_ENV = "development";
    const corps = corpsErreur(new Error("boom"), "La sauvegarde n'a pas pu etre creee.");
    expect(corps.error).toBe("La sauvegarde n'a pas pu etre creee.");
  });

  it("une valeur qui n'est ni Error ni chaine ne produit pas de detail vide", () => {
    process.env.NODE_ENV = "development";
    const corps = corpsErreur({ code: 500 }, "Echec.");
    expect(corps.details).toBeUndefined();
  });
});

describe("les routes qui renvoyaient l'exception sont passees par la", () => {
  const cas = [
    ["my-backups.ts", "La sauvegarde n'a pas pu etre creee"],
    ["org-google-credentials.ts", "Les identifiants n'ont pas pu etre enregistres"],
    ["proactive.ts", "L'envoi de la relance a échoué"],
    ["documents.ts", "Ce fichier n'a pas pu etre importe"],
  ] as const;

  for (const [fichier, phrase] of cas) {
    it(`${fichier} rend une phrase stable`, () => {
      const source = readFileSync(join(ROUTES, fichier), "utf8");
      expect(source, `${fichier}: la phrase de repli a disparu`).toContain(phrase);
      expect(source).toMatch(/corpsErreur\(/);
    });
  }

  it("et aucune route ne renvoie plus une exception brute", () => {
    // Le controle porte sur le MOTIF, pas sur ces quatre fichiers: une route
    // ecrite demain qui recopie `err.message` dans le corps le fera tomber.
    //
    // Deux formes restent legitimes et sont exclues: le garde deja pose dans
    // `ai-analysis.ts` (`isProduction ? {} : { details }`), et les evenements
    // d'un flux de travail interne a l'organisation.
    const nues: string[] = [];
    for (const f of fichiers(ROUTES)) {
      const lignes = readFileSync(f, "utf8").split(/\r?\n/);
      const nom = f.split(/[\\/]/).slice(-1)[0]!;
      lignes.forEach((l, i) => {
        if (!/res\.status\(\d{3}\)[\s\S]*\.json\(/.test(l)) return;
        // `\b` : `err.messagePublic` (une phrase fixe, redigee pour
        // l'utilisateur) n'est pas `err.message`.
        if (!/error:\s*(err|error)\??\.(message|stack)\b|error:\s*\w+ instanceof Error \? \w+\.message\b/.test(l)) return;
        if (/isProduction/.test(l)) return;
        nues.push(`${nom}:${i + 1}`);
      });
    }
    expect(nues, `exception renvoyee telle quelle au client: ${nues.join(", ")}`).toEqual([]);
  });
});

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return p.endsWith(".ts") && !p.includes(".test.") ? [p] : [];
  });
}
