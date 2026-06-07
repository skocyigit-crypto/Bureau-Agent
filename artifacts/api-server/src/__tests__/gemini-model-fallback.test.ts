/**
 * Tests de regression du repli automatique de modele Gemini (ai-utils).
 *
 * La logique de detection de retrait + repli (`isModelRetiredError`,
 * `fallbackGeminiModel`, `geminiGenerateWithFallback`) avait ete verifiee
 * manuellement avec un script jetable mais sans test committe. Cette suite
 * verrouille le comportement pour qu'une evolution future ne puisse pas:
 *   - elargir la regex de detection au point d'avaler des 404/erreurs
 *     transitoires sans rapport (rate-limit, 503, ECONNRESET) ;
 *   - casser le mapping pro/flash/heuristique/null du modele de repli ;
 *   - reessayer plus d'une fois, ou reessayer sur une erreur non-retrait.
 *
 * On force les constantes de modeles via variables d'environnement AVANT
 * l'import du module afin que les assertions ne dependent pas des valeurs
 * par defaut codees en dur (qui peuvent migrer).
 */
process.env.GEMINI_PRO_MODEL = "gemini-2.5-pro";
process.env.GEMINI_FLASH_MODEL = "gemini-2.5-flash";
process.env.GEMINI_PRO_FALLBACK_MODEL = "gemini-pro-latest";
process.env.GEMINI_FLASH_FALLBACK_MODEL = "gemini-flash-latest";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  isModelRetiredError,
  fallbackGeminiModel,
  geminiGenerateWithFallback,
  geminiActualModel,
  installGeminiModelFallback,
  onGeminiModelFallback,
  GEMINI_PRO_MODEL,
  GEMINI_FLASH_MODEL,
  GEMINI_PRO_FALLBACK_MODEL,
  GEMINI_FLASH_FALLBACK_MODEL,
  type GeminiFallbackEvent,
} from "../services/ai-utils";

/**
 * Etat partage controlable par test pour le client Gemini mocke.
 *
 * `installGeminiModelFallback` fait `await import("@workspace/integrations-gemini-ai")`
 * puis patche EN PLACE `ai.models.generateContent(Stream)`. Le vrai module leve a
 * l'import s'il n'y a pas de cle API ; on le remplace donc par un mock. Le patch
 * etant pose une seule fois (singleton), `origStream` capture au boot pointe sur
 * la fonction mock d'origine, qui delegue a `mockState.streamImpl`. Reaffecter
 * `mockState.streamImpl` a chaque test suffit donc a piloter le comportement du
 * flux meme apres l'installation unique du patch.
 */
const mockState = vi.hoisted(() => ({
  genImpl: async (_params: any): Promise<any> => ({}),
  streamImpl: async (_params: any): Promise<any> => (async function* () {})(),
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: (params: any) => mockState.genImpl(params),
      generateContentStream: (params: any) => mockState.streamImpl(params),
    },
  },
}));

describe("isModelRetiredError", () => {
  it("detecte les signatures de retrait/inexistence de modele", () => {
    const retired = [
      { message: "[400] UNSUPPORTED_MODEL: the model is no longer served" },
      {
        message:
          "models/gemini-2.5-pro is not found for API version v1beta, or is not supported for generateContent.",
      },
      { message: "models/gemini-1.0-pro is not found." },
      { message: "The model gemini-1.5-pro does not exist" },
      { message: "model gemini-1.0-pro is not available" },
      { message: "model gemini-1.0-pro is not supported" },
      { message: "model gemini-1.0-pro is deprecated" },
      { message: "model gemini-1.0-pro retired" },
    ];
    for (const err of retired) {
      expect(isModelRetiredError(err), err.message).toBe(true);
    }
  });

  it("detecte aussi via JSON.stringify quand il n'y a pas de .message", () => {
    expect(isModelRetiredError({ error: { status: "UNSUPPORTED_MODEL" } })).toBe(true);
    expect(isModelRetiredError("models/gemini-2.5-pro is not found for API version v1")).toBe(
      true,
    );
  });

  it("rejette les erreurs transitoires et sans rapport", () => {
    const transient = [
      { message: "429 rate limit exceeded, please retry later" },
      { message: "[503] Service Unavailable" },
      { message: "[502] Bad Gateway" },
      { message: "ECONNRESET: socket hang up" },
      { message: "ETIMEDOUT" },
      { message: "The model is overloaded. Please try again later." },
      { message: "request timeout" },
      { message: "Internal server error" },
      { message: "permission denied" },
      { message: "" },
    ];
    for (const err of transient) {
      expect(isModelRetiredError(err), err.message).toBe(false);
    }
  });

  it("ne confond pas un 404 generique sans mot-cle 'model'", () => {
    expect(isModelRetiredError({ message: "[404] Not Found" })).toBe(false);
    expect(isModelRetiredError({ message: "resource not found" })).toBe(false);
  });

  it("gere les entrees nulles/indefinies sans lever", () => {
    expect(isModelRetiredError(null)).toBe(false);
    expect(isModelRetiredError(undefined)).toBe(false);
  });
});

describe("fallbackGeminiModel", () => {
  it("mappe le modele pro par defaut vers son repli", () => {
    expect(fallbackGeminiModel(GEMINI_PRO_MODEL)).toBe(GEMINI_PRO_FALLBACK_MODEL);
  });

  it("mappe le modele flash par defaut vers son repli", () => {
    expect(fallbackGeminiModel(GEMINI_FLASH_MODEL)).toBe(GEMINI_FLASH_FALLBACK_MODEL);
  });

  it("utilise l'heuristique flash/pro pour les autres noms Gemini codes en dur", () => {
    expect(fallbackGeminiModel("gemini-1.5-flash")).toBe(GEMINI_FLASH_FALLBACK_MODEL);
    expect(fallbackGeminiModel("gemini-1.5-pro")).toBe(GEMINI_PRO_FALLBACK_MODEL);
    // Nom Gemini sans flash/pro -> repli pro par defaut.
    expect(fallbackGeminiModel("gemini-exp-1206")).toBe(GEMINI_PRO_FALLBACK_MODEL);
  });

  it("ne reboucle pas quand on passe deja un modele de repli", () => {
    expect(fallbackGeminiModel(GEMINI_PRO_FALLBACK_MODEL)).toBeNull();
    expect(fallbackGeminiModel(GEMINI_FLASH_FALLBACK_MODEL)).toBeNull();
  });

  it("renvoie null pour un modele non-Gemini ou vide", () => {
    expect(fallbackGeminiModel("gpt-4o-mini")).toBeNull();
    expect(fallbackGeminiModel("claude-sonnet-4-6")).toBeNull();
    expect(fallbackGeminiModel(null)).toBeNull();
    expect(fallbackGeminiModel(undefined)).toBeNull();
    expect(fallbackGeminiModel("")).toBeNull();
  });
});

describe("geminiGenerateWithFallback", () => {
  it("renvoie directement le resultat quand l'appel primaire reussit", async () => {
    const fn = vi.fn(async (m: string) => `ok:${m}`);
    const res = await geminiGenerateWithFallback(GEMINI_PRO_MODEL, fn);
    expect(res).toBe(`ok:${GEMINI_PRO_MODEL}`);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(GEMINI_PRO_MODEL);
  });

  it("reessaye exactement une fois avec le modele de repli sur une erreur de retrait", async () => {
    const fn = vi.fn(async (m: string) => {
      if (m === GEMINI_PRO_MODEL) {
        throw new Error("[400] UNSUPPORTED_MODEL: model retired");
      }
      return `ok:${m}`;
    });
    const res = await geminiGenerateWithFallback(GEMINI_PRO_MODEL, fn);
    expect(res).toBe(`ok:${GEMINI_PRO_FALLBACK_MODEL}`);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, GEMINI_PRO_MODEL);
    expect(fn).toHaveBeenNthCalledWith(2, GEMINI_PRO_FALLBACK_MODEL);
  });

  it("ne reessaye pas sur une erreur transitoire et propage l'erreur", async () => {
    const err = new Error("[503] Service Unavailable");
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(geminiGenerateWithFallback(GEMINI_PRO_MODEL, fn)).rejects.toThrow(
      "[503] Service Unavailable",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ne reessaye pas quand il n'existe pas de modele de repli (non-Gemini)", async () => {
    const err = new Error("UNSUPPORTED_MODEL");
    const fn = vi.fn(async () => {
      throw err;
    });
    await expect(geminiGenerateWithFallback("gpt-4o-mini", fn)).rejects.toThrow(
      "UNSUPPORTED_MODEL",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("propage l'erreur de retrait si le repli echoue aussi (pas de 2e reessai)", async () => {
    const fn = vi.fn(async (m: string) => {
      throw new Error(`UNSUPPORTED_MODEL for ${m}`);
    });
    await expect(geminiGenerateWithFallback(GEMINI_FLASH_MODEL, fn)).rejects.toThrow(
      `UNSUPPORTED_MODEL for ${GEMINI_FLASH_FALLBACK_MODEL}`,
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("utilise GEMINI_PRO_MODEL comme primaire par defaut quand model est vide", async () => {
    const fn = vi.fn(async (m: string) => `ok:${m}`);
    const res = await geminiGenerateWithFallback(null, fn);
    expect(res).toBe(`ok:${GEMINI_PRO_MODEL}`);
    expect(fn).toHaveBeenCalledWith(GEMINI_PRO_MODEL);
  });
});

/** Consomme un flux async-iterable jusqu'au bout en collectant les chunks. */
async function collect(stream: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

/** Async-iterable qui leve `err` des le 1er `.next()` (avant tout chunk emis). */
function throwOnFirstChunk(err: Error): AsyncIterable<any> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.reject(err);
        },
      };
    },
  };
}

/**
 * Verrouille le filet de securite du repli de modele cote *streaming*
 * (`installGeminiModelFallback`, branche `generateContentStream`). C'est ce qui
 * garde les reponses IA en flux quand Google retire un modele en cours de
 * reponse : tant qu'aucun chunk n'a ete emis, on rebascule de maniere
 * transparente ; une fois le flux entame, on ne tente PLUS de bascule (un
 * switch en plein milieu reenverrait des chunks incoherents au client).
 */
describe("installGeminiModelFallback (streaming)", () => {
  let models: { generateContentStream: (params: any) => Promise<AsyncIterable<any>> };

  beforeAll(async () => {
    // Pose le patch une seule fois sur le client mocke (idempotent).
    await installGeminiModelFallback();
    const mod: any = await import("@workspace/integrations-gemini-ai");
    models = mod.ai.models;
  });

  it("rebascule sur le modele de repli quand l'erreur de retrait survient AVANT tout chunk (1er chunk)", async () => {
    const streamImpl = vi.fn(async (params: any) => {
      if (params.model === GEMINI_PRO_MODEL) {
        return throwOnFirstChunk(new Error("[400] UNSUPPORTED_MODEL: model retired"));
      }
      return (async function* () {
        yield { text: "bon" };
        yield { text: "jour" };
      })();
    });
    mockState.streamImpl = streamImpl;

    const stream = await models.generateContentStream({ model: GEMINI_PRO_MODEL });
    const chunks = await collect(stream);

    // Le contenu textuel est préservé...
    expect(chunks.map((c) => ({ text: c.text }))).toEqual([{ text: "bon" }, { text: "jour" }]);
    // ...et chaque chunk de repli est étiqueté avec le modèle RÉELLEMENT utilisé
    // (attribution de coût) — c'est l'invariant que ce repli doit garantir.
    for (const c of chunks) {
      expect(geminiActualModel(c, GEMINI_PRO_MODEL)).toBe(GEMINI_PRO_FALLBACK_MODEL);
    }
    // Appel 1 = modele primaire (echoue au 1er chunk), appel 2 = repli.
    expect(streamImpl).toHaveBeenCalledTimes(2);
    expect(streamImpl).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: GEMINI_PRO_MODEL }));
    expect(streamImpl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: GEMINI_PRO_FALLBACK_MODEL }),
    );
  });

  it("rebascule aussi quand la CREATION du flux echoue sur une erreur de retrait", async () => {
    const streamImpl = vi.fn(async (params: any) => {
      if (params.model === GEMINI_FLASH_MODEL) {
        throw new Error("models/gemini-2.5-flash is not found for API version v1beta");
      }
      return (async function* () {
        yield { text: "ok-fallback" };
      })();
    });
    mockState.streamImpl = streamImpl;

    const stream = await models.generateContentStream({ model: GEMINI_FLASH_MODEL });
    const chunks = await collect(stream);

    expect(chunks.map((c) => ({ text: c.text }))).toEqual([{ text: "ok-fallback" }]);
    for (const c of chunks) {
      expect(geminiActualModel(c, GEMINI_FLASH_MODEL)).toBe(GEMINI_FLASH_FALLBACK_MODEL);
    }
    expect(streamImpl).toHaveBeenCalledTimes(2);
    expect(streamImpl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: GEMINI_FLASH_FALLBACK_MODEL }),
    );
  });

  it("n'avale PAS une erreur de retrait survenue APRES le 1er chunk (pas de switch en plein flux)", async () => {
    const streamImpl = vi.fn(async (_params: any) =>
      (async function* () {
        yield { text: "debut" };
        throw new Error("UNSUPPORTED_MODEL: retired mid-stream");
      })(),
    );
    mockState.streamImpl = streamImpl;

    const stream = await models.generateContentStream({ model: GEMINI_PRO_MODEL });
    const received: any[] = [];
    await expect(
      (async () => {
        for await (const chunk of stream) received.push(chunk);
      })(),
    ).rejects.toThrow("retired mid-stream");

    // Le 1er chunk est bien parvenu au consommateur, puis l'erreur a propage.
    expect(received).toEqual([{ text: "debut" }]);
    // Aucune tentative de repli : un seul appel (le modele primaire).
    expect(streamImpl).toHaveBeenCalledTimes(1);
  });

  it("propage telle quelle une erreur NON-retrait a la creation (pas de repli)", async () => {
    const streamImpl = vi.fn(async (_params: any) => {
      throw new Error("[503] Service Unavailable");
    });
    mockState.streamImpl = streamImpl;

    await expect(models.generateContentStream({ model: GEMINI_PRO_MODEL })).rejects.toThrow(
      "[503] Service Unavailable",
    );
    expect(streamImpl).toHaveBeenCalledTimes(1);
  });

  it("propage telle quelle une erreur NON-retrait au 1er chunk (pas de repli)", async () => {
    const streamImpl = vi.fn(async (_params: any) =>
      throwOnFirstChunk(new Error("ECONNRESET: socket hang up")),
    );
    mockState.streamImpl = streamImpl;

    const stream = await models.generateContentStream({ model: GEMINI_PRO_MODEL });
    await expect(collect(stream)).rejects.toThrow("ECONNRESET");
    expect(streamImpl).toHaveBeenCalledTimes(1);
  });

  it("n'installe le patch qu'une seule fois (idempotent)", async () => {
    const mod: any = await import("@workspace/integrations-gemini-ai");
    const beforeStream = mod.ai.models.generateContentStream;
    const beforeGen = mod.ai.models.generateContent;

    await installGeminiModelFallback();

    // Un 2e appel ne doit pas re-wrapper : les references restent identiques.
    expect(mod.ai.models.generateContentStream).toBe(beforeStream);
    expect(mod.ai.models.generateContent).toBe(beforeGen);
  });
});

/**
 * Verrouille le CABLAGE de l'observateur d'alerte admin
 * (`onGeminiModelFallback` -> `notifyGeminiFallback`). Quand Google retire un
 * modele et que l'app bascule en transparence sur le repli, cet observateur est
 * le seul signal qui previent un operateur qu'un modele doit etre migre. Les
 * tests precedents verifient que le *repli* a lieu mais jamais que l'observateur
 * est *notifie* (avec le bon from/to/kind), ni qu'un observateur defaillant ne
 * peut pas casser la generation. On verrouille donc:
 *   - une notification unique {from,to,kind:"generate"} sur un repli de generation ;
 *   - une notification {kind:"stream"} sur un repli de flux (creation ET 1er chunk) ;
 *   - aucun impact d'un observateur qui leve (generation/flux normaux) ;
 *   - `onGeminiModelFallback(null)` retire bien l'observateur (silence total).
 */
describe("onGeminiModelFallback (observateur d'alerte admin)", () => {
  let models: { generateContentStream: (params: any) => Promise<AsyncIterable<any>> };

  beforeAll(async () => {
    // Le patch streaming est pose au boot (idempotent) ; on recupere le client mocke.
    await installGeminiModelFallback();
    const mod: any = await import("@workspace/integrations-gemini-ai");
    models = mod.ai.models;
  });

  afterEach(() => {
    // L'observateur est un singleton de module : toujours le retirer pour ne pas
    // fuiter d'un test a l'autre (un test suivant verrait des evenements parasites).
    onGeminiModelFallback(null);
  });

  it("notifie l'observateur exactement une fois avec {from,to,kind:'generate'} sur un repli de generation", async () => {
    const events: GeminiFallbackEvent[] = [];
    onGeminiModelFallback((e) => events.push(e));

    const fn = vi.fn(async (m: string) => {
      if (m === GEMINI_PRO_MODEL) throw new Error("[400] UNSUPPORTED_MODEL: model retired");
      return `ok:${m}`;
    });
    const res = await geminiGenerateWithFallback(GEMINI_PRO_MODEL, fn);

    expect(res).toBe(`ok:${GEMINI_PRO_FALLBACK_MODEL}`);
    expect(events).toEqual([
      { from: GEMINI_PRO_MODEL, to: GEMINI_PRO_FALLBACK_MODEL, kind: "generate" },
    ]);
  });

  it("ne notifie PAS l'observateur quand la generation primaire reussit", async () => {
    const events: GeminiFallbackEvent[] = [];
    onGeminiModelFallback((e) => events.push(e));

    await geminiGenerateWithFallback(GEMINI_PRO_MODEL, async (m) => `ok:${m}`);

    expect(events).toEqual([]);
  });

  it("notifie {from,to,kind:'stream'} quand la CREATION du flux bascule sur le repli", async () => {
    const events: GeminiFallbackEvent[] = [];
    onGeminiModelFallback((e) => events.push(e));

    mockState.streamImpl = vi.fn(async (params: any) => {
      if (params.model === GEMINI_FLASH_MODEL) {
        throw new Error("models/gemini-2.5-flash is not found for API version v1beta");
      }
      return (async function* () {
        yield { text: "ok-fallback" };
      })();
    });

    const stream = await models.generateContentStream({ model: GEMINI_FLASH_MODEL });
    await collect(stream);

    expect(events).toEqual([
      { from: GEMINI_FLASH_MODEL, to: GEMINI_FLASH_FALLBACK_MODEL, kind: "stream" },
    ]);
  });

  it("notifie {from,to,kind:'stream'} quand l'erreur de retrait survient au 1er chunk", async () => {
    const events: GeminiFallbackEvent[] = [];
    onGeminiModelFallback((e) => events.push(e));

    mockState.streamImpl = vi.fn(async (params: any) => {
      if (params.model === GEMINI_PRO_MODEL) {
        return throwOnFirstChunk(new Error("[400] UNSUPPORTED_MODEL: model retired"));
      }
      return (async function* () {
        yield { text: "bonjour" };
      })();
    });

    const stream = await models.generateContentStream({ model: GEMINI_PRO_MODEL });
    await collect(stream);

    expect(events).toEqual([
      { from: GEMINI_PRO_MODEL, to: GEMINI_PRO_FALLBACK_MODEL, kind: "stream" },
    ]);
  });

  it("un observateur qui leve ne casse jamais la generation (le repli aboutit)", async () => {
    onGeminiModelFallback(() => {
      throw new Error("observer defaillant");
    });

    const fn = vi.fn(async (m: string) => {
      if (m === GEMINI_PRO_MODEL) throw new Error("UNSUPPORTED_MODEL: model retired");
      return `ok:${m}`;
    });
    const res = await geminiGenerateWithFallback(GEMINI_PRO_MODEL, fn);

    expect(res).toBe(`ok:${GEMINI_PRO_FALLBACK_MODEL}`);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("un observateur qui leve ne casse jamais le streaming (le flux de repli aboutit)", async () => {
    onGeminiModelFallback(() => {
      throw new Error("observer defaillant");
    });

    mockState.streamImpl = vi.fn(async (params: any) => {
      if (params.model === GEMINI_FLASH_MODEL) {
        throw new Error("models/gemini-2.5-flash is not found for API version v1beta");
      }
      return (async function* () {
        yield { text: "ok-fallback" };
      })();
    });

    const stream = await models.generateContentStream({ model: GEMINI_FLASH_MODEL });
    const chunks = await collect(stream);

    expect(chunks.map((c) => c.text)).toEqual(["ok-fallback"]);
  });

  it("onGeminiModelFallback(null) retire l'observateur (plus aucune notification)", async () => {
    const events: GeminiFallbackEvent[] = [];
    onGeminiModelFallback((e) => events.push(e));
    onGeminiModelFallback(null);

    const fn = vi.fn(async (m: string) => {
      if (m === GEMINI_PRO_MODEL) throw new Error("UNSUPPORTED_MODEL: model retired");
      return `ok:${m}`;
    });
    const res = await geminiGenerateWithFallback(GEMINI_PRO_MODEL, fn);

    // Le repli a bien eu lieu (la generation aboutit), mais sans aucune alerte.
    expect(res).toBe(`ok:${GEMINI_PRO_FALLBACK_MODEL}`);
    expect(events).toEqual([]);
  });
});
