/**
 * tache-ia.ts — le seul chemin par lequel une IA cree une tache.
 *
 * Avant ce module, treize fichiers inseraient directement dans `tasks`. Neuf
 * d'entre eux le faisaient pour le compte d'une IA, et aucun ne le disait: une
 * tache proposee par une machine etait indiscernable d'une tache ecrite par un
 * collegue. Deux agents prefixaient le titre (« [Email] ... »), les autres non
 * — une convention appliquee a moitie n'est pas une convention.
 *
 * Passer par une seule porte change deux choses:
 *
 *   - l'attribution d'auteur ne peut plus etre oubliee. Elle n'est pas un
 *     parametre qu'on pense a remplir: elle est la raison d'etre de la
 *     fonction, et un test structurel verifie qu'aucun agent ne contourne;
 *
 *   - le destinataire est choisi par ROLE, une fois, au meme endroit. Une
 *     tache creee par une machine et attribuee a personne n'est pas une
 *     tache: c'est une ligne que tout le monde regarde et que personne ne
 *     prend.
 */
import { and, eq } from "drizzle-orm";
import { db as dbParDefaut, tasksTable, usersTable } from "@workspace/db";

import { attribuer, nomAffichable, type Membre, type NatureTache } from "./attribution-role";

/**
 * Les agents autorises a creer des taches.
 *
 * La liste est fermee a dessein. Un identifiant libre finirait par contenir
 * trois orthographes du meme agent, et l'utilisateur qui veut savoir « qui
 * m'envoie ca » ne pourrait plus regrouper.
 */
export const AGENTS = {
  secretaireAutonome: "secretaire-autonome",
  depouillementCourriel: "depouillement-courriel",
  analyseAppel: "analyse-appel",
  analyseDocument: "analyse-document",
  commandant: "commandant",
  assistant: "assistant",
  saisieVocale: "saisie-vocale",
  rapport: "analyse-rapport",
  analyseReunion: "analyse-reunion",
  automatisation: "moteur-automatisation",
} as const;

export type IdentifiantAgent = (typeof AGENTS)[keyof typeof AGENTS];

/** Libelles montres a l'utilisateur. L'identifiant reste stable, le libelle peut changer. */
export const LIBELLE_AGENT: Record<IdentifiantAgent, string> = {
  "secretaire-autonome": "Secretaire autonome",
  "depouillement-courriel": "Depouillement des courriels",
  "analyse-appel": "Analyse d'appel",
  "analyse-document": "Analyse de document",
  "commandant": "Commandant IA",
  "assistant": "Assistant",
  "saisie-vocale": "Saisie vocale",
  "analyse-rapport": "Analyse de rapport",
  "analyse-reunion": "Compte-rendu de reunion",
  "moteur-automatisation": "Moteur d'automatisation",
};

export interface DemandeTacheIa {
  organisationId: number;
  agent: IdentifiantAgent;
  nature: NatureTache;
  title: string;
  description?: string | null;
  priority?: string;
  dueDate?: Date | null;
  relatedContactId?: number | null;
  relatedCallId?: number | null;
  projetId?: number | null;
  /** Ne pas attribuer a cette personne (souvent celle qui est a l'origine du declencheur). */
  eviter?: number | null;
  /**
   * L'humain qui a DEMANDE la tache, quand il y en a un.
   *
   * Deux situations tres differentes se cachent derriere « creee par l'IA »:
   * un agent qui depouille les courriels agit seul, personne ne lui a rien
   * demande; l'assistant a qui l'on dit « cree-moi une tache » agit sur ordre.
   * Les confondre priverait le second de son auteur humain, et le premier
   * d'en avoir un serait faux.
   *
   * Renseigne `createdBy`. La colonne d'agent reste posee dans les deux cas:
   * c'est bien une machine qui a redige la tache.
   */
  demandePar?: number | null;
  /**
   * Destinataire impose, quand le demandeur sait mieux que la regle.
   *
   * Quelqu'un qui dit « cree-moi une tache » veut la voir dans SA liste, pas
   * dans celle du role competent. L'attribution par role sert quand personne
   * n'a exprime de choix.
   */
  assignerA?: number | null;
}

/**
 * Ce dont ce module a besoin pour ecrire: `select` et `insert`, rien de plus.
 *
 * Type STRUCTUREL, comme `nextInvoiceNumber` juste a cote, et pour la meme
 * raison: une transaction Drizzle n'est pas la base, mais elle sait faire ces
 * deux choses. Exiger le type exact de la base obligerait chaque appelant en
 * transaction a mentir avec un `as`, et un `as` est un test qu'on desactive.
 */
export type ExecuteurTache = Pick<typeof dbParDefaut, "select" | "insert">;

export interface TacheIaCreee {
  id: number;
  assignedTo: string | null;
  roleRetenu: string | null;
  /** Vrai si le role ideal n'existait pas et qu'on a remonte vers la direction. */
  parDefaut: boolean;
}

/**
 * Cree une tache au nom d'un agent, attribuee selon le role.
 *
 * `dbLike` est injectable pour permettre l'usage dans une transaction — une
 * tache creee a partir d'un document doit disparaitre avec lui si l'ecriture
 * du document echoue.
 */
export async function creerTacheIa(
  demande: DemandeTacheIa,
  dbLike: ExecuteurTache = dbParDefaut,
): Promise<TacheIaCreee> {
  const membres: Membre[] = await dbLike
    .select({
      id: usersTable.id,
      role: usersTable.role,
      actif: usersTable.actif,
      nom: usersTable.nom,
      prenom: usersTable.prenom,
    })
    .from(usersTable)
    .where(and(eq(usersTable.organisationId, demande.organisationId), eq(usersTable.actif, true)));

  // Un destinataire impose court-circuite la regle: elle sert a decider quand
  // personne n'a decide, pas a contredire quelqu'un qui savait.
  const impose = demande.assignerA
    ? membres.find((m) => m.id === demande.assignerA) ?? null
    : null;
  const choix = impose
    ? { membre: impose, roleRetenu: impose.role, parDefaut: false }
    : attribuer(demande.nature, membres, { eviter: demande.eviter ?? null });

  // La mention de l'auteur est ajoutee a la description, EN PLUS de la
  // colonne. La colonne sert aux filtres et aux ecrans; le texte suit la tache
  // partout ailleurs — dans un courriel de notification, dans un export CSV,
  // dans une capture d'ecran envoyee a un collegue. Une information qui ne
  // vit que dans une colonne disparait des qu'on sort de l'application.
  const signature = `Propose par ${LIBELLE_AGENT[demande.agent]} (IA).`;
  const explication = choix.parDefaut && choix.roleRetenu
    ? ` Adressee au role « ${choix.roleRetenu} » faute de destinataire plus specifique.`
    : "";
  const description = [demande.description?.trim(), `${signature}${explication}`]
    .filter(Boolean)
    .join("\n\n");

  const [ligne] = await dbLike
    .insert(tasksTable)
    .values({
      organisationId: demande.organisationId,
      title: demande.title,
      description,
      status: "en_attente",
      priority: demande.priority ?? "moyenne",
      dueDate: demande.dueDate ?? null,
      assignedTo: choix.membre ? String(choix.membre.id) : null,
      relatedContactId: demande.relatedContactId ?? null,
      relatedCallId: demande.relatedCallId ?? null,
      projetId: demande.projetId ?? null,
      // Le point de tout ce module.
      createdByAgent: demande.agent,
      // L'humain qui a demande, s'il y en a un. Les deux colonnes coexistent:
      // « l'assistant a redige cette tache, a la demande de Marie » est plus
      // vrai que l'un ou l'autre pris seul.
      createdBy: demande.demandePar ?? null,
    })
    .returning({ id: tasksTable.id });

  return {
    id: ligne.id,
    assignedTo: choix.membre ? nomAffichable(choix.membre) : null,
    roleRetenu: choix.roleRetenu,
    parDefaut: choix.parDefaut,
  };
}
