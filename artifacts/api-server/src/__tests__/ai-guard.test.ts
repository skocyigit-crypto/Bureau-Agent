import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Un refus voulu ne doit pas se presenter comme une panne.
 *
 * Les routes d'IA verifiaient deja le quota et repondaient 429 proprement, mais
 * leur `catch` final se termine par `500 / "Erreur interne"`. Le refus de cle
 * (402), leve au fond de `aiForOrg`, y serait tombe: le client aurait lu
 * « Erreur interne » au lieu de « ajoutez votre cle ». C'est ce que verifie ce
 * fichier — le contenu du refus, pas le chemin qui y mene.
 */

const assertAiQuota = vi.fn();
const resolveAiAccess = vi.fn();

class AiQuotaExceededError extends Error {
  reason: "cost" | "calls" = "cost";
  current = 12;
  limit = 10;
  constructor(msg: string) { super(msg); this.name = "AiQuotaExceededError"; }
}
class AiKeyRequiredError extends Error {
  readonly code = "ai_key_required";
  readonly status = 402;
  constructor(msg = "Aucune cle d'IA n'est configuree pour cette organisation.") {
    super(msg); this.name = "AiKeyRequiredError";
  }
}

vi.mock("../services/ai-quota", () => ({
  assertAiQuota: (...a: any[]) => assertAiQuota(...a),
  AiQuotaExceededError,
}));
vi.mock("../services/ai-key-policy", () => ({
  resolveAiAccess: (...a: any[]) => resolveAiAccess(...a),
  AiKeyRequiredError,
}));

const { assertAiUsable, respondAiError } = await import("../services/ai-guard");

function fakeRes() {
  const res: any = { code: 0, body: null };
  res.status = (c: number) => { res.code = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

beforeEach(() => {
  assertAiQuota.mockReset().mockResolvedValue(undefined);
  resolveAiAccess.mockReset().mockResolvedValue({ source: "own", payerOrgId: 1, providers: {} });
});

describe("assertAiUsable", () => {
  it("verifie le quota ET le moyen de paiement, en tete de route", async () => {
    await assertAiUsable(42);
    expect(assertAiQuota).toHaveBeenCalledWith(42);
    expect(resolveAiAccess).toHaveBeenCalledWith(42);
  });

  it("s'arrete au quota sans consulter la politique: rien a payer si rien ne part", async () => {
    assertAiQuota.mockRejectedValue(new AiQuotaExceededError("quota"));
    await expect(assertAiUsable(42)).rejects.toBeInstanceOf(AiQuotaExceededError);
    expect(resolveAiAccess).not.toHaveBeenCalled();
  });

  it("remonte le refus de cle pour que la route le traduise en 402", async () => {
    resolveAiAccess.mockRejectedValue(new AiKeyRequiredError());
    await expect(assertAiUsable(42)).rejects.toBeInstanceOf(AiKeyRequiredError);
  });
});

describe("respondAiError", () => {
  it("rend 429 et de quoi expliquer le quota", () => {
    const res = fakeRes();
    expect(respondAiError(new AiQuotaExceededError("Quota IA mensuel atteint"), res)).toBe(true);
    expect(res.code).toBe(429);
    expect(res.body).toMatchObject({ quotaExceeded: true, reason: "cost", current: 12, limit: 10 });
  });

  it("rend 402 — pas 500 — quand il manque la cle, avec le geste a faire", () => {
    const res = fakeRes();
    expect(respondAiError(new AiKeyRequiredError(), res)).toBe(true);
    expect(res.code).toBe(402);
    expect(res.body).toMatchObject({ aiKeyRequired: true, code: "ai_key_required" });
    expect(res.body.error).toMatch(/cle d'IA/);
  });

  it("ne touche pas aux vraies pannes: elles doivent rester des 500 traces", () => {
    const res = fakeRes();
    expect(respondAiError(new Error("ECONNRESET"), res)).toBe(false);
    expect(res.code).toBe(0);
    expect(res.body).toBeNull();
  });

  it("ne se laisse pas tromper par un message qui ressemble", () => {
    const res = fakeRes();
    expect(respondAiError(new Error("cle d'IA manquante"), res)).toBe(false);
  });
});
