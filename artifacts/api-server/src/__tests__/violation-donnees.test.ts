/**
 * Un engagement contractuel sans mecanisme.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * Le contrat de sous-traitance signe avec chaque client promet, noir sur
 * blanc (DPA, section 7) :
 *
 *   « Violation de donnees : l'editeur notifie le client dans les meilleurs
 *     delais et au plus tard soixante-douze (72) heures [...] les elements
 *     necessaires a sa propre notification a la CNIL. »
 *
 * Cote code : aucune table, aucun delai, aucune liste d'elements. Recherche
 * dans tout le depot — « article 33 » : zero occurrence. Les trois fichiers
 * contenant « violation de donnees » concernent le diagnostic de poste et un
 * test d'export.
 *
 * Une phrase engage, et rien ne la tient. C'est exactement la forme de la
 * politique de conservation qui annoncait douze mois sans qu'aucun traitement
 * ne l'applique — corrigee depuis, pour la meme raison.
 *
 * LE PIEGE DES 72 HEURES, QUI EST LE COEUR DE CE MODULE
 *
 * Le contrat autorise l'editeur a notifier jusqu'a 72 heures. Or le CLIENT
 * dispose lui aussi de 72 heures pour notifier la CNIL, a compter de SA prise
 * de connaissance — c'est-a-dire de notre notification.
 *
 * Le prevenir a la 71e heure serait contractuellement conforme et pratiquement
 * inutile : il lui resterait le temps de lire le message. La CNIL et le CEPD
 * attendent du sous-traitant une notification sous 24 a 48 heures, pour cette
 * raison precise.
 *
 * La cible interne est donc a 24 heures, et les 72 heures contractuelles sont
 * traitees comme ce qu'elles sont : une limite a ne pas atteindre.
 *
 * Le module ne modifie pas le contrat — ce n'est pas une decision technique.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import {
  CIBLE_NOTIFICATION_H,
  DELAI_CNIL_H,
  ELEMENTS_REQUIS,
  MAXIMUM_CONTRACTUEL_H,
  echeanceCnilDuClient,
  etatViolation,
} from "../services/violation-donnees";

const DECOUVERTE = "2026-09-10T08:00:00.000Z";
const H = 3_600_000;
const plus = (h: number) => new Date(new Date(DECOUVERTE).getTime() + h * H);

/** Violation documentee de bout en bout, pour isoler ce qu'on teste. */
const COMPLETE = {
  decouverteLe: DECOUVERTE,
  nature: "Acces non autorise a la base de donnees d'une organisation.",
  personnesConcernees: "Environ 400 contacts clients.",
  consequences: "Divulgation de noms, adresses et numeros de telephone.",
  mesures: "Acces revoque, mots de passe reinitialises, journalisation renforcee.",
};

describe("les delais retenus", () => {
  it("les trois valeurs sont celles du droit et du contrat", () => {
    // Les chiffres SONT la regle: 48 h de cible serait une autre decision.
    expect(CIBLE_NOTIFICATION_H).toBe(24);
    expect(MAXIMUM_CONTRACTUEL_H).toBe(72);
    expect(DELAI_CNIL_H).toBe(72);
  });

  it("la cible est calculee depuis la PRISE DE CONNAISSANCE", () => {
    // Pas depuis la survenance: une violation ancienne decouverte hier ouvre
    // les delais a partir d'hier (art. 33.1).
    const e = etatViolation(COMPLETE, plus(1));
    expect(e.cible.toISOString()).toBe(plus(24).toISOString());
    expect(e.limiteContractuelle.toISOString()).toBe(plus(72).toISOString());
  });

  it("une date de decouverte absente fait echouer plutot qu'inventer", () => {
    // Afficher une echeance calculee depuis rien serait pire que refuser: le
    // retard EST le manquement, et une fausse echeance le masque.
    expect(() => etatViolation({ ...COMPLETE, decouverteLe: "" })).toThrow();
    expect(() => etatViolation({ ...COMPLETE, decouverteLe: "pas-une-date" })).toThrow();
  });
});

describe("la cible de 24 heures", () => {
  it("a 23 heures, rien n'est signale", () => {
    const e = etatViolation(COMPLETE, plus(23));
    expect(e.cibleDepassee).toBe(false);
    expect(e.avertissements).toEqual([]);
  });

  it("a 25 heures, la cible est depassee et l'enjeu est nomme", () => {
    const e = etatViolation(COMPLETE, plus(25));
    expect(e.cibleDepassee).toBe(true);
    expect(e.avertissements.join(" ")).toMatch(/retiree des 72 heures/i);
  });

  it("le depassement rappelle qu'un motif est exige", () => {
    // L'article 33.1 impose les motifs du retard. Les ecrire apres coup n'a
    // pas la meme valeur que les consigner au moment ou il se produit.
    const e = etatViolation(COMPLETE, plus(25));
    expect(e.avertissements.join(" ")).toMatch(/motif du retard/i);
  });

  it("un motif renseigne fait taire ce reproche-la, pas les autres", () => {
    const e = etatViolation({ ...COMPLETE, motifRetard: "Investigation en cours." }, plus(25));
    expect(e.avertissements.join(" ")).not.toMatch(/motif du retard/i);
    expect(e.avertissements.join(" ")).toMatch(/cible de 24 h/i);
  });
});

describe("la limite contractuelle de 72 heures", () => {
  it("son depassement dit que le client ne peut plus tenir SES delais", () => {
    // C'est la consequence reelle, et elle n'est pas contractuelle mais
    // reglementaire: son compteur envers la CNIL n'a meme pas demarre.
    const e = etatViolation(COMPLETE, plus(80));
    expect(e.limiteDepassee).toBe(true);
    expect(e.avertissements.join(" ")).toMatch(/ne peut plus tenir/i);
  });

  it("a 72 heures pile, la limite n'est pas encore depassee", () => {
    const e = etatViolation(COMPLETE, plus(72));
    expect(e.limiteDepassee).toBe(false);
  });

  it("un seul avertissement de delai, pas deux", () => {
    // Au-dela de 72 h la cible est aussi depassee: afficher les deux dirait
    // deux fois la meme chose et diluerait le plus grave.
    const e = etatViolation(COMPLETE, plus(80));
    const delais = e.avertissements.filter((a) => /heures|cible/i.test(a));
    expect(delais).toHaveLength(1);
  });
});

describe("une fois le client notifie, le compteur s'arrete", () => {
  it("le temps se compte jusqu'a la notification, pas jusqu'a maintenant", () => {
    // Sinon un retard tenu afficherait un retard qui grandit indefiniment.
    const e = etatViolation({ ...COMPLETE, clientNotifieLe: plus(10).toISOString() }, plus(200));
    expect(e.notifie).toBe(true);
    expect(Math.round(e.heuresEcoulees)).toBe(10);
    expect(e.cibleDepassee).toBe(false);
  });

  it("une notification tardive reste marquee comme tardive", () => {
    const e = etatViolation({ ...COMPLETE, clientNotifieLe: plus(40).toISOString() }, plus(200));
    expect(e.cibleDepassee).toBe(true);
    expect(e.limiteDepassee).toBe(false);
  });

  it("notifie, aucun reproche de delai n'est adresse", () => {
    // Les avertissements de delai visent l'inaction; une fois le client
    // prevenu, ils n'ont plus d'objet.
    const e = etatViolation({ ...COMPLETE, clientNotifieLe: plus(40).toISOString(), motifRetard: "x" }, plus(200));
    expect(e.avertissements.join(" ")).not.toMatch(/n'a pas ete prevenu/i);
  });
});

describe("les quatre elements de l'article 33.3", () => {
  it("les quatre sont exiges", () => {
    expect(ELEMENTS_REQUIS).toHaveLength(4);
  });

  it("une violation complete n'en manque aucun", () => {
    expect(etatViolation(COMPLETE, plus(1)).elementsManquants).toEqual([]);
  });

  it("chaque element absent est nomme", () => {
    // « Il manque des elements » n'aide personne: il faut dire lesquels.
    const e = etatViolation({ decouverteLe: DECOUVERTE }, plus(1));
    expect(e.elementsManquants).toHaveLength(4);
    expect(e.elementsManquants.join(" ")).toMatch(/consequences probables/i);
  });

  it("un champ rempli d'espaces ne compte pas comme rempli", () => {
    // C'est la maniere la plus courante de passer un controle de presence
    // sans rien avoir renseigne.
    const e = etatViolation({ ...COMPLETE, mesures: "   " }, plus(1));
    expect(e.elementsManquants).toHaveLength(1);
  });

  it("l'incompletude est signalee comme un manquement DISTINCT du retard", () => {
    const e = etatViolation({ decouverteLe: DECOUVERTE }, plus(1));
    expect(e.avertissements.join(" ")).toMatch(/manquement distinct/i);
  });
});

describe("l'echeance du client envers la CNIL", () => {
  it("elle court a partir de NOTRE notification, pas de notre decouverte", () => {
    // C'est sa prise de connaissance a lui qui compte (art. 33.1). La calculer
    // depuis notre decouverte lui donnerait une echeance deja passee.
    const d = echeanceCnilDuClient({ ...COMPLETE, clientNotifieLe: plus(10).toISOString() });
    expect(d?.toISOString()).toBe(plus(82).toISOString());
  });

  it("tant que le client n'est pas prevenu, son delai n'a pas commence", () => {
    expect(echeanceCnilDuClient(COMPLETE)).toBeNull();
  });

  it("une date de notification illisible ne produit pas d'echeance inventee", () => {
    expect(echeanceCnilDuClient({ ...COMPLETE, clientNotifieLe: "n'importe quoi" })).toBeNull();
  });
});

describe("le registre est branche, et refuse ce qui serait incomplet", () => {
  async function source(): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(import.meta.dirname, "..", "routes", "data-protection.ts"), "utf8");
  }

  it("les trois routes existent", async () => {
    // Un module de delais que rien n'appelle ne tient aucune promesse: c'est
    // le mode de panne recurrent de ce depot.
    const s = await source();
    expect(s).toContain('router.post("/data-protection/violations"');
    expect(s).toContain('router.get("/data-protection/violations"');
    expect(s).toContain('router.post("/data-protection/violations/:id/notifier"');
  });

  it("consigner une notification INCOMPLETE est refuse", async () => {
    // Une notification amputee d'un des quatre elements du 33.3 est un
    // manquement distinct du retard. Laisser cocher « client notifie » sur un
    // dossier incomplet ferait croire l'obligation tenue.
    const s = await source();
    const i = s.indexOf("if (etat.elementsManquants.length > 0)");
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 300)).toContain("status(409)");
  });

  it("un retard sans motif est refuse", async () => {
    const s = await source();
    const i = s.indexOf("if (etat.cibleDepassee && !motifRetard)");
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 250)).toContain("33.1");
  });

  it("l'etat est calcule a la lecture, jamais stocke", async () => {
    // Un etat fige afficherait « dans les delais » sur une violation qui ne
    // l'est plus depuis des heures.
    const s = await source();
    expect(s).toContain("etat: etatViolation(v)");
    const i = s.indexOf("etat: etatViolation(v)");
    expect(s.slice(Math.max(0, i - 400), i)).not.toContain("db.update(violationsDonneesTable)");
  });

  it("le registre est borne a l'organisation de la session", async () => {
    // Une violation touchant un locataire ne doit pas apparaitre chez un
    // autre: ce serait une seconde violation.
    const s = await source();
    const i = s.indexOf('router.get("/data-protection/violations"');
    const bloc = s.slice(i, i + 700);
    expect(bloc).toContain("eq(violationsDonneesTable.organisationId, orgId)");
  });

  it("le registre est reserve aux administrateurs", async () => {
    const s = await source();
    const i = s.indexOf('router.post("/data-protection/violations"');
    expect(s.slice(i, i + 160)).toContain('requireRole("super_admin", "administrateur")');
  });
});
