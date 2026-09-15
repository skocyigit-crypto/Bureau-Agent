/**
 * Produit un exemplaire de facture pour relecture, avec des TAUX MELANGES.
 *
 * L'echantillon precedent (12/09) portait un seul taux de TVA. Or c'est
 * precisement le cas melange qui a revele, le 14/09, que la facture emise par
 * l'agent IA sous-declarait la TVA de 120 EUR: main d'oeuvre de renovation a
 * 10 %, fournitures a 20 %. Un exemplaire a taux unique ne montrerait pas la
 * ventilation, c'est-a-dire la partie qu'un comptable regarde en premier.
 *
 * Usage:  npx tsx echantillon-facture.mts [chemin de sortie]
 */
import { writeFileSync } from "node:fs";

import { buildInvoiceDocument, renderInvoicePdf } from "./src/services/invoice-pdf.ts";

const sortie = process.argv[2] ?? "facture-exemple-taux-melanges.pdf";

const facture = {
  reference: "FA-2026-0148",
  title: "Renovation cuisine — 14 rue des Lilas",
  clientName: "Mme Hélène Vasseur",
  clientCompany: null,
  clientAddress: "14 rue des Lilas\n69003 Lyon",
  clientEmail: "h.vasseur@exemple.fr",
  currency: "EUR",
  createdAt: new Date("2026-09-15T09:00:00Z"),
  dueDate: new Date("2026-10-15T09:00:00Z"),
  isAutoliquidation: false,
  notes: "Acompte de 30 % deja regle le 02/09/2026.",
  items: [
    // Renovation d'un logement de plus de deux ans: 10 %.
    { description: "Main d'oeuvre — depose et pose (30 h)", quantity: 30, unitPrice: 45, taxRate: 10 },
    // Amelioration energetique: 5,5 %.
    { description: "Isolation thermique des murs (m²)", quantity: 24, unitPrice: 31.5, taxRate: 5.5 },
    // Fournitures et materiel neuf: 20 %.
    { description: "Plan de travail stratifie", quantity: 1, unitPrice: 890, taxRate: 20 },
    { description: "Robinetterie et raccords", quantity: 1, unitPrice: 310, taxRate: 20 },
  ],
} as never;

const vendeur = {
  raisonSociale: "Ajant Bureau SAS",
  adresse: "12 avenue de la Republique\n75011 Paris",
  siret: "000 000 000 00000",
  tvaNumber: "FR00000000000",
  email: "contact@agentdebureau.fr",
  iban: "FR76 0000 0000 0000 0000 0000 000",
} as never;

const doc = buildInvoiceDocument(facture, vendeur, new Date("2026-09-15T09:00:00Z"));
const pdf = await renderInvoicePdf(doc);
writeFileSync(sortie, pdf);

const t = doc.totals ?? doc;
console.log(`Ecrit: ${sortie} (${pdf.length} octets)`);
console.log(`HT ${t.subtotal} — TVA ${t.taxAmount} — TTC ${t.totalAmount}`);
if (Array.isArray((t as { vatBreakdown?: unknown[] }).vatBreakdown)) {
  for (const b of (t as { vatBreakdown: Array<{ rate: number; base: number; amount: number }> }).vatBreakdown) {
    console.log(`  taux ${b.rate} % sur ${b.base} -> ${b.amount}`);
  }
}
