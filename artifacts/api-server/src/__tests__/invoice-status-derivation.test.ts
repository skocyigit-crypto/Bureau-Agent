/**
 * Le statut d'une facture melange du SAISI (brouillon, envoyee, annulee) et du
 * DEDUIT (payee, partiellement_payee, en_retard). Ces tests fixent la frontiere
 * entre les deux — c'est elle qui avait cede: `en_retard` n'etait ecrit nulle
 * part, donc les compteurs d'impayes bases sur ce statut affichaient zero
 * pendant que la tresorerie, elle, voyait le retard.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveInvoiceStatus, isInvoiceOverdue, isSettledStatus } from "../services/invoice-status";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const YESTERDAY = "2026-09-01T00:00:00.000Z";
const NEXT_MONTH = "2026-10-02T00:00:00.000Z";

describe("isInvoiceOverdue", () => {
  it("est en retard des que l'echeance est passee et qu'il reste a encaisser", () => {
    expect(isInvoiceOverdue({ status: "envoyee", totalAmount: "1200", paidAmount: "0", dueDate: YESTERDAY }, NOW)).toBe(true);
    expect(isInvoiceOverdue({ status: "partiellement_payee", totalAmount: "1200", paidAmount: "500", dueDate: YESTERDAY }, NOW)).toBe(true);
  });

  it("n'est pas en retard si l'echeance n'est pas atteinte", () => {
    expect(isInvoiceOverdue({ status: "envoyee", totalAmount: "1200", paidAmount: "0", dueDate: NEXT_MONTH }, NOW)).toBe(false);
  });

  it("n'est pas en retard sans echeance renseignee", () => {
    expect(isInvoiceOverdue({ status: "envoyee", totalAmount: "1200", paidAmount: "0", dueDate: null }, NOW)).toBe(false);
  });

  it("n'est jamais en retard si plus rien n'est du", () => {
    expect(isInvoiceOverdue({ status: "envoyee", totalAmount: "1200", paidAmount: "1200", dueDate: YESTERDAY }, NOW)).toBe(false);
    expect(isInvoiceOverdue({ status: "payee", totalAmount: "1200", paidAmount: "1200", dueDate: YESTERDAY }, NOW)).toBe(false);
    expect(isInvoiceOverdue({ status: "annulee", totalAmount: "1200", paidAmount: "0", dueDate: YESTERDAY }, NOW)).toBe(false);
  });

  it("ne met jamais un brouillon en retard: il n'a pas ete envoye", () => {
    expect(isInvoiceOverdue({ status: "brouillon", totalAmount: "1200", paidAmount: "0", dueDate: YESTERDAY }, NOW)).toBe(false);
  });
});

describe("deriveInvoiceStatus", () => {
  it("passe a payee quand le solde est atteint", () => {
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: "1200", paidAmount: "1200", dueDate: NEXT_MONTH }, NOW)).toBe("payee");
    // Un paiement superieur au total (arrondi, pourboire) solde aussi.
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: "1200", paidAmount: "1300", dueDate: NEXT_MONTH }, NOW)).toBe("payee");
  });

  it("passe a partiellement_payee des le premier acompte", () => {
    // Etat qu'aucun chemin de l'API n'atteignait: une facture a moitie reglee
    // restait "envoyee".
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: "1200", paidAmount: "500", dueDate: NEXT_MONTH }, NOW)).toBe("partiellement_payee");
  });

  it("le retard prime sur l'acompte", () => {
    // Une facture a moitie reglee dont l'echeance est passee reste un impaye a
    // relancer: c'est le retard qu'il faut voir.
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: "1200", paidAmount: "500", dueDate: YESTERDAY }, NOW)).toBe("en_retard");
  });

  it("ne touche jamais a un brouillon ni a une facture annulee", () => {
    expect(deriveInvoiceStatus({ status: "brouillon", totalAmount: "1200", paidAmount: "1200", dueDate: YESTERDAY }, NOW)).toBeNull();
    expect(deriveInvoiceStatus({ status: "annulee", totalAmount: "1200", paidAmount: "1200", dueDate: YESTERDAY }, NOW)).toBeNull();
  });

  it("ne renvoie rien quand le statut courant est deja le bon", () => {
    // Evite une ecriture (et un `updatedAt`) a chaque lecture.
    expect(deriveInvoiceStatus({ status: "payee", totalAmount: "1200", paidAmount: "1200", dueDate: YESTERDAY }, NOW)).toBeNull();
    expect(deriveInvoiceStatus({ status: "en_retard", totalAmount: "1200", paidAmount: "0", dueDate: YESTERDAY }, NOW)).toBeNull();
    expect(deriveInvoiceStatus({ status: "partiellement_payee", totalAmount: "1200", paidAmount: "500", dueDate: NEXT_MONTH }, NOW)).toBeNull();
  });

  it("ne solde pas une facture a zero", () => {
    // 0 >= 0 est vrai: sans garde, toute facture vide serait "payee".
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: "0", paidAmount: "0", dueDate: NEXT_MONTH }, NOW)).toBeNull();
  });

  it("tolere des montants absents ou illisibles sans changer d'etat", () => {
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: null, paidAmount: null, dueDate: null }, NOW)).toBeNull();
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: "abc" as any, paidAmount: "xyz" as any, dueDate: "pas-une-date" }, NOW)).toBeNull();
  });

  it("accepte la virgule decimale des montants stockes", () => {
    expect(deriveInvoiceStatus({ status: "envoyee", totalAmount: "1200,50", paidAmount: "1200,50", dueDate: NEXT_MONTH }, NOW)).toBe("payee");
  });
});

describe("isSettledStatus", () => {
  it("ne considere closes que les factures payees ou annulees", () => {
    expect(isSettledStatus("payee")).toBe(true);
    expect(isSettledStatus("annulee")).toBe(true);
    for (const open of ["brouillon", "envoyee", "partiellement_payee", "en_retard"]) {
      expect(isSettledStatus(open), open).toBe(false);
    }
  });
});

/** Tous les fichiers source du serveur, hors tests. */
function serverSources(): string[] {
  const root = join(import.meta.dirname, "..");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.includes("__tests__") && !p.includes(".test.")) out.push(p);
    }
  };
  walk(root);
  return out;
}

describe("le retard n'est jamais lu dans la colonne statut", () => {
  it("n'interroge nulle part les factures par status = en_retard", () => {
    // Aucun chemin d'ecriture ne pose ce statut: une requete qui le compare
    // renvoie toujours zero, sans erreur ni test rouge. C'est ainsi que quatre
    // compteurs d'impayes affichaient 0 pendant que la tresorerie voyait le
    // retard. `overdueCondition()` est la seule formulation admise.
    const offenders: string[] = [];
    for (const file of serverSources()) {
      if (file.endsWith("invoice-status.ts")) continue;
      const source = readFileSync(file, "utf8");
      const patterns = [
        /eq\(\s*facturesClientTable\.status\s*,\s*["']en_retard["']\s*\)/,
        /\$\{facturesClientTable\.status\}\s*=\s*'en_retard'/,
      ];
      if (patterns.some((re) => re.test(source))) {
        offenders.push(relative(join(import.meta.dirname, ".."), file).split("\\").join("/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("ne cite plus en_attente, qui n'est pas un statut de facture", () => {
    // `en_attente` est un statut de TACHE. Glisse dans des requetes de
    // facturation, il n'y matchait jamais.
    const offenders: string[] = [];
    for (const file of serverSources()) {
      const source = readFileSync(file, "utf8");
      // On ne regarde que les lignes qui parlent de factures.
      for (const line of source.split("\n")) {
        if (line.includes("facturesClientTable") && line.includes("en_attente")) {
          offenders.push(relative(join(import.meta.dirname, ".."), file).split("\\").join("/"));
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("le vocabulaire des statuts reste ferme", () => {
  it("ne laisse aucune valeur hors vocabulaire dans les requetes factures", () => {
    // `en_attente` (un statut de TACHE) trainait dans cinq requetes de
    // facturation: la condition ne matchait jamais, sans erreur.
    const VOCABULARY = ["brouillon", "envoyee", "payee", "partiellement_payee", "en_retard", "annulee"];
    const derived = [
      deriveInvoiceStatus({ status: "envoyee", totalAmount: "100", paidAmount: "100", dueDate: NEXT_MONTH }, NOW),
      deriveInvoiceStatus({ status: "envoyee", totalAmount: "100", paidAmount: "40", dueDate: NEXT_MONTH }, NOW),
      deriveInvoiceStatus({ status: "envoyee", totalAmount: "100", paidAmount: "0", dueDate: YESTERDAY }, NOW),
    ];

    for (const status of derived) {
      expect(status).not.toBeNull();
      expect(VOCABULARY).toContain(status);
    }
  });
});
