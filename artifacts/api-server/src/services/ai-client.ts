/**
 * Le client d'IA a utiliser POUR CET APPEL, avec la cle de la bonne partie.
 *
 * Pourquoi ce module existe: une trentaine d'endroits du serveur faisaient
 * `const { ai } = await import("@workspace/integrations-gemini-ai")`, c'est-a-dire
 * prenaient le singleton de la plateforme sans jamais regarder a quelle
 * organisation appartenait la requete — alors meme que `ai-providers.ts` savait
 * deja construire un client avec la cle du client. `aiForOrg(orgId)` remplace
 * cette ligne mot pour mot.
 *
 * L'organisation est passee EXPLICITEMENT, jamais devinee. Un contexte de
 * requete implicite (AsyncLocalStorage) aurait evite de la faire circuler, mais
 * au prix du seul mode de panne qu'il ne faut pas ici: un cron ou une file qui
 * sort du contexte retomberait silencieusement sur « pas d'organisation »,
 * c'est-a-dire sur la carte bleue du proprietaire, sans que rien ne le signale.
 * Dans les routes, `orgId` est deja a portee de main (`getOrgId(req)`).
 *
 * `null` reste permis, mais comme une declaration: « cet appel n'a pas de
 * client derriere » (surface publique, sonde de sante).
 */
import type { GoogleGenAI } from "@google/genai";
import { resolveAiAccess } from "./ai-key-policy";
import {
  getOrgGeminiClient,
  getOrgEmbeddingClient,
  getOrgOpenAIClient,
  getOrgAnthropicClient,
  callOrgGemini,
  callOrgEmbedding,
} from "./ai-providers";

/**
 * Client Gemini pour l'organisation donnee. Leve `AiKeyRequiredError` si elle
 * doit apporter la sienne.
 *
 * Le type de retour est celui du SDK, pas `any`: les appelants passent le
 * client a des aides generiques (`withProviderTimeout`, `aiCallWithRetry`) qui,
 * face a un `any`, cessent d'inferer et rendent du `unknown` a chaque appel —
 * la migration aurait coute le typage de quarante sites d'appel.
 */
export async function aiForOrg(orgId: number | null | undefined): Promise<GoogleGenAI> {
  const access = await resolveAiAccess(orgId);
  return getOrgGeminiClient(access.payerOrgId);
}

/** Client d'embeddings, meme regle. */
export async function embeddingAiForOrg(orgId: number | null | undefined): Promise<GoogleGenAI> {
  const access = await resolveAiAccess(orgId);
  return getOrgEmbeddingClient(access.payerOrgId);
}

export async function openAiForOrg(orgId: number | null | undefined): Promise<any> {
  const access = await resolveAiAccess(orgId);
  return getOrgOpenAIClient(access.payerOrgId);
}

export async function anthropicForOrg(orgId: number | null | undefined): Promise<any> {
  const access = await resolveAiAccess(orgId);
  return getOrgAnthropicClient(access.payerOrgId);
}

/**
 * Variante a preferer quand l'appel reseau est fait sur place: en plus de
 * choisir la cle, elle rejoue une fois sur la plateforme si la cle du client
 * est revoquee (regle produit posee dans `ai-providers.ts`: une mauvaise cle ne
 * doit pas couper l'IA). `aiForOrg` seul ne peut pas le faire — il rend un
 * client, il ne voit pas l'echec.
 */
export async function callAiForOrg<T>(
  orgId: number | null | undefined,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const access = await resolveAiAccess(orgId);
  return callOrgGemini(access.payerOrgId, fn);
}

export async function callEmbeddingAiForOrg<T>(
  orgId: number | null | undefined,
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const access = await resolveAiAccess(orgId);
  return callOrgEmbedding(access.payerOrgId, fn);
}
