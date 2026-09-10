/**
 * Le diagnostic de poste.
 *
 * Ce qui compte ici tient en trois idees, et la troisieme est la moins
 * evidente:
 *
 *  1. un defaut reel doit etre vu — un antivirus eteint, un disque plein, un
 *     systeme qui ne recoit plus de correctifs;
 *
 *  2. un poste sain ne doit rien declencher. Un diagnostic qui trouve toujours
 *     quelque chose n'est plus lu, et devient un argument de vente plutot
 *     qu'un outil;
 *
 *  3. ce qui n'a PAS pu etre mesure doit se dire. Une machine peut refuser une
 *     mesure (droits insuffisants pour BitLocker, sauvegarde faite par un
 *     outil qu'on ne voit pas). Traiter « pas mesure » comme « tout va bien »
 *     serait le pire des deux mondes: rassurer sans savoir.
 */
import { describe, expect, it } from "vitest";

import { analyserPoste, type RapportPoste } from "../services/diagnostic-poste";

/** Date fixe: un diagnostic ne doit pas dependre du jour ou les tests tournent. */
const MAINTENANT = new Date("2026-09-10T12:00:00Z");

const ilYA = (jours: number) =>
  new Date(MAINTENANT.getTime() - jours * 24 * 60 * 60 * 1000).toISOString();

/** Poste en bon etat: tout est mesure, tout va bien. */
function posteSain(): RapportPoste {
  return {
    collecteLe: MAINTENANT.toISOString(),
    os: { nom: "Windows 11 Pro", version: "24H2", build: "26100" },
    dernierDemarrage: ilYA(2),
    derniereMaj: ilYA(10),
    disques: [{ lettre: "C:", totalGo: 500, libreGo: 220 }],
    memoireGo: 16,
    antivirus: { nom: "Microsoft Defender", actif: true, signaturesAJour: true },
    parefeu: { actif: true },
    chiffrementDisque: { actif: true },
    sauvegarde: { configuree: true, derniereLe: ilYA(1) },
    logiciels: [{ nom: "Ajant Bureau", version: "1.0.0" }],
  };
}

describe("un poste sain", () => {
  it("ne declenche aucun constat", () => {
    const d = analyserPoste(posteSain(), MAINTENANT);
    expect(d.constats, `constats inattendus: ${d.constats.map((c) => c.code).join(", ")}`).toEqual([]);
    expect(d.score).toBe(100);
  });

  it("ne signale rien comme non mesure", () => {
    expect(analyserPoste(posteSain(), MAINTENANT).nonMesure).toEqual([]);
  });
});

describe("ce qui doit etre vu", () => {
  it("un systeme qui ne recoit plus de correctifs", () => {
    // Windows 10 n'est plus supporte depuis le 14 octobre 2025.
    const d = analyserPoste({ ...posteSain(), os: { nom: "Windows 10 Pro" } }, MAINTENANT);
    const c = d.constats.find((x) => x.code === "os_hors_support");
    expect(c).toBeDefined();
    expect(c!.gravite).toBe("critique");
    // Le remede doit etre un geste, pas un constat repete.
    expect(c!.remede).toMatch(/Windows 11|remplacer/i);
  });

  it("mais pas avant la fin du support", () => {
    // La meme machine, examinee avant le 14 octobre 2025, va bien.
    const avant = new Date("2025-06-01T12:00:00Z");
    const d = analyserPoste({ ...posteSain(), os: { nom: "Windows 10 Pro" }, derniereMaj: null }, avant);
    expect(d.constats.map((c) => c.code)).not.toContain("os_hors_support");
  });

  it("un antivirus eteint, et pas seulement absent", () => {
    const d = analyserPoste(
      { ...posteSain(), antivirus: { nom: "Microsoft Defender", actif: false, signaturesAJour: true } },
      MAINTENANT,
    );
    expect(d.constats.find((c) => c.code === "antivirus_inactif")?.gravite).toBe("critique");
  });

  it("un disque presque plein avant qu'il ne soit plein", () => {
    const presque = analyserPoste({ ...posteSain(), disques: [{ lettre: "C:", totalGo: 500, libreGo: 45 }] }, MAINTENANT);
    expect(presque.constats.map((c) => c.code)).toContain("disque_presque_plein");

    const plein = analyserPoste({ ...posteSain(), disques: [{ lettre: "C:", totalGo: 500, libreGo: 10 }] }, MAINTENANT);
    const c = plein.constats.find((x) => x.code === "disque_plein");
    expect(c?.gravite).toBe("elevee");
  });

  it("une sauvegarde configuree mais arretee", () => {
    // Le cas le plus trompeur: la sauvegarde EXISTE, donc on se croit protege.
    const d = analyserPoste(
      { ...posteSain(), sauvegarde: { configuree: true, derniereLe: ilYA(40) } },
      MAINTENANT,
    );
    const c = d.constats.find((x) => x.code === "sauvegarde_ancienne");
    expect(c).toBeDefined();
    expect(c!.pourquoi).toMatch(/pire/i);
  });

  it("un disque non chiffre, en disant ce que cela coute", () => {
    const d = analyserPoste({ ...posteSain(), chiffrementDisque: { actif: false } }, MAINTENANT);
    const c = d.constats.find((x) => x.code === "disque_non_chiffre");
    expect(c).toBeDefined();
    // Un vol de portable non chiffre est une violation de donnees a notifier.
    expect(c!.pourquoi).toMatch(/CNIL|72 heures/i);
  });

  it("un poste qui n'a pas redemarre depuis des semaines", () => {
    const d = analyserPoste({ ...posteSain(), dernierDemarrage: ilYA(60) }, MAINTENANT);
    expect(d.constats.map((c) => c.code)).toContain("jamais_redemarre");
  });
});

describe("ce qui n'a pas pu etre mesure", () => {
  it("se dit, au lieu de passer pour une bonne nouvelle", () => {
    // Un script lance sans droits administrateur ne voit pas BitLocker.
    const d = analyserPoste(
      { ...posteSain(), chiffrementDisque: null, sauvegarde: null, antivirus: null },
      MAINTENANT,
    );
    expect(d.nonMesure).toContain("le chiffrement du disque");
    expect(d.nonMesure).toContain("la sauvegarde");
    expect(d.nonMesure).toContain("l'antivirus");
    // Et surtout: aucune de ces absences ne produit un constat rassurant.
    expect(d.constats.map((c) => c.code)).not.toContain("disque_non_chiffre");
    expect(d.constats.map((c) => c.code)).not.toContain("aucune_sauvegarde");
  });

  it("distingue « absent » de « non mesure »", () => {
    // `configuree: false` est une mesure: la sauvegarde est absente.
    const absente = analyserPoste({ ...posteSain(), sauvegarde: { configuree: false } }, MAINTENANT);
    expect(absente.constats.find((c) => c.code === "aucune_sauvegarde")?.gravite).toBe("critique");
    expect(absente.nonMesure).not.toContain("la sauvegarde");
  });

  it("supporte un rapport vide sans rien inventer", () => {
    const d = analyserPoste({}, MAINTENANT);
    expect(d.constats).toEqual([]);
    expect(d.nonMesure.length).toBeGreaterThan(4);
    // Le score reste a 100: on n'a rien constate, donc on ne reproche rien.
    // C'est `nonMesure` qui porte l'incertitude, pas une note baissee au hasard.
    expect(d.score).toBe(100);
  });
});

describe("mise en forme du resultat", () => {
  it("classe par urgence, pas par ordre de collecte", () => {
    const d = analyserPoste(
      {
        ...posteSain(),
        memoireGo: 4, // moyenne
        antivirus: { nom: "Defender", actif: false, signaturesAJour: true }, // critique
        parefeu: { actif: false }, // elevee
      },
      MAINTENANT,
    );
    expect(d.constats.map((c) => c.gravite)).toEqual(["critique", "elevee", "moyenne"]);
  });

  it("fait baisser la note a mesure que les defauts s'accumulent", () => {
    const unSeul = analyserPoste({ ...posteSain(), parefeu: { actif: false } }, MAINTENANT);
    const plusieurs = analyserPoste(
      {
        ...posteSain(),
        parefeu: { actif: false },
        antivirus: { nom: "Defender", actif: false, signaturesAJour: true },
        sauvegarde: { configuree: false },
      },
      MAINTENANT,
    );
    expect(plusieurs.score).toBeLessThan(unSeul.score);
    expect(plusieurs.score).toBeGreaterThanOrEqual(0);
  });

  it("chaque constat porte un code, une raison et un geste", () => {
    // Un constat sans remede laisse l'utilisateur avec un probleme de plus.
    const d = analyserPoste(
      { ...posteSain(), os: { nom: "Windows 10" }, antivirus: { actif: false }, sauvegarde: { configuree: false } },
      MAINTENANT,
    );
    expect(d.constats.length).toBeGreaterThan(0);
    for (const c of d.constats) {
      expect(c.code, "code manquant").toBeTruthy();
      expect(c.constat.length, `constat trop court pour ${c.code}`).toBeGreaterThan(15);
      expect(c.pourquoi.length, `raison trop courte pour ${c.code}`).toBeGreaterThan(30);
      expect(c.remede.length, `remede trop court pour ${c.code}`).toBeGreaterThan(10);
    }
  });
});
