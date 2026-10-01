/**
 * Essai a blanc d'un profil metier (onglet « Test et publication »).
 *
 * Le modele recoit un exemple et les outils DU PROFIL ; chaque appel d'outil
 * qu'il emet passe par `executeTool` en mode simulation : le controle de
 * profil s'applique (un outil hors profil est refuse et note comme tel), les
 * arguments sont valides, mais aucun `execute()` n'est appele — ni ecriture,
 * ni envoi, ni mise en file d'approbation. Ce que l'essai rend, c'est la liste
 * des actions que l'agent AURAIT faites, avec leur palier.
 *
 * Seules traces laissees : l'execution d'essai dans `agent_runs` (trigger
 * « essai », pour que la publication puisse la citer) et l'usage IA, qui est
 * reellement consomme.
 *
 * Quota : verifie et reserve AVANT CHAQUE appel au modele (un essai peut en
 * faire trois), l'usage inscrit (await, avec l'utilisateur) puis le cache de
 * quota invalide APRES l'ecriture. Quota epuise : erreur explicite
 * (AiQuotaExceededError), jamais un essai « reussi » vide.
 *
 * Validite : un essai sans aucune action prevue, ou dont toutes les actions
 * ont ete refusees, est inscrit tel quel (valide=false) et n'est pas cite comme
 * dernier essai du profil — il n'a rien montre.
 */
import { and, eq } from "drizzle-orm";
import { db, agentProfileSettingsTable, agentRunsTable } from "@workspace/db";
import { callOrgGemini } from "./ai-providers";
import { assertAiQuota, invalidateQuotaCache, reserveAiCall } from "./ai-quota";
import { executeTool, getGeminiToolDeclarations } from "./assistant-tools";
import { palierOutil, exigeApprobation, type PalierOutil } from "./catalogue-agents";
import { ajouterEtape, demarrerExecution, terminerExecution } from "./journal-agents";
import { profilMetier, type ProfilMetier } from "./profils-agents";
import { extractGeminiTokens, recordAiUsage, estimateAiCostUsd, GEMINI_PRO_MODEL } from "./ai-utils";

const MODELE = process.env.ASSISTANT_MODEL || GEMINI_PRO_MODEL;
const TOURS_MAX = 3;
export const TRIGGER_ESSAI = "essai";

export interface ActionEssai {
  outil: string;
  args: Record<string, unknown>;
  palier: PalierOutil | null;
  /** simulee : aurait ete faite ; approbation : aurait attendu un humain ; refusee : hors profil ou invalide. */
  statut: "simulee" | "approbation" | "refusee";
  resume?: string;
  raison?: string;
}

export interface ResultatEssai {
  runId: number;
  profil: string;
  actions: ActionEssai[];
  reponse: string;
  /** Au moins une action prevue et non refusee. */
  valide: boolean;
  /** Les tours sont epuises alors que le modele appelait encore des outils. */
  incomplet: boolean;
}

/** Un essai compte s'il a montre au moins une action que le profil pouvait faire. */
export function essaiAMontreQuelqueChose(actions: readonly ActionEssai[]): boolean {
  return actions.some((a) => a.statut !== "refusee");
}

interface Part { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }
interface Reponse { candidates?: Array<{ content?: { parts?: Part[] } }> }

function consigne(p: ProfilMetier): string {
  return `Tu es l'agent « ${p.nom} » d'une entreprise du batiment. Mission : ${p.mission}
Ceci est un ESSAI : appelle les outils dont tu aurais besoin pour traiter la demande, comme en vrai.
Passe la main a un humain dans ces cas : ${p.transfertHumain.conditions.join(" ; ")}.
Reponds en francais, en une ou deux phrases, ce que tu aurais fait.`;
}

export async function essayerProfil(orgId: number, userId: number, profilId: string, entree: string): Promise<ResultatEssai> {
  const p = profilMetier(profilId);
  if (!p) throw new Error(`Profil inconnu : ${profilId}`);
  // Avant toute trace : un quota epuise se dit, il ne produit pas un essai vide.
  // (Revu avant chaque appel dans la boucle.)
  await assertAiQuota(orgId);

  const runId = await demarrerExecution({
    orgId, agentId: p.id, trigger: TRIGGER_ESSAI, requestedBy: userId,
    entree: { extrait: entree.slice(0, 280), simulation: true },
  });
  const actions: ActionEssai[] = [];
  let reponse = "";
  let incomplet = false;
  try {
    const contents: Array<{ role: string; parts: unknown[] }> = [{ role: "user", parts: [{ text: entree }] }];
    for (let tour = 0; tour < TOURS_MAX; tour++) {
      // Chaque appel Pro coute : quota relu et reserve a CHAQUE tour, comme les
      // autres routes IA (routes/ai-agents.ts), pour que des essais lances en
      // parallele pres du plafond ne le franchissent pas ensemble.
      await assertAiQuota(orgId);
      const liberer = reserveAiCall(orgId);
      const t0 = Date.now();
      let brut: Reponse;
      let jetons: { input: number; output: number };
      try {
        brut = await callOrgGemini(orgId, (client) => client.models.generateContent({
          model: MODELE,
          contents,
          config: { systemInstruction: consigne(p), tools: [getGeminiToolDeclarations(p.id)] },
        })) as Reponse;
        jetons = extractGeminiTokens(brut);
        // Inscrit AVANT d'invalider le cache : sinon le prochain controle peut
        // remplir le cache d'une somme qui ignore cet appel.
        await recordAiUsage({
          organisationId: orgId, userId, provider: "gemini", model: MODELE, route: `/ajans/profils/${p.id}/essai`,
          inputTokens: jetons.input, outputTokens: jetons.output, durationMs: Date.now() - t0, runId,
        });
        invalidateQuotaCache(orgId);
      } finally {
        liberer();
      }
      const coutUsd = estimateAiCostUsd(MODELE, jetons.input, jetons.output);
      await ajouterEtape(runId, orgId, {
        kind: "llm", name: "essai", status: "ok",
        usage: { inputTokens: jetons.input, outputTokens: jetons.output, costUsd: coutUsd, durationMs: Date.now() - t0 },
      });

      const parts = brut.candidates?.[0]?.content?.parts ?? [];
      const appels = parts.filter((x) => x.functionCall);
      if (appels.length === 0) {
        reponse = parts.map((x) => x.text ?? "").join("\n").trim();
        break;
      }
      contents.push({ role: "model", parts });
      const retours: unknown[] = [];
      for (const a of appels) {
        const nom = a.functionCall!.name;
        const args = a.functionCall!.args ?? {};
        // `simulation: true` : le gate de profil et la validation s'appliquent,
        // l'outil ne s'execute pas.
        const r = await executeTool(nom, args, { orgId, userId }, { agent: p.id, simulation: true });
        const palier = r.refus ? null : palierOutil(nom);
        const action: ActionEssai = r.ok && r.simulation
          ? { outil: nom, args, palier, statut: palier && exigeApprobation(palier) ? "approbation" : "simulee", resume: r.simulation.summary }
          : { outil: nom, args, palier, statut: "refusee", raison: r.error ?? "Refuse." };
        actions.push(action);
        await ajouterEtape(runId, orgId, {
          kind: "outil", name: nom, status: action.statut === "refusee" ? "refuse" : "ok",
          detail: { simulation: true, statut: action.statut, palier, resume: action.resume ?? null },
          error: action.raison ?? null,
        });
        retours.push({ functionResponse: { name: nom, response: r.ok ? (r.result as Record<string, unknown>) : { error: r.error } } });
      }
      // Dernier tour et le modele appelle encore des outils : on n'envoie pas
      // un appel de plus hors budget, on le dit (incomplet) plutot que de rendre
      // une reponse vide comme si l'essai avait abouti.
      if (tour === TOURS_MAX - 1) { incomplet = true; break; }
      contents.push({ role: "function", parts: retours });
    }
    const valide = essaiAMontreQuelqueChose(actions);
    await terminerExecution(runId, orgId, {
      status: "terminee",
      output: { simulation: true, valide, incomplet, actions: actions.length, refusees: actions.filter((a) => a.statut === "refusee").length, reponse: reponse.slice(0, 500) },
    });
  } catch (err) {
    await terminerExecution(runId, orgId, { status: "echouee", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  const valide = essaiAMontreQuelqueChose(actions);
  // Seul un essai qui a montre quelque chose devient « le dernier essai » cite
  // a la publication. `enabled: true` a l'insertion : l'absence de ligne vaut
  // actif, creer la ligne pour noter un essai ne doit pas desactiver le profil.
  if (valide) {
    await db.insert(agentProfileSettingsTable)
      .values({ organisationId: orgId, agentId: p.id, enabled: true, lastDryRunId: runId })
      .onConflictDoUpdate({
        target: [agentProfileSettingsTable.organisationId, agentProfileSettingsTable.agentId],
        set: { lastDryRunId: runId, updatedAt: new Date() },
      });
  }
  return { runId, profil: p.id, actions, reponse, valide, incomplet };
}

/** L'essai cite appartient-il a cette organisation, a ce profil, et a-t-il abouti ? */
export async function essaiValide(orgId: number, profilId: string): Promise<number | null> {
  const [s] = await db.select({ run: agentProfileSettingsTable.lastDryRunId }).from(agentProfileSettingsTable)
    .where(and(eq(agentProfileSettingsTable.organisationId, orgId), eq(agentProfileSettingsTable.agentId, profilId)));
  if (!s?.run) return null;
  const [run] = await db.select({ id: agentRunsTable.id, output: agentRunsTable.output }).from(agentRunsTable).where(and(
    eq(agentRunsTable.id, s.run), eq(agentRunsTable.organisationId, orgId),
    eq(agentRunsTable.agentId, profilId), eq(agentRunsTable.trigger, TRIGGER_ESSAI), eq(agentRunsTable.status, "terminee"),
  ));
  if (!run) return null;
  // Un essai qui n'a rien montre (valide=false) ne compte pas.
  return (run.output as { valide?: boolean } | null)?.valide === true ? run.id : null;
}
