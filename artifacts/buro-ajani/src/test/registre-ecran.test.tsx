/**
 * Registre des traitements et registre IA a l'ecran, et les six constats RGPD
 * des parametres de securite.
 *
 * L'ecran n'invente rien : il affiche ce que le serveur affirme — y compris
 * « aucun effacement automatique ». Et les constats ne disent plus « en place »
 * la ou la mesure du 29/09 dit « partiel ». Serveur simule par `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import { RegistreTraitements } from "@/components/registre-traitements";
import DataProtectionPage from "@/pages/data-protection";

const ACTIVITES = [
  { id: "relation_client", nom: "Relation client et messagerie", finalite: "Tenir le fichier clients", roleEditeur: "sous-traitant",
    personnes: "Clients", donnees: "Identite", baseLegale: "Contrat", dureeAnnoncee: "Fixee par le client", appliquee: null,
    destinataires: "Hebergeur", sensible: false, enregistrements: 1234 },
  { id: "reconnaissance_faciale", nom: "Reconnaissance faciale", finalite: "Aucune", roleEditeur: "sous-traitant",
    personnes: "Collaborateurs", donnees: "Gabarits", baseLegale: "Aucune", dureeAnnoncee: "Aucune collecte",
    appliquee: "Effacement 30 jours apres la fin du contrat", destinataires: "Aucun", sensible: true,
    statut: "Desactivee depuis le 05/09/2026", enregistrements: 0 },
];
const SYSTEMES = [
  { id: "secretaire_telephonique", nom: "Secretaire telephonique IA", usage: "Repond aux appels", classe: "transparence",
    obligation: "Art. 50(1)", tenue: "Annonce en debut d'appel", personnesExposees: "Appelants" },
  { id: "evaluation_salaries", nom: "Evaluation des salaries", usage: "Rapports", classe: "haut_risque",
    obligation: "Annexe III 4 b", tenue: "Dossier technique", personnesExposees: "Collaborateurs" },
];
const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as Response;
let echecRegistre = false;

function monter(noeud: React.ReactNode, role = "administrateur") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider>
        <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "T", prenom: "A", role }} onLogout={() => {}}>
          {noeud}
        </WorkspaceUserProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("app.lang", "fr");
  echecRegistre = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/api/data-protection/registre")) return echecRegistre ? reponse({ error: "x" }, 500) : reponse({ activites: ACTIVITES });
    if (url.endsWith("/api/data-protection/registre-ia")) return reponse({ systemes: SYSTEMES, exclusionsExaminees: ["Reconnaissance des emotions : analyse sur le texte, pas sur la voix."] });
    if (url.endsWith("/api/data-protection/summary")) return reponse({ dataInventory: [], legalDocuments: [], myRequests: [], compliance: {} });
    return reponse({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("le registre des traitements a l'ecran", () => {
  it("affiche chaque activite avec son volume", async () => {
    monter(<RegistreTraitements />);
    expect(await screen.findByRole("heading", { name: "Relation client et messagerie" })).toBeTruthy();
    expect(screen.getByText(/1.?234/)).toBeTruthy();
  });
  it("dit « aucun effacement automatique » quand le serveur n'en applique aucun", async () => {
    monter(<RegistreTraitements />);
    const item = (await screen.findByRole("heading", { name: "Relation client et messagerie" })).closest("li")!;
    expect(within(item).getByText(/Aucun effacement automatique/)).toBeTruthy();
  });
  it("montre l'effacement applique quand il existe", async () => {
    monter(<RegistreTraitements />);
    const item = (await screen.findByRole("heading", { name: "Reconnaissance faciale" })).closest("li")!;
    expect(within(item).getByText(/Effacement 30 jours/)).toBeTruthy();
  });
  it("signale le traitement sensible et son statut", async () => {
    monter(<RegistreTraitements />);
    const item = (await screen.findByRole("heading", { name: "Reconnaissance faciale" })).closest("li")!;
    expect(within(item).getByText("Sensible")).toBeTruthy();
    expect(within(item).getByText(/Desactivee depuis/)).toBeTruthy();
  });
  it("le CSV se telecharge depuis la route tracee", async () => {
    monter(<RegistreTraitements />);
    const lien = (await screen.findByText(/Télécharger \(CSV\)/)).closest("a")!;
    expect(lien.getAttribute("href")).toMatch(/\/api\/data-protection\/registre\/csv$/);
    expect(lien.hasAttribute("download")).toBe(true);
  });
  it("une erreur du serveur est annoncee, pas remplacee par une liste vide", async () => {
    echecRegistre = true;
    monter(<RegistreTraitements />);
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toMatch(/Registre indisponible/);
  });
});

describe("le registre IA a l'ecran", () => {
  it("chaque systeme porte sa classe, traduite", async () => {
    monter(<RegistreTraitements />);
    const item = (await screen.findByRole("heading", { name: "Evaluation des salaries" })).closest("li")!;
    expect(within(item).getByText("Haut risque")).toBeTruthy();
    const sec = screen.getByRole("heading", { name: "Secretaire telephonique IA" }).closest("li")!;
    expect(within(sec).getByText("Transparence (art. 50)")).toBeTruthy();
  });
  it("les exclusions examinees sont affichees", async () => {
    monter(<RegistreTraitements />);
    expect(await screen.findByText(/analyse sur le texte/)).toBeTruthy();
  });
});

describe("l'onglet Registre", () => {
  it("l'administrateur le voit et l'ouvre", async () => {
    monter(<DataProtectionPage />);
    const onglet = await screen.findByRole("tab", { name: "Registre" });
    fireEvent.mouseDown(onglet);
    fireEvent.click(onglet);
    await waitFor(() => expect(screen.getByText("Registre des activités de traitement")).toBeTruthy());
  });
  it("un collaborateur ne le voit pas (le serveur le refuse aussi)", async () => {
    monter(<DataProtectionPage />, "agent");
    await screen.findByRole("tab", { name: /Mes droits/ });
    expect(screen.queryByRole("tab", { name: "Registre" })).toBeNull();
  });
});

describe("les constats RGPD des parametres disent la mesure", () => {
  const racine = join(import.meta.dirname, "..");
  const source = readFileSync(join(racine, "pages", "settings", "tab-securite.tsx"), "utf8");
  const langue = (l: string) => JSON.parse(readFileSync(join(racine, "i18n", "locales", `${l}.json`), "utf8"));

  it("l'effacement et la conservation sont « partiels »", () => {
    expect(source).toMatch(/\{ key: "RightErasure", etat: "partiel" \}/);
    expect(source).toMatch(/\{ key: "Retention", etat: "partiel" \}/);
  });
  it("le badge suit l'etat au lieu d'un « en place » fixe", () => {
    expect(source).toMatch(/item\.etat === "enPlace" \? "settingsSecurite\.app\.rgpdEnPlace" : "settingsSecurite\.app\.rgpdPartiel"/);
  });
  it.each(["fr", "en", "es", "de", "tr", "ar"])("%s : « partiel » existe et le consentement « avant tout traitement » a disparu", (l) => {
    const app = langue(l).settingsSecurite.app;
    expect(app.rgpdPartiel).toBeTruthy();
    expect(app.rgpdConsentDesc).not.toMatch(/avant tout traitement|before any processing/i);
  });
  it.each(["en", "es", "de", "tr", "ar"])("%s : les cles du registre sont celles du francais", (l) => {
    expect(Object.keys(langue(l).dataProtection.registre).sort()).toEqual(Object.keys(langue("fr").dataProtection.registre).sort());
    expect(langue(l).dataProtection.tabs.registre).toBeTruthy();
  });
});
