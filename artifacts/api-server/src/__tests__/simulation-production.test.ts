/**
 * Ce que le cycle fera a la PRODUCTION, decide avant de deployer.
 *
 * Les valeurs ci-dessous sont celles lues en production le 24/09/2026, telles
 * quelles. Le but n'est pas de tester le moteur — les autres fichiers s'en
 * chargent — mais de repondre a une question qu'on ne devrait jamais deployer
 * sans avoir posee : QU'EST-CE QUI VA CHANGER POUR LE CLIENT ?
 *
 * Ce controle a deja servi. En le preparant, j'ai trouve que l'agent
 * super-admin, devenu capable d'agir, aurait envoye une relance de paiement
 * au seul client payant pour une facture jamais emise. Corrige avant
 * deploiement, pas apres.
 *
 * CE FICHIER VIEILLIRA, et c'est voulu : il fige un etat date. Quand la
 * production aura change, il faudra soit le mettre a jour avec les nouvelles
 * valeurs, soit le supprimer — mais pas le laisser affirmer quelque chose de
 * faux. Les valeurs sont donc accompagnees de leur date de mesure.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { deciderTransition, type EtatAbonnement } from "../services/cycle-abonnement";

/** Le 24/09/2026 a midi UTC, date de la mesure. */
const MESURE = new Date("2026-09-24T12:00:00Z");

/**
 * Les cinq abonnements de production, au 24/09/2026.
 *
 * Aucun n'a de `stripe_subscription_id` : Stripe n'est pas raccorde.
 * `impayeDepuis` vaut null partout parce qu'AUCUNE facture n'a jamais ete
 * emise — c'est precisement le constat qui a motive tout ce lot.
 */
const PRODUCTION: Array<{ org: number; nom: string; actif: boolean; etat: EtatAbonnement }> = [
  {
    org: 1, nom: "SK GROUP", actif: true,
    etat: {
      statut: "active", plan: "essai", cycle: "monthly",
      finPeriode: new Date("2026-07-27T13:01:16Z"),
      impayeDepuis: null, echecDepuis: null, stripeSubscriptionId: null,
    },
  },
  {
    org: 5, nom: "Diagnostic Test Co", actif: false,
    etat: {
      statut: "active", plan: "essai", cycle: "monthly",
      finPeriode: new Date("2026-08-01T07:05:43Z"),
      impayeDepuis: null, echecDepuis: null, stripeSubscriptionId: null,
    },
  },
  {
    org: 6, nom: "Diagnostic Test Co 3", actif: false,
    etat: {
      statut: "active", plan: "essai", cycle: "monthly",
      finPeriode: new Date("2026-08-01T07:37:08Z"),
      impayeDepuis: null, echecDepuis: null, stripeSubscriptionId: null,
    },
  },
  {
    org: 7, nom: "CREPI STYLE", actif: false,
    etat: {
      statut: "active", plan: "essai", cycle: "monthly",
      finPeriode: new Date("2026-08-03T08:50:56Z"),
      impayeDepuis: null, echecDepuis: null, stripeSubscriptionId: null,
    },
  },
  {
    // Le seul client payant : entreprise, 199 EUR/mois, periode close le 19 aout.
    org: 8, nom: "CREPI STYLE (CREPI STYLE)", actif: true,
    etat: {
      statut: "active", plan: "entreprise", cycle: "monthly",
      finPeriode: new Date("2026-08-19T09:35:00Z"),
      impayeDepuis: null, echecDepuis: null, stripeSubscriptionId: null,
    },
  },
];

const decisionDe = (org: number) =>
  deciderTransition(PRODUCTION.find((p) => p.org === org)!.etat, MESURE);

describe("ce qui changera pour les clients au deploiement", () => {
  it("AUCUN compte n'est suspendu", () => {
    // La consequence la plus visible et la plus couteuse d'un cycle qui se
    // met a tourner apres des mois d'arret : couper l'acces a quelqu'un.
    const suspendus = PRODUCTION.filter((p) => deciderTransition(p.etat, MESURE).action === "suspendre");
    expect(suspendus.map((p) => p.nom), "des clients perdraient l'ecriture au deploiement").toEqual([]);
  });

  it("AUCUN compte ne passe en retard de paiement", () => {
    // Aucune facture n'ayant jamais ete emise, rien n'est exigible.
    const retards = PRODUCTION.filter((p) => deciderTransition(p.etat, MESURE).action === "passer_en_retard");
    expect(retards.map((p) => p.nom)).toEqual([]);
  });

  it("les quatre essais ne sont pas touches", () => {
    for (const org of [1, 5, 6, 7]) {
      expect(decisionDe(org).action, `org ${org}`).toBe("rien");
    }
  });

  it("le seul changement est le renouvellement de la periode du client payant", () => {
    const d = decisionDe(8);
    expect(d.action).toBe("renouveler");
  });

  it("et sa nouvelle periode tombe dans le FUTUR, pas dans un passe deja depasse", () => {
    // Une periode renouvelee vers une date passee serait renouvelee de
    // nouveau au tick suivant, indefiniment.
    const d = decisionDe(8);
    if (d.action !== "renouveler") throw new Error("attendu : renouveler");
    expect(d.nouvelleFin.getTime()).toBeGreaterThan(MESURE.getTime());
  });

  it("elle garde le jour d'anniversaire du contrat — le 19", () => {
    // Repartir d'aujourd'hui decalerait la date de facturation du client de
    // cinq semaines.
    const d = decisionDe(8);
    if (d.action !== "renouveler") throw new Error("attendu : renouveler");
    expect(d.nouvelleFin.getUTCDate()).toBe(19);
  });

  it("le total des changements se compte sur les doigts d'une main", () => {
    // Un deploiement dont on ne sait pas combien de lignes il va toucher est
    // un deploiement qu'on ne controle pas.
    const actions = PRODUCTION.map((p) => deciderTransition(p.etat, MESURE).action).filter((a) => a !== "rien");
    expect(actions).toEqual(["renouveler"]);
  });
});
