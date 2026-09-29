/**
 * File d'approbation a l'ecran (plan du 29/09, section 10).
 *
 * Chaque ligne dit : quoi (nature), sur quelle fiche, qui l'a demande, jusqu'a
 * quand. Une action qui sort du bureau ne se coche pas pour un lot, et son
 * approbation part avec l'empreinte de l'apercu affiche.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n";

vi.mock("@/hooks/use-confirm", () => ({ confirmAction: vi.fn(async () => true) }));

import FileApprobationPage from "@/pages/file-approbation";

const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as Response;
const base = { summary: "Resume", reason: "Devis sans reponse depuis 12 jours", priority: "moyenne", confidence: 0, status: "en_attente", result: {}, createdAt: "2026-09-20T08:00:00.000Z", decidedAt: null, category: "autre", sourceType: "automation_rule" };
const propositions = [
  { ...base, id: 1, toolName: "send_email", title: "Relancer M. Toit", args: { to: "toit@exemple.test", subject: "Devis", body: "Bonjour", contactId: 7 }, nature: "externe", sensible: true, empreinte: "abc123", echeance: "2026-10-04T08:00:00.000Z", dossier: "/contacts/7", demandeur: "Nora Admin" },
  { ...base, id: 2, toolName: "create_task", title: "Tache A", args: { title: "A" }, nature: "interne", sensible: false, empreinte: "t1", echeance: "2026-10-04T08:00:00.000Z", dossier: null, demandeur: null },
  { ...base, id: 3, toolName: "create_task", title: "Tache B", args: { title: "B" }, nature: "interne", sensible: false, empreinte: "t2", echeance: "2026-10-04T08:00:00.000Z", dossier: null, demandeur: null },
  { ...base, id: 4, toolName: "create_contact", title: "Contact C", args: { nom: "C" }, nature: "interne", sensible: false, empreinte: "t3", echeance: "2026-10-04T08:00:00.000Z", dossier: null, demandeur: null },
];
let corpsApprobation: unknown = null;

beforeEach(() => {
  corpsApprobation = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/agent-queue?")) return reponse({ proposals: propositions });
    if (u.endsWith("/api/agent-queue/stats")) return reponse({ pending: 4, byPriority: {}, byCategory: {}, oldestPendingAgeDays: 9, last30d: { approved: 0, rejected: 0, expired: 0, approvalRate: null } });
    if (u.endsWith("/api/agent-queue/1/approve")) { corpsApprobation = JSON.parse(String(init?.body ?? "{}")); return reponse({ ok: true, status: "executee" }); }
    return reponse({});
  }));
  localStorage.setItem("app.lang", "tr");
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

async function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><I18nProvider><FileApprobationPage /></I18nProvider></QueryClientProvider>);
  await screen.findByText("Relancer M. Toit");
  await screen.findAllByText("Kim istedi:", {}, { timeout: 5000 });
}

describe("la file d'approbation", () => {
  it("dit, pour chaque proposition, sa nature, sa fiche, qui l'a demandee et jusqu'a quand", async () => {
    await monter();
    const fiche = screen.getByTestId("fiche-1");
    expect(within(fiche).getByText("müşteriye ya da üçüncü kişiye mesaj")).toBeInTheDocument();
    expect(within(fiche).getByRole("link", { name: "kaydı aç" })).toHaveAttribute("href", "/contacts/7");
    expect(within(fiche).getByText("Nora Admin")).toBeInTheDocument();
    expect(within(fiche).getByText("Son karar:")).toBeInTheDocument();
  });

  it("nomme la source quand aucune personne n'a demande, et dit « aucune fiche »", async () => {
    await monter();
    const fiche = screen.getByTestId("fiche-2");
    expect(within(fiche).getByText("Otomatik kural")).toBeInTheDocument();
    expect(within(fiche).getByText("bağlı kayıt yok")).toBeInTheDocument();
  });

  it("ne laisse pas cocher une action qui sort du bureau, et dit pourquoi", async () => {
    await monter();
    const cases = screen.getAllByRole("checkbox");
    expect(cases[0]).toBeDisabled();
    expect(cases[1]).not.toBeDisabled();
    expect(screen.getAllByText(/tek tek, önizlemesine bakılarak onaylanır/).length).toBeGreaterThan(0);
  });

  it("n'offre l'approbation groupee que pour des actions internes du meme type", async () => {
    await monter();
    const cases = screen.getAllByRole("checkbox");
    fireEvent.click(cases[1]);
    fireEvent.click(cases[2]);
    const barre = () => screen.getByText(/seçildi|selected|sélection/i).parentElement!;
    const approuver = () => within(barre()).getAllByRole("button")[0];
    expect(approuver()).not.toBeDisabled();
    fireEvent.click(cases[3]);
    expect(approuver()).toBeDisabled();
    expect(screen.getByText("Toplu onay: yalnız aynı türden iç işlemler.")).toBeInTheDocument();
  });

  it("approuve une action sensible avec l'empreinte de l'apercu affiche", async () => {
    await monter();
    const carte = screen.getByText("Relancer M. Toit").closest("[class*='overflow-hidden']") as HTMLElement;
    const boutons = within(carte).getAllByRole("button");
    fireEvent.click(boutons.find((b) => /Onayla|Approuver|Approve/.test(b.textContent ?? ""))!);
    await waitFor(() => expect(corpsApprobation).toEqual({ empreinte: "abc123" }));
  });

  it("n'utilise plus le vert pour l'action ni pour le compteur", async () => {
    await monter();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/bg-emerald-600/);
    expect(html).not.toMatch(/rounded-full bg-emerald-500/);
  });
});
