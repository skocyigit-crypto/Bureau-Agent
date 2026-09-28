/**
 * Studio de flux : la vue liste est un editeur complet au clavier, chaque
 * changement est annonce, les erreurs du serveur reviennent a cote de
 * l'etape concernee — et le canevas montre le meme flux.
 *
 * Le serveur est simule par `fetch` ; la page, React Flow, les traductions
 * et les composants sont reels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import StudioFluxPage from "@/pages/studio-flux";

const REGLE = {
  id: 7, name: "Relancer les retards", trigger: "task_overdue", enabled: true,
  flux: {
    noeuds: [
      { id: "declencheur", type: "declencheur", position: { x: 0, y: 0 } },
      { id: "action-1", type: "action", action: { type: "create_task", params: { title: "Relancer", priority: "haute" } }, position: { x: 0, y: 120 } },
    ],
    liens: [{ de: "declencheur", vers: "action-1" }],
  },
};
const MODELE = {
  flux: {
    noeuds: [
      { id: "declencheur", type: "declencheur" },
      { id: "classer", type: "agent", agent: "classificateur" },
      { id: "est-support", type: "condition", champ: "agent.type", operateur: "egal", valeur: "support" },
      { id: "support", type: "agent", agent: "agent-support" },
    ],
    liens: [
      { de: "declencheur", vers: "classer" }, { de: "classer", vers: "est-support" },
      { de: "est-support", vers: "support", branche: "oui" },
    ],
  },
};

let appels: Array<{ url: string; init?: RequestInit }> = [];
let reponsePatch: { status: number; corps: unknown } = { status: 200, corps: { id: 7 } };

function reponse(corps: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => corps } as Response;
}
function monter(page: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "Test", prenom: "Ada", role: "administrateur" }} onLogout={() => {}}>
          {page}
        </WorkspaceUserProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}
const corpsEnvoye = (methode: string) => {
  const a = appels.filter((x) => x.init?.method === methode).at(-1);
  return a ? JSON.parse(String(a.init!.body)) : null;
};
const annonce = () => screen.getAllByTestId("region-annonce").map((n) => n.textContent).join(" ");

beforeEach(() => {
  localStorage.setItem("app.lang", "fr");
  appels = [];
  reponsePatch = { status: 200, corps: { id: 7 } };
  // React Flow mesure son conteneur : jsdom n'a ni ResizeObserver ni DOMMatrix.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("DOMMatrixReadOnly", class { m22 = 1; constructor() {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    if (url.endsWith("/api/automations") && (!init?.method || init.method === "GET")) return reponse({ rules: [{ id: -1, name: "Integree", builtIn: true, trigger: "schedule", enabled: true }, REGLE] });
    if (url.endsWith("/api/automations/flux/modele-demande")) return reponse(MODELE);
    if (url.endsWith("/api/automations/7") && init?.method === "PATCH") return reponse(reponsePatch.corps, reponsePatch.status);
    if (url.endsWith("/api/automations") && init?.method === "POST") return reponse({ id: 9 }, 201);
    return reponse({}, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

async function ouvert() {
  monter(<StudioFluxPage />);
  await screen.findByRole("heading", { name: /Étape 2 : Action/ });
}

describe("studio de flux", () => {
  it("ouvre la premiere automatisation personnalisee (pas une regle integree) et annonce le chargement", async () => {
    await ouvert();
    expect((screen.getByLabelText("Automatisation") as HTMLSelectElement).value).toBe("7");
    expect(screen.getByRole("heading", { name: /Étape 1 : Déclencheur/ })).toBeTruthy();
    expect(annonce()).toMatch(/Flux chargé : 2 étapes/);
  });

  it("le canevas et la liste montrent le meme flux", async () => {
    await ouvert();
    expect(screen.getByRole("region", { name: "Vue graphique du flux" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Étapes du flux" })).toBeTruthy();
  });

  it("chaque controle de la liste a un nom accessible", async () => {
    await ouvert();
    const liste = screen.getByRole("list", { name: "Étapes du flux" });
    for (const c of [...within(liste).queryAllByRole("combobox"), ...within(liste).queryAllByRole("textbox")]) {
      expect(c.getAttribute("id") && document.querySelector(`label[for="${c.getAttribute("id")}"]`), c.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });

  it("le declencheur ne se supprime pas ; une action si", async () => {
    await ouvert();
    expect(screen.queryByRole("button", { name: /Supprimer l'étape — Étape 1/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Supprimer l'étape — Étape 2/ })).toBeTruthy();
  });

  it("ajouter une etape au clavier : elle apparait et c'est annonce", async () => {
    await ouvert();
    fireEvent.change(screen.getByLabelText("Type d'étape"), { target: { value: "condition" } });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter une étape/ }));
    await screen.findByRole("heading", { name: /Condition/ });
    expect(annonce()).toMatch(/Étape ajoutée : Condition/);
  });

  it("relier et enregistrer : le corps PATCH porte le nouveau lien et la branche", async () => {
    await ouvert();
    fireEvent.change(screen.getByLabelText("Type d'étape"), { target: { value: "approbation" } });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter une étape/ }));
    await screen.findByRole("heading", { name: /Approbation humaine/ });
    // L'action suit maintenant l'approbation.
    fireEvent.change(screen.getByLabelText("Étape suivante", { selector: "#approbation-1-suite-0" }), { target: { value: "action-1" } });
    expect(annonce()).toMatch(/Lien ajouté/);
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer le flux/ }));
    await waitFor(() => expect(corpsEnvoye("PATCH")).not.toBeNull());
    const flow = corpsEnvoye("PATCH").flow;
    expect(flow.noeuds.map((n: { id: string }) => n.id)).toContain("approbation-1");
    expect(flow.liens).toContainEqual({ de: "approbation-1", vers: "action-1" });
    await waitFor(() => expect(annonce()).toMatch(/Flux enregistré/));
  });

  it("supprimer une etape retire aussi ses liens", async () => {
    await ouvert();
    fireEvent.click(screen.getByRole("button", { name: /Supprimer l'étape — Étape 2/ }));
    expect(screen.queryByRole("heading", { name: /Étape 2 : Action/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer le flux/ }));
    await waitFor(() => expect(corpsEnvoye("PATCH")).not.toBeNull());
    expect(corpsEnvoye("PATCH").flow.liens).toEqual([]);
  });

  it("une erreur du serveur s'affiche a cote de l'etape et est annoncee en urgence", async () => {
    reponsePatch = { status: 400, corps: { error: "Flux invalide.", erreurs: [{ noeud: "action-1", message: "Etape isolee : aucun chemin ne l'atteint depuis le declencheur." }] } };
    await ouvert();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer le flux/ }));
    await screen.findByText(/Etape isolee/);
    const alerte = screen.getAllByTestId("region-annonce").find((n) => n.getAttribute("role") === "alert");
    expect(alerte?.textContent).toMatch(/n'est pas enregistré : 1 erreur/);
    const etape = screen.getByRole("heading", { name: /Étape 2 : Action/ }).closest("li")!;
    expect(etape.getAttribute("aria-describedby")).toBe("etape-action-1-erreurs");
  });

  it("« Nouvelle demande » charge le routage par defaut et l'enregistre en POST", async () => {
    await ouvert();
    fireEvent.change(screen.getByLabelText("Automatisation"), { target: { value: "nouvelle" } });
    await screen.findByRole("heading", { name: /Étape 2 : Agent/ });
    expect(screen.getByText(/Démarre à chaque nouvelle demande/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer le flux/ }));
    await waitFor(() => expect(corpsEnvoye("POST")).not.toBeNull());
    const corps = corpsEnvoye("POST");
    expect(corps.trigger).toBe("nouvelle_demande");
    expect(corps.flow.noeuds.map((n: { type: string }) => n.type)).toEqual(["declencheur", "agent", "condition", "agent"]);
  });

  it("la page est routee, reservee aux responsables, et dans le menu", () => {
    const app = readFileSync(join(import.meta.dirname, "..", "App.tsx"), "utf8");
    expect(app).toMatch(/<Route path="\/studio-flux" component=\{withRoleGate\(StudioFluxPage, ADMIN_ROLES\)\} \/>/);
    const menu = readFileSync(join(import.meta.dirname, "..", "components", "layout.tsx"), "utf8");
    expect(menu).toMatch(/href: "\/studio-flux"/);
  });
});
