/**
 * Une meme lecture demandee par plusieurs composants ne doit partir qu une fois.
 *
 * La premiere mesure (33 requetes/minute au repos) venait du serveur de
 * DEVELOPPEMENT; reprise sur le build de production, le repos tient en UNE
 * requete par minute. Le quota applicatif n etait donc pas menace — voir
 * lecture-partagee.ts, ou l erreur est consignee.
 *
 * Ce que ces tests tiennent est ce qui reste vrai en production: trois
 * composants montes en permanence demandent le meme abonnement, et deux
 * lectures constantes (profil de l organisation, phrases de l assistant vocal)
 * repartent a chaque montage.
 */
import { describe, expect, it, vi } from "vitest";
import { lecturePartagee, oublierLecturesPartagees } from "./lecture-partagee";

describe("lecture partagee", () => {
  it("deux demandes simultanees ne declenchent qu'un appel", async () => {
    oublierLecturesPartagees();
    const charger = vi.fn(async () => "valeur");
    const [a, b] = await Promise.all([
      lecturePartagee("k1", charger),
      lecturePartagee("k1", charger),
    ]);
    expect([a, b]).toEqual(["valeur", "valeur"]);
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("une demande ulterieure, dans la fenetre, reutilise le resultat", async () => {
    oublierLecturesPartagees();
    const charger = vi.fn(async () => 42);
    await lecturePartagee("k2", charger, 10_000);
    await lecturePartagee("k2", charger, 10_000);
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("passe la fenetre, elle relit", async () => {
    oublierLecturesPartagees();
    vi.useFakeTimers();
    try {
      const charger = vi.fn(async () => 1);
      await lecturePartagee("k3", charger, 1000);
      vi.advanceTimersByTime(1500);
      await lecturePartagee("k3", charger, 1000);
      expect(charger).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("des cles differentes ne se melangent pas", async () => {
    oublierLecturesPartagees();
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");
    expect(await lecturePartagee("ka", a)).toBe("a");
    expect(await lecturePartagee("kb", b)).toBe("b");
  });

  it("un echec n'est PAS memorise: on peut reessayer aussitot", async () => {
    oublierLecturesPartagees();
    let appels = 0;
    const charger = vi.fn(async () => {
      appels++;
      if (appels === 1) throw new Error("reseau");
      return "ok";
    });
    await expect(lecturePartagee("k4", charger)).rejects.toThrow("reseau");
    expect(await lecturePartagee("k4", charger)).toBe("ok");
    expect(charger).toHaveBeenCalledTimes(2);
  });

  it("oublier efface tout (deconnexion: rien d'un autre compte ne survit)", async () => {
    oublierLecturesPartagees();
    const charger = vi.fn(async () => "x");
    await lecturePartagee("k5", charger, 60_000);
    oublierLecturesPartagees();
    await lecturePartagee("k5", charger, 60_000);
    expect(charger).toHaveBeenCalledTimes(2);
  });
});

describe("les appelants utilisent bien la lecture partagee", () => {
  const lire = async (chemin: string) =>
    (await import("node:fs/promises")).readFile(new URL(chemin, import.meta.url), "utf8");

  it("les deux bannieres d'abonnement partagent leur lecture", async () => {
    for (const f of ["../components/license-status-banner.tsx", "../components/trial-banner.tsx"]) {
      const source = await lire(f);
      expect(source, `${f} redemande /my-subscription pour lui seul`).toContain('lecturePartagee("my-subscription"');
    }
  });

  it("le profil de l'organisation aussi", async () => {
    expect(await lire("../components/layout.tsx")).toContain('lecturePartagee("org-profile"');
  });

  it("la liste des phrases vocales aussi", async () => {
    expect(await lire("../components/VoiceAssistant.tsx")).toContain("lecturePartagee(`voice-commands:");
  });

  it("au repos, l'etat des analyses n'est pas sonde plus d'une fois par minute", async () => {
    const source = await lire("../hooks/use-agent-run-status.ts");
    const m = source.match(/const IDLE_INTERVAL_MS = (\d+);/);
    expect(m, "IDLE_INTERVAL_MS introuvable").not.toBeNull();
    expect(Number(m![1]), "sondage au repos trop frequent").toBeGreaterThanOrEqual(60000);
  });
});
