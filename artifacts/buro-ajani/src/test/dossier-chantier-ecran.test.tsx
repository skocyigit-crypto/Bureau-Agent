/**
 * Le dossier de chantier et la comparaison par affaire, rendus (plan du 29/09,
 * sections 6, 8 et 12). Le serveur est simule par `fetch` ; pages, traductions
 * et composants sont reels. En turc, la langue de l'utilisateur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { I18nProvider } from "@/i18n";
import DossierChantierPage, { type Dossier } from "@/pages/dossier-chantier";
import FinanceAffairesPage from "@/pages/finance-affaires";
import { depuisReponse } from "@/components/etat-ecran";

const vide = { toplam: 0, adet: 0, kaynaklar: [], fazlasi: false };
function dossier(sur: Partial<Dossier["montants"]> = {}, onglets: Partial<Dossier["onglets"]> = {}): Dossier {
  return {
    projet: { id: 7, baslik: "Ravalement Duval", aciklama: null, durum: "en_cours", oncelik: "moyenne", musteri: "SCI Duval", adres: "3 rue du Port", sorumlu: "Paul", baslangic: null, bitis: null, gercekBitis: null, kabul: null, kabulCekinceli: false, cekinceler: null, ilerleme: 0, devisId: 3, prospectId: null, contactId: null },
    montants: {
      devise: "EUR",
      teklif: { toplam: 12000, adet: 1, kaynaklar: [{ tur: "devis", id: 3, baslik: "DV-3", detay: "Ravalement", tutar: 12000, zaman: null, href: "/devis?id=3" }], fazlasi: false },
      ekIsler: vide, onayliIs: 12000,
      gider: { toplam: 13000, adet: 1, kaynaklar: [{ tur: "depense", id: 9, baslik: "Point P", detay: "materiel", tutar: 13000, zaman: null, href: "/depenses?id=9" }], fazlasi: false },
      faturalanan: vide, tahsilEdilen: vide,
      marj: -1000, faturalanmayan: 12000, tahsilEdilmeyen: 0, asim: true, butcePrevision: null,
      ...sur,
    },
    onglets: {
      ekip: [], planning: [], gorevler: [], gunluk: [], belgeler: [], gorusmeler: [],
      avenantlar: [{ id: 4, devisId: 11, reference: "AVN-1", motif: "Appuis fissures", statut: "brouillon", tutar: 1200, zaman: null }],
      ...onglets,
    },
  };
}

let statut = 200;
let corps: unknown;
let posts: { url: string; body: any }[] = [];

beforeEach(() => {
  statut = 200; corps = dossier(); posts = [];
  localStorage.setItem("app.lang", "tr");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posts.push({ url: String(url), body: JSON.parse(String(init.body)) }); return { ok: true, status: 201, json: async () => ({}) } as Response; }
    return { ok: statut < 400, status: statut, json: async () => corps } as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function monter(page: React.ReactNode, chemin = "/projets/7") {
  const { hook } = memoryLocation({ path: chemin });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nProvider><Router hook={hook}>{page}</Router></I18nProvider></QueryClientProvider>);
}
const ouvrir = async () => { monter(<DossierChantierPage />); await screen.findByTestId("titre-chantier", {}, { timeout: 5000 }); await screen.findByText("Teklif edilen tutar", {}, { timeout: 5000 }); };

describe("le dossier de chantier", () => {
  it("montre les cinq montants sous les noms du plan", async () => {
    await ouvrir();
    for (const n of ["Teklif edilen tutar", "Onaylı ek işler", "Gerçekleşen gider", "Faturalanan", "Tahsil edilen"]) expect(screen.getAllByText(n).length).toBeGreaterThan(0);
  });

  it("chaque montant ouvre ses lignes, qui menent a leur fiche", async () => {
    await ouvrir();
    const carte = screen.getByTestId("montant-teklif");
    fireEvent.click(within(carte).getByRole("button"));
    expect(within(carte).getByRole("link")).toHaveAttribute("href", "/devis?id=3");
  });

  it("un depassement est une alerte rouge qui dit de combien", async () => {
    await ouvrir();
    expect(screen.getByTestId("alerte-depassement")).toHaveTextContent(/aşıyor/);
    expect(screen.getAllByTestId("montant-gider")[0].className).toMatch(/border-red-600/);
  });

  it("un avenant en attente est orange, annonce, et dit qu'il ne compte pas", async () => {
    await ouvrir();
    expect(screen.getByTestId("avenants-en-attente")).toHaveTextContent(/onaylı işe girmez/);
    expect(screen.getByTestId("avenant-4").className).toMatch(/border-l-orange-400/);
  });

  it("les huit onglets du plan sont la", async () => {
    await ouvrir();
    for (const o of ["Özet", "Planning", "Ekip", "Saha Günlüğü", "Belgeler", "Giderler", "Faturalar", "Görüşmeler"]) expect(screen.getByRole("tab", { name: o })).toBeInTheDocument();
  });

  it("sans prix accepte, il dit que marge et depassement ne se calculent pas", async () => {
    corps = dossier({ onayliIs: 0, asim: false, teklif: vide });
    await ouvrir();
    expect(screen.getByTestId("sans-engage")).toBeInTheDocument();
    expect(screen.queryByTestId("alerte-depassement")).toBeNull();
  });

  it("un chantier introuvable n'est pas une page vide", async () => {
    statut = 404;
    monter(<DossierChantierPage />);
    expect(await screen.findByTestId("etat-ecran-introuvable", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("un refus d'acces est dit comme tel, pas comme une absence", async () => {
    statut = 403;
    monter(<DossierChantierPage />);
    expect(await screen.findByTestId("etat-ecran-interdit", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("l'avenant part vers la route dediee avec motif et lignes chiffrees", async () => {
    await ouvrir();
    fireEvent.click(screen.getByTestId("ouvrir-avenant"));
    const f = screen.getByTestId("form-avenant");
    fireEvent.change(within(f).getByLabelText("Başlık"), { target: { value: "Garde-corps" } });
    fireEvent.change(within(f).getByLabelText("Gerekçe"), { target: { value: "Bureau de controle" } });
    fireEvent.change(within(f).getByLabelText("Kalem 1 — açıklama"), { target: { value: "Garde-corps acier" } });
    fireEvent.change(within(f).getByLabelText("Kalem 1 — birim fiyat"), { target: { value: "850" } });
    fireEvent.click(within(f).getByRole("button", { name: "Taslak ek iş oluştur" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].url).toMatch(/\/api\/projets\/7\/avenant$/);
    expect(posts[0].body).toMatchObject({ title: "Garde-corps", motif: "Bureau de controle", items: [{ description: "Garde-corps acier", quantity: 1, unitPrice: 850, total: 850 }] });
  });
});

describe("la comparaison par affaire", () => {
  const lignes = [
    { id: 7, baslik: "Duval", durum: "en_cours", musteri: null, devise: "EUR", teklif: 12000, ekIsler: 0, onayliIs: 12000, gider: 13000, faturalanan: 0, tahsilEdilen: 0, marj: -1000, faturalanmayan: 12000, tahsilEdilmeyen: 0, asim: true },
    { id: 8, baslik: "Martin", durum: "termine", musteri: null, devise: "EUR", teklif: 5000, ekIsler: 0, onayliIs: 5000, gider: 2000, faturalanan: 5000, tahsilEdilen: 5000, marj: 3000, faturalanmayan: 0, tahsilEdilmeyen: 0, asim: false },
  ];
  it("chaque ligne mene au dossier, et le filtre isole les depassements", async () => {
    corps = { lignes };
    monter(<FinanceAffairesPage />, "/finance/affaires");
    const l = await screen.findByTestId("affaire-7", {}, { timeout: 5000 });
    expect(within(l).getByRole("link", { name: "Duval" })).toHaveAttribute("href", "/projets/7");
    fireEvent.click(screen.getByTestId("filtre-asim"));
    expect(screen.queryByTestId("affaire-8")).toBeNull();
    expect(screen.getByTestId("filtre-asim")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("une devise qui n'est pas un code ISO", () => {
  it("s'affiche au lieu de faire tomber l'ecran", async () => {
    const { argentSur } = await import("@/pages/dossier-chantier");
    expect(() => argentSur("tr", 1200, "euros")).not.toThrow();
    expect(argentSur("tr", 1200, "euros")).toMatch(/euros/);
  });
});

describe("les quatre etats", () => {
  it("trie les statuts HTTP sans confondre absence et refus", () => {
    expect(depuisReponse(404)).toBe("introuvable");
    expect(depuisReponse(403)).toBe("interdit");
    expect(depuisReponse(401)).toBe("interdit");
    expect(depuisReponse(503)).toBe("hors_ligne");
    expect(depuisReponse(null)).toBe("hors_ligne");
  });
});

describe("atteignable", () => {
  const src = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");
  it("routes et menu", () => {
    expect(src("App.tsx")).toMatch(/path="\/projets\/:id"/);
    expect(src("App.tsx")).toMatch(/path="\/finance\/affaires"/);
    expect(src("lib", "gezinti.ts")).toContain('seule("businessComparison", "/finance/affaires"');
  });
});
