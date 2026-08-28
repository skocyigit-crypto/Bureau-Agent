import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) =>
  readFileSync(join(import.meta.dirname, "..", path), "utf8");

describe("server-side authorization floor", () => {
  it("blocks read-only users from every tenant mutation centrally", () => {
    const auth = read("middleware/auth.ts");
    const routes = read("routes/index.ts");

    expect(auth).toContain("export function requireMutationRole");
    expect(auth).toContain('["GET", "HEAD", "OPTIONS"].includes(req.method)');
    expect(routes).toContain(
      'router.use(requireMutationRole("super_admin", "administrateur", "agent"))',
    );
    expect(routes.indexOf("router.use(requireTenant)")).toBeLessThan(
      routes.indexOf("router.use(requireMutationRole"),
    );
    expect(routes.indexOf("router.use(requireMutationRole")).toBeLessThan(
      routes.indexOf("router.use(mySubscriptionRouter)"),
    );
  });

  it("requires tenant administrators for every Stripe subscription mutation", () => {
    const stripe = read("routes/stripe.ts");
    const mutationPaths = [
      "/stripe/create-checkout-session",
      "/stripe/create-portal-session",
      "/stripe/cancel-subscription",
      "/stripe/resume-subscription",
    ];

    expect(stripe).toContain(
      'const requireTenantAdmin = requireRole("super_admin", "administrateur")',
    );
    for (const path of mutationPaths) {
      expect(stripe).toContain(`router.post("${path}", requireTenantAdmin,`);
    }
  });

  it("keeps full-authority API key management administrator-only", () => {
    const apiKeys = read("routes/api-keys.ts");
    const apiKeyAuth = read("lib/api-key-auth.ts");
    expect(apiKeys).toContain(
      'router.use("/api-keys", requireRole("super_admin", "administrateur"))',
    );
    expect(apiKeyAuth).toContain(
      'export const HASH_ONLY_KEY_SENTINEL = "enc:v1:hash-only"',
    );
    expect(apiKeys).toContain("keyEncrypted: HASH_ONLY_KEY_SENTINEL");
    expect(apiKeys).toContain('code: "api_key_reveal_removed"');
    // Invariant plus fort que « le 410 precede l'ancien code » : le chemin de
    // revelation est supprime, la route ne peut donc plus dechiffrer aucun
    // materiel de cle. Une regression qui reintroduirait un dechiffrement
    // rouvrirait la recuperation d'identifiants depuis la base.
    expect(apiKeys).not.toContain("decryptSensitiveData");
  });

  it("protects tenant-wide provider credentials with administrator roles", () => {
    const aiProviders = read("routes/ai-providers.ts");
    const emailProviders = read("routes/email-providers.ts");
    const telephony = read("routes/telephony.ts");
    const integrations = read("routes/integrations.ts");

    expect(aiProviders).toContain(
      'router.use("/ai-providers", requireRole("super_admin", "administrateur"))',
    );
    expect(emailProviders).toContain(
      'router.use("/email/providers", requireRole("super_admin", "administrateur"))',
    );
    for (const path of [
      "/telephony/providers",
      "/telephony/fraud-protection",
      "/telephony/ai-receptionist",
    ]) {
      expect(telephony).toContain(`router.use("${path}", requireTenantAdmin)`);
    }
    for (const action of ["connect", "disconnect", "test", "sync"]) {
      expect(integrations).toMatch(
        new RegExp(`router\\.post\\(\"/:integrationId/${action}\", requireTenantAdmin,`),
      );
    }
  });
});
