/**
 * Le zero rendu par l'IA ne se fait pas remplacer par une valeur rassurante.
 *
 * `parsed.score || 50` : `0 || 50` vaut 50. La consigne donnee aux agents dit
 * pourtant, mot pour mot, « 0-30 si problemes critiques ». La note la PLUS
 * alarmante qu'un agent puisse rendre etait donc traduite en « moyen » avant
 * d'etre enregistree. Le tableau de bord affichait un bureau qui va
 * moyennement bien au moment ou l'agent venait de dire que rien ne va.
 *
 * Ce n'est pas un repli qui masque une panne : c'est un repli qui en fabrique
 * une, silencieuse, et toujours dans le sens qui rassure.
 *
 * Meme forme sur les echeances : `t.dueInDays || 3`. Une tache que l'IA veut
 * pour AUJOURD'HUI (0) repartait a trois jours. De tout ce que ce repli
 * pouvait effacer, il n'effacait que l'urgence.
 *
 * (Famille relevee par la session BTP-ULTRA le 24/09/2026 : chez elle,
 * « pas d'acompte » exprime par `acomptePct: 0` retombait sur 30 % et
 * emettait une facture d'acompte reelle — numerotee, portee au grand livre,
 * exigible — pendant que l'ecran annoncait qu'aucune facture n'avait ete
 * emise. Le zero n'etait pas refuse : il etait traduit en son contraire.)
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { delaiEnJours, nombreOuDefaut, noteAgent } from "../lib/valeur-ou-defaut";

const ROUTE = readFileSync(join(import.meta.dirname, "..", "routes", "ai-agents.ts"), "utf8");

describe("un zero traverse", () => {
  it("la note zero reste zero — c'est « tout va mal »", () => {
    expect(noteAgent(0)).toBe(0);
  });

  it("zero en chaine aussi : l'IA rend du JSON, pas des nombres garantis", () => {
    expect(noteAgent("0")).toBe(0);
  });

  it("une echeance de zero jour reste aujourd'hui", () => {
    expect(delaiEnJours(0)).toBe(0);
  });

  it("et un faux passe pour zero, pas pour le repli", () => {
    expect(nombreOuDefaut(false, 7)).toBe(0);
  });
});

describe("une absence prend le repli", () => {
  it("rien du tout", () => expect(noteAgent(undefined)).toBe(50));
  it("nul", () => expect(noteAgent(null)).toBe(50));
  it("chaine vide", () => expect(noteAgent("")).toBe(50));
  it("texte illisible", () => expect(noteAgent("indisponible")).toBe(50));
  it("NaN", () => expect(noteAgent(Number.NaN)).toBe(50));
  it("une echeance absente repart a trois jours", () => expect(delaiEnJours(undefined)).toBe(3));
});

describe("les bornes tiennent", () => {
  it("une note de 140 redescend a 100", () => expect(noteAgent(140)).toBe(100));
  it("une note negative remonte a 0, pas au repli", () => {
    // -5 est une reponse absurde, mais c'est une REPONSE : elle doit se lire
    // comme « au plus bas », pas comme « moyen ».
    expect(noteAgent(-5)).toBe(0);
  });
  it("une note decimale est arrondie, pas tronquee au repli", () => expect(noteAgent(72.6)).toBe(73));
  it("une echeance d'un siecle est bornee", () => expect(delaiEnJours(99_999)).toBe(365));
  it("une echeance negative ne remonte pas dans le passe", () => expect(delaiEnJours(-4)).toBe(0));
  it("sans bornes, la valeur passe telle quelle", () => expect(nombreOuDefaut(1234, 0)).toBe(1234));
});

describe("le defaut est bien celui qu'on croit", () => {
  it("le repli de note est modifiable et respecte", () => expect(noteAgent(undefined, 12)).toBe(12));
  it("le repli d'echeance aussi", () => expect(delaiEnJours(null, 9)).toBe(9));
});

describe("la route n'emploie plus la forme qui avale le zero", () => {
  it("plus aucun `parsed.score || 50`", () => {
    expect(ROUTE, "0 || 50 vaut 50 : la note critique devient « moyen »").not.toContain("parsed.score || 50");
  });

  it("plus aucun `t.dueInDays || 3`", () => {
    expect(ROUTE, "0 || 3 vaut 3 : « aujourd'hui » devient « dans trois jours »").not.toContain("t.dueInDays || 3");
  });

  it("les trois enregistrements de note passent par le garde", () => {
    // Trois agents ecrivent une note ; un seul oubli suffirait a laisser le
    // defaut en place pour l'un d'eux.
    expect(ROUTE.match(/score: noteAgent\(parsed\.score\)/g)?.length).toBe(3);
  });

  it("les deux creations de tache aussi", () => {
    expect(ROUTE.match(/delaiEnJours\(t\.dueInDays\)/g)?.length).toBe(2);
  });

  it("la consigne donnee a l'IA reserve bien 0-30 au critique", () => {
    // C'est elle qui rend le defaut grave : sans cette phrase, un zero ne
    // voudrait rien dire et le repli serait defendable.
    expect(ROUTE).toMatch(/0-30 si problemes critiques/);
  });
});

/*
 * COMPTER LES SITES, pas corriger celui qu'on a sous les yeux.
 *
 * La premiere passe a corrige trois notes et deux echeances. Il en restait
 * SIX — dont une, dans `call-processor.ts`, ou la valeur etait deja bornee
 * vingt lignes plus haut EN PRESERVANT le zero, avant qu'un
 * `|| 1` ne le rejette aussitot. Un mecanisme juste a un endroit et faux a
 * l'autre coute plus cher qu'un mecanisme faux partout : on croit le sujet
 * traite.
 *
 * (Methode rappelee par la session BTP-ULTRA le 24/09/2026, qui a trouve le
 * meme mecanisme sur NEUF sites chez elle — le delai de paiement, ou zero
 * jour veut dire « comptant » — dont deux dans le generateur de PDF : le
 * document contractuel envoye au client annoncait « 30 jours » quand
 * l'accord disait comptant.)
 */
describe("plus aucun site du mecanisme n'avale le zero", () => {
  const FICHIERS = [
    "routes/ai-agents.ts",
    "routes/ai-commandant.ts",
    "routes/meetings.ts",
    "services/call-processor.ts",
  ] as const;

  const source = (f: string) => readFileSync(join(import.meta.dirname, "..", f), "utf8");

  it("le releve lit bien les quatre fichiers", () => {
    // Un fichier deplace rendrait une source vide, et une source vide ne
    // contient aucune forme fautive : le controle passerait au vert.
    for (const f of FICHIERS) expect(source(f).length, `${f} vide`).toBeGreaterThan(1000);
  });

  it("aucun `dueInDays ||` ni `echeanceJours ||` ne subsiste", () => {
    const fautifs = FICHIERS.filter((f) => /(dueInDays|echeanceJours)\s*\|\|/.test(source(f)));
    expect(fautifs, "0 || defaut : « aujourd'hui » devient « dans N jours »").toEqual([]);
  });

  it("aucun delai n'est teste par sa seule verite", () => {
    // `task.dueInDays ? ... : defaut` est la meme faute ecrite autrement.
    const fautifs = FICHIERS.filter((f) => /(dueInDays|echeanceJours)\s*\?\s/.test(source(f)));
    expect(fautifs, "un zero est faux en JavaScript : il prendrait la branche du repli").toEqual([]);
  });

  it("ni par un `> 0` qui rejette le zero", () => {
    const fautifs = FICHIERS.filter((f) => /(dueInDays|echeanceJours)\s*>\s*0/.test(source(f)));
    expect(fautifs, "zero est un delai, pas une absence de delai").toEqual([]);
  });

  it("les onze sites passent par le garde commun", () => {
    // Onze, comptes un par un : TROIS notes (ai-agents) et HUIT echeances —
    // deux dans ai-agents, trois dans ai-commandant, une dans meetings, deux
    // dans call-processor. Le nombre est ecrit en dur pour qu'un douzieme
    // site, ajoute sans garde, fasse tomber ce controle plutot que de passer.
    //
    // J'avais d'abord ecrit huit, de tete. Le controle a rendu onze et c'est
    // lui qui avait raison : un nombre qu'on pose sans compter ne verifie
    // rien, il enregistre une croyance.
    const parFichier = FICHIERS.map((f) => [f, source(f).match(/\b(noteAgent|delaiEnJours)\(/g)?.length ?? 0] as const);
    expect(Object.fromEntries(parFichier), "un site du mecanisme est passe hors du garde").toEqual({
      "routes/ai-agents.ts": 5,
      "routes/ai-commandant.ts": 3,
      "routes/meetings.ts": 1,
      "services/call-processor.ts": 2,
    });
  });

  it("le plafond deja pose n'a pas ete elargi au passage", () => {
    // `call-processor` bornait a 90 jours : reprendre le garde sans lui
    // passer ce plafond l'aurait porte a 365, en silence.
    expect(source("services/call-processor.ts")).toMatch(/delaiEnJours\([^)]*,\s*1,\s*90\)/);
  });

  it("et le garde honore un plafond qu'on lui passe", () => {
    expect(delaiEnJours(200, 1, 90)).toBe(90);
    expect(delaiEnJours(45, 1, 90)).toBe(45);
    expect(delaiEnJours(0, 1, 90)).toBe(0);
  });
});
