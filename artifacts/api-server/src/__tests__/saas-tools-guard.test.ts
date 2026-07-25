/**
 * Tests de la GARDE des outils SaaS cross-organisation (services/saas-tools.ts).
 *
 * Ces outils modifient des organisations TIERS (l'org cible est un argument);
 * ils cassent donc par nature l'isolation par tenant. La securite repose sur
 * deux invariants verifies EN BASE avant toute mutation:
 *   1. l'acteur est un super-admin actif (role lu depuis users, pas la session);
 *   2. la proposition vit dans la file de l'organisation super-admin.
 * Si l'un echoue, aucune action n'est executee. Cette suite verrouille ce
 * comportement — c'est la frontiere de securite la plus sensible de la feature.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Acteur courant simule (role/actif) renvoye par le select sur users.
let currentActor: { role: string; actif: boolean } | null = { role: "super_admin", actif: true };
let superAdminOrgId: number | null = 1;
const extendTrialSpy = vi.fn(async () => ({ ok: true, detail: {} }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (currentActor ? [currentActor] : []),
        }),
      }),
    }),
  },
}));
vi.mock("@workspace/db/schema", () => ({ usersTable: { id: "id", role: "role", actif: "actif" } }));
vi.mock("../lib/super-admin-org", () => ({ getSuperAdminOrgId: async () => superAdminOrgId }));
// Chemin resolu vers le MEME fichier que l'import "./saas-admin-actions" de
// saas-tools (sinon la vraie fonction s'execute et la garde n'est pas isolee).
vi.mock("../services/saas-admin-actions", () => ({
  extendTrial: (...a: unknown[]) => extendTrialSpy(...(a as [])),
  suspendSubscription: async () => ({ ok: true }),
  reactivateSubscription: async () => ({ ok: true }),
}));

const { executeSaasTool, isSaasTool } = await import("../services/saas-tools");

const VALID_ARGS = { organisationId: 42, days: 7 };
const SUPER_ADMIN_CTX = { orgId: 1, userId: 9 };

describe("executeSaasTool — garde super-admin", () => {
  beforeEach(() => {
    currentActor = { role: "super_admin", actif: true };
    superAdminOrgId = 1;
    extendTrialSpy.mockClear();
  });

  it("les outils SaaS sont bien reconnus comme tels", () => {
    expect(isSaasTool("saas_extend_trial")).toBe(true);
    expect(isSaasTool("send_email")).toBe(false);
  });

  it("exécute pour un super-admin actif dans la file super-admin", async () => {
    const r = await executeSaasTool("saas_extend_trial", VALID_ARGS, SUPER_ADMIN_CTX);
    expect(r.ok).toBe(true);
    expect(extendTrialSpy).toHaveBeenCalledWith(42, 7, 9);
  });

  it("REFUSE si l'acteur n'est pas super-admin", async () => {
    currentActor = { role: "administrateur", actif: true };
    const r = await executeSaasTool("saas_extend_trial", VALID_ARGS, SUPER_ADMIN_CTX);
    expect(r.ok).toBe(false);
    expect(extendTrialSpy).not.toHaveBeenCalled();
  });

  it("REFUSE si l'acteur est désactivé", async () => {
    currentActor = { role: "super_admin", actif: false };
    const r = await executeSaasTool("saas_extend_trial", VALID_ARGS, SUPER_ADMIN_CTX);
    expect(r.ok).toBe(false);
    expect(extendTrialSpy).not.toHaveBeenCalled();
  });

  it("REFUSE si l'acteur est introuvable", async () => {
    currentActor = null;
    const r = await executeSaasTool("saas_extend_trial", VALID_ARGS, SUPER_ADMIN_CTX);
    expect(r.ok).toBe(false);
    expect(extendTrialSpy).not.toHaveBeenCalled();
  });

  it("REFUSE si la proposition n'est pas dans la file super-admin", async () => {
    const r = await executeSaasTool("saas_extend_trial", VALID_ARGS, { orgId: 77, userId: 9 });
    expect(r.ok).toBe(false);
    expect(extendTrialSpy).not.toHaveBeenCalled();
  });

  it("REFUSE si aucune organisation super-admin n'est configurée", async () => {
    superAdminOrgId = null;
    const r = await executeSaasTool("saas_extend_trial", VALID_ARGS, SUPER_ADMIN_CTX);
    expect(r.ok).toBe(false);
    expect(extendTrialSpy).not.toHaveBeenCalled();
  });

  it("REFUSE des arguments invalides (org manquante) même pour un super-admin", async () => {
    const r = await executeSaasTool("saas_extend_trial", { days: 7 }, SUPER_ADMIN_CTX);
    expect(r.ok).toBe(false);
    expect(extendTrialSpy).not.toHaveBeenCalled();
  });
});
