/**
 * Catalogue des agents et bureau des taches : les ecrans rendus, pas lus.
 *
 * Le serveur est simule par `fetch` ; la page, les traductions et les
 * composants sont reels. On verifie ce qu'un utilisateur voit et ce qu'un
 * lecteur d'ecran entend : les paliers d'outils, les limites, les statuts,
 * l'annonce apres une demande, et la reserve des couts aux responsables.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import AgentsCataloguePage from "@/pages/agents-catalogue";
import BureauTachesPage from "@/pages/bureau-taches";

const CATALOGUE = {
  agents: [
    {
      id: "agent-support", nom: "Agent support", mission: "Prepare la reponse a une demande d'assistance.",
      modele: "gemini-flash", sources: { baseConnaissances: ["public"], donnees: ["la demande"] },
      outils: [{ nom: "create_task", palier: "interne" }, { nom: "send_email", palier: "externe" }],
      limites: { coutMaxUsdParExecution: 0.05, appelsModeleMax: 1, actionsMax: 3 },
      execution: "orchestrateur", sortie: "brouillon",
      activite30j: { executions: 4, echecs: 1, coutUsd: 0.0123, derniere: null },
    },
    {
      id: "secretaire-autonome", nom: "Secretaire autonome", mission: "Examine l'activite et propose des actions.",
      modele: "gemini-flash", sources: { baseConnaissances: null, donnees: ["taches"] },
      outils: [], limites: null, execution: "cron", sortie: "propositions",
      activite30j: { executions: 0, echecs: 0, coutUsd: 0, derniere: null },
    },
  ],
};

const EXECUTION = {
  id: 42, agentId: "classificateur", trigger: "demande_manuelle", status: "en_attente",
  input: { canal: "formulaire", sujet: "Facture erronee", expediteur: "claire@exemple.test", extrait: "..." },
  output: null, error: null, costUsd: 0.001, inputTokens: 100, outputTokens: 50,
  startedAt: new Date().toISOString(), finishedAt: null, specialiste: "agent-support", coutTotalUsd: 0.002,
};

let appels: Array<{ url: string; init?: RequestInit }> = [];

function reponse(corps: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => corps } as Response;
}

function monter(page: ReactNode, role = "administrateur") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "Test", prenom: "Ada", role }} onLogout={() => {}}>
          {page}
        </WorkspaceUserProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // jsdom annonce l'anglais : la page chargerait l'anglais apres coup et
  // changerait de langue en cours de test. On fixe le francais, langue
  // des libelles verifies.
  localStorage.setItem("app.lang", "fr");
  appels = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    if (url.endsWith("/api/ajans/catalogue")) return reponse(CATALOGUE);
    if (url.includes("/api/ajans/executions?")) return reponse({ executions: [EXECUTION], compteurs: { en_cours: 0, en_attente: 1, terminee: 3, echouee: 1 } });
    if (url.includes("/api/ajans/executions/")) return reponse({ execution: { ...EXECUTION, etapes: [] }, enfants: [], approbations: [], coutTotalUsd: 0.002 });
    if (url.includes("/api/ajans/couts")) return reponse({ jours: 30, parAgent: [], totalUsd: 0, quotaMensuel: { used: { costUsd: 1, calls: 3 }, limits: { maxCostUsdPerMonth: 20, maxCallsPerMonth: 1000 }, percentCost: 5 } });
    if (url.endsWith("/api/ajans/demandes")) return reponse({ runId: 43, statut: "en_attente", type: "support", agent: "agent-support", actionsEnAttente: 1, actionsExecutees: 1, actionsRefusees: 0, erreur: null }, 201);
    return reponse({}, 404);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("catalogue des agents", () => {
  it("montre les outils avec leur palier, et signale ce qui passe en approbation", async () => {
    monter(<AgentsCataloguePage />);
    const carte = await screen.findByTestId("agent-agent-support");
    expect(within(carte).getByText("send_email")).toBeInTheDocument();
    expect(within(carte).getByLabelText("soumis à approbation")).toBeInTheDocument();
    expect(within(carte).getByText("(sortant)")).toBeInTheDocument();
  });

  it("montre les limites appliquees, ou dit qu'elles relevent du module", async () => {
    monter(<AgentsCataloguePage />);
    expect(within(await screen.findByTestId("agent-agent-support")).getByText("0.05 $")).toBeInTheDocument();
    expect(within(await screen.findByTestId("agent-secretaire-autonome")).getByText("Gérées par son propre module.")).toBeInTheDocument();
  });

  it("un agent sans outil le dit, au lieu d'une liste vide", async () => {
    monter(<AgentsCataloguePage />);
    expect(within(await screen.findByTestId("agent-secretaire-autonome")).getByText("Aucun outil : il ne fait que lire et décider.")).toBeInTheDocument();
  });

  it("le nombre d'agents est annonce aux lecteurs d'ecran", async () => {
    monter(<AgentsCataloguePage />);
    await screen.findByTestId("agent-agent-support");
    expect(screen.getByRole("status")).toHaveTextContent("2 agents");
  });
});

describe("bureau des taches", () => {
  it("liste les executions avec leur statut et leur agent", async () => {
    monter(<BureauTachesPage />);
    expect(await screen.findByText("Facture erronee")).toBeInTheDocument();
    const ligne = screen.getByText("Facture erronee").closest("tr")!;
    expect(within(ligne).getByText("agent-support")).toBeInTheDocument();
    expect(within(ligne).getByText("En attente d'approbation")).toBeInTheDocument();
  });

  it("les filtres de statut portent leur compteur et leur etat presse", async () => {
    monter(<BureauTachesPage />);
    const bouton = await screen.findByRole("button", { name: /En erreur \(1\)/ });
    expect(bouton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /En attente d'approbation \(1\)/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("changer de filtre relit le serveur avec le nouveau statut", async () => {
    monter(<BureauTachesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /En erreur/ }));
    await waitFor(() => expect(appels.some((a) => a.url.includes("statut=echouee"))).toBe(true));
  });

  it("une demande soumise part en POST et le resultat est annonce", async () => {
    monter(<BureauTachesPage />);
    fireEvent.change(await screen.findByLabelText("Message reçu"), { target: { value: "Ma facture est fausse" } });
    fireEvent.change(screen.getByLabelText("E-mail de l'expéditeur"), { target: { value: "claire@exemple.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Traiter la demande" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/1 action\(s\) en attente d'approbation/));
    const post = appels.find((a) => a.url.endsWith("/api/ajans/demandes"))!;
    expect(post.init?.method).toBe("POST");
    expect(JSON.parse(String(post.init?.body))).toMatchObject({ canal: "formulaire", contenu: "Ma facture est fausse", expediteur: { email: "claire@exemple.test" } });
  });

  it("le bouton de soumission reste inactif tant que le message est vide", async () => {
    monter(<BureauTachesPage />);
    expect(await screen.findByRole("button", { name: "Traiter la demande" })).toBeDisabled();
  });

  it("les couts ne sont pas demandes pour un employe", async () => {
    monter(<BureauTachesPage />, "agent");
    await screen.findByText("Facture erronee");
    expect(appels.some((a) => a.url.includes("/api/ajans/couts"))).toBe(false);
  });

  it("un responsable voit le quota du mois", async () => {
    monter(<BureauTachesPage />);
    expect(await screen.findByText(/Quota IA du mois : 1.00 \$ \/ 20 \$/)).toBeInTheDocument();
  });

  it("le detail s'ouvre dans une boite de dialogue titree", async () => {
    monter(<BureauTachesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Voir le détail : Facture erronee" }));
    expect(await screen.findByRole("dialog", { name: "Exécution n° 42" })).toBeInTheDocument();
  });
});

describe("les deux ecrans sont atteignables", () => {
  const src = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
  it("routes declarees et entrees de menu presentes", () => {
    expect(src("App.tsx")).toMatch(/path="\/agents-catalogue"/);
    expect(src("App.tsx")).toMatch(/path="\/bureau-taches"/);
    expect(src("components", "layout.tsx")).toMatch(/href: "\/bureau-taches"/);
    expect(src("components", "layout.tsx")).toMatch(/href: "\/agents-catalogue"/);
  });
});
