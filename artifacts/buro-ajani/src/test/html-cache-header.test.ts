import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const lire = (p: string) => readFileSync(resolve(workspaceRoot, p), "utf8");

/**
 * Le document HTML ne doit pas etre reutilise depuis le cache sans
 * revalidation.
 *
 * Pourquoi ce test existe. Le document porte les noms (hashes) des morceaux de
 * code, et ces fichiers disparaissent du serveur au deploiement suivant. Un
 * navigateur qui garde un vieux document demande donc des fichiers qui
 * n'existent plus: certains onglets s'ouvrent — leur morceau est deja en
 * cache — et les autres affichent « rechargez ou reessayez ». C'est le
 * symptome remonte par les utilisateurs le 2026-09-04, et il a survecu a une
 * premiere correction cote navigateur: un client ne peut pas se rattraper si
 * on lui ressert indefiniment le meme document perime.
 *
 * La regle EXISTAIT deja dans les deux Caddyfile — mais sous la forme
 * `header /index.html ...`, qui filtre sur le chemin DEMANDE. Or les
 * navigations arrivent sur `/`, `/taches`, `/appels`... et ne deviennent
 * `/index.html` qu'en interne, via `try_files`. Mesure faite en ligne le
 * 2026-09-04 sur app.agentdebureau.fr: la reponse de `/` ne portait AUCUN
 * Cache-Control, donc le navigateur appliquait sa mise en cache heuristique.
 *
 * Une regle qui existe et ne s'applique pas est pire qu'une regle absente:
 * elle se relit comme une protection.
 */
// Le site vitrine est concerne au meme titre: il decoupe aussi son code,
// et ses pages legales sont chargees a la demande.
const CADDYFILES = ["deploy/Caddyfile.cloudrun", "deploy/Caddyfile", "deploy/Caddyfile.tanitim.cloudrun"];

describe("cache du document HTML", () => {
  for (const chemin of CADDYFILES) {
    describe(chemin, () => {
      const contenu = lire(chemin);

      it("ne filtre plus sur le chemin /index.html, qui n'est jamais demande", () => {
        expect(
          contenu,
          "`header /index.html` ne s'applique qu'a une requete litterale vers /index.html",
        ).not.toMatch(/header\s+\/index\.html\s+Cache-Control/);
      });

      it("pose un Cache-Control revalidant sur tout ce qui n'est pas un fichier hashe", () => {
        // Le matcher doit exclure les fichiers a nom hashe (eux sont
        // immuables) et couvrir tout le reste — donc les navigations.
        expect(contenu).toMatch(/@document\s+not\s+path_regexp/);
        expect(contenu).toMatch(/header\s+@document\s+Cache-Control\s+"no-cache/);
      });

      it("garde le cache long sur les fichiers hashes: c'est ce qui rend le site rapide", () => {
        expect(contenu).toMatch(/header\s+@hashed\s+Cache-Control\s+"public,\s*max-age=31536000,\s*immutable"/);
      });

      it("n'utilise pas no-store, qui interdirait aussi le retour arriere", () => {
        // `no-cache` = revalider avant de reutiliser. `no-store` = ne rien
        // garder du tout, ce qui casse le cache de retour arriere du
        // navigateur pour un gain nul ici.
        const ligne = contenu.split("\n").find((l) => /header\s+@document\s+Cache-Control/.test(l)) ?? "";
        expect(ligne).not.toMatch(/no-store/);
      });
    });
  }
});
