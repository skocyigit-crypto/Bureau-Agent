import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { dependenciesAgent } from "../services/health-agents-external";

/**
 * Une cle Resend restreinte a l'envoi ne doit pas etre rapportee en panne.
 *
 * Le service ne fait qu'envoyer des e-mails. Lui confier une cle a acces
 * complet lui donnerait de quoi creer et supprimer des cles et des domaines
 * sans aucun besoin, alors que la sonde de sante, elle, interroge /domains —
 * la seule route que la portee « envoi » interdit.
 *
 * Resend distingue les deux cas sans ambiguite, ce qui permet de garder la
 * cle etroite SANS perdre la detection d'une cle revoquee:
 *
 *   - cle valide, portee insuffisante -> 401 `restricted_api_key`
 *   - cle revoquee ou erronee         -> 400 `validation_error`
 *
 * Le premier prouve que Resend a AUTHENTIFIE la cle avant d'en refuser la
 * portee. Le rapporter en « echec / critique » declencherait une alerte par
 * e-mail a chaque cycle de sante, pour un service qui envoie parfaitement —
 * exactement le bruit qui finit par faire ignorer les vraies pannes.
 */

const ENV_KEYS = [
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "GEMINI_API_KEY", "GOOGLE_API_KEY",
  "TWILIO_ACCOUNT_SID", "STRIPE_SECRET_KEY",
];

let saved: Record<string, string | undefined>;

/** Ne repond qu'a Resend; toute autre dependance reste non configuree. */
function stubResend(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    if (!String(url).includes("api.resend.com")) throw new Error("hors perimetre");
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as unknown as Response;
  }));
}

async function resendCheck() {
  const results = await dependenciesAgent.run();
  const check = results.find((r) => r.check === "resend");
  expect(check, "la sonde resend n'a pas ete executee").toBeDefined();
  return check!;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Ajant Bureau <noreply@agentdebureau.fr>";
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe("cle Resend restreinte a l'envoi", () => {
  it("n'est pas rapportee comme une panne", async () => {
    stubResend(401, { statusCode: 401, message: "This API key is restricted to only send emails", name: "restricted_api_key" });
    const check = await resendCheck();

    expect(check.status).toBe("ok");
    expect(check.severity).toBe("basse");
    expect(check.summary).not.toMatch(/refus/i);
  });

  it("annonce la verification qu'elle empeche au lieu de la passer sous silence", async () => {
    // La perte de couverture doit rester visible: sans cela, un domaine
    // expediteur devenu invalide ne serait plus detecte par personne.
    stubResend(401, { name: "restricted_api_key" });
    const check = await resendCheck();

    expect(check.summary).toMatch(/domaine expediteur n'a pas pu etre verifie/i);
    expect(check.remediation).toMatch(/acces complet/i);
  });
});

describe("cle Resend refusee", () => {
  it("reste une panne critique", async () => {
    // Le cas que la sonde existe pour attraper: les e-mails partiraient en
    // succes apparent alors que Resend les refuse.
    stubResend(400, { statusCode: 400, message: "API key is invalid", name: "validation_error" });
    const check = await resendCheck();

    expect(check.status).toBe("echec");
    expect(check.severity).toBe("critique");
    expect(check.metrics?.httpStatus).toBe(400);
  });

  it("ne se laisse pas desarmer par un 401 sans le marqueur de portee", async () => {
    // Un 401 ordinaire (cle revoquee) ne porte pas `restricted_api_key`: il
    // ne doit pas beneficier de la tolerance ci-dessus.
    stubResend(401, { statusCode: 401, message: "Unauthorized", name: "validation_error" });
    const check = await resendCheck();

    expect(check.status).toBe("echec");
  });
});

describe("domaine expediteur non verifie", () => {
  it("reste signale quand la cle permet de le lire", async () => {
    stubResend(200, { data: [{ name: "agentdebureau.fr", status: "pending" }] });
    const check = await resendCheck();

    expect(check.status).toBe("degrade");
    expect(check.summary).toMatch(/pending/);
  });

  it("passe en ok quand le domaine est verifie", async () => {
    stubResend(200, { data: [{ name: "agentdebureau.fr", status: "verified" }] });
    const check = await resendCheck();

    expect(check.status).toBe("ok");
  });
});
