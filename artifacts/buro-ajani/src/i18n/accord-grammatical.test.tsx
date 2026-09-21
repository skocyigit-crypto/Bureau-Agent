/**
 * L'accord grammatical d'un libelle compte-t-il vraiment? Oui, et pas
 * seulement en francais.
 *
 * Le declencheur: la vue « mois » du calendrier affichait « +2 » quand une
 * journee debordait. Ni ce qui etait cache, ni combien, ni qu'on pouvait le
 * voir — et « +2 » ne se prononce pas du tout pour un lecteur d'ecran.
 *
 * En corrigeant, la tentation etait d'ecrire `n > 1 ? "autres" : "autre"` dans
 * le composant. C'est juste en francais et faux dans cinq des six langues
 * livrees:
 *
 *     francais   0 -> singulier  (« 0 autre »)
 *     anglais    0 -> pluriel    (« 0 more »)
 *     arabe      SIX formes, dont une propre au duel (exactement 2)
 *     turc       pas d'accord du nom apres un nombre
 *
 * Une faute de ce genre ne casse rien, ne leve aucune erreur, et se lit
 * pourtant a chaque ouverture de l'ecran. D'ou `Intl.PluralRules`, qui est
 * dans le navigateur et connait ces regles mieux que nous.
 *
 * Ces tests portent sur la MECANIQUE de selection, pas sur la qualite des
 * traductions: ils verifient qu'on demande la bonne forme, et qu'une cle sans
 * accord continue de fonctionner comme avant.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider, categoriePlurielle, useTranslation } from "./index";

afterEach(() => cleanup());

function Libelle({ cle, count }: { cle: string; count?: number }) {
  const { t } = useTranslation();
  return <span data-testid="libelle">{count === undefined ? t(cle) : t(cle, { count })}</span>;
}

function rendu(cle: string, count?: number) {
  // Nettoyer AVANT chaque rendu, et pas seulement entre les tests: un test qui
  // compare deux nombres rend deux fois, et `getByTestId` echouait alors sur
  // « found multiple elements » — un echec qui ressemble a un defaut de
  // traduction alors qu'il vient du harnais.
  cleanup();
  render(
    <I18nProvider>
      <Libelle cle={cle} count={count} />
    </I18nProvider>,
  );
  return screen.getByTestId("libelle").textContent ?? "";
}

describe("la forme choisie suit le nombre", () => {
  it("un seul evenement cache donne le singulier", () => {
    expect(rendu("calendar.density.more", 1)).toContain("autre");
    expect(rendu("calendar.density.more", 1)).not.toContain("autres");
  });

  it("plusieurs evenements donnent le pluriel", () => {
    expect(rendu("calendar.density.more", 4)).toContain("autres");
  });

  it("zero suit la regle francaise, pas la regle anglaise", () => {
    // Piege classique d'un `n > 1`: il donnerait « autres » a zero, ce qui est
    // correct en anglais et faux en francais. Le detail parait mince; il est
    // exactement ce que `Intl.PluralRules` sait et que nous ne savons pas.
    const texte = rendu("calendar.density.more", 0);
    expect(texte).toContain("autre");
    expect(texte).not.toContain("autres");
  });

  it("le nombre est bien insere dans le libelle", () => {
    // Un accord parfait sur un libelle qui n'affiche pas le nombre ne sert a
    // rien.
    expect(rendu("calendar.density.more", 7)).toContain("7");
  });
});

describe("les regles ne sont pas celles du francais recopiees", () => {
  // CES TESTS EXISTENT PARCE QUE LES PRECEDENTS NE PROUVAIENT RIEN.
  //
  // Mesure par mutation: en remplacant `Intl.PluralRules` par un naif
  // `count > 1 ? "other" : "one"`, les onze tests au-dessus restaient VERTS.
  // Normal — en francais, les deux regles coincident sur 0, 1 et 4, qui
  // etaient les seuls nombres testes. Une suite qui n'exerce qu'une langue ne
  // peut pas demontrer qu'un mecanisme multilingue sert a quelque chose.
  //
  // Les cas ci-dessous sont precisement ceux ou le naif se trompe.

  it("l'anglais met zero au pluriel, le francais au singulier", () => {
    // `count > 1` donnerait « one » pour zero en anglais: « 0 more event ».
    expect(categoriePlurielle("en", 0)).toBe("other");
    expect(categoriePlurielle("fr", 0)).toBe("one");
  });

  it("l'arabe distingue le duel", () => {
    // Aucune regle a deux branches ne peut produire cela.
    expect(categoriePlurielle("ar", 2)).toBe("two");
    expect(categoriePlurielle("ar", 3)).toBe("few");
    expect(categoriePlurielle("ar", 11)).toBe("many");
  });

  it("le francais a une forme au-dela du pluriel ordinaire", () => {
    expect(categoriePlurielle("fr", 1000000)).toBe("many");
  });

  it("une categorie sans libelle retombe sur « other »", () => {
    // Suite du cas precedent: `more_many` n'existe pas en francais, et ne doit
    // pas exister — la forme est la meme. Sans ce repli, un compteur eleve
    // afficherait la cle brute a l'ecran.
    //
    // Mesure par mutation: en retirant ce repli, les onze premiers tests
    // restaient verts eux aussi.
    expect(rendu("calendar.density.more", 1000000)).toContain("autres");
    expect(rendu("calendar.density.more", 1000000)).not.toContain("density");
  });

  it("un code de langue invalide ne fait pas tomber le libelle", () => {
    // Un code errone ne doit jamais vider un ecran: `Intl.PluralRules` leve
    // une `RangeError` sur une etiquette mal formee, et une exception ici
    // remonterait jusqu'au rendu.
    //
    // Le choix des valeurs a son importance, et une premiere version s'est
    // trompee: « zz-XX-invalide » ne leve RIEN — c'est une etiquette
    // syntaxiquement valable, simplement inconnue. Le test passait donc sans
    // jamais emprunter le chemin qu'il pretendait couvrir. Les valeurs
    // ci-dessous levent reellement.
    for (const mauvais of ["fr_FR", "***", "", "x"]) {
      expect(() => categoriePlurielle(mauvais, 2), `« ${mauvais} » a jete`).not.toThrow();
      expect(categoriePlurielle(mauvais, 2)).toBe("other");
      expect(categoriePlurielle(mauvais, 1)).toBe("one");
    }
  });
});

describe("la phrase destinee aux lecteurs d'ecran", () => {
  it("existe et n'est pas le simple signe plus", () => {
    // « +2 » ne se prononce pas. C'est la raison d'etre de cette seconde cle,
    // et une obligation d'accessibilite, pas un confort.
    const texte = rendu("calendar.density.hidden", 2);
    expect(texte).not.toBe("+2");
    expect(texte.length).toBeGreaterThan(10);
    expect(texte).toContain("2");
  });

  it("s'accorde elle aussi", () => {
    expect(rendu("calendar.density.hidden", 1)).toContain("evenement");
    expect(rendu("calendar.density.hidden", 3)).toContain("evenements");
  });
});

describe("ce qui ne doit pas changer", () => {
  it("une cle sans accord fonctionne toujours", () => {
    // La quasi-totalite des libelles de l'application n'a pas de forme
    // flechie. Le mecanisme ne doit rien leur imposer.
    expect(rendu("calendar.today")).toBe("Aujourd'hui");
  });

  it("une cle sans accord accepte quand meme un nombre", () => {
    // Sinon, ajouter `count` a un libelle existant le ferait disparaitre.
    expect(rendu("calendar.today", 3)).toBe("Aujourd'hui");
  });

  it("une cle absente reste visible telle quelle", () => {
    // Repli volontaire: un trou de traduction doit se voir a l'ecran plutot
    // que de produire un libelle vide que personne ne remarque.
    expect(rendu("calendar.density.cle_qui_n_existe_pas", 2)).toContain(
      "cle_qui_n_existe_pas",
    );
  });

  it("l'interpolation ordinaire n'est pas affectee", () => {
    expect(rendu("calendar.closure.closed")).toBe("Fermé");
  });
});

describe("les six langues livrees ont la forme « other »", () => {
  it("aucune cle de densite n'est incomplete", async () => {
    // `other` est la seule categorie que toutes les langues possedent: c'est
    // le repli final. Une langue qui ne l'aurait pas afficherait la cle brute
    // a l'ecran, dans cette langue seulement — le genre de defaut qu'on ne
    // voit jamais depuis un poste configure en francais.
    const langues = ["fr", "en", "tr", "de", "es", "ar"];
    for (const lang of langues) {
      const dict = (await import(`./locales/${lang}.json`)).default as any;
      expect(dict.calendar?.density?.more_other, `${lang}: more_other manquant`).toBeTruthy();
      expect(dict.calendar?.density?.hidden_other, `${lang}: hidden_other manquant`).toBeTruthy();
      expect(
        String(dict.calendar.density.more_other),
        `${lang}: le nombre n'apparait pas dans le libelle`,
      ).toContain("{{count}}");
    }
    // Parcourt toutes les sources et six catalogues : meme raison.
  }, 30_000);
});
