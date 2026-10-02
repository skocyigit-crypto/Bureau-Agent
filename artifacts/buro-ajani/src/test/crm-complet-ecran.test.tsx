/**
 * CRM complet a l'ecran : fil du client, bandeau de doublons et fusion,
 * prochaine action, liste de decouverte, ligne d'estimation du devis, et la
 * relance du jour dans « Aujourd'hui ».
 *
 * Reseau simule au format des routes reelles (routes/contacts.ts,
 * routes/prospects.ts) ; rendu reel, en francais.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n";

const confirmer = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/hooks/use-confirm", () => ({ confirmAction: confirmer }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ContactChronologie } from "@/components/crm/contact-chronologie";
import { ContactDoublons } from "@/components/crm/contact-doublons";
import { ListeDecouverteCarte, POINTS_DECOUVERTE, ProchaineAction, pointsManquants } from "@/components/crm/prospect-suivi";
import { LineItemsEditor, type LineItem } from "@/components/line-items-editor";
import { MasaBugun } from "@/components/masa-bugun";
import AdminDevisPage from "@/pages/admin-devis";

type Appel = { methode: string; url: string; corps: any };
let appels: Appel[] = [];
let routes: Record<string, (a: Appel) => { status?: number; corps: unknown }> = {};
const rep = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as Response;

beforeEach(() => {
  appels = [];
  routes = {};
  confirmer.mockReset();
  confirmer.mockResolvedValue(true);
  toast.mockReset();
  localStorage.setItem("app.lang", "fr");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const a: Appel = { methode: init?.method ?? "GET", url: String(url), corps: init?.body ? JSON.parse(String(init.body)) : null };
    appels.push(a);
    for (const [motif, f] of Object.entries(routes)) {
      if (a.url.includes(motif)) { const r = f(a); return rep(r.corps, r.status ?? 200); }
    }
    return rep({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const monter = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);
const fr = JSON.parse(readFileSync(join(import.meta.dirname, "..", "i18n", "locales", "fr.json"), "utf8"));

// ===========================================================================
// Fil du client
// ===========================================================================
const el = (type: string, id: number, extra: Record<string, unknown> = {}) => ({
  type, id, date: new Date(Date.UTC(2026, 8, 30 - id)).toISOString(), titre: `${type} ${id}`, statut: null, detail: null, montant: null, lien: `/x/${type}/${id}`, ...extra,
});

describe("fil chronologique du client", () => {
  it("affiche un etat de chargement accessible", async () => {
    routes["/chronologie"] = () => ({ corps: { elements: [], suivant: null } });
    monter(<ContactChronologie contactId={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("Chargement de l'historique");
    await screen.findByTestId("chronologie-vide");
  });

  it("dit qu'il n'y a rien quand le client n'a aucune activite", async () => {
    routes["/chronologie"] = () => ({ corps: { elements: [], suivant: null } });
    monter(<ContactChronologie contactId={5} />);
    expect(await screen.findByText("Aucune activité enregistrée pour ce client.")).toBeInTheDocument();
  });

  it("une panne se voit et se relance", async () => {
    let n = 0;
    routes["/chronologie"] = () => (++n === 1 ? { status: 500, corps: {} } : { corps: { elements: [el("appel", 1)], suivant: null } });
    monter(<ContactChronologie contactId={5} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("L'historique n'a pas pu être chargé.");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("appel 1")).toBeInTheDocument();
  });

  it.each([
    ["appel", "Appel"], ["message", "Message"], ["note", "Note"], ["whatsapp", "WhatsApp"], ["devis", "Devis"], ["facture", "Facture"],
    ["rendez_vous", "Rendez-vous"], ["offre_rdv", "Proposition de rendez-vous"], ["tache", "Tâche"], ["chantier", "Chantier"], ["opportunite", "Opportunité"],
  ])("nomme l'element %s (« %s ») et mene a sa fiche", async (type, libelle) => {
    routes["/chronologie"] = () => ({ corps: { elements: [el(type, 3)], suivant: null } });
    monter(<ContactChronologie contactId={5} />);
    const ligne = await screen.findByTestId(`chronologie-${type}-3`);
    expect(ligne).toHaveTextContent(libelle);
    expect(ligne.querySelector("a")!.getAttribute("href")).toContain(`/x/${type}/3`);
  });

  it("affiche le montant d'un devis", async () => {
    routes["/chronologie"] = () => ({ corps: { elements: [el("devis", 2, { montant: 1200 })], suivant: null } });
    monter(<ContactChronologie contactId={5} />);
    const ligne = await screen.findByTestId("chronologie-devis-2");
    expect(ligne.textContent).toMatch(/1\s?200,00/);
  });

  it("charge la page suivante avec le curseur rendu par le serveur", async () => {
    routes["/chronologie"] = (a) => a.url.includes("avant=")
      ? { corps: { elements: [el("tache", 9)], suivant: null } }
      : { corps: { elements: [el("appel", 1)], suivant: "2026-09-29T00:00:00.000Z|appel|1" } };
    monter(<ContactChronologie contactId={5} />);
    fireEvent.click(await screen.findByRole("button", { name: "Afficher plus" }));
    expect(await screen.findByTestId("chronologie-tache-9")).toBeInTheDocument();
    expect(screen.getByTestId("chronologie-appel-1")).toBeInTheDocument();
    expect(appels.some((x) => x.url.includes(`avant=${encodeURIComponent("2026-09-29T00:00:00.000Z|appel|1")}`))).toBe(true);
    expect(screen.queryByRole("button", { name: "Afficher plus" })).not.toBeInTheDocument();
  });

  it("interroge la route du contact affiche", async () => {
    routes["/chronologie"] = () => ({ corps: { elements: [], suivant: null } });
    monter(<ContactChronologie contactId={42} />);
    await screen.findByTestId("chronologie-vide");
    expect(appels[0]!.url).toContain("/api/contacts/42/chronologie");
  });
});

// ===========================================================================
// Doublons et fusion
// ===========================================================================
const candidat = (id: number, motifs: string[], references: Record<string, number> = {}) => ({ id, firstName: "Jean", lastName: `Dupont${id}`, company: null, email: null, phone: "0600000000", motifs, references });

describe("bandeau de doublons et fusion", () => {
  it("n'affiche rien sans doublon", async () => {
    routes["/doublons"] = () => ({ corps: { candidats: [] } });
    const { container } = monter(<ContactDoublons contactId={1} />);
    await waitFor(() => expect(appels.length).toBe(1));
    expect(container.querySelector("[data-testid=bandeau-doublons]")).toBeNull();
  });

  it("signale l'echec de la recherche au lieu de se taire", async () => {
    routes["/doublons"] = () => ({ status: 500, corps: {} });
    monter(<ContactDoublons contactId={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("La recherche de doublons a échoué.");
  });

  it.each([
    ["telephone", "même téléphone"], ["email", "même e-mail"], ["nom_societe", "même nom et société"],
  ])("dit pourquoi la fiche est suspecte (%s)", async (motif, texte) => {
    routes["/doublons"] = () => ({ corps: { candidats: [candidat(2, [motif])] } });
    monter(<ContactDoublons contactId={1} />);
    expect(await screen.findByTestId("doublon-2")).toHaveTextContent(texte);
  });

  it("dit combien d'elements une fusion deplacerait", async () => {
    routes["/doublons"] = () => ({ corps: { candidats: [candidat(2, ["email"], { calls: 3, devis: 2 })] } });
    monter(<ContactDoublons contactId={1} />);
    expect(await screen.findByTestId("doublon-2")).toHaveTextContent("5 élément(s) rattaché(s)");
  });

  it("demande confirmation, en disant que la fiche absorbee reste restaurable", async () => {
    routes["/doublons"] = () => ({ corps: { candidats: [candidat(2, ["email"])] } });
    confirmer.mockResolvedValue(false);
    monter(<ContactDoublons contactId={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fusionner dans cette fiche" }));
    await waitFor(() => expect(confirmer).toHaveBeenCalled());
    expect((confirmer.mock.calls[0] as any)[0].description).toContain("corbeille");
    expect(appels.some((a) => a.methode === "POST")).toBe(false);
  });

  it("fusionne dans la fiche affichee et annonce le nombre de lignes deplacees", async () => {
    let fusionne = false;
    routes["/fusion"] = () => { fusionne = true; return { corps: { deplaces: { calls: 2, devis: 1 } } }; };
    routes["/doublons"] = () => ({ corps: { candidats: fusionne ? [] : [candidat(2, ["email"])] } });
    const apres = vi.fn();
    monter(<ContactDoublons contactId={1} onFusion={apres} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fusionner dans cette fiche" }));
    await waitFor(() => expect(apres).toHaveBeenCalled());
    const post = appels.find((a) => a.methode === "POST")!;
    expect(post.url).toContain("/api/contacts/1/fusion");
    expect(post.corps).toEqual({ absorbeId: 2 });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Fiches fusionnées", description: "3 élément(s) déplacé(s)." }));
    await waitFor(() => expect(screen.queryByTestId("bandeau-doublons")).not.toBeInTheDocument());
  });

  it("montre le refus du serveur (compte client en double)", async () => {
    routes["/fusion"] = () => ({ status: 409, corps: { error: "Les deux fiches ont chacune un compte client.", code: "fusion_compte_client_double" } });
    routes["/doublons"] = () => ({ corps: { candidats: [candidat(2, ["email"])] } });
    monter(<ContactDoublons contactId={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fusionner dans cette fiche" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Fusion impossible", description: "Les deux fiches ont chacune un compte client.", variant: "destructive" })));
    expect(screen.getByTestId("bandeau-doublons")).toBeInTheDocument();
  });

  it("chaque candidat mene a sa propre fiche", async () => {
    routes["/doublons"] = () => ({ corps: { candidats: [candidat(7, ["telephone"])] } });
    monter(<ContactDoublons contactId={1} />);
    const lien = (await screen.findByTestId("doublon-7")).querySelector("a")!;
    expect(lien.getAttribute("href")).toMatch(/\/contacts\/7$/);
  });

  it("plusieurs candidats : un bouton de fusion chacun", async () => {
    routes["/doublons"] = () => ({ corps: { candidats: [candidat(2, ["email"]), candidat(3, ["telephone"])] } });
    monter(<ContactDoublons contactId={1} />);
    await screen.findByTestId("doublon-3");
    expect(screen.getAllByRole("button", { name: "Fusionner dans cette fiche" })).toHaveLength(2);
  });
});

// ===========================================================================
// Prochaine action
// ===========================================================================
describe("prochaine action", () => {
  beforeEach(() => {
    routes["/api/team-status"] = () => ({ corps: { members: [{ id: 11, name: "Paul Durand" }, { id: 12, name: "Ines Martin" }] } });
    routes["/api/prospects/"] = () => ({ corps: { id: 4 } });
  });

  it("affiche l'action existante", async () => {
    monter(<ProchaineAction prospect={{ id: 4, nextActionLabel: "Rappeler", nextActionAt: "2030-01-02T09:30:00.000Z", nextActionOwnerId: 11 }} />);
    expect(screen.getByLabelText("Action")).toHaveValue("Rappeler");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toMatch(/^2030-01-02T/);
    await screen.findByRole("option", { name: "Paul Durand" });
    expect(screen.getByLabelText("Responsable")).toHaveValue("11");
  });

  it("propose les membres de l'organisation comme responsables", async () => {
    monter(<ProchaineAction prospect={{ id: 4 }} />);
    expect(await screen.findByRole("option", { name: "Ines Martin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Aucun" })).toBeInTheDocument();
  });

  it("enregistre texte, date (ISO) et responsable", async () => {
    const ok = vi.fn();
    monter(<ProchaineAction prospect={{ id: 4 }} onSaved={ok} />);
    await screen.findByRole("option", { name: "Ines Martin" });
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "Envoyer les photos" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2030-03-04T10:00" } });
    fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(ok).toHaveBeenCalled());
    const patch = appels.find((a) => a.methode === "PATCH")!;
    expect(patch.url).toContain("/api/prospects/4");
    expect(patch.corps.nextActionLabel).toBe("Envoyer les photos");
    expect(patch.corps.nextActionOwnerId).toBe(12);
    expect(new Date(patch.corps.nextActionAt).getTime()).toBe(new Date("2030-03-04T10:00").getTime());
  });

  it("vider les champs efface l'action (null, pas une chaine vide)", async () => {
    monter(<ProchaineAction prospect={{ id: 4, nextActionLabel: "x", nextActionAt: "2030-01-02T09:30:00.000Z", nextActionOwnerId: 11 }} />);
    await screen.findByRole("option", { name: "Paul Durand" });
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(appels.some((a) => a.methode === "PATCH")).toBe(true));
    expect(appels.find((a) => a.methode === "PATCH")!.corps).toEqual({ nextActionLabel: null, nextActionAt: null, nextActionOwnerId: null });
  });

  it("signale une action en retard", () => {
    monter(<ProchaineAction prospect={{ id: 4, nextActionAt: "2020-01-01T00:00:00.000Z" }} />);
    expect(screen.getByText("En retard")).toBeInTheDocument();
  });

  it("ne signale pas de retard pour une action future", () => {
    monter(<ProchaineAction prospect={{ id: 4, nextActionAt: "2099-01-01T00:00:00.000Z" }} />);
    expect(screen.queryByText("En retard")).not.toBeInTheDocument();
  });

  it("montre le refus du serveur (responsable inconnu)", async () => {
    routes["/api/prospects/"] = () => ({ status: 400, corps: { error: "Responsable introuvable." } });
    monter(<ProchaineAction prospect={{ id: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Enregistrement impossible", description: "Responsable introuvable.", variant: "destructive" })));
  });

  it("confirme l'enregistrement", async () => {
    monter(<ProchaineAction prospect={{ id: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Prochaine action enregistrée" }));
  });

  it("sans liste d'equipe, le choix reste « Aucun » sans planter", async () => {
    routes["/api/team-status"] = () => ({ status: 500, corps: {} });
    monter(<ProchaineAction prospect={{ id: 4 }} />);
    await waitFor(() => expect(appels.some((a) => a.url.includes("team-status"))).toBe(true));
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("la relance du jour et la relance en retard ont leur libelle dans « Aujourd'hui »", async () => {
    const vide = { satirlar: [], fazlasi: false };
    routes["/api/bugun"] = () => ({ corps: {
      simdi: vide, onaylar: { ...vide, toplam: 0 }, plan: vide, finans: vide, ajanlar: { ...vide, sayac: { calisiyor: 0, bekliyor: 0, hata: 0 } },
      dosyalar: { satirlar: [
        { cle: "sonraki_adim:8", tur: "sonraki_adim_gecikti", baslik: "Relancer le devis", detay: null, href: "/prospects/8", sorumlu: "Paul Durand", zaman: "2026-09-28T09:00:00.000Z", ton: "acil" },
        { cle: "sonraki_adim:9", tur: "sonraki_adim_bugun", baslik: "Visite", detay: null, href: "/prospects/9", sorumlu: null, zaman: "2026-10-01T15:00:00.000Z", ton: "onay" },
      ], fazlasi: false },
      uretildi: "2026-10-01T10:00:00.000Z",
    } });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><MasaBugun /></I18nProvider></QueryClientProvider>);
    expect(await screen.findByText("Relancer le devis")).toBeInTheDocument();
    expect(screen.getByText("Relance en retard")).toBeInTheDocument();
    expect(screen.getByText("Relance du jour")).toBeInTheDocument();
    expect(screen.getByText("Relancer le devis").closest("a")!.getAttribute("href")).toContain("/prospects/8");
  });
});

// ===========================================================================
// Decouverte
// ===========================================================================
describe("liste de decouverte", () => {
  beforeEach(() => { routes["/api/prospects/"] = () => ({ corps: { id: 4 } }); });

  it("liste les 8 points, dans l'ordre du serveur", () => {
    monter(<ListeDecouverteCarte prospect={{ id: 4 }} />);
    for (const p of POINTS_DECOUVERTE) expect(screen.getByLabelText(fr.crm.decouverte.point[p])).toBeInTheDocument();
    expect(POINTS_DECOUVERTE).toEqual(["adresse_chantier", "type_travaux", "surface", "acces", "photos", "budget", "delai", "decideur"]);
  });

  it("une opportunite neuve : 0/8 et tous les points a confirmer", () => {
    monter(<ListeDecouverteCarte prospect={{ id: 4 }} />);
    expect(screen.getByTestId("decouverte-progression")).toHaveTextContent("0/8 confirmés");
    expect(screen.getByTestId("decouverte-manquants")).toHaveTextContent("À confirmer : Adresse du chantier, Type de travaux");
  });

  it("coche un point : la progression et les manquants suivent", () => {
    monter(<ListeDecouverteCarte prospect={{ id: 4 }} />);
    fireEvent.click(screen.getByLabelText("Surface"));
    expect(screen.getByTestId("decouverte-progression")).toHaveTextContent("1/8 confirmés");
    expect(screen.getByTestId("decouverte-manquants").textContent).not.toContain("Surface");
  });

  it("relit une liste enregistree", () => {
    monter(<ListeDecouverteCarte prospect={{ id: 4, discoveryChecklist: { budget: { ok: true, valeur: "15 k€" } } }} />);
    expect(screen.getByLabelText("Budget")).toBeChecked();
    expect(screen.getByLabelText("Budget — Précision")).toHaveValue("15 k€");
  });

  it("tout confirme : le dit en clair", () => {
    const tout = Object.fromEntries(POINTS_DECOUVERTE.map((p) => [p, { ok: true }]));
    monter(<ListeDecouverteCarte prospect={{ id: 4, discoveryChecklist: tout }} />);
    expect(screen.getByTestId("decouverte-manquants")).toHaveTextContent("Tout est confirmé.");
  });

  it("enregistre la liste au format attendu par le serveur", async () => {
    const ok = vi.fn();
    monter(<ListeDecouverteCarte prospect={{ id: 4 }} onSaved={ok} />);
    fireEvent.click(screen.getByLabelText("Accès au chantier"));
    fireEvent.change(screen.getByLabelText("Surface — Précision"), { target: { value: "85 m2" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(ok).toHaveBeenCalled());
    expect(appels.find((a) => a.methode === "PATCH")!.corps).toEqual({ discoveryChecklist: { acces: { ok: true, valeur: null }, surface: { ok: false, valeur: "85 m2" } } });
  });

  it("une precision sans case cochee reste a confirmer", () => {
    monter(<ListeDecouverteCarte prospect={{ id: 4 }} />);
    fireEvent.change(screen.getByLabelText("Photos — Précision"), { target: { value: "3 photos recues" } });
    expect(screen.getByTestId("decouverte-manquants")).toHaveTextContent("Photos");
  });

  it("decocher remet le point dans les manquants", () => {
    monter(<ListeDecouverteCarte prospect={{ id: 4, discoveryChecklist: { delai: { ok: true } } }} />);
    fireEvent.click(screen.getByLabelText("Délai souhaité"));
    expect(screen.getByTestId("decouverte-manquants")).toHaveTextContent("Délai souhaité");
  });

  it("pointsManquants suit la meme regle que le serveur", () => {
    expect(pointsManquants(null)).toHaveLength(8);
    expect(pointsManquants({ surface: { ok: true }, budget: { ok: false } })).not.toContain("surface");
    expect(pointsManquants({ surface: { ok: true }, budget: { ok: false } })).toContain("budget");
  });

  it("montre le refus du serveur", async () => {
    routes["/api/prospects/"] = () => ({ status: 400, corps: { error: "Point de decouverte inconnu : x." } });
    monter(<ListeDecouverteCarte prospect={{ id: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "Point de decouverte inconnu : x." })));
  });

  it("chaque point a son libelle dans les 6 langues", () => {
    for (const l of ["fr", "tr", "en", "es", "de", "ar"]) {
      const j = JSON.parse(readFileSync(join(import.meta.dirname, "..", "i18n", "locales", `${l}.json`), "utf8"));
      for (const p of POINTS_DECOUVERTE) expect(j.crm.decouverte.point[p], `${l}.${p}`).toBeTruthy();
      expect(j.bugun.tur.sonraki_adim_gecikti, l).toBeTruthy();
      expect(j.bugun.tur.sonraki_adim_bugun, l).toBeTruthy();
    }
  });
});

// ===========================================================================
// Estimation dans l'editeur de devis
// ===========================================================================
function Editeur({ initial, espion }: { initial: LineItem[]; espion?: (l: LineItem[]) => void }) {
  const [items, setItems] = useState(initial);
  return <LineItemsEditor items={items} onChange={(l) => { setItems(l); espion?.(l); }} />;
}
const estimee: LineItem = { description: "Estimation à vérifier — Toiture", quantity: 1, unitPrice: 8000, taxRate: 20, estimate: true };

describe("ligne d'estimation du devis", () => {
  it("est montree a part, avec son badge et l'explication", () => {
    monter(<Editeur initial={[estimee]} />);
    const ligne = screen.getByTestId("ligne-estimee-0");
    expect(ligne).toHaveTextContent("Estimation");
    expect(ligne).toHaveTextContent("Prix estimé, non chiffré");
  });

  it("une ligne ordinaire n'a pas de badge", () => {
    monter(<Editeur initial={[{ description: "Pose", quantity: 2, unitPrice: 50, taxRate: 20 }]} />);
    expect(screen.queryByTestId("ligne-estimee-0")).not.toBeInTheDocument();
  });

  it.each([
    ["le prix", "Prix unitaire HT", "7600"],
    ["la quantite", "Qté", "2"],
    ["la designation", "Désignation", "Couverture 85 m2"],
  ])("modifier %s vaut reprise : le drapeau disparait", (_q, champ, valeur) => {
    const espion = vi.fn();
    monter(<Editeur initial={[estimee]} espion={espion} />);
    const libelle = fr.lineItemsEditor[champ === "Prix unitaire HT" ? "colUnitPrice" : champ === "Qté" ? "colQty" : "colDesignation"];
    fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } });
    expect(espion.mock.calls.at(-1)![0][0].estimate).toBeUndefined();
    expect(screen.queryByTestId("ligne-estimee-0")).not.toBeInTheDocument();
  });

  it("changer la TVA seule ne vaut pas reprise", () => {
    const espion = vi.fn();
    monter(<Editeur initial={[estimee]} espion={espion} />);
    fireEvent.change(screen.getByLabelText(fr.lineItemsEditor.colVat), { target: { value: "10" } });
    expect(espion.mock.calls.at(-1)![0][0].estimate).toBe(true);
    expect(screen.getByTestId("ligne-estimee-0")).toBeInTheDocument();
  });

  it("reprendre une ligne laisse les autres estimations marquees", () => {
    const espion = vi.fn();
    monter(<Editeur initial={[estimee, { ...estimee, description: "Estimation à vérifier — Zinguerie" }]} espion={espion} />);
    fireEvent.change(screen.getAllByLabelText(fr.lineItemsEditor.colUnitPrice)[0]!, { target: { value: "100" } });
    const l = espion.mock.calls.at(-1)![0];
    expect(l[0].estimate).toBeUndefined();
    expect(l[1].estimate).toBe(true);
  });

  it("le total compte la ligne d'estimation comme les autres (apercu)", () => {
    monter(<Editeur initial={[estimee]} />);
    expect(screen.getByText(fr.lineItemsEditor.totalTtc).parentElement!.textContent).toMatch(/9\s?600,00/);
  });

  it("supprimer la ligne d'estimation est possible", () => {
    const espion = vi.fn();
    monter(<Editeur initial={[estimee]} espion={espion} />);
    fireEvent.click(screen.getByRole("button", { name: fr.common.delete }));
    expect(espion.mock.calls.at(-1)![0]).toEqual([]);
  });

  it("les libelles d'estimation existent dans les 6 langues", () => {
    for (const l of ["fr", "tr", "en", "es", "de", "ar"]) {
      const j = JSON.parse(readFileSync(join(import.meta.dirname, "..", "i18n", "locales", `${l}.json`), "utf8"));
      expect(j.crm.estimation.badge, l).toBeTruthy();
      expect(j.crm.estimation.aide, l).toBeTruthy();
      expect(j.crm.estimation.listeBadge, l).toBeTruthy();
    }
  });

  it("la page Devis marque un devis qui porte encore une estimation", async () => {
    routes["/api/devis?"] = () => ({ corps: { devis: [
      { id: 1, reference: "DV-1", title: "Avec estimation", clientName: "C", status: "brouillon", totalAmount: "9600", currency: "EUR", createdAt: "2026-09-20T10:00:00.000Z", items: [estimee] },
      { id: 2, reference: "DV-2", title: "Chiffre", clientName: "C", status: "brouillon", totalAmount: "100", currency: "EUR", createdAt: "2026-09-20T10:00:00.000Z", items: [{ description: "x", quantity: 1, unitPrice: 100, taxRate: 0 }] },
    ], total: 2 } });
    monter(<AdminDevisPage />);
    expect(await screen.findByTestId("devis-estimation-1")).toHaveTextContent("Contient une estimation");
    expect(screen.queryByTestId("devis-estimation-2")).not.toBeInTheDocument();
  }, 15000);
});
