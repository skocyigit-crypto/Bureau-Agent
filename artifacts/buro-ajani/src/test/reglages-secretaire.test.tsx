/**
 * Reglages de la secretaire : equipes de transfert et six langues.
 *
 * La demande : « rediriger vers la bonne personne ou equipe ». L'ecran n'avait
 * qu'un numero de transfert, et ne proposait que trois des six langues que
 * la secretaire parle. Serveur simule par `fetch` ; l'ecran est reel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/i18n";
import { WorkspaceUserProvider } from "@/components/workspace-user";
import { TabAppels } from "@/pages/settings/tab-appels";

let envoye: Record<string, any> | null = null;
const CONFIG = {
  configured: true, enabled: true, language: "es", greeting: "", orgName: "Duval", voice: "",
  forwardToNumber: "+33700000009", ownerAlertNumber: "",
  equipesTransfert: [{ nom: "Comptabilité", numeros: ["+33700000011"], motsCles: ["facture"] }],
  fraudAction: "off", businessHours: null,
};
const reponse = (corps: unknown, status = 200) => ({ ok: status < 400, status, json: async () => corps }) as Response;

function monter() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider>
        <WorkspaceUserProvider apiUser={{ id: 1, email: "a@b.fr", nom: "T", prenom: "A", role: "administrateur" }} onLogout={() => {}}>
          <TabAppels />
        </WorkspaceUserProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("app.lang", "fr");
  envoye = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/telephony/ai-receptionist") && init?.method === "PUT") { envoye = JSON.parse(String(init.body)); return reponse({ ok: true }); }
    if (url.endsWith("/api/telephony/ai-receptionist")) return reponse(CONFIG);
    if (url.endsWith("/api/telephony/fraud-protection")) return reponse({ action: "off", configured: true });
    return reponse({}, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("equipes de transfert", () => {
  it("les equipes enregistrees s'affichent, champ par champ, avec un nom accessible", async () => {
    monter();
    expect(((await screen.findByLabelText("Nom de l'équipe 1")) as HTMLInputElement).value).toBe("Comptabilité");
    expect((screen.getByLabelText("Numéros de l'équipe 1") as HTMLInputElement).value).toBe("+33700000011");
    expect((screen.getByLabelText("Mots-clés de l'équipe 1") as HTMLInputElement).value).toBe("facture");
  });

  it("ajouter une equipe : les numeros et mots-cles partent en listes", async () => {
    monter();
    await screen.findByLabelText("Nom de l'équipe 1");
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une équipe" }));
    fireEvent.change(screen.getByLabelText("Nom de l'équipe 2"), { target: { value: "Chantiers" } });
    fireEvent.change(screen.getByLabelText("Numéros de l'équipe 2"), { target: { value: "+33700000021, +33700000022" } });
    fireEvent.change(screen.getByLabelText("Mots-clés de l'équipe 2"), { target: { value: "chantier; travaux" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await waitFor(() => expect(envoye).not.toBeNull());
    expect(envoye!.equipesTransfert).toEqual([
      { nom: "Comptabilité", numeros: ["+33700000011"], motsCles: ["facture"] },
      { nom: "Chantiers", numeros: ["+33700000021", "+33700000022"], motsCles: ["chantier", "travaux"] },
    ]);
  });

  it("retirer une equipe : elle ne part plus", async () => {
    monter();
    await screen.findByLabelText("Nom de l'équipe 1");
    fireEvent.click(screen.getByRole("button", { name: "Retirer l'équipe 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await waitFor(() => expect(envoye).not.toBeNull());
    expect(envoye!.equipesTransfert).toEqual([]);
  });

  it("une ligne vide n'est pas envoyee comme equipe", async () => {
    monter();
    await screen.findByLabelText("Nom de l'équipe 1");
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une équipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await waitFor(() => expect(envoye).not.toBeNull());
    expect(envoye!.equipesTransfert).toHaveLength(1);
  });
});

describe("langues", () => {
  it("l'espagnol enregistre est affiche (il etait ramene au francais)", async () => {
    monter();
    await screen.findByLabelText("Nom de l'équipe 1");
    expect(screen.getByLabelText("Langue").textContent).toMatch(/Español/);
  });

  it("et repart tel quel a l'enregistrement", async () => {
    monter();
    await screen.findByLabelText("Nom de l'équipe 1");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les réglages" }));
    await waitFor(() => expect(envoye).not.toBeNull());
    expect(envoye!.language).toBe("es");
  });
});
