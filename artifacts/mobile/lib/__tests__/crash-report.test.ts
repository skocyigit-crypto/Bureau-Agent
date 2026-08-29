/**
 * Remontee des plantages de rendu (`lib/crash-report.ts`).
 *
 * Appele depuis l'ecran de repli d'`ErrorBoundary`, c'est-a-dire quand
 * l'application est deja en echec. Deux proprietes comptent donc plus que le
 * contenu du rapport lui-meme:
 *
 *  - ne jamais aggraver la panne: aucune exception, aucune attente reseau sur
 *    un chemin de rendu deja casse;
 *  - ne jamais marteler le serveur: une boucle de rendu en echec rappellerait
 *    cette fonction indefiniment.
 *
 * Les bornes de troncature comptent aussi: une pile React Native depasse
 * couramment plusieurs dizaines de milliers de caracteres, et un corps de
 * requete non borne sur un reseau mobile degrade transforme un plantage en
 * plantage plus une requete qui n'aboutit pas.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let posted: { url: string; body: any }[] = [];
let failNext = false;

const fetchMock = vi.fn(async (url: string, init: any) => {
  posted.push({ url, body: JSON.parse(init.body) });
  if (failNext) throw new Error("network down");
  return { ok: true, status: 200 };
});
vi.stubGlobal("fetch", fetchMock);

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "1.4.2" } },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("@/lib/api-config", () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
  MOBILE_APP_ORIGIN: "https://agentdebureau.fr",
}));

const { reportCrash } = await import("../crash-report");

/** Laisse le `void fetch(...)` non attendu se resoudre. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  posted = [];
  failNext = false;
  fetchMock.mockClear();
});

describe("contenu du rapport", () => {
  it("envoie message, pile, plateforme et version", async () => {
    reportCrash(new Error("boum"), "  at Ecran\n  at Layout");
    await flush();

    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("https://api.test/api/client-errors");
    expect(posted[0].body.message).toBe("boum");
    expect(posted[0].body.platform).toBe("ios");
    expect(posted[0].body.appVersion).toBe("1.4.2");
    expect(posted[0].body.stack).toContain("at Ecran");
  });

  it("tronque message et pile", async () => {
    const error = new Error("m".repeat(2000));
    error.stack = "s".repeat(20000);
    reportCrash(error);
    await flush();

    expect(posted[0].body.message.length).toBe(500);
    expect(posted[0].body.stack.length).toBe(4000);
  });

  it("remplace un message vide par un libelle exploitable", async () => {
    reportCrash(new Error(""));
    await flush();
    expect(posted[0].body.message).toBe("Erreur inconnue");
  });
});

describe("protection du chemin d'erreur", () => {
  it("ne leve pas quand le reseau echoue", async () => {
    failNext = true;
    // Signaler l'echec du signalement n'aiderait personne et masquerait
    // l'erreur d'origine affichee a l'utilisateur.
    expect(() => reportCrash(new Error("boum"))).not.toThrow();
    await flush();
  });

  it("ne rend pas la main au reseau: l'appel est synchrone pour l'appelant", () => {
    // Aucun await cote appelant: l'ecran de repli doit s'afficher tout de
    // suite, meme si la requete traine.
    expect(reportCrash(new Error("boum"))).toBeUndefined();
  });

  it("plafonne le nombre de rapports par session", async () => {
    // Une boucle de rendu en echec rappellerait cette fonction sans fin.
    for (let i = 0; i < 10; i += 1) reportCrash(new Error(`boucle ${i}`));
    await flush();
    expect(posted.length).toBeLessThanOrEqual(3);
  });
});
