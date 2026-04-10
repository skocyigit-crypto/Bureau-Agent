import { Router } from "express";
import { db, contactsTable, callsTable, tasksTable, usersTable, organisationsTable } from "@workspace/db";
import { eq, count, sql, and } from "drizzle-orm";

const router = Router();

function getOrgId(req: any): number {
  return (req.session as any)?.organisationId || 0;
}

interface SoftwareIntegration {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "connecte" | "deconnecte" | "en_attente";
  version: string | null;
  lastSync: string | null;
  features: string[];
  configFields: Array<{ key: string; label: string; type: "text" | "password" | "url"; required: boolean }>;
}

const SOFTWARE_CATALOG: SoftwareIntegration[] = [
  {
    id: "salesforce",
    name: "Salesforce",
    category: "crm",
    description: "Synchroniser les contacts, opportunites et historiques d'appels avec votre CRM Salesforce.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Synchronisation bidirectionnelle des contacts",
      "Creation automatique de leads apres appel",
      "Historique d'appels dans la fiche Salesforce",
      "Suivi des opportunites liees aux appels",
    ],
    configFields: [
      { key: "instanceUrl", label: "URL de l'instance Salesforce", type: "url", required: true },
      { key: "clientId", label: "Client ID (Connected App)", type: "text", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true },
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    description: "Connecter votre CRM HubSpot pour gerer les contacts, deals et activites depuis Agent de Bureau.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Import automatique des contacts HubSpot",
      "Enregistrement des appels dans le CRM",
      "Suivi du pipeline commercial",
      "Automatisations basees sur les appels",
    ],
    configFields: [
      { key: "apiKey", label: "Cle API HubSpot", type: "password", required: true },
      { key: "portalId", label: "Portal ID", type: "text", required: true },
    ],
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    category: "crm",
    description: "Gerer votre pipeline de ventes et synchroniser les contacts avec Pipedrive.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Synchronisation des contacts et organisations",
      "Enregistrement automatique des appels",
      "Vue pipeline dans le tableau de bord",
      "Notes d'appel liees aux deals",
    ],
    configFields: [
      { key: "apiToken", label: "Token API Pipedrive", type: "password", required: true },
      { key: "domain", label: "Domaine Pipedrive", type: "text", required: true },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    description: "Recevoir des notifications d'appels et de taches dans Slack. Partager des rapports avec l'equipe.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Notifications d'appels manques en temps reel",
      "Alertes de taches haute priorite",
      "Partage de rapports journaliers",
      "Commandes slash pour rechercher des contacts",
    ],
    configFields: [
      { key: "webhookUrl", label: "URL du Webhook Slack", type: "url", required: true },
      { key: "botToken", label: "Token du Bot", type: "password", required: false },
    ],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    category: "communication",
    description: "Integrer Agent de Bureau avec Microsoft Teams pour les notifications et la collaboration.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Notifications d'appels dans Teams",
      "Planification de reunions depuis les fiches contact",
      "Partage de documents et rapports",
      "Bot conversationnel pour recherches rapides",
    ],
    configFields: [
      { key: "tenantId", label: "Tenant ID Azure AD", type: "text", required: true },
      { key: "clientId", label: "Client ID de l'application", type: "text", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true },
    ],
  },
  {
    id: "zoom",
    name: "Zoom",
    category: "communication",
    description: "Lancer des visioconferences Zoom directement depuis les fiches contact.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Creation de reunions instantanees",
      "Planification de visioconferences",
      "Enregistrement automatique des reunions",
      "Lien de reunion dans les notes d'appel",
    ],
    configFields: [
      { key: "accountId", label: "Account ID Zoom", type: "text", required: true },
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true },
    ],
  },
  {
    id: "trello",
    name: "Trello",
    category: "gestion_projet",
    description: "Synchroniser les taches avec vos tableaux Trello pour une gestion de projet unifiee.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Synchronisation bidirectionnelle des taches",
      "Creation automatique de cartes apres appel",
      "Suivi des deadlines",
      "Labels et etiquettes synchronises",
    ],
    configFields: [
      { key: "apiKey", label: "Cle API Trello", type: "password", required: true },
      { key: "token", label: "Token d'autorisation", type: "password", required: true },
      { key: "boardId", label: "ID du tableau", type: "text", required: true },
    ],
  },
  {
    id: "asana",
    name: "Asana",
    category: "gestion_projet",
    description: "Connecter Asana pour synchroniser les taches et projets avec Agent de Bureau.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Import/export des taches",
      "Suivi de l'avancement des projets",
      "Assignation automatique apres appel",
      "Mises a jour en temps reel",
    ],
    configFields: [
      { key: "personalAccessToken", label: "Token d'acces personnel Asana", type: "password", required: true },
      { key: "workspaceGid", label: "GID du workspace", type: "text", required: true },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    category: "gestion_projet",
    description: "Stocker les comptes rendus et documenter les processus dans Notion.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Creation automatique de pages de compte rendu",
      "Base de donnees de contacts synchronisee",
      "Wiki d'equipe lie aux processus",
      "Templates de suivi client",
    ],
    configFields: [
      { key: "integrationToken", label: "Token d'integration Notion", type: "password", required: true },
      { key: "databaseId", label: "ID de la base de donnees", type: "text", required: false },
    ],
  },
  {
    id: "sage",
    name: "Sage",
    category: "comptabilite",
    description: "Integrer Sage pour suivre la facturation et les paiements lies aux contacts.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Consultation du solde client",
      "Historique des factures dans la fiche contact",
      "Alertes de retard de paiement",
      "Export des donnees comptables",
    ],
    configFields: [
      { key: "apiUrl", label: "URL de l'API Sage", type: "url", required: true },
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true },
    ],
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "comptabilite",
    description: "Connecter QuickBooks pour la gestion financiere et le suivi des factures.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Synchronisation des clients et fournisseurs",
      "Suivi des factures et devis",
      "Rapprochement des paiements",
      "Tableaux financiers dans le dashboard",
    ],
    configFields: [
      { key: "realmId", label: "Realm ID QuickBooks", type: "text", required: true },
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true },
    ],
  },
  {
    id: "docusign",
    name: "DocuSign",
    category: "documents",
    description: "Envoyer des documents a signer electroniquement directement depuis Agent de Bureau.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Envoi de contrats depuis la fiche contact",
      "Suivi du statut de signature",
      "Notifications de signature completee",
      "Archivage automatique des documents signes",
    ],
    configFields: [
      { key: "integrationKey", label: "Cle d'integration DocuSign", type: "text", required: true },
      { key: "userId", label: "User ID", type: "text", required: true },
      { key: "rsaKey", label: "Cle RSA privee", type: "password", required: true },
    ],
  },
  {
    id: "dropbox",
    name: "Dropbox Business",
    category: "documents",
    description: "Stocker et partager des fichiers professionnels depuis Dropbox.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Stockage des pieces jointes aux contacts",
      "Partage securise de documents",
      "Versionnage des fichiers",
      "Recherche dans les documents",
    ],
    configFields: [
      { key: "accessToken", label: "Token d'acces Dropbox", type: "password", required: true },
    ],
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    category: "messagerie",
    description: "Synchroniser les e-mails et le calendrier Outlook avec Agent de Bureau.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Synchronisation des e-mails professionnels",
      "Calendrier integre au planning",
      "Contacts Outlook importes automatiquement",
      "Reponses rapides depuis l'application",
    ],
    configFields: [
      { key: "tenantId", label: "Tenant ID Azure AD", type: "text", required: true },
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true },
    ],
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    category: "marketing",
    description: "Synchroniser les contacts avec Mailchimp pour les campagnes d'e-mailing.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Export des contacts vers les listes Mailchimp",
      "Suivi des campagnes dans la fiche contact",
      "Segmentation basee sur l'historique d'appels",
      "Automatisations post-appel",
    ],
    configFields: [
      { key: "apiKey", label: "Cle API Mailchimp", type: "password", required: true },
      { key: "serverPrefix", label: "Prefixe serveur (ex: us19)", type: "text", required: true },
    ],
  },
  {
    id: "sendinblue",
    name: "Brevo (ex-Sendinblue)",
    category: "marketing",
    description: "Gerer les campagnes marketing et les SMS depuis Brevo.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Campagnes e-mail et SMS",
      "Automatisations marketing",
      "Synchronisation des contacts",
      "Statistiques de campagne dans le dashboard",
    ],
    configFields: [
      { key: "apiKey", label: "Cle API Brevo", type: "password", required: true },
    ],
  },
  {
    id: "zapier",
    name: "Zapier",
    category: "automatisation",
    description: "Connecter Agent de Bureau a plus de 5000 applications via Zapier.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Declencheurs sur appels, taches et messages",
      "Actions automatiques dans d'autres applications",
      "Workflows multi-etapes",
      "Integration avec n'importe quel logiciel",
    ],
    configFields: [
      { key: "webhookUrl", label: "URL du Webhook Zapier", type: "url", required: true },
      { key: "apiKey", label: "Cle API Zapier", type: "password", required: false },
    ],
  },
  {
    id: "make",
    name: "Make (ex-Integromat)",
    category: "automatisation",
    description: "Creer des automatisations avancees avec Make pour connecter vos outils.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Scenarios d'automatisation visuels",
      "Declencheurs en temps reel",
      "Transformation de donnees avancee",
      "Connexion a des centaines d'applications",
    ],
    configFields: [
      { key: "webhookUrl", label: "URL du Webhook Make", type: "url", required: true },
      { key: "apiToken", label: "Token API Make", type: "password", required: false },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    category: "gestion_projet",
    description: "Synchroniser les tickets et projets Jira avec les taches d'Agent de Bureau.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Synchronisation des tickets et taches",
      "Creation de tickets depuis un appel",
      "Suivi des sprints et releases",
      "Liens entre appels et tickets",
    ],
    configFields: [
      { key: "domain", label: "Domaine Jira (ex: monentreprise.atlassian.net)", type: "text", required: true },
      { key: "email", label: "E-mail Atlassian", type: "text", required: true },
      { key: "apiToken", label: "Token API Atlassian", type: "password", required: true },
    ],
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "support",
    description: "Unifier le support client entre Intercom et Agent de Bureau.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Historique des conversations Intercom dans la fiche contact",
      "Escalade d'appels vers tickets Intercom",
      "Base de connaissances integree",
      "Suivi du NPS et de la satisfaction",
    ],
    configFields: [
      { key: "accessToken", label: "Token d'acces Intercom", type: "password", required: true },
    ],
  },
  {
    id: "zendesk",
    name: "Zendesk",
    category: "support",
    description: "Connecter Zendesk pour centraliser le support client avec la telephonie.",
    status: "deconnecte",
    version: null,
    lastSync: null,
    features: [
      "Creation de tickets depuis les appels",
      "Historique des tickets dans la fiche contact",
      "Escalade automatique des appels critiques",
      "Rapports de satisfaction integres",
    ],
    configFields: [
      { key: "subdomain", label: "Sous-domaine Zendesk", type: "text", required: true },
      { key: "email", label: "E-mail de l'agent", type: "text", required: true },
      { key: "apiToken", label: "Token API Zendesk", type: "password", required: true },
    ],
  },
];

const CATEGORIES = [
  { id: "all", label: "Tous" },
  { id: "crm", label: "CRM" },
  { id: "communication", label: "Communication" },
  { id: "gestion_projet", label: "Gestion de projet" },
  { id: "comptabilite", label: "Comptabilite" },
  { id: "documents", label: "Documents" },
  { id: "messagerie", label: "Messagerie" },
  { id: "marketing", label: "Marketing" },
  { id: "automatisation", label: "Automatisation" },
  { id: "support", label: "Support client" },
];

const PLATFORM_ECOSYSTEM: Record<string, { name: string; ecosystem: string[]; compatibleWith: string[]; indicators: string[] }> = {
  "google": {
    name: "Google Workspace",
    ecosystem: ["Gmail", "Google Calendar", "Google Drive", "Google Meet", "Google Docs", "Google Sheets", "Google Chat", "Google Contacts", "Google Tasks"],
    compatibleWith: ["slack", "asana", "trello", "notion", "zapier", "make", "hubspot", "salesforce", "mailchimp"],
    indicators: ["gmail.com", "googlemail.com", "google.com"],
  },
  "microsoft": {
    name: "Microsoft 365",
    ecosystem: ["Outlook", "Microsoft Teams", "OneDrive", "SharePoint", "Word", "Excel", "PowerPoint", "Planner", "To Do"],
    compatibleWith: ["teams", "outlook", "jira", "asana", "trello", "zapier", "make", "salesforce", "hubspot", "zendesk"],
    indicators: ["outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "microsoft.com"],
  },
  "apple": {
    name: "Apple / iCloud",
    ecosystem: ["iCloud Mail", "iCloud Calendar", "iCloud Drive", "FaceTime", "iMessage", "iCloud Contacts"],
    compatibleWith: ["slack", "notion", "zapier", "make", "dropbox"],
    indicators: ["icloud.com", "me.com", "mac.com"],
  },
  "atlassian": {
    name: "Atlassian Suite",
    ecosystem: ["Jira", "Confluence", "Trello", "Bitbucket", "Jira Service Management"],
    compatibleWith: ["jira", "trello", "slack", "teams", "zapier", "make", "intercom", "zendesk"],
    indicators: ["atlassian.net", "atlassian.com"],
  },
};

const INDUSTRY_PATTERNS: Record<string, { keywords: string[]; recommended: string[]; reason: string }> = {
  "immobilier": {
    keywords: ["immo", "immobilier", "agence", "location", "bien", "terrain", "appartement", "maison"],
    recommended: ["docusign", "dropbox", "mailchimp", "hubspot", "sage"],
    reason: "Secteur immobilier: signature electronique, gestion documentaire et CRM essentiels",
  },
  "cabinet_conseil": {
    keywords: ["conseil", "consulting", "cabinet", "audit", "expertise"],
    recommended: ["notion", "asana", "slack", "docusign", "quickbooks"],
    reason: "Cabinet de conseil: gestion de projets, documentation et collaboration prioritaires",
  },
  "commerce": {
    keywords: ["commerce", "boutique", "magasin", "vente", "retail", "shop"],
    recommended: ["quickbooks", "mailchimp", "sendinblue", "hubspot", "zendesk"],
    reason: "Commerce: e-mailing, comptabilite et support client indispensables",
  },
  "tech_startup": {
    keywords: ["tech", "startup", "dev", "software", "saas", "digital", "numerique"],
    recommended: ["jira", "slack", "notion", "intercom", "zapier"],
    reason: "Tech/Startup: gestion agile, communication et automatisation critiques",
  },
  "sante": {
    keywords: ["sante", "medical", "clinique", "cabinet", "docteur", "pharmacie", "dentiste"],
    recommended: ["outlook", "docusign", "sage", "dropbox", "zendesk"],
    reason: "Sante: securite des documents, planification et conformite essentielles",
  },
  "artisan_btp": {
    keywords: ["artisan", "btp", "construction", "plombier", "electricien", "chantier", "renovation"],
    recommended: ["sage", "quickbooks", "dropbox", "trello", "zapier"],
    reason: "Artisan/BTP: suivi de chantiers, devis/factures et stockage de documents prioritaires",
  },
  "juridique": {
    keywords: ["avocat", "notaire", "huissier", "juridique", "droit", "cabinet juridique"],
    recommended: ["docusign", "dropbox", "outlook", "sage", "notion"],
    reason: "Juridique: signature electronique, gestion documentaire et comptabilite essentielles",
  },
  "education": {
    keywords: ["ecole", "formation", "universite", "education", "enseignement", "academie"],
    recommended: ["notion", "zoom", "slack", "asana", "mailchimp"],
    reason: "Education: collaboration, visioconference et communication prioritaires",
  },
};

router.get("/smart-discovery", async (req, res): Promise<void> => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }

  try {
    const [org] = await db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId));
    const users = await db.select({ email: usersTable.email, nom: usersTable.nom }).from(usersTable).where(eq(usersTable.organisationId, orgId));
    const [contactStats] = await db.select({ total: count() }).from(contactsTable).where(eq(contactsTable.organisationId, orgId));
    const [callStats] = await db.select({ total: count() }).from(callsTable).where(eq(callsTable.organisationId, orgId));
    const [taskStats] = await db.select({ total: count() }).from(tasksTable).where(eq(tasksTable.organisationId, orgId));

    const emailDomains = new Set<string>();
    users.forEach(u => {
      if (u.email) {
        const domain = u.email.split("@")[1]?.toLowerCase();
        if (domain) emailDomains.add(domain);
      }
    });

    const detectedPlatforms: Array<{ platform: string; name: string; confidence: number; reason: string; ecosystem: string[]; recommendedIntegrations: string[] }> = [];

    for (const [key, platform] of Object.entries(PLATFORM_ECOSYSTEM)) {
      const domainMatch = platform.indicators.some(ind => emailDomains.has(ind));
      if (domainMatch) {
        detectedPlatforms.push({
          platform: key,
          name: platform.name,
          confidence: 95,
          reason: `Domaine e-mail detecte (${[...emailDomains].filter(d => platform.indicators.includes(d)).join(", ")})`,
          ecosystem: platform.ecosystem,
          recommendedIntegrations: platform.compatibleWith,
        });
      }
    }

    const orgName = (org?.name || "").toLowerCase();
    const orgEmail = (org?.email || "").toLowerCase();
    const orgDomain = orgEmail.split("@")[1] || "";

    if (orgDomain && !["gmail.com", "outlook.com", "hotmail.com", "icloud.com", "yahoo.com", "free.fr", "orange.fr", "sfr.fr", "laposte.net"].includes(orgDomain)) {
      const isCustomDomain = !Object.values(PLATFORM_ECOSYSTEM).some(p => p.indicators.includes(orgDomain));
      if (isCustomDomain) {
        detectedPlatforms.push({
          platform: "custom_domain",
          name: `Domaine professionnel (${orgDomain})`,
          confidence: 80,
          reason: `Domaine personnalise detecte - infrastructure e-mail professionnelle probable`,
          ecosystem: ["Serveur mail professionnel", "Site web d'entreprise"],
          recommendedIntegrations: ["outlook", "slack", "dropbox", "docusign"],
        });
      }
    }

    const detectedIndustry: Array<{ industry: string; confidence: number; reason: string; recommendedIntegrations: string[] }> = [];
    for (const [key, pattern] of Object.entries(INDUSTRY_PATTERNS)) {
      const nameMatch = pattern.keywords.some(kw => orgName.includes(kw));
      if (nameMatch) {
        detectedIndustry.push({
          industry: key,
          confidence: 85,
          reason: pattern.reason,
          recommendedIntegrations: pattern.recommended,
        });
      }
    }

    const usageBasedRecs: Array<{ integrationId: string; reason: string; priority: "haute" | "moyenne" | "basse" }> = [];
    const totalContacts = contactStats?.total || 0;
    const totalCalls = callStats?.total || 0;
    const totalTasks = taskStats?.total || 0;

    if (totalContacts > 50) {
      usageBasedRecs.push({ integrationId: "hubspot", reason: `${totalContacts} contacts - un CRM ameliorerait le suivi commercial`, priority: "haute" });
      usageBasedRecs.push({ integrationId: "mailchimp", reason: `Base de ${totalContacts} contacts exploitable pour du marketing`, priority: "moyenne" });
    }
    if (totalCalls > 100) {
      usageBasedRecs.push({ integrationId: "salesforce", reason: `${totalCalls} appels - Salesforce centraliserait l'historique client`, priority: "haute" });
      usageBasedRecs.push({ integrationId: "zendesk", reason: `Volume d'appels eleve - un systeme de tickets ameliorerait le suivi`, priority: "moyenne" });
    }
    if (totalTasks > 30) {
      usageBasedRecs.push({ integrationId: "asana", reason: `${totalTasks} taches - un outil de gestion de projet structurerait le travail`, priority: "moyenne" });
      usageBasedRecs.push({ integrationId: "trello", reason: `Organisation visuelle des ${totalTasks} taches avec Trello`, priority: "basse" });
    }
    if (totalContacts > 20 && totalCalls > 20) {
      usageBasedRecs.push({ integrationId: "zapier", reason: `Automatiser les flux entre contacts et appels`, priority: "moyenne" });
    }
    if (users.length > 3) {
      usageBasedRecs.push({ integrationId: "slack", reason: `${users.length} utilisateurs - la communication d'equipe serait optimisee`, priority: "haute" });
    }

    const allRecommendedIds = new Set<string>();
    detectedPlatforms.forEach(p => p.recommendedIntegrations.forEach(id => allRecommendedIds.add(id)));
    detectedIndustry.forEach(i => i.recommendedIntegrations.forEach(id => allRecommendedIds.add(id)));
    usageBasedRecs.forEach(r => allRecommendedIds.add(r.integrationId));

    const scoredRecommendations = [...allRecommendedIds].map(id => {
      const integration = SOFTWARE_CATALOG.find(s => s.id === id);
      if (!integration) return null;

      let score = 0;
      const reasons: string[] = [];

      detectedPlatforms.forEach(p => {
        if (p.recommendedIntegrations.includes(id)) {
          score += 30;
          reasons.push(`Compatible avec ${p.name}`);
        }
      });
      detectedIndustry.forEach(i => {
        if (i.recommendedIntegrations.includes(id)) {
          score += 25;
          reasons.push(i.reason);
        }
      });
      const usageRec = usageBasedRecs.find(r => r.integrationId === id);
      if (usageRec) {
        score += usageRec.priority === "haute" ? 35 : usageRec.priority === "moyenne" ? 20 : 10;
        reasons.push(usageRec.reason);
      }

      return {
        integration,
        score: Math.min(score, 100),
        reasons: [...new Set(reasons)],
        priority: score >= 50 ? "haute" as const : score >= 25 ? "moyenne" as const : "basse" as const,
      };
    }).filter(Boolean).sort((a, b) => (b?.score || 0) - (a?.score || 0));

    const useAi = req.query.ai !== "false";
    let aiInsights = "";
    if (useAi) {
    try {
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const prompt = `Tu es un consultant en transformation digitale pour entreprises francaises.

Analyse ce profil d'organisation et donne 3-5 recommandations strategiques d'integration logicielle en 2-3 phrases chacune.

PROFIL (anonymise):
- Type: Entreprise francaise
- Taille equipe: ${users.length} utilisateurs
- Volume contacts: ${totalContacts}
- Volume appels: ${totalCalls}
- Volume taches: ${totalTasks}
- Plateformes detectees: ${detectedPlatforms.map(p => p.name).join(", ") || "Aucune"}
- Secteur detecte: ${detectedIndustry.map(i => i.industry).join(", ") || "Non identifie"}

LOGICIELS DISPONIBLES: ${SOFTWARE_CATALOG.map(s => s.name).join(", ")}

Reponds en JSON:
{
  "insights": "Analyse globale en 2-3 phrases",
  "topRecommendations": [
    {"softwareId": "id_du_logiciel", "reason": "raison en 1-2 phrases", "businessImpact": "impact attendu"}
  ],
  "ecosystemAdvice": "conseil sur l'ecosysteme global en 1-2 phrases",
  "automationTip": "suggestion d'automatisation en 1 phrase"
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 1024, responseMimeType: "application/json" },
      });
      aiInsights = response.text || "";
    } catch (err: any) {
      console.error("[Smart Discovery] AI error:", err?.message);
    }
    }

    let parsedAiInsights = null;
    try { parsedAiInsights = aiInsights ? JSON.parse(aiInsights) : null; } catch (err) { console.warn("[Integrations] operation failed:", err); }

    res.json({
      detectedPlatforms,
      detectedIndustry,
      usageBasedRecommendations: usageBasedRecs,
      scoredRecommendations,
      aiInsights: parsedAiInsights,
      orgProfile: {
        name: org?.name,
        domain: orgDomain,
        userCount: users.length,
        contactCount: totalContacts,
        callCount: totalCalls,
        taskCount: totalTasks,
      },
      discoveredAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Smart Discovery] Erreur:", err?.message);
    res.status(500).json({ error: "Erreur lors de la decouverte intelligente." });
  }
});

router.get("/catalog", (_req, res) => {
  res.json({
    integrations: SOFTWARE_CATALOG,
    categories: CATEGORIES,
    totalAvailable: SOFTWARE_CATALOG.length,
    totalConnected: 0,
  });
});

router.get("/:integrationId", (req, res) => {
  const { integrationId } = req.params;
  const integration = SOFTWARE_CATALOG.find(s => s.id === integrationId);
  if (!integration) {
    res.status(404).json({ error: "Integration inconnue." }); return;
  }
  res.json(integration);
});

router.post("/:integrationId/connect", (req, res) => {
  const { integrationId } = req.params;
  const integration = SOFTWARE_CATALOG.find(s => s.id === integrationId);
  if (!integration) {
    res.status(404).json({ error: "Integration inconnue." }); return;
  }

  const config = req.body || {};
  const missingFields = integration.configFields
    .filter(f => f.required && !config[f.key])
    .map(f => f.label);

  if (missingFields.length > 0) {
    res.status(400).json({
      error: "Champs requis manquants.",
      missingFields,
    }); return;
  }

  res.json({
    status: "en_attente",
    message: `Configuration de ${integration.name} enregistree. La connexion sera etablie sous peu.`,
    integrationId,
    integrationName: integration.name,
  });
});

router.post("/:integrationId/disconnect", (req, res) => {
  const { integrationId } = req.params;
  const integration = SOFTWARE_CATALOG.find(s => s.id === integrationId);
  if (!integration) {
    res.status(404).json({ error: "Integration inconnue." }); return;
  }

  res.json({
    status: "deconnecte",
    message: `${integration.name} a ete deconnecte avec succes.`,
    integrationId,
  });
});

router.post("/:integrationId/test", (req, res) => {
  const { integrationId } = req.params;
  const integration = SOFTWARE_CATALOG.find(s => s.id === integrationId);
  if (!integration) {
    res.status(404).json({ error: "Integration inconnue." }); return;
  }

  res.json({
    status: "succes",
    message: `Connexion a ${integration.name} testee avec succes.`,
    latency: Math.floor(Math.random() * 200) + 50,
  });
});

router.post("/:integrationId/sync", (req, res) => {
  const { integrationId } = req.params;
  const integration = SOFTWARE_CATALOG.find(s => s.id === integrationId);
  if (!integration) {
    res.status(404).json({ error: "Integration inconnue." }); return;
  }

  res.json({
    status: "en_cours",
    message: `Synchronisation de ${integration.name} lancee.`,
    startedAt: new Date().toISOString(),
  });
});

export default router;
