/**
 * Rapprocher un virement et une facture, sans se tromper de client.
 *
 * L'ancien rapprochement additionnait des points — montant exact +50, nom du
 * payeur +40, periode dans la reference +10 — et appliquait automatiquement
 * des 50. Or 50, c'est le MONTANT SEUL: tous les clients d'un meme forfait
 * paient la meme somme au centime. Deux abonnes a 29 EUR produisent deux
 * virements identiques, et le premier trouve fermait la facture de l'autre.
 *
 * L'erreur est silencieuse et durable: la facture passe a « payee », le client
 * credite a tort ne dit rien, et le vrai debiteur recoit des relances pour une
 * facture que le systeme croit soldee. On la decouvre en fin d'exercice.
 *
 * Le premier test de ce fichier est donc celui qui compte: deux factures du
 * meme montant ne doivent JAMAIS produire d'application automatique.
 */
import { describe, expect, it } from "vitest";

import { apparier, type FactureOuverte } from "../services/payment-matching";

const ACME: FactureOuverte = {
  id: 1, organisationId: 10, reference: "FAC-2026-000001", duMontant: 34.8, orgName: "ACME SARL",
};
const BETA: FactureOuverte = {
  id: 2, organisationId: 20, reference: "FAC-2026-000002", duMontant: 34.8, orgName: "Beta Travaux",
};

describe("rapprochement d'un virement", () => {
  it("n'applique rien quand deux factures ont le meme montant", () => {
    // Le defaut corrige, et le cas le plus courant: meme forfait, meme prix.
    const r = apparier({ amount: 34.8, bankRef: "VIREMENT", payerName: null }, [ACME, BETA]);
    expect(
      r.automatique,
      "un montant partage par deux clients ne designe personne: appliquer reviendrait " +
      "a solder la facture d'un client avec l'argent d'un autre",
    ).toBeNull();
    expect(r.suggestions).toHaveLength(2);
  });

  it("applique quand le libelle porte la reference de la facture", () => {
    const r = apparier(
      { amount: 34.8, bankRef: "VIR SEPA FAC-2026-000002 BETA TRAVAUX", payerName: "BETA TRAVAUX" },
      [ACME, BETA],
    );
    expect(r.automatique?.factureId).toBe(2);
    expect(r.automatique?.motif).toBe("reference");
  });

  it("retrouve la reference malgre la mise en forme de la banque", () => {
    // Les banques collent, espacent et mettent en majuscules a leur guise.
    for (const libelle of [
      "fac 2026 000001",
      "FAC2026000001",
      "VIR/FAC-2026-000001/ACME",
      "Reference : Fac-2026-000001",
    ]) {
      const r = apparier({ amount: 34.8, bankRef: libelle }, [ACME, BETA]);
      expect(r.automatique?.factureId, `libelle « ${libelle} »`).toBe(1);
    }
  });

  it("n'applique pas quand un virement porte deux references", () => {
    // Paiement groupe: la repartition ne se devine pas.
    const r = apparier(
      { amount: 69.6, bankRef: "FAC-2026-000001 FAC-2026-000002" },
      [ACME, BETA],
    );
    expect(r.automatique).toBeNull();
    expect(r.suggestions.map((s) => s.factureId).sort()).toEqual([1, 2]);
  });

  it("ne s'accroche pas a une reference trop courte", () => {
    // Une reference de quelques caracteres se retrouverait par hasard dans un
    // IBAN ou un identifiant de mandat.
    const courte: FactureOuverte = { ...ACME, reference: "F1" };
    const r = apparier({ amount: 34.8, bankRef: "FR7630001007941234567890185" }, [courte]);
    expect(r.automatique).toBeNull();
  });

  it("propose sans appliquer quand seuls le montant et le nom concordent", () => {
    const r = apparier(
      { amount: 34.8, bankRef: "VIREMENT MENSUEL", payerName: "ACME SARL" },
      [ACME, BETA],
    );
    expect(r.automatique, "le nom du payeur n'identifie pas une facture").toBeNull();
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].factureId).toBe(1);
    expect(r.suggestions[0].motif).toBe("montant_et_nom");
  });

  it("ne propose rien quand aucun montant ne correspond", () => {
    const r = apparier({ amount: 12.5, bankRef: "VIREMENT" }, [ACME, BETA]);
    expect(r.automatique).toBeNull();
    expect(r.suggestions).toEqual([]);
  });

  it("tolere un centime d'ecart nul et refuse au-dela", () => {
    expect(apparier({ amount: 34.8, bankRef: "" }, [ACME]).suggestions).toHaveLength(1);
    expect(apparier({ amount: 34.81, bankRef: "" }, [ACME]).suggestions).toHaveLength(0);
  });

  it("ignore une facture sans reference pour l'application automatique", () => {
    // Les factures anterieures a la numerotation n'ont pas de reference: elles
    // restent rapprochables a la main, jamais automatiquement.
    const ancienne: FactureOuverte = { ...ACME, reference: null };
    const r = apparier({ amount: 34.8, bankRef: "FAC-2026-000001" }, [ancienne]);
    expect(r.automatique).toBeNull();
  });
});
