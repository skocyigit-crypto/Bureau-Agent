/**
 * Quelle langue parle l'assistant vocal, et pourquoi.
 *
 * Le defaut signale par l'exploitant: « des mots turcs apparaissent alors que
 * l'application est en francais ». La bibliotheque d'actions de l'assistant, ses
 * salutations et ses messages d'erreur existent en trois langues, correctement
 * rangees sous les cles `fr`, `tr` et `en`. Le contenu n'etait donc pas en
 * cause: c'est le CHOIX de la branche qui l'etait.
 *
 * La langue de depart se lisait sur `navigator.language` — la langue du
 * NAVIGATEUR — sans jamais consulter celle choisie dans l'application. Un
 * utilisateur dont le systeme est en turc et qui a mis l'application en
 * francais obtenait donc un assistant turc au milieu d'une interface
 * francaise. Pire, le defaut se figeait: la valeur deduite au premier rendu
 * etait aussitot ecrite dans le stockage local, et l'assistant cessait
 * definitivement de suivre l'application.
 *
 * L'ordre teste ici est celui de l'intention: un choix explicite fait dans le
 * selecteur de l'assistant l'emporte — on peut vouloir dicter dans une autre
 * langue que celle de son ecran — sinon on suit l'application.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { langueDeDepart } from "./VoiceAssistant";

const CLE = "buro.voiceLang";

beforeEach(() => {
  localStorage.clear();
});

describe("langue de depart de l'assistant vocal", () => {
  it("suit l'application, pas le navigateur", () => {
    // Le cas signale: navigateur turc, application francaise.
    Object.defineProperty(window.navigator, "language", {
      value: "tr-TR",
      configurable: true,
    });
    expect(langueDeDepart("fr")).toBe("fr");
  });

  it("parle turc quand l'application est en turc", () => {
    expect(langueDeDepart("tr")).toBe("tr");
  });

  it("respecte un choix explicite fait dans l'assistant", () => {
    // Quelqu'un peut vouloir dicter en turc avec une interface francaise.
    // C'est une intention, elle prime.
    localStorage.setItem(CLE, "tr");
    expect(langueDeDepart("fr")).toBe("tr");
  });

  it("retombe sur le francais pour les langues que l'assistant ne parle pas", () => {
    // L'application gere six langues, l'assistant trois. Renvoyer « es » ferait
    // chercher une branche qui n'existe pas.
    for (const langue of ["es", "de", "ar"]) {
      expect(langueDeDepart(langue), `langue ${langue}`).toBe("fr");
    }
  });

  it("ignore une valeur stockee qui n'est pas une langue de l'assistant", () => {
    // Une cle corrompue, ou ecrite par une version anterieure, ne doit pas
    // faire chercher une branche absente.
    localStorage.setItem(CLE, "es");
    expect(langueDeDepart("fr")).toBe("fr");
  });
});
