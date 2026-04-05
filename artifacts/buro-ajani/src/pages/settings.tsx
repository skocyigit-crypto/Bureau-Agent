import { useState, useEffect, useCallback } from "react";
import {
  Globe, Shield, Bell, Link2, CheckCircle2,
  XCircle, ExternalLink, Calendar, Mail, FolderOpen, FileText, Table2,
  Presentation, RefreshCw, PhoneIncoming, Clock, Lock, ShieldAlert,
  ShieldCheck, ShieldBan, FileWarning, Download, Upload, Bug, Eye, UserCog,
  AlertTriangle, Server, KeyRound, Fingerprint, ScanSearch, FileX, Ban,
  TriangleAlert, CircleAlert, Monitor, Laptop, Smartphone, Wifi, HardDrive,
  CloudDownload, Share2, Package, Cpu, RefreshCcw, CheckCheck, Save, HardDriveUpload,
  Video, MessageCircle, MapPin, StickyNote, ListChecks, Users, Image,
  BarChart3, Megaphone, Search, Cloud, Settings, BookOpen, Bookmark,
  Languages, ShieldQuestion, Radio, Store, ClipboardList, Play,
  Building2, Headphones, Database, PenTool, Layout, Kanban, Newspaper,
  Workflow, AppWindow, HardDriveDownload, Layers, Loader2, Unplug, Plug, Zap, History
} from "lucide-react";
import { PhoneSimulator, PhoneSimulatorDialog } from "@/components/phone-simulator";
import { Icon3D } from "@/components/icon-3d";
import securityServerImg from "@/assets/images/security-server.png";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useSimulateCall } from "@/components/layout";
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

const GOOGLE_CATEGORIES: Record<string, { label: string; couleur: string }> = {
  productivite: { label: "Productivite", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  communication: { label: "Communication", couleur: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  stockage: { label: "Stockage", couleur: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  analyse: { label: "Analyse", couleur: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  marketing: { label: "Marketing", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  administration: { label: "Administration", couleur: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
};

const GOOGLE_SERVICES: GoogleService[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Envoyer et recevoir des e-mails directement depuis l'application. Synchroniser les messages avec les contacts.",
    icon: Mail,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Envoi d'e-mails depuis la fiche contact",
      "Synchronisation des conversations",
      "Modeles d'e-mails professionnels",
      "Suivi des ouvertures",
    ],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Synchroniser les rendez-vous, planifier des appels de suivi et consulter la disponibilite des contacts.",
    icon: Calendar,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Planification automatique des rappels",
      "Synchronisation bidirectionnelle des evenements",
      "Verification de disponibilite avant appel",
      "Rappels de suivi intelligents",
    ],
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Joindre des documents aux appels et contacts. Stocker les comptes rendus automatiquement.",
    icon: FolderOpen,
    status: "deconnecte",
    categorie: "stockage",
    features: [
      "Pieces jointes aux fiches contact",
      "Stockage des comptes rendus d'appel",
      "Partage de documents securise",
      "Recherche dans les documents",
    ],
  },
  {
    id: "docs",
    name: "Google Docs",
    description: "Creer des comptes rendus de reunion et rapports d'activite directement depuis l'application.",
    icon: FileText,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Generation de comptes rendus IA",
      "Modeles de rapports",
      "Collaboration en temps reel",
      "Export PDF automatique",
    ],
  },
  {
    id: "sheets",
    name: "Google Sheets",
    description: "Exporter des donnees vers des feuilles de calcul et importer des listes de contacts.",
    icon: Table2,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Export des rapports d'activite",
      "Import de contacts en masse",
      "Tableaux croises dynamiques",
      "Mise a jour en temps reel",
    ],
  },
  {
    id: "slides",
    name: "Google Slides",
    description: "Generer des presentations de performance et de synthese pour les reunions d'equipe.",
    icon: Presentation,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Rapports de performance hebdomadaires",
      "Presentations client automatisees",
      "Graphiques integres",
      "Export pour reunions",
    ],
  },
  {
    id: "meet",
    name: "Google Meet",
    description: "Lancer des visioconferences directement depuis l'application. Planifier des reunions avec les contacts.",
    icon: Video,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Visioconference depuis la fiche contact",
      "Planification automatique des reunions",
      "Enregistrement des reunions",
      "Transcription IA des echanges",
    ],
  },
  {
    id: "chat",
    name: "Google Chat",
    description: "Messagerie instantanee avec les equipes et contacts. Espaces de travail collaboratifs.",
    icon: MessageCircle,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Messages directs aux collegues",
      "Espaces de travail par projet",
      "Partage de fichiers en temps reel",
      "Notifications d'activite bureau",
    ],
  },
  {
    id: "contacts",
    name: "Google Contacts",
    description: "Synchroniser le repertoire Google avec la base de contacts de l'agent. Import et export automatiques.",
    icon: Users,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Synchronisation bidirectionnelle",
      "Fusion des doublons automatique",
      "Import par groupes et labels",
      "Mise a jour des coordonnees",
    ],
  },
  {
    id: "tasks",
    name: "Google Tasks",
    description: "Synchroniser les taches Google avec les taches de l'agent. Suivi unifie des actions a realiser.",
    icon: ListChecks,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Synchronisation des taches",
      "Dates limites partagees",
      "Sous-taches et priorites",
      "Integration avec Calendar",
    ],
  },
  {
    id: "keep",
    name: "Google Keep",
    description: "Prendre des notes rapides pendant les appels. Synchroniser les notes avec les fiches contact.",
    icon: StickyNote,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Notes rapides pendant l'appel",
      "Listes de verification",
      "Notes vocales transcrites",
      "Organisation par labels",
    ],
  },
  {
    id: "forms",
    name: "Google Forms",
    description: "Creer des formulaires de satisfaction, enquetes et questionnaires pour les clients et contacts.",
    icon: ClipboardList,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Enquetes de satisfaction client",
      "Formulaires de feedback post-appel",
      "Collecte automatique des reponses",
      "Analyse des resultats",
    ],
  },
  {
    id: "maps",
    name: "Google Maps",
    description: "Localiser les contacts et clients sur la carte. Planifier les deplacements et visites terrain.",
    icon: MapPin,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Geolocalisation des contacts",
      "Planification des visites",
      "Calcul d'itineraires optimises",
      "Zones de couverture commerciale",
    ],
  },
  {
    id: "photos",
    name: "Google Photos",
    description: "Stocker et partager les photos de documents, cartes de visite et preuves visuelles.",
    icon: Image,
    status: "deconnecte",
    categorie: "stockage",
    features: [
      "Scan de cartes de visite",
      "Photos de documents",
      "Partage securise d'images",
      "Reconnaissance OCR IA",
    ],
  },
  {
    id: "analytics",
    name: "Google Analytics",
    description: "Analyser le trafic du site web de l'entreprise. Mesurer les conversions et la performance digitale.",
    icon: BarChart3,
    status: "deconnecte",
    categorie: "analyse",
    features: [
      "Suivi du trafic web",
      "Analyse des conversions",
      "Rapports de performance",
      "Attribution des leads",
    ],
  },
  {
    id: "ads",
    name: "Google Ads",
    description: "Gerer les campagnes publicitaires. Suivre les performances et le retour sur investissement.",
    icon: Megaphone,
    status: "deconnecte",
    categorie: "marketing",
    features: [
      "Suivi des campagnes actives",
      "Performance des annonces",
      "Budget et depenses en temps reel",
      "Integration des leads entrants",
    ],
  },
  {
    id: "search-console",
    name: "Google Search Console",
    description: "Surveiller la presence de l'entreprise dans les resultats de recherche Google.",
    icon: Search,
    status: "deconnecte",
    categorie: "analyse",
    features: [
      "Position dans les resultats",
      "Analyse des requetes",
      "Alertes de problemes",
      "Performance mobile",
    ],
  },
  {
    id: "my-business",
    name: "Google Business Profile",
    description: "Gerer la fiche d'entreprise Google. Repondre aux avis et mettre a jour les informations.",
    icon: Store,
    status: "deconnecte",
    categorie: "marketing",
    features: [
      "Gestion des avis clients",
      "Mise a jour des horaires",
      "Photos et publications",
      "Statistiques de visibilite",
    ],
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Gerer la chaine YouTube de l'entreprise. Integrer les videos dans les communications.",
    icon: Radio,
    status: "deconnecte",
    categorie: "marketing",
    features: [
      "Gestion de la chaine",
      "Statistiques des videos",
      "Integration dans les e-mails",
      "Alertes sur les commentaires",
    ],
  },
  {
    id: "cloud",
    name: "Google Cloud Platform",
    description: "Infrastructure cloud pour l'hebergement, le stockage et les services IA avances.",
    icon: Cloud,
    status: "deconnecte",
    categorie: "administration",
    features: [
      "Hebergement des donnees",
      "Services IA et Machine Learning",
      "Stockage securise",
      "Monitoring et alertes",
    ],
  },
  {
    id: "voice",
    name: "Google Voice",
    description: "Telephonie cloud integree. Numeros virtuels et transfert d'appels professionnel.",
    icon: PhoneIncoming,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Numeros virtuels francais",
      "Transfert d'appels intelligent",
      "Messagerie vocale transcrite",
      "Historique d'appels unifie",
    ],
  },
  {
    id: "translate",
    name: "Google Translate",
    description: "Traduction automatique des e-mails, documents et conversations avec les contacts internationaux.",
    icon: Languages,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Traduction d'e-mails entrants",
      "Traduction de documents",
      "Detection automatique de langue",
      "Support de 133 langues",
    ],
  },
  {
    id: "admin",
    name: "Google Workspace Admin",
    description: "Administration centralisee du domaine Google Workspace. Gestion des utilisateurs et des politiques.",
    icon: Settings,
    status: "deconnecte",
    categorie: "administration",
    features: [
      "Gestion des utilisateurs",
      "Politiques de securite",
      "Rapports d'audit",
      "Configuration du domaine",
    ],
  },
  {
    id: "sites",
    name: "Google Sites",
    description: "Creer des sites web internes pour l'equipe. Documentation et portail collaborateur.",
    icon: BookOpen,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Portail interne d'equipe",
      "Documentation partagee",
      "Pages de projet",
      "Integration Workspace native",
    ],
  },
  {
    id: "vault",
    name: "Google Vault",
    description: "Archivage et conservation legale des donnees. Recherche et export pour conformite.",
    icon: ShieldQuestion,
    status: "deconnecte",
    categorie: "administration",
    features: [
      "Archivage des e-mails",
      "Conservation legale",
      "Recherche dans les archives",
      "Export pour audit et conformite",
    ],
  },
  {
    id: "classroom",
    name: "Google Classroom",
    description: "Formation et integration des nouveaux agents. Modules de formation et evaluations.",
    icon: Bookmark,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Modules de formation agent",
      "Evaluations et quiz",
      "Suivi de progression",
      "Ressources pedagogiques",
    ],
  },
];

interface PlatformService {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: "connecte" | "deconnecte" | "en_attente";
  features: string[];
  categorie: string;
}

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
  {
    id: "outlook",
    name: "Microsoft Outlook",
    description: "Messagerie professionnelle, calendrier et gestion des contacts. Synchronisation complete avec l'agent.",
    icon: Mail,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Synchronisation bidirectionnelle des e-mails",
      "Calendrier partage avec l'equipe",
      "Gestion des contacts Outlook",
      "Regles de tri automatique des messages",
    ],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Communication d'equipe, appels video et collaboration en temps reel integres a l'agent.",
    icon: Video,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Appels video depuis la fiche contact",
      "Channels par projet ou equipe",
      "Partage d'ecran pendant les appels",
      "Notifications d'activite en temps reel",
    ],
  },
  {
    id: "onedrive",
    name: "Microsoft OneDrive",
    description: "Stockage cloud et partage de documents. Synchronisation des fichiers avec l'agent de bureau.",
    icon: Cloud,
    status: "deconnecte",
    categorie: "stockage",
    features: [
      "Stockage des comptes rendus d'appel",
      "Partage securise de documents",
      "Versioning automatique des fichiers",
      "Acces hors ligne aux documents cles",
    ],
  },
  {
    id: "word",
    name: "Microsoft Word",
    description: "Creer et editer des documents professionnels, rapports et comptes rendus directement.",
    icon: FileText,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Generation automatique de rapports",
      "Modeles de documents professionnels",
      "Co-edition en temps reel",
      "Export PDF et impression",
    ],
  },
  {
    id: "excel",
    name: "Microsoft Excel",
    description: "Tableurs et analyses de donnees. Export des statistiques d'appels et rapports financiers.",
    icon: Table2,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Export des donnees d'appels",
      "Tableaux croises dynamiques",
      "Graphiques de performance",
      "Import de listes de contacts",
    ],
  },
  {
    id: "powerpoint",
    name: "Microsoft PowerPoint",
    description: "Presentations professionnelles pour les reunions d'equipe et les bilans de performance.",
    icon: Presentation,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Rapports hebdomadaires automatises",
      "Modeles de presentation",
      "Graphiques integres depuis Excel",
      "Partage en reunion Teams",
    ],
  },
  {
    id: "sharepoint",
    name: "Microsoft SharePoint",
    description: "Portail intranet et gestion documentaire. Base de connaissances partagee pour l'equipe.",
    icon: Layout,
    status: "deconnecte",
    categorie: "collaboration",
    features: [
      "Portail intranet d'equipe",
      "Bibliotheques de documents partagees",
      "Workflows d'approbation",
      "Sites d'equipe par departement",
    ],
  },
  {
    id: "onenote",
    name: "Microsoft OneNote",
    description: "Prise de notes structuree pendant les appels. Carnets de notes partages avec l'equipe.",
    icon: StickyNote,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Notes d'appel en temps reel",
      "Carnets partages par equipe",
      "Capture d'ecran dans les notes",
      "Recherche dans toutes les notes",
    ],
  },
  {
    id: "planner",
    name: "Microsoft Planner",
    description: "Gestion de taches et de projets. Tableaux Kanban et suivi des actions de l'equipe.",
    icon: Kanban,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Synchronisation des taches",
      "Tableaux Kanban par projet",
      "Attribution et suivi des actions",
      "Integration avec Teams",
    ],
  },
  {
    id: "power-automate",
    name: "Microsoft Power Automate",
    description: "Automatisation des flux de travail. Declencheurs bases sur les appels et les evenements.",
    icon: Workflow,
    status: "deconnecte",
    categorie: "administration",
    features: [
      "Automatisation post-appel",
      "Declencheurs personnalises",
      "Integration multi-services",
      "Notifications automatiques",
    ],
  },
  {
    id: "power-bi",
    name: "Microsoft Power BI",
    description: "Tableaux de bord analytiques avances. Visualisation des KPI et performance de l'equipe.",
    icon: BarChart3,
    status: "deconnecte",
    categorie: "analyse",
    features: [
      "Dashboards en temps reel",
      "Rapports de performance KPI",
      "Visualisations interactives",
      "Partage des rapports avec la direction",
    ],
  },
  {
    id: "dynamics",
    name: "Microsoft Dynamics 365",
    description: "CRM et ERP integres. Gestion des relations client et suivi commercial complet.",
    icon: Users,
    status: "deconnecte",
    categorie: "analyse",
    features: [
      "Synchronisation des contacts CRM",
      "Historique d'appels dans Dynamics",
      "Suivi du pipeline commercial",
      "Rapports de ventes automatises",
    ],
  },
  {
    id: "intune",
    name: "Microsoft Intune",
    description: "Gestion des appareils et securite. Politiques de conformite pour les postes de travail.",
    icon: Laptop,
    status: "deconnecte",
    categorie: "securite",
    features: [
      "Gestion des appareils de l'equipe",
      "Politiques de securite centralisees",
      "Deploiement d'applications",
      "Conformite et rapports",
    ],
  },
  {
    id: "defender",
    name: "Microsoft Defender",
    description: "Protection avancee contre les menaces. Securite des e-mails, fichiers et postes de travail.",
    icon: ShieldCheck,
    status: "deconnecte",
    categorie: "securite",
    features: [
      "Protection anti-malware en temps reel",
      "Detection des menaces avancees",
      "Securite des e-mails Outlook",
      "Rapports de securite centralises",
    ],
  },
  {
    id: "azure-ad",
    name: "Microsoft Entra ID",
    description: "Gestion des identites et acces. Authentification unique (SSO) pour tous les services.",
    icon: KeyRound,
    status: "deconnecte",
    categorie: "securite",
    features: [
      "Authentification unique (SSO)",
      "Gestion des groupes et roles",
      "Politiques d'acces conditionnel",
      "Audit des connexions",
    ],
  },
  {
    id: "forms",
    name: "Microsoft Forms",
    description: "Formulaires et enquetes. Recueillir les avis des clients et les retours de l'equipe.",
    icon: ClipboardList,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Enquetes de satisfaction client",
      "Formulaires de feedback interne",
      "Quiz de formation",
      "Analyse des reponses",
    ],
  },
  {
    id: "bookings",
    name: "Microsoft Bookings",
    description: "Planification de rendez-vous en ligne. Les clients reservent des creneaux automatiquement.",
    icon: Calendar,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Page de reservation publique",
      "Synchronisation avec le calendrier",
      "Rappels automatiques par e-mail",
      "Gestion des disponibilites",
    ],
  },
  {
    id: "yammer",
    name: "Microsoft Viva Engage",
    description: "Reseau social d'entreprise. Communication interne et partage de connaissances.",
    icon: MessageCircle,
    status: "deconnecte",
    categorie: "collaboration",
    features: [
      "Fil d'actualite d'entreprise",
      "Communautes par centre d'interet",
      "Partage de connaissances",
      "Sondages et annonces",
    ],
  },
  {
    id: "admin-365",
    name: "Microsoft 365 Admin",
    description: "Administration centralisee de tous les services Microsoft 365. Gestion des licences et utilisateurs.",
    icon: Settings,
    status: "deconnecte",
    categorie: "administration",
    features: [
      "Gestion des licences utilisateurs",
      "Rapports d'utilisation",
      "Configuration des services",
      "Alertes de sante des services",
    ],
  },
];

const APPLE_CATEGORIES: Record<string, { label: string; couleur: string }> = {
  productivite: { label: "Productivite", couleur: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  communication: { label: "Communication", couleur: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  stockage: { label: "Stockage", couleur: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  creativite: { label: "Creativite", couleur: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" },
  securite: { label: "Securite", couleur: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const APPLE_SERVICES: PlatformService[] = [
  {
    id: "icloud-mail",
    name: "iCloud Mail",
    description: "Messagerie Apple professionnelle. Synchronisation des e-mails avec l'agent de bureau.",
    icon: Mail,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Envoi d'e-mails depuis la fiche contact",
      "Synchronisation des boites de reception",
      "Filtres et regles automatiques",
      "Alias de messagerie",
    ],
  },
  {
    id: "icloud-calendar",
    name: "Calendrier iCloud",
    description: "Gestion des rendez-vous et planification. Synchronisation avec tous les appareils Apple.",
    icon: Calendar,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Synchronisation des evenements",
      "Calendriers partages",
      "Invitations et reponses automatiques",
      "Rappels avant les appels",
    ],
  },
  {
    id: "icloud-drive",
    name: "iCloud Drive",
    description: "Stockage cloud Apple. Partage et synchronisation des documents entre appareils.",
    icon: Cloud,
    status: "deconnecte",
    categorie: "stockage",
    features: [
      "Stockage et partage de fichiers",
      "Synchronisation multi-appareils",
      "Dossiers partages avec l'equipe",
      "Acces depuis iPhone, iPad et Mac",
    ],
  },
  {
    id: "icloud-contacts",
    name: "Contacts iCloud",
    description: "Repertoire de contacts Apple. Synchronisation bidirectionnelle avec la base de contacts.",
    icon: Users,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Import automatique des contacts Apple",
      "Synchronisation bidirectionnelle",
      "Groupes et categories",
      "Cartes de visite partagees",
    ],
  },
  {
    id: "pages",
    name: "Apple Pages",
    description: "Creation de documents et rapports professionnels. Compatible avec les formats Word.",
    icon: FileText,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Documents et rapports professionnels",
      "Modeles pre-concus",
      "Export PDF et Word",
      "Collaboration en temps reel",
    ],
  },
  {
    id: "numbers",
    name: "Apple Numbers",
    description: "Tableurs et analyses de donnees. Export des statistiques et rapports financiers.",
    icon: Table2,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Export de donnees en tableur",
      "Graphiques interactifs",
      "Formules et calculs avances",
      "Compatible Excel",
    ],
  },
  {
    id: "keynote",
    name: "Apple Keynote",
    description: "Presentations professionnelles elegantes pour les reunions et bilans d'equipe.",
    icon: Presentation,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Presentations de qualite cinema",
      "Animations et transitions",
      "Export PowerPoint et PDF",
      "Presentation a distance",
    ],
  },
  {
    id: "facetime",
    name: "FaceTime",
    description: "Appels video de qualite professionnelle. Conferences avec les clients et l'equipe.",
    icon: Video,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Appels video HD avec les contacts",
      "Conferences de groupe",
      "Partage d'ecran integre",
      "Liens d'appel partageables",
    ],
  },
  {
    id: "imessage",
    name: "iMessage",
    description: "Messagerie instantanee securisee. Communication rapide avec les contacts professionnels.",
    icon: MessageCircle,
    status: "deconnecte",
    categorie: "communication",
    features: [
      "Messages chiffres de bout en bout",
      "Partage de fichiers et photos",
      "Reponses rapides",
      "Indicateurs de lecture",
    ],
  },
  {
    id: "notes",
    name: "Apple Notes",
    description: "Prise de notes pendant les appels. Synchronisation avec tous les appareils Apple.",
    icon: StickyNote,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Notes rapides pendant l'appel",
      "Dossiers organises",
      "Scan de documents integre",
      "Recherche dans les notes",
    ],
  },
  {
    id: "reminders",
    name: "Apple Rappels",
    description: "Gestion des taches et rappels. Synchronisation avec les taches de l'agent.",
    icon: ListChecks,
    status: "deconnecte",
    categorie: "productivite",
    features: [
      "Synchronisation des taches",
      "Rappels bases sur la localisation",
      "Listes partagees",
      "Priorites et dates limites",
    ],
  },
  {
    id: "find-my",
    name: "Localiser (Find My)",
    description: "Localisation des appareils de l'equipe. Securite et suivi des equipements professionnels.",
    icon: MapPin,
    status: "deconnecte",
    categorie: "securite",
    features: [
      "Localisation des appareils d'equipe",
      "Verrouillage a distance",
      "Alerte en cas de perte",
      "Historique de localisation",
    ],
  },
  {
    id: "apple-business",
    name: "Apple Business Manager",
    description: "Gestion centralisee des appareils Apple de l'entreprise. Deploiement et configuration.",
    icon: Building2,
    status: "deconnecte",
    categorie: "securite",
    features: [
      "Deploiement automatique des appareils",
      "Gestion des licences d'applications",
      "Inscription automatique MDM",
      "Comptes Apple geres",
    ],
  },
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

const PLATFORM_NAMES_MAP: Record<string, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
};

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/workspace";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("google");
  const [callRingDuration, setCallRingDuration] = useState("30");
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifAppels, setNotifAppels] = useState(true);
  const [notifTaches, setNotifTaches] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifIA, setNotifIA] = useState(true);

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
  const [forceReauth, setForceReauth] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [maxFileSize, setMaxFileSize] = useState("25");
  const [aiThreatDetection, setAiThreatDetection] = useState(true);
  const [realTimeProtection, setRealTimeProtection] = useState(true);
  const [zeroTrustMode, setZeroTrustMode] = useState(true);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);

  const [backups, setBackups] = useState<any[]>([]);
  const [backupStats, setBackupStats] = useState<any>(null);
  const [backupConfigs, setBackupConfigs] = useState<any[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [nextBackupMs, setNextBackupMs] = useState(0);

  const { simulateIncomingCall } = useSimulateCall();
  const { toast } = useToast();

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/platforms`);
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

  const fetchBackups = useCallback(async () => {
    setLoadingBackups(true);
    try {
      const [backupsRes, configRes, latestRes] = await Promise.all([
        fetch(`${API_BASE}/backups?limit=30`),
        fetch(`${API_BASE}/backups/config`),
        fetch(`${API_BASE}/backups/latest`),
      ]);
      if (backupsRes.ok) {
        const data = await backupsRes.json();
        setBackups(data.backups || []);
        setBackupStats(data.stats || null);
      }
      if (configRes.ok) {
        const data = await configRes.json();
        setBackupConfigs(data.configs || []);
      }
      if (latestRes.ok) {
        const data = await latestRes.json();
        setNextBackupMs(data.nextBackupMs || 0);
      }
    } catch (err) {
      console.error("Fetch backups error:", err);
    } finally {
      setLoadingBackups(false);
    }
  }, []);

  const handleManualBackup = async () => {
    setBackupRunning(true);
    try {
      const res = await fetch(`${API_BASE}/backups/manual`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Sauvegarde terminee", description: data.message });
        await fetchBackups();
      } else {
        toast({ title: "Erreur", description: "Impossible d'effectuer la sauvegarde.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur de connexion.", variant: "destructive" });
    } finally {
      setBackupRunning(false);
    }
  };

  useEffect(() => {
    fetchPlatforms();
  }, [fetchPlatforms]);

  useEffect(() => {
    if (activeTab === "sauvegardes") {
      fetchBackups();
      const interval = setInterval(fetchBackups, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchBackups]);

  const handleConnect = async (serviceId: string, serviceName: string) => {
    setConnectingService(`${activePlatform}:${serviceId}`);
    try {
      const currentPlatform = platformsData.find(p => p.id === activePlatform);
      const currentService = currentPlatform?.services.find(s => s.id === serviceId);
      const isConnected = currentService?.status === "connecte";
      const endpoint = isConnected ? "disconnect" : "connect";

      const res = await fetch(`${API_BASE}/${endpoint}/${activePlatform}/${serviceId}`, { method: "POST" });
      if (res.ok) {
        toast({
          title: isConnected ? "Service deconnecte" : "Service connecte",
          description: isConnected
            ? `${serviceName} a ete deconnecte.`
            : `${serviceName} a ete connecte avec succes.`,
        });
        await fetchPlatforms();
      } else {
        toast({ title: "Erreur", description: "Impossible de modifier la connexion.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" });
    } finally {
      setConnectingService(null);
    }
  };

  const handleConnectAll = async () => {
    setConnectingAll(activePlatform);
    try {
      const currentPlatform = platformsData.find(p => p.id === activePlatform);
      const allConnected = currentPlatform && currentPlatform.connectedCount === currentPlatform.totalServices;
      const endpoint = allConnected ? "disconnect-all" : "connect-all";

      const res = await fetch(`${API_BASE}/${endpoint}/${activePlatform}`, { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        toast({ title: "Erreur", description: errData?.error || "Impossible de modifier les connexions.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      toast({ title: allConnected ? "Tous deconnectes" : "Tous connectes", description: data.message });
      await fetchPlatforms();
    } catch {
      toast({ title: "Erreur", description: "Erreur reseau.", variant: "destructive" });
    } finally {
      setConnectingAll(null);
    }
  };

  const handleSync = async () => {
    setSyncingPlatform(activePlatform);
    try {
      const res = await fetch(`${API_BASE}/sync/${activePlatform}`, { method: "POST" });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        toast({ title: "Erreur", description: errData?.error || "Echec de la synchronisation.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      toast({ title: "Synchronisation terminee", description: data.message });
      await fetchPlatforms();
    } catch {
      toast({ title: "Erreur", description: "Erreur de synchronisation.", variant: "destructive" });
    } finally {
      setSyncingPlatform(null);
    }
  };

  const handleSecurityAction = (action: string) => {
    toast({
      title: "Action de securite",
      description: action,
    });
  };

  const currentPlatformData = platformsData.find(p => p.id === activePlatform);
  const getServiceStatus = (serviceId: string): string => {
    return currentPlatformData?.services.find(s => s.id === serviceId)?.status || "deconnecte";
  };
  const getServiceLastSync = (serviceId: string): string | null => {
    return currentPlatformData?.services.find(s => s.id === serviceId)?.lastSync || null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Settings} variant="slate" size="md" /> Parametres</h1>
        <p className="text-muted-foreground">Configuration de l'application et integrations.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-grid">
          <TabsTrigger value="google" className="gap-2">
            <Layers className="w-4 h-4" />
            Plateformes
          </TabsTrigger>
          <TabsTrigger value="appels" className="gap-2">
            <PhoneIncoming className="w-4 h-4" />
            Appels
          </TabsTrigger>
          <TabsTrigger value="sauvegardes" className="gap-2">
            <Save className="w-4 h-4" />
            Sauvegardes
          </TabsTrigger>
          <TabsTrigger value="installation" className="gap-2">
            <Monitor className="w-4 h-4" />
            Installation
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="securite" className="gap-2">
            <Shield className="w-4 h-4" />
            Securite
          </TabsTrigger>
        </TabsList>

        <TabsContent value="google" className="space-y-6 mt-6">
          {totalConnected > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                    <Zap className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">{totalConnected} service{totalConnected > 1 ? "s" : ""} connecte{totalConnected > 1 ? "s" : ""} au total</p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      {platformsData.filter(p => p.connectedCount > 0).map(p => `${p.name}: ${p.connectedCount}/${p.totalServices}`).join(" | ")}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchLogs(); }}>
                  <History className="w-3.5 h-3.5 mr-1.5" />
                  {showLogs ? "Masquer" : "Journal"}
                </Button>
              </div>
            </div>
          )}

          {showLogs && syncLogs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4" /> Journal des connexions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {syncLogs.slice(0, 20).map(log => (
                    <div key={log.id} className="flex items-center gap-3 text-xs border-b pb-2 last:border-0">
                      <Badge variant="outline" className={`text-[9px] ${log.status === "succes" ? "text-emerald-600 border-emerald-300" : "text-red-600 border-red-300"}`}>
                        {log.status}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px]">
                        {PLATFORM_NAMES_MAP[log.platform] || log.platform}
                      </Badge>
                      <span className="text-muted-foreground flex-1">{log.details}</span>
                      <span className="text-muted-foreground text-[10px] shrink-0">
                        {new Date(log.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
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
              const activeColors = plat.id === "google"
                ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-500/30"
                : plat.id === "microsoft"
                  ? "border-[#0078D4] bg-[#0078D4]/5 dark:bg-[#0078D4]/10 ring-1 ring-[#0078D4]/30"
                  : "border-gray-800 bg-gray-50 dark:bg-gray-900/30 ring-1 ring-gray-800/30";
              const iconBg = plat.id === "google"
                ? (isActive ? "bg-blue-100 dark:bg-blue-900/30" : "bg-muted")
                : plat.id === "microsoft"
                  ? (isActive ? "bg-[#0078D4]/10" : "bg-muted")
                  : (isActive ? "bg-gray-200 dark:bg-gray-800" : "bg-muted");
              const iconColor = plat.id === "google"
                ? (isActive ? "text-blue-600" : "text-muted-foreground")
                : plat.id === "microsoft"
                  ? (isActive ? "text-[#0078D4]" : "text-muted-foreground")
                  : (isActive ? "text-gray-800 dark:text-gray-200" : "text-muted-foreground");

              return (
                <button
                  key={plat.id}
                  onClick={() => { setActivePlatform(plat.id); }}
                  className={`relative border rounded-xl p-4 text-left transition-all ${isActive ? activeColors : "hover:border-muted-foreground/30"}`}
                >
                  {connCount > 0 && (
                    <div className="absolute top-2 right-2">
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[9px]">
                        {connCount}/{plat.services.length}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 rounded-lg ${iconBg}`}>
                      <plat.icon className={`w-5 h-5 ${iconColor}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{plat.name}</h3>
                      <p className="text-[10px] text-muted-foreground">
                        {connCount > 0 ? `${connCount} connecte${connCount > 1 ? "s" : ""}` : `${plat.services.length} services`}
                      </p>
                    </div>
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
                      {syncingPlatform === activePlatform ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                      Synchroniser
                    </Button>
                  )}
                  <Button
                    variant={currentPlatformData && currentPlatformData.connectedCount === currentPlatformData.totalServices ? "outline" : "default"}
                    size="sm"
                    className="text-xs"
                    onClick={handleConnectAll}
                    disabled={connectingAll !== null}
                  >
                    {connectingAll === activePlatform ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : currentPlatformData && currentPlatformData.connectedCount === currentPlatformData.totalServices ? (
                      <Unplug className="w-3.5 h-3.5 mr-1.5" />
                    ) : (
                      <Plug className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {currentPlatformData && currentPlatformData.connectedCount === currentPlatformData.totalServices ? "Tout deconnecter" : "Tout connecter"}
                  </Button>
                </div>
              </div>
              {currentPlatformData && currentPlatformData.connectedCount > 0 && (
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    {currentPlatformData.connectedCount} connecte{currentPlatformData.connectedCount > 1 ? "s" : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                    {currentPlatformData.totalServices - currentPlatformData.connectedCount} non connecte{(currentPlatformData.totalServices - currentPlatformData.connectedCount) > 1 ? "s" : ""}
                  </span>
                  {currentPlatformData.lastSync && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      Derniere sync: {new Date(currentPlatformData.lastSync).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={`Rechercher une application ${activePlatform === "google" ? "Google" : activePlatform === "microsoft" ? "Microsoft" : "Apple"}...`}
                  className="pl-9"
                  value={activePlatform === "google" ? googleSearch : activePlatform === "microsoft" ? msSearch : appleSearch}
                  onChange={(e) => {
                    if (activePlatform === "google") setGoogleSearch(e.target.value);
                    else if (activePlatform === "microsoft") setMsSearch(e.target.value);
                    else setAppleSearch(e.target.value);
                  }}
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
                      <Button
                        variant={filter === "tous" ? "default" : "outline"}
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => setFilter("tous")}
                      >
                        Tous ({services.length})
                      </Button>
                      {Object.entries(categories).map(([key, cat]) => {
                        const cnt = services.filter(s => s.categorie === key).length;
                        if (cnt === 0) return null;
                        return (
                          <Button
                            key={key}
                            variant={filter === key ? "default" : "outline"}
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => setFilter(key)}
                          >
                            {cat.label} ({cnt})
                          </Button>
                        );
                      })}
                    </div>

                    <div className="grid gap-3">
                      {services
                        .filter(s => filter === "tous" || s.categorie === filter)
                        .filter(s => {
                          if (!search) return true;
                          const q = search.toLowerCase();
                          return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
                        })
                        .map((service) => {
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
                                  <Badge className={(categories[service.categorie]?.couleur || "bg-gray-100 text-gray-700") + " border-0 text-[10px]"}>
                                    {categories[service.categorie]?.label || service.categorie}
                                  </Badge>
                                  {isConnected ? (
                                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]">
                                      <CheckCircle2 className="w-3 h-3 mr-1" />
                                      Connecte
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px]">
                                      Non connecte
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mb-2">{service.description}</p>
                                {isConnected && lastSyncTime && (
                                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Derniere sync: {new Date(lastSyncTime).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                )}
                                <div className="grid grid-cols-2 gap-1.5">
                                  {service.features.map((feature, i) => (
                                    <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <div className={`w-1 h-1 rounded-full ${isConnected ? "bg-emerald-500" : "bg-primary/50"}`} />
                                      {feature}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <Button
                              variant={isConnected ? "outline" : "default"}
                              size="sm"
                              className={`shrink-0 ${isConnected ? "text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200" : ""}`}
                              onClick={() => handleConnect(service.id, service.name)}
                              disabled={isLoading}
                            >
                              {isLoading ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              ) : isConnected ? (
                                <Unplug className="w-3.5 h-3.5 mr-1.5" />
                              ) : (
                                <Link2 className="w-3.5 h-3.5 mr-1.5" />
                              )}
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
                  <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-5 h-5" />
                    Securite Workspace - Protection des fichiers
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Controle strict des telechargements, envois et fichiers. Seul le Super Administrateur peut autoriser les telechargements.
                  </CardDescription>
                </div>
                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0">
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  Protection maximale
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <ShieldBan className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-red-800 dark:text-red-300">Blocage des telechargements externes</h4>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Tous les fichiers provenant de sources externes (Drive, e-mails, liens partages) sont bloques par defaut.
                      Seul un Super Administrateur peut autoriser le telechargement apres verification.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Download className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer tous les telechargements externes</Label>
                    <p className="text-xs text-muted-foreground">Aucun fichier externe ne peut etre telecharge sans autorisation</p>
                  </div>
                </div>
                <Switch checked={blockExternalDownloads} onCheckedChange={setBlockExternalDownloads} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <UserCog className="w-4 h-4 text-amber-600 mt-0.5" />
                  <div>
                    <Label>Telechargement reserve au Super Administrateur</Label>
                    <p className="text-xs text-muted-foreground">Seul le super admin peut telecharger des fichiers apres verification manuelle</p>
                  </div>
                </div>
                <Switch checked={superAdminOnlyDownload} onCheckedChange={setSuperAdminOnlyDownload} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Upload className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les envois de fichiers externes</Label>
                    <p className="text-xs text-muted-foreground">Empecher l'envoi de fichiers vers des destinations externes non autorisees</p>
                  </div>
                </div>
                <Switch checked={blockExternalUploads} onCheckedChange={setBlockExternalUploads} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Ban className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer le partage externe</Label>
                    <p className="text-xs text-muted-foreground">Interdire le partage de documents avec des utilisateurs hors de l'organisation</p>
                  </div>
                </div>
                <Switch checked={externalSharingBlocked} onCheckedChange={setExternalSharingBlocked} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FileX className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Taille maximale des fichiers</Label>
                    <p className="text-xs text-muted-foreground">Limite de taille pour les fichiers autorises (en Mo)</p>
                  </div>
                </div>
                <Select value={maxFileSize} onValueChange={setMaxFileSize}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 Mo</SelectItem>
                    <SelectItem value="10">10 Mo</SelectItem>
                    <SelectItem value="25">25 Mo</SelectItem>
                    <SelectItem value="50">50 Mo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-orange-200 dark:border-orange-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                <Bug className="w-5 h-5" />
                Analyse antivirus et anti-malware
              </CardTitle>
              <CardDescription>
                Analyse automatique de tous les fichiers et pieces jointes. Detection des menaces en temps reel par IA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{SCAN_STATS.totalScanned.toLocaleString("fr-FR")}</p>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Fichiers analyses</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-red-700 dark:text-red-400">{SCAN_STATS.threatsBlocked}</p>
                  <p className="text-[10px] text-red-600 dark:text-red-500">Menaces bloquees</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{SCAN_STATS.quarantined}</p>
                  <p className="text-[10px] text-amber-600 dark:text-amber-500">En quarantaine</p>
                </div>
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{SCAN_STATS.lastScan}</p>
                  <p className="text-[10px] text-blue-600 dark:text-blue-500">Derniere analyse</p>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-orange-500 mt-0.5" />
                  <div>
                    <Label>Analyser tous les e-mails entrants</Label>
                    <p className="text-xs text-muted-foreground">Scanner chaque e-mail pour detecter les virus, liens malveillants et tentatives de phishing</p>
                  </div>
                </div>
                <Switch checked={virusScanEmails} onCheckedChange={setVirusScanEmails} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FileWarning className="w-4 h-4 text-orange-500 mt-0.5" />
                  <div>
                    <Label>Analyser toutes les pieces jointes</Label>
                    <p className="text-xs text-muted-foreground">Analyse approfondie de chaque piece jointe avant ouverture ou telechargement</p>
                  </div>
                </div>
                <Switch checked={virusScanAttachments} onCheckedChange={setVirusScanAttachments} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FolderOpen className="w-4 h-4 text-orange-500 mt-0.5" />
                  <div>
                    <Label>Analyser les fichiers Google Drive</Label>
                    <p className="text-xs text-muted-foreground">Analyse en continu de tous les fichiers stockes et partages dans Drive</p>
                  </div>
                </div>
                <Switch checked={virusScanDrive} onCheckedChange={setVirusScanDrive} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Mise en quarantaine automatique</Label>
                    <p className="text-xs text-muted-foreground">Isoler automatiquement les fichiers suspects avant toute action humaine</p>
                  </div>
                </div>
                <Switch checked={quarantineSuspicious} onCheckedChange={setQuarantineSuspicious} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ScanSearch className="w-4 h-4 text-purple-500 mt-0.5" />
                  <div>
                    <Label>Analyse en bac a sable (Sandbox)</Label>
                    <p className="text-xs text-muted-foreground">Executer les fichiers suspects dans un environnement isole pour detecter les comportements malveillants</p>
                  </div>
                </div>
                <Switch checked={sandboxAnalysis} onCheckedChange={setSandboxAnalysis} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Eye className="w-4 h-4 text-purple-500 mt-0.5" />
                  <div>
                    <Label>Detection IA des menaces avancees</Label>
                    <p className="text-xs text-muted-foreground">L'intelligence artificielle analyse les patterns pour detecter les menaces zero-day et APT</p>
                  </div>
                </div>
                <Switch checked={aiThreatDetection} onCheckedChange={setAiThreatDetection} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 mt-0.5" />
                  <div>
                    <Label>Protection en temps reel</Label>
                    <p className="text-xs text-muted-foreground">Surveillance continue avec mise a jour des signatures toutes les 15 minutes</p>
                  </div>
                </div>
                <Switch checked={realTimeProtection} onCheckedChange={setRealTimeProtection} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-200 dark:border-purple-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
                <FileX className="w-5 h-5" />
                Types de fichiers bloques
              </CardTitle>
              <CardDescription>
                Les fichiers avec ces extensions sont systematiquement bloques, meme pour le Super Administrateur.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Ban className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les fichiers executables</Label>
                    <p className="text-xs text-muted-foreground">.exe, .bat, .cmd, .com, .scr, .pif, .msi, .dll et autres executables</p>
                  </div>
                </div>
                <Switch checked={blockExecutables} onCheckedChange={setBlockExecutables} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FileWarning className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les macros Office</Label>
                    <p className="text-xs text-muted-foreground">Empecher l'ouverture de fichiers contenant des macros VBA potentiellement dangereuses</p>
                  </div>
                </div>
                <Switch checked={blockMacros} onCheckedChange={setBlockMacros} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Lock className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les fichiers chiffres/proteges</Label>
                    <p className="text-xs text-muted-foreground">Les fichiers chiffres ne peuvent pas etre analyses - bloques par precaution</p>
                  </div>
                </div>
                <Switch checked={blockEncryptedFiles} onCheckedChange={setBlockEncryptedFiles} />
              </div>
              <Separator />

              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs font-medium mb-2">Extensions systematiquement bloquees :</p>
                <div className="flex flex-wrap gap-1.5">
                  {BLOCKED_EXTENSIONS.map((ext) => (
                    <Badge key={ext} variant="outline" className="text-[10px] text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                      {ext}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 dark:border-blue-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                <AlertTriangle className="w-5 h-5" />
                Protection anti-phishing et anti-spoofing
              </CardTitle>
              <CardDescription>
                Detection avancee des tentatives de phishing, d'usurpation d'identite et de liens malveillants dans les e-mails.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-blue-500 mt-0.5" />
                  <div>
                    <Label>Protection anti-phishing</Label>
                    <p className="text-xs text-muted-foreground">Detecter et bloquer les e-mails de phishing (faux expediteurs, liens trompeurs)</p>
                  </div>
                </div>
                <Switch checked={phishingProtection} onCheckedChange={setPhishingProtection} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Fingerprint className="w-4 h-4 text-blue-500 mt-0.5" />
                  <div>
                    <Label>Protection anti-usurpation (Spoofing)</Label>
                    <p className="text-xs text-muted-foreground">Verifier SPF, DKIM et DMARC pour chaque e-mail entrant</p>
                  </div>
                </div>
                <Switch checked={spoofingProtection} onCheckedChange={setSpoofingProtection} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ExternalLink className="w-4 h-4 text-blue-500 mt-0.5" />
                  <div>
                    <Label>Verification de securite des liens</Label>
                    <p className="text-xs text-muted-foreground">Analyser chaque lien dans les e-mails avant de permettre l'acces</p>
                  </div>
                </div>
                <Switch checked={linkSafetyCheck} onCheckedChange={setLinkSafetyCheck} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 dark:border-amber-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <Eye className="w-5 h-5" />
                Prevention des fuites de donnees (DLP)
              </CardTitle>
              <CardDescription>
                Empecher la fuite de donnees sensibles via e-mails, fichiers partages ou documents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Shield className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div>
                    <Label>Protection DLP active</Label>
                    <p className="text-xs text-muted-foreground">Analyser le contenu sortant pour detecter les donnees sensibles (IBAN, CB, NIR, mots de passe)</p>
                  </div>
                </div>
                <Switch checked={dlpEnabled} onCheckedChange={setDlpEnabled} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Ban className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div>
                    <Label>Bloquer l'envoi de donnees sensibles</Label>
                    <p className="text-xs text-muted-foreground">Empecher automatiquement l'envoi d'e-mails contenant des donnees personnelles non autorisees</p>
                  </div>
                </div>
                <Switch checked={dlpBlockSensitiveData} onCheckedChange={setDlpBlockSensitiveData} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Bell className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div>
                    <Label>Notifier le Super Administrateur</Label>
                    <p className="text-xs text-muted-foreground">Alerte immediate au super admin en cas de tentative de fuite de donnees</p>
                  </div>
                </div>
                <Switch checked={dlpNotifyAdmin} onCheckedChange={setDlpNotifyAdmin} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Synchronisation</CardTitle>
              <CardDescription>Configurez la frequence et le sens de la synchronisation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Synchronisation automatique</Label>
                  <p className="text-xs text-muted-foreground">Synchroniser les donnees toutes les 15 minutes</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Synchronisation bidirectionnelle</Label>
                  <p className="text-xs text-muted-foreground">Les modifications dans les plateformes connectees se refletent ici et inversement</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Import automatique des contacts</Label>
                  <p className="text-xs text-muted-foreground">Importer les nouveaux contacts depuis les plateformes automatiquement</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appels" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhoneIncoming className="w-5 h-5" />
                Gestion des appels entrants
              </CardTitle>
              <CardDescription>Configurez le comportement des appels entrants.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Duree de sonnerie</Label>
                  <p className="text-xs text-muted-foreground">Temps avant bascule en appel manque</p>
                </div>
                <Select value={callRingDuration} onValueChange={setCallRingDuration}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 secondes</SelectItem>
                    <SelectItem value="30">30 secondes</SelectItem>
                    <SelectItem value="45">45 secondes</SelectItem>
                    <SelectItem value="60">60 secondes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Son de sonnerie</Label>
                  <p className="text-xs text-muted-foreground">Jouer un son lors d'un appel entrant</p>
                </div>
                <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Identification automatique</Label>
                  <p className="text-xs text-muted-foreground">Rechercher le contact correspondant au numero</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enregistrement automatique</Label>
                  <p className="text-xs text-muted-foreground">Enregistrer automatiquement chaque appel dans l'historique</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div>
                <Label className="mb-2 block">Tester l'experience d'appel</Label>
                <p className="text-xs text-muted-foreground mb-3">Simulez un appel entrant pour tester l'interface.</p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => simulateIncomingCall()}
                    className="gap-2"
                  >
                    <PhoneIncoming className="w-4 h-4" />
                    Simuler un appel
                  </Button>
                  <Input placeholder="+33 1 XX XX XX XX" className="w-48" id="custom-phone" />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const input = document.getElementById("custom-phone") as HTMLInputElement;
                      if (input?.value) simulateIncomingCall(input.value);
                    }}
                  >
                    Appeler ce numero
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Intelligence IA pour les appels</CardTitle>
              <CardDescription>Fonctionnalites IA appliquees aux appels.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Analyse de sentiment en temps reel</Label>
                  <p className="text-xs text-muted-foreground">L'IA analyse le ton de la conversation</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Suggestions contextuelles pendant l'appel</Label>
                  <p className="text-xs text-muted-foreground">Afficher des suggestions basees sur l'historique du contact</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Resume automatique post-appel</Label>
                  <p className="text-xs text-muted-foreground">Generer un resume IA apres chaque appel</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Detection des rappels necessaires</Label>
                  <p className="text-xs text-muted-foreground">L'IA detecte si un rappel est necessaire et cree la tache</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="installation" className="space-y-6 mt-6">
          <Card className="border-blue-200 dark:border-blue-900/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Laptop className="w-5 h-5 text-blue-600" />
                    Installation sur Mac
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Installez Agent de Bureau et Google Workspace sur votre Mac pour une experience native.
                    Toutes les fonctionnalites, la securite et les integrations sont preservees.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs gap-1">
                  <Monitor className="w-3 h-3" />
                  macOS compatible
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border rounded-xl p-5 hover:border-blue-300 transition-colors relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 dark:bg-blue-950/20 rounded-bl-full" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                        <Package className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Application native macOS</h3>
                        <p className="text-[10px] text-muted-foreground">Application universelle (Apple Silicon + Intel)</p>
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Fonctionne hors connexion (mode degrade)</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Notifications natives macOS</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Integration Dock et barre des menus</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Raccourcis clavier Mac (Cmd+K, Cmd+N...)</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Synchronisation automatique avec le cloud</span>
                      </div>
                    </div>
                    <Button
                      className="w-full gap-2"
                      onClick={() => toast({
                        title: "Telechargement en cours",
                        description: "Le fichier AgentDeBureau-v2.4.dmg est en cours de telechargement...",
                      })}
                    >
                      <CloudDownload className="w-4 h-4" />
                      Telecharger pour Mac (.dmg)
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center mt-2">
                      Version 2.4.0 - macOS 13 Ventura ou superieur - 89 Mo
                    </p>
                  </div>
                </div>

                <div className="border rounded-xl p-5 hover:border-emerald-300 transition-colors relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 dark:bg-emerald-950/20 rounded-bl-full" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                        <Globe className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Application Web Progressive (PWA)</h3>
                        <p className="text-[10px] text-muted-foreground">Installation directe depuis le navigateur</p>
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Installation en un clic depuis Safari/Chrome</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Mises a jour automatiques</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Apparait dans le Launchpad Mac</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Aucun telechargement supplementaire</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Toujours la derniere version</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                      onClick={() => toast({
                        title: "Installation PWA",
                        description: "Cliquez sur 'Partager' dans votre navigateur puis 'Ajouter au Dock' pour installer l'application.",
                      })}
                    >
                      <Share2 className="w-4 h-4" />
                      Installer comme application
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center mt-2">
                      Safari : Partager &gt; Ajouter au Dock | Chrome : Menu &gt; Installer
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="w-5 h-5 text-blue-600" />
                Migration Google Workspace vers Mac
              </CardTitle>
              <CardDescription>
                Transferez l'ensemble de votre configuration Google Workspace sur votre Mac.
                Tous les parametres, connexions et donnees de securite sont migres automatiquement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-blue-800 dark:text-blue-300 mb-2">Elements migres automatiquement :</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Comptes Google connectes</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Parametres de securite</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Configuration antivirus</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Regles DLP et phishing</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Roles et permissions</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Historique des appels</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Contacts et taches</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Integrations logicielles</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">Processus de migration</h4>

                <div className="border rounded-lg p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-sm font-bold shrink-0">1</div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-medium">Exporter la configuration</h5>
                        <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px]">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Disponible
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Generer un fichier de configuration chiffre contenant tous vos parametres Workspace.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-2"
                        onClick={() => toast({
                          title: "Export en cours",
                          description: "Generation du fichier agent-bureau-config.enc en cours...",
                        })}
                      >
                        <Download className="w-3.5 h-3.5" />
                        Exporter (.enc)
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-sm font-bold shrink-0">2</div>
                    <div className="flex-1">
                      <h5 className="text-sm font-medium">Installer sur Mac</h5>
                      <p className="text-xs text-muted-foreground mt-1">Telecharger et installer l'application Agent de Bureau sur votre Mac.</p>
                      <div className="flex gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => toast({
                            title: "Telechargement",
                            description: "AgentDeBureau-v2.4-arm64.dmg (Apple Silicon) en cours...",
                          })}
                        >
                          <Cpu className="w-3.5 h-3.5" />
                          Apple Silicon (M1/M2/M3/M4)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => toast({
                            title: "Telechargement",
                            description: "AgentDeBureau-v2.4-x64.dmg (Intel) en cours...",
                          })}
                        >
                          <HardDrive className="w-3.5 h-3.5" />
                          Intel
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-sm font-bold shrink-0">3</div>
                    <div className="flex-1">
                      <h5 className="text-sm font-medium">Importer la configuration</h5>
                      <p className="text-xs text-muted-foreground mt-1">Ouvrez l'application sur Mac et importez le fichier de configuration chiffre. Vos identifiants Google seront automatiquement restaures.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-2"
                        onClick={() => toast({
                          title: "Import",
                          description: "Selectionnez le fichier .enc exporte a l'etape 1 pour restaurer votre configuration.",
                        })}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Importer (.enc)
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-4 border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center text-sm font-bold shrink-0">4</div>
                    <div className="flex-1">
                      <h5 className="text-sm font-medium">Verification et synchronisation</h5>
                      <p className="text-xs text-muted-foreground mt-1">L'application verifie la connexion Google Workspace, restaure les services et synchronise les donnees. Le processus est entierement automatique.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => toast({
                          title: "Verification",
                          description: "Test de connexion et synchronisation avec Google Workspace...",
                        })}
                      >
                        <RefreshCcw className="w-3.5 h-3.5" />
                        Verifier la migration
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="w-5 h-5" />
                Compatibilite des appareils
              </CardTitle>
              <CardDescription>
                Agent de Bureau est disponible sur toutes les plateformes. Google Workspace suit l'utilisateur.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border rounded-lg p-4 text-center">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-3">
                    <Laptop className="w-6 h-6 text-blue-600" />
                  </div>
                  <h4 className="font-semibold text-sm">macOS</h4>
                  <p className="text-xs text-muted-foreground mt-1">Application native ou PWA</p>
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Apple Silicon</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Intel x86_64</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>macOS 13+</span>
                    </div>
                  </div>
                  <Badge className="mt-3 bg-blue-100 text-blue-700 border-0 text-[10px]">Recommande</Badge>
                </div>

                <div className="border rounded-lg p-4 text-center">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-3">
                    <Monitor className="w-6 h-6 text-purple-600" />
                  </div>
                  <h4 className="font-semibold text-sm">Windows</h4>
                  <p className="text-xs text-muted-foreground mt-1">Application desktop ou PWA</p>
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Windows 10/11</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>x86_64 / ARM</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>.msi installer</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="mt-3 text-[10px]">Disponible</Badge>
                </div>

                <div className="border rounded-lg p-4 text-center border-amber-200 dark:border-amber-800 bg-gradient-to-b from-amber-50/50 to-transparent dark:from-amber-950/10">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
                    <Smartphone className="w-6 h-6 text-amber-600" />
                  </div>
                  <h4 className="font-semibold text-sm">Mobile</h4>
                  <p className="text-xs text-muted-foreground mt-1">iOS et Android</p>
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>iPhone / iPad</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Android 12+</span>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>PWA ou App Store</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="mt-3 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => setPhoneDialogOpen(true)}
                  >
                    <Play className="w-3 h-3" />
                    Apercu mobile
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 dark:border-amber-900/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Smartphone className="w-5 h-5 text-amber-600" />
                    Application mobile - Apercu interactif
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Decouvrez l'experience Agent de Bureau sur mobile. Naviguez entre les ecrans pour voir toutes les fonctionnalites.
                  </CardDescription>
                </div>
                <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px] gap-1">
                  <Smartphone className="w-3 h-3" />
                  iOS / Android
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col lg:flex-row items-start gap-8">
                <PhoneSimulator className="shrink-0" />
                <div className="flex-1 space-y-4">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Fonctionnalites mobiles</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { label: "Tableau de bord en temps reel", desc: "KPIs, activite recente, score IA" },
                        { label: "Gestion des appels", desc: "Journal d'appels, filtres, rappels rapides" },
                        { label: "Repertoire contacts", desc: "Recherche, categories, fiches completes" },
                        { label: "Suivi des taches", desc: "Statuts, priorites, echeances" },
                        { label: "Messages et notifications", desc: "Vocaux, notes, rappels, priorites" },
                        { label: "Gestion de stock", desc: "Inventaire, alertes seuils, categories" },
                        { label: "7 Agents IA embarques", desc: "Scores, alertes, suggestions en mobilite" },
                        { label: "58 integrations natives", desc: "Google, Microsoft, Apple synchronises" },
                        { label: "Notifications push", desc: "Appels manques, taches urgentes, alertes IA" },
                        { label: "Mode hors connexion", desc: "Acces aux donnees sans connexion Internet" },
                      ].map((f, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                          <CheckCircle2 className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-medium">{f.label}</p>
                            <p className="text-[10px] text-muted-foreground">{f.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Telecharger l'application</h4>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        className="gap-2 bg-black hover:bg-gray-800 text-white"
                        onClick={() => toast({ title: "App Store", description: "Redirection vers l'App Store pour telecharger Agent de Bureau..." })}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 16.56 2.93 11.3 4.7 7.72C5.57 5.94 7.36 4.86 9.28 4.84C10.56 4.82 11.78 5.72 12.55 5.72C13.33 5.72 14.81 4.65 16.38 4.82C17.08 4.85 18.92 5.1 20.12 6.82C20.01 6.89 17.78 8.17 17.8 10.94C17.83 14.22 20.65 15.31 20.68 15.32C20.66 15.38 20.23 16.89 19.16 18.44L18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/></svg>
                        App Store
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => toast({ title: "Google Play", description: "Redirection vers Google Play pour telecharger Agent de Bureau..." })}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5V3.5C3 2.91 3.34 2.39 3.84 2.15L13.69 12L3.84 21.85C3.34 21.61 3 21.09 3 20.5ZM16.81 15.12L6.05 21.34L14.54 12.85L16.81 15.12ZM20.16 10.81C20.5 11.08 20.75 11.5 20.75 12C20.75 12.5 20.5 12.92 20.16 13.19L17.89 14.5L15.39 12L17.89 9.5L20.16 10.81ZM6.05 2.66L16.81 8.88L14.54 11.15L6.05 2.66Z"/></svg>
                        Google Play
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Compatible iOS 16+ et Android 12+. Synchronisation automatique avec votre compte Google Workspace.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCcw className="w-5 h-5" />
                Synchronisation multi-appareils
              </CardTitle>
              <CardDescription>Vos donnees et parametres Google Workspace sont synchronises en temps reel entre tous vos appareils.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Synchronisation en temps reel</Label>
                  <p className="text-xs text-muted-foreground">Les modifications sont propagees instantanement a tous les appareils connectes</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Mode hors connexion</Label>
                  <p className="text-xs text-muted-foreground">Continuer a travailler sans Internet, synchronisation au retour du reseau</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Chiffrement de bout en bout</Label>
                  <p className="text-xs text-muted-foreground">Les donnees transferees entre appareils sont chiffrees en AES-256</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Transfert automatique de session</Label>
                  <p className="text-xs text-muted-foreground">Passez d'un appareil a l'autre sans vous reconnecter (meme compte Google)</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Conservation des preferences par appareil</Label>
                  <p className="text-xs text-muted-foreground">Chaque appareil garde ses propres preferences d'affichage et de notifications</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Preferences de notification
              </CardTitle>
              <CardDescription>Choisissez les notifications que vous souhaitez recevoir.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Appels manques</Label>
                  <p className="text-xs text-muted-foreground">Notification pour chaque appel manque</p>
                </div>
                <Switch checked={notifAppels} onCheckedChange={setNotifAppels} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Taches en retard</Label>
                  <p className="text-xs text-muted-foreground">Alerte quand une tache depasse sa date limite</p>
                </div>
                <Switch checked={notifTaches} onCheckedChange={setNotifTaches} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Nouveaux messages</Label>
                  <p className="text-xs text-muted-foreground">Notification pour les messages urgents</p>
                </div>
                <Switch checked={notifMessages} onCheckedChange={setNotifMessages} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Alertes IA</Label>
                  <p className="text-xs text-muted-foreground">Notifications de la reconnaissance IA (detections critiques)</p>
                </div>
                <Switch checked={notifIA} onCheckedChange={setNotifIA} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Alertes de securite Workspace</Label>
                  <p className="text-xs text-muted-foreground">Notification immediate en cas de menace detectee, fichier bloque ou tentative de phishing</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Rapport de securite quotidien</Label>
                  <p className="text-xs text-muted-foreground">Resume quotidien des evenements de securite envoye au Super Administrateur</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sauvegardes" className="space-y-6 mt-6">
          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
                    <Save className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Sauvegarde automatique</CardTitle>
                    <CardDescription>Toutes les 2 minutes, vos donnees sont sauvegardees et synchronisees de maniere securisee.</CardDescription>
                  </div>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs gap-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Actif
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-blue-700">{backupStats?.total || 0}</p>
                  <p className="text-[10px] text-blue-600">Sauvegardes totales</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-emerald-700">{backupStats?.termine || 0}</p>
                  <p className="text-[10px] text-emerald-600">Reussies</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-red-700">{backupStats?.erreur || 0}</p>
                  <p className="text-[10px] text-red-600">Erreurs</p>
                </div>
                <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-purple-700">{backupStats?.today || 0}</p>
                  <p className="text-[10px] text-purple-600">Aujourd'hui</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={handleManualBackup} disabled={backupRunning} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                  {backupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {backupRunning ? "Sauvegarde en cours..." : "Sauvegarder maintenant"}
                </Button>
                <Button variant="outline" onClick={fetchBackups} disabled={loadingBackups} className="gap-2">
                  <RefreshCw className={`w-4 h-4 ${loadingBackups ? "animate-spin" : ""}`} />
                  Actualiser
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Cloud className="w-4 h-4 text-blue-600" />
                Destinations de sauvegarde
              </CardTitle>
              <CardDescription>Vos donnees sont sauvegardees simultanement sur toutes les plateformes connectees.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    platform: "local",
                    name: "Serveur local",
                    icon: Server,
                    color: "text-slate-600",
                    bg: "bg-slate-100 dark:bg-slate-900/30",
                    path: "/secure/backups/local",
                    desc: "Stockage chiffre AES-256 sur serveur principal",
                  },
                  {
                    platform: "google",
                    name: "Google Drive",
                    icon: Cloud,
                    color: "text-blue-600",
                    bg: "bg-blue-100 dark:bg-blue-900/30",
                    path: "Google Drive > Agent de Bureau > Sauvegardes",
                    desc: "Synchronisation automatique avec Google Workspace",
                  },
                  {
                    platform: "microsoft",
                    name: "Microsoft OneDrive",
                    icon: HardDrive,
                    color: "text-[#0078D4]",
                    bg: "bg-blue-50 dark:bg-blue-900/20",
                    path: "OneDrive > Agent de Bureau > Backups",
                    desc: "Sauvegarde vers Microsoft 365 OneDrive",
                  },
                  {
                    platform: "apple",
                    name: "iCloud Drive",
                    icon: Cloud,
                    color: "text-gray-700",
                    bg: "bg-gray-100 dark:bg-gray-900/30",
                    path: "iCloud Drive > Agent de Bureau > Sauvegardes",
                    desc: "Synchronisation avec l'ecosysteme Apple",
                  },
                ].map((dest) => {
                  const config = backupConfigs.find((c: any) => c.platform === dest.platform);
                  const platformStat = backupStats?.platforms?.find((p: any) => p.platform === dest.platform);
                  const isEnabled = config?.enabled === "true" || !config;
                  return (
                    <div key={dest.platform} className={`rounded-lg border p-4 ${isEnabled ? "border-emerald-200 dark:border-emerald-800" : "border-border opacity-60"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${dest.bg}`}>
                            <dest.icon className={`w-4 h-4 ${dest.color}`} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{dest.name}</p>
                            <p className="text-[10px] text-muted-foreground">{dest.desc}</p>
                          </div>
                        </div>
                        <Badge variant={isEnabled ? "default" : "secondary"} className={isEnabled ? "bg-emerald-100 text-emerald-700 border-0 text-[10px]" : "text-[10px]"}>
                          {isEnabled ? "Actif" : "Inactif"}
                        </Badge>
                      </div>
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <FolderOpen className="w-3 h-3" />
                          <span className="truncate">{dest.path}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Lock className="w-3 h-3" />
                          <span>Chiffrement AES-256-GCM</span>
                        </div>
                        {platformStat && (
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>{platformStat.count} sauvegardes - Derniere: {new Date(platformStat.lastBackup).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-600" />
                    Configuration de securite
                  </CardTitle>
                  <CardDescription>Parametres de chiffrement, retention et integrite des sauvegardes.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-blue-600" />
                    Chiffrement
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">AES-256-GCM</p>
                        <p className="text-[10px] text-muted-foreground">Chiffrement de niveau militaire</p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">Hash SHA-256</p>
                        <p className="text-[10px] text-muted-foreground">Verification d'integrite</p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">TLS 1.3</p>
                        <p className="text-[10px] text-muted-foreground">Transport securise</p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    Planification
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">Intervalle</p>
                        <p className="text-[10px] text-muted-foreground">Frequence de sauvegarde</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">2 min</Badge>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">Retention</p>
                        <p className="text-[10px] text-muted-foreground">Duree de conservation</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">90 jours</Badge>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">Destinations</p>
                        <p className="text-[10px] text-muted-foreground">Plateformes actives</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">4 actives</Badge>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Conformite
                  </h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">RGPD</p>
                        <p className="text-[10px] text-muted-foreground">Reglementation europeenne</p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">ISO 27001</p>
                        <p className="text-[10px] text-muted-foreground">Securite de l'information</p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div>
                        <p className="text-xs font-medium">SOC 2 Type II</p>
                        <p className="text-[10px] text-muted-foreground">Audit de securite</p>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4 text-blue-600" />
                Historique des sauvegardes
              </CardTitle>
              <CardDescription>Les 30 dernieres sauvegardes automatiques et manuelles.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBackups ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : backups.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Aucune sauvegarde encore enregistree.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {backups.map((b: any) => {
                    const platformLabel = b.platform === "local" ? "Serveur local" : b.platform === "google" ? "Google Drive" : b.platform === "microsoft" ? "OneDrive" : "iCloud";
                    const platformColor = b.platform === "local" ? "bg-slate-100 text-slate-700" : b.platform === "google" ? "bg-blue-100 text-blue-700" : b.platform === "microsoft" ? "bg-blue-50 text-[#0078D4]" : "bg-gray-100 text-gray-700";
                    const summary = b.dataSummary as any;
                    return (
                      <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/20 border border-border/30">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${b.status === "termine" ? "bg-emerald-100" : "bg-red-100"}`}>
                          {b.status === "termine" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium">
                              {b.type === "snapshot" ? "Sauvegarde locale" : "Synchronisation"}
                            </p>
                            <Badge className={`text-[8px] h-4 px-1.5 border-0 ${platformColor}`}>{platformLabel}</Badge>
                            {b.duration && <span className="text-[9px] text-muted-foreground">{b.duration}ms</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(b.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                            {summary && (
                              <span className="text-[9px] text-muted-foreground">
                                {summary.appels}a {summary.contacts}c {summary.taches}t {summary.messages}m {summary.stock}s
                              </span>
                            )}
                            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" />
                              {b.encryptionHash?.substring(0, 8)}...
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="securite" className="space-y-6 mt-6">
          <Card className="overflow-hidden border-0 shadow-lg">
            <div className="relative h-36">
              <img src={securityServerImg} alt="Infrastructure de securite" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/80 via-emerald-800/60 to-transparent" />
              <div className="absolute inset-0 flex flex-col sm:flex-row items-start sm:items-center justify-center sm:justify-between gap-2 px-6">
                <div className="text-white">
                  <h3 className="text-lg font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-300" /> Infrastructure securisee</h3>
                  <p className="text-white/80 text-sm mt-1">Protection multi-couches, chiffrement de bout en bout, conformite RGPD</p>
                </div>
                <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30 shrink-0">
                  Toutes les protections actives
                </Badge>
              </div>
            </div>
          </Card>
          <Card className="border-emerald-200 dark:border-emerald-900/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-600" />
                    Securite de l'application
                  </CardTitle>
                  <CardDescription>Protection multi-couches active en permanence.</CardDescription>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  Toutes les protections actives
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>HTTPS force</Label>
                  <p className="text-xs text-muted-foreground">Toutes les connexions utilisent le chiffrement TLS 1.3</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Protection CSRF</Label>
                  <p className="text-xs text-muted-foreground">Protection contre les attaques Cross-Site Request Forgery</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Limitation de debit (Rate Limiting)</Label>
                  <p className="text-xs text-muted-foreground">100 requetes/min standard, 20/min pour l'IA, 200/min pour les lectures</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>En-tetes de securite (Helmet)</Label>
                  <p className="text-xs text-muted-foreground">CSP, X-Frame-Options, HSTS et autres en-tetes de securite</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Protection HPP</Label>
                  <p className="text-xs text-muted-foreground">Protection contre la pollution des parametres HTTP</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>CORS configure</Label>
                  <p className="text-xs text-muted-foreground">Origines autorisees controlees par variable d'environnement</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Limite de taille du corps</Label>
                  <p className="text-xs text-muted-foreground">Maximum 1 Mo par requete</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200 dark:border-red-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <ShieldAlert className="w-5 h-5" />
                Mode Zero Trust
              </CardTitle>
              <CardDescription>Architecture de securite ou aucun utilisateur, appareil ou reseau n'est considere comme fiable par defaut.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-red-800 dark:text-red-300">Principe : ne jamais faire confiance, toujours verifier</h4>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Chaque requete est authentifiee, autorisee et chiffree independamment de sa source.
                      Les sessions sont limitees dans le temps et les privileges sont accorde au minimum necessaire.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ShieldBan className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Mode Zero Trust actif</Label>
                    <p className="text-xs text-muted-foreground">Verifier chaque acces, meme depuis le reseau interne</p>
                  </div>
                </div>
                <Switch checked={zeroTrustMode} onCheckedChange={setZeroTrustMode} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <KeyRound className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Re-authentification obligatoire</Label>
                    <p className="text-xs text-muted-foreground">Exiger une re-authentification pour les actions sensibles (suppression, export, admin)</p>
                  </div>
                </div>
                <Switch checked={forceReauth} onCheckedChange={setForceReauth} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Expiration de session</Label>
                    <p className="text-xs text-muted-foreground">Delai d'inactivite avant deconnexion automatique</p>
                  </div>
                </div>
                <Select value={sessionTimeout} onValueChange={setSessionTimeout}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">1 heure</SelectItem>
                    <SelectItem value="120">2 heures</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Fingerprint className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Authentification multi-facteurs (MFA)</Label>
                    <p className="text-xs text-muted-foreground">Exiger un second facteur d'authentification pour tous les utilisateurs</p>
                  </div>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Server className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Micro-segmentation reseau</Label>
                    <p className="text-xs text-muted-foreground">Isoler chaque service pour limiter la propagation en cas de compromission</p>
                  </div>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCog className="w-5 h-5" />
                Roles et permissions
              </CardTitle>
              <CardDescription>Gestion des niveaux d'acces par role.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-red-100 text-red-700 border-0">Super Admin</Badge>
                      <span className="text-sm font-medium">Acces total</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 4</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Seul role autorise a telecharger des fichiers externes, modifier les parametres de securite,
                    gerer les utilisateurs et acceder aux journaux d'audit. Peut lever les restrictions temporairement.
                  </p>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-amber-100 text-amber-700 border-0">Administrateur</Badge>
                      <span className="text-sm font-medium">Gestion avancee</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 3</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gestion des contacts, taches et rapports. Pas d'acces aux telechargements externes
                    ni aux parametres de securite critiques. Peut consulter les alertes de securite.
                  </p>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-700 border-0">Agent</Badge>
                      <span className="text-sm font-medium">Operations courantes</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 2</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gestion des appels, consultation des contacts et taches. Aucun acces aux fichiers externes,
                    aux exports de donnees ni aux parametres systeme.
                  </p>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-gray-100 text-gray-700 border-0">Lecture seule</Badge>
                      <span className="text-sm font-medium">Consultation uniquement</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 1</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Consultation des tableaux de bord et rapports uniquement. Aucune modification,
                    aucun telechargement, aucun export. Acces le plus restreint.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conformite RGPD</CardTitle>
              <CardDescription>Parametres de conformite au Reglement General sur la Protection des Donnees.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Chiffrement des donnees au repos</Label>
                  <p className="text-xs text-muted-foreground">Les donnees sensibles sont chiffrees dans la base de donnees (AES-256)</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Journal d'audit</Label>
                  <p className="text-xs text-muted-foreground">Enregistrer toutes les actions des utilisateurs avec horodatage et adresse IP</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Droit a l'oubli</Label>
                  <p className="text-xs text-muted-foreground">Permettre la suppression complete des donnees d'un contact</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Export des donnees personnelles</Label>
                  <p className="text-xs text-muted-foreground">Permettre l'export des donnees au format standard (RGPD Art. 20)</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Conservation limitee des donnees</Label>
                  <p className="text-xs text-muted-foreground">Suppression automatique des donnees au-dela de la duree legale de conservation</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Consentement explicite</Label>
                  <p className="text-xs text-muted-foreground">Recueillir et enregistrer le consentement avant tout traitement de donnees</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CircleAlert className="w-5 h-5 text-amber-500" />
                Actions de securite
              </CardTitle>
              <CardDescription>Operations manuelles de securite reservees au Super Administrateur.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1"
                  onClick={() => handleSecurityAction("Lancement de l'audit de securite complet...")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ScanSearch className="w-4 h-4" />
                    Audit de securite complet
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Analyser toutes les configurations et detecter les vulnerabilites</p>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1"
                  onClick={() => handleSecurityAction("Export du journal d'audit en cours...")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="w-4 h-4" />
                    Exporter le journal d'audit
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Telecharger le journal complet des actions (reserve super admin)</p>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => handleSecurityAction("Revocation de toutes les sessions actives...")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                    <ShieldBan className="w-4 h-4" />
                    Revoquer toutes les sessions
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Deconnecter immediatement tous les utilisateurs actifs</p>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => handleSecurityAction("Verrouillage d'urgence active. Seul le super admin peut deverrouiller.")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                    <Lock className="w-4 h-4" />
                    Verrouillage d'urgence
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Bloquer tout acces sauf super admin en cas d'incident critique</p>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PhoneSimulatorDialog open={phoneDialogOpen} onOpenChange={setPhoneDialogOpen} />
    </div>
  );
}
