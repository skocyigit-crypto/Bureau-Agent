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

import { describe, expect, it, vi } from "vitest";
import {
  isModelRetiredError,
  fallbackGeminiModel,
  geminiGenerateWithFallback,
  GEMINI_PRO_MODEL,
  GEMINI_FLASH_MODEL,
  GEMINI_PRO_FALLBACK_MODEL,
  GEMINI_FLASH_FALLBACK_MODEL,
} from "../services/ai-utils";

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
