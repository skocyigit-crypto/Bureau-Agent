/**
 * Les liens « ouvre la source » menent a l'enregistrement, pas a une liste.
 *
 * Revue du 30/09 (domaine ekran-api) : le dossier de chantier mene a
 * `/devis?id=12`, `/factures?id=7`... et ces pages paginees ignoraient `?id=`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import { EnregistrementCible, idDansAdresse } from "@/components/enregistrement-cible";

let statut = 200;
let corps: unknown = {};
let urls: string[] = [];

beforeEach(() => {
  statut = 200; urls = [];
  corps = { id: 12, reference: "DV-12", title: "Ravalement", clientName: "SCI Duval", status: "accepte", totalAmount: "1200.00", currency: "EUR" };
  localStorage.setItem("app.lang", "fr");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(String(url)); return { ok: statut < 400, status: statut, json: async () => corps } as Response; }));
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

function monter(ressource: "devis" | "facture" | "depense" | "document", recherche: string) {
  window.history.replaceState(null, "", `/x${recherche}`);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nProvider><EnregistrementCible ressource={ressource} /></I18nProvider></QueryClientProvider>);
}

describe("l'enregistrement vise par ?id=", () => {
  it("lit l'identifiant de l'adresse, et refuse ce qui n'en est pas un", () => {
    expect(idDansAdresse("?id=12")).toBe(12);
    expect(idDansAdresse("?id=0")).toBeNull();
    expect(idDansAdresse("?id=12abc")).toBeNull();
    expect(idDansAdresse("?id=-3")).toBeNull();
    expect(idDansAdresse("")).toBeNull();
  });

  it("sans ?id=, n'affiche rien et ne lit rien", () => {
    monter("devis", "");
    expect(screen.queryByTestId("cible-enregistrement")).toBeNull();
    expect(urls).toEqual([]);
  });

  it("lit l'enregistrement par son numero, quelle que soit la page de la liste", async () => {
    monter("devis", "?id=12");
    const c = await screen.findByTestId("cible-enregistrement");
    expect(c).toHaveTextContent("DV-12");
    expect(c).toHaveTextContent(/1\s?200/);
    expect(urls.some((u) => u.endsWith("/api/devis/12"))).toBe(true);
  });

  it("chaque ressource va a sa route unitaire", async () => {
    monter("depense", "?id=7");
    await screen.findByTestId("cible-enregistrement");
    expect(urls.some((u) => u.endsWith("/api/depenses/7"))).toBe(true);
  });

  it("un numero inconnu le dit, au lieu de ne rien afficher", async () => {
    statut = 404;
    monter("facture", "?id=99");
    expect(await screen.findByTestId("cible-erreur")).toHaveTextContent(/99/);
  });
});

describe("les quatre pages montent le bandeau", () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, "..", "pages", p), "utf8");
  it.each([["admin-devis.tsx", "devis"], ["admin-factures-client.tsx", "facture"], ["depenses.tsx", "depense"], ["documents.tsx", "document"]])("%s", (f, r) => {
    expect(src(f)).toContain(`<EnregistrementCible ressource="${r}" />`);
  });
  it("le bureau des taches ouvre l'onglet demande par ?statut=", () => {
    expect(src("bureau-taches.tsx")).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\("statut"\)/);
  });
});
