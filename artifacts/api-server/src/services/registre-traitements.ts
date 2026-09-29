/**
 * Registre des activites de traitement (RGPD art. 30), tenu par le code.
 *
 * Mesure du 28/09 : aucun registre n'existait. L'inventaire de
 * `GET /data-protection/summary` listait 11 categories ecrites a la main,
 * sans lien avec le schema : une quinzaine de categories reelles manquaient
 * (messagerie WhatsApp, IA conversationnelle, integrations, reconnaissance
 * faciale desactivee...), et rien n'empechait d'en oublier une nouvelle.
 *
 * DEUX REGLES :
 *
 * 1. Chaque table de locataire est rattachee a une activite, par un type sur
 *    `TENANT_TABLES` (compare lui-meme au schema par
 *    tenant-backup-coverage.test.ts). Une table ajoutee sans activite ne
 *    compile pas.
 *
 * 2. La duree ANNONCEE et la duree APPLIQUEE sont deux champs. L'inventaire
 *    affichait « Appels : 3 ans », « Contacts : 5 ans » — des reperes que rien
 *    n'appliquait. Pour les donnees du client, c'est LUI, responsable de
 *    traitement, qui fixe la duree ; la plateforme, sous-traitante, n'efface
 *    pas de sa propre initiative (DPA : elle agit sur instruction). Le registre
 *    dit donc le repere, et separement ce que la plateforme efface vraiment,
 *    avec la source de cette affirmation.
 */
import { TENANT_TABLES, EXCLUDED_TABLES } from "./tenant-backup";
import { SECURITY_SCAN_RETENTION_DAYS } from "./security-scans";
import { RETENTION_DAYS as GEOLOC_RETENTION_DAYS } from "./location-cleanup-cron";
import { DELAI_EXPORT_JOURS, DESTIN_DES_TABLES, modeEffacement } from "./purge-fin-contrat";

type TableLocataire = (typeof TENANT_TABLES)[number] | keyof typeof EXCLUDED_TABLES;

export type IdActivite =
  | "comptes" | "relation_client" | "telephonie" | "prospection" | "activite"
  | "facturation" | "pointage" | "geolocalisation" | "reconnaissance_faciale"
  | "evaluation_salaries" | "assistance_ia" | "securite" | "integrations"
  | "droits_personnes" | "abonnement" | "technique";

export interface Activite {
  nom: string;
  finalite: string;
  /** L'editeur est sous-traitant pour les donnees du client, responsable pour les siennes. */
  roleEditeur: "sous-traitant" | "responsable";
  personnes: string;
  donnees: string;
  baseLegale: string;
  /** Repere de duree : fixe par le responsable de traitement. */
  dureeAnnoncee: string;
  /** Ce que la plateforme efface d'elle-meme, et la source. `null` : rien. */
  appliquee: string | null;
  destinataires: string;
  sensible: boolean;
  /** Etat particulier (fonction desactivee...). */
  statut?: string;
}

const FIN_DE_CONTRAT = `Effacement ${DELAI_EXPORT_JOURS} jours apres la fin du contrat (DPA art. 8, services/purge-fin-contrat.ts)`;
const SOUS_TRAITANTS_HEBERGEMENT = "Utilisateurs habilites du client ; hebergement Google Cloud (UE)";
const SOUS_TRAITANTS_IA = "Fournisseurs de modeles d'IA (Google, OpenAI, Anthropic) selon la configuration ; clauses types pour les transferts hors UE";

/** L'effacement de fin de contrat, dit tel qu'il est aujourd'hui. */
function finDeContrat(): string {
  return modeEffacement() === "effacer"
    ? FIN_DE_CONTRAT
    : `${FIN_DE_CONTRAT} — en cours d'activation : calcule chaque jour, pas encore execute`;
}

export function activites(): Record<IdActivite, Activite> {
  return {
    comptes: {
      nom: "Comptes et acces", finalite: "Ouvrir et securiser l'acces des collaborateurs a l'espace de travail",
      roleEditeur: "sous-traitant", personnes: "Collaborateurs du client",
      donnees: "Nom, prenom, e-mail, telephone, role, empreinte du mot de passe, second facteur, jetons d'appareil, acceptation des conditions",
      baseLegale: "Execution du contrat (art. 6(1)(b))", dureeAnnoncee: "Duree du contrat + 3 ans",
      appliquee: "Anonymisation 3 ans apres la resiliation (services/account-retention-cron.ts)",
      destinataires: SOUS_TRAITANTS_HEBERGEMENT, sensible: false,
    },
    relation_client: {
      nom: "Relation client et messagerie", finalite: "Tenir le fichier clients, echanger avec eux (messages, WhatsApp, SMS), planifier les rendez-vous",
      roleEditeur: "sous-traitant", personnes: "Clients et contacts du client",
      donnees: "Identite, coordonnees, historique des echanges, contenu des messages, rendez-vous",
      baseLegale: "Execution du contrat ou interet legitime (art. 6(1)(b)/(f)), selon la relation",
      dureeAnnoncee: "Fixee par le client — repere CNIL : 3 ans apres le dernier contact pour un prospect, duree de la relation + prescription pour un client",
      appliquee: null, destinataires: `${SOUS_TRAITANTS_HEBERGEMENT} ; Twilio (SMS, WhatsApp), Resend (e-mail)`, sensible: false,
    },
    telephonie: {
      nom: "Appels et secretaire telephonique", finalite: "Recevoir et passer les appels, repondre par la secretaire IA, prendre rendez-vous et messages",
      roleEditeur: "sous-traitant", personnes: "Appelants, clients et contacts du client",
      donnees: "Numero, duree, notes, resume, transcription, enregistrement lorsqu'il est active",
      baseLegale: "Execution du contrat ou interet legitime (art. 6(1)(b)/(f)) ; information de l'appelant que la secretaire est une IA (AI Act art. 50)",
      dureeAnnoncee: "Enregistrements et transcriptions : 12 mois ; fiche d'appel : fixee par le client",
      appliquee: "Transcriptions et enregistrements effaces a 12 mois, dans toutes leurs copies (services/retention-cron.ts, purge-transcriptions.ts)",
      destinataires: `${SOUS_TRAITANTS_HEBERGEMENT} ; Twilio (telephonie) ; ${SOUS_TRAITANTS_IA}`, sensible: false,
    },
    prospection: {
      nom: "Prospection commerciale", finalite: "Suivre les prospects et les objectifs commerciaux",
      roleEditeur: "sous-traitant", personnes: "Prospects du client",
      donnees: "Identite, entreprise, coordonnees, etape de prospection", baseLegale: "Interet legitime (art. 6(1)(f))",
      dureeAnnoncee: "Fixee par le client — repere CNIL : 3 ans apres le dernier contact", appliquee: null,
      destinataires: SOUS_TRAITANTS_HEBERGEMENT, sensible: false,
    },
    activite: {
      nom: "Gestion de l'activite", finalite: "Taches, projets, documents, notes, stocks, commandes, automatisations",
      roleEditeur: "sous-traitant", personnes: "Collaborateurs, clients et fournisseurs du client",
      donnees: "Contenus saisis ou deposes par le client, auteurs, affectations", baseLegale: "Execution du contrat (art. 6(1)(b))",
      dureeAnnoncee: "Fixee par le client", appliquee: "Corbeille videe a 30 jours (services/trash.ts)",
      destinataires: SOUS_TRAITANTS_HEBERGEMENT, sensible: false,
    },
    facturation: {
      nom: "Facturation et comptabilite du client", finalite: "Devis, factures, encaissements, depenses, relances, transmission aux plateformes de facturation",
      roleEditeur: "sous-traitant", personnes: "Clients et fournisseurs du client",
      donnees: "Identite, adresse, montants, moyens de paiement references, historique de relance",
      baseLegale: "Obligation legale (art. 6(1)(c)) : C. com. L123-22, CGI 286-I-3° bis",
      dureeAnnoncee: "10 ans (obligation comptable)", appliquee: "Conservees 10 ans, y compris apres la fin du contrat (services/purge-fin-contrat.ts)",
      destinataires: `${SOUS_TRAITANTS_HEBERGEMENT} ; plateforme agreee ou Chorus Pro choisie par le client`, sensible: false,
    },
    pointage: {
      nom: "Pointage et presence", finalite: "Enregistrer les heures d'arrivee et de depart, les absences et fermetures",
      roleEditeur: "sous-traitant", personnes: "Collaborateurs du client",
      donnees: "Heures, statut de presence, commentaire", baseLegale: "Obligation legale (art. 6(1)(c)) — decompte du temps de travail",
      dureeAnnoncee: "Fixee par le client — repere : 5 ans (prescription des salaires)", appliquee: null,
      destinataires: SOUS_TRAITANTS_HEBERGEMENT, sensible: false,
    },
    geolocalisation: {
      nom: "Presence sur zone", finalite: "Constater l'entree et la sortie des zones de travail pendant les horaires definis",
      roleEditeur: "sous-traitant", personnes: "Collaborateurs du client ayant active la fonction",
      donnees: "Zone, heure, batterie — coordonnees GPS utilisees pour le calcul puis non conservees",
      baseLegale: "Interet legitime (art. 6(1)(f)) — sous reserve de consultation du CSE (L2312-38) et d'information prealable (L1222-4)",
      dureeAnnoncee: `${GEOLOC_RETENTION_DAYS} jours`, appliquee: `Effacement a ${GEOLOC_RETENTION_DAYS} jours (services/location-cleanup-cron.ts)`,
      destinataires: `${SOUS_TRAITANTS_HEBERGEMENT} ; OpenStreetMap Nominatim (zone -> adresse)`, sensible: true,
    },
    reconnaissance_faciale: {
      nom: "Reconnaissance faciale", finalite: "Aucune : fonction desactivee",
      roleEditeur: "sous-traitant", personnes: "Collaborateurs enroles avant le 05/09/2026",
      donnees: "Gabarits de visage (donnee biometrique, art. 9) et journal de reconnaissance",
      baseLegale: "Aucune retenue : route debranchee faute de base au titre de l'art. 9(2) (routes/index.ts)",
      dureeAnnoncee: "Aucune collecte", appliquee: null, destinataires: "Aucun", sensible: true,
      statut: "Desactivee depuis le 05/09/2026 — les gabarits deja enregistres restent en base tant qu'ils ne sont pas effaces",
    },
    evaluation_salaries: {
      nom: "Evaluation automatisee de l'activite des salaries", finalite: "Aide a la decision du responsable : rapports d'equipe et rapports individuels",
      roleEditeur: "sous-traitant", personnes: "Collaborateurs du client",
      donnees: "Nom, role, service, volumes d'activite, heures et pauses, score, diagnostic individuel",
      baseLegale: "Interet legitime (art. 6(1)(f)) — CSE (L2312-38), information prealable (L1222-4), AIPD ; aucune decision fondee sur le seul traitement automatise (art. 22)",
      dureeAnnoncee: "Duree du contrat", appliquee: null, destinataires: `${SOUS_TRAITANTS_HEBERGEMENT} ; ${SOUS_TRAITANTS_IA} (sous pseudonyme)`,
      sensible: true, statut: "Systeme d'IA vraisemblablement a haut risque (AI Act, annexe III 4 b) : voir le registre IA",
    },
    assistance_ia: {
      nom: "Assistants et agents IA", finalite: "Repondre aux questions des collaborateurs, classer les demandes entrantes, rediger des brouillons, proposer des actions",
      roleEditeur: "sous-traitant", personnes: "Collaborateurs du client ; expediteurs des demandes traitees",
      donnees: "Conversations, extraits de demandes, brouillons, preferences apprises, consommation",
      baseLegale: "Execution du contrat (art. 6(1)(b))", dureeAnnoncee: "180 jours pour la consommation et les executions d'agents",
      appliquee: "Consommation et executions d'agents effacees a 180 jours (services/ai-utils.ts, journal-agents.ts)",
      destinataires: `${SOUS_TRAITANTS_HEBERGEMENT} ; ${SOUS_TRAITANTS_IA}`, sensible: false,
    },
    securite: {
      nom: "Securite et journal d'audit", finalite: "Tracer les actions sensibles, analyser les fichiers entrants, detecter les abus",
      roleEditeur: "responsable", personnes: "Collaborateurs du client ; expediteurs de fichiers analyses",
      donnees: "Identifiant, e-mail, adresse IP, navigateur, action ; fichier ou adresse analyse et verdict",
      baseLegale: "Interet legitime — securite des systemes (art. 6(1)(f), cons. 49)",
      dureeAnnoncee: `Journal d'audit : permanent et inalterable ; analyses : ${SECURITY_SCAN_RETENTION_DAYS} jours`,
      appliquee: `Analyses effacees a ${SECURITY_SCAN_RETENTION_DAYS} jours (services/security-scans.ts) ; journal d'audit conserve`,
      destinataires: SOUS_TRAITANTS_HEBERGEMENT, sensible: false,
    },
    integrations: {
      nom: "Connexions aux outils du client", finalite: "Synchroniser avec les services que le client connecte (webhooks, plateformes)",
      roleEditeur: "sous-traitant", personnes: "Personnes figurant dans les donnees synchronisees",
      donnees: "Charges utiles transmises aux adresses configurees par le client, journaux de synchronisation",
      baseLegale: "Execution du contrat (art. 6(1)(b)) — sur instruction du client", dureeAnnoncee: "Fixee par le client",
      appliquee: null, destinataires: "Destinataires configures par le client", sensible: false,
    },
    droits_personnes: {
      nom: "Demandes d'exercice des droits et violations", finalite: "Instruire les demandes RGPD et documenter les violations de donnees",
      roleEditeur: "sous-traitant", personnes: "Demandeurs ; personnes concernees par une violation",
      donnees: "Identite du demandeur, nature de la demande, traitement ; description de la violation",
      baseLegale: "Obligation legale (art. 6(1)(c)) — art. 12 a 22, art. 33.5", dureeAnnoncee: "Fixee par le client ; registre des violations : conserve",
      appliquee: null, destinataires: SOUS_TRAITANTS_HEBERGEMENT, sensible: false,
    },
    abonnement: {
      nom: "Abonnement et facturation de l'editeur", finalite: "Facturer l'abonnement, suivre les licences",
      roleEditeur: "responsable", personnes: "Representant du client",
      donnees: "Raison sociale, contact de facturation, factures, paiements, evenements de licence",
      baseLegale: "Execution du contrat et obligation legale (art. 6(1)(b)/(c))", dureeAnnoncee: "10 ans (obligation comptable)",
      appliquee: "Conservees 10 ans (services/purge-fin-contrat.ts)", destinataires: "Stripe (paiement) ; Google Cloud (UE)", sensible: false,
    },
    technique: {
      nom: "Parametres techniques", finalite: "Raccorder les fournisseurs (e-mail, telephonie, IA), sauvegarder",
      roleEditeur: "sous-traitant", personnes: "Aucune directement",
      donnees: "Identifiants chiffres de fournisseurs ; sauvegardes (copie de l'ensemble des donnees)",
      baseLegale: "Execution du contrat (art. 6(1)(b))", dureeAnnoncee: "Sauvegardes : 14 par organisation, 60 jours au plus",
      appliquee: "Sauvegardes limitees a 14 et a 60 jours (services/tenant-backup.ts)", destinataires: "Google Cloud (UE)", sensible: false,
    },
  };
}

/** Le rattachement de chaque table, verifie par le compilateur. */
export const ACTIVITE_DES_TABLES: Record<TableLocataire, IdActivite> = {
  users: "comptes", invitations: "comptes", push_tokens: "comptes", api_keys: "comptes",
  google_oauth_tokens: "comptes", legal_agreements: "comptes",
  contacts: "relation_client", messages: "relation_client", whatsapp_conversations: "relation_client",
  whatsapp_messages: "relation_client", whatsapp_processed_messages: "relation_client",
  telephony_sms_logs: "relation_client", calendar_events: "relation_client", appointment_offers: "relation_client",
  notifications: "relation_client", demo_handoffs: "relation_client",
  calls: "telephonie", telephony_call_logs: "telephonie", voice_call_sessions: "telephonie",
  prospects: "prospection", objectifs_commerciaux: "prospection",
  tasks: "activite", projets: "activite", notes_internes: "activite", documents: "activite",
  document_chunks: "activite", deleted_rows: "activite", automation_rules: "activite",
  commandes_fournisseur: "activite", stock_articles: "activite", stock_mouvements: "activite",
  daily_reports: "activite", admin_reports: "activite",
  devis: "facturation", factures_client: "facturation", encaissements: "facturation",
  clotures_comptables: "facturation", invoice_sequences: "facturation", compte_client: "facturation",
  depenses: "facturation", comptes_depense: "facturation", payment_reminders: "facturation",
  treasury_settings: "facturation", plateformes_agreees: "facturation", raccordements_chorus_pro: "facturation",
  checkins: "pointage", organisation_closures: "pointage",
  location_events: "geolocalisation", user_location_state: "geolocalisation", geofences: "geolocalisation",
  face_profiles: "reconnaissance_faciale", face_recognition_logs: "reconnaissance_faciale",
  performance_reports: "evaluation_salaries", ai_agent_reports: "evaluation_salaries",
  assistant_conversations: "assistance_ia", assistant_messages: "assistance_ia",
  commandant_conversations: "assistance_ia", commandant_messages: "assistance_ia", ai_usage: "assistance_ia",
  ai_insights: "assistance_ia", ai_learned_preferences: "assistance_ia", ai_recurring_patterns: "assistance_ia",
  ai_user_profile_facts: "assistance_ia", ai_inline_suggest_events: "assistance_ia", agent_runs: "assistance_ia",
  agent_run_steps: "assistance_ia", agent_proposals: "assistance_ia", proactive_suggestions: "assistance_ia",
  super_agent_state: "assistance_ia", super_agent_logs: "assistance_ia",
  audit_logs: "securite", security_scans: "securite", security_lists: "securite", app_audit_findings: "securite",
  bulk_scan_jobs: "securite",
  webhook_endpoints: "integrations", webhook_deliveries: "integrations", integration_connections: "integrations",
  platform_connections: "integrations", platform_sync_logs: "integrations",
  data_subject_requests: "droits_personnes", violations_donnees: "droits_personnes",
  subscriptions: "abonnement", invoices: "abonnement", payments: "abonnement", license_audit_log: "abonnement",
  email_providers: "technique", telephony_providers: "technique", ai_providers: "technique",
  google_app_credentials: "technique", organisation_backups: "technique",
};

export interface LigneRegistre extends Activite { id: IdActivite; tables: string[] }

/**
 * Le registre, activite par activite, avec les tables qu'elle couvre.
 *
 * L'effacement de fin de contrat n'est pas ecrit ici a la main : il est lu
 * dans `DESTIN_DES_TABLES`, ce que la purge applique vraiment. Si toutes les
 * tables de l'activite sont effacees, on le dit ; si certaines seulement, on
 * nomme lesquelles. Les deux fichiers ne peuvent donc pas se contredire.
 */
export function registre(): LigneRegistre[] {
  const acts = activites();
  return (Object.keys(acts) as IdActivite[]).map((id) => {
    const tables = Object.entries(ACTIVITE_DES_TABLES).filter(([, a]) => a === id).map(([t]) => t).sort();
    const effacees = tables.filter((t) => DESTIN_DES_TABLES[t as TableLocataire] === "effacer");
    const fin = effacees.length === 0 ? null
      : effacees.length === tables.length ? finDeContrat()
      : `${finDeContrat()} — pour : ${effacees.join(", ")}`;
    return { id, ...acts[id], appliquee: [acts[id].appliquee, fin].filter(Boolean).join(" ; ") || null, tables };
  });
}
