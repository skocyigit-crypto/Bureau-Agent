/**
 * Des chiffres d'argent lus dans une table que personne ne remplit.
 *
 * Mesure du 19/09 : `compte_client` — 36 colonnes, dont l'encours, le montant
 * en retard, la balance agee 30/60/90, le score de sante et le niveau de
 * risque — n'a AUCUN `insert` dans tout le depot. Zero. La seule ecriture qui
 * existe met a jour `lastReminderAt` sur des lignes qui ne sont jamais creees.
 *
 * Elle etait pourtant lue a quinze endroits : tableau de bord du risque
 * client, fiche client, export CSV remis au client, relances. L'ecran
 * n'affichait donc pas « aucune donnee » — il affichait 0 € d'encours,
 * 0 compte critique et un score moyen, avec l'assurance d'un calcul.
 *
 * Ce n'est pas une panne : rien ne casse, rien n'alerte, et le chiffre est
 * faux. C'est le defaut le plus couteux a decouvrir apres une vente.
 *
 * La correction ne remplit pas la table : elle la rend inutile. Tout ce
 * qu'elle promettait se deduit des factures, qui sont la source de verite et
 * sont, elles, bien ecrites.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calculerComptesClients, niveauRisque, scoreSante, type FactureSante } from "../services/sante-comptes-clients";

const LE_JOUR = new Date("2026-09-19T12:00:00.000Z");
const ilYA = (jours: number) => new Date(LE_JOUR.getTime() - jours * 86400000);

function facture(p: Partial<FactureSante> = {}): FactureSante {
  return {
    clientName: "Dupont SARL",
    contactId: null,
    totalAmount: "1200.00",
    paidAmount: "0",
    status: "envoyee",
    dueDate: null,
    ...p,
  };
}

describe("ce qui porte une creance, et ce qui n'en porte pas", () => {
  it("une facture payee ne pese plus rien", () => {
    const s = calculerComptesClients([facture({ status: "payee" })], LE_JOUR);
    expect(s.totalOutstanding).toBe(0);
    expect(s.comptes).toHaveLength(0);
  });

  it("un brouillon non plus : il n'a jamais ete reclame", () => {
    expect(calculerComptesClients([facture({ status: "brouillon" })], LE_JOUR).comptes).toHaveLength(0);
  });

  it("une facture annulee non plus", () => {
    expect(calculerComptesClients([facture({ status: "annulee" })], LE_JOUR).comptes).toHaveLength(0);
  });

  it("une facture soldee au centime pres sort du calcul", () => {
    const s = calculerComptesClients([facture({ totalAmount: "1200.00", paidAmount: "1200.00" })], LE_JOUR);
    expect(s.comptes, "un reste de 0 continue de compter comme une creance").toHaveLength(0);
  });

  it("un acompte laisse le reste du, pas le total", () => {
    const s = calculerComptesClients([facture({ totalAmount: "1200.00", paidAmount: "500.00" })], LE_JOUR);
    expect(s.totalOutstanding).toBe(700);
  });
});

describe("l'echeance decide de ce qui est en retard", () => {
  it("une facture sans echeance n'est pas en retard", () => {
    const s = calculerComptesClients([facture({ dueDate: null })], LE_JOUR);
    expect(s.totalOutstanding).toBe(1200);
    expect(s.totalOverdue).toBe(0);
  });

  it("une echeance a venir non plus", () => {
    const s = calculerComptesClients([facture({ dueDate: ilYA(-10) })], LE_JOUR);
    expect(s.totalOverdue).toBe(0);
  });

  it("une echeance passee bascule tout le reste du en retard", () => {
    const s = calculerComptesClients([facture({ dueDate: ilYA(45) })], LE_JOUR);
    expect(s.totalOverdue).toBe(1200);
  });

  it("la balance agee range chaque montant dans sa tranche", () => {
    const s = calculerComptesClients([
      facture({ totalAmount: "100.00", dueDate: ilYA(10) }),
      facture({ totalAmount: "200.00", dueDate: ilYA(45) }),
      facture({ totalAmount: "300.00", dueDate: ilYA(75) }),
      facture({ totalAmount: "400.00", dueDate: ilYA(200) }),
    ], LE_JOUR);
    const c = s.comptes[0];
    expect([c.agingO30, c.aging31a60, c.aging61a90, c.aging90plus]).toEqual([100, 200, 300, 400]);
  });

  it("le retard le plus ancien est retenu, pas le dernier lu", () => {
    const s = calculerComptesClients([
      facture({ totalAmount: "100.00", dueDate: ilYA(120) }),
      facture({ totalAmount: "100.00", dueDate: ilYA(3) }),
    ], LE_JOUR);
    expect(s.comptes[0].joursRetardMax).toBe(120);
  });
});

describe("le regroupement par client", () => {
  it("deux factures du meme contact ne font qu'un compte", () => {
    const s = calculerComptesClients([
      facture({ contactId: 7, totalAmount: "100.00" }),
      facture({ contactId: 7, totalAmount: "250.00" }),
    ], LE_JOUR);
    expect(s.comptes).toHaveLength(1);
    expect(s.comptes[0].solde).toBe(350);
  });

  it("un client sans fiche contact garde quand meme sa creance", () => {
    // Une facture peut etre emise a quelqu'un qui n'est pas encore un contact:
    // l'ignorer ferait disparaitre son du du tableau.
    const s = calculerComptesClients([
      facture({ contactId: null, clientName: "Martin BTP", totalAmount: "500.00" }),
      facture({ contactId: null, clientName: "martin btp", totalAmount: "500.00" }),
    ], LE_JOUR);
    expect(s.comptes, "la casse du nom scinde le compte en deux").toHaveLength(1);
    expect(s.comptes[0].solde).toBe(1000);
  });

  it("deux clients distincts restent distincts", () => {
    const s = calculerComptesClients([
      facture({ contactId: 1, clientName: "A" }),
      facture({ contactId: 2, clientName: "B" }),
    ], LE_JOUR);
    expect(s.comptes).toHaveLength(2);
  });
});

describe("le score dit ce qui inquiete un creancier", () => {
  it("un client qui doit beaucoup mais paie a l'heure reste sain", () => {
    const s = calculerComptesClients([facture({ totalAmount: "50000.00", dueDate: ilYA(-5) })], LE_JOUR);
    expect(s.comptes[0].riskLevel, "le montant seul ne fait pas le risque").toBe("sain");
  });

  it("un petit retard de cent jours, lui, est critique", () => {
    const s = calculerComptesClients([facture({ totalAmount: "300.00", dueDate: ilYA(100) })], LE_JOUR);
    expect(s.comptes[0].riskLevel).toBe("critique");
  });

  it("l'anciennete pese plus qu'une echeance d'hier", () => {
    expect(scoreSante(1, 100)).toBeLessThan(scoreSante(1, 1));
  });

  it("les seuils de risque sont ordonnes", () => {
    expect(niveauRisque(95)).toBe("sain");
    expect(niveauRisque(70)).toBe("surveille");
    expect(niveauRisque(50)).toBe("eleve");
    expect(niveauRisque(10)).toBe("critique");
  });

  it("sans aucune creance, la sante moyenne vaut 100", () => {
    // La table vide rendait 0 : une organisation parfaitement a jour
    // apparaissait comme la plus en danger de toutes.
    const s = calculerComptesClients([], LE_JOUR);
    expect(s.avgHealth).toBe(100);
    expect(s.critical).toBe(0);
  });

  it("les comptes les plus fragiles arrivent en tete", () => {
    const s = calculerComptesClients([
      facture({ contactId: 1, clientName: "Sain", totalAmount: "100.00", dueDate: ilYA(-30) }),
      facture({ contactId: 2, clientName: "Critique", totalAmount: "100.00", dueDate: ilYA(150) }),
    ], LE_JOUR);
    expect(s.comptes[0].clientName).toBe("Critique");
  });
});

describe("le tableau de bord ne lit plus la table vide", () => {
  const route = readFileSync(
    join(import.meta.dirname, "..", "routes", "ai-analysis.ts"), "utf8",
  );

  it("la sante des comptes vient du service, pas de compte_client", () => {
    expect(route).toMatch(/calculerComptesClients\(facturesOuvertes\)/);
  });

  it("plus aucune requete ne part vers cette table", () => {
    expect(
      route,
      "une lecture subsiste: les chiffres repartiraient a zero",
    ).not.toMatch(/from\(compteClientTable\)/);
  });

  it("l'alerte qui reposait sur une colonne jamais ecrite a ete retiree", () => {
    // `compte_client.status = 'bloque'` : aucune limite de credit n'existe
    // dans le produit, l'alerte ne s'est jamais declenchee. On ne la remplace
    // pas par une approximation.
    expect(route).not.toMatch(/comptes clients BLOQUES/);
  });
});

describe("plus aucun code de production ne touche a cette table", () => {
  /**
   * `compte_client` n'est ECRITE nulle part. Toute lecture en produit donc des
   * zeros presentes comme des chiffres, ou — pire — une garde qui ne garde
   * rien : la liste des clients exclus des relances automatiques etait
   * toujours vide, et un client qui avait demande qu'on cesse en recevait quand
   * meme.
   *
   * Ce controle balaie l'arborescence plutot qu'un fichier : les trois
   * lectures trouvees pendant l'audit etaient dans trois fichiers differents,
   * et une quatrieme ailleurs passerait inapercue.
   */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : sources(p);
      return p.endsWith(".ts") && !p.includes(".test.") ? [p] : [];
    });
  }

  it("aucune lecture, aucun import", () => {
    const coupables = sources(join(import.meta.dirname, ".."))
      .filter((f) => /compteClientTable/.test(readFileSync(f, "utf8")))
      .map((f) => f.split(/[\\/]/).slice(-2).join("/"));

    expect(
      coupables,
      `cette table n'est jamais ecrite: ce qu'on en lit est faux — ${coupables.join(", ")}`,
    ).toEqual([]);
  });

  it("le balayage trouve bien des fichiers a examiner", () => {
    // Garde-fou du controle: une arborescence vide ferait passer l'assertion
    // precedente sans rien garantir.
    expect(sources(join(import.meta.dirname, "..")).length).toBeGreaterThan(50);
  });
});
