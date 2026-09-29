/**
 * Page Devis : facturer et ouvrir le chantier, seulement sur un devis accepte.
 *
 * Le bouton « Facture » s'offrait sur chaque ligne, brouillon et refuse
 * compris — le serveur refuse desormais (409), l'ecran ne doit plus proposer
 * la porte. « Ouvrir le chantier » est le geste explicite qui fait passer un
 * devis accepte a l'execution (plan du 29/09, section 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter", async (orig) => ({ ...(await orig<typeof import("wouter")>()), useLocation: () => ["/devis", navigate] }));

import AdminDevisPage from "@/pages/admin-devis";

const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as Response;
const devis = (id: number, status: string) => ({ id, reference: `DV-${id}`, title: `Devis ${id}`, clientName: "Client", status, totalAmount: "1000", currency: "EUR", createdAt: "2026-09-20T10:00:00.000Z" });
let appels: string[] = [];
let reponseChantier: { status: number; corps: unknown };

beforeEach(() => {
  appels = [];
  navigate.mockReset();
  reponseChantier = { status: 201, corps: { projet: { id: 9, title: "Devis 3" } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    appels.push(`${init?.method ?? "GET"} ${url}`);
    if (String(url).includes("/api/devis?")) return reponse({ devis: [devis(1, "brouillon"), devis(2, "envoye"), devis(3, "accepte"), devis(4, "refuse")], total: 4 });
    if (String(url).endsWith("/api/devis/3/chantier")) return reponse(reponseChantier.corps, reponseChantier.status);
    return reponse({});
  }));
  localStorage.setItem("app.lang", "fr");
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

async function monter() {
  render(<I18nProvider><AdminDevisPage /></I18nProvider>);
  await screen.findByText("Devis 3");
}

describe("la page Devis", () => {
  it("ne propose facturer ni ouvrir le chantier que sur le devis accepte", async () => {
    await monter();
    for (const id of [1, 2, 4]) {
      expect(screen.queryByTestId(`facturer-${id}`), `devis ${id}`).toBeNull();
      expect(screen.queryByTestId(`ouvrir-chantier-${id}`), `devis ${id}`).toBeNull();
    }
    expect(screen.getByTestId("facturer-3")).toBeInTheDocument();
    expect(screen.getByTestId("ouvrir-chantier-3")).toHaveTextContent("Ouvrir le chantier");
  });

  it("ouvre le chantier par la route dediee, puis mene aux chantiers", async () => {
    await monter();
    fireEvent.click(screen.getByTestId("ouvrir-chantier-3"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projets"));
    expect(appels).toContain("POST /api/devis/3/chantier");
  });

  it("un refus du serveur reste a l'ecran, sans navigation", async () => {
    reponseChantier = { status: 409, corps: { error: "Seul un devis accepte ouvre un chantier.", code: "devis_non_accepte" } };
    await monter();
    fireEvent.click(screen.getByTestId("ouvrir-chantier-3"));
    await waitFor(() => expect(appels).toContain("POST /api/devis/3/chantier"));
    await new Promise((r) => setTimeout(r, 50));
    expect(navigate).not.toHaveBeenCalled();
  });
});
