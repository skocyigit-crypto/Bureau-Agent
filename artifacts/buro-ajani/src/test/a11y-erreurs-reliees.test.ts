/**
 * Une erreur de saisie designe son champ, dans tous les formulaires
 * (RGAA 11.10 / WCAG 3.3.1).
 *
 * Quatorze validations d'application signalaient un champ obligatoire vide
 * par un toast seulement : visible et annonce, mais le champ ne portait ni
 * etat d'erreur ni lien vers le message, ne recevait pas le focus, et le
 * message s'effacait. `signalerChamp` complete le toast.
 *
 * La premiere partie teste le COMPORTEMENT dans un vrai DOM ; la seconde
 * verifie que chaque validation l'appelle, sur un champ qui existe.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signalerChamp } from "@/lib/champ-en-erreur";

afterEach(() => { document.body.innerHTML = ""; });

function champ(id: string): HTMLInputElement {
  const el = document.createElement("input");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

describe("signalerChamp, dans un vrai DOM", () => {
  it("marque le champ en erreur", () => {
    const el = champ("titre");
    signalerChamp("titre", "Le titre est obligatoire");
    expect(el.getAttribute("aria-invalid")).toBe("true");
  });

  it("relie le champ a un texte durable qui repete le message", () => {
    const el = champ("titre");
    signalerChamp("titre", "Le titre est obligatoire");
    const id = el.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)?.textContent).toBe("Le titre est obligatoire");
  });

  it("donne le focus au champ", () => {
    const el = champ("titre");
    signalerChamp("titre", "x");
    expect(document.activeElement).toBe(el);
  });

  it("leve l'erreur des qu'on saisit", () => {
    const el = champ("titre");
    signalerChamp("titre", "x");
    el.dispatchEvent(new Event("input"));
    expect(el.hasAttribute("aria-invalid")).toBe(false);
    expect(el.hasAttribute("aria-describedby")).toBe(false);
    expect(document.getElementById("titre-erreur")).toBeNull();
  });

  it("une seconde erreur met a jour le meme texte, sans doublon", () => {
    champ("titre");
    signalerChamp("titre", "premier");
    signalerChamp("titre", "second");
    expect(document.querySelectorAll("#titre-erreur").length).toBe(1);
    expect(document.getElementById("titre-erreur")?.textContent).toBe("second");
  });

  it("un champ absent ne casse rien et le dit", () => {
    expect(signalerChamp("inexistant", "x")).toBe(false);
  });
});

const PAGES = join(import.meta.dirname, "..", "pages");
const CAS: Array<[string, string, string]> = [
  ["admin-devis.tsx", "form.title", "devis-titre"],
  ["admin-devis.tsx", "form.clientName", "devis-client"],
  ["admin-factures-b2b.tsx", "form.title", "facture-b2b-titre"],
  ["admin-factures-b2b.tsx", "form.clientName", "facture-b2b-client"],
  ["admin-factures-client.tsx", "form.title", "facture-client-titre"],
  ["admin-factures-client.tsx", "form.clientName", "facture-client-client"],
  ["automations.tsx", "form.name", "automation-nom"],
  ["commandant-ia.tsx", "reminderEmail", "rappel-email"],
  ["notes-internes.tsx", "form.content", "note-contenu"],
  ["organisations.tsx", "formName", "organisation-nom"],
  ["projets.tsx", "form.title", "projet-titre"],
  ["prospect-detail.tsx", "form.title", "prospect-action-titre"],
  ["prospects.tsx", "form.title", "prospect-titre"],
  ["depenses.tsx", "form.vendor", "depense-fournisseur"],
];

describe("chaque validation designe son champ", () => {
  for (const [f, valeur, id] of CAS) {
    it(`${f} : ${valeur} -> #${id}`, () => {
      const s = readFileSync(join(PAGES, f), "utf8");
      // Le champ existe, porte l'id, et est declare obligatoire.
      expect(s).toContain(`id="${id}" aria-required="true"`);
      // L'id est bien sur l'element lie a cette valeur.
      const i = s.indexOf(`id="${id}"`);
      expect(s.slice(i, s.indexOf("/>", i))).toContain(`value={${valeur}}`);
      // La validation le signale.
      expect(s).toContain(`signalerChamp("${id}",`);
    });
  }

  it("plus aucune validation de champ obligatoire par toast seul", () => {
    // Le motif d'origine: `if (!x.trim()) { toast(` sans signalerChamp.
    const fautifs: string[] = [];
    for (const f of new Set(CAS.map((c) => c[0]))) {
      const s = readFileSync(join(PAGES, f), "utf8");
      for (const m of s.matchAll(/if \(!([\w.]+)(\.trim\(\))?\) \{ toast\(/g)) {
        // Ni une reponse serveur (`r.ok`), ni une capacite du navigateur
        // (`navigator.geolocation`) ne sont des champs : pas de champ a designer.
        if (/\.ok$|^navigator\./.test(m[1]!)) continue;
        fautifs.push(`${f}: ${m[0]}`);
      }
    }
    expect(fautifs).toEqual([]);
  });
});
