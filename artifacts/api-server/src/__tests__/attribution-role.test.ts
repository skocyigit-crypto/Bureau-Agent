/**
 * A qui une IA adresse le travail qu'elle propose.
 *
 * Une tache creee par une machine et attribuee a personne n'est pas une tache:
 * c'est une ligne de plus dans une liste que tout le monde regarde et que
 * personne ne prend. Ces tests verrouillent les trois regles qui evitent cela.
 */
import { describe, expect, it } from "vitest";

import { attribuer, nomAffichable, type Membre } from "../services/attribution-role";

const m = (id: number, role: string, actif = true, prenom = "P", nom = "N"): Membre =>
  ({ id, role, actif, prenom, nom });

/** Une TPE typique du batiment: un patron, deux agents, un compte consultatif. */
const equipe: Membre[] = [
  m(1, "administrateur", true, "Sophie", "Martin"),
  m(2, "agent", true, "Karim", "Belkacem"),
  m(3, "agent", true, "Luc", "Perrin"),
  m(4, "lecture_seule", true, "Expert", "Comptable"),
];

describe("le role decide", () => {
  it("envoie le travail comptable au comptable quand il existe", () => {
    const avecComptable = [...equipe, m(5, "comptable", true, "Anne", "Roy")];
    const a = attribuer("comptabilite", avecComptable);
    expect(a.membre?.id).toBe(5);
    expect(a.roleRetenu).toBe("comptable");
    expect(a.parDefaut).toBe(false);
  });

  it("envoie le travail de terrain au technicien plutot qu'au patron", () => {
    const avecTechnicien = [...equipe, m(6, "technicien", true, "Yanis", "Roche")];
    expect(attribuer("terrain", avecTechnicien).membre?.id).toBe(6);
  });

  it("garde les decisions pour la direction", () => {
    const a = attribuer("direction", equipe);
    expect(a.roleRetenu).toBe("administrateur");
    expect(a.membre?.id).toBe(1);
  });
});

describe("quand le role vise n'existe pas", () => {
  it("remonte vers la direction plutot que de descendre", () => {
    // Beaucoup de TPE n'ont pas de comptable. Une tache mal attribuee vers le
    // haut est redistribuee; vers le bas, elle est ignoree.
    const a = attribuer("comptabilite", equipe);
    expect(a.membre?.id).toBe(1);
    expect(a.roleRetenu).toBe("administrateur");
    expect(a.parDefaut, "le repli doit se voir, pour pouvoir etre dit").toBe(true);
  });

  it("signale le repli meme quand le destinataire est correct", () => {
    // `parDefaut` n'est pas « on s'est trompe »: c'est « ce n'etait pas le
    // premier choix ». L'interface peut alors ecrire « faute de comptable »
    // plutot que de laisser croire a une attribution deliberee.
    const a = attribuer("terrain", equipe);
    expect(a.membre?.role).toBe("agent");
    expect(a.parDefaut).toBe(true);
  });
});

describe("a qui on n'attribue jamais", () => {
  it("ignore les comptes en lecture seule", () => {
    // Leur donner du travail, c'est le perdre: ils ne peuvent rien changer.
    const seulementLecture = [m(4, "lecture_seule")];
    const a = attribuer("administratif", seulementLecture);
    expect(a.membre).toBeNull();
  });

  it("ignore les comptes desactives", () => {
    const partis = [m(1, "administrateur", false)];
    expect(attribuer("direction", partis).membre).toBeNull();
  });

  it("evite la personne a l'origine du declencheur quand on le demande", () => {
    // L'IA depouille le courriel de Karim: lui renvoyer une tache sur son
    // propre courriel ne lui apprend rien.
    const a = attribuer("administratif", equipe, { eviter: 2 });
    expect(a.membre?.id).toBe(3);
  });

  it("rend null plutot que d'inventer un destinataire", () => {
    // Une organisation vide, ou dont tout le monde est parti. Mieux vaut une
    // tache sans assignataire, visible comme telle, qu'une attribution fausse.
    expect(attribuer("comptabilite", []).membre).toBeNull();
    expect(attribuer("comptabilite", []).roleRetenu).toBeNull();
  });
});

describe("stabilite du choix", () => {
  it("choisit toujours le meme membre a role egal", () => {
    // Une attribution qui change a chaque execution detruit la confiance dans
    // l'outil: la meme situation doit produire le meme responsable.
    const melange = [m(3, "agent"), m(2, "agent"), m(1, "administrateur")];
    const a1 = attribuer("administratif", melange);
    const a2 = attribuer("administratif", [...melange].reverse());
    expect(a1.membre?.id).toBe(a2.membre?.id);
    expect(a1.membre?.id).toBe(2);
  });
});

describe("nom affichable", () => {
  it("compose prenom et nom, et retombe sur l'identifiant", () => {
    expect(nomAffichable(m(7, "agent", true, "Marie", "Durand"))).toBe("Marie Durand");
    expect(nomAffichable({ id: 9, role: "agent", actif: true })).toBe("9");
  });
});
