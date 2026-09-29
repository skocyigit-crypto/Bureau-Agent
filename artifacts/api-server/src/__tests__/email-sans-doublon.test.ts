/**
 * Un e-mail peut-etre parti n'est pas renvoye par un autre fournisseur.
 *
 * La chaine (cle de l'organisation -> cle plateforme -> SMTP) passait au
 * suivant sur N'IMPORTE QUEL echec — y compris une coupure reseau ou un delai
 * depasse, ou Resend a pu accepter le message. Le destinataire recevait alors
 * deux ou trois exemplaires. Et `send_email` rendait l'echec du fournisseur
 * sans lever : l'outil etait « ok », la proposition « executee », la relance
 * consignee comme envoyee.
 *
 * On simule les fournisseurs ; la chaine, elle, est la vraie.
 */
process.env.RESEND_API_KEY = "cle-plateforme";
process.env.RESEND_FROM_EMAIL = "Ajant Bureau <noreply@agentdebureau.fr>";
process.env.SMTP_HOST = "smtp.test";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Reponse = { data?: { id: string }; error?: { name: string; message: string; statusCode?: number } };
const f = vi.hoisted(() => ({
  org: [] as Array<() => Promise<Reponse>>,
  plateforme: [] as Array<() => Promise<Reponse>>,
  appels: { org: 0, plateforme: 0, smtp: 0 },
}));

vi.mock("resend", () => ({
  Resend: class {
    emails: { send: () => Promise<Reponse> };
    constructor(cle: string) {
      const file = cle === "cle-org" ? "org" : "plateforme";
      this.emails = {
        send: async () => {
          f.appels[file]++;
          const suivant = f[file].shift();
          if (!suivant) throw new Error(`[test] aucune reponse ${file} en file`);
          return suivant();
        },
      };
    }
  },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async () => { f.appels.smtp++; return { messageId: "smtp-1" }; } }) },
}));
vi.mock("../services/email-providers", () => ({
  getOrgEmailSender: async (orgId: number) => (orgId === 1 ? { apiKey: "cle-org", fromEmail: "facturation@client-exemple.fr" } : null),
}));

const { sendEmail, refusSansEnvoi, MESSAGE_ENVOI_INCERTAIN } = await import("../services/email");

const ok = async (): Promise<Reponse> => ({ data: { id: "re_1" } });
const refus = (name: string, statusCode: number, message = name) => async (): Promise<Reponse> => ({ error: { name, message, statusCode } });
const reseau = async (): Promise<Reponse> => ({ error: { name: "application_error", message: "Unable to fetch data. The request could not be resolved." } });

beforeEach(() => {
  f.org.length = 0; f.plateforme.length = 0;
  f.appels.org = 0; f.appels.plateforme = 0; f.appels.smtp = 0;
});

describe("refusSansEnvoi : ce qui garantit que rien n'est parti", () => {
  it.each([
    [{ statusCode: 422, name: "validation_error" }, true],
    [{ statusCode: 401, name: "invalid_api_key" }, true],
    [{ statusCode: 429, name: "rate_limit_exceeded" }, true],
    [{ name: "invalid_from_address" }, true],
    [{ statusCode: 500, name: "internal_server_error" }, false],
    [{ name: "application_error" }, false],
    [undefined, false],
  ])("%j -> %s", (e, attendu) => expect(refusSansEnvoi(e)).toBe(attendu));
});

describe("la chaine ne double pas un envoi incertain", () => {
  it("coupure reseau sur la cle de l'organisation : pas de repli plateforme", async () => {
    f.org.push(reseau);
    const r = await sendEmail("client@exemple-client.fr", "Relance", "<p>x</p>", "x", { orgId: 1 });
    expect(r.success).toBe(false);
    expect(r.error).toContain(MESSAGE_ENVOI_INCERTAIN);
    expect(f.appels).toEqual({ org: 1, plateforme: 0, smtp: 0 });
  });

  it("cle de l'organisation refusee (401) : le repli plateforme reste permis", async () => {
    f.org.push(refus("invalid_api_key", 401));
    f.plateforme.push(ok);
    const r = await sendEmail("client@exemple-client.fr", "Relance", "<p>x</p>", "x", { orgId: 1 });
    expect(r.success).toBe(true);
    expect(f.appels).toEqual({ org: 1, plateforme: 1, smtp: 0 });
  });

  it("erreur 500 de la plateforme : pas de repli SMTP", async () => {
    f.plateforme.push(refus("internal_server_error", 500));
    const r = await sendEmail("client@exemple-client.fr", "Sujet", "<p>x</p>", "x");
    expect(r.success).toBe(false);
    expect(r.error).toContain("Envoi incertain");
    expect(f.appels.smtp).toBe(0);
  });

  it("exception pendant l'appel plateforme : pas de repli SMTP", async () => {
    f.plateforme.push(async () => { throw new Error("socket hang up"); });
    const r = await sendEmail("client@exemple-client.fr", "Sujet", "<p>x</p>", "x");
    expect(r.success).toBe(false);
    expect(f.appels.smtp).toBe(0);
  });

  it("refus certain de la plateforme (422) : SMTP prend le relais", async () => {
    f.plateforme.push(refus("validation_error", 422));
    const r = await sendEmail("client@exemple-client.fr", "Sujet", "<p>x</p>", "x");
    expect(r.success).toBe(true);
    expect(f.appels).toEqual({ org: 0, plateforme: 1, smtp: 1 });
  });

  it("domaine non verifie : le second essai depuis onboarding@resend.dev reste en place", async () => {
    // Message reel de Resend pour un domaine non verifie.
    f.plateforme.push(refus("validation_error", 403, "The agentdebureau.fr domain is not verified. Please, add and verify your domain."), ok);
    const r = await sendEmail("client@exemple-client.fr", "Sujet", "<p>x</p>", "x");
    expect(r.success).toBe(true);
    expect(f.appels.plateforme).toBe(2);
  });
});

describe("l'outil send_email dit l'echec", () => {
  it("un envoi qui echoue n'est pas un outil « ok »", async () => {
    const { executeTool } = await import("../services/assistant-tools");
    f.plateforme.push(refus("internal_server_error", 500));
    const r = await executeTool("send_email", { to: "client@exemple-client.fr", subject: "Relance", body: "Bonjour" }, { orgId: 2, userId: 1 }, { skipConfirmation: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Envoi incertain");
  });
  it("un envoi reussi reste « ok »", async () => {
    const { executeTool } = await import("../services/assistant-tools");
    f.plateforme.push(ok);
    const r = await executeTool("send_email", { to: "client@exemple-client.fr", subject: "Relance", body: "Bonjour" }, { orgId: 2, userId: 1 }, { skipConfirmation: true });
    expect(r.ok).toBe(true);
  });
});
