/**
 * Le flux temps reel doit se fermer LUI-MEME, avant que la plateforme ne le
 * coupe.
 *
 * Il se donnait 30 minutes de vie. Cloud Run coupe une requete a 300 secondes
 * (delai effectif du service, verifie). La plateforme tranchait donc le flux
 * six fois plus tot que prevu, et la fermeture propre — la seule chose qui
 * empeche un onglet inactif de se rebrancher aussitot — n'avait jamais lieu.
 *
 * Mesure sur sept jours de journaux de production: dix-sept flux termines a
 * 300,99 s, tous a la seconde du plafond de la plateforme. Aucun a 1800 s.
 *
 * Le degat est celui que le code cherchait explicitement a eviter: un onglet
 * laisse ouvert se reconnecte toutes les cinq minutes et maintient une
 * instance Cloud Run eveillee, ce qui annule l'interet de min-instances=0.
 * Rien ne le signale — le temps reel marche, le client se reconnecte, seule la
 * facture en parle. C'est une panne qui ne se voit que sur un releve.
 *
 * Ce test lie les deux nombres l'un a l'autre. Ils vivent dans deux mondes
 * differents (le code d'un cote, la configuration Cloud Run de l'autre) et
 * c'est precisement pour cela qu'ils avaient derive.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Delai de requete de Cloud Run pour ce service, en secondes.
 *
 * Valeur effective relevee sur `agent-de-bureau-api` (et defaut de la
 * plateforme). Si elle changeait, ce test devrait changer avec elle — c'est
 * voulu: il n'existe que pour forcer cette comparaison.
 */
const DELAI_PLATEFORME_S = 300;

const source = readFileSync(
  join(import.meta.dirname, "..", "routes", "sync.ts"),
  "utf8",
);

/** Le defaut effectif, en millisecondes, tel que le code le calcule. */
function dureeParDefautMs(): number {
  const m = source.match(/const MARGE_SOUS_LE_DELAI_PLATEFORME_MS = ([\d\s*]+);/);
  expect(m, "la constante de duree du flux est introuvable").not.toBeNull();
  // eslint-disable-next-line no-eval -- expression arithmetique issue du depot
  return eval(m![1]) as number;
}

describe("la duree de vie du flux temps reel", () => {
  it("reste sous le delai de la plateforme", () => {
    const ms = dureeParDefautMs();
    expect(
      ms / 1000,
      `le flux se donne ${ms / 1000} s alors que Cloud Run coupe a ` +
        `${DELAI_PLATEFORME_S} s: la fermeture propre n'aura jamais lieu, et ` +
        "chaque onglet inactif rebranchera aussitot, maintenant une instance eveillee",
    ).toBeLessThan(DELAI_PLATEFORME_S);
  });

  it("garde une marge utile, pas une seconde", () => {
    // Une valeur collee au plafond serait perdue au premier ralentissement du
    // reseau: la coupure de la plateforme arriverait la premiere, et on
    // retrouverait le defaut sans que rien ne change dans le code.
    const ms = dureeParDefautMs();
    expect(DELAI_PLATEFORME_S - ms / 1000).toBeGreaterThanOrEqual(30);
  });

  it("laisse encore le temps de travailler", () => {
    // L'inverse est un defaut aussi: un flux coupe toutes les trente secondes
    // ferait reconnecter en permanence, ce qui reveillerait l'instance encore
    // plus souvent que le probleme d'origine.
    expect(dureeParDefautMs()).toBeGreaterThanOrEqual(120 * 1000);
  });

  it("ferme proprement, en demandant au navigateur d'attendre", () => {
    // La fermeture n'a de valeur que si elle porte le `retry`: sans lui, le
    // navigateur revient immediatement et on n'a rien gagne.
    expect(source).toContain('res.write("retry: 60000\\n")');
    expect(source).toMatch(/action: "reconnect"/);
  });
});
