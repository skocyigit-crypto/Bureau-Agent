/**
 * Un antislash perdu ne casse rien : il change le sens, en silence.
 *
 * `/^\d{4}$/` reconnait quatre chiffres. `/^d{4}$/` reconnait la chaine
 * « dddd ». Les deux sont des expressions valides, aucun outil ne proteste,
 * le typage est satisfait — et la route devient injoignable sans que rien ne
 * le dise. C'est arrive le 18/09 sur la cloture comptable et sur l'archive
 * remise au controleur : aucune periode reelle ne pouvait etre close, et le
 * seul retour, « Periode invalide », accusait l'utilisateur.
 *
 * La cause est connue et se reproduira : ces fichiers sont edites par des
 * scripts et des remplacements ou l'antislash est lui-meme un caractere
 * d'echappement. Ce controle balaie donc le depot a chaque execution des
 * tests, sur les lignes de CODE (les commentaires peuvent citer la forme
 * cassee, comme celui-ci).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const DOSSIERS = ["artifacts", "lib", "scripts"];
const IGNORES = /node_modules|dist|build|coverage|\.git|\.next|android|ios/;

function fichiers(dir: string, acc: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (IGNORES.test(p)) continue;
    if (statSync(p).isDirectory()) fichiers(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(nom)) acc.push(p);
  }
  return acc;
}

/** Une ligne de commentaire peut citer la forme cassee sans etre fautive. */
function estCommentaire(ligne: string): boolean {
  const t = ligne.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

describe("aucune classe de caracteres n'a perdu son antislash", () => {
  const coupables: string[] = [];

  for (const dossier of DOSSIERS) {
    for (const fichier of fichiers(join(RACINE, dossier))) {
      // Ce fichier porte volontairement un echantillon casse, pour verifier le
      // detecteur lui-meme : le balayer reviendrait a se denoncer.
      if (fichier.endsWith("antislash-perdu.test.ts")) continue;
      const lignes = readFileSync(fichier, "utf8").split("\n");
      lignes.forEach((ligne, i) => {
        if (estCommentaire(ligne)) return;
        for (const m of ligne.matchAll(/\/[^/\n]*\/[gimsuy]*/g)) {
          // Les classes explicites [abc] peuvent contenir d, w ou s: on les
          // retire avant de juger.
          const corps = m[0].replace(/\[[^\]]*\]/g, "");
          // Quantificateurs retenus: `{n}` et `+`, pas `?`.
          //
          // Premiere version: seul `{n}` etait cherche. Elle a laisse passer
          // `replace(/s+/g, " ")` dans l'acceptation d'invitation, qui
          // remplacait la lettre « s » par une espace — tout invite nomme
          // « Dupuis » etait enregistre « Dupui ». Un detecteur trop etroit
          // rassure sans proteger.
          //
          // En elargissant, `?` a fait crier au loup sur `what'?s?\s+date`
          // (instant-answer.ts), ou le `s?` est une LETTRE optionnelle, pas
          // une classe estropiee — c'est la forme courante d'un pluriel
          // facultatif. Une classe de caracteres est presque toujours ecrite
          // avec `+` ou `{n}`; un `?` sur une lettre nue est presque toujours
          // voulu. Le detecteur garde donc les deux premiers: il vaut mieux
          // qu'il dise vrai a chaque fois, sans quoi on cesse de le lire.
          if (/(^|[^\\])\b[dwsDWS][{+]/.test(corps)) {
            coupables.push(`${fichier.replace(RACINE, "")}:${i + 1} — ${ligne.trim().slice(0, 100)}`);
          }
        }
      });
    }
  }

  it("le depot n'en contient aucune", () => {
    expect(
      coupables,
      `« d{n} » au lieu de « \\d{n} » : l'expression reconnait la LETTRE, la route devient injoignable.\n${coupables.join("\n")}`,
    ).toEqual([]);
  });

  it("le balayage regarde bien quelque chose", () => {
    // Un controle qui ne lit aucun fichier passerait toujours.
    const total = DOSSIERS.reduce((n, d) => n + fichiers(join(RACINE, d)).length, 0);
    expect(total, "aucun fichier balaye: le controle ne prouve rien").toBeGreaterThan(200);
  });

  it("il reconnait la forme cassee quand elle est presente", () => {
    // Verifie le detecteur lui-meme sur un echantillon, faute de quoi un
    // balayage vide se confondrait avec un depot sain.
    const casse = `if (!/^d{4}(-d{2})?$/.test(p)) {`;
    const corps = (casse.match(/\/[^/\n]*\/[gimsuy]*/g) ?? [""])[0].replace(/\[[^\]]*\]/g, "");
    expect(/(^|[^\\])\b[dws]\{\d/.test(corps)).toBe(true);
  });

  it("il reconnait aussi le quantificateur « + », celui de l'invitation", () => {
    // `replace(/s+/g, " ")` remplacait la LETTRE « s » par une espace: tout
    // invite nomme « Dupuis » etait enregistre « Dupui ». La premiere version
    // du detecteur ne cherchait que `{n}` et laissait passer cette forme.
    const casse = `nom.trim().replace(/s+/g, " ")`;
    const corps = (casse.match(/\/[^/\n]*\/[gimsuy]*/g) ?? [""])[0].replace(/\[[^\]]*\]/g, "");
    expect(/(^|[^\\])\b[dwsDWS][{+]/.test(corps)).toBe(true);
  });

  it("mais pas une lettre optionnelle, qui est une forme voulue", () => {
    // `what'?s?\s+date` (instant-answer.ts): le `s?` est un pluriel
    // facultatif, pas une classe estropiee.
    const sain = `/what'?s?\\s+date/`;
    expect(/(^|[^\\])\b[dwsDWS][{+]/.test(sain)).toBe(false);
  });

  it("et il ne signale pas la forme correcte", () => {
    const sain = `if (!/^\\d{4}(-\\d{2})?$/.test(p)) {`;
    const corps = (sain.match(/\/[^/\n]*\/[gimsuy]*/g) ?? [""])[0].replace(/\[[^\]]*\]/g, "");
    expect(/(^|[^\\])\b[dws]\{\d/.test(corps)).toBe(false);
  });

  it("ni une classe explicite qui contient la lettre", () => {
    const sain = `/^[dws]{2}$/`;
    const corps = sain.replace(/\[[^\]]*\]/g, "");
    expect(/(^|[^\\])\b[dws]\{\d/.test(corps)).toBe(false);
  });
});
