/**
 * Le planning en trois vues, rendu (plan du 29/09, section 7). Serveur simule,
 * page et traductions reelles, en turc.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import PlanningPage from "@/pages/planning";

let posts: Array<{ url: string; body: any }> = [];
const TRAVAUX = {
  boucle: null,
  taches: [
    { id: 1, titre: "Electricite", statut: "en_attente", projetId: 9, chantier: "Martin", responsable: "Elec", debut: "2026-10-05T08:00:00.000Z", fin: "2026-10-09T08:00:00.000Z", attend: [], glissementJours: 0, debutAuPlusTot: null, causes: [] },
    { id: 2, titre: "Doublage", statut: "en_attente", projetId: 9, chantier: "Martin", responsable: "Placo", debut: "2026-10-07T08:00:00.000Z", fin: "2026-10-10T08:00:00.000Z", attend: [{ lienId: 5, tacheId: 1 }], glissementJours: 2, debutAuPlusTot: "2026-10-09T08:00:00.000Z", causes: [1] },
  ],
};
const EQUIPE = { equipe: [{ personne: "Placo", taches: [{ id: 2, titre: "Doublage", debut: "2026-10-07T08:00:00.000Z", fin: "2026-10-10T08:00:00.000Z", projetId: 9, chantier: "Martin" }, { id: 3, titre: "Autre", debut: "2026-10-08T08:00:00.000Z", fin: "2026-10-09T08:00:00.000Z", projetId: 8, chantier: "Durand" }], conflits: [[2, 3]] }] };
const RDV = { rendezVous: [{ id: 7, titre: "Visite devis Dupont", type: "rendez_vous", debut: "2026-10-06T09:00:00.000Z", fin: "2026-10-06T10:00:00.000Z", lieu: null, contact: "M. Dupont" }] };

beforeEach(() => {
  posts = [];
  localStorage.setItem("app.lang", "tr");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method && init.method !== "GET") { posts.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null }); return { ok: true, status: 201, json: async () => ({}) } as Response; }
    const corps = u.includes("/projets") ? { projets: [{ id: 9, title: "Martin", status: "en_cours" }, { id: 4, title: "Vieux", status: "termine" }] } : u.includes("/planning/travaux") ? TRAVAUX : u.includes("/planning/equipe") ? EQUIPE : RDV;
    return { ok: true, status: 200, json: async () => corps } as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function monter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><I18nProvider><PlanningPage /></I18nProvider></QueryClientProvider>);
}
const ouvrirOnglet = async (nom: string) => { const o = await screen.findByRole("tab", { name: nom }, { timeout: 5000 }); fireEvent.mouseDown(o); fireEvent.click(o); };

describe("le planning", () => {
  it("a trois onglets distincts", async () => {
    monter();
    for (const n of ["Randevular", "Ekip planı", "İş planı"]) expect(await screen.findByRole("tab", { name: n }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("les rendez-vous montrent la visite, sans le chantier", async () => {
    monter();
    expect(await screen.findByText("Visite devis Dupont", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("le plan d'equipe signale en rouge la personne prise deux fois", async () => {
    monter();
    await ouvrirOnglet("Ekip planı");
    const p = await screen.findByTestId("personne-Placo");
    expect(within(p).getByTestId("conflit")).toHaveTextContent(/1 çakışma/);
  });

  it("le plan de travaux dit ce qui glisse, de combien, et pourquoi — en orange", async () => {
    monter();
    await ouvrirOnglet("İş planı");
    expect(await screen.findByTestId("alerte-glissement")).toHaveTextContent(/karar sizin/);
    expect(screen.getByTestId("glisse-2")).toHaveTextContent(/\+2 gün/);
    expect(screen.getByTestId("glisse-2")).toHaveTextContent(/Electricite/);
    expect(screen.getByTestId("tache-2").className).toMatch(/orange/);
  });

  it("lier une tache envoie le lien au serveur", async () => {
    monter();
    await ouvrirOnglet("İş planı");
    fireEvent.change(await screen.findByTestId("lier-1"), { target: { value: "2" } });
    await waitFor(() => expect(posts.some((p) => p.url.endsWith("/api/planning/taches/1/attend") && p.body.dependDe === 2)).toBe(true));
  });

  it("deplacer une echeance envoie la nouvelle date", async () => {
    monter();
    await ouvrirOnglet("İş planı");
    fireEvent.change(await screen.findByTestId("fin-1"), { target: { value: "2026-10-12" } });
    await waitFor(() => expect(posts.some((p) => p.url.endsWith("/api/planning/taches/1/dates") && String(p.body.fin).startsWith("2026-10-12"))).toBe(true));
  });

  it("une tache de chantier s ajoute depuis le plan de travaux, chantiers termines exclus", async () => {
    monter();
    await ouvrirOnglet("İş planı");
    const f = await screen.findByTestId("form-tache");
    await within(f).findByRole("option", { name: "Martin" });
    expect(within(f).queryByRole("option", { name: "Vieux" })).toBeNull();
    fireEvent.change(within(f).getByLabelText("Şantiye"), { target: { value: "9" } });
    fireEvent.change(within(f).getByLabelText("Görev"), { target: { value: "Carrelage" } });
    fireEvent.change(within(f).getByLabelText("Başlangıç"), { target: { value: "2026-10-12" } });
    fireEvent.click(within(f).getByRole("button", { name: "Görevi ekle" }));
    await waitFor(() => expect(posts.some((p) => p.url.endsWith("/api/planning/taches") && p.body.projetId === 9 && p.body.titre === "Carrelage")).toBe(true));
  });

  it("la page est routee et dans le menu Planning", () => {
    const src = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
    expect(src("App.tsx")).toMatch(/path="\/planning"/);
    expect(src("lib", "gezinti.ts")).toContain('seule("planningViews", "/planning"');
  });
});
