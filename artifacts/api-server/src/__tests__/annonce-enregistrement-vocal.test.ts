/**
 * Avant le bip, l'appelant sait que son message est enregistre, transcrit par
 * une IA, et combien de temps il est garde (RGPD art. 13, information au
 * moment de la collecte ; revue de vendabilite du 30/09).
 *
 * Meme construction qu'ANNONCE_IA : le texte vient du code, pas de l'accueil
 * que redige l'organisation cliente.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANNONCE_ENREGISTREMENT, texteAvantEnregistrement, type RecLang } from "../routes/voice-receptionist";

const LANGUES: RecLang[] = ["fr", "tr", "en", "es", "de", "ar"];
const SOURCE = readFileSync(join(import.meta.dirname, "..", "routes", "voice-receptionist.ts"), "utf8");
const PURGE = readFileSync(join(import.meta.dirname, "..", "services", "purge-transcriptions.ts"), "utf8");

const DOIT_DIRE: Record<RecLang, RegExp[]> = {
  fr: [/enregistre/i, /intelligence artificielle/i, /douze mois/i, /effacement/i],
  tr: [/kaydedil/i, /yapay zeka/i, /on iki ay/i, /silin/i],
  en: [/recorded/i, /artificial intelligence/i, /twelve months/i, /deleted/i],
  es: [/grabado/i, /inteligencia artificial/i, /doce meses/i, /supresion/i],
  de: [/aufgezeichnet/i, /kuenstlichen intelligenz/i, /zwoelf monate/i, /loeschung/i],
  ar: [/تسجيل/, /الذكاء الاصطناعي/, /اثني عشر شهراً/, /حذف/],
};

describe("l'information sur l'enregistrement", () => {
  for (const lang of LANGUES) {
    it(`${lang} : dit enregistrement, IA, duree et droit d'effacement`, () => {
      for (const re of DOIT_DIRE[lang]) expect(ANNONCE_ENREGISTREMENT[lang], String(re)).toMatch(re);
    });
  }

  it("vient AVANT le message de l'organisation, et un message vide ne l'efface pas", () => {
    expect(texteAvantEnregistrement("fr", "Laissez un message apres le bip.").startsWith(ANNONCE_ENREGISTREMENT.fr)).toBe(true);
    expect(texteAvantEnregistrement("fr", "")).toContain(ANNONCE_ENREGISTREMENT.fr);
  });

  it("la duree annoncee est celle que le code applique (purge a 12 mois)", () => {
    expect(PURGE).toMatch(/12 mois/);
  });

  it("toute balise <Record> du repondeur passe par l'annonce", () => {
    const records = SOURCE.split("\n").filter((l) => l.includes("<Record ") && !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(records.length).toBeGreaterThan(0);
    // Une seule fabrique de <Record>, et elle dit l'annonce juste avant.
    expect(records).toHaveLength(1);
    const i = SOURCE.indexOf(records[0]!);
    expect(SOURCE.slice(Math.max(0, i - 400), i)).toContain("texteAvantEnregistrement(lang, say)");
  });
});
