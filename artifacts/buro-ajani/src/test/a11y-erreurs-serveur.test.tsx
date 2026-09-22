/**
 * Une saisie refusee par le SERVEUR designe son champ (RGAA 11.10).
 *
 * L'API renvoie `{ error, issues: [{ path, message }] }` quand elle refuse une
 * saisie ; les formulaires l'ignoraient et affichaient un message general.
 * Teste avec le vrai react-hook-form, dans un DOM.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { appliquerErreursServeur } from "@/lib/erreurs-serveur";

type Valeurs = { firstName: string; lastName: string; phone: string };
const DEFAUTS: Valeurs = { firstName: "", lastName: "", phone: "" };

/** Une erreur telle que le client d'API la leve (ApiError : `data` = corps). */
const erreurApi = (issues: unknown) => ({ name: "ApiError", status: 400, data: { error: "Requete invalide.", issues } });

function formulaire() {
  return renderHook(() => {
    const f = useForm<Valeurs>({ defaultValues: DEFAUTS });
    // formState est un proxy : il ne se met a jour que pour ce qu'un rendu
    // LIT. Les composants `Form` lisent les erreurs ; on fait de meme ici.
    void f.formState.errors;
    return f;
  }).result;
}

describe("appliquerErreursServeur", () => {
  it("rattache chaque probleme a son champ, avec le message du serveur", () => {
    const r = formulaire();
    act(() => { appliquerErreursServeur(erreurApi([{ path: "phone", message: "Numero invalide" }]), r.current); });
    expect(r.current.formState.errors.phone?.message).toBe("Numero invalide");
    expect(r.current.formState.errors.phone?.type).toBe("server");
  });

  it("signale plusieurs champs", () => {
    const r = formulaire();
    let n = 0;
    act(() => { n = appliquerErreursServeur(erreurApi([{ path: "firstName", message: "a" }, { path: "lastName", message: "b" }]), r.current); });
    expect(n).toBe(2);
    expect(Object.keys(r.current.formState.errors).sort()).toEqual(["firstName", "lastName"]);
  });

  it("un chemin imbrique (items.0.x) vise son champ racine", () => {
    const r = formulaire();
    act(() => { appliquerErreursServeur(erreurApi([{ path: "phone.0", message: "x" }]), r.current); });
    expect(r.current.formState.errors.phone).toBeDefined();
  });

  it("ignore un champ que le formulaire ne connait pas", () => {
    const r = formulaire();
    let n = -1;
    act(() => { n = appliquerErreursServeur(erreurApi([{ path: "organisationId", message: "x" }]), r.current); });
    expect(n).toBe(0);
    expect(r.current.formState.errors).toEqual({});
  });

  it("une erreur sans `issues` (doublon, droit, panne) ne signale rien", () => {
    const r = formulaire();
    let n = -1;
    act(() => { n = appliquerErreursServeur({ data: { error: "Interdit" } }, r.current); });
    expect(n).toBe(0);
  });

  it("une erreur reseau (ni data ni issues) ne casse rien", () => {
    const r = formulaire();
    expect(() => act(() => { appliquerErreursServeur(new TypeError("Failed to fetch"), r.current); })).not.toThrow();
    expect(() => act(() => { appliquerErreursServeur(null, r.current); })).not.toThrow();
  });

  it("des entrees malformees sont ignorees", () => {
    const r = formulaire();
    let n = -1;
    act(() => { n = appliquerErreursServeur(erreurApi([{ path: 3, message: "x" }, { path: "phone" }, "texte"]), r.current); });
    expect(n).toBe(0);
  });
});

describe("les formulaires branches sur les routes validees l'appellent", () => {
  const PAGES = join(import.meta.dirname, "..", "pages");
  const attendus: Array<[string, number]> = [
    ["contacts.tsx", 2], ["contact-detail.tsx", 1], ["calls.tsx", 2], ["messages.tsx", 2], ["tasks.tsx", 2],
  ];
  for (const [f, n] of attendus) {
    it(`${f} : ${n} soumission(s)`, () => {
      const s = readFileSync(join(PAGES, f), "utf8");
      expect((s.match(/appliquerErreursServeur\(err, form\)/g) ?? []).length).toBe(n);
      // Le formulaire doit afficher les erreurs de champ (FormMessage relie au champ).
      expect(s).toContain("<FormMessage");
    });
  }
});
