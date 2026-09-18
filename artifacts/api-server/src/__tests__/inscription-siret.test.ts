/**
 * Le service est reserve aux professionnels: l'inscription doit le verifier.
 *
 * Les CGV posent que « le service est destine a des professionnels agissant
 * dans le cadre de leur activite » et ecartent le droit de retractation sur ce
 * fondement. Mesure le 18/09: rien ne le verifiait. N'importe quel particulier
 * pouvait souscrire — et gardait alors ses quatorze jours de retractation
 * (C. conso. L221-18) quelle que soit la clause, tandis qu'un professionnel
 * contractant avec des consommateurs doit designer un mediateur
 * (C. conso. L612-1). Une clause que le parcours dement ne protege personne.
 *
 * Le controle est arithmetique (cle de Luhn): il refuse un numero invente. Il
 * ne prouve pas que l'entreprise existe — cela demanderait l'annuaire officiel
 * au milieu d'une inscription.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lireInscription } from "../services/inscription-saisie";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const BASE = {
  orgName: "Durand BTP",
  firstName: "Jean",
  lastName: "Durand",
  email: "jean@durand.test",
  password: "Kestrel7Vagon",
  acceptedTerms: true,
};
// SIREN et SIRET reels de La Poste et d'une societe de test: cles valides.
const SIREN_VALIDE = "552100554";
const SIRET_VALIDE = "55210055400013";

describe("inscription: identifiant professionnel", () => {
  it("un SIREN valide (9 chiffres) passe", () => {
    const r = lireInscription({ ...BASE, siret: SIREN_VALIDE });
    expect(r.ok && r.siret).toBe(SIREN_VALIDE);
  });

  it("un SIRET valide (14 chiffres) passe", () => {
    const r = lireInscription({ ...BASE, siret: SIRET_VALIDE });
    expect(r.ok && r.siret).toBe(SIRET_VALIDE);
  });

  it("les espaces de saisie sont normalises", () => {
    const r = lireInscription({ ...BASE, siret: "552 100 554" });
    expect(r.ok && r.siret).toBe(SIREN_VALIDE);
  });

  it("aucun identifiant : refus explicite", () => {
    const r = lireInscription({ ...BASE });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.champ).toBe("siret");
    expect(!r.ok && r.erreur).toMatch(/professionnels/i);
  });

  it("un numero invente (cle fausse) est refuse", () => {
    expect(lireInscription({ ...BASE, siret: "123456789" }).ok).toBe(false);
  });

  it("une longueur impossible est refusee", () => {
    expect(lireInscription({ ...BASE, siret: "5521005" }).ok).toBe(false);
  });

  it("des lettres sont refusees", () => {
    expect(lireInscription({ ...BASE, siret: "SIRET-A-VENIR" }).ok).toBe(false);
  });

  it("le refus dit pourquoi, pas seulement « invalide »", () => {
    const r = lireInscription({ ...BASE, siret: "5521005" });
    expect(!r.ok && r.erreur).toMatch(/9|14/);
  });

  it("les autres controles restent en place", () => {
    expect(lireInscription({ ...BASE, siret: SIREN_VALIDE, email: "jean@" }).ok).toBe(false);
    expect(lireInscription({ ...BASE, siret: SIREN_VALIDE, orgName: "D" }).ok).toBe(false);
  });
});

describe("le parcours complet demande cet identifiant", () => {
  it("la route d'inscription l'enregistre sur l'organisation", () => {
    const source = readFileSync(join(RACINE, "artifacts", "api-server", "src", "routes", "register.ts"), "utf8");
    expect(source).toMatch(/siret,/);
  });

  it("le formulaire web le demande et l'envoie", () => {
    const page = readFileSync(join(RACINE, "artifacts", "buro-ajani", "src", "pages", "register.tsx"), "utf8");
    expect(page, "champ absent du formulaire: le serveur refuserait toute inscription").toMatch(/id="siret"/);
    expect(page).toMatch(/siret: siret\.trim\(\)/);
  });

  it("le champ est traduit dans les six langues", () => {
    for (const langue of ["fr", "en", "tr", "de", "es", "ar"]) {
      const j = JSON.parse(readFileSync(join(RACINE, "artifacts", "buro-ajani", "src", "i18n", "locales", `${langue}.json`), "utf8"));
      expect(j.register?.siretLabel, `traduction manquante: ${langue}`).toBeTruthy();
    }
  });

  it("les CGV continuent d'affirmer la reserve aux professionnels", () => {
    const cgv = readFileSync(join(RACINE, "artifacts", "tanitim", "src", "pages", "cgv.tsx"), "utf8");
    expect(cgv, "si la reserve disparait des CGV, ce controle n'a plus de fondement").toMatch(/professionnels/i);
  });
});

/**
 * Le compte de verification se cree par l'API PUBLIQUE, donc il subit la meme
 * exigence. Mesure du 18/09 : le job « Ecrans connectes » de la CI est tombe
 * des la premiere execution apres ce changement — semer-verif.mjs n'envoyait
 * pas de SIRET, le 400 ne creait aucun compte, et les 25 ecrans se sont
 * evalues sur une session absente. Ce controle relie les deux fichiers : qui
 * durcit l'inscription voit ici ce qu'il doit suivre.
 */
describe("l'amorce de verification suit la meme regle", () => {
  const semeur = readFileSync(join(RACINE, "scripts", "semer-verif.mjs"), "utf8");

  it("envoie un identifiant", () => {
    expect(semeur, "sans siret, le seed rend 400 et la CI juge des ecrans deconnectes").toMatch(/siret:/);
  });

  it("envoie un identifiant que le serveur accepte vraiment", () => {
    const m = semeur.match(/siret:\s*"([^"]+)"/);
    expect(m, "identifiant introuvable dans le seed").not.toBeNull();
    const verdict = lireInscription({
      orgName: "Verif", firstName: "V", lastName: "L",
      email: "v@example.com", siret: m![1],
    });
    expect(verdict.ok, "le seed porte un numero que l'inscription refuse").toBe(true);
  });
});
