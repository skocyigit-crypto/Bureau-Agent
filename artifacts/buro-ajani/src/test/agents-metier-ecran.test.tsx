/**
 * Ajan Bureau : l'ecran rendu, pas lu. Le serveur est simule par `fetch` ; la
 * page, les traductions et les composants sont reels.
 *
 * On verifie : les quatre onglets (et leur clavier), les six profils avec
 * leurs outils, leurs limites et leur regle de passage a un humain, l'essai a
 * blanc qui montre les actions prevues (dont les refus), le quota epuise dit
 * a l'ecran, et la publication reservee aux responsables.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import AjanBureauPage, { type ProfilAgent } from "@/pages/ajan-bureau";

const IDS = ["telephone", "crm", "planning", "chantier", "finance", "coordinateur"] as const;
const NOMS: Record<string, string> = {
  telephone: "Agent telephone", crm: "Agent CRM", planning: "Agent planning",
  chantier: "Agent chantier", finance: "Agent finance", coordinateur: "Coordinateur",
};

function profil(id: string, v: Partial<ProfilAgent> = {}): ProfilAgent {
  return {
    id, nom: NOMS[id]!, mission: `Mission de ${NOMS[id]}`,
    sources: { baseConnaissances: id === "crm" ? ["public", "commercial"] : null, donnees: ["contacts"] },
    transfertHumain: { conditions: [`condition-${id}`], cible: id === "finance" ? "responsable" : "utilisateur" },
    exemple: `Exemple ${id}`, reserveResponsables: id === "finance" || id === "coordinateur",
    outils: id === "crm"
      ? [{ nom: "create_contact", palier: "interne" }, { nom: "send_email", palier: "externe" }, { nom: "list_contacts", palier: "lecture" }]
      : [{ nom: "create_task", palier: "interne" }],
    active: false, publieLe: null, dernierEssai: null, ...v,
  };
}

let profils: ProfilAgent[] = [];
let appels: Array<{ url: string; init?: RequestInit }> = [];
let reponseEssai: { status: number; corps: unknown } = { status: 200, corps: {} };

function reponse(corps: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => corps } as Response;
}

function monter(role = "administrateur") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "Test", prenom: "Ada", role }} onLogout={() => {}}>
          <AjanBureauPage />
        </WorkspaceUserProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const ouvrir = (nom: string) => fireEvent.click(screen.getByRole("tab", { name: nom }));
const posts = () => appels.filter((a) => a.init?.method === "POST");

beforeEach(() => {
  localStorage.setItem("app.lang", "fr");
  appels = [];
  profils = IDS.map((id) => profil(id));
  reponseEssai = {
    status: 200,
    corps: {
      runId: 9, profil: "crm", reponse: "J'aurais cree le contact.",
      actions: [
        { outil: "create_contact", args: {}, palier: "interne", statut: "simulee", resume: "Creer le contact Paul Martin" },
        { outil: "send_email", args: {}, palier: "externe", statut: "approbation", resume: "Envoyer un e-mail a paul@x.fr" },
        { outil: "log_call", args: {}, palier: null, statut: "refusee", raison: "Outil « log_call » hors du profil « Agent CRM »" },
      ],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({ url, init });
    if (url.endsWith("/api/ajans/profils")) return reponse({ profils });
    if (url.endsWith("/essai")) return reponse(reponseEssai.corps, reponseEssai.status);
    if (url.endsWith("/publier")) return reponse({ active: true });
    if (url.endsWith("/desactiver")) return reponse({ active: false });
    return reponse({}, 404);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("Ajan Bureau : quatre onglets", () => {
  it("les quatre onglets existent, Agents est selectionne", async () => {
    monter();
    const onglets = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(onglets).toEqual(["Agents", "Flux", "Travaux", "Test et publication"]);
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
  });

  it("le panneau est relie a son onglet", async () => {
    monter();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "onglet-agents");
    ouvrir("Travaux");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "onglet-runs");
  });

  it("fleches gauche/droite passent d'un onglet a l'autre", async () => {
    monter();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Agents" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Flux" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Flux" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Agents" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Test et publication" })).toHaveAttribute("aria-selected", "true");
  });

  it("Flux : un responsable a les liens vers le studio et les automatisations", async () => {
    monter();
    ouvrir("Flux");
    expect(screen.getByRole("link", { name: "Ouvrir le studio de flux" })).toHaveAttribute("href", "/studio-flux");
    expect(screen.getByRole("link", { name: "Ouvrir les automatisations" })).toBeInTheDocument();
  });

  it("Flux : un agent apprend que seuls les responsables modifient les flux", async () => {
    monter("agent");
    ouvrir("Flux");
    expect(screen.getByText("Seuls les responsables modifient les flux.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ouvrir le studio de flux" })).toBeNull();
  });

  it("Travaux : renvoie aux travaux des agents", async () => {
    monter();
    ouvrir("Travaux");
    expect(screen.getByRole("link", { name: "Ouvrir les travaux des agents" })).toHaveAttribute("href", "/bureau-taches");
  });

  it("onglet Agents : six profils affiches", async () => {
    monter();
    for (const id of IDS) expect(await screen.findByTestId(`profil-${id}`)).toBeInTheDocument();
  });

  it("chaque profil montre ses outils avec palier, et l'approbation des envois", async () => {
    monter();
    const crm = await screen.findByTestId("profil-crm");
    expect(within(crm).getByText("send_email")).toBeInTheDocument();
    expect(within(crm).getByLabelText("soumis à approbation")).toBeInTheDocument();
    expect(within(crm).getByText("create_contact")).toBeInTheDocument();
  });

  it("chaque profil montre sa regle de passage a un humain et sa cible", async () => {
    monter();
    for (const id of IDS) {
      const carte = await screen.findByTestId(`profil-${id}`);
      expect(within(carte).getByText(`condition-${id}`)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("profil-finance")).getByText(/vers un responsable/)).toBeInTheDocument();
  });

  it("limites visibles : reserve aux responsables, publie ou non, sources", async () => {
    profils[1] = profil("crm", { active: true });
    monter();
    expect(within(await screen.findByTestId("profil-finance")).getByText("Réservé aux responsables")).toBeInTheDocument();
    expect(within(screen.getByTestId("profil-crm")).getByText("Publié")).toBeInTheDocument();
    expect(within(screen.getByTestId("profil-telephone")).getByText("Non publié")).toBeInTheDocument();
    expect(within(screen.getByTestId("profil-crm")).getByText(/public, commercial/)).toBeInTheDocument();
  });

  it("erreur de chargement : un message, pas une liste vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponse({ error: "x" }, 500)));
    monter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Les agents n'ont pas pu être chargés.");
  });
});

describe("Test et publication", () => {
  async function ouvrirTest(role = "administrateur") {
    monter(role);
    await screen.findByTestId("profil-crm");
    ouvrir("Test et publication");
  }

  it("l'exemple du profil est pre-rempli et suit le choix du profil", async () => {
    await ouvrirTest();
    expect(screen.getByLabelText("Exemple de demande")).toHaveValue("Exemple telephone");
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "crm" } });
    expect(screen.getByLabelText("Exemple de demande")).toHaveValue("Exemple crm");
  });

  it("l'essai envoie le profil et l'exemple au serveur", async () => {
    await ouvrirTest();
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "crm" } });
    fireEvent.change(screen.getByLabelText("Exemple de demande"), { target: { value: "Nouveau client Paul" } });
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.url).toMatch(/\/api\/ajans\/profils\/crm\/essai$/);
    expect(JSON.parse(String(posts()[0]!.init!.body))).toEqual({ entree: "Nouveau client Paul" });
  });

  it("l'essai montre les actions prevues, leur statut et leur resume", async () => {
    await ouvrirTest();
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    const actions = await screen.findAllByTestId("action-essai");
    expect(actions).toHaveLength(3);
    expect(within(actions[0]!).getByText("aurait été fait")).toBeInTheDocument();
    expect(within(actions[0]!).getByText("Creer le contact Paul Martin")).toBeInTheDocument();
    expect(within(actions[1]!).getByText("aurait attendu une approbation")).toBeInTheDocument();
  });

  it("un outil refuse pendant l'essai est montre comme refuse, avec sa raison", async () => {
    await ouvrirTest();
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    const actions = await screen.findAllByTestId("action-essai");
    expect(within(actions[2]!).getByText("refusé (hors profil)")).toBeInTheDocument();
    expect(within(actions[2]!).getByText(/hors du profil/)).toBeInTheDocument();
  });

  it("la fin de l'essai est annoncee et la reponse de l'agent affichee", async () => {
    await ouvrirTest();
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    expect(await screen.findByText("J'aurais cree le contact.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("status").some((s) => /3 actions décrites/.test(s.textContent ?? ""))).toBe(true));
  });

  it("aucune action : l'ecran le dit", async () => {
    reponseEssai = { status: 200, corps: { runId: 1, profil: "crm", reponse: "", actions: [] } };
    await ouvrirTest();
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    expect(await screen.findByText("L'agent n'aurait appelé aucun outil.")).toBeInTheDocument();
  });

  it("quota epuise : le message du serveur est affiche, pas un essai vide", async () => {
    reponseEssai = { status: 429, corps: { code: "quota_ia", error: "Quota IA epuise : l'essai n'a pas ete lance." } };
    await ouvrirTest();
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Quota IA epuise");
    expect(screen.queryAllByTestId("action-essai")).toHaveLength(0);
  });

  it("publier est desactive pour un agent, meme apres un essai", async () => {
    await ouvrirTest("agent");
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    await screen.findAllByTestId("action-essai");
    expect(screen.getByRole("button", { name: "Publier pour l'organisation" })).toBeDisabled();
    expect(screen.getByText("Seul un responsable peut publier un agent.")).toBeInTheDocument();
  });

  it("pour un responsable, publier attend un essai puis publie", async () => {
    await ouvrirTest();
    const publier = screen.getByRole("button", { name: "Publier pour l'organisation" });
    expect(publier).toBeDisabled();
    expect(screen.getByText("Lancez d'abord un essai réussi.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lancer l'essai à blanc" }));
    await waitFor(() => expect(publier).toBeEnabled());
    fireEvent.click(publier);
    await waitFor(() => expect(posts().some((p) => p.url.endsWith("/api/ajans/profils/telephone/publier"))).toBe(true));
  });

  it("un profil deja essaye cote serveur se publie sans nouvel essai ; un profil publie se desactive", async () => {
    profils[0] = profil("telephone", { dernierEssai: 4, active: true });
    await ouvrirTest();
    expect(screen.getByRole("button", { name: "Publier pour l'organisation" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Désactiver" }));
    await waitFor(() => expect(posts().some((p) => p.url.endsWith("/telephone/desactiver"))).toBe(true));
  });

  it("chaque libelle de l'ecran existe dans les six langues", () => {
    const dir = join(import.meta.dirname, "..", "i18n", "locales");
    const cles = (o: Record<string, unknown>, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? cles(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const fr = cles(JSON.parse(readFileSync(join(dir, "fr.json"), "utf8")).agentBureau);
    expect(fr.length).toBeGreaterThan(30);
    for (const l of ["tr", "en", "es", "de", "ar"]) {
      const j = JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"));
      expect(cles(j.agentBureau).sort(), l).toEqual([...fr].sort());
      expect(j.sidebar.items.agentHub, l).toBeTruthy();
    }
  });
});
