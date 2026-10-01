/**
 * Etat des profils metier POUR UNE organisation (table agent_profile_settings)
 * et profil effectif d'une conversation de l'assistant.
 *
 * Les listes d'outils sont dans services/profils-agents.ts ; ce module dit
 * seulement si un profil est actif ici, et lequel s'applique a une
 * conversation. Il est relu a chaque tour ET a chaque confirmation : un profil
 * desactive par un responsable, ou un role retrograde, cesse d'agir dans les
 * conversations deja ouvertes, au tour suivant, sans attendre que
 * l'utilisateur en ouvre une nouvelle.
 *
 * Decision « actif par defaut » : l'absence de ligne signifie ACTIF. Les
 * pouvoirs retires a l'assistant universel (e-mail, SMS, CRM, journal
 * d'appels...) vivent desormais dans les profils metier ; si ces profils
 * etaient inactifs tant qu'un responsable ne les a pas publies, chaque client
 * existant perdrait du jour au lendemain ce qui marchait la veille. Un
 * responsable peut desactiver un profil (ligne enabled=false), puis le
 * reactiver (journalise).
 */
import { and, eq } from "drizzle-orm";
import { db, agentProfileSettingsTable, assistantConversationsTable, usersTable } from "@workspace/db";
import { PROFIL_ASSISTANT, estProfilMetier, profilMetier, roleAutorisePourProfil } from "./profils-agents";

export async function etatsProfils(orgId: number) {
  const rows = await db.select().from(agentProfileSettingsTable)
    .where(eq(agentProfileSettingsTable.organisationId, orgId));
  return new Map(rows.map((r) => [r.agentId, r]));
}

/** Etat lu d'une ligne (ou de son absence) : absente = actif. */
export function estActif(row: { enabled: boolean } | undefined | null): boolean {
  return row ? row.enabled === true : true;
}

/** Le profil est-il utilisable dans cette organisation ? L'assistant l'est toujours. */
export async function profilPublie(orgId: number, agentId: string): Promise<boolean> {
  if (agentId === PROFIL_ASSISTANT) return true;
  if (!estProfilMetier(agentId)) return false;
  const [row] = await db.select({ enabled: agentProfileSettingsTable.enabled }).from(agentProfileSettingsTable)
    .where(and(eq(agentProfileSettingsTable.organisationId, orgId), eq(agentProfileSettingsTable.agentId, agentId)));
  return estActif(row);
}

export type CodeRefusProfil = "profil_inconnu" | "profil_role" | "profil_desactive";
export type ChoixProfil = { ok: true; agent: string } | { ok: false; statut: 400 | 403; code: CodeRefusProfil; error: string };

/**
 * Profil demande a la creation d'une conversation (chat ou session vocale) :
 * connu, actif, permis au role. Un seul controle pour les deux canaux : un
 * profil refuse a l'ecrit ne doit pas s'ouvrir a la voix.
 */
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
    return { ok: false, statut: 403, code: "profil_desactive", error: `Le profil « ${p.nom} » est desactive dans votre organisation.` };
  }
  return { ok: true, agent: demande };
}

/**
 * Role ACTUEL de l'utilisateur, relu en base (la session peut dater d'avant
 * une retrogradation). Lu par identifiant seul : un super_admin peut agir
 * dans une organisation qui n'est pas celle de sa ligne utilisateur ; on ne
 * lit que le role de la personne connectee, rien d'une autre organisation.
 */
async function roleActuel(userId: number): Promise<string | undefined> {
  const [u] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.role ?? undefined;
}

/**
 * Agent sous lequel une conversation agit MAINTENANT, pour CET utilisateur.
 * Null en base = assistant universel. Deux controles a chaque tour et a
 * chaque confirmation : le profil est toujours actif, et le role actuel de
 * l'utilisateur y a toujours droit — un administrateur retrograde en
 * « agent » ne garde pas la finance dans une conversation ouverte avant.
 */
export async function agentDeConversation(
  conversationId: number,
  orgId: number,
  userId: number,
): Promise<{ ok: true; agent: string } | { ok: false; code: CodeRefusProfil; error: string }> {
  const [conv] = await db.select({ profil: assistantConversationsTable.profilAgent }).from(assistantConversationsTable)
    .where(and(eq(assistantConversationsTable.id, conversationId), eq(assistantConversationsTable.organisationId, orgId)));
  const agent = conv?.profil || PROFIL_ASSISTANT;
  const p = profilMetier(agent);
  // Le role n'est relu que pour un profil qui en restreint l'acces : inutile
  // de payer une requete pour l'assistant ou un profil ouvert a tous.
  if (p?.roles && !roleAutorisePourProfil(p, await roleActuel(userId))) {
    return { ok: false, code: "profil_role", error: `Le profil « ${p.nom} » est reserve aux responsables : votre role actuel ne permet plus d'agir dans cette conversation.` };
  }
  if (!(await profilPublie(orgId, agent))) {
    const nom = p?.nom ?? agent;
    return { ok: false, code: "profil_desactive", error: `Le profil « ${nom} » a ete desactive dans votre organisation : cette conversation ne peut plus agir. Ouvrez une nouvelle conversation.` };
  }
  return { ok: true, agent };
}
