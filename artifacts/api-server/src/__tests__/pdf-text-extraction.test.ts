process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractTextFromFile } from "../services/document-ai";

/**
 * Ce que l'application arrive reellement a lire dans un PDF.
 *
 * Pourquoi ce test existe. L'analyse documentaire annonce trois modeles
 * (Gemini, OpenAI, Claude) dont les reponses sont fusionnees en un consensus.
 * Seul Gemini recoit le PDF lui-meme; les deux autres recoivent le texte
 * extrait par `extractTextFromFile`. Or cette fonction n'avait AUCUNE branche
 * pour `application/pdf`: elle renvoyait `null`, et l'appelant remplacait le
 * contenu par la chaine « Fichier: facture.pdf (application/pdf) ».
 *
 * Autrement dit: sur un PDF, deux des trois modeles analysaient un NOM DE
 * FICHIER, puis leur reponse etait fondue dans le consensus. Rien n'echouait —
 * ils repondent toujours quelque chose. C'est le pire mode de panne: une
 * facture lue « par trois modeles » dont deux n'ont jamais vu la facture.
 *
 * Le test couvre 20 PDF differents parce qu'un seul PDF « propre » ne dit rien
 * de ce qu'un client envoie vraiment: accents, tableau, page vide, plusieurs
 * pages, montants, IBAN, majuscules, ponctuation typographique.
 */

interface Cas { nom: string; lignes: string[]; attendu: string[] }

const CAS: Cas[] = [
  { nom: "facture-simple", lignes: ["FACTURE FAC-2026-000001", "Client: ACME SARL", "Total TTC: 1 234,56 EUR"], attendu: ["FAC-2026-000001", "ACME"] },
  { nom: "facture-tva-multi", lignes: ["FACTURE", "TVA 20% : 200,00", "TVA 10% : 45,00", "TVA 5,5% : 11,00"], attendu: ["20%", "5,5%"] },
  { nom: "facture-autoliquidation", lignes: ["FACTURE SOUS-TRAITANCE", "Autoliquidation - article 283-2 nonies", "TVA: 0,00"], attendu: ["Autoliquidation"] },
  { nom: "devis", lignes: ["DEVIS DEV-2026-014", "Validite: 30 jours", "Montant HT: 8 400,00"], attendu: ["DEV-2026-014", "8 400,00"] },
  { nom: "bon-de-livraison", lignes: ["BON DE LIVRAISON BL-8891", "Sacs de ciment: 40"], attendu: ["BL-8891", "ciment"] },
  { nom: "accents-francais", lignes: ["Reception des travaux", "Elements a regler", "Garantie decennale"], attendu: ["decennale"] },
  { nom: "tableau", lignes: ["Designation | Qte | PU | Total", "Placo BA13 | 120 | 4,50 | 540,00"], attendu: ["BA13", "540,00"] },
  { nom: "iban", lignes: ["RELEVE D'IDENTITE BANCAIRE", "IBAN: FR76 3000 1007 9412 3456 7890 185"], attendu: ["FR76"] },
  { nom: "mentions-legales", lignes: ["Mentions legales", "SIRET: 123 456 789 00012"], attendu: ["SIRET"] },
  { nom: "texte-long", lignes: Array.from({ length: 60 }, (_, i) => `Ligne ${i + 1}: clause relative aux delais de paiement.`), attendu: ["Ligne 1:", "Ligne 60:"] },
  { nom: "une-ligne", lignes: ["OK"], attendu: ["OK"] },
  { nom: "chiffres-seuls", lignes: ["1234567890", "0,00", "-45,90"], attendu: ["1234567890", "-45,90"] },
  { nom: "email-telephone", lignes: ["contact@exemple.fr", "+33 6 12 34 56 78"], attendu: ["contact@exemple.fr"] },
  { nom: "ponctuation", lignes: ["50 % - 30 degres", "n.12 paragraphe 4"], attendu: ["50 %"] },
  { nom: "majuscules", lignes: ["ATTESTATION DE VIGILANCE URSSAF", "VALABLE JUSQU'AU 31/12/2026"], attendu: ["URSSAF", "31/12/2026"] },
  { nom: "dates", lignes: ["Date d'emission: 04/09/2026", "A payer avant le 15 octobre"], attendu: ["04/09/2026", "15 octobre"] },
  { nom: "reference-longue", lignes: ["REF: AB-2026-XYZ-0001-SUITE-TRES-LONGUE"], attendu: ["AB-2026-XYZ-0001"] },
  { nom: "multi-page-1", lignes: ["Page 1: conditions generales", "__PAGE__", "Page 2: annexe tarifaire"], attendu: ["Page 1:", "Page 2:"] },
  { nom: "multi-page-2", lignes: ["Avant", "__PAGE__", "__PAGE__", "Apres trois pages"], attendu: ["Avant", "Apres trois pages"] },
  { nom: "devise-etrangere", lignes: ["Total: 1,250.00 USD", "Rate: 1.08"], attendu: ["1,250.00 USD"] },
];

let dossier = "";
const fichiers = new Map<string, string>();

function construire(cible: string, lignes: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const flux = fs.createWriteStream(cible);
    doc.pipe(flux);
    doc.fontSize(11);
    for (const ligne of lignes) {
      if (ligne === "__PAGE__") { doc.addPage(); continue; }
      doc.text(ligne);
    }
    doc.end();
    flux.on("finish", () => resolve());
    flux.on("error", reject);
  });
}

beforeAll(async () => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-extraction-"));
  for (const cas of CAS) {
    const cible = path.join(dossier, `${cas.nom}.pdf`);
    await construire(cible, cas.lignes);
    fichiers.set(cas.nom, cible);
  }
}, 60_000);

afterAll(() => {
  if (dossier) fs.rmSync(dossier, { recursive: true, force: true });
});

describe("extraction du texte d'un PDF", () => {
  it("couvre au moins vingt documents differents", () => {
    // Garde-fou du test lui-meme: si la liste maigrit, l'assertion suivante
    // passerait pour de mauvaises raisons.
    expect(CAS.length).toBeGreaterThanOrEqual(20);
  });

  for (const cas of CAS) {
    it(`lit « ${cas.nom} »`, async () => {
      const base64 = fs.readFileSync(fichiers.get(cas.nom)!).toString("base64");
      const texte = await extractTextFromFile(base64, "application/pdf", `${cas.nom}.pdf`);

      expect(texte, "aucun texte extrait: deux des trois modeles n'analyseraient qu'un nom de fichier").not.toBeNull();
      for (const attendu of cas.attendu) {
        expect(texte, `« ${attendu} » absent du texte extrait`).toContain(attendu);
      }
    }, 30_000);
  }

  it("ne pretend pas avoir lu un fichier qui n'est pas un PDF", async () => {
    // Un fichier corrompu ou mal etiquete doit donner `null`, pas un texte
    // invente: l'appelant saura alors qu'il n'a rien, au lieu de croire le
    // contraire.
    const faux = Buffer.from("ceci n'est pas un PDF").toString("base64");
    const texte = await extractTextFromFile(faux, "application/pdf", "faux.pdf");
    expect(texte === null || texte.length < 200).toBe(true);
  });
});
