/**
 * L'ecran d'un appel en direct et l'indicateur de la barre du haut. Serveur
 * simule, page et traductions reelles, en turc. Aucun Twilio : la reprise est
 * testee contre la reponse du serveur, jamais comme si elle marchait en vrai.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n";
import { AppelLiveEcran } from "@/pages/appel-live";
import { IndicateurAppelEnDirect } from "@/components/appel-en-direct";

const SID = "CAtest123456";
let posts: Array<{ url: string; body: any }> = [];
let detail: any;
let capacite: any;
let liste: any;
let reponsePost: { status: number; corps: any };

const DETAIL = {
  callSid: SID, status: "en_cours", enDirect: true, debut: "2026-10-01T08:00:00Z", derniereActivite: "2026-10-01T08:01:00Z",
  appelant: { nom: "Claire Martin", numero: "+33611223344", contactId: 42, appelsPrecedents: 3, contexte: "Devis cuisine en cours" },
  demande: "Je veux un devis", etape: "rdv_propose", urgent: false,
  tours: [{ role: "user", texte: "Bonjour, je veux un devis" }, { role: "assistant", texte: "Bien sûr, pour quels travaux ?" }],
  journal: ["Appelant reconnu"], reprise: { statut: null, le: null, par: null },
};
const CAP_OK = { fournisseur: "twilio", reprisePossible: true, raison: null, cibles: [{ id: "moi", libelle: "moi", numeroMasque: "+33••••78" }, { id: "equipe:Chantier", libelle: "Chantier", numeroMasque: "+33••••12" }] };
const CAP_AUCUN = { fournisseur: null, reprisePossible: false, raison: "aucun_fournisseur", cibles: [] };

beforeEach(() => {
  posts = [];
  detail = structuredClone(DETAIL);
  capacite = CAP_OK;
  liste = { appels: [] };
  reponsePost = { status: 201, corps: { id: 1 } };
  localStorage.setItem("app.lang", "tr");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") {
      posts.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null });
      return { ok: reponsePost.status < 400, status: reponsePost.status, json: async () => reponsePost.corps } as Response;
    }
    if (u.endsWith("/api/appels-live/capacite")) return { ok: true, status: 200, json: async () => capacite } as Response;
    if (u.endsWith("/api/appels-live")) return { ok: true, status: 200, json: async () => liste } as Response;
    if (u.includes(`/api/appels-live/${SID}`)) {
      if (!detail) return { ok: false, status: 404, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => detail } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function monter(el: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nProvider>{el}</I18nProvider></QueryClientProvider>);
}
const ecran = () => monter(<AppelLiveEcran callSid={SID} />);

describe("l'ecran d'appel en direct", () => {
  it("a trois colonnes : appelant, transcription, actions", async () => {
    ecran();
    expect(await screen.findByTestId("colonne-appelant", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId("colonne-transcription")).toBeInTheDocument();
    expect(screen.getByTestId("colonne-actions")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Arayan" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Canlı döküm" })).toBeInTheDocument();
  });

  it("la colonne appelant montre le nom, le contexte et le lien vers la fiche", async () => {
    ecran();
    const col = await screen.findByTestId("colonne-appelant", {}, { timeout: 5000 });
    expect(within(col).getByText("Claire Martin")).toBeInTheDocument();
    expect(within(col).getByText("Devis cuisine en cours")).toBeInTheDocument();
    expect(within(col).getByText("Önceki çağrı: 3")).toBeInTheDocument();
    expect(within(col).getByRole("link", { name: "Kişi kartını aç" })).toHaveAttribute("href", "/contacts/42");
  });

  it("la transcription affiche chaque tour avec son auteur", async () => {
    ecran();
    const t = await screen.findByTestId("transcription", {}, { timeout: 5000 });
    const items = within(t).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Arayan");
    expect(items[0]).toHaveTextContent("Bonjour, je veux un devis");
    expect(items[1]).toHaveTextContent("Asistan");
  });

  it("le badge dit l'etape de l'agent", async () => {
    ecran();
    expect(await screen.findByTestId("etape-agent", {}, { timeout: 5000 })).toHaveTextContent("Ajan adımı : Randevu önerdi, onay bekliyor");
  });

  it("sans fournisseur : « Çağrıyı devral » desactive, avec la raison", async () => {
    capacite = CAP_AUCUN;
    ecran();
    const b = await screen.findByRole("button", { name: "Çağrıyı devral" }, { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId("raison-reprise")).toHaveTextContent("Telefon sağlayıcı bağlı değil"));
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-describedby");
    expect(screen.getByTestId("bouton-aktar")).toBeDisabled();
  });

  it("reprise possible : le bouton envoie la cible « moi » et affiche le numero masque", async () => {
    reponsePost = { status: 200, corps: { ok: true, cible: { id: "moi", libelle: "moi", numeroMasque: "+33••••78" } } };
    ecran();
    const b = await screen.findByRole("button", { name: "Çağrıyı devral" }, { timeout: 5000 });
    await waitFor(() => expect(b).toBeEnabled());
    fireEvent.click(b);
    await waitFor(() => expect(posts.some((p) => p.url.endsWith(`/api/appels-live/${SID}/devral`) && p.body.cible === "moi")).toBe(true));
    expect(await screen.findByTestId("message-action")).toHaveTextContent("Çağrı devralındı: +33••••78 çalıyor.");
  });

  it("refus de Twilio : la vraie raison s'affiche, pas un faux succes", async () => {
    reponsePost = { status: 502, corps: { ok: false, code: "twilio", raison: "Call is not in-progress" } };
    ecran();
    const b = await screen.findByRole("button", { name: "Çağrıyı devral" }, { timeout: 5000 });
    await waitFor(() => expect(b).toBeEnabled());
    fireEvent.click(b);
    expect(await screen.findByTestId("message-action")).toHaveTextContent("Twilio reddetti: Call is not in-progress");
  });

  it("aktar envoie l'equipe choisie", async () => {
    reponsePost = { status: 200, corps: { ok: true, cible: CAP_OK.cibles[1] } };
    ecran();
    const b = await screen.findByTestId("bouton-aktar", {}, { timeout: 5000 });
    await waitFor(() => expect(b).toBeEnabled());
    fireEvent.click(b);
    await waitFor(() => expect(posts.some((p) => p.url.endsWith("/devral") && p.body.cible === "equipe:Chantier")).toBe(true));
  });

  it("un appel deja repris : bouton desactive, raison et auteur affiches", async () => {
    detail.reprise = { statut: "reussi", le: "2026-10-01T08:02:00Z", par: "Ali Yilmaz" };
    detail.etape = "reprise_humaine";
    ecran();
    expect(await screen.findByText("Devralan: Ali Yilmaz", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("raison-reprise")).toHaveTextContent("Çağrı zaten devralındı"));
    expect(screen.getByRole("button", { name: "Çağrıyı devral" })).toBeDisabled();
  });

  it("creer une tache depuis l'appel poste le titre", async () => {
    ecran();
    fireEvent.change(await screen.findByLabelText("Görev başlığı", {}, { timeout: 5000 }), { target: { value: "Devis à envoyer" } });
    fireEvent.click(screen.getByTestId("bouton-tache"));
    await waitFor(() => expect(posts.some((p) => p.url.endsWith(`/api/appels-live/${SID}/tache`) && p.body.titre === "Devis à envoyer")).toBe(true));
    expect(await screen.findByTestId("message-action")).toHaveTextContent("Kaydedildi");
  });

  it("enregistrer une note poste le contenu", async () => {
    ecran();
    fireEvent.change(await screen.findByLabelText("Not içeriği", {}, { timeout: 5000 }), { target: { value: "Budget 15 k" } });
    fireEvent.click(screen.getByTestId("bouton-note"));
    await waitFor(() => expect(posts.some((p) => p.url.endsWith("/note") && p.body.contenu === "Budget 15 k")).toBe(true));
  });

  it("ouvrir un rendez-vous de decouverte poste la date et l'adresse", async () => {
    ecran();
    fireEvent.change(await screen.findByLabelText("Tarih ve saat", {}, { timeout: 5000 }), { target: { value: "2026-10-05T09:30" } });
    fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "12 rue des Lilas" } });
    fireEvent.click(screen.getByTestId("bouton-rdv"));
    await waitFor(() => expect(posts.some((p) => p.url.endsWith("/rdv-decouverte") && p.body.lieu === "12 rue des Lilas" && !Number.isNaN(Date.parse(p.body.debut)))).toBe(true));
  });

  it("un appel inconnu affiche « bulunamadı », rien d'invente", async () => {
    detail = null;
    ecran();
    expect(await screen.findByTestId("appel-introuvable", {}, { timeout: 5000 })).toHaveTextContent("Bu çağrı bulunamadı.");
    expect(screen.queryByTestId("colonne-transcription")).toBeNull();
  });

  it("un appel termine le dit et n'offre plus la reprise", async () => {
    detail.enDirect = false;
    detail.status = "terminee";
    ecran();
    expect(await screen.findByTestId("appel-termine", {}, { timeout: 5000 })).toHaveTextContent("Çağrı sona erdi");
    await waitFor(() => expect(screen.getByTestId("raison-reprise")).toHaveTextContent("Çağrı artık canlı değil"));
    expect(screen.getByRole("button", { name: "Çağrıyı devral" })).toBeDisabled();
  });
});

describe("l'indicateur d'appel en direct", () => {
  const UN = { callSid: SID, status: "en_cours", appelant: "Claire Martin", numeroMasque: "+33••••44", contactId: 42, debut: "", derniereActivite: "", etape: "ecoute", dernierJournal: null, reprise: null };

  it("cache a zero appel", async () => {
    const { container } = monter(<IndicateurAppelEnDirect />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("indicateur-appel-direct")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("visible a un appel, avec le nombre, et mene a l'ecran de l'appel", async () => {
    liste = { appels: [UN] };
    monter(<IndicateurAppelEnDirect />);
    const l = await screen.findByTestId("indicateur-appel-direct", {}, { timeout: 5000 });
    expect(l).toHaveTextContent("1 canlı çağrı");
    expect(l).toHaveAttribute("href", `/appels/live/${SID}`);
    expect(l).toHaveAccessibleName("Şu anda 1 canlı çağrı var — aç");
  });

  it("compte plusieurs appels", async () => {
    liste = { appels: [UN, { ...UN, callSid: "CAautre99999" }] };
    monter(<IndicateurAppelEnDirect />);
    expect(await screen.findByTestId("indicateur-appel-direct", {}, { timeout: 5000 })).toHaveTextContent("2 canlı çağrı");
  });

  it("une erreur serveur ne montre pas de faux appel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    monter(<IndicateurAppelEnDirect />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("indicateur-appel-direct")).toBeNull();
  });

  it("disparait quand l'appel se termine (zero au tour suivant)", async () => {
    liste = { appels: [UN] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><I18nProvider><IndicateurAppelEnDirect /></I18nProvider></QueryClientProvider>);
    await screen.findByTestId("indicateur-appel-direct", {}, { timeout: 5000 });
    liste = { appels: [] };
    await qc.invalidateQueries({ queryKey: ["appels-live"] });
    await waitFor(() => expect(screen.queryByTestId("indicateur-appel-direct")).toBeNull());
  });

  it("toutes les chaines de l'ecran existent dans les 6 langues", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const lire = (l: string) => JSON.parse(readFileSync(join(__dirname, "..", "i18n", "locales", `${l}.json`), "utf8")).appelLive;
    const cles = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? cles(v, `${p}${k}.`) : [`${p}${k}`]));
    const ref = cles(lire("fr")).sort();
    for (const l of ["tr", "en", "es", "de", "ar"]) expect(cles(lire(l)).sort(), l).toEqual(ref);
  });
});
