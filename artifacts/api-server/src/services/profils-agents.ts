/**
 * Profils d'agents et listes d'outils autorises — LE seul endroit ou l'on dit
 * quel agent a le droit d'executer quel outil.
 *
 * Pourquoi un module a part (et sans aucune dependance) : `executeTool`
 * (services/assistant-tools.ts) est le point de passage unique de tous les
 * outils, quel que soit l'appelant — conversation de l'assistant, assistant
 * vocal, confirmation d'une action en attente, file d'approbation,
 * orchestrateur, essai a blanc. Il lit ce module pour refuser un outil hors
 * profil AVANT toute validation ou execution. Si les listes vivaient dans le
 * catalogue (qui importe assistant-tools), l'import serait circulaire ; s'il y
 * en avait une par appelant, l'une finirait par deriver. Le catalogue
 * (services/catalogue-agents.ts) et l'ecran « Ajan Bureau » lisent les memes
 * listes, ici.
 *
 * Regle : un appelant DOIT nommer son agent (`executeTool(..., { agent })`,
 * parametre obligatoire). Agent inconnu = aucun outil (refus par defaut).
 *
 * Decision « assistant universel » (spec section 9) : il n'est PLUS un
 * super-agent. Il lit l'activite et cree/planifie du travail interne, mais
 * n'ecrit plus dans le CRM (contacts, prospects), ni dans le journal
 * d'appels, n'envoie rien vers l'exterieur (e-mail, SMS, proposition de
 * creneaux), ne supprime rien et ne lit pas la synthese financiere. Ces
 * pouvoirs appartiennent aux profils metier, qu'un responsable publie apres
 * un essai a blanc, et une conversation est fixee sur UN profil a sa creation.
 * Les actions externes et destructives restent soumises a confirmation /
 * approbation (paliers de services/catalogue-agents.ts), profil ou non.
 *
 * Attribution des 36 outils (aucun n'est oublie : catalogue-agents.test.ts
 * verifie que chacun appartient a au moins un profil) :
 *   telephone    : appels (lire, inscrire, creer, supprimer), messages, SMS,
 *                  creneaux, contact (lecture), tache, base de connaissances
 *   crm          : contacts et prospects (lire, creer, modifier), e-mail, tache
 *   planning     : agenda (lire, creer, deplacer, annuler), creneaux, taches
 *   chantier     : chantiers (lire, modifier), taches, documents, images
 *   finance      : syntheses financieres, documents Excel/PDF, e-mail de relance
 *   coordinateur : lecture transverse + taches + presentation : il repartit,
 *                  il n'agit pas a la place des autres profils
 */

export type IdProfilMetier = "telephone" | "crm" | "planning" | "chantier" | "finance" | "coordinateur";

/** L'assistant universel : profil par defaut d'une conversation, toujours actif. */
export const PROFIL_ASSISTANT = "assistant";

export interface ProfilMetier {
  id: IdProfilMetier;
  nom: string;
  mission: string;
  outils: readonly string[];
  /** Quand l'agent s'arrete et passe la main a un humain. */
  transfertHumain: { conditions: readonly string[]; cible: "responsable" | "utilisateur" };
  sources: { baseConnaissances: readonly string[] | null; donnees: readonly string[] };
  /** Roles autorises a ouvrir une conversation sous ce profil (null = tout role qui ecrit). */
  roles: readonly string[] | null;
  /** Exemple propose dans l'onglet « Test et publication ». */
  exemple: string;
}

const RESPONSABLES = ["super_admin", "administrateur"] as const;

export const PROFILS_METIER: readonly ProfilMetier[] = [
  {
    id: "telephone",
    nom: "Agent telephone",
    mission: "Traite les appels et messages entrants : retrouve l'appelant, inscrit l'appel, propose un rappel ou des creneaux.",
    outils: [
      "get_current_datetime", "find_contact", "list_recent_calls", "find_recent_call", "list_recent_messages",
      "log_call", "create_call", "delete_call", "create_task", "propose_appointment_slots", "send_sms",
      "search_knowledge_base",
    ],
    transfertHumain: {
      conditions: ["appelant mecontent ou urgence", "demande de devis ou de prix", "contact introuvable", "toute suppression d'appel"],
      cible: "utilisateur",
    },
    sources: { baseConnaissances: ["public"], donnees: ["appels", "messages", "contacts (lecture)"] },
    roles: null,
    exemple: "Mme Durand a appele a 9h pour une fuite sous l'evier, rappelez-la et proposez-lui un creneau demain.",
  },
  {
    id: "crm",
    nom: "Agent CRM",
    mission: "Tient les contacts et les prospects a jour, et prepare les relances commerciales.",
    outils: [
      "get_current_datetime", "list_contacts", "find_contact", "create_contact", "update_contact",
      "list_prospects", "create_prospect", "advance_prospect", "create_task", "send_email", "search_knowledge_base",
    ],
    transfertHumain: {
      conditions: ["prospect au-dela de 20 000 EUR", "reclamation client", "doublon de contact incertain", "tout e-mail sortant"],
      cible: "utilisateur",
    },
    sources: { baseConnaissances: ["public", "commercial"], donnees: ["contacts", "prospects"] },
    roles: null,
    exemple: "Nouveau prospect : SCI Les Tilleuls, ravalement de facade, contact Paul Martin paul@tilleuls.fr. Creez-le et planifiez une relance.",
  },
  {
    id: "planning",
    nom: "Agent planning",
    mission: "Organise l'agenda et les taches : cree, deplace ou annule un rendez-vous, propose des creneaux.",
    outils: [
      "get_current_datetime", "list_calendar_events", "find_event", "create_calendar_event", "reschedule_calendar_event",
      "cancel_calendar_event", "propose_appointment_slots", "list_tasks", "find_task", "create_task", "update_task", "find_contact",
    ],
    transfertHumain: {
      conditions: ["conflit entre deux rendez-vous confirmes", "toute annulation", "equipe indisponible"],
      cible: "utilisateur",
    },
    sources: { baseConnaissances: null, donnees: ["agenda", "taches", "contacts (lecture)"] },
    roles: null,
    exemple: "Deplacez la visite de chantier de jeudi 10h a vendredi 14h et creez une tache de preparation.",
  },
  {
    id: "chantier",
    nom: "Agent chantier",
    mission: "Suit les chantiers : met a jour l'avancement, cree les taches, produit les comptes rendus.",
    outils: [
      "get_current_datetime", "find_project", "update_project", "list_tasks", "find_task", "create_task", "update_task",
      "search_knowledge_base", "generate_image", "create_word_document", "create_pdf_document",
    ],
    transfertHumain: {
      conditions: ["incident de securite", "depassement de budget", "travaux supplementaires non signes"],
      cible: "responsable",
    },
    sources: { baseConnaissances: ["technique", "public"], donnees: ["chantiers", "taches"] },
    roles: null,
    exemple: "Chantier Dupont : le carrelage est pose, passez l'avancement a 60 % et creez la tache de joints pour lundi.",
  },
  {
    id: "finance",
    nom: "Agent finance",
    mission: "Lit la situation financiere, prepare les etats et les relances de factures impayees.",
    outils: [
      "get_current_datetime", "get_financial_summary", "get_dashboard_summary", "find_contact",
      "create_excel_document", "create_pdf_document", "send_email", "create_task",
    ],
    transfertHumain: {
      conditions: ["toute relance de paiement (e-mail sortant)", "litige sur une facture", "montant au-dela de 5 000 EUR"],
      cible: "responsable",
    },
    sources: { baseConnaissances: null, donnees: ["factures", "encaissements", "synthese financiere"] },
    // Des montants que l'entreprise encaisse ou doit : reserve aux responsables,
    // comme les couts des agents (routes/ajans.ts).
    roles: RESPONSABLES,
    exemple: "Faites le point sur les factures impayees du mois et preparez une relance pour la plus ancienne.",
  },
  {
    id: "coordinateur",
    nom: "Coordinateur",
    mission: "Vue d'ensemble : lit l'activite de tous les domaines et repartit le travail par des taches. N'agit pas a la place des autres agents.",
    outils: [
      "get_current_datetime", "get_dashboard_summary", "list_contacts", "find_contact", "list_tasks", "find_task",
      "find_project", "list_prospects", "list_calendar_events", "find_event", "list_recent_calls", "list_recent_messages",
      "search_knowledge_base", "create_task", "update_task", "create_powerpoint_document",
    ],
    transfertHumain: {
      conditions: ["toute action qui releve d'un autre profil (envoi, CRM, finance)", "priorites contradictoires"],
      cible: "responsable",
    },
    sources: { baseConnaissances: ["toutes (utilisateur connecte)"], donnees: ["tableau de bord", "taches", "agenda", "appels", "prospects"] },
    roles: RESPONSABLES,
    exemple: "Que faut-il traiter en priorite aujourd'hui ? Repartissez les urgences en taches.",
  },
];

/** L'assistant universel restreint (voir la decision en tete de fichier). */
export const OUTILS_ASSISTANT_UNIVERSEL: readonly string[] = [
  // Lecture
  "get_current_datetime", "get_dashboard_summary", "list_contacts", "find_contact", "list_tasks", "find_task",
  "find_project", "list_prospects", "list_calendar_events", "find_event", "list_recent_calls", "find_recent_call",
  "search_knowledge_base", "list_recent_messages",
  // Travail interne, sans sortie ni suppression
  "create_task", "update_task", "create_calendar_event", "reschedule_calendar_event",
  "create_excel_document", "create_word_document", "create_pdf_document", "create_powerpoint_document", "generate_image",
];

/** Agents de l'orchestrateur (services/orchestrateur.ts). */
export const OUTILS_AGENT_SUPPORT: readonly string[] = ["create_task", "send_email"];
export const OUTILS_AGENT_VENTE: readonly string[] = ["create_prospect", "create_task", "send_email"];

/**
 * File d'approbation : un humain a approuve l'action, mais seuls les outils que
 * les producteurs de propositions ont le droit d'y deposer s'executent
 * (secretaire, auto-audit, automatisations, relances, orchestrateur, standard
 * telephonique). `enqueueProposal` applique la meme liste a l'entree.
 */
export const OUTILS_FILE_APPROBATION: readonly string[] = [
  "create_task", "send_email", "send_sms", "create_calendar_event", "create_contact",
  "propose_appointment_slots", "cancel_calendar_event", "create_prospect",
];

export const AGENT_FILE_APPROBATION = "file-approbation";

const LISTES: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
  [PROFIL_ASSISTANT, new Set(OUTILS_ASSISTANT_UNIVERSEL)],
  ["agent-support", new Set(OUTILS_AGENT_SUPPORT)],
  ["agent-vente", new Set(OUTILS_AGENT_VENTE)],
  [AGENT_FILE_APPROBATION, new Set(OUTILS_FILE_APPROBATION)],
  ...PROFILS_METIER.map((p) => [p.id, new Set(p.outils)] as [string, ReadonlySet<string>]),
]);

const VIDE: ReadonlySet<string> = new Set();

/** Outils autorises pour un agent. Agent inconnu : aucun. */
export function outilsAutorises(agent: string): ReadonlySet<string> {
  return LISTES.get(agent) ?? VIDE;
}

/** Le controle unique, lu par `executeTool`. Refus par defaut. */
export function outilAutorisePourAgent(agent: string, outil: string): boolean {
  return outilsAutorises(agent).has(outil);
}

export function profilMetier(id: string): ProfilMetier | undefined {
  return PROFILS_METIER.find((p) => p.id === id);
}

export function estProfilMetier(id: string): id is IdProfilMetier {
  return PROFILS_METIER.some((p) => p.id === id);
}

/** Un role peut-il ouvrir une conversation sous ce profil ? */
export function roleAutorisePourProfil(profil: ProfilMetier, role: string | undefined): boolean {
  if (!profil.roles) return true;
  return !!role && profil.roles.includes(role);
}

/** Raison lisible d'un refus, inscrite dans le run / renvoyee au modele. */
export function raisonRefus(agent: string, outil: string): string {
  const nom = profilMetier(agent)?.nom ?? (agent === PROFIL_ASSISTANT ? "Assistant universel" : agent);
  return `Outil « ${outil} » hors du profil « ${nom} » : action refusee et non executee. Passez par le profil metier qui en a la charge.`;
}
