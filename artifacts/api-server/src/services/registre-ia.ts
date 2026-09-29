/**
 * Registre des systemes d'IA du produit, et leur classement au sens du
 * reglement (UE) 2024/1689 (AI Act).
 *
 * Mesure du 28/09 : le classement n'existait que pour l'evaluation des
 * salaries (docs/conformite-ia). Les autres usages — secretaire telephonique,
 * assistants, agents, tri des e-mails, analyse de documents... — n'etaient
 * classes nulle part, alors que l'article 50 (transparence) s'applique depuis
 * le 2 aout 2026.
 *
 * Chaque fichier du depot qui appelle un modele doit appartenir a une entree :
 * registre-ia.test.ts releve ces fichiers dans le code et echoue si l'un
 * d'eux n'est rattache a rien. Une nouvelle fonction d'IA ne peut donc pas
 * entrer sans que quelqu'un ecrive son classement.
 *
 * Le classement est une lecture technique, pas un avis juridique : il dit ce
 * que fait le systeme et quelle obligation il declenche vraisemblablement.
 * Quand l'obligation n'a pas ete verifiee dans le code, `tenue` le dit.
 */

export type Classe =
  | "interdit"          // art. 5
  | "haut_risque"       // art. 6 et annexe III
  | "transparence"      // art. 50 : interagit avec des personnes ou genere du contenu
  | "risque_minimal"
  | "infrastructure";   // aucun usage propre : appele par les autres

export interface SystemeIA {
  nom: string;
  usage: string;
  classe: Classe;
  /** L'obligation principale declenchee, avec l'article. */
  obligation: string;
  /** Comment elle est tenue dans le produit, ou « non verifie ». */
  tenue: string;
  personnesExposees: string;
  /** Fichiers qui appellent un modele pour ce systeme (relatifs a src/). */
  fichiers: string[];
}

export const REGISTRE_IA: Record<string, SystemeIA> = {
  secretaire_telephonique: {
    nom: "Secretaire telephonique IA", usage: "Repond aux appels, prend rendez-vous et messages, transfere",
    classe: "transparence",
    obligation: "Art. 50(1) : informer l'appelant qu'il parle a une IA",
    tenue: "Annonce en debut d'appel dans la langue de l'appel (ANNONCE_IA, routes/voice-receptionist.ts ; test annonce-ia-au-telephone)",
    personnesExposees: "Appelants du client (tiers)",
    fichiers: ["routes/voice-receptionist.ts", "services/call-processor.ts", "routes/calls.ts"],
  },
  demo_publique: {
    nom: "Agent de demonstration du site", usage: "Converse avec les visiteurs du site vitrine",
    classe: "transparence", obligation: "Art. 50(1) : le visiteur doit savoir qu'il parle a une IA",
    tenue: "Libelle « Assistant IA » et mention sous le champ (AjanDemo.tsx ; test AjanDemo.a11y)",
    personnesExposees: "Visiteurs du site", fichiers: ["routes/public-demo-chat.ts"],
  },
  assistants: {
    nom: "Assistant et commandant", usage: "Repond aux questions des collaborateurs, execute des actions apres confirmation",
    classe: "transparence", obligation: "Art. 50(1) : caractere IA evident pour l'utilisateur de l'outil",
    tenue: "Presente comme assistant IA dans l'interface ; actions sensibles soumises a confirmation (services/assistant-engine.ts)",
    personnesExposees: "Collaborateurs du client",
    fichiers: ["services/assistant-engine.ts", "routes/ai-commandant.ts", "routes/voice-command.ts", "routes/voice-site-ops.ts", "routes/ai-inline-suggest.ts"],
  },
  agents_demandes: {
    nom: "Agents de traitement des demandes", usage: "Classent les demandes entrantes (e-mail, WhatsApp, formulaire) et redigent des brouillons",
    classe: "risque_minimal",
    obligation: "Aucune obligation propre tant qu'un humain valide l'envoi ; art. 50(1) si une reponse part sans relecture",
    tenue: "Envoi externe soumis a la file d'approbation (services/proposal-queue.ts) — envoi automatique sans relecture : non verifie pour chaque canal",
    personnesExposees: "Expediteurs des demandes (tiers)",
    fichiers: ["services/orchestrateur.ts", "services/autonomous-inbox.ts", "services/autonomous-secretary.ts", "services/support-inbox.ts", "services/whatsapp-inbox.ts", "routes/gmail.ts", "routes/ai-agents.ts"],
  },
  evaluation_salaries: {
    nom: "Evaluation de l'activite des salaries", usage: "Rapports d'equipe et individuels : scores, diagnostics, recommandations",
    classe: "haut_risque",
    obligation: "Annexe III 4 b : surveiller et evaluer la performance au travail. Obligations du deployeur a compter du 2/12/2027 (art. 26) ; RGPD art. 22 des maintenant",
    tenue: "Dossier technique, registre des risques et notice (docs/conformite-ia) ; pseudonymisation avant envoi au modele ; aucune decision automatique ; traces d'audit",
    personnesExposees: "Collaborateurs du client",
    fichiers: ["routes/workforce-agent.ts", "routes/workforce-intelligence.ts", "services/performance-analyzer.ts"],
  },
  analyse_documents: {
    nom: "Analyse de documents et de donnees", usage: "Extrait les informations des pieces deposees, analyse des chiffres, rapports",
    classe: "risque_minimal", obligation: "Aucune obligation propre (usage interne, relu par l'utilisateur)",
    tenue: "Contenu du document delimite comme donnee non fiable dans le prompt (delimitUntrusted)",
    personnesExposees: "Personnes citees dans les documents",
    fichiers: ["services/document-ai.ts", "routes/ai-analysis.ts", "services/math-engine.ts", "services/knowledge-base.ts", "services/web-search.ts", "routes/integrations.ts", "routes/workspace.ts"],
  },
  suggestions: {
    nom: "Suggestions et syntheses", usage: "Insights, resume quotidien, audit automatique de l'application",
    classe: "risque_minimal", obligation: "Aucune obligation propre",
    tenue: "Suggestions affichees, jamais executees sans action de l'utilisateur", personnesExposees: "Collaborateurs du client",
    fichiers: ["services/ai-insights.ts", "routes/daily-digest.ts", "services/app-audit.ts"],
  },
  reconnaissance_faciale: {
    nom: "Reconnaissance faciale (desactivee)", usage: "Aucun : route debranchee le 05/09/2026",
    classe: "haut_risque",
    obligation: "Identification biometrique : annexe III 1 ; RGPD art. 9 — aucune base retenue",
    tenue: "Route non montee (routes/index.ts) ; ne pas remonter sans les quatre conditions ecrites a cet endroit",
    personnesExposees: "Aucune tant que desactivee", fichiers: ["routes/face-recognition.ts"],
  },
  infrastructure: {
    nom: "Acces aux modeles", usage: "Choix du fournisseur, bascule en cas d'echec, flux, cles du client",
    classe: "infrastructure", obligation: "Aucune en propre : porte les obligations des systemes qui l'appellent",
    tenue: "—", personnesExposees: "—",
    fichiers: ["services/ai-client.ts", "services/ai-failover.ts", "services/ai-providers.ts", "services/ai-stream.ts", "routes/ai-providers.ts"],
  },
};

/**
 * Ce que le classement ne retient PAS, et pourquoi — pour qu'on ne le
 * redemande pas a chaque relecture.
 */
export const EXCLUSIONS_EXAMINEES = [
  "Reconnaissance des emotions au travail (art. 5(1)(f), interdite) : l'analyse de sentiment des appels porte sur le TEXTE transcrit, pas sur la voix ; ce n'est pas un systeme de reconnaissance des emotions au sens de l'art. 3(39), qui suppose des donnees biometriques.",
  "Evaluation de solvabilite (annexe III 5 b) : le niveau de risque du compte client est calcule par des regles fixes, sans modele d'IA.",
];
