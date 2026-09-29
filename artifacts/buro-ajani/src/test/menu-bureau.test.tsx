/**
 * Refonte du menu (29/09) — ce qui doit rester vrai.
 *
 * Critere d'achevement donne pour cette etape : « chaque fonction existante
 * est accessible depuis sa nouvelle place ». Les tests le lisent dans le plan
 * (`lib/gezinti.ts`) ET dans les routes reelles d'`App.tsx`, puis montent la
 * vraie mise en page pour chaque role.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import { Layout } from "@/components/layout";
import {
  accesDeLAdresse, CONSOLE_PLATEFORME, entreesVisibles, pageDe, pagesDe, REGLAGES_BUREAU, SECTIONS_BUREAU, sectionsVisibles,
  type Entree,
} from "@/lib/gezinti";
import { enregistrerBascule, publierCommandeVocale } from "@/lib/commande-vocale";
import { bordGaucheDuContenu, dansLeContenu } from "@/lib/zone-contenu";

const SRC = join(import.meta.dirname, "..");
const lire = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

const TOUT: Entree[] = [...SECTIONS_BUREAU.flatMap((s) => s.entrees), ...REGLAGES_BUREAU, ...CONSOLE_PLATEFORME];

/** Les 59 adresses du menu d'avant la refonte, recopiees telles quelles. */
const ANCIEN_MENU = [
  "/", "/assistant-proactif", "/ia-apprentissage", "/calendrier", "/notifications", "/activite-recente", "/corbeille",
  "/appels", "/messages", "/whatsapp", "/gmail-agent", "/securite", "/diagnostic-poste", "/reglements", "/recherche-web",
  "/contacts", "/prospects", "/devis", "/factures",
  "/taches", "/projets", "/tresorerie", "/depenses", "/saisie-chantier", "/notes-internes", "/pointage",
  "/documents", "/base-connaissances", "/document-ia", "/rapports",
  "/equipe-ia", "/commandant-ia", "/file-approbation", "/bureau-taches", "/agents-catalogue", "/asistan", "/agents-ia",
  "/analyse", "/google-workspace", "/telephonie", "/logiciels",
  "/utilisateurs", "/gestion-licence", "/protection-donnees", "/equipe/localisation", "/rapport-executif", "/performance",
  "/auto-audit", "/automatisations", "/studio-flux",
  "/admin", "/organisations", "/admin/audit", "/sante-technique",
  "/guide", "/parametres", "/import", "/onboarding", "/telecharger",
];

/** Routes d'App.tsx : `{ chemin, garde }` ; garde = "admin" | "super_admin" | null. */
function routesDeLApp(): { chemin: string; garde: "admin" | "super_admin" | null; redirection: boolean }[] {
  const app = lire("App.tsx");
  return [...app.matchAll(/<Route path="([^"]+)" component=\{([^\n]*)\} ?\/>/g)].map(([, chemin, composant]) => ({
    chemin,
    garde: /SUPER_ADMIN_ROLES/.test(composant) ? "super_admin" : /ADMIN_ROLES/.test(composant) ? "admin" : null,
    redirection: /RedirectTo/.test(composant),
  }));
}

describe("le plan du menu", () => {
  it("garde une place a chacune des 59 adresses de l'ancien menu", () => {
    const absentes = ANCIEN_MENU.filter((a) => pageDe(a, TOUT)?.page.href !== a);
    expect(absentes, "adresses devenues inaccessibles depuis le menu").toEqual([]);
    expect(ANCIEN_MENU).toHaveLength(59);
  });

  it("couvre chaque route de page d'App.tsx (sous-pages comprises par leur page parente)", () => {
    const orphelines = routesDeLApp()
      .filter((r) => !r.redirection && !r.chemin.includes(":"))
      .map((r) => r.chemin)
      .filter((c) => pageDe(c, TOUT) === null);
    expect(orphelines).toEqual([]);
  });

  it("reprend exactement les gardes des routes : ce que le menu montre, la route l'ouvre", () => {
    // Seule exception, voulue : quand la licence expire, TOUT utilisateur est
    // redirige vers /gestion-licence (App.tsx) ; la route reste donc ouverte, et
    // c'est le serveur qui reserve les donnees aux responsables.
    const exceptions = new Set(["/gestion-licence"]);
    const ecarts: string[] = [];
    for (const r of routesDeLApp().filter((x) => !exceptions.has(x.chemin))) {
      const page = TOUT.flatMap((e) => e.pages).find((p) => p.href === r.chemin);
      if (!page) continue;
      const acces = page.acces ?? "tous";
      if (r.garde === "super_admin" && acces !== "super_admin") ecarts.push(`${r.chemin}: route super-admin, menu ${acces}`);
      if (r.garde === "admin" && acces !== "admin") ecarts.push(`${r.chemin}: route admin, menu ${acces}`);
      if (r.garde === null && (acces === "admin" || acces === "super_admin")) ecarts.push(`${r.chemin}: route ouverte, menu ${acces}`);
    }
    expect(ecarts).toEqual([]);
  });

  it("a huit sections de travail, dans l'ordre demande", () => {
    expect(SECTIONS_BUREAU.map((s) => s.cle)).toEqual(["today", "communication", "sales", "work", "planning", "finance", "agentBureau", "knowledge"]);
  });

  it("ne montre les outils de la plateforme a aucun role du bureau, ni dans les sections ni dans les reglages", () => {
    const console = new Set(pagesDe(CONSOLE_PLATEFORME).map((p) => p.href));
    for (const role of ["super_admin", "administrateur", "agent", "lecture_seule"]) {
      const bureau = [...sectionsVisibles(role).flatMap((s) => s.entrees), ...entreesVisibles(REGLAGES_BUREAU, role)];
      expect(pagesDe(bureau).filter((p) => console.has(p.href)), role).toEqual([]);
    }
    expect(entreesVisibles(CONSOLE_PLATEFORME, "administrateur")).toEqual([]);
    expect(entreesVisibles(CONSOLE_PLATEFORME, "super_admin")).toHaveLength(4);
  });

  it("range chaque outil selon sa fonction reelle, plus sous « Communication »", () => {
    const section = (href: string) => SECTIONS_BUREAU.find((s) => s.entrees.some((e) => e.pages.some((p) => p.href === href)))?.cle ?? "reglages";
    expect(section("/reglements")).toBe("finance");
    expect(section("/recherche-web")).toBe("knowledge");
    expect(section("/securite")).toBe("reglages");
    expect(section("/diagnostic-poste")).toBe("reglages");
    expect(pageDe("/diagnostic-poste", REGLAGES_BUREAU)?.entree.cle).toBe("security");
    const communication = SECTIONS_BUREAU.find((s) => s.cle === "communication")!;
    expect(pagesDe(communication.entrees).map((p) => p.href)).toEqual(["/appels", "/telefon", "/messages", "/whatsapp", "/gmail-agent", "/contacts"]);
  });

  it("reunit appels recus et appels a passer ; le reglage de la ligne est dans Connexions", () => {
    expect(pageDe("/telefon", TOUT)?.entree).toBe(pageDe("/appels", TOUT)?.entree);
    expect(pageDe("/appels/42", TOUT)?.page.href).toBe("/appels");
    expect(pageDe("/telephonie", REGLAGES_BUREAU)?.entree.cle).toBe("connections");
  });

  it("fait des pages IA des onglets du bureau des agents, plus des entrees de menu", () => {
    const agents = SECTIONS_BUREAU.find((s) => s.cle === "agentBureau")!;
    expect(agents.entrees.map((e) => e.cle)).toEqual(["agents", "flows", "runs"]);
    const ongletsAgents = agents.entrees[0].pages.map((p) => p.href);
    for (const href of ["/equipe-ia", "/commandant-ia", "/asistan", "/agents-ia"]) expect(ongletsAgents).toContain(href);
  });

  it("choisit la page la plus precise : /admin/audit n'est pas /admin", () => {
    expect(pageDe("/admin/audit", TOUT)?.entree.cle).toBe("globalAuditLog");
    expect(pageDe("/admin/dashboard", TOUT)?.entree.cle).toBe("saasBackoffice");
    expect(pageDe("/appels-sortants", TOUT)).toBeNull();
  });

  it("filtre par role : lecture seule sans agents, agent sans administration", () => {
    const hrefs = (role: string) => pagesDe([...sectionsVisibles(role).flatMap((s) => s.entrees), ...entreesVisibles(REGLAGES_BUREAU, role)]).map((p) => p.href);
    expect(hrefs("lecture_seule")).not.toContain("/file-approbation");
    expect(hrefs("lecture_seule")).not.toContain("/agents-catalogue");
    expect(hrefs("lecture_seule")).toContain("/corbeille");
    expect(hrefs("agent")).toContain("/agents-catalogue");
    expect(hrefs("agent")).not.toContain("/studio-flux");
    expect(hrefs("agent")).not.toContain("/utilisateurs");
    expect(hrefs("administrateur")).toContain("/studio-flux");
    expect(accesDeLAdresse("/gestion-licence?tab=audit-systeme")).toBe("admin");
  });

  it("a un libelle dans les six langues pour chaque section, entree et onglet", () => {
    const manques: string[] = [];
    for (const langue of ["fr", "en", "tr", "es", "de", "ar"]) {
      const j = JSON.parse(lire("i18n", "locales", `${langue}.json`));
      for (const s of [...SECTIONS_BUREAU.map((x) => x.cle), "officeSettings", "platformConsole"]) {
        if (!j.sidebar.groups[s]) manques.push(`${langue}: sidebar.groups.${s}`);
      }
      for (const e of TOUT) {
        if (!j.sidebar.items[e.cle]) manques.push(`${langue}: sidebar.items.${e.cle}`);
        for (const p of e.pages) if (!j.sidebar.items[p.cle]) manques.push(`${langue}: sidebar.items.${p.cle}`);
      }
      for (const k of ["approvalsWaiting", "approvalsNone", "voiceCommand", "quickAction", "backToOffice"]) {
        if (!j.header[k]) manques.push(`${langue}: header.${k}`);
      }
    }
    expect(manques).toEqual([]);
  });
});

describe("le titre de la page est le nom du menu", () => {
  // Onglet « Ajan hedefleri », page titree « Yapay Zeka Ekibi » : deux noms
  // pour une chose, et l'utilisateur ne sait plus ou il est.
  const TITRES: Record<string, string> = {
    "fileApprobation.title": "approvalQueue", "assistantProactif.title": "proactiveAssistant", "corbeille.title": "trash",
    "calls.title": "calls", "gmailAgent.title": "mailAgent", "prospects.title": "prospects", "projets.title": "projects",
    "voiceSiteOps.title": "siteVoice", "checkins.title": "checkin", "encaissements.titre": "encaissements",
    "agentsCatalogue.title": "agentCatalog", "aiAgents.title": "aiAgents", "equipeIa.title": "aiTeam",
    "commandantIa.title": "aiCommander", "automationsPage.title": "automations", "bureauTaches.title": "taskDesk",
    "documentAi.title": "documentAi", "software.title": "connectors", "diagnosticPoste.titre": "postDiagnostic",
  };
  it.each(["fr", "en", "tr", "es", "de", "ar"])("en %s", (langue) => {
    const j = JSON.parse(lire("i18n", "locales", `${langue}.json`));
    const get = (k: string) => k.split(".").reduce((a: any, b) => a?.[b], j);
    const ecarts = Object.entries(TITRES).filter(([k, item]) => get(k) !== j.sidebar.items[item]).map(([k, item]) => `${k}="${get(k)}" / menu "${j.sidebar.items[item]}"`);
    expect(ecarts).toEqual([]);
  });
});

describe("l'avatar flottant reste dans la zone de contenu", () => {
  it("ne se pose pas sur la barre laterale, ni a la pose ni en glissant", () => {
    const main = document.createElement("main");
    main.id = "contenu";
    main.getBoundingClientRect = () => ({ left: 256, top: 56, right: 1024, bottom: 768, width: 768, height: 712, x: 256, y: 56, toJSON() {} }) as DOMRect;
    document.body.appendChild(main);
    try {
      expect(bordGaucheDuContenu()).toBe(256);
      // Ancienne pose par defaut : x = 24, en plein sur la barre laterale.
      expect(dansLeContenu({ x: 24, y: 500 }, 300, 120).x).toBe(264);
      expect(dansLeContenu({ x: 600, y: 500 }, 300, 120).x).toBe(600);
    } finally {
      main.remove();
    }
    // Telephone : barre hors ecran, le contenu commence a 0.
    expect(dansLeContenu({ x: 24, y: 500 }, 300, 120).x).toBe(24);
  });
});

describe("plus rien ne flotte sur la barre laterale", () => {
  it("le micro et le « + » ont quitte le coin bas-gauche", () => {
    const vocal = lire("components", "VoiceAssistant.tsx");
    const mise = lire("components", "layout.tsx");
    expect(vocal).not.toMatch(/fixed bottom-6 left-6/);
    expect(mise).not.toMatch(/fixed bottom-6 left-6/);
    expect(mise).toMatch(/<BoutonCommandeVocale \/>/);
    expect(mise).toMatch(/<BoutonActionRapide /);
  });
});

// ---------------------------------------------------------------------------
// La vraie mise en page, montee pour chaque role.
// ---------------------------------------------------------------------------

const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as Response;
let enAttente = 0;

beforeAll(() => {
  // jsdom n'a ni matchMedia ni EventSource ; la mise en page s'en sert.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
  });
  class ES { onmessage = null; onerror = null; addEventListener() {} removeEventListener() {} close() {} }
  vi.stubGlobal("EventSource", ES);
  vi.stubGlobal("CSS", { supports: () => false });
});

beforeEach(() => {
  enAttente = 21;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/agent-queue/count")) return reponse({ pending: enAttente });
    return reponse({});
  }));
});
afterEach(() => { localStorage.clear(); });

function monter(role: string, adresse = "/") {
  localStorage.setItem("app.lang", "tr");
  const { hook } = memoryLocation({ path: adresse, static: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "T", prenom: "A", role }} onLogout={() => {}}>
          <Router hook={hook}>
            <Layout><p>contenu</p></Layout>
          </Router>
        </WorkspaceUserProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const menu = () => screen.getByRole("navigation", { name: "Ana menü" });

/** Le turc est charge a la demande : on attend qu'il soit la avant de lire les libelles. */
async function monterEnTurc(role: string, adresse = "/") {
  const rendu = monter(role, adresse);
  await screen.findAllByText(adresse.startsWith("/organisations") ? "Platform konsolu" : "Büro Ayarları", {}, { timeout: 15000 });
  return rendu;
}

// La mise en page entiere, plus le chargement du turc : sur une machine
// chargee (CI, suite complete), le delai par defaut de 5 s ne suffit pas.
describe("la mise en page montee", { timeout: 30000 }, () => {
  it("montre les huit sections a l'administrateur, sans la console plateforme", async () => {
    await monterEnTurc("administrateur");
    for (const nom of ["Bugün", "İletişim Merkezi", "CRM ve Satış", "Şantiyeler ve İşler", "Planlama", "Finans", "Ajan Bureau", "Bilgi ve Analiz"]) {
      expect(within(menu()).getByText(nom)).toBeInTheDocument();
    }
    expect(screen.queryByText("SaaS Yönetim Paneli")).toBeNull();
    expect(screen.queryByTestId("passage-console")).toBeNull();
  });

  it("met le compteur d'approbations dans l'en-tete, en orange, avec un nom qui dit le nombre", async () => {
    await monterEnTurc("agent");
    const compteur = await screen.findByRole("link", { name: "Onay bekleyen: 21" });
    expect(compteur).toHaveAttribute("href", "/file-approbation");
    expect(within(compteur).getByText("21").className).toMatch(/bg-orange-400/);
  });

  it("n'offre pas le compteur d'approbations au role en lecture seule", async () => {
    await monterEnTurc("lecture_seule");
    await act(async () => {});
    expect(screen.queryByTestId("compteur-approbations")).toBeNull();
  });

  it("ouvre les reglages du bureau d'office sur l'une de leurs pages, et les replie au clic", async () => {
    await monterEnTurc("administrateur", "/telephonie");
    const bouton = screen.getByRole("button", { name: /Büro Ayarları/ });
    expect(bouton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Bağlantılar" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(bouton);
    expect(bouton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Bağlantılar" })).toBeNull();
  });

  it("affiche les onglets de l'entree courante, page active marquee", async () => {
    await monterEnTurc("agent", "/equipe-ia");
    const onglets = screen.getByRole("navigation", { name: "“Ajanlar” sayfaları" });
    expect(within(onglets).getByRole("link", { name: "Ajan hedefleri" })).toHaveAttribute("aria-current", "page");
    expect(within(onglets).getByRole("link", { name: "Ajan profilleri" })).not.toHaveAttribute("aria-current");
    expect(document.title).toBe("Ajan hedefleri – Ajant Bureau");
  });

  it("donne au super-administrateur une console a part, avec ses seules pages", async () => {
    await monterEnTurc("super_admin", "/organisations");
    expect(screen.queryByRole("navigation", { name: "Ana menü" })).toBeNull();
    expect(screen.queryByText("Bugün")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Platform konsolu" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/admin", "/organisations", "/admin/audit", "/sante-technique"]);
    expect(screen.getByTestId("passage-console")).toHaveAttribute("href", "/");
  });
});

describe("le bouton « Commande vocale »", { timeout: 30000 }, () => {
  it("n'apparait que si l'assistant vocal est disponible, et le pilote", async () => {
    await monterEnTurc("agent");
    expect(screen.queryByTestId("bouton-commande-vocale")).toBeNull();
    const bascule = vi.fn();
    const desinscrire = enregistrerBascule(bascule);
    act(() => publierCommandeVocale({ disponible: true, ouverte: false, ecoute: "veille" }));
    const bouton = screen.getByTestId("bouton-commande-vocale");
    expect(bouton).toHaveAccessibleName(/Sesli komut/);
    expect(bouton).toHaveAccessibleName(/uyandırma sözcüğünü bekliyor/);
    expect(bouton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(bouton);
    expect(bascule).toHaveBeenCalledTimes(1);
    act(() => publierCommandeVocale({ ouverte: true }));
    expect(bouton).toHaveAttribute("aria-expanded", "true");
    act(() => desinscrire());
    expect(screen.queryByTestId("bouton-commande-vocale")).toBeNull();
  });
});
