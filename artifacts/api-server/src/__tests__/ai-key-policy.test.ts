import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * A qui est facture un appel d'IA.
 *
 * Le defaut trouve le 2 septembre 2026: `ai_providers` stockait bien la cle de
 * chaque organisation (ecran, chiffrement, cache, tout etait la), mais un seul
 * fichier du serveur s'en servait. Partout ailleurs — y compris `ai-failover`,
 * par ou passe la quasi totalite des appels — le code prenait le singleton de
 * la plateforme. Un client qui collait sa cle continuait donc a depenser le
 * credit du proprietaire: la fonction « apportez votre cle » ne changeait rien
 * a la facture, et rien dans les tests ne le disait.
 *
 * Ces tests portent sur la seule question que tranche `ai-key-policy`: QUI PAIE.
 */

const presence = vi.fn();
const superAdminOrgId = vi.fn();

vi.mock("../services/ai-providers", () => ({
  getOrgAiKeyPresence: (orgId: number) => presence(orgId),
}));
vi.mock("../lib/super-admin-org", () => ({
  getSuperAdminOrgId: () => superAdminOrgId(),
  SUPER_ADMIN_ORG_SLUG: "agent-de-bureau-sas",
}));
vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveAiAccess, getAiKeyStatus, AiKeyRequiredError } = await import("../services/ai-key-policy");

const NONE = { gemini: false, openai: false, anthropic: false };

beforeEach(() => {
  presence.mockReset().mockResolvedValue(NONE);
  superAdminOrgId.mockReset().mockResolvedValue(999);
  delete process.env.AI_REQUIRE_OWN_KEY;
  delete process.env.AI_PLATFORM_KEY_ORG_IDS;
});
afterEach(() => {
  delete process.env.AI_REQUIRE_OWN_KEY;
  delete process.env.AI_PLATFORM_KEY_ORG_IDS;
});

describe("qui paie l'appel", () => {
  it("fait payer l'organisation des qu'elle a une cle — le defaut d'origine", async () => {
    presence.mockResolvedValue({ ...NONE, gemini: true });
    const access = await resolveAiAccess(42);
    expect(access.source).toBe("own");
    // C'est cette valeur, et non `orgId`, que les constructeurs de clients
    // recoivent: avant, elle valait toujours `null` en pratique.
    expect(access.payerOrgId).toBe(42);
  });

  it("suffit d'une cle chez un seul fournisseur", async () => {
    presence.mockResolvedValue({ ...NONE, anthropic: true });
    await expect(resolveAiAccess(7)).resolves.toMatchObject({ source: "own", payerOrgId: 7 });
  });

  it("laisse la plateforme payer les surfaces publiques", async () => {
    const access = await resolveAiAccess(null);
    expect(access).toMatchObject({ source: "platform", payerOrgId: null, platformReason: "public-surface" });
    expect(presence).not.toHaveBeenCalled();
  });

  it("laisse la plateforme payer l'organisation du proprietaire", async () => {
    superAdminOrgId.mockResolvedValue(5);
    await expect(resolveAiAccess(5)).resolves.toMatchObject({
      source: "platform",
      platformReason: "owner-organisation",
    });
  });

  it("laisse la plateforme payer une organisation explicitement exemptee", async () => {
    process.env.AI_REQUIRE_OWN_KEY = "true";
    process.env.AI_PLATFORM_KEY_ORG_IDS = "3, 8 ,12";
    await expect(resolveAiAccess(8)).resolves.toMatchObject({
      source: "platform",
      platformReason: "allowlisted",
    });
  });
});

describe("bascule d'application", () => {
  it("sans reglage, ne coupe personne: la migration ne doit pas eteindre l'IA des clients existants", async () => {
    const access = await resolveAiAccess(42);
    expect(access).toMatchObject({ source: "platform", payerOrgId: null, platformReason: "enforcement-off" });
  });

  it("avec AI_REQUIRE_OWN_KEY, refuse une organisation sans cle", async () => {
    process.env.AI_REQUIRE_OWN_KEY = "true";
    await expect(resolveAiAccess(42)).rejects.toBeInstanceOf(AiKeyRequiredError);
  });

  it("le refus porte de quoi guider l'utilisateur, pas un 500 opaque", async () => {
    process.env.AI_REQUIRE_OWN_KEY = "true";
    const err = await resolveAiAccess(42).catch((e) => e);
    expect(err.status).toBe(402);
    expect(err.code).toBe("ai_key_required");
    expect(err.message).toMatch(/Fournisseurs d'IA/);
  });

  it("l'exemption reste plus forte que le refus", async () => {
    process.env.AI_REQUIRE_OWN_KEY = "true";
    process.env.AI_PLATFORM_KEY_ORG_IDS = "42";
    await expect(resolveAiAccess(42)).resolves.toMatchObject({ source: "platform" });
  });

  it("une valeur autre que 'true' n'active rien", async () => {
    process.env.AI_REQUIRE_OWN_KEY = "1";
    await expect(resolveAiAccess(42)).resolves.toMatchObject({ platformReason: "enforcement-off" });
  });
});

describe("panne de lecture des cles", () => {
  it("ne transforme pas une base injoignable en « ce client n'a pas de cle »", async () => {
    process.env.AI_REQUIRE_OWN_KEY = "true";
    presence.mockRejectedValue(new Error("connection refused"));
    // Une panne d'infrastructure ne doit pas couper l'IA de tous les clients
    // d'un coup; la depense est celle de la plateforme, et elle est tracee.
    await expect(resolveAiAccess(42)).resolves.toMatchObject({ source: "platform" });
  });
});

describe("etat rendu a l'interface", () => {
  it("dit au client qu'il utilise sa propre cle, et laquelle", async () => {
    presence.mockResolvedValue({ gemini: true, openai: false, anthropic: true });
    await expect(getAiKeyStatus(42)).resolves.toEqual({
      configured: true,
      providers: ["gemini", "anthropic"],
      usesPlatformCredit: false,
      platformReason: null,
      enforced: false,
    });
  });

  it("ne jette pas quand l'organisation est refusee: l'ecran doit pouvoir l'expliquer", async () => {
    process.env.AI_REQUIRE_OWN_KEY = "true";
    await expect(getAiKeyStatus(42)).resolves.toEqual({
      configured: false,
      providers: [],
      usesPlatformCredit: false,
      platformReason: null,
      enforced: true,
    });
  });
});
