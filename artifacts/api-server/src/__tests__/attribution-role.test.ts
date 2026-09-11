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
  it("garde la comptabilite pour la direction", () => {
    // Le produit ne sait pas creer de role « comptable »: une relance de
    // facture va donc a l'administrateur, et c'est le bon destinataire.
    const a = attribuer("comptabilite", equipe);
    expect(a.membre?.id).toBe(1);
    expect(a.roleRetenu).toBe("administrateur");
    expect(a.parDefaut, "c'est le premier choix, pas un repli").toBe(false);
  });

  it("envoie le travail de terrain a l'agent plutot qu'au patron", () => {
    const a = attribuer("terrain", equipe);
    expect(a.membre?.role).toBe("agent");
    expect(a.parDefaut).toBe(false);
  });

  it("garde les decisions pour la direction", () => {
    const a = attribuer("direction", equipe);
    expect(a.roleRetenu).toBe("administrateur");
    expect(a.membre?.id).toBe(1);
  });
});

describe("quand le role vise n'existe pas", () => {
  it("remonte vers la direction plutot que de descendre", () => {
    // Beaucoup de TPE n'ont qu'un patron. Une tache mal attribuee vers le
    // haut est redistribuee; vers le bas, elle est ignoree.
    const sansAgent = equipe.filter((x) => x.role !== "agent");
    const a = attribuer("terrain", sansAgent);
    expect(a.roleRetenu).toBe("administrateur");
    expect(a.parDefaut, "le repli doit se voir, pour pouvoir etre dit").toBe(true);
  });

  it("ne signale un repli que lorsqu'il y en a vraiment un", () => {
    // `parDefaut` declenche une phrase d'excuse dans la description de la
    // tache. Tant que les preferences nommaient des roles que le produit ne
    // sait pas creer, cette phrase apparaissait sur trois natures sur cinq,
    // en permanence — une excuse permanente se lit comme une panne.
    for (const nature of ["comptabilite", "commercial", "terrain", "administratif", "direction"] as const) {
      expect(attribuer(nature, equipe).parDefaut, `${nature} ne devrait pas etre un repli`).toBe(false);
    }
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
