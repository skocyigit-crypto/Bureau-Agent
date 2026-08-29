/**
 * Lecture du flux SSE (`lib/sse-stream.ts`).
 *
 * Ce module transporte chaque reponse de l'IA jusqu'a l'ecran. Une regression
 * n'y provoque pas d'erreur visible: le texte s'arrete au milieu ou n'arrive
 * jamais, ce qui se lit comme "l'IA ne repond pas" et non comme un bug.
 *
 * `sse-parser` couvre deja le decoupage pur. On verifie ici ce que seule la
 * boucle de lecture peut casser: les en-tetes obligatoires, l'annulation, la
 * frontiere de paquet au milieu d'un caractere multi-octets, et le garde-fou
 * contre un flux qui ne delimite jamais ses evenements.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let fetchImpl: (url: string, init: any) => Promise<any>;

vi.mock("expo/fetch", () => ({
  fetch: (url: string, init: any) => fetchImpl(url, init),
}));

vi.mock("@/lib/api-config", () => ({
  MOBILE_APP_ORIGIN: "https://agentdebureau.fr",
}));

const { streamSse } = await import("../sse-stream");

/** Construit une reponse dont le corps rend les morceaux fournis. */
function responseOf(chunks: Uint8Array[], ok = true, status = 200) {
  let i = 0;
  return {
    ok,
    status,
    text: async () => "boom",
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { value: chunks[i++], done: false }
            : { value: undefined, done: true },
        releaseLock: () => {},
      }),
    },
  };
}

const enc = new TextEncoder();
const chunk = (s: string) => enc.encode(s);

beforeEach(() => {
  fetchImpl = async () => responseOf([]);
});

describe("requete", () => {
  it("injecte Origin et Accept, que l'appelant y pense ou non", async () => {
    let seen: any = null;
    fetchImpl = async (_url, init) => {
      seen = init;
      return responseOf([]);
    };

    await streamSse("https://api.test/x", { q: 1 }, { onEvent: () => {} });

    // Un build natif n'envoie pas d'Origin: sans cet en-tete le serveur
    // repondrait 403 et l'ecran resterait vide sans explication.
    expect(seen.headers.Origin).toBe("https://agentdebureau.fr");
    expect(seen.headers.Accept).toBe("text/event-stream");
    expect(seen.method).toBe("POST");
    expect(JSON.parse(seen.body)).toEqual({ q: 1 });
  });

  it("remonte le corps d'erreur quand la reponse n'est pas ok", async () => {
    fetchImpl = async () => responseOf([], false, 500);
    await expect(
      streamSse("https://api.test/x", {}, { onEvent: () => {} }),
    ).rejects.toThrow("boom");
  });
});

describe("evenements", () => {
  it("emet les evenements complets dans l'ordre", async () => {
    fetchImpl = async () =>
      responseOf([
        chunk('event: token\ndata: {"t":"Bon"}\n\n'),
        chunk('event: token\ndata: {"t":"jour"}\n\nevent: done\ndata: {}\n\n'),
      ]);

    const seen: [string, any][] = [];
    await streamSse("u", {}, { onEvent: (e, d) => seen.push([e, d]) });

    expect(seen).toEqual([
      ["token", { t: "Bon" }],
      ["token", { t: "jour" }],
      ["done", {}],
    ]);
  });

  it("recolle un evenement coupe par une frontiere de paquet", async () => {
    fetchImpl = async () =>
      responseOf([chunk('event: token\ndata: {"t":"par'), chunk('tage"}\n\n')]);

    const seen: any[] = [];
    await streamSse("u", {}, { onEvent: (_e, d) => seen.push(d) });
    expect(seen).toEqual([{ t: "partage" }]);
  });

  it("ne perd pas un caractere accentue coupe en deux paquets", async () => {
    // Comportement deja correct — `TextDecoder` en mode `stream` retient les
    // octets incomplets — mais non couvert jusqu'ici. Le figer compte: en
    // francais et en turc, la moindre regression de decodage abimerait le
    // texte de chaque reponse sans lever la moindre erreur.
    const payload = enc.encode('event: token\ndata: {"t":"é"}\n\n');
    const cut = payload.indexOf(0xc3) + 1; // au milieu du "é" (2 octets)
    fetchImpl = async () =>
      responseOf([payload.slice(0, cut), payload.slice(cut)]);

    const seen: any[] = [];
    await streamSse("u", {}, { onEvent: (_e, d) => seen.push(d) });
    expect(seen).toEqual([{ t: "é" }]);
  });

  it("rend le texte brut quand la charge utile n'est pas du JSON", async () => {
    fetchImpl = async () => responseOf([chunk("event: note\ndata: coucou\n\n")]);
    const seen: any[] = [];
    await streamSse("u", {}, { onEvent: (_e, d) => seen.push(d) });
    expect(seen).toEqual(["coucou"]);
  });
});

describe("robustesse", () => {
  it("s'arrete des l'annulation sans emettre la suite", async () => {
    const controller = new AbortController();
    fetchImpl = async () =>
      responseOf([
        chunk('event: a\ndata: {"n":1}\n\n'),
        chunk('event: b\ndata: {"n":2}\n\n'),
      ]);

    const seen: string[] = [];
    await streamSse("u", {}, {
      signal: controller.signal,
      onEvent: (e) => {
        seen.push(e);
        controller.abort();
      },
    });

    expect(seen).toEqual(["a"]);
  });

  it("echoue proprement sur un flux qui ne delimite jamais ses evenements", async () => {
    // Sans plafond, le tampon grossissait indefiniment: sur mobile cela se
    // termine en manque de memoire, donc en plantage de l'application.
    const wall = "x".repeat(300_000);
    fetchImpl = async () =>
      responseOf([chunk(wall), chunk(wall), chunk(wall), chunk(wall), chunk(wall)]);

    await expect(
      streamSse("u", {}, { onEvent: () => {} }),
    ).rejects.toThrow(/Flux SSE invalide/);
  });
});
