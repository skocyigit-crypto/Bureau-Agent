/**
 * L'evaluation de salaries n'envoie aucune identite au fournisseur d'IA.
 *
 * Le kit de conformite remis aux employeurs affirme : « Les identites des
 * salaries sont pseudonymisees avant tout envoi a un fournisseur d'IA. » Le
 * 21/09/2026, c'etait vrai pour UNE des quatre surfaces d'evaluation
 * (`services/performance-analyzer.ts`). Les trois autres envoyaient prenom et
 * nom en clair :
 *
 *  - `workforce-agent` (quatre appels successifs, et le prenom du responsable) ;
 *  - `workforce-intelligence` ;
 *  - `commandant/employee-quality` (plusieurs fournisseurs).
 *
 * Un document de conformite faux est pire qu'un document absent : l'employeur
 * s'y fie pour informer ses salaries et remplir son AIPD.
 *
 * Ces tests appellent les VRAIES routes sur une vraie base, interceptent ce
 * qui part vers le modele, et verifient deux choses : aucun nom n'y figure, et
 * la reponse rendue au responsable porte bien les vrais noms.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Tout ce qui part vers un modele, dans l'ordre. */
const envoyes: string[] = [];
/** Reponse que le faux modele rend, selon ce qu'on lui demande. */
let reponse: (prompt: string) => string = () => "{}";

vi.mock("../services/ai-client", () => ({
  aiForOrg: async () => ({
    models: {
      generateContent: async (req: { contents: unknown }) => {
        const texte = JSON.stringify(req.contents);
        envoyes.push(texte);
        return { text: reponse(texte), usageMetadata: {} };
      },
    },
  }),
}));
vi.mock("../services/ai-quota", () => ({
  assertAiQuota: async () => {},
  invalidateQuotaCache: () => {},
  AiQuotaExceededError: class extends Error {},
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import workforceAgent from "../routes/workforce-agent";
import workforceIntelligence from "../routes/workforce-intelligence";

const stamp = Date.now();
let orgId = 0;
let adminId = 0;

/** Des noms qu'aucun gabarit de prompt ne contient par hasard. */
const SALARIES = [
  { prenom: "Theodorine", nom: `Quillembert${stamp}` },
  { prenom: "Aurelien", nom: `Vastragone${stamp}` },
];
const RESPONSABLE = { prenom: "Gwendoline", nom: `Marchevalle${stamp}` };

function appli(router: express.Router) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = {
      userId: adminId, organisationId: orgId, userRole: "administrateur",
      prenom: RESPONSABLE.prenom, userEmail: `resp-${stamp}@example.test`,
    };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

/** Vrai si une identite reelle figure dans ce qui est parti. */
function identiteEnvoyee(): string[] {
  const tout = envoyes.join("\n");
  return [...SALARIES, RESPONSABLE]
    .flatMap((p) => [p.prenom, p.nom])
    .filter((mot) => tout.includes(mot));
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Eval ${stamp}`, slug: `eval-${stamp}`, email: `eval-${stamp}@example.test`,
    phone: "+33123456789", maxUsers: 50, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [a] = await db.insert(usersTable).values({
    organisationId: orgId, email: `resp-${stamp}@example.test`, passwordHash: "x",
    prenom: RESPONSABLE.prenom, nom: RESPONSABLE.nom, role: "administrateur", actif: true,
    departement: "Direction Nord",
  }).returning({ id: usersTable.id });
  adminId = a!.id;
  for (const [i, s] of SALARIES.entries()) {
    await db.insert(usersTable).values({
      organisationId: orgId, email: `sal-${i}-${stamp}@example.test`, passwordHash: "x",
      prenom: s.prenom, nom: s.nom, role: "agent", actif: true, departement: "Service Nord",
    });
  }
}, 60_000);

afterAll(async () => {
  // Les utilisateurs ne sont pas supprimes : chaque evaluation ecrit une trace
  // dans le journal d'audit, append-only par conception (un declencheur refuse
  // meme de detacher la trace de son auteur). On les desactive seulement.
  await db.update(usersTable).set({ actif: false }).where(eq(usersTable.organisationId, orgId));
  await db.update(organisationsTable).set({ actif: false }).where(eq(organisationsTable.id, orgId));
});

beforeEach(() => { envoyes.length = 0; });

describe("workforce-intelligence", () => {
  beforeEach(() => {
    reponse = () => JSON.stringify({
      sante_equipe: 60, tendance: "stable", message_manager: "Equipe stable.",
      top_performeurs: [], previsions: "RAS",
      en_difficulte: [{ nom: "Salarie-1", score: 30, probleme: "retards", action_recommandee: "Faire un point avec Salarie-1" }],
      alertes: [{ type: "retard", collaborateur: "Salarie-2", message: "Salarie-2 a des taches en retard", urgence: "moyenne" }],
      recommandations: [],
    });
  });

  it("le modele est bien appele (sinon le reste ne prouve rien)", async () => {
    const r = await request(appli(workforceIntelligence)).get("/api/workforce-intelligence");
    expect(r.status).toBe(200);
    expect(envoyes.length).toBeGreaterThan(0);
  });

  it("aucun prenom ni nom de salarie ni du responsable ne part", async () => {
    await request(appli(workforceIntelligence)).get("/api/workforce-intelligence");
    expect(identiteEnvoyee(), "identite envoyee au fournisseur d'IA").toEqual([]);
  });

  it("le service ne part pas non plus", async () => {
    // Dans une petite equipe, « le seul agent du Service Nord » designe
    // quelqu'un aussi surement qu'un nom.
    await request(appli(workforceIntelligence)).get("/api/workforce-intelligence");
    expect(envoyes.join("\n")).not.toContain("Service Nord");
  });

  it("le modele recoit des pseudonymes", async () => {
    await request(appli(workforceIntelligence)).get("/api/workforce-intelligence");
    expect(envoyes.join("\n")).toMatch(/Salarie-1/);
  });

  it("le responsable recoit les vrais noms", async () => {
    const r = await request(appli(workforceIntelligence)).get("/api/workforce-intelligence");
    const ai = r.body.ai;
    // Le responsable est lui aussi un utilisateur actif : il fait partie des
    // personnes evaluees, et l'un des pseudonymes le designe.
    const noms = [...SALARIES, RESPONSABLE].map((s) => `${s.prenom} ${s.nom}`);
    expect(noms).toContain(ai.en_difficulte[0].nom);
    expect(noms).toContain(ai.alertes[0].collaborateur);
    expect(JSON.stringify(ai)).not.toMatch(/Salarie-\d/);
  });
});

describe("workforce-agent (quatre appels successifs)", () => {
  beforeEach(() => {
    reponse = (p) => {
      if (p.includes("Phase 1: RECONNAISSANCE")) {
        return JSON.stringify({ kritik_sinyaller: ["Salarie-1 inactif"], risk_seviyesi: "sari", acil_mudahale: ["Salarie-1"], guclu_yonler: [], ekip_enerjisi: "ok", skor_tahmini: 50 });
      }
      if (p.includes("Phase 2: DIAGNOSTIC")) {
        return JSON.stringify({ bireysel_teshis: [{ nom: "Salarie-2", durum: "kritik", guc: "-", zayiflik: "-", kok_neden: "-" }], ekip_dinamikleri: "-", darbogazlar: [] });
      }
      if (p.includes("Phase 3: PLAN")) {
        return JSON.stringify({ acil_aksiyonlar: [{ aksiyon: "Voir Salarie-2", hedef: "Salarie-2", sure: "Aujourd'hui", etki: "yuksek" }], haftalik_plan: [], bireysel_gorusme: ["Salarie-2"], surec_iyilestirme: [] });
      }
      return JSON.stringify({ haftalik_tahmin: "-", trend: "stabil", risk_faktoru: "-", firsat: "-", gecmis_karsilastirma: "-", oneri_skoru: 50 });
    };
  });

  it("les quatre phases sont bien appelees", async () => {
    const r = await request(appli(workforceAgent)).get("/api/workforce-agent");
    expect(r.status).toBe(200);
    expect(envoyes.length).toBe(4);
  });

  it("aucune identite dans AUCUNE des quatre phases", async () => {
    // Les phases 2 a 4 reprennent la sortie des precedentes : une seule
    // re-identification trop tot et les noms repartiraient au tour suivant.
    await request(appli(workforceAgent)).get("/api/workforce-agent");
    expect(identiteEnvoyee(), "identite envoyee au fournisseur d'IA").toEqual([]);
  });

  it("ni le service, ni le prenom du responsable", async () => {
    await request(appli(workforceAgent)).get("/api/workforce-agent");
    const tout = envoyes.join("\n");
    expect(tout).not.toContain("Service Nord");
    expect(tout).not.toContain(RESPONSABLE.prenom);
  });

  it("le rapport rendu porte les vrais noms", async () => {
    const r = await request(appli(workforceAgent)).get("/api/workforce-agent");
    // Le corps contient aussi les metriques brutes, qui portent les noms : on
    // regarde donc la ou le MODELE a ecrit, pas le corps entier.
    const noms = [...SALARIES, RESPONSABLE].map((p) => `${p.prenom} ${p.nom}`);
    expect(noms).toContain(r.body.phases.diagnose.bireysel_teshis[0].nom);
    expect(noms).toContain(r.body.phases.prescribe.acil_aksiyonlar[0].hedef);
    const ecritParLeModele = JSON.stringify([r.body.phases, r.body.agentLog]);
    expect(ecritParLeModele).not.toMatch(/Salarie-\d/);
  });
});

describe("commandant/employee-quality (plusieurs fournisseurs)", () => {
  // Route a plusieurs fournisseurs en concurrence : on verifie le bloc de la
  // route lui-meme, borne par accolades, pas une fenetre de caracteres.
  const src = readFileSync(join(import.meta.dirname, "..", "routes", "ai-commandant.ts"), "utf8");
  const debut = src.indexOf('router.get("/commandant/employee-quality"');
  const fin = src.indexOf("// CONVERSATIONS (Chat persistant", debut);
  const route = src.slice(debut, fin);

  it("la route est bien trouvee", () => {
    expect(debut).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(debut);
  });

  it("le prompt designe les salaries par pseudonyme, sans nom ni service", () => {
    const prompt = route.slice(route.indexOf("const prompt = `"), route.indexOf("Score équipe:"));
    expect(prompt).toMatch(/\$\{pseudonyme\(i \+ 1\)\}/);
    expect(prompt).not.toMatch(/\$\{e\.name\}/);
    expect(prompt).not.toMatch(/e\.department/);
  });

  it("les noms sont remis apres la reponse, avant l'envoi au responsable", () => {
    const remise = route.indexOf("analysis = reidentifierNoms(");
    expect(remise).toBeGreaterThan(route.indexOf("JSON.parse"));
    expect(remise).toBeLessThan(route.indexOf("res.json("));
  });
});
