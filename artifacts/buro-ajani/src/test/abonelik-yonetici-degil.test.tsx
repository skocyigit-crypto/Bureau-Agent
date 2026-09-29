/**
 * Page Abonnement (/gestion-licence) pour qui n'est pas administrateur.
 *
 * Quand la licence expire, TOUT utilisateur y est redirige (App.tsx). Un
 * agent y recevait un 403 du serveur, un toast « chargement impossible », et
 * un ecran d'acces qui parlait du « panneau SaaS reserve au super-
 * administrateur » — faux, et sans dire quoi faire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import LicenseManagementPage from "@/pages/license-management";

let appels: string[] = [];
beforeEach(() => {
  appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    appels.push(String(url));
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }));
  localStorage.setItem("app.lang", "fr");
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function monter(role: string) {
  return render(
    <I18nProvider>
      <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "T", prenom: "A", role }} onLogout={() => {}}>
        <LicenseManagementPage />
      </WorkspaceUserProvider>
    </I18nProvider>,
  );
}

describe("la page Abonnement", () => {
  it.each(["agent", "lecture_seule"])("dit a un %s qui gere l'abonnement et quoi faire", async (role) => {
    monter(role);
    expect(await screen.findByText("Abonnement géré par un administrateur")).toBeInTheDocument();
    expect(screen.getByText(/un administrateur doit renouveler l'abonnement/)).toBeInTheDocument();
    expect(screen.queryByText(/super/i)).toBeNull();
  });

  it("ne demande pas au serveur des donnees qu'il refusera", async () => {
    monter("agent");
    await screen.findByText("Abonnement géré par un administrateur");
    expect(appels.filter((u) => u.includes("/license-management/"))).toEqual([]);
  });

  it("charge le tableau de bord pour un administrateur", async () => {
    monter("administrateur");
    await new Promise((r) => setTimeout(r, 50));
    expect(appels.some((u) => u.includes("/api/license-management/dashboard"))).toBe(true);
    expect(screen.queryByText("Abonnement géré par un administrateur")).toBeNull();
  });
});
