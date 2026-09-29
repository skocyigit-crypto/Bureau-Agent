/**
 * La table « Aujourd'hui » a l'ecran (components/masa-bugun.tsx).
 *
 * Donnees simulees au format de GET /api/bugun ; rendu reel, en turc. On
 * verifie que chaque ligne dit ce qu'elle est, mene a sa fiche, nomme son
 * responsable et son echeance, et porte la bonne couleur de la charte ; qu'un
 * panneau vide le dit ; qu'une panne se voit et se relance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n";
import { MasaBugun, cleSource, type MasaBugunVerisi, type Satir } from "@/components/masa-bugun";

const lire = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
const vide = { satirlar: [] as Satir[], fazlasi: false };
const s = (x: Partial<Satir> & Pick<Satir, "cle" | "tur">): Satir => ({ baslik: "—", detay: null, href: "/", sorumlu: null, zaman: null, ton: "bilgi", ...x });

let reponse: MasaBugunVerisi;
let statut = 200;
let appels = 0;

function donnees(): MasaBugunVerisi {
  return {
    simdi: { satirlar: [
      s({ cle: "geri_arama:1", tur: "geri_arama", baslik: "Client Rappel", detay: "+33600000001", href: "/appels/1", ton: "onay", zaman: "2026-09-29T08:00:00.000Z" }),
      s({ cle: "acil_saha:7", tur: "acil_saha", baslik: "Fuite sur le chantier", href: "/taches?id=7", sorumlu: "Paul Durand", ton: "acil" }),
    ], fazlasi: false },
    onaylar: { satirlar: [
      s({ cle: "onay:3", tur: "onay_email", baslik: "Relancer M. Toit", detay: "Devis sans reponse", href: "/file-approbation", ton: "onay", zaman: "2026-10-01T10:00:00.000Z", para: "automation_rule" }),
      s({ cle: "onay:4", tur: "onay_inconnue", baslik: "Action rare", href: "/file-approbation", ton: "onay", para: "ai_receptionist_cancel" }),
      s({ cle: "onay:5", tur: "onay_tache", baslik: "Autre", href: "/file-approbation", ton: "onay", para: "producteur_neuf" }),
    ], fazlasi: true, toplam: 21 },
    plan: vide,
    dosyalar: { satirlar: [s({ cle: "teklif:9", tur: "teklif_bekliyor", baslik: "DV-9 — Toiture", href: "/devis", tutar: 4200, para: "EUR", zaman: "2026-10-09T10:00:00.000Z" })], fazlasi: false },
    finans: { satirlar: [
      s({ cle: "fatura_gecikti:2", tur: "fatura_gecikti", baslik: "FC-2", detay: "Client En Retard", href: "/factures", ton: "acil", tutar: 600, para: "EUR", zaman: "2026-09-20T10:00:00.000Z" }),
      s({ cle: "butce_asimi:5", tur: "butce_asimi", baslik: "Chantier Dupont", detay: "manuel", href: "/projets", ton: "acil", tutar: 2500, para: "EUR" }),
    ], fazlasi: false },
    ajanlar: { satirlar: [s({ cle: "baglanti_eksik:telefon", tur: "baglanti_telefon", baslik: "telephony", href: "/telephonie", ton: "acil" })], fazlasi: false, sayac: { calisiyor: 2, bekliyor: 1, hata: 3 } },
    uretildi: "2026-09-29T10:00:00.000Z",
  };
}

beforeEach(() => {
  reponse = donnees();
  statut = 200;
  appels = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/api/bugun")) {
      appels++;
      return { ok: statut < 400, status: statut, json: async () => reponse } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

async function monter() {
  localStorage.setItem("app.lang", "tr");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><I18nProvider><MasaBugun /></I18nProvider></QueryClientProvider>);
  // Le turc arrive a la demande : on attend un libelle turc.
  await screen.findByText("Şimdi ilgilen", {}, { timeout: 5000 });
}

const ligne = (cle: string) => screen.getByTestId(`bugun-satir-${cle}`);

describe("la table Aujourd'hui", () => {
  it("montre les six panneaux, chacun sous son titre", async () => {
    await monter();
    for (const titre of ["Şimdi ilgilen", "Onay bekleyenler", "Bugünün planı", "İş dosyaları", "Finansal dikkat", "Ajan durumu"]) {
      expect(screen.getByRole("heading", { name: titre })).toBeInTheDocument();
    }
  });

  it("fait de chaque ligne un lien vers sa fiche, qui dit sa nature", async () => {
    await monter();
    expect(ligne("geri_arama:1")).toHaveAttribute("href", "/appels/1");
    expect(within(ligne("geri_arama:1")).getByText("Geri aranacak (cevapsız)")).toBeInTheDocument();
    expect(ligne("acil_saha:7")).toHaveAttribute("href", "/taches?id=7");
  });

  it("nomme le responsable", async () => {
    await monter();
    expect(within(ligne("acil_saha:7")).getByText(/Sorumlu : Paul Durand/)).toBeInTheDocument();
  });

  it("colore selon la charte : orange pour une decision humaine, rouge pour une urgence", async () => {
    await monter();
    expect(ligne("geri_arama:1").className).toMatch(/border-l-orange-400/);
    expect(ligne("acil_saha:7").className).toMatch(/border-l-red-600/);
    expect(document.querySelector("[data-testid='masa-bugun']")!.innerHTML).not.toMatch(/emerald|green-/);
  });

  it("donne le nombre total d'approbations et dit qu'il y en a d'autres", async () => {
    await monter();
    const panneau = screen.getByTestId("bugun-panneau-onaylar");
    expect(within(panneau).getByText("21")).toBeInTheDocument();
    expect(within(panneau).getByText("Daha fazlası var — tümünü görün")).toHaveAttribute("href", "/file-approbation");
  });

  it("dit d'ou vient chaque proposition, et l'echeance de la decision", async () => {
    await monter();
    expect(within(ligne("onay:3")).getByText(/Otomatik kural/)).toBeInTheDocument();
    expect(within(ligne("onay:3")).getByText(/Son karar/)).toBeInTheDocument();
    expect(within(ligne("onay:4")).getByText(/Telefon sekreteri/)).toBeInTheDocument();
    expect(within(ligne("onay:5")).getByText(/Diğer kaynak/)).toBeInTheDocument();
    // Categorie inconnue : libelle generique, pas la cle brute.
    expect(within(ligne("onay:4")).getByText("Onay bekliyor")).toBeInTheDocument();
  });

  it("donne sa source a chaque montant : depense saisie a la main, echeance de la facture", async () => {
    await monter();
    expect(within(ligne("butce_asimi:5")).getByText(/Harcama şantiyede elle girilmiş/)).toBeInTheDocument();
    expect(within(ligne("fatura_gecikti:2")).getByText(/^Vade\s/)).toBeInTheDocument();
    expect(within(ligne("fatura_gecikti:2")).getByText(/600/)).toBeInTheDocument();
    // Une proposition n'affiche pas de montant, meme si le serveur en posait un.
    expect(within(ligne("onay:3")).queryByText(/€/)).toBeNull();
  });

  it("dit en clair la connexion qui manque, et ce qu'elle empeche", async () => {
    await monter();
    expect(within(ligne("baglanti_eksik:telefon")).getByText("Telefon hattı bağlı değil — telefon ajanı çağrı alamaz")).toBeInTheDocument();
    expect(ligne("baglanti_eksik:telefon")).toHaveAttribute("href", "/telephonie");
    expect(screen.getByText("Son 24 saat: 2 çalışıyor · 1 insana devretti · 3 hata")).toBeInTheDocument();
  });

  it("dit « rien » dans un panneau vide, sans le remplir de conseils", async () => {
    await monter();
    const plan = screen.getByTestId("bugun-panneau-plan");
    expect(within(plan).getByText("Bugün için randevu, görev ya da teslim yok.")).toBeInTheDocument();
    expect(within(plan).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("montre une panne comme une panne, et se relance", async () => {
    statut = 500;
    localStorage.setItem("app.lang", "tr");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><I18nProvider><MasaBugun /></I18nProvider></QueryClientProvider>);
    const alerte = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alerte).toHaveTextContent(/yüklenemedi|pu être chargée/);
    statut = 200;
    const avant = appels;
    fireEvent.click(within(alerte).getByRole("button"));
    await waitFor(() => expect(appels).toBeGreaterThan(avant));
    await screen.findByText("Şimdi ilgilen", {}, { timeout: 5000 });
  });
});

describe("la source d'une proposition", () => {
  it("regroupe les producteurs sous un nom lisible", () => {
    expect(cleSource("ai_receptionist_callback")).toBe("telefon");
    expect(cleSource("missed_calls")).toBe("sekreter");
    expect(cleSource("orchestrateur")).toBe("orchestrateur");
    expect(cleSource("inconnu")).toBe("autre");
  });
});

describe("le tableau de bord ouvre sur la table de decision", () => {
  const tableau = lire("pages", "dashboard.tsx");
  it("monte la table avant les indicateurs", () => {
    expect(tableau.indexOf("<MasaBugun />")).toBeGreaterThan(0);
    expect(tableau.indexOf("<MasaBugun />")).toBeLessThan(tableau.indexOf('t("bugun.gostergeler")'));
  });
  it("n'affiche plus le decor ni les panneaux d'IA sans source", () => {
    for (const retire of ["officeTeamImg", "DashboardWebSearch", "<AiSpot", "<CentralIntelligence", "<AiRecognitionPanel", "<AiSuggestionsCard", "useLiveClock", "dashboard.footer.protected", "dashboard.footer.active"]) {
      expect(tableau, retire).not.toContain(retire);
    }
  });
});
