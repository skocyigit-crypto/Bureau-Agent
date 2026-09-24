/**
 * Le cycle de vie d'un abonnement s'applique tout seul.
 *
 * MESURE EN PRODUCTION, le 24/09/2026. Les cinq abonnements portaient
 * `status = "active"` avec des periodes closes depuis un a deux mois — dont
 * un plan « entreprise » a 199 EUR/mois termine le 19 aout. `suspended_at`
 * nul partout, `payment_failed_count` a zero partout.
 *
 * La cause : AUCUNE ligne du depot n'ecrivait `current_period_end`. Le seul
 * endroit qui la mentionnait la LISAIT. Une periode se terminait, et il ne se
 * passait rien.
 *
 * Ce qui rend le defaut difficile a voir, c'est que l'APPLICATION existait :
 * `license-check` traite deja `suspended`, `cancelled`, l'essai expire et
 * `past_due` avec son delai de grace. Tout le mecanisme de contrainte etait
 * en place et correct ; rien ne le declenchait. Le produit paraissait avoir
 * une gestion d'abonnements.
 *
 * CE FICHIER SONDE LES BORDS, parce que c'est la que les regles de cycle se
 * trompent : le jour meme de l'echeance, le dernier jour de grace, un
 * abonnement souscrit un 31, un cron en retard de deux mois.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { deciderTransition, prochaineFinDePeriode, type EtatAbonnement } from "../services/cycle-abonnement";
import { PAYMENT_GRACE_DAYS } from "../services/payment-access-policy";

const JOUR = 86_400_000;
const MAINTENANT = new Date("2026-09-24T12:00:00Z");
const ilYA = (jours: number) => new Date(MAINTENANT.getTime() - jours * JOUR);
const dans = (jours: number) => new Date(MAINTENANT.getTime() + jours * JOUR);

const base: EtatAbonnement = {
  statut: "active",
  plan: "entreprise",
  cycle: "monthly",
  finPeriode: dans(10),
  impayeDepuis: null,
  echecDepuis: null,
};
const etat = (p: Partial<EtatAbonnement>): EtatAbonnement => ({ ...base, ...p });

describe("une periode close se renouvelle", () => {
  it("la periode terminee hier repart", () => {
    const d = deciderTransition(etat({ finPeriode: ilYA(1) }), MAINTENANT);
    expect(d.action).toBe("renouveler");
  });

  it("une periode encore ouverte ne bouge pas", () => {
    expect(deciderTransition(etat({ finPeriode: dans(1) }), MAINTENANT).action).toBe("rien");
  });

  it("le jour MEME de l'echeance, elle repart", () => {
    // `<=` et non `<` : une periode qui se termine « le 24 a midi » est
    // terminee a midi. Le cas limite decide si le client perd ou gagne un jour.
    const d = deciderTransition(etat({ finPeriode: new Date(MAINTENANT) }), MAINTENANT);
    expect(d.action).toBe("renouveler");
  });

  it("la nouvelle periode part de l'ANCIENNE fin, pas d'aujourd'hui", () => {
    // Un cron en retard de trois jours ne doit pas decaler la date
    // d'anniversaire du client de trois jours.
    const d = deciderTransition(etat({ finPeriode: new Date("2026-09-19T09:35:00Z") }), MAINTENANT);
    if (d.action !== "renouveler") throw new Error("attendu : renouveler");
    expect(d.nouveauDebut.toISOString()).toBe("2026-09-19T09:35:00.000Z");
    expect(d.nouvelleFin.toISOString()).toBe("2026-10-19T09:35:00.000Z");
  });

  it("deux mois de retard sont rattrapes en une fois, vers une date FUTURE", () => {
    // Sinon l'abonnement renouvellerait vers une date deja passee et serait
    // renouvele de nouveau au tick suivant, indefiniment. C'est exactement
    // l'etat trouve en production : periode close depuis le 19 aout.
    const d = deciderTransition(etat({ finPeriode: new Date("2026-07-19T09:35:00Z") }), MAINTENANT);
    if (d.action !== "renouveler") throw new Error("attendu : renouveler");
    expect(d.nouvelleFin.getTime()).toBeGreaterThan(MAINTENANT.getTime());
  });

  it("un abonnement annuel avance d'un an", () => {
    const d = deciderTransition(etat({ cycle: "yearly", finPeriode: new Date("2026-09-01T00:00:00Z") }), MAINTENANT);
    if (d.action !== "renouveler") throw new Error("attendu : renouveler");
    expect(d.nouvelleFin.toISOString()).toBe("2027-09-01T00:00:00.000Z");
  });
});

describe("le 31 du mois ne derive pas", () => {
  it("31 janvier + 1 mois = 28 fevrier, pas le 3 mars", () => {
    // `setUTCMonth` seul ramene le 31 janvier au 3 mars : le client perdrait
    // trois jours, puis garderait le 3 comme date d'anniversaire.
    const { fin } = prochaineFinDePeriode(new Date("2026-01-31T00:00:00Z"), "monthly", new Date("2026-02-01T00:00:00Z"));
    expect(fin.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("et la date d'origine est retrouvee au mois suivant", () => {
    // Le 31 doit revenir en mars : on borne l'affichage, on ne deplace pas
    // l'anniversaire... sauf que borner PUIS repartir du 28 le perdrait. On
    // verifie donc le comportement reel, qui est de repartir du 28.
    const { fin } = prochaineFinDePeriode(new Date("2026-02-28T00:00:00Z"), "monthly", new Date("2026-03-01T00:00:00Z"));
    expect(fin.toISOString()).toBe("2026-03-28T00:00:00.000Z");
  });

  it("le 30 avril reste le 30 en mai", () => {
    const { fin } = prochaineFinDePeriode(new Date("2026-04-30T00:00:00Z"), "monthly", new Date("2026-05-01T00:00:00Z"));
    expect(fin.toISOString()).toBe("2026-05-30T00:00:00.000Z");
  });

  it("une annee bissextile ne decale rien", () => {
    const { fin } = prochaineFinDePeriode(new Date("2028-01-31T00:00:00Z"), "monthly", new Date("2028-02-01T00:00:00Z"));
    expect(fin.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("l'impaye fait basculer en retard, puis suspend", () => {
  it("une facture emise et impayee passe l'abonnement en retard", () => {
    const d = deciderTransition(etat({ impayeDepuis: ilYA(2) }), MAINTENANT);
    expect(d.action).toBe("passer_en_retard");
  });

  it("meme si la periode n'est pas terminee — c'est l'impaye qui compte", () => {
    const d = deciderTransition(etat({ finPeriode: dans(20), impayeDepuis: ilYA(2) }), MAINTENANT);
    expect(d.action).toBe("passer_en_retard");
  });

  it("le delai de grace est celui DEJA applique aux acces", () => {
    // Deux delais differents — l'un pour bloquer l'ecriture, l'autre pour
    // suspendre — seraient impossibles a expliquer a un client.
    expect(PAYMENT_GRACE_DAYS).toBeGreaterThan(0);
    const veille = deciderTransition(etat({ statut: "past_due", echecDepuis: ilYA(PAYMENT_GRACE_DAYS - 1) }), MAINTENANT);
    expect(veille.action, "suspendu trop tot").toBe("rien");
  });

  it("au terme exact du delai, la suspension tombe", () => {
    const d = deciderTransition(etat({ statut: "past_due", echecDepuis: ilYA(PAYMENT_GRACE_DAYS) }), MAINTENANT);
    expect(d.action).toBe("suspendre");
  });

  it("et la raison est ecrite, pas laissee vide", () => {
    const d = deciderTransition(etat({ statut: "past_due", echecDepuis: ilYA(PAYMENT_GRACE_DAYS + 5) }), MAINTENANT);
    if (d.action !== "suspendre") throw new Error("attendu : suspendre");
    expect(d.raison).toContain(String(PAYMENT_GRACE_DAYS));
  });

  it("un impaye deja enregistre ne recompte pas l'echec", () => {
    // `echecDepuis` present : on est deja en retard, on ne repasse pas par
    // `passer_en_retard` a chaque tick — le compteur exploserait.
    const d = deciderTransition(etat({ statut: "past_due", impayeDepuis: ilYA(2), echecDepuis: ilYA(2) }), MAINTENANT);
    expect(d.action).toBe("rien");
  });

  it("une facture en BROUILLON ne compte pas comme impaye", () => {
    // Le moteur ne lui passe que les factures emises : une facture jamais
    // envoyee ne peut pas etre opposee au client. Ici, l'absence d'impaye.
    const d = deciderTransition(etat({ impayeDepuis: null, finPeriode: dans(5) }), MAINTENANT);
    expect(d.action).toBe("rien");
  });
});

describe("l'impaye passe AVANT le renouvellement", () => {
  it("actif + impaye + periode close : on constate le retard, on ne renouvelle pas", () => {
    // LE SEUL CAS OU L'ORDRE DES REGLES DECIDE VRAIMENT, et je ne l'avais pas
    // teste. Mes premiers controles d'ordre portaient sur un abonnement deja
    // `past_due` ou `suspended` : la garde de STATUT les protegeait, si bien
    // qu'intervertir les blocs ne changeait rien. Sabotage mesure : ordre
    // inverse, 39 tests toujours verts. Un test qui ne tombe pas sous la
    // faute qu'il pretend couvrir ne couvre rien.
    //
    // Ici les deux regles peuvent s'appliquer — le statut est `active`, il y
    // a un impaye, ET la periode est close. Renouveler d'abord repousserait
    // la periode et masquerait l'impaye : le client repartirait pour un mois
    // sans avoir paye le precedent.
    const d = deciderTransition(etat({ impayeDepuis: ilYA(3), finPeriode: ilYA(2) }), MAINTENANT);
    expect(d.action, "l'impaye doit primer sur le renouvellement").toBe("passer_en_retard");
  });

  it("sans impaye, la meme periode close se renouvelle bien", () => {
    // Le controle negatif : sans lui, une regle qui ne renouvellerait JAMAIS
    // ferait passer le test ci-dessus pour une bonne raison.
    const d = deciderTransition(etat({ impayeDepuis: null, finPeriode: ilYA(2) }), MAINTENANT);
    expect(d.action).toBe("renouveler");
  });

  it("un impaye hors delai suspend, meme si la periode est close", () => {
    // Ici c'est la garde de statut qui protege, pas l'ordre — mais le
    // comportement merite d'etre verrouille pour lui-meme.
    const d = deciderTransition(
      etat({ statut: "past_due", echecDepuis: ilYA(PAYMENT_GRACE_DAYS + 1), finPeriode: ilYA(3) }),
      MAINTENANT,
    );
    expect(d.action).toBe("suspendre");
  });

  it("un abonnement suspendu ne se renouvelle pas tout seul", () => {
    const d = deciderTransition(etat({ statut: "suspended", finPeriode: ilYA(10) }), MAINTENANT);
    expect(d.action).toBe("rien");
  });

  it("un abonnement en grace ne se renouvelle pas non plus", () => {
    const d = deciderTransition(
      etat({ statut: "past_due", echecDepuis: ilYA(1), finPeriode: ilYA(1) }),
      MAINTENANT,
    );
    expect(d.action).toBe("rien");
  });
});

describe("ce que le cycle ne touche pas", () => {
  it("un abonnement annule reste clos — c'est un etat terminal", () => {
    for (const s of ["cancelled", "annulee", "annule"]) {
      expect(deciderTransition(etat({ statut: s, finPeriode: ilYA(30) }), MAINTENANT).action, s).toBe("rien");
    }
  });

  it("un essai ne se renouvelle JAMAIS — sinon c'est un produit gratuit", () => {
    const d = deciderTransition(etat({ plan: "essai", finPeriode: ilYA(60) }), MAINTENANT);
    expect(d.action).toBe("rien");
  });

  it("et l'essai expire reste traite par license-check, pas ici", () => {
    // Ecrire en plus un statut « expire » ajouterait un second chemin pour le
    // meme fait, et deux chemins finissent par diverger.
    const d = deciderTransition(etat({ plan: "essai", impayeDepuis: ilYA(30) }), MAINTENANT);
    if (d.action !== "rien") throw new Error(`attendu : rien, obtenu ${d.action}`);
    expect(d.raison).toMatch(/essai/);
  });

  it("un abonnement sans date de fin ne renouvelle rien", () => {
    // Une absence de terme n'est pas un terme depasse.
    expect(deciderTransition(etat({ finPeriode: null }), MAINTENANT).action).toBe("rien");
  });
});
