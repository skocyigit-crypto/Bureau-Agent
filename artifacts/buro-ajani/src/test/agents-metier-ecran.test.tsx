/**
 * Ajan Bureau et selecteur de profil de l'assistant : l'ecran rendu, pas lu.
 * Le serveur est simule par `fetch` ; les pages, les traductions et les
 * composants sont reels.
 *
 * On verifie : les quatre onglets (et leur clavier), les six profils avec
 * leurs outils, leurs limites et leur regle de passage a un humain (traduits),
 * l'essai a blanc qui montre les actions prevues (dont les refus), les codes
 * d'erreur du serveur rendus dans la langue de l'ecran, le bouton « Essai »
 * desactive pour un role que le serveur refuse, l'activation reservee aux
 * responsables — et, cote assistant, le choix du profil envoye a la creation
 * d'une conversation (decisions B et F de la revue du lot 3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import AjanBureauPage, { type ProfilAgent } from "@/pages/ajan-bureau";
import AsistanPage from "@/pages/asistan";

// L'avatar parlant (canvas, synthese vocale) n'a rien a voir avec le choix du
// profil ; jsdom ne sait pas le dessiner.
vi.mock("@workspace/ai-avatar", () => ({ TalkingAvatar: () => null }));
// Les toasts de l'assistant sont lus tels qu'ils partent (pas de <Toaster/> monte ici).
const toasts = vi.hoisted(() => [] as Array<{ title?: string; description?: string }>);
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (x: { title?: string; description?: string }) => { toasts.push(x); } }) }));

const DIR = join(import.meta.dirname, "..", "i18n", "locales");
const LOC = (l: string) => JSON.parse(readFileSync(join(DIR, `${l}.json`), "utf8"));
const FR = LOC("fr");
const EN = LOC("en");

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
    // Actif par defaut (decision A) : l'absence de reglage vaut actif.
    active: true, publieLe: null, dernierEssai: null, roleAutorise: true, peutEssayer: true, ...v,
  };
}

let profils: ProfilAgent[] = [];
let appels: Array<{ url: string; init?: RequestInit }> = [];
let reponseEssai: { status: number; corps: unknown } = { status: 200, corps: {} };
let reponsePublier: { status: number; corps: unknown } = { status: 200, corps: { active: true } };

function reponse(corps: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => corps } as Response;
}

function monter(role = "administrateur", page: "bureau" | "asistan" = "bureau") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "Test", prenom: "Ada", role }} onLogout={() => {}}>
          {page === "bureau" ? <AjanBureauPage /> : <AsistanPage />}
        </WorkspaceUserProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const ouvrir = (nom: string) => fireEvent.click(screen.getByRole("tab", { name: nom }));
const posts = () => appels.filter((a) => a.init?.method === "POST");

beforeEach(() => {
  // jsdom n'implemente pas scrollTo (la page assistant fait defiler la conversation).
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  localStorage.setItem("app.lang", "fr");
  appels = [];
  toasts.length = 0;
  profils = IDS.map((id) => profil(id));
  reponsePublier = { status: 200, corps: { active: true } };
  reponseEssai = {
    status: 200,
    corps: {
      runId: 9, profil: "crm", reponse: "J'aurais cree le contact.", valide: true, incomplet: false,
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
    if (url.endsWith("/publier")) return reponse(reponsePublier.corps, reponsePublier.status);
    if (url.endsWith("/desactiver")) return reponse({ active: false });
    if (url.endsWith("/api/assistant/conversations")) return reponse({ conversations: [] });
    if (url.endsWith("/api/assistant/chat")) return reponse({ error: "stop" }, 500);
    return reponse({}, 404);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); localStorage.setItem("app.lang", "fr"); });

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

  it("onglet Agents : six profils affiches, noms et missions traduits", async () => {
    monter();
    for (const id of IDS) {
      const carte = await screen.findByTestId(`profil-${id}`);
      expect(within(carte).getByRole("heading", { level: 2 })).toHaveTextContent(FR.agentBureau.profiles[id].nom);
      expect(within(carte).getByText(FR.agentBureau.profiles[id].mission)).toBeInTheDocument();
    }
  });

  it("chaque profil montre ses outils avec palier, et l'approbation des envois", async () => {
    monter();
    const crm = await screen.findByTestId("profil-crm");
    expect(within(crm).getByText("send_email")).toBeInTheDocument();
    expect(within(crm).getByLabelText("soumis à approbation")).toBeInTheDocument();
    expect(within(crm).getByText("create_contact")).toBeInTheDocument();
  });

  it("chaque profil montre sa regle de passage a un humain (traduite) et sa cible", async () => {
    monter();
    for (const id of IDS) {
      const carte = await screen.findByTestId(`profil-${id}`);
      expect(within(carte).getByText(FR.agentBureau.profiles[id].handoff["0"])).toBeInTheDocument();
    }
    expect(within(screen.getByTestId("profil-finance")).getByText(/vers un responsable/)).toBeInTheDocument();
  });

  it("F : une cle de traduction absente retombe sur le texte du serveur, pas sur la cle", async () => {
    profils[1] = profil("crm", { transfertHumain: { conditions: ["c0", "c1", "c2", "c3", "cinquieme-sans-cle"], cible: "utilisateur" } });
    monter();
    const crm = await screen.findByTestId("profil-crm");
    expect(within(crm).getByText("cinquieme-sans-cle")).toBeInTheDocument();
    expect(within(crm).queryByText(/agentBureau\.profiles/)).toBeNull();
  });

  it("limites visibles : reserve aux responsables, actif ou desactive, sources", async () => {
    profils[0] = profil("telephone", { active: false });
    monter();
    expect(within(await screen.findByTestId("profil-finance")).getByText("Réservé aux responsables")).toBeInTheDocument();
    expect(within(screen.getByTestId("profil-crm")).getByText("Actif")).toBeInTheDocument();
    expect(within(screen.getByTestId("profil-telephone")).getByText("Désactivé")).toBeInTheDocument();
    expect(within(screen.getByTestId("profil-crm")).getByText(/public, commercial/)).toBeInTheDocument();
  });

  it("erreur de chargement : un message, pas une liste vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponse({ error: "x" }, 500)));
    monter();
    expect(await screen.findByRole("alert")).toHaveTextContent("Les agents n'ont pas pu être chargés.");
  });
});

describe("Test et publication", () => {
  async function ouvrirTest(role = "administrateur", onglet = "Test et publication") {
    monter(role);
    await screen.findByTestId("profil-crm");
    // Une langue autre que le francais se charge a la demande : attendre l'onglet traduit.
    fireEvent.click(await screen.findByRole("tab", { name: onglet }));
  }
  const lancer = (nom = "Lancer l'essai à blanc") => screen.getByRole("button", { name: nom });

  it("l'exemple du profil (traduit) est pre-rempli et suit le choix du profil", async () => {
    await ouvrirTest();
    expect(screen.getByLabelText("Exemple de demande")).toHaveValue(FR.agentBureau.profiles.telephone.exemple);
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "crm" } });
    expect(screen.getByLabelText("Exemple de demande")).toHaveValue(FR.agentBureau.profiles.crm.exemple);
  });

  it("l'essai envoie le profil et l'exemple au serveur", async () => {
    await ouvrirTest();
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "crm" } });
    fireEvent.change(screen.getByLabelText("Exemple de demande"), { target: { value: "Nouveau client Paul" } });
    fireEvent.click(lancer());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.url).toMatch(/\/api\/ajans\/profils\/crm\/essai$/);
    expect(JSON.parse(String(posts()[0]!.init!.body))).toEqual({ entree: "Nouveau client Paul" });
  });

  it("l'essai montre les actions prevues, leur statut et leur resume", async () => {
    await ouvrirTest();
    fireEvent.click(lancer());
    const actions = await screen.findAllByTestId("action-essai");
    expect(actions).toHaveLength(3);
    expect(within(actions[0]!).getByText("aurait été fait")).toBeInTheDocument();
    expect(within(actions[0]!).getByText("Creer le contact Paul Martin")).toBeInTheDocument();
    expect(within(actions[1]!).getByText("aurait attendu une approbation")).toBeInTheDocument();
  });

  it("un outil refuse pendant l'essai est montre comme refuse, avec sa raison", async () => {
    await ouvrirTest();
    fireEvent.click(lancer());
    const actions = await screen.findAllByTestId("action-essai");
    expect(within(actions[2]!).getByText("refusé (hors profil)")).toBeInTheDocument();
    expect(within(actions[2]!).getByText(/hors du profil/)).toBeInTheDocument();
  });

  it("la fin de l'essai est annoncee et la reponse de l'agent affichee", async () => {
    await ouvrirTest();
    fireEvent.click(lancer());
    expect(await screen.findByText("J'aurais cree le contact.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("status").some((s) => /3 actions décrites/.test(s.textContent ?? ""))).toBe(true));
  });

  it("D : essai sans action valide — l'ecran dit qu'il ne compte pas", async () => {
    reponseEssai = { status: 200, corps: { runId: 1, profil: "crm", reponse: "", actions: [], valide: false, incomplet: false } };
    await ouvrirTest();
    fireEvent.click(lancer());
    expect(await screen.findByText("L'agent n'aurait appelé aucun outil.")).toBeInTheDocument();
    expect(screen.getByTestId("essai-non-valide")).toHaveTextContent(FR.agentBureau.test.invalid);
  });

  it("F : quota epuise — le code est traduit (francais avec accents), pas le texte brut du serveur", async () => {
    reponseEssai = { status: 429, corps: { code: "quota_ia", error: "Quota IA epuise : texte serveur" } };
    await ouvrirTest();
    fireEvent.click(lancer());
    const alerte = await screen.findByRole("alert");
    expect(alerte).toHaveTextContent(FR.agentErrors.quota_ia);
    expect(alerte).not.toHaveTextContent("texte serveur");
    expect(screen.queryAllByTestId("action-essai")).toHaveLength(0);
  });

  it("F : en anglais, quota_ia et profil_role s'affichent en anglais", async () => {
    localStorage.setItem("app.lang", "en");
    reponseEssai = { status: 429, corps: { code: "quota_ia", error: "Quota IA epuise" } };
    await ouvrirTest("administrateur", EN.agentBureau.tabs.test);
    fireEvent.click(lancer(EN.agentBureau.test.run));
    expect(await screen.findByRole("alert")).toHaveTextContent(EN.agentErrors.quota_ia);
    reponseEssai = { status: 403, corps: { code: "profil_role", error: "Le profil est reserve aux responsables." } };
    fireEvent.click(lancer(EN.agentBureau.test.run));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(EN.agentErrors.profil_role));
  });

  it("F : un code inconnu retombe sur le message du serveur", async () => {
    reponseEssai = { status: 502, corps: { code: "nouveau_code", error: "Message serveur." } };
    await ouvrirTest();
    fireEvent.click(lancer());
    expect(await screen.findByRole("alert")).toHaveTextContent("Message serveur.");
  });

  it("F : le bouton Essai est desactive pour un profil que le serveur refuserait a ce role, avec la raison", async () => {
    profils[4] = profil("finance", { roleAutorise: false, peutEssayer: false });
    await ouvrirTest("agent");
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "finance" } });
    expect(lancer()).toBeDisabled();
    expect(lancer()).toHaveAttribute("aria-describedby", "essai-role-aide");
    expect(screen.getByText(FR.agentBureau.test.roleRefused)).toBeInTheDocument();
    fireEvent.click(lancer());
    expect(posts()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "crm" } });
    expect(lancer()).toBeEnabled();
  });

  it("A : un profil actif se desactive ; un profil desactive se reactive sans essai prealable", async () => {
    profils[0] = profil("telephone", { active: false });
    await ouvrirTest();
    const activer = screen.getByRole("button", { name: FR.agentBureau.test.publish });
    expect(activer).toBeEnabled();
    fireEvent.click(activer);
    await waitFor(() => expect(posts().some((p) => p.url.endsWith("/api/ajans/profils/telephone/publier"))).toBe(true));
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "crm" } });
    fireEvent.click(screen.getByRole("button", { name: "Désactiver" }));
    await waitFor(() => expect(posts().some((p) => p.url.endsWith("/crm/desactiver"))).toBe(true));
  });

  it("activer est desactive pour un agent, avec la raison", async () => {
    profils[0] = profil("telephone", { active: false });
    await ouvrirTest("agent");
    expect(screen.getByRole("button", { name: FR.agentBureau.test.publish })).toBeDisabled();
    expect(screen.getByText("Seul un responsable peut publier un agent.")).toBeInTheDocument();
  });

  it("F : l'erreur d'activation reste sous le profil concerne et est traduite", async () => {
    profils[0] = profil("telephone", { active: false });
    reponsePublier = { status: 403, corps: { code: "profil_desactive", error: "x" } };
    await ouvrirTest();
    fireEvent.click(screen.getByRole("button", { name: FR.agentBureau.test.publish }));
    expect(await screen.findByRole("alert")).toHaveTextContent(FR.agentErrors.profil_desactive);
    fireEvent.change(screen.getByLabelText("Agent à essayer"), { target: { value: "crm" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("chaque libelle de l'ecran existe dans les six langues", () => {
    const cles = (o: Record<string, unknown>, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? cles(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));
    const fr = cles(FR.agentBureau);
    const frErr = cles(FR.agentErrors);
    const frProfil = cles(FR.asistan.profile);
    expect(fr.length).toBeGreaterThan(30);
    expect(frErr).toEqual(expect.arrayContaining(["quota_ia", "essai_requis", "profil_role", "profil_desactive", "profil_inconnu", "action_anterieure_profils"]));
    for (const l of ["tr", "en", "es", "de", "ar"]) {
      const j = LOC(l);
      expect(cles(j.agentBureau).sort(), l).toEqual([...fr].sort());
      expect(cles(j.agentErrors).sort(), l).toEqual([...frErr].sort());
      expect(cles(j.asistan.profile).sort(), l).toEqual([...frProfil].sort());
      // Traduit, pas recopie : le message de quota differe du francais.
      expect(j.agentErrors.quota_ia, l).not.toBe(FR.agentErrors.quota_ia);
      expect(j.sidebar.items.agentHub, l).toBeTruthy();
    }
  });
});

describe("Assistant : choix du profil (decision B)", () => {
  const selecteur = () => screen.getByTestId("select-assistant-profile") as HTMLSelectElement;

  it("liste l'assistant general puis les seuls profils actifs que ce role peut ouvrir", async () => {
    profils = [
      profil("crm"),
      profil("telephone", { active: false }),
      profil("finance", { roleAutorise: false, peutEssayer: false }),
    ];
    monter("agent", "asistan");
    await waitFor(() => expect(selecteur().options.length).toBe(2));
    expect([...selecteur().options].map((o) => o.value)).toEqual(["assistant", "crm"]);
    expect(selecteur().value).toBe("assistant");
    expect([...selecteur().options].map((o) => o.textContent)).toEqual([FR.asistan.profile.assistant, FR.agentBureau.profiles.crm.nom]);
  });

  it("le profil choisi part avec la premiere question (creation de la conversation)", async () => {
    monter("agent", "asistan");
    await waitFor(() => expect(selecteur().options.length).toBeGreaterThan(1));
    fireEvent.change(selecteur(), { target: { value: "crm" } });
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "Ajoute Paul Martin" } });
    fireEvent.click(screen.getByTestId("button-send-assistant"));
    await waitFor(() => expect(posts().some((p) => p.url.endsWith("/api/assistant/chat"))).toBe(true));
    const corps = JSON.parse(String(posts().find((p) => p.url.endsWith("/api/assistant/chat"))!.init!.body));
    expect(corps).toEqual({ message: "Ajoute Paul Martin", profil: "crm" });
  });

  it("sans choix, l'assistant general est envoye ; un refus du serveur est traduit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      appels.push({ url, init });
      if (url.endsWith("/api/ajans/profils")) return reponse({ profils });
      if (url.endsWith("/api/assistant/conversations")) return reponse({ conversations: [] });
      if (url.endsWith("/api/assistant/chat")) return reponse({ code: "profil_role", error: "texte serveur" }, 403);
      return reponse({}, 404);
    }));
    monter("agent", "asistan");
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByTestId("button-send-assistant"));
    await waitFor(() => expect(posts().some((p) => p.url.endsWith("/api/assistant/chat"))).toBe(true));
    expect(JSON.parse(String(posts().find((p) => p.url.endsWith("/api/assistant/chat"))!.init!.body))).toEqual({ message: "Bonjour", profil: "assistant" });
    await waitFor(() => expect(toasts.map((x) => x.description)).toContain(FR.agentErrors.profil_role));
    expect(toasts.map((x) => x.description)).not.toContain("texte serveur");
  });
});
