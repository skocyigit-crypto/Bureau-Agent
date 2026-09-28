/**
 * L'agent super-admin AGIT sur ce qui est mecanique, et propose le reste.
 *
 * CE QU'IL FAISAIT. Son propre en-tete l'annoncait : « Il ne modifie RIEN
 * directement [...] c'est l'approbation du proprietaire de la plateforme qui
 * declenche l'action. » Chaque signal, meme le plus mecanique, attendait un
 * clic. Sur une plateforme dont le proprietaire veut qu'elle se gere seule,
 * cela revient a une file qui s'allonge.
 *
 * LA LIGNE DE PARTAGE N'EST PAS LE RISQUE, C'EST LA QUESTION POSEE.
 *
 *   - Relancer un client dont la facture est impayee ne demande aucune
 *     decision : la regle est « facture impayee, on relance ». La relance
 *     porte deja ses propres garde-fous anti-doublon, cote organisation
 *     cible. C'est une consequence, pas un choix.
 *   - Prolonger un essai de sept jours EST un choix : un geste commercial,
 *     au cas par cas, qu'on ne reprend pas une fois accorde.
 *   - Reactiver un compte suspendu, repondre a un quota sature : arbitrage.
 *
 * On automatise donc le mecanique et on laisse proposer l'arbitraire, au lieu
 * de choisir entre tout automatiser et tout faire valider.
 *
 * POURQUOI L'EXECUTION NE PASSE PAS PAR `executeSaasTool` : ses deux
 * invariants exigent un super-administrateur actif et la file du super-admin.
 * Ils protegent la FILE, dont la menace est qu'un locataire y fasse executer
 * une action de plateforme. Un cron interne n'est pas un acteur locataire, et
 * lui fabriquer une identite d'utilisateur affaiblirait l'invariant pour tous
 * les autres appels.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planProposalFor } from "../services/saas-agent";

const AGENT = readFileSync(join(import.meta.dirname, "..", "services", "saas-agent.ts"), "utf8");
const OUTILS = readFileSync(join(import.meta.dirname, "..", "services", "saas-tools.ts"), "utf8");

const JOUR = "2026-09-24";
const signal = (category: string, severity = "haute") => ({
  organisationId: 42,
  organisationName: "CREPI STYLE",
  category,
  severity,
  detail: "Facture d'abonnement impayee depuis 12 jours.",
}) as any;

describe("ce qui est mecanique s'applique", () => {
  it.each(["payment_failed", "subscription_past_due", "overdue_saas_invoice"])(
    "%s : relance appliquee sans attendre d'approbation",
    (cat) => {
      const p = planProposalFor(signal(cat), JOUR);
      expect(p, "aucun plan produit").toBeTruthy();
      expect(p!.autoApplicable, "la relance devrait s'appliquer seule").toBe(true);
    },
  );

  it("et c'est bien l'outil de relance qui est vise", () => {
    expect(planProposalFor(signal("payment_failed"), JOUR)!.toolName).toBe("saas_send_invoice_reminder");
  });
});

describe("ce qui est un choix reste propose", () => {
  it("prolonger un essai ne s'applique pas tout seul", () => {
    // Sept jours gratuits accordes automatiquement a chaque essai qui
    // s'acheve, c'est un produit gratuit de sept jours de plus — decide par
    // personne.
    const p = planProposalFor(signal("trial_expiring", "moyenne"), JOUR);
    expect(p).toBeTruthy();
    expect(p!.autoApplicable, "un geste commercial ne s'accorde pas seul").toBe(false);
  });

  it("un essai DEJA expire ne produit aucun plan", () => {
    // license-check le passe deja en lecture seule : un second chemin pour le
    // meme fait finirait par diverger.
    expect(planProposalFor(signal("trial_expired"), JOUR)).toBeNull();
  });

  it("un quota sature non plus — c'est une question de vente", () => {
    expect(planProposalFor(signal("quota_breach"), JOUR)).toBeNull();
  });

  it("un compte suspendu non plus — reactiver ou clore est un arbitrage", () => {
    expect(planProposalFor(signal("suspended"), JOUR)).toBeNull();
  });
});

describe("le cycle rend compte de ce qu'il a fait", () => {
  it("il compte les actions APPLIQUEES, pas seulement les propositions", () => {
    // « 0 proposition » et « 3 relances envoyees » sont deux resultats tres
    // differents, et l'ancien compteur ne les distinguait pas.
    expect(AGENT).toMatch(/applied: number/);
    expect(AGENT).toMatch(/applied\+\+/);
  });

  it("et les echecs a part — jamais tus", () => {
    // Un echec silencieux se compterait comme un succes : le cycle rendrait
    // « tout va bien » en n'ayant rien envoye.
    expect(AGENT).toMatch(/failed: number/);
    expect(AGENT).toMatch(/failed\+\+/);
  });

  it("un echec n'interrompt pas le cycle", () => {
    // Une organisation dont la relance echoue ne doit pas empecher les
    // suivantes d'etre traitees.
    expect(AGENT).toMatch(/catch \(err\)[\s\S]{0,200}return \{ ok: false \}/);
  });

  it("l'execution est journalisee, succes comme echec", () => {
    expect(AGENT).toMatch(/relance de facture envoyee/);
    expect(AGENT).toMatch(/relance de facture en echec/);
  });
});

describe("les invariants de la file restent intacts", () => {
  it("executeSaasTool exige toujours un super-admin actif", () => {
    // L'automatisation ne doit pas avoir affaibli le chemin approuve.
    expect(OUTILS).toMatch(/actor\.role !== "super_admin"/);
    expect(OUTILS).toMatch(/Action réservée au super-administrateur/);
  });

  it("et toujours la file du super-admin", () => {
    expect(OUTILS).toMatch(/ctx\.orgId !== superAdminOrgId/);
  });

  it("l'agent n'appelle pas executeSaasTool pour contourner ces invariants", () => {
    // S'il le faisait avec une identite fabriquee, l'invariant ne vaudrait
    // plus rien pour aucun appelant.
    //
    // On cherche un APPEL, pas le mot : le commentaire de l'agent explique
    // justement pourquoi il ne passe pas par la, et une recherche de texte
    // tombait dessus. Verifier la forme du code, pas sa prose.
    const appels = AGENT.split(/\r?\n/).filter((l) => {
      const nu = l.trim();
      if (nu.startsWith("//") || nu.startsWith("*")) return false;
      return /\bexecuteSaasTool\s*\(/.test(nu);
    });
    expect(appels, "identite fabriquee : l'invariant ne vaudrait plus rien").toEqual([]);
  });

  it("il appelle l'action elle-meme, nommement", () => {
    expect(AGENT).toMatch(/runAutoRemindersForOrg/);
    expect(AGENT).toMatch(/mode: "send"/);
  });
});
