/**
 * Au telephone, l'appelant sait qu'il parle a une IA.
 *
 * Reglement (UE) 2024/1689 (AI Act), art. 50 §1 : un systeme d'IA destine a
 * interagir directement avec des personnes doit les en informer, sauf si
 * c'est evident. La secretaire vocale repond a des clients et prospects de
 * l'organisation — des tiers qui n'ont rien signe.
 *
 * Avant le 21/09/2026, l'appel s'ouvrait sur « vous etes en relation avec le
 * secretariat », ou « ravie de vous reentendre » pour un appelant connu, avec
 * une voix synthetique naturelle. Et l'accueil etant redige librement par
 * l'organisation cliente, rien n'empechait d'effacer toute trace d'IA.
 *
 * Ce qui est verifie ici : l'annonce est dite en PREMIER, dans chaque langue,
 * quel que soit l'accueil, et le modele n'a pas le droit de se dire humain.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANNONCE_IA, premierEnonce, type RecLang } from "../routes/voice-receptionist";

const LANGUES: RecLang[] = ["fr", "tr", "en", "es", "de", "ar"];
const SOURCE = readFileSync(join(import.meta.dirname, "..", "routes", "voice-receptionist.ts"), "utf8");

/** Ce que chaque langue doit dire, en clair, pour que l'annonce en soit une. */
const MOTS_IA: Record<RecLang, RegExp> = {
  fr: /intelligence artificielle/i,
  tr: /yapay zeka/i,
  en: /artificial intelligence/i,
  es: /inteligencia artificial/i,
  de: /kuenstlichen intelligenz/i,
  ar: /الذكاء الاصطناعي/,
};

describe("l'annonce existe dans chaque langue", () => {
  for (const lang of LANGUES) {
    it(`${lang} : dit « intelligence artificielle » en toutes lettres`, () => {
      // « assistant » seul ne suffit pas : un assistant peut etre humain.
      expect(ANNONCE_IA[lang]).toMatch(MOTS_IA[lang]);
    });
  }

  it("aucune langue proposee n'est sans annonce", () => {
    const declarees = /const REC_LANGS: readonly RecLang\[\] = \[([^\]]+)\]/.exec(SOURCE)?.[1] ?? "";
    const langues = [...declarees.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
    expect(langues.length, "liste des langues introuvable").toBeGreaterThan(0);
    for (const l of langues) {
      expect(ANNONCE_IA[l as RecLang], `langue ${l} sans annonce IA`).toBeTruthy();
    }
  });
});

describe("l'annonce passe avant tout le reste", () => {
  it("avant l'accueil par defaut", () => {
    const e = premierEnonce("fr", "Bonjour, vous etes en relation avec le secretariat.");
    expect(e.startsWith(ANNONCE_IA.fr)).toBe(true);
  });

  it("avant un accueil personnalise qui se ferait passer pour une personne", () => {
    // L'accueil est libre: l'organisation cliente peut ecrire n'importe quoi.
    const e = premierEnonce("fr", "Bonjour, c'est Julie a l'appareil, je suis la pour vous.");
    expect(e.indexOf(ANNONCE_IA.fr)).toBe(0);
    expect(e).toContain("Julie");
  });

  it("avant l'accueil d'un appelant connu", () => {
    const e = premierEnonce("en", "Hello Marc, good to hear from you again.");
    expect(e.startsWith(ANNONCE_IA.en)).toBe(true);
  });

  it("un accueil vide ne supprime pas l'annonce", () => {
    expect(premierEnonce("de", "").trim()).toBe(ANNONCE_IA.de);
  });
});

describe("la route d'appel entrant emploie bien l'annonce", () => {
  it("le premier enonce de l'appel passe par premierEnonce", () => {
    // Sans cet appel, les fonctions ci-dessus ne protegent personne.
    const i = SOURCE.indexOf("const customGreeting");
    expect(i, "la route d'appel entrant a change de forme").toBeGreaterThan(0);
    const bloc = SOURCE.slice(i, i + 600);
    expect(bloc).toMatch(/const greeting = premierEnonce\(/);
  });

  it("et c'est ce premier enonce qui est prononce", () => {
    expect(SOURCE).toMatch(/gatherTwiml\(greeting, lang, voice\)/);
  });

  it("le modele n'a pas le droit de se dire humain", () => {
    expect(SOURCE).toMatch(/Ne pretends JAMAIS etre une personne humaine/);
  });

  it("et sait quoi repondre si on lui demande", () => {
    expect(SOURCE).toMatch(/si on te demande si tu es humaine[^`]*assistante vocale automatique/);
  });
});
