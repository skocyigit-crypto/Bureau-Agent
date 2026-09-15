// @vitest-environment jsdom
/**
 * La fenetre de demande de demonstration: le formulaire du site vitrine.
 *
 * Elle n'avait aucun test. C'est pourtant le seul endroit du site ou un
 * visiteur laisse ses coordonnees — tout le reste est de la lecture. Si elle
 * echoue, rien ne le signale: il n'y a pas d'utilisateur connecte pour se
 * plaindre, et l'absence de demandes ressemble a un marche calme. Verifie en
 * production: zero demande recue en trente jours, et zero blocage — donc
 * aucune preuve que le chemin fonctionne, seulement l'absence de trafic.
 *
 * Les verifications portent sur ce que le visiteur VIT:
 *
 *   - ce qui doit marcher (envoi, confirmation, reprise apres fermeture);
 *   - ce qui ne doit JAMAIS arriver (perdre une saisie sans le dire, laisser
 *     croire a un succes apres un refus, envoyer deux fois sur double clic).
 *
 * La derniere famille compte le plus: un formulaire qui echoue en silence
 * coute un prospect que personne ne saura jamais avoir perdu.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DemoModal } from "@/components/DemoModal";

const reponse = (ok: boolean, corps: unknown) =>
  Promise.resolve({ ok, json: () => Promise.resolve(corps) } as Response);

function remplirLeMinimum() {
  fireEvent.change(screen.getByLabelText(/pr[ée]nom/i), { target: { value: "Jean" } });
  fireEvent.change(screen.getByLabelText(/^nom/i), { target: { value: "Durand" } });
  fireEvent.change(screen.getByLabelText(/e-?mail/i), { target: { value: "jean@durand.fr" } });
  fireEvent.change(screen.getByLabelText(/soci[ée]t[ée]|entreprise/i), {
    target: { value: "Durand Maconnerie" },
  });
}

function envoyer() {
  const bouton = screen.getByRole("button", { name: /envoyer ma demande|envoi en cours/i });
  fireEvent.click(bouton);
  return bouton;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => reponse(true, { message: "Recu" })));
});

afterEach(() => {
  // Ce projet ne configure pas le nettoyage automatique: sans cet appel, les
  // rendus s'empilent et chaque selecteur trouve plusieurs elements.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ce que le visiteur doit pouvoir faire", () => {
  it("la fenetre ne s'affiche pas tant qu'on ne l'ouvre pas", () => {
    render(<DemoModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /envoyer ma demande/i })).toBeNull();
  });

  it("le formulaire s'affiche a l'ouverture", () => {
    render(<DemoModal open onClose={() => {}} />);
    expect(screen.getByLabelText(/pr[ée]nom/i)).toBeTruthy();
  });

  it("l'envoi atteint la bonne adresse, en POST et en JSON", async () => {
    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    envoyer();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, options] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/public/demo-request");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("les champs saisis partent bien dans la requete", async () => {
    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    envoyer();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const corps = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(corps).toMatchObject({
      firstName: "Jean",
      lastName: "Durand",
      email: "jean@durand.fr",
      company: "Durand Maconnerie",
    });
  });

  it("une confirmation remplace le formulaire apres succes", async () => {
    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    envoyer();

    // Sans confirmation visible, le visiteur renvoie — ou s'en va en pensant
    // que rien n'est parti.
    await waitFor(() =>
      expect(screen.queryByLabelText(/pr[ée]nom/i)).toBeNull(),
    );
  });

  it("l'origine du clic est jointe a la demande quand elle est connue", async () => {
    // Savoir depuis quelle page le visiteur a demande la demo est la seule
    // qualification gratuite dont dispose le commercial.
    render(<DemoModal open onClose={() => {}} source="Tarifs" />);
    remplirLeMinimum();
    envoyer();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const corps = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(corps.message).toContain("Tarifs");
  });
});

describe("ce qui ne doit jamais arriver", () => {
  it("un refus du serveur affiche SON message, pas un succes", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reponse(false, { error: "Adresse email invalide." })));
    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    envoyer();

    await waitFor(() => expect(screen.getByText(/Adresse email invalide/i)).toBeTruthy());
    // Le formulaire reste affiche: la saisie n'est pas perdue.
    expect(screen.getByLabelText(/pr[ée]nom/i)).toBeTruthy();
  });

  it("une panne reseau est dite au visiteur, pas avalee", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    envoyer();

    // Le pire des cas serait un bouton qui revient a l'etat normal sans un mot:
    // le visiteur croit avoir envoye, et personne n'a rien recu.
    await waitFor(() => expect(screen.getByText(/r[ée]seau|connexion/i)).toBeTruthy());
  });

  it("un refus sans message affiche quand meme une phrase", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reponse(false, {})));
    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    envoyer();

    await waitFor(() => expect(screen.getByText(/erreur|r[ée]essayer/i)).toBeTruthy());
  });

  it("le double clic n'envoie pas deux demandes", async () => {
    let resoudre: (v: unknown) => void = () => {};
    const enAttente = new Promise((r) => { resoudre = r; });
    vi.stubGlobal("fetch", vi.fn(() => enAttente));

    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    const bouton = envoyer();
    fireEvent.click(bouton);

    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
      "un second clic pendant l'envoi cree un doublon dans la liste du commercial",
    ).toBe(1);

    resoudre(await reponse(true, { message: "Recu" }));
  });

  it("le bouton est desactive pendant l'envoi", async () => {
    let resoudre: (v: unknown) => void = () => {};
    const enAttente = new Promise((r) => { resoudre = r; });
    vi.stubGlobal("fetch", vi.fn(() => enAttente));

    render(<DemoModal open onClose={() => {}} />);
    remplirLeMinimum();
    const bouton = envoyer();

    await waitFor(() => expect((bouton as HTMLButtonElement).disabled).toBe(true));
    resoudre(await reponse(true, { message: "Recu" }));
  });

  it("fermer la fenetre previent le parent", () => {
    // Sans cela, la page d'accueil garderait la fenetre ouverte dans son etat
    // et le visiteur ne pourrait plus rien faire.
    const onClose = vi.fn();
    render(<DemoModal open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText(/fermer/i));
    expect(onClose).toHaveBeenCalled();
  });

  it("la fenetre porte un nom accessible pour sa fermeture", () => {
    // Un bouton de fermeture sans nom est injoignable au clavier et au
    // lecteur d'ecran: la fenetre devient un piege.
    render(<DemoModal open onClose={() => {}} />);
    expect(screen.getByLabelText(/fermer/i)).toBeTruthy();
  });
});
