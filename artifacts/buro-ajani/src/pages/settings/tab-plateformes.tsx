import { useState, useEffect, useCallback } from "react";
import {
  Globe, Shield, CheckCircle2, XCircle, ExternalLink, Calendar, Mail, FolderOpen, FileText, Table2,
  Presentation, RefreshCw, Clock, Lock, ShieldAlert, ShieldCheck, ShieldBan,
  FileWarning, Download, Upload, Bug, Eye, UserCog, AlertTriangle, KeyRound,
  Fingerprint, ScanSearch, FileX, Ban, Video, MessageCircle, MapPin, StickyNote,
  ListChecks, Users, Image, BarChart3, Megaphone, Search, Cloud, Settings,
  BookOpen, Bookmark, Languages, ShieldQuestion, Radio, Store, ClipboardList,
  Building2, Headphones, Database, Layout, Kanban, Newspaper, Workflow,
  AppWindow, HardDriveDownload, Layers, Loader2, Unplug, Plug, Zap, History,
  Link2, Bell, Smartphone
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GoogleService {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: "connecte" | "deconnecte" | "en_attente";
  features: string[];
  categorie: "productivite" | "communication" | "stockage" | "analyse" | "marketing" | "administration";
}

interface PlatformService {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: "connecte" | "deconnecte" | "en_attente";
  features: string[];
  categorie: string;
}

interface PlatformData {
  id: string;
  name: string;
  connected: boolean;
  connectedCount: number;
  totalServices: number;
  lastSync: string | null;
  services: Array<{
    id: string;
    name: string;
    status: string;
    lastSync: string | null;
    connectedAt: string | null;
  }>;
}

interface SyncLog {
  id: number;
  platform: string;
  serviceId: string;
  action: string;
  status: string;
  details: string | null;
  itemsProcessed: string | null;
  createdAt: string;
}

const GOOGLE_CATEGORIES: Record<string, { label: string; couleur: string }> = {
  productivite: { label: "Productivite", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  communication: { label: "Communication", couleur: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  stockage: { label: "Stockage", couleur: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  analyse: { label: "Analyse", couleur: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  marketing: { label: "Marketing", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  administration: { label: "Administration", couleur: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
};

const GOOGLE_SERVICES: GoogleService[] = [
  { id: "gmail", name: "Gmail", description: "Envoyer et recevoir des e-mails directement depuis l'application. Synchroniser les messages avec les contacts.", icon: Mail, status: "deconnecte", categorie: "communication", features: ["Envoi d'e-mails depuis la fiche contact", "Synchronisation des conversations", "Modeles d'e-mails professionnels", "Suivi des ouvertures"] },
  { id: "calendar", name: "Google Calendar", description: "Synchroniser les rendez-vous, planifier des appels de suivi et consulter la disponibilite des contacts.", icon: Calendar, status: "deconnecte", categorie: "productivite", features: ["Planification automatique des rappels", "Synchronisation bidirectionnelle des evenements", "Verification de disponibilite avant appel", "Rappels de suivi intelligents"] },
  { id: "drive", name: "Google Drive", description: "Joindre des documents aux appels et contacts. Stocker les comptes rendus automatiquement.", icon: FolderOpen, status: "deconnecte", categorie: "stockage", features: ["Pieces jointes aux fiches contact", "Stockage des comptes rendus d'appel", "Partage de documents securise", "Recherche dans les documents"] },
  { id: "docs", name: "Google Docs", description: "Creer des comptes rendus de reunion et rapports d'activite directement depuis l'application.", icon: FileText, status: "deconnecte", categorie: "productivite", features: ["Generation de comptes rendus IA", "Modeles de rapports", "Collaboration en temps reel", "Export PDF automatique"] },
  { id: "sheets", name: "Google Sheets", description: "Exporter des donnees vers des feuilles de calcul et importer des listes de contacts.", icon: Table2, status: "deconnecte", categorie: "productivite", features: ["Export des rapports d'activite", "Import de contacts en masse", "Tableaux croises dynamiques", "Mise a jour en temps reel"] },
  { id: "slides", name: "Google Slides", description: "Generer des presentations de performance et de synthese pour les reunions d'equipe.", icon: Presentation, status: "deconnecte", categorie: "productivite", features: ["Rapports de performance hebdomadaires", "Presentations client automatisees", "Graphiques integres", "Export pour reunions"] },
  { id: "meet", name: "Google Meet", description: "Lancer des visioconferences directement depuis l'application. Planifier des reunions avec les contacts.", icon: Video, status: "deconnecte", categorie: "communication", features: ["Visioconference depuis la fiche contact", "Planification automatique des reunions", "Enregistrement des reunions", "Transcription IA des echanges"] },
  { id: "chat", name: "Google Chat", description: "Messagerie instantanee avec les equipes et contacts. Espaces de travail collaboratifs.", icon: MessageCircle, status: "deconnecte", categorie: "communication", features: ["Messages directs aux collegues", "Espaces de travail par projet", "Partage de fichiers en temps reel", "Notifications d'activite bureau"] },
  { id: "contacts", name: "Google Contacts", description: "Synchroniser le repertoire Google avec la base de contacts de l'agent. Import et export automatiques.", icon: Users, status: "deconnecte", categorie: "productivite", features: ["Synchronisation bidirectionnelle", "Fusion des doublons automatique", "Import par groupes et labels", "Mise a jour des coordonnees"] },
  { id: "tasks", name: "Google Tasks", description: "Synchroniser les taches Google avec les taches de l'agent. Suivi unifie des actions a realiser.", icon: ListChecks, status: "deconnecte", categorie: "productivite", features: ["Synchronisation des taches", "Dates limites partagees", "Sous-taches et priorites", "Integration avec Calendar"] },
  { id: "keep", name: "Google Keep", description: "Prendre des notes rapides pendant les appels. Synchroniser les notes avec les fiches contact.", icon: StickyNote, status: "deconnecte", categorie: "productivite", features: ["Notes rapides pendant l'appel", "Listes de verification", "Notes vocales transcrites", "Organisation par labels"] },
  { id: "forms", name: "Google Forms", description: "Creer des formulaires de satisfaction, enquetes et questionnaires pour les clients et contacts.", icon: ClipboardList, status: "deconnecte", categorie: "productivite", features: ["Enquetes de satisfaction client", "Formulaires de feedback post-appel", "Collecte automatique des reponses", "Analyse des resultats"] },
  { id: "maps", name: "Google Maps", description: "Localiser les contacts et clients sur la carte. Planifier les deplacements et visites terrain.", icon: MapPin, status: "deconnecte", categorie: "productivite", features: ["Geolocalisation des contacts", "Planification des visites", "Calcul d'itineraires optimises", "Zones de couverture commerciale"] },
  { id: "photos", name: "Google Photos", description: "Stocker et partager les photos de documents, cartes de visite et preuves visuelles.", icon: Image, status: "deconnecte", categorie: "stockage", features: ["Scan de cartes de visite", "Photos de documents", "Partage securise d'images", "Reconnaissance OCR IA"] },
  { id: "analytics", name: "Google Analytics", description: "Analyser le trafic du site web de l'entreprise. Mesurer les conversions et la performance digitale.", icon: BarChart3, status: "deconnecte", categorie: "analyse", features: ["Suivi du trafic web", "Analyse des conversions", "Rapports de performance", "Attribution des leads"] },
  { id: "ads", name: "Google Ads", description: "Gerer les campagnes publicitaires. Suivre les performances et le retour sur investissement.", icon: Megaphone, status: "deconnecte", categorie: "marketing", features: ["Suivi des campagnes actives", "Performance des annonces", "Budget et depenses en temps reel", "Integration des leads entrants"] },
  { id: "search-console", name: "Google Search Console", description: "Surveiller la presence de l'entreprise dans les resultats de recherche Google.", icon: Search, status: "deconnecte", categorie: "analyse", features: ["Position dans les resultats", "Analyse des requetes", "Alertes de problemes", "Performance mobile"] },
  { id: "my-business", name: "Google Business Profile", description: "Gerer la fiche d'entreprise Google. Repondre aux avis et mettre a jour les informations.", icon: Store, status: "deconnecte", categorie: "marketing", features: ["Gestion des avis clients", "Mise a jour des horaires", "Photos et publications", "Statistiques de visibilite"] },
  { id: "youtube", name: "YouTube", description: "Gerer la chaine YouTube de l'entreprise. Integrer les videos dans les communications.", icon: Radio, status: "deconnecte", categorie: "marketing", features: ["Gestion de la chaine", "Statistiques des videos", "Integration dans les e-mails", "Alertes sur les commentaires"] },
  { id: "cloud", name: "Google Cloud Platform", description: "Infrastructure cloud pour l'hebergement, le stockage et les services IA avances.", icon: Cloud, status: "deconnecte", categorie: "administration", features: ["Hebergement des donnees", "Services IA et Machine Learning", "Stockage securise", "Monitoring et alertes"] },
  { id: "voice", name: "Google Voice", description: "Telephonie cloud integree. Numeros virtuels et transfert d'appels professionnel.", icon: Headphones, status: "deconnecte", categorie: "communication", features: ["Numeros virtuels francais", "Transfert d'appels intelligent", "Messagerie vocale transcrite", "Historique d'appels unifie"] },
  { id: "translate", name: "Google Translate", description: "Traduction automatique des e-mails, documents et conversations avec les contacts internationaux.", icon: Languages, status: "deconnecte", categorie: "productivite", features: ["Traduction d'e-mails entrants", "Traduction de documents", "Detection automatique de langue", "Support de 133 langues"] },
  { id: "admin", name: "Google Workspace Admin", description: "Administration centralisee du domaine Google Workspace. Gestion des utilisateurs et des politiques.", icon: Settings, status: "deconnecte", categorie: "administration", features: ["Gestion des utilisateurs", "Politiques de securite", "Rapports d'audit", "Configuration du domaine"] },
  { id: "sites", name: "Google Sites", description: "Creer des sites web internes pour l'equipe. Documentation et portail collaborateur.", icon: BookOpen, status: "deconnecte", categorie: "productivite", features: ["Portail interne d'equipe", "Documentation partagee", "Pages de projet", "Integration Workspace native"] },
  { id: "vault", name: "Google Vault", description: "Archivage et conservation legale des donnees. Recherche et export pour conformite.", icon: ShieldQuestion, status: "deconnecte", categorie: "administration", features: ["Archivage des e-mails", "Conservation legale", "Recherche dans les archives", "Export pour audit et conformite"] },
  { id: "classroom", name: "Google Classroom", description: "Formation et integration des nouveaux agents. Modules de formation et evaluations.", icon: Bookmark, status: "deconnecte", categorie: "productivite", features: ["Modules de formation agent", "Evaluations et quiz", "Suivi de progression", "Ressources pedagogiques"] },
];

const MICROSOFT_CATEGORIES: Record<string, { label: string; couleur: string }> = {
  productivite: { label: "Productivite", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  communication: { label: "Communication", couleur: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  stockage: { label: "Stockage", couleur: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  securite: { label: "Securite", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  analyse: { label: "Analyse", couleur: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  administration: { label: "Administration", couleur: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
  collaboration: { label: "Collaboration", couleur: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
};

const MICROSOFT_SERVICES: PlatformService[] = [
  { id: "outlook", name: "Microsoft Outlook", description: "Messagerie professionnelle, calendrier et gestion des contacts. Synchronisation complete avec l'agent.", icon: Mail, status: "deconnecte", categorie: "communication", features: ["Synchronisation bidirectionnelle des e-mails", "Calendrier partage avec l'equipe", "Gestion des contacts Outlook", "Regles de tri automatique des messages"] },
  { id: "teams", name: "Microsoft Teams", description: "Communication d'equipe, appels video et collaboration en temps reel integres a l'agent.", icon: Video, status: "deconnecte", categorie: "communication", features: ["Appels video depuis la fiche contact", "Channels par projet ou equipe", "Partage d'ecran pendant les appels", "Notifications d'activite en temps reel"] },
  { id: "onedrive", name: "Microsoft OneDrive", description: "Stockage cloud et partage de documents. Synchronisation des fichiers avec l'agent de bureau.", icon: Cloud, status: "deconnecte", categorie: "stockage", features: ["Stockage des comptes rendus d'appel", "Partage securise de documents", "Versioning automatique des fichiers", "Acces hors ligne aux documents cles"] },
  { id: "word", name: "Microsoft Word", description: "Creer et editer des documents professionnels, rapports et comptes rendus directement.", icon: FileText, status: "deconnecte", categorie: "productivite", features: ["Generation automatique de rapports", "Modeles de documents professionnels", "Co-edition en temps reel", "Export PDF et impression"] },
  { id: "excel", name: "Microsoft Excel", description: "Tableurs et analyses de donnees. Export des statistiques d'appels et rapports financiers.", icon: Table2, status: "deconnecte", categorie: "productivite", features: ["Export des donnees d'appels", "Tableaux croises dynamiques", "Graphiques de performance", "Import de listes de contacts"] },
  { id: "powerpoint", name: "Microsoft PowerPoint", description: "Presentations professionnelles pour les reunions d'equipe et les bilans de performance.", icon: Presentation, status: "deconnecte", categorie: "productivite", features: ["Rapports hebdomadaires automatises", "Modeles de presentation", "Graphiques integres depuis Excel", "Partage en reunion Teams"] },
  { id: "sharepoint", name: "Microsoft SharePoint", description: "Portail intranet et gestion documentaire. Base de connaissances partagee pour l'equipe.", icon: Layout, status: "deconnecte", categorie: "collaboration", features: ["Portail intranet d'equipe", "Bibliotheques de documents partagees", "Workflows d'approbation", "Sites d'equipe par departement"] },
  { id: "onenote", name: "Microsoft OneNote", description: "Prise de notes structuree pendant les appels. Carnets de notes partages avec l'equipe.", icon: StickyNote, status: "deconnecte", categorie: "productivite", features: ["Notes d'appel en temps reel", "Carnets partages par equipe", "Capture d'ecran dans les notes", "Recherche dans toutes les notes"] },
  { id: "planner", name: "Microsoft Planner", description: "Gestion de taches et de projets. Tableaux Kanban et suivi des actions de l'equipe.", icon: Kanban, status: "deconnecte", categorie: "productivite", features: ["Synchronisation des taches", "Tableaux Kanban par projet", "Attribution et suivi des actions", "Integration avec Teams"] },
  { id: "power-automate", name: "Microsoft Power Automate", description: "Automatisation des flux de travail. Declencheurs bases sur les appels et les evenements.", icon: Workflow, status: "deconnecte", categorie: "administration", features: ["Automatisation post-appel", "Declencheurs personnalises", "Integration multi-services", "Notifications automatiques"] },
  { id: "power-bi", name: "Microsoft Power BI", description: "Tableaux de bord analytiques avances. Visualisation des KPI et performance de l'equipe.", icon: BarChart3, status: "deconnecte", categorie: "analyse", features: ["Dashboards en temps reel", "Rapports de performance KPI", "Visualisations interactives", "Partage des rapports avec la direction"] },
  { id: "dynamics", name: "Microsoft Dynamics 365", description: "CRM et ERP integres. Gestion des relations client et suivi commercial complet.", icon: Users, status: "deconnecte", categorie: "analyse", features: ["Synchronisation des contacts CRM", "Historique d'appels dans Dynamics", "Suivi du pipeline commercial", "Rapports de ventes automatises"] },
  { id: "intune", name: "Microsoft Intune", description: "Gestion des appareils et securite. Politiques de conformite pour les postes de travail.", icon: Smartphone, status: "deconnecte", categorie: "securite", features: ["Gestion des appareils de l'equipe", "Politiques de securite centralisees", "Deploiement d'applications", "Conformite et rapports"] },
  { id: "defender", name: "Microsoft Defender", description: "Protection avancee contre les menaces. Securite des e-mails, fichiers et postes de travail.", icon: ShieldCheck, status: "deconnecte", categorie: "securite", features: ["Protection anti-malware en temps reel", "Detection des menaces avancees", "Securite des e-mails Outlook", "Rapports de securite centralises"] },
  { id: "azure-ad", name: "Microsoft Entra ID", description: "Gestion des identites et acces. Authentification unique (SSO) pour tous les services.", icon: KeyRound, status: "deconnecte", categorie: "securite", features: ["Authentification unique (SSO)", "Gestion des groupes et roles", "Politiques d'acces conditionnel", "Audit des connexions"] },
  { id: "forms", name: "Microsoft Forms", description: "Formulaires et enquetes. Recueillir les avis des clients et les retours de l'equipe.", icon: ClipboardList, status: "deconnecte", categorie: "productivite", features: ["Enquetes de satisfaction client", "Formulaires de feedback interne", "Quiz de formation", "Analyse des reponses"] },
  { id: "bookings", name: "Microsoft Bookings", description: "Planification de rendez-vous en ligne. Les clients reservent des creneaux automatiquement.", icon: Calendar, status: "deconnecte", categorie: "communication", features: ["Page de reservation publique", "Synchronisation avec le calendrier", "Rappels automatiques par e-mail", "Gestion des disponibilites"] },
  { id: "yammer", name: "Microsoft Viva Engage", description: "Reseau social d'entreprise. Communication interne et partage de connaissances.", icon: MessageCircle, status: "deconnecte", categorie: "collaboration", features: ["Fil d'actualite d'entreprise", "Communautes par centre d'interet", "Partage de connaissances", "Sondages et annonces"] },
  { id: "admin-365", name: "Microsoft 365 Admin", description: "Administration centralisee de tous les services Microsoft 365. Gestion des licences et utilisateurs.", icon: Settings, status: "deconnecte", categorie: "administration", features: ["Gestion des licences utilisateurs", "Rapports d'utilisation", "Configuration des services", "Alertes de sante des services"] },
];

const APPLE_CATEGORIES: Record<string, { label: string; couleur: string }> = {
  productivite: { label: "Productivite", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  communication: { label: "Communication", couleur: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  stockage: { label: "Stockage", couleur: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  creativite: { label: "Creativite", couleur: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" },
  securite: { label: "Securite", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const APPLE_SERVICES: PlatformService[] = [
  { id: "icloud-mail", name: "iCloud Mail", description: "Messagerie Apple professionnelle. Synchronisation des e-mails avec l'agent de bureau.", icon: Mail, status: "deconnecte", categorie: "communication", features: ["Envoi d'e-mails depuis la fiche contact", "Synchronisation des boites de reception", "Filtres et regles automatiques", "Alias de messagerie"] },
  { id: "icloud-calendar", name: "Calendrier iCloud", description: "Gestion des rendez-vous et planification. Synchronisation avec tous les appareils Apple.", icon: Calendar, status: "deconnecte", categorie: "productivite", features: ["Synchronisation des evenements", "Calendriers partages", "Invitations et reponses automatiques", "Rappels avant les appels"] },
  { id: "icloud-drive", name: "iCloud Drive", description: "Stockage cloud Apple. Partage et synchronisation des documents entre appareils.", icon: Cloud, status: "deconnecte", categorie: "stockage", features: ["Stockage et partage de fichiers", "Synchronisation multi-appareils", "Dossiers partages avec l'equipe", "Acces depuis iPhone, iPad et Mac"] },
  { id: "icloud-contacts", name: "Contacts iCloud", description: "Repertoire de contacts Apple. Synchronisation bidirectionnelle avec la base de contacts.", icon: Users, status: "deconnecte", categorie: "communication", features: ["Import automatique des contacts Apple", "Synchronisation bidirectionnelle", "Groupes et categories", "Cartes de visite partagees"] },
  { id: "pages", name: "Apple Pages", description: "Creation de documents et rapports professionnels. Compatible avec les formats Word.", icon: FileText, status: "deconnecte", categorie: "productivite", features: ["Documents et rapports professionnels", "Modeles pre-concus", "Export PDF et Word", "Collaboration en temps reel"] },
  { id: "numbers", name: "Apple Numbers", description: "Tableurs et analyses de donnees. Export des statistiques et rapports financiers.", icon: Table2, status: "deconnecte", categorie: "productivite", features: ["Export de donnees en tableur", "Graphiques interactifs", "Formules et calculs avances", "Compatible Excel"] },
  { id: "keynote", name: "Apple Keynote", description: "Presentations professionnelles elegantes pour les reunions et bilans d'equipe.", icon: Presentation, status: "deconnecte", categorie: "productivite", features: ["Presentations de qualite cinema", "Animations et transitions", "Export PowerPoint et PDF", "Presentation a distance"] },
  { id: "facetime", name: "FaceTime", description: "Appels video de qualite professionnelle. Conferences avec les clients et l'equipe.", icon: Video, status: "deconnecte", categorie: "communication", features: ["Appels video HD avec les contacts", "Conferences de groupe", "Partage d'ecran integre", "Liens d'appel partageables"] },
  { id: "imessage", name: "iMessage", description: "Messagerie instantanee securisee. Communication rapide avec les contacts professionnels.", icon: MessageCircle, status: "deconnecte", categorie: "communication", features: ["Messages chiffres de bout en bout", "Partage de fichiers et photos", "Reponses rapides", "Indicateurs de lecture"] },
  { id: "notes", name: "Apple Notes", description: "Prise de notes pendant les appels. Synchronisation avec tous les appareils Apple.", icon: StickyNote, status: "deconnecte", categorie: "productivite", features: ["Notes rapides pendant l'appel", "Dossiers organises", "Scan de documents integre", "Recherche dans les notes"] },
  { id: "reminders", name: "Apple Rappels", description: "Gestion des taches et rappels. Synchronisation avec les taches de l'agent.", icon: ListChecks, status: "deconnecte", categorie: "productivite", features: ["Synchronisation des taches", "Rappels bases sur la localisation", "Listes partagees", "Priorites et dates limites"] },
  { id: "find-my", name: "Localiser (Find My)", description: "Localisation des appareils de l'equipe. Securite et suivi des equipements professionnels.", icon: MapPin, status: "deconnecte", categorie: "securite", features: ["Localisation des appareils d'equipe", "Verrouillage a distance", "Alerte en cas de perte", "Historique de localisation"] },
  { id: "apple-business", name: "Apple Business Manager", description: "Gestion centralisee des appareils Apple de l'entreprise. Deploiement et configuration.", icon: Building2, status: "deconnecte", categorie: "securite", features: ["Deploiement automatique des appareils", "Gestion des licences d'applications", "Inscription automatique MDM", "Comptes Apple geres"] },
];

const BLOCKED_EXTENSIONS = [
  ".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".vbs", ".vbe", ".js",
  ".jse", ".wsf", ".wsh", ".msi", ".msp", ".mst", ".cpl", ".hta", ".inf",
  ".ins", ".isp", ".lnk", ".reg", ".rgs", ".sct", ".shb", ".shs", ".ps1",
  ".ps1xml", ".ps2", ".ps2xml", ".psc1", ".psc2", ".dll", ".sys", ".drv",
];

const SCAN_STATS = {
  totalScanned: 1247,
  threatsBlocked: 23,
  quarantined: 8,
  lastScan: "03/04/2026 14:32",
};

const PLATFORM_NAMES_MAP: Record<string, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
};

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/workspace";
const GOOGLE_OAUTH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/google-oauth";

export function TabPlateformes() {
  const { toast } = useToast();

  const [googleFilter, setGoogleFilter] = useState<string>("tous");
  const [googleSearch, setGoogleSearch] = useState("");
  const [activePlatform, setActivePlatform] = useState<"google" | "microsoft" | "apple">("google");
  const [msFilter, setMsFilter] = useState<string>("tous");
  const [msSearch, setMsSearch] = useState("");
  const [appleFilter, setAppleFilter] = useState<string>("tous");
  const [appleSearch, setAppleSearch] = useState("");

  const [platformsData, setPlatformsData] = useState<PlatformData[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(true);
  const [connectingService, setConnectingService] = useState<string | null>(null);
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [connectingAll, setConnectingAll] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [totalConnected, setTotalConnected] = useState(0);

  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState(false);
  const [googleOAuthAuthenticated, setGoogleOAuthAuthenticated] = useState(false);
  const [showGoogleConfig, setShowGoogleConfig] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [savingGoogleConfig, setSavingGoogleConfig] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);

  const [blockExternalDownloads, setBlockExternalDownloads] = useState(true);
  const [superAdminOnlyDownload, setSuperAdminOnlyDownload] = useState(true);
  const [blockExternalUploads, setBlockExternalUploads] = useState(true);
  const [virusScanEmails, setVirusScanEmails] = useState(true);
  const [virusScanAttachments, setVirusScanAttachments] = useState(true);
  const [virusScanDrive, setVirusScanDrive] = useState(true);
  const [quarantineSuspicious, setQuarantineSuspicious] = useState(true);
  const [blockMacros, setBlockMacros] = useState(true);
  const [blockEncryptedFiles, setBlockEncryptedFiles] = useState(true);
  const [blockExecutables, setBlockExecutables] = useState(true);
  const [sandboxAnalysis, setSandboxAnalysis] = useState(true);
  const [dlpEnabled, setDlpEnabled] = useState(true);
  const [dlpBlockSensitiveData, setDlpBlockSensitiveData] = useState(true);
  const [dlpNotifyAdmin, setDlpNotifyAdmin] = useState(true);
  const [phishingProtection, setPhishingProtection] = useState(true);
  const [spoofingProtection, setSpoofingProtection] = useState(true);
  const [linkSafetyCheck, setLinkSafetyCheck] = useState(true);
  const [externalSharingBlocked, setExternalSharingBlocked] = useState(true);
  const [maxFileSize, setMaxFileSize] = useState("25");
  const [aiThreatDetection, setAiThreatDetection] = useState(true);
  const [realTimeProtection, setRealTimeProtection] = useState(true);

  const fetchGoogleOAuthStatus = useCallback(async () => {
    try {
      const res = await fetch(`${GOOGLE_OAUTH_BASE}/status`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setGoogleOAuthConfigured(data.configured);
        setGoogleOAuthAuthenticated(data.authenticated && data.tokenValid);
      }
    } catch (err) { console.error("[Plateformes] Google OAuth status check failed:", err); }
  }, []);

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/platforms`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPlatformsData(data.platforms || []);
        setTotalConnected(data.totalConnected || 0);
      }
    } catch (err) {
      console.error("Fetch platforms error:", err);
    } finally {
      setLoadingPlatforms(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/sync-logs`);
      if (res.ok) {
        const data = await res.json();
        setSyncLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Fetch logs error:", err);
    }
  }, []);

  useEffect(() => {
    fetchPlatforms();
    fetchGoogleOAuthStatus();
  }, [fetchPlatforms, fetchGoogleOAuthStatus]);

  const handleGoogleOAuthConnect = async (services?: string[]) => {
    setGoogleConnecting(true);
    try {
      const res = await fetch(`${GOOGLE_OAUTH_BASE}/auth-url`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ services }) });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsConfig) { setShowGoogleConfig(true); toast({ title: "Configuration requise", description: "Veuillez d'abord configurer les identifiants Google OAuth.", variant: "destructive" }); }
        else { toast({ title: "Erreur", description: data.error || "Impossible de generer l'URL.", variant: "destructive" }); }
        return;
      }
      if (data.authUrl && (data.authUrl.startsWith("https://accounts.google.com/") || data.authUrl.startsWith("https://www.googleapis.com/"))) {
        window.location.href = data.authUrl;
      } else {
        toast({ title: "Erreur", description: "URL d'autorisation invalide.", variant: "destructive" });
      }
    } catch { toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" }); }
    finally { setGoogleConnecting(false); }
  };

  const handleGoogleOAuthDisconnect = async () => {
    try {
      const res = await fetch(`${GOOGLE_OAUTH_BASE}/disconnect`, { method: "POST", credentials: "include" });
      if (res.ok) { toast({ title: "Google deconnecte", description: "Votre compte Google a ete deconnecte." }); setGoogleOAuthAuthenticated(false); await fetchPlatforms(); }
      else { toast({ title: "Erreur", description: "Impossible de deconnecter Google.", variant: "destructive" }); }
    } catch { toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" }); }
  };

  const handleSaveGoogleConfig = async () => {
    setSavingGoogleConfig(true);
    try {
      const res = await fetch(`${GOOGLE_OAUTH_BASE}/config`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ clientId: googleClientId, clientSecret: googleClientSecret }) });
      const data = await res.json();
      if (res.ok) { toast({ title: "Configuration enregistree", description: data.message }); setGoogleOAuthConfigured(true); setShowGoogleConfig(false); setGoogleClientId(""); setGoogleClientSecret(""); }
      else { toast({ title: "Erreur", description: data.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" }); }
    finally { setSavingGoogleConfig(false); }
  };

  const handleConnect = async (serviceId: string, serviceName: string) => {
    setConnectingService(`${activePlatform}:${serviceId}`);
    try {
      const currentPlatform = platformsData.find(p => p.id === activePlatform);
      const currentService = currentPlatform?.services.find(s => s.id === serviceId);
      const isConnected = currentService?.status === "connecte";
      const endpoint = isConnected ? "disconnect" : "connect";
      const res = await fetch(`${API_BASE}/${endpoint}/${activePlatform}/${serviceId}`, { method: "POST" });
      if (res.ok) { toast({ title: isConnected ? "Service deconnecte" : "Service connecte", description: isConnected ? `${serviceName} a ete deconnecte.` : `${serviceName} a ete connecte avec succes.` }); await fetchPlatforms(); }
      else { toast({ title: "Erreur", description: "Impossible de modifier la connexion.", variant: "destructive" }); }
    } catch { toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" }); }
    finally { setConnectingService(null); }
  };

  const handleConnectAll = async () => {
    setConnectingAll(activePlatform);
    try {
      const currentPlatform = platformsData.find(p => p.id === activePlatform);
      const allConnected = currentPlatform && currentPlatform.connectedCount === currentPlatform.totalServices;
      const endpoint = allConnected ? "disconnect-all" : "connect-all";
      const res = await fetch(`${API_BASE}/${endpoint}/${activePlatform}`, { method: "POST" });
      if (!res.ok) { const errData = await res.json().catch(() => null); toast({ title: "Erreur", description: errData?.error || "Impossible de modifier les connexions.", variant: "destructive" }); return; }
      const data = await res.json();
      toast({ title: allConnected ? "Tous deconnectes" : "Tous connectes", description: data.message });
      await fetchPlatforms();
    } catch { toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" }); }
    finally { setConnectingAll(null); }
  };

  const handleSync = async () => {
    setSyncingPlatform(activePlatform);
    try {
      const res = await fetch(`${API_BASE}/sync/${activePlatform}`, { method: "POST" });
      if (!res.ok) { const errData = await res.json().catch(() => null); toast({ title: "Erreur", description: errData?.error || "Echec de la synchronisation.", variant: "destructive" }); return; }
      const data = await res.json();
      toast({ title: "Synchronisation terminee", description: data.message });
      await fetchPlatforms();
    } catch { toast({ title: "Erreur", description: "Erreur de synchronisation.", variant: "destructive" }); }
    finally { setSyncingPlatform(null); }
  };

  const currentPlatformData = platformsData.find(p => p.id === activePlatform);
  const getServiceStatus = (serviceId: string): string => currentPlatformData?.services.find(s => s.id === serviceId)?.status || "deconnecte";
  const getServiceLastSync = (serviceId: string): string | null => currentPlatformData?.services.find(s => s.id === serviceId)?.lastSync || null;

  return (
    <div className="space-y-6">
      {totalConnected > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><Zap className="w-5 h-5 text-emerald-600" /></div>
              <div>
                <p className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">{totalConnected} service{totalConnected > 1 ? "s" : ""} connecte{totalConnected > 1 ? "s" : ""} au total</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{platformsData.filter(p => p.connectedCount > 0).map(p => `${p.name}: ${p.connectedCount}/${p.totalServices}`).join(" | ")}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchLogs(); }}>
              <History className="w-3.5 h-3.5 mr-1.5" />{showLogs ? "Masquer" : "Journal"}
            </Button>
          </div>
        </div>
      )}

      {showLogs && syncLogs.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4" /> Journal des connexions</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {syncLogs.slice(0, 20).map(log => (
                <div key={log.id} className="flex items-center gap-3 text-xs border-b pb-2 last:border-0">
                  <Badge variant="outline" className={`text-[9px] ${log.status === "succes" ? "text-emerald-600 border-emerald-300" : "text-red-600 border-red-300"}`}>{log.status}</Badge>
                  <Badge variant="secondary" className="text-[9px]">{PLATFORM_NAMES_MAP[log.platform] || log.platform}</Badge>
                  <span className="text-muted-foreground flex-1">{log.details}</span>
                  <span className="text-muted-foreground text-[10px] shrink-0">{new Date(log.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        {([
          { id: "google" as const, name: "Google Workspace", icon: Globe, color: "blue", badges: ["Gmail", "Drive", "Calendar"], services: GOOGLE_SERVICES },
          { id: "microsoft" as const, name: "Microsoft 365", icon: AppWindow, color: "[#0078D4]", badges: ["Outlook", "Teams", "OneDrive"], services: MICROSOFT_SERVICES },
          { id: "apple" as const, name: "Apple / iCloud", icon: Smartphone, color: "gray-800", badges: ["iCloud", "FaceTime", "Pages"], services: APPLE_SERVICES },
        ]).map(plat => {
          const pd = platformsData.find(p => p.id === plat.id);
          const connCount = pd?.connectedCount || 0;
          const isActive = activePlatform === plat.id;
          const activeColors = plat.id === "google" ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-500/30" : plat.id === "microsoft" ? "border-[#0078D4] bg-[#0078D4]/5 dark:bg-[#0078D4]/10 ring-1 ring-[#0078D4]/30" : "border-gray-800 bg-gray-50 dark:bg-gray-900/30 ring-1 ring-gray-800/30";
          const iconBg = plat.id === "google" ? (isActive ? "bg-blue-100 dark:bg-blue-900/30" : "bg-muted") : plat.id === "microsoft" ? (isActive ? "bg-[#0078D4]/10" : "bg-muted") : (isActive ? "bg-gray-200 dark:bg-gray-800" : "bg-muted");
          const iconColor = plat.id === "google" ? (isActive ? "text-blue-600" : "text-muted-foreground") : plat.id === "microsoft" ? (isActive ? "text-[#0078D4]" : "text-muted-foreground") : (isActive ? "text-gray-800 dark:text-gray-200" : "text-muted-foreground");
          return (
            <button key={plat.id} onClick={() => setActivePlatform(plat.id)} className={`relative border rounded-xl p-4 text-left transition-all ${isActive ? activeColors : "hover:border-muted-foreground/30"}`}>
              {connCount > 0 && <div className="absolute top-2 right-2"><Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[9px]">{connCount}/{plat.services.length}</Badge></div>}
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg ${iconBg}`}><plat.icon className={`w-5 h-5 ${iconColor}`} /></div>
                <div><h3 className="font-semibold text-sm">{plat.name}</h3><p className="text-[10px] text-muted-foreground">{connCount > 0 ? `${connCount} connecte${connCount > 1 ? "s" : ""}` : `${plat.services.length} services`}</p></div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {plat.badges.map(b => <Badge key={b} variant="outline" className="text-[10px]">{b}</Badge>)}
                <Badge variant="outline" className="text-[10px]">+{plat.services.length - 3}</Badge>
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {activePlatform === "google" && <Globe className="w-5 h-5 text-blue-600" />}
                {activePlatform === "microsoft" && <AppWindow className="w-5 h-5 text-[#0078D4]" />}
                {activePlatform === "apple" && <Smartphone className="w-5 h-5 text-gray-800 dark:text-gray-200" />}
                {activePlatform === "google" && "Google Workspace - Toutes les applications"}
                {activePlatform === "microsoft" && "Microsoft 365 - Toutes les applications"}
                {activePlatform === "apple" && "Apple / iCloud - Toutes les applications"}
              </CardTitle>
              <CardDescription className="mt-1">
                {activePlatform === "google" && "L'agent est compatible avec l'ensemble de l'ecosysteme Google. Connectez chaque service pour une integration complete."}
                {activePlatform === "microsoft" && "Integration complete avec Microsoft 365. Connectez Outlook, Teams, OneDrive et tous les outils de productivite Microsoft."}
                {activePlatform === "apple" && "Compatibilite avec l'ecosysteme Apple. Synchronisez iCloud, Calendrier, Contacts et tous les services Apple professionnels."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {currentPlatformData && currentPlatformData.connectedCount > 0 && (
                <Button variant="outline" size="sm" className="text-xs" onClick={handleSync} disabled={syncingPlatform !== null}>
                  {syncingPlatform === activePlatform ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}Synchroniser
                </Button>
              )}
              {activePlatform === "google" && !googleOAuthConfigured && (
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowGoogleConfig(true)}><KeyRound className="w-3.5 h-3.5 mr-1.5" />Configurer OAuth</Button>
              )}
              {activePlatform === "google" ? (
                googleOAuthAuthenticated ? (
                  <Button variant="outline" size="sm" className="text-xs" onClick={handleGoogleOAuthDisconnect}><Unplug className="w-3.5 h-3.5 mr-1.5" />Deconnecter Google</Button>
                ) : (
                  <Button variant="default" size="sm" className="text-xs" onClick={() => handleGoogleOAuthConnect()} disabled={googleConnecting}>
                    {googleConnecting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plug className="w-3.5 h-3.5 mr-1.5" />}Connecter Google OAuth
                  </Button>
                )
              ) : (
                <Button variant={currentPlatformData && currentPlatformData.connectedCount === currentPlatformData.totalServices ? "outline" : "default"} size="sm" className="text-xs" onClick={handleConnectAll} disabled={connectingAll !== null}>
                  {connectingAll === activePlatform ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : currentPlatformData && currentPlatformData.connectedCount === currentPlatformData.totalServices ? <Unplug className="w-3.5 h-3.5 mr-1.5" /> : <Plug className="w-3.5 h-3.5 mr-1.5" />}
                  {currentPlatformData && currentPlatformData.connectedCount === currentPlatformData.totalServices ? "Tout deconnecter" : "Tout connecter"}
                </Button>
              )}
            </div>
          </div>
          {currentPlatformData && currentPlatformData.connectedCount > 0 && (
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{currentPlatformData.connectedCount} connecte{currentPlatformData.connectedCount > 1 ? "s" : ""}</span>
              <span className="flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-muted-foreground" />{currentPlatformData.totalServices - currentPlatformData.connectedCount} non connecte{(currentPlatformData.totalServices - currentPlatformData.connectedCount) > 1 ? "s" : ""}</span>
              {currentPlatformData.lastSync && <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Derniere sync: {new Date(currentPlatformData.lastSync).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {activePlatform === "google" && showGoogleConfig && (
            <div className="p-4 rounded-lg border border-amber-200 bg-amber-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-600" /><h4 className="text-sm font-semibold">Configuration Google OAuth</h4></div>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowGoogleConfig(false)}>Fermer</Button>
              </div>
              <p className="text-xs text-muted-foreground">Saisissez vos identifiants Google Cloud (console.cloud.google.com &gt; Identifiants &gt; OAuth 2.0).</p>
              <div className="space-y-2">
                <div><Label className="text-xs">Client ID</Label><Input type="text" placeholder="xxxxxxxx.apps.googleusercontent.com" value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Client Secret</Label><Input type="password" placeholder="GOCSPX-xxxxxxxxxxxxxxxx" value={googleClientSecret} onChange={(e) => setGoogleClientSecret(e.target.value)} className="h-8 text-xs" /></div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setShowGoogleConfig(false)}>Annuler</Button>
                <Button size="sm" className="text-xs h-7" onClick={handleSaveGoogleConfig} disabled={savingGoogleConfig || !googleClientId || !googleClientSecret}>
                  {savingGoogleConfig ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Enregistrer
                </Button>
              </div>
            </div>
          )}

          {activePlatform === "google" && googleOAuthConfigured && !googleOAuthAuthenticated && !showGoogleConfig && (
            <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-blue-600" /><div><p className="text-xs font-medium">Google OAuth configure</p><p className="text-[10px] text-muted-foreground">Cliquez sur "Connecter Google OAuth" pour autoriser l'acces a vos services Google.</p></div></div>
              <Button size="sm" className="text-xs h-7" onClick={() => handleGoogleOAuthConnect()} disabled={googleConnecting}>{googleConnecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plug className="w-3 h-3 mr-1" />}Connecter</Button>
            </div>
          )}

          {activePlatform === "google" && googleOAuthAuthenticated && (
            <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600" /><div><p className="text-xs font-medium text-emerald-800">Compte Google connecte</p><p className="text-[10px] text-muted-foreground">Les services Google Workspace sont actifs et synchronises.</p></div></div>
              <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px]">OAuth actif</Badge>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input type="search" placeholder={`Rechercher une application ${activePlatform === "google" ? "Google" : activePlatform === "microsoft" ? "Microsoft" : "Apple"}...`} className="pl-9"
              value={activePlatform === "google" ? googleSearch : activePlatform === "microsoft" ? msSearch : appleSearch}
              onChange={(e) => { if (activePlatform === "google") setGoogleSearch(e.target.value); else if (activePlatform === "microsoft") setMsSearch(e.target.value); else setAppleSearch(e.target.value); }}
            />
          </div>

          {(() => {
            const services = activePlatform === "google" ? GOOGLE_SERVICES : activePlatform === "microsoft" ? MICROSOFT_SERVICES : APPLE_SERVICES;
            const categories = activePlatform === "google" ? GOOGLE_CATEGORIES : activePlatform === "microsoft" ? MICROSOFT_CATEGORIES : APPLE_CATEGORIES;
            const filter = activePlatform === "google" ? googleFilter : activePlatform === "microsoft" ? msFilter : appleFilter;
            const setFilter = activePlatform === "google" ? setGoogleFilter : activePlatform === "microsoft" ? setMsFilter : setAppleFilter;
            const search = activePlatform === "google" ? googleSearch : activePlatform === "microsoft" ? msSearch : appleSearch;
            return (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant={filter === "tous" ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setFilter("tous")}>Tous ({services.length})</Button>
                  {Object.entries(categories).map(([key, cat]) => {
                    const cnt = services.filter(s => s.categorie === key).length;
                    if (cnt === 0) return null;
                    return <Button key={key} variant={filter === key ? "default" : "outline"} size="sm" className="text-xs h-7" onClick={() => setFilter(key)}>{cat.label} ({cnt})</Button>;
                  })}
                </div>
                <div className="grid gap-3">
                  {services.filter(s => filter === "tous" || s.categorie === filter).filter(s => { if (!search) return true; const q = search.toLowerCase(); return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q); }).map((service) => {
                    const svcStatus = getServiceStatus(service.id);
                    const isConnected = svcStatus === "connecte";
                    const isLoading = connectingService === `${activePlatform}:${service.id}`;
                    const lastSyncTime = getServiceLastSync(service.id);
                    return (
                      <div key={service.id} className={`border rounded-xl p-4 transition-colors ${isConnected ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10" : "hover:border-primary/30"}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-4">
                            <div className={`p-2.5 rounded-lg ${isConnected ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-muted"}`}>
                              <service.icon className={`w-5 h-5 ${isConnected ? "text-emerald-600" : "text-muted-foreground"}`} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-sm">{service.name}</h3>
                                <Badge className={(categories[service.categorie]?.couleur || "bg-gray-100 text-gray-700") + " border-0 text-[10px]"}>{categories[service.categorie]?.label || service.categorie}</Badge>
                                {isConnected ? <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Connecte</Badge> : <Badge variant="secondary" className="text-[10px]">Non connecte</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground mb-2">{service.description}</p>
                              {isConnected && lastSyncTime && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1"><Clock className="w-3 h-3" />Derniere sync: {new Date(lastSyncTime).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>}
                              <div className="grid grid-cols-2 gap-1.5">
                                {service.features.map((feature, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground"><div className={`w-1 h-1 rounded-full ${isConnected ? "bg-emerald-500" : "bg-primary/50"}`} />{feature}</div>
                                ))}
                              </div>
                            </div>
                          </div>
                          <Button variant={isConnected ? "outline" : "default"} size="sm" className={`shrink-0 ${isConnected ? "text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200" : ""}`} onClick={() => handleConnect(service.id, service.name)} disabled={isLoading}>
                            {isLoading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : isConnected ? <Unplug className="w-3.5 h-3.5 mr-1.5" /> : <Link2 className="w-3.5 h-3.5 mr-1.5" />}
                            {isLoading ? "En cours..." : isConnected ? "Deconnecter" : "Connecter"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-900/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400"><ShieldAlert className="w-5 h-5" />Securite Workspace - Protection des fichiers</CardTitle>
              <CardDescription className="mt-1">Controle strict des telechargements, envois et fichiers. Seul le Super Administrateur peut autoriser les telechargements.</CardDescription>
            </div>
            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0"><ShieldCheck className="w-3 h-3 mr-1" />Protection maximale</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <ShieldBan className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-semibold text-sm text-red-800 dark:text-red-300">Blocage des telechargements externes</h4>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">Tous les fichiers provenant de sources externes (Drive, e-mails, liens partages) sont bloques par defaut. Seul un Super Administrateur peut autoriser le telechargement apres verification.</p>
              </div>
            </div>
          </div>
          {[
            { icon: Download, color: "text-red-500", label: "Bloquer tous les telechargements externes", desc: "Aucun fichier externe ne peut etre telecharge sans autorisation", checked: blockExternalDownloads, onChange: setBlockExternalDownloads },
            { icon: UserCog, color: "text-amber-600", label: "Telechargement reserve au Super Administrateur", desc: "Seul le super admin peut telecharger des fichiers apres verification manuelle", checked: superAdminOnlyDownload, onChange: setSuperAdminOnlyDownload },
            { icon: Upload, color: "text-red-500", label: "Bloquer les envois de fichiers externes", desc: "Empecher l'envoi de fichiers vers des destinations externes non autorisees", checked: blockExternalUploads, onChange: setBlockExternalUploads },
            { icon: Ban, color: "text-red-500", label: "Bloquer le partage externe", desc: "Interdire le partage de documents avec des utilisateurs hors de l'organisation", checked: externalSharingBlocked, onChange: setExternalSharingBlocked },
          ].map((item, i) => (
            <div key={item.label}>
              {i > 0 && <Separator className="mb-5" />}
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3"><item.icon className={`w-4 h-4 ${item.color} mt-0.5`} /><div><Label>{item.label}</Label><p className="text-xs text-muted-foreground">{item.desc}</p></div></div>
                <Switch checked={item.checked} onCheckedChange={item.onChange} />
              </div>
            </div>
          ))}
          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3"><FileX className="w-4 h-4 text-red-500 mt-0.5" /><div><Label>Taille maximale des fichiers</Label><p className="text-xs text-muted-foreground">Limite de taille pour les fichiers autorises (en Mo)</p></div></div>
            <Select value={maxFileSize} onValueChange={setMaxFileSize}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="5">5 Mo</SelectItem><SelectItem value="10">10 Mo</SelectItem><SelectItem value="25">25 Mo</SelectItem><SelectItem value="50">50 Mo</SelectItem></SelectContent></Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-orange-200 dark:border-orange-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400"><Bug className="w-5 h-5" />Analyse antivirus et anti-malware</CardTitle>
          <CardDescription>Analyse automatique de tous les fichiers et pieces jointes. Detection des menaces en temps reel par IA.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-center"><p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{SCAN_STATS.totalScanned.toLocaleString("fr-FR")}</p><p className="text-[10px] text-emerald-600 dark:text-emerald-500">Fichiers analyses</p></div>
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center"><p className="text-lg font-bold text-red-700 dark:text-red-400">{SCAN_STATS.threatsBlocked}</p><p className="text-[10px] text-red-600 dark:text-red-500">Menaces bloquees</p></div>
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-center"><p className="text-lg font-bold text-amber-700 dark:text-amber-400">{SCAN_STATS.quarantined}</p><p className="text-[10px] text-amber-600 dark:text-amber-500">En quarantaine</p></div>
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-center"><p className="text-lg font-bold text-blue-700 dark:text-blue-400">{SCAN_STATS.lastScan}</p><p className="text-[10px] text-blue-600 dark:text-blue-500">Derniere analyse</p></div>
          </div>
          <Separator />
          {[
            { icon: Mail, color: "text-orange-500", label: "Analyser tous les e-mails entrants", desc: "Scanner chaque e-mail pour detecter les virus, liens malveillants et tentatives de phishing", checked: virusScanEmails, onChange: setVirusScanEmails },
            { icon: FileWarning, color: "text-orange-500", label: "Analyser toutes les pieces jointes", desc: "Analyse approfondie de chaque piece jointe avant ouverture ou telechargement", checked: virusScanAttachments, onChange: setVirusScanAttachments },
            { icon: FolderOpen, color: "text-orange-500", label: "Analyser les fichiers Google Drive", desc: "Analyse en continu de tous les fichiers stockes et partages dans Drive", checked: virusScanDrive, onChange: setVirusScanDrive },
            { icon: ShieldAlert, color: "text-red-500", label: "Mise en quarantaine automatique", desc: "Isoler automatiquement les fichiers suspects avant toute action humaine", checked: quarantineSuspicious, onChange: setQuarantineSuspicious },
            { icon: ScanSearch, color: "text-purple-500", label: "Analyse en bac a sable (Sandbox)", desc: "Executer les fichiers suspects dans un environnement isole pour detecter les comportements malveillants", checked: sandboxAnalysis, onChange: setSandboxAnalysis },
            { icon: Eye, color: "text-purple-500", label: "Detection IA des menaces avancees", desc: "L'intelligence artificielle analyse les patterns pour detecter les menaces zero-day et APT", checked: aiThreatDetection, onChange: setAiThreatDetection },
            { icon: ShieldCheck, color: "text-emerald-500", label: "Protection en temps reel", desc: "Surveillance continue avec mise a jour des signatures toutes les 15 minutes", checked: realTimeProtection, onChange: setRealTimeProtection },
          ].map((item, i) => (
            <div key={item.label}>
              {i > 0 && <Separator className="mb-5" />}
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3"><item.icon className={`w-4 h-4 ${item.color} mt-0.5`} /><div><Label>{item.label}</Label><p className="text-xs text-muted-foreground">{item.desc}</p></div></div>
                <Switch checked={item.checked} onCheckedChange={item.onChange} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-purple-200 dark:border-purple-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-400"><FileX className="w-5 h-5" />Types de fichiers bloques</CardTitle>
          <CardDescription>Les fichiers avec ces extensions sont systematiquement bloques, meme pour le Super Administrateur.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {[
            { icon: Ban, label: "Bloquer les fichiers executables", desc: ".exe, .bat, .cmd, .com, .scr, .pif, .msi, .dll et autres executables", checked: blockExecutables, onChange: setBlockExecutables },
            { icon: FileWarning, label: "Bloquer les macros Office", desc: "Empecher l'ouverture de fichiers contenant des macros VBA potentiellement dangereuses", checked: blockMacros, onChange: setBlockMacros },
            { icon: Lock, label: "Bloquer les fichiers chiffres/proteges", desc: "Les fichiers chiffres ne peuvent pas etre analyses - bloques par precaution", checked: blockEncryptedFiles, onChange: setBlockEncryptedFiles },
          ].map((item, i) => (
            <div key={item.label}>
              {i > 0 && <Separator className="mb-5" />}
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3"><item.icon className="w-4 h-4 text-red-500 mt-0.5" /><div><Label>{item.label}</Label><p className="text-xs text-muted-foreground">{item.desc}</p></div></div>
                <Switch checked={item.checked} onCheckedChange={item.onChange} />
              </div>
            </div>
          ))}
          <Separator />
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs font-medium mb-2">Extensions systematiquement bloquees :</p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCKED_EXTENSIONS.map((ext) => <Badge key={ext} variant="outline" className="text-[10px] text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">{ext}</Badge>)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-blue-200 dark:border-blue-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-400"><AlertTriangle className="w-5 h-5" />Protection anti-phishing et anti-spoofing</CardTitle>
          <CardDescription>Detection avancee des tentatives de phishing, d'usurpation d'identite et de liens malveillants dans les e-mails.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { icon: Mail, label: "Protection anti-phishing", desc: "Detecter et bloquer les e-mails de phishing (faux expediteurs, liens trompeurs)", checked: phishingProtection, onChange: setPhishingProtection },
            { icon: Fingerprint, label: "Protection anti-usurpation (Spoofing)", desc: "Verifier SPF, DKIM et DMARC pour chaque e-mail entrant", checked: spoofingProtection, onChange: setSpoofingProtection },
            { icon: ExternalLink, label: "Verification de securite des liens", desc: "Analyser chaque lien dans les e-mails avant de permettre l'acces", checked: linkSafetyCheck, onChange: setLinkSafetyCheck },
          ].map((item, i) => (
            <div key={item.label}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3"><item.icon className="w-4 h-4 text-blue-500 mt-0.5" /><div><Label>{item.label}</Label><p className="text-xs text-muted-foreground">{item.desc}</p></div></div>
                <Switch checked={item.checked} onCheckedChange={item.onChange} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-amber-200 dark:border-amber-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400"><Eye className="w-5 h-5" />Prevention des fuites de donnees (DLP)</CardTitle>
          <CardDescription>Empecher la fuite de donnees sensibles via e-mails, fichiers partages ou documents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { icon: Shield, label: "Protection DLP active", desc: "Analyser le contenu sortant pour detecter les donnees sensibles (IBAN, CB, NIR, mots de passe)", checked: dlpEnabled, onChange: setDlpEnabled },
            { icon: Ban, label: "Bloquer l'envoi de donnees sensibles", desc: "Empecher automatiquement l'envoi d'e-mails contenant des donnees personnelles non autorisees", checked: dlpBlockSensitiveData, onChange: setDlpBlockSensitiveData },
            { icon: Bell, label: "Notifier le Super Administrateur", desc: "Alerte immediate au super admin en cas de tentative de fuite de donnees", checked: dlpNotifyAdmin, onChange: setDlpNotifyAdmin },
          ].map((item, i) => (
            <div key={item.label}>
              {i > 0 && <Separator className="mb-4" />}
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3"><item.icon className="w-4 h-4 text-amber-500 mt-0.5" /><div><Label>{item.label}</Label><p className="text-xs text-muted-foreground">{item.desc}</p></div></div>
                <Switch checked={item.checked} onCheckedChange={item.onChange} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Synchronisation</CardTitle>
          <CardDescription>Configurez la frequence et le sens de la synchronisation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between"><div><Label>Synchronisation automatique</Label><p className="text-xs text-muted-foreground">Synchroniser les donnees toutes les 15 minutes</p></div><Switch defaultChecked /></div>
          <Separator />
          <div className="flex items-center justify-between"><div><Label>Synchronisation bidirectionnelle</Label><p className="text-xs text-muted-foreground">Les modifications dans les plateformes connectees se refletent ici et inversement</p></div><Switch defaultChecked /></div>
          <Separator />
          <div className="flex items-center justify-between"><div><Label>Import automatique des contacts</Label><p className="text-xs text-muted-foreground">Importer les nouveaux contacts depuis les plateformes automatiquement</p></div><Switch /></div>
        </CardContent>
      </Card>
    </div>
  );
}
