/**
 * Securite des actions (lot du 29/09) :
 *  - Voice Live applique les regles de l'HTTP (role, licence, quota) ;
 *  - un compte en lecture seule n'y recoit que la lecture et n'approuve rien ;
 *  - sa consommation est enregistree, une ligne par tour ;
 *  - seule la file commune ecrit une proposition ;
 *  - le resume d'appel ne part qu'aux comptes actifs ;
 *  - les valeurs venues de tiers sont echappees dans les e-mails HTML.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { admettreVoiceLive, CompteurConsommation, declarationsPourRole, peutEcrire } from "../services/admission-voice-live";
import { AiQuotaExceededError } from "../services/ai-quota";
import { getAllTools } from "../services/assistant-tools";
import { interpolateHtml } from "../services/automation-engine";

const SRC = path.join(import.meta.dirname, "..");
const lire = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const licenceOk = async () => ({ allowed: true });
const quotaOk = async () => {};

describe("admission Voice Live", () => {
  it("un role inconnu est refuse", async () => {
    expect(await admettreVoiceLive({ organisationId: 1, userRole: "pirate" }, { checkLicense: licenceOk, assertAiQuota: quotaOk }))
      .toEqual({ ok: false, statut: 403, raison: "role" });
  });
  it("sans role : refuse", async () => {
    expect((await admettreVoiceLive({ organisationId: 1 }, { checkLicense: licenceOk, assertAiQuota: quotaOk })).ok).toBe(false);
  });
  it("licence refusee (abonnement suspendu) : 403 avec la raison", async () => {
    const r = await admettreVoiceLive({ organisationId: 1, userRole: "agent" }, {
      checkLicense: async () => ({ allowed: false, reason: "suspended" }), assertAiQuota: quotaOk,
    });
    expect(r).toEqual({ ok: false, statut: 403, raison: "suspended" });
  });
  it("la licence est verifiee comme une ECRITURE", async () => {
    const vu: string[] = [];
    await admettreVoiceLive({ organisationId: 7, userRole: "agent" }, {
      checkLicense: async (_o, methode, chemin) => { vu.push(`${methode} ${chemin}`); return { allowed: true }; }, assertAiQuota: quotaOk,
    });
    expect(vu).toEqual(["POST /api/voice/live"]);
  });
  it("verification de licence en panne : 503, pas d'ouverture par defaut", async () => {
    const r = await admettreVoiceLive({ organisationId: 1, userRole: "agent" }, {
      checkLicense: async () => { throw new Error("db"); }, assertAiQuota: quotaOk,
    });
    expect(r).toEqual({ ok: false, statut: 503, raison: "licence_indisponible" });
  });
  it("quota IA depasse : 429", async () => {
    const r = await admettreVoiceLive({ organisationId: 1, userRole: "administrateur" }, {
      checkLicense: licenceOk, assertAiQuota: async () => { throw new AiQuotaExceededError("cost", 10, 10); },
    });
    expect(r).toEqual({ ok: false, statut: 429, raison: "quota_ia" });
  });
  it("le super-admin ne passe pas par la licence d'une organisation", async () => {
    const licence = vi.fn(licenceOk);
    const r = await admettreVoiceLive({ organisationId: 1, userRole: "super_admin" }, { checkLicense: licence, assertAiQuota: quotaOk });
    expect(r.ok).toBe(true);
    expect(licence).not.toHaveBeenCalled();
  });
  it("un compte en lecture seule peut ouvrir la session (ecouter, lire)", async () => {
    expect((await admettreVoiceLive({ organisationId: 1, userRole: "lecture_seule" }, { checkLicense: licenceOk, assertAiQuota: quotaOk })).ok).toBe(true);
  });
});

describe("les outils selon le role", () => {
  const ecritures = getAllTools().filter((t) => t.requiresConfirmation).map((t) => t.name);
  it("lecture seule : aucun outil d'ecriture propose au modele, tous ceux de lecture", () => {
    const noms = declarationsPourRole("lecture_seule").map((d) => d.name);
    for (const e of ecritures) expect(noms).not.toContain(e);
    // Premier jet : `requiresConfirmation === false` ne gardait RIEN — la
    // propriete est absente sur les outils de lecture.
    expect(noms).toHaveLength(getAllTools().length - ecritures.length);
    expect(noms).toContain("list_contacts");
  });
  it("lecture seule : send_email et delete_call en particulier", () => {
    const noms = declarationsPourRole("lecture_seule").map((d) => d.name);
    expect(noms).not.toContain("send_email");
    expect(noms).not.toContain("delete_call");
  });
  it("agent : tous les outils", () => {
    expect(declarationsPourRole("agent")).toHaveLength(getAllTools().length);
  });
  it("peutEcrire suit le plancher HTTP", () => {
    expect([peutEcrire("lecture_seule"), peutEcrire("agent"), peutEcrire("administrateur"), peutEcrire("super_admin"), peutEcrire(undefined)])
      .toEqual([false, true, true, true, false]);
  });
});

describe("consommation Voice Live", () => {
  it("plusieurs relevés dans un tour : une seule ligne, la derniere", () => {
    const lignes: number[][] = [];
    const c = new CompteurConsommation((e, s) => lignes.push([e, s]));
    c.vu({ promptTokenCount: 100, responseTokenCount: 5 });
    c.vu({ promptTokenCount: 100, responseTokenCount: 40 });
    c.finDeTour();
    expect(lignes).toEqual([[100, 40]]);
  });
  it("une fin de tour sans releve n'inscrit rien, deux fins n'inscrivent qu'une fois", () => {
    const lignes: number[][] = [];
    const c = new CompteurConsommation((e, s) => lignes.push([e, s]));
    c.finDeTour();
    c.vu({ totalTokenCount: 50, promptTokenCount: 30 });
    c.finDeTour();
    c.finDeTour();
    expect(lignes).toEqual([[30, 20]]);
  });
});

describe("Voice Live est branche sur ces regles", () => {
  const src = lire("routes/voice-live.ts");
  it("l'admission precede l'ouverture de la WebSocket", () => {
    const admission = src.indexOf("await admettreVoiceLive(");
    expect(admission).toBeGreaterThan(-1);
    expect(admission).toBeLessThan(src.indexOf("wss.handleUpgrade("));
  });
  it("les outils proposes dependent du role", () => {
    expect(src).toContain("declarationsPourRole(role)");
    expect(src).not.toMatch(/getGeminiToolDeclarations\(\)\.functionDeclarations/);
  });
  it("l'approbation verifie le role avant d'executer", () => {
    const bloc = src.slice(src.indexOf('frame.type === "confirm_tool"'));
    expect(bloc.indexOf("peutEcrire(role)")).toBeGreaterThan(-1);
    expect(bloc.indexOf("peutEcrire(role)")).toBeLessThan(bloc.indexOf("skipConfirmation: true"));
  });
  it("la consommation est enregistree", () => {
    expect(src).toMatch(/recordAiUsage\(\{[\s\S]{0,200}route: "\/voice\/live"/);
  });
});

describe("une seule porte pour les propositions", () => {
  it("seule la file commune insere dans agent_proposals", () => {
    const fautifs: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") parcourir(f); continue; }
        if (!f.endsWith(".ts") || f.endsWith("proposal-queue.ts")) continue;
        if (/insert\(agentProposalsTable\)/.test(fs.readFileSync(f, "utf8"))) fautifs.push(path.relative(SRC, f));
      }
    };
    parcourir(SRC);
    expect(fautifs, "insertion directe : ni validation des arguments, ni alerte a l'approbateur").toEqual([]);
  });
  it("la boite support passe par enqueueProposal", () => {
    expect(lire("services/support-inbox.ts")).toMatch(/await enqueueProposal\(\{/);
  });
});

describe("destinataires et echappement", () => {
  it("le resume d'appel ne vise que les comptes actifs", () => {
    const src = lire("routes/voice-receptionist.ts");
    const bloc = src.slice(src.indexOf("async function sendCallRecapEmail"), src.indexOf("async function sendCallRecapEmail") + 1500);
    expect(bloc).toMatch(/eq\(usersTable\.actif, true\)/);
  });
  it("interpolateHtml echappe les valeurs, garde le modele", () => {
    expect(interpolateHtml("<b>Bonjour {{nom}}</b>", { nom: "<img src=x onerror=alert(1)>" }))
      .toBe("<b>Bonjour &lt;img src=x onerror=alert(1)&gt;</b>");
  });
  it.each(["services/appointment-offers.ts", "services/appointment-reminder-cron.ts"])("%s : motif, nom et organisation echappes dans le HTML", (f) => {
    const src = lire(f);
    for (const ligne of src.split("\n").filter((l) => /<(p|strong|div)[ >]/.test(l))) {
      expect(ligne, ligne.trim()).not.toMatch(/\$\{(offer\.reason|greeting|orgName)\}/);
    }
  });
});
