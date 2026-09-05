/**
 * La reconnaissance faciale reste debranchee.
 *
 * `/face/register` enregistrait un gabarit derive d'un visage
 * (`face_profiles.face_descriptor`), et `/face/recognize` identifiait une
 * personne a partir d'une photo en journalisant le nom reconnu, l'indice de
 * confiance, la position et l'appareil.
 *
 * Un gabarit qui permet d'identifier quelqu'un de facon unique est une donnee
 * biometrique au sens de l'article 4(14) du RGPD, et l'article 9 en interdit le
 * traitement par principe. Mesure du 2026-09-05: le mot « biometrie »
 * n'apparaissait dans AUCUN document — politique francaise, politique turque,
 * DPA, CGU — et aucun ecran ne recueillait de consentement avant l'enrolement.
 * Le traitement etait actif, et rien ne l'annoncait.
 *
 * Declarer n'aurait pas suffi: en contexte de travail, le consentement d'un
 * salarie n'est pas considere comme librement donne, et la CNIL a sanctionne a
 * plusieurs reprises la reconnaissance faciale utilisee pour le pointage. Un
 * paragraphe de politique aurait rendu la chose visible, pas licite.
 *
 * Ce test est le garde-fou de cette decision. Remonter la route est une ligne;
 * il faut que cette ligne casse quelque chose de visible, avec la raison
 * attachee — sinon elle reviendra un jour ou personne ne se souviendra
 * pourquoi elle etait partie.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pourquoi une verification STRUCTURELLE et non une requete HTTP.
 *
 * Premiere tentative: interroger `/api/face/register` et attendre un 404. Elle
 * echouait — la reponse etait 401 ou 403, parce que `requireAuth` et le
 * controle d'origine repondent AVANT que le routage n'ait a decider. Un 401 ne
 * distingue donc pas « route absente » de « route presente mais protegee »,
 * c'est-a-dire exactement les deux cas que ce test doit separer.
 *
 * On lit donc la source du routeur: c'est la que la decision est prise, et
 * c'est la qu'une regression s'ecrirait.
 */
const INDEX = fs.readFileSync(
  path.resolve(__dirname, "../routes/index.ts"),
  "utf8",
);

/** La source sans ses commentaires: un rappel commente ne monte rien. */
const CODE = INDEX
  .replace(/\/\*[^]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

describe("traitement biometrique debranche", () => {
  it("aucun routeur n'est monte sur un chemin de reconnaissance faciale", () => {
    const montages = [...CODE.matchAll(/router\.use\(\s*["'`]([^"'`]+)["'`]/g)]
      .map((m) => m[1]);

    const suspects = montages.filter((c) => /face|facial|biometr/i.test(c));
    expect(
      suspects,
      "un routeur de reconnaissance faciale est monte. Avant de le remonter il faut: " +
      "une base licite au titre de l'article 9(2) verifiee par un juriste, une AIPD " +
      "(article 35(3)(b)), un ecran de consentement et de retrait avant tout enrolement, " +
      "et la declaration dans les quatre documents legaux.",
    ).toEqual([]);
  });

  it("le routeur importe n'est branche nulle part", () => {
    // Le module reste importe volontairement — le code n'est pas perdu — mais
    // il ne doit servir qu'a un `void`. S'il reapparait dans un appel, c'est
    // qu'il est reparti en service.
    const usages = [...CODE.matchAll(/faceRecognitionRouter/g)].length;
    const neutralise = /void faceRecognitionRouter;/.test(CODE);
    expect(neutralise, "le marqueur `void faceRecognitionRouter;` a disparu").toBe(true);
    // Un import + un `void` = deux occurrences. Une troisieme signifie un usage.
    expect(usages, "faceRecognitionRouter est utilise ailleurs que dans le void").toBe(2);
  });

  it("l'ecran mobile d'enrolement n'existe plus", () => {
    // expo-router construit ses routes depuis le systeme de fichiers: laisser
    // le fichier dans `app/` aurait garde l'ecran atteignable, meme sans entree
    // de menu.
    const ecran = path.resolve(__dirname, "../../../mobile/app/face-recognition.tsx");
    expect(
      fs.existsSync(ecran),
      "le fichier est de retour dans app/: expo-router le publie automatiquement",
    ).toBe(false);
  });
});
