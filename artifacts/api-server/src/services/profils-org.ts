/**
 * Etat des profils metier POUR UNE organisation (table agent_profile_settings)
 * et profil effectif d'une conversation de l'assistant.
 *
 * Les listes d'outils sont dans services/profils-agents.ts ; ce module dit
 * seulement si un profil est publie ici, et lequel s'applique a une
 * conversation. Il est relu a chaque tour : un profil desactive par un
 * responsable cesse d'agir dans les conversations deja ouvertes, au tour
 * suivant, sans attendre que l'utilisateur en ouvre une nouvelle.
 */
import { and, eq } from "drizzle-orm";
import { db, agentProfileSettingsTable, assistantConversationsTable } from "@workspace/db";
import { PROFIL_ASSISTANT, estProfilMetier, profilMetier, roleAutorisePourProfil } from "./profils-agents";

export async function etatsProfils(orgId: number) {
  const rows = await db.select().from(agentProfileSettingsTable)
    .where(eq(agentProfileSettingsTable.organisationId, orgId));
  return new Map(rows.map((r) => [r.agentId, r]));
}

/** Le profil est-il utilisable dans cette organisation ? L'assistant l'est toujours. */
export async function profilPublie(orgId: number, agentId: string): Promise<boolean> {
  if (agentId === PROFIL_ASSISTANT) return true;
  if (!estProfilMetier(agentId)) return false;
  const [row] = await db.select({ enabled: agentProfileSettingsTable.enabled }).from(agentProfileSettingsTable)
    .where(and(eq(agentProfileSettingsTable.organisationId, orgId), eq(agentProfileSettingsTable.agentId, agentId)));
  return row?.enabled === true;
}

export type ChoixProfil = { ok: true; agent: string } | { ok: false; statut: 400 | 403; code: string; error: string };

/** Profil demande a la creation d'une conversation : connu, publie, permis au role. */
export async function choisirProfil(orgId: number, role: string | undefined, demande: unknown): Promise<ChoixProfil> {
  if (demande == null || demande === "" || demande === PROFIL_ASSISTANT) return { ok: true, agent: PROFIL_ASSISTANT };
  if (typeof demande !== "string" || !estProfilMetier(demande)) {
    return { ok: false, statut: 400, code: "profil_inconnu", error: "Profil d'agent inconnu." };
  }
  const p = profilMetier(demande)!;
  if (!roleAutorisePourProfil(p, role)) {
    return { ok: false, statut: 403, code: "profil_role", error: `Le profil « ${p.nom} » est reserve aux responsables.` };
  }
  if (!(await profilPublie(orgId, demande))) {
    return { ok: false, statut: 403, code: "profil_non_publie", error: `Le profil « ${p.nom} » n'est pas publie dans votre organisation.` };
  }
  return { ok: true, agent: demande };
}

/**
 * Agent sous lequel une conversation agit maintenant. Null en base =
 * assistant universel (conversations anterieures aux profils : elles perdent
 * les outils retires a l'assistant, y compris pour une action deja en
 * attente — decision : refuser plutot que d'honorer un pouvoir retire).
 */
export async function agentDeConversation(conversationId: number, orgId: number): Promise<{ ok: true; agent: string } | { ok: false; error: string }> {
  const [conv] = await db.select({ profil: assistantConversationsTable.profilAgent }).from(assistantConversationsTable)
    .where(and(eq(assistantConversationsTable.id, conversationId), eq(assistantConversationsTable.organisationId, orgId)));
  const agent = conv?.profil || PROFIL_ASSISTANT;
  if (!(await profilPublie(orgId, agent))) {
    const nom = profilMetier(agent)?.nom ?? agent;
    return { ok: false, error: `Le profil « ${nom} » a ete desactive dans votre organisation : cette conversation ne peut plus agir. Ouvrez une nouvelle conversation.` };
  }
  return { ok: true, agent };
}
