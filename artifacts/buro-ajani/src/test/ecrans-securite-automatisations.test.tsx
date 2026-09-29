/**
 * Parametres > Securite et page Automatisations (lot du 29/09).
 *
 * Securite : les panneaux de surveillance de PLATEFORME ne sont montes que
 * pour le super-administrateur (montes pour un administrateur : cinq 403,
 * dont quatre toutes les 20 s, chacun inscrit au journal d'audit, et un faux
 * « Normal ») ; un echec est dit, pas remplace par un etat vert.
 *
 * Automatisations : la page ne se demonte plus a chaque action (focus et
 * onglet perdus), les etats sont annonces, la selection se fait au clavier,
 * le bouton d'approbation ne change plus la selection, les regles systeme et
 * leur cadence sont dites dans la langue de l'ecran. Serveur simule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import { TabSecurite } from "@/pages/settings/tab-securite";
import AutomationsPage from "@/pages/automations";

const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as Response;
let appels: string[] = [];
let statutSecurite = 200;
let regles: any[] = [];

function monter(noeud: React.ReactNode, role = "administrateur", langue = "fr") {
  localStorage.setItem("app.lang", langue);
  return render(
    <I18nProvider>
      <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "T", prenom: "A", role }} onLogout={() => {}}>
        {noeud}
      </WorkspaceUserProvider>
    </I18nProvider>,
  );
}

const systeme = (id: number, name: string, schedule: string) => ({ id, name, description: "texte serveur", builtIn: true, enabled: true, schedule, trigger: "schedule" });

beforeEach(() => {
  appels = [];
  statutSecurite = 200;
  regles = [
    systeme(-1, "Taches en retard", "1min"),
    systeme(-6, "Projets en retard", "1h"),
    { id: 7, name: "Relance devis", description: "", builtIn: false, enabled: true, schedule: "1h", trigger: "task_overdue", actions: [], requiresApproval: null, runCount: 0 },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    appels.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/api/security/")) return reponse({ error: "Acces reserve au super administrateur." }, statutSecurite);
    if (url.endsWith("/api/auth/mfa/status")) return reponse({ enabled: false });
    if (url.endsWith("/api/automations")) return reponse({ rules: regles });
    if (url.includes("/api/automations/logs")) return reponse({ logs: [], stats: { totalToday: 0, successToday: 0 } });
    if (url.match(/\/api\/automations\/\d+$/) && init?.method === "PATCH") return reponse({ ok: true });
    return reponse({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("Parametres > Securite", () => {
  it("un administrateur ne declenche aucun appel de surveillance de plateforme", async () => {
    monter(<TabSecurite />, "administrateur");
    await screen.findByText("Surveillance de la plateforme");
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(appels.filter((a) => a.includes("/api/security/"))).toEqual([]);
  });
  it("il voit ou trouver ce qui le concerne (journal d'audit)", async () => {
    monter(<TabSecurite />, "administrateur");
    expect(await screen.findByText(/figurent dans le journal d'audit/)).toBeTruthy();
  });
  it("le super-administrateur charge la surveillance", async () => {
    monter(<TabSecurite />, "super_admin");
    await waitFor(() => expect(appels.some((a) => a.includes("/api/security/dashboard"))).toBe(true));
    expect(appels.some((a) => a.includes("/api/security/guardian/stats"))).toBe(true);
  });
  it("un echec est dit, jamais un « Normal » vert", async () => {
    statutSecurite = 500;
    monter(<TabSecurite />, "super_admin");
    const alertes = await screen.findAllByRole("alert");
    expect(alertes.some((a) => /Surveillance indisponible \(réponse 500\)/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.queryByText(/Niveau.*Normal/)).toBeNull();
  });
});

describe("Automatisations", () => {
  it("les regles systeme sont dites dans la langue de l'ecran", async () => {
    monter(<AutomationsPage />, "administrateur", "en");
    expect(await screen.findByText("Overdue tasks")).toBeTruthy();
    expect(screen.getByText("Overdue projects")).toBeTruthy();
    expect(screen.queryByText("Taches en retard")).toBeNull();
  });
  it("la cadence est celle du serveur, pas « toutes les 5 minutes »", async () => {
    monter(<AutomationsPage />);
    await screen.findByText("Tâches en retard");
    expect(screen.getByText("Chaque minute")).toBeTruthy();
    expect(screen.getAllByText("Toutes les heures").length).toBeGreaterThanOrEqual(1);
  });
  it("PENDANT le rechargement qui suit une action, la page et le bouton restent montes (focus garde)", async () => {
    monter(<AutomationsPage />);
    const suspendre = await screen.findByRole("button", { name: /Suspendre/ });
    // Le rechargement reste en suspens : c'est pendant ce temps que l'ancien
    // code remplacait toute la page par un indicateur (bouton detruit, focus
    // perdu). Attendre la fin du rechargement ne l'aurait pas vu.
    let liberer: () => void = () => {};
    const suspendu = new Promise<void>((r) => { liberer = r; });
    const fetchInitial = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/automations") && (init?.method ?? "GET") === "GET") { appels.push(`GET ${url}`); await suspendu; }
      return fetchInitial(url, init);
    }));
    suspendre.focus();
    fireEvent.click(suspendre);
    await waitFor(() => expect(appels.filter((a) => a.endsWith("/api/automations")).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText("Chargement des automatisations…")).toBeNull();
    expect(document.body.contains(suspendre)).toBe(true);
    expect(screen.getByText("Relance devis")).toBeTruthy();
    liberer();
  });
  it("l'action est annoncee dans la region d'etat", async () => {
    monter(<AutomationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Suspendre/ }));
    await waitFor(() => expect(screen.getByTestId("region-annonce").textContent).not.toBe(""));
  });
  it("en mode selection, une vraie case a cocher, nommee", async () => {
    monter(<AutomationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Sélectionner|Selectionner/ }));
    const cases = screen.getAllByRole("checkbox", { name: /Relance devis/ });
    expect(cases).toHaveLength(1);
    fireEvent.click(cases[0]!);
    expect((cases[0] as HTMLInputElement).checked).toBe(true);
  });
  it("le bouton d'approbation ne change pas la selection", async () => {
    monter(<AutomationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Sélectionner|Selectionner/ }));
    const approbation = screen.getByRole("button", { name: /Changer la politique de validation/ });
    fireEvent.click(approbation);
    await waitFor(() => expect(appels.some((a) => a.startsWith("PATCH") && a.endsWith("/api/automations/7"))).toBe(true));
    expect((screen.getByRole("checkbox", { name: /Relance devis/ }) as HTMLInputElement).checked).toBe(false);
  });
});

describe("cles dans les six langues", () => {
  const racine = join(import.meta.dirname, "..");
  const langue = (l: string) => JSON.parse(readFileSync(join(racine, "i18n", "locales", `${l}.json`), "utf8"));
  const fr = langue("fr");
  it.each(["en", "tr", "es", "de", "ar"])("%s : regles systeme, cadences, securite", (l) => {
    const o = langue(l);
    expect(Object.keys(o.automationsPage.builtin).sort()).toEqual(Object.keys(fr.automationsPage.builtin).sort());
    expect(Object.keys(o.automationsPage.cadence).sort()).toEqual(Object.keys(fr.automationsPage.cadence).sort());
    for (const k of ["platformOnlyTitle", "platformOnlyDesc"]) expect(o.settingsSecurite.app[k], k).toBeTruthy();
    expect(o.settingsSecurite.monitor.unavailable).toContain("{{code}}");
  });
});
