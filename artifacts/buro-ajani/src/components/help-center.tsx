import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import {
  HelpCircle,
  Search,
  X,
  Phone,
  Users,
  CheckSquare,
  MessageSquare,
  FileText,
  CreditCard,
  Settings as SettingsIcon,
  Sparkles,
  Calendar,
  BarChart3,
  Mail,
  FolderOpen,
  Shield,
  Plug,
  Briefcase,
  Smartphone,
  Bell,
  ChevronRight,
  ArrowLeft,
  Mail as MailIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";

type HelpTopic = {
  id: string;
  category: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  keywords: string[];
  href?: string;
  steps: string[];
  tip?: string;
};

const TOPICS: HelpTopic[] = [
  // Démarrage
  {
    id: "premiers-pas",
    category: "Démarrage",
    icon: Sparkles,
    title: "Premiers pas avec Agent de Bureau",
    keywords: ["debut", "commencer", "start", "nouveau", "decouvrir"],
    href: "/onboarding",
    steps: [
      "Cliquez sur Configuration initiale dans le menu Système.",
      "Renseignez les informations de votre entreprise (nom, secteur, équipe).",
      "Importez vos contacts existants depuis Import intelligent.",
      "Connectez Google Workspace pour synchroniser Gmail et Calendrier.",
      "Invitez vos collaborateurs depuis Administration → Utilisateurs.",
    ],
    tip: "Vous pouvez revenir à l'onboarding à tout moment depuis le menu Système.",
  },
  // Communication
  {
    id: "appels",
    category: "Communication",
    icon: Phone,
    title: "Gérer mes appels téléphoniques",
    keywords: ["appel", "telephone", "call", "twilio", "voip", "communication"],
    href: "/appels",
    steps: [
      "Allez dans Appels depuis le menu Communication.",
      "Cliquez sur le bouton + pour démarrer ou enregistrer un appel.",
      "Consultez l'historique avec filtres (entrant, sortant, manqué).",
      "Cliquez sur un appel pour voir les détails et l'analyse IA.",
    ],
    tip: "Activez l'enregistrement automatique dans Téléphonie pour la transcription IA.",
  },
  {
    id: "messages",
    category: "Communication",
    icon: MessageSquare,
    title: "Envoyer et recevoir des messages",
    keywords: ["message", "sms", "chat", "envoyer", "communication"],
    href: "/messages",
    steps: [
      "Ouvrez Messages depuis le menu Communication.",
      "Sélectionnez un contact ou créez une nouvelle conversation.",
      "Tapez votre message et envoyez (SMS via Twilio si configuré).",
      "Utilisez l'IA pour suggérer des réponses contextuelles.",
    ],
  },
  {
    id: "gmail",
    category: "Communication",
    icon: Mail,
    title: "Utiliser l'Agent Mail IA",
    keywords: ["mail", "email", "gmail", "courrier", "ia", "agent"],
    href: "/gmail-agent",
    steps: [
      "Connectez d'abord Google Workspace dans Intégrations.",
      "Ouvrez Agent Mail IA dans le menu Communication.",
      "L'agent classe automatiquement vos emails par priorité.",
      "Cliquez sur Rédiger avec IA pour générer un brouillon.",
    ],
    tip: "L'agent apprend de votre style d'écriture au fil du temps.",
  },
  // Carnet d'adresses
  {
    id: "contacts",
    category: "Carnet d'adresses",
    icon: Users,
    title: "Ajouter et gérer mes contacts",
    keywords: ["contact", "client", "carnet", "adresse", "annuaire"],
    href: "/contacts",
    steps: [
      "Cliquez sur Contacts dans le menu Carnet d'adresses.",
      "Bouton Nouveau contact en haut à droite pour créer une fiche.",
      "Remplissez nom, téléphone, email et tags (catégories).",
      "Importez en masse via Import intelligent (CSV ou Google).",
    ],
  },
  {
    id: "prospects",
    category: "Carnet d'adresses",
    icon: Briefcase,
    title: "Suivre mes prospects commerciaux",
    keywords: ["prospect", "vente", "crm", "pipeline", "lead"],
    href: "/prospects",
    steps: [
      "Ouvrez Prospects dans le menu Carnet d'adresses.",
      "Glissez-déposez les cartes entre les étapes du pipeline.",
      "Ajoutez des notes, tâches et rappels sur chaque fiche.",
      "Consultez les statistiques de conversion dans Analyse.",
    ],
  },
  // Organisation
  {
    id: "taches",
    category: "Organisation",
    icon: CheckSquare,
    title: "Créer et suivre mes tâches",
    keywords: ["tache", "todo", "rappel", "echeance", "deadline"],
    href: "/taches",
    steps: [
      "Allez dans Tâches dans le menu Organisation du travail.",
      "Cliquez sur + Nouvelle tâche.",
      "Définissez titre, échéance, priorité et personne assignée.",
      "Suivez l'avancement par drag-and-drop dans le tableau Kanban.",
    ],
  },
  {
    id: "projets",
    category: "Organisation",
    icon: FolderOpen,
    title: "Gérer mes projets",
    keywords: ["projet", "project", "equipe", "collaboration"],
    href: "/projets",
    steps: [
      "Ouvrez Projets dans le menu Organisation du travail.",
      "Créez un nouveau projet avec nom, description et membres.",
      "Ajoutez des tâches, documents et jalons.",
      "Suivez la progression dans la vue Gantt ou liste.",
    ],
  },
  {
    id: "calendrier",
    category: "Organisation",
    icon: Calendar,
    title: "Consulter mon calendrier",
    keywords: ["calendrier", "agenda", "rdv", "rendez-vous", "google calendar"],
    href: "/calendrier",
    steps: [
      "Cliquez sur Calendrier dans le menu Aujourd'hui.",
      "Vue jour, semaine ou mois selon vos préférences.",
      "Synchronisation automatique avec Google Calendar si connecté.",
      "Glissez pour créer un événement directement sur le calendrier.",
    ],
  },
  // Documents
  {
    id: "documents",
    category: "Documents",
    icon: FileText,
    title: "Stocker et organiser mes documents",
    keywords: ["document", "fichier", "pdf", "stockage", "drive"],
    href: "/documents",
    steps: [
      "Allez dans Documents dans le menu Documents & Rapports.",
      "Glissez-déposez vos fichiers ou cliquez sur Téléverser.",
      "Organisez par dossiers et tags.",
      "Sauvegarde automatique sur Google Drive si connecté.",
    ],
    tip: "Utilisez Document IA pour extraire automatiquement les informations clés.",
  },
  {
    id: "rapports",
    category: "Documents",
    icon: BarChart3,
    title: "Consulter les rapports d'activité",
    keywords: ["rapport", "report", "statistique", "bilan", "performance"],
    href: "/rapports",
    steps: [
      "Ouvrez Rapports dans le menu Documents & Rapports.",
      "Choisissez la période (jour, semaine, mois, personnalisé).",
      "Filtrez par utilisateur, équipe ou type d'activité.",
      "Exportez en PDF ou Excel pour partage externe.",
    ],
  },
  // IA
  {
    id: "agents-ia",
    category: "Intelligence Artificielle",
    icon: Sparkles,
    title: "Utiliser les Agents IA",
    keywords: ["ia", "ai", "agent", "intelligence", "assistant", "automatisation"],
    href: "/agents-ia",
    steps: [
      "Ouvrez Agents IA dans le menu Assistants IA.",
      "Choisissez un agent pré-configuré ou créez le vôtre.",
      "Décrivez la tâche en langage naturel.",
      "L'agent exécute et vous notifie du résultat.",
    ],
    tip: "Vérifiez votre quota IA dans Paramètres → Abonnement.",
  },
  {
    id: "commandant-ia",
    category: "Intelligence Artificielle",
    icon: Sparkles,
    title: "Discuter avec le Commandant IA",
    keywords: ["commandant", "chat", "ia", "question", "assistant central"],
    href: "/commandant-ia",
    steps: [
      "Cliquez sur Commandant IA dans le menu Assistants IA.",
      "Posez votre question en français ou en turc.",
      "Le Commandant a accès à toutes vos données (contacts, tâches, appels).",
      "Demandez-lui d'exécuter des actions: \"Crée une tâche pour rappeler Jean demain\".",
    ],
  },
  // Intégrations
  {
    id: "google-workspace",
    category: "Intégrations",
    icon: Plug,
    title: "Connecter Google Workspace",
    keywords: ["google", "workspace", "gmail", "drive", "calendar", "integration", "oauth"],
    href: "/google-workspace",
    steps: [
      "Allez dans Google Workspace dans le menu Intégrations.",
      "Cliquez sur Connecter mon compte Google.",
      "Autorisez les permissions (Gmail, Drive, Calendar).",
      "La synchronisation démarre automatiquement.",
    ],
  },
  {
    id: "telephonie",
    category: "Intégrations",
    icon: Phone,
    title: "Configurer la téléphonie (Twilio)",
    keywords: ["twilio", "telephonie", "voip", "appel", "configuration", "numero"],
    href: "/telephonie",
    steps: [
      "Ouvrez Téléphonie dans le menu Intégrations.",
      "Saisissez votre Account SID, Auth Token et numéro Twilio.",
      "Activez l'enregistrement et la transcription IA si souhaité.",
      "Testez avec un appel sortant.",
    ],
  },
  // Facturation
  {
    id: "abonnement",
    category: "Facturation",
    icon: CreditCard,
    title: "Gérer mon abonnement",
    keywords: ["abonnement", "facture", "billing", "stripe", "plan", "payment", "carte"],
    href: "/parametres",
    steps: [
      "Allez dans Paramètres → onglet Abonnement.",
      "Consultez votre plan actuel et utilisation.",
      "Cliquez sur Changer de plan pour passer Starter / Professionnel / Entreprise.",
      "Si Stripe est actif: Gérer mon abonnement ouvre le portail client (factures, carte, annulation).",
    ],
    tip: "Pour annuler, vous avez deux options: à la fin de la période en cours, ou immédiatement.",
  },
  {
    id: "factures",
    category: "Facturation",
    icon: FileText,
    title: "Télécharger mes factures",
    keywords: ["facture", "invoice", "pdf", "comptabilite", "telecharger"],
    href: "/gestion-licence",
    steps: [
      "Ouvrez Licence & Facturation dans le menu Administration.",
      "Consultez l'historique de vos factures mensuelles.",
      "Cliquez sur Télécharger pour obtenir le PDF.",
      "Les factures sont aussi envoyées par email automatiquement.",
    ],
  },
  // Mobile
  {
    id: "mobile",
    category: "Application mobile",
    icon: Smartphone,
    title: "Installer l'application mobile",
    keywords: ["mobile", "app", "smartphone", "android", "ios", "telecharger"],
    href: "/telecharger",
    steps: [
      "Allez dans Application mobile dans le menu Système.",
      "Scannez le QR code avec votre téléphone.",
      "Installez l'application Expo Go puis ouvrez le lien.",
      "Connectez-vous avec vos identifiants habituels.",
    ],
  },
  // Sécurité
  {
    id: "utilisateurs",
    category: "Administration",
    icon: Users,
    title: "Inviter et gérer les utilisateurs",
    keywords: ["utilisateur", "user", "equipe", "invitation", "role", "admin", "permission"],
    href: "/utilisateurs",
    steps: [
      "Ouvrez Utilisateurs dans le menu Administration.",
      "Cliquez sur Inviter un utilisateur.",
      "Saisissez l'email et choisissez le rôle (admin, manager, utilisateur).",
      "L'invitation est envoyée par email automatiquement.",
    ],
  },
  {
    id: "protection-donnees",
    category: "Administration",
    icon: Shield,
    title: "Protection des données (RGPD)",
    keywords: ["rgpd", "gdpr", "protection", "donnee", "privacy", "securite", "sauvegarde"],
    href: "/protection-donnees",
    steps: [
      "Allez dans Protection des données dans le menu Administration.",
      "Consultez les alertes et anomalies détectées.",
      "Configurez la sauvegarde automatique (Google Drive ou local).",
      "Exportez ou supprimez les données d'un contact sur demande RGPD.",
    ],
  },
  // Paramètres
  {
    id: "parametres",
    category: "Paramètres",
    icon: SettingsIcon,
    title: "Personnaliser mon profil et notifications",
    keywords: ["parametre", "settings", "profil", "notification", "preference", "langue"],
    href: "/parametres",
    steps: [
      "Cliquez sur Paramètres dans le menu Système.",
      "Onglet Profil: nom, photo, mot de passe.",
      "Onglet Notifications: choisissez ce que vous recevez.",
      "Onglet Préférences: langue, fuseau horaire, thème.",
    ],
  },
  {
    id: "notifications",
    category: "Paramètres",
    icon: Bell,
    title: "Gérer les notifications",
    keywords: ["notification", "alerte", "rappel", "push", "email"],
    href: "/parametres",
    steps: [
      "Ouvrez Paramètres → onglet Notifications.",
      "Activez ou désactivez par type (appel manqué, tâche, mention).",
      "Choisissez le canal: in-app, email ou push mobile.",
      "Définissez les heures de silence (mode Ne pas déranger).",
    ],
  },
];

const CATEGORIES = Array.from(new Set(TOPICS.map((t) => t.category)));

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function HelpCenter() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<HelpTopic | null>(null);
  const [, setLocation] = useLocation();

  // Reset selection when sheet closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setSelectedTopic(null);
        setQuery("");
      }, 200);
    }
  }, [open]);

  // Keyboard shortcut: ? or Shift+/ opens help
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (!isTyping && e.key === "?" ) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filteredTopics = useMemo(() => {
    if (!query.trim()) return TOPICS;
    const q = normalize(query.trim());
    return TOPICS.filter((t) => {
      const haystack = normalize(
        [t.title, t.category, ...t.keywords, ...t.steps].join(" ")
      );
      return haystack.includes(q);
    });
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, HelpTopic[]>();
    for (const t of filteredTopics) {
      const arr = map.get(t.category) ?? [];
      arr.push(t);
      map.set(t.category, arr);
    }
    return Array.from(map.entries());
  }, [filteredTopics]);

  function handleGoToPage(href: string) {
    setOpen(false);
    setTimeout(() => setLocation(href), 220);
  }

  return (
    <>
      {/* Floating Help Button */}
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Centre d'aide"
        title="Centre d'aide (raccourci : ?)"
        className="fixed bottom-24 right-6 z-50 rounded-full w-11 h-11 p-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shadow-lg hover:shadow-xl hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 dark:hover:border-blue-600 transition-colors flex items-center justify-center"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        data-testid="button-help-center"
      >
        <HelpCircle className="h-5 w-5" />
      </motion.button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col"
          data-testid="sheet-help-center"
        >
          <SheetHeader className="px-6 pt-6 pb-3 border-b">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-100 dark:bg-blue-900/30 p-2">
                <HelpCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <SheetTitle>Centre d'aide</SheetTitle>
                <SheetDescription className="text-xs">
                  Trouvez de l'aide sur tous les sujets
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Search */}
          <div className="px-6 py-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher de l'aide..."
                className="pl-9 pr-9"
                data-testid="input-help-search"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Effacer la recherche"
                >
                  <X className="h-3.5 w-3.5 text-slate-400" />
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <ScrollArea className="flex-1">
            <AnimatePresence mode="wait">
              {selectedTopic ? (
                <motion.div
                  key="detail"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.18 }}
                  className="px-6 py-4"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedTopic(null)}
                    className="mb-3 -ml-2 text-slate-500"
                    data-testid="button-help-back"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Retour
                  </Button>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2.5">
                      <selectedTopic.icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <Badge variant="outline" className="mb-1.5 text-xs">
                        {selectedTopic.category}
                      </Badge>
                      <h3 className="font-semibold text-base leading-snug">
                        {selectedTopic.title}
                      </h3>
                    </div>
                  </div>

                  <ol className="space-y-2.5 mb-4">
                    {selectedTopic.steps.map((step, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-semibold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="pt-0.5 text-slate-700 dark:text-slate-300 leading-relaxed">
                          {step}
                        </span>
                      </li>
                    ))}
                  </ol>

                  {selectedTopic.tip && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 p-3 text-sm text-amber-900 dark:text-amber-200 mb-4">
                      <div className="flex gap-2">
                        <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span><strong>Astuce :</strong> {selectedTopic.tip}</span>
                      </div>
                    </div>
                  )}

                  {selectedTopic.href && (
                    <Button
                      onClick={() => handleGoToPage(selectedTopic.href!)}
                      className="w-full"
                      data-testid="button-help-goto"
                    >
                      Aller à cette page
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="px-3 py-3"
                >
                  {filteredTopics.length === 0 ? (
                    <div className="text-center py-12 px-6">
                      <Search className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-500 mb-1">Aucun résultat trouvé</p>
                      <p className="text-xs text-slate-400">
                        Essayez avec d'autres mots-clés ou contactez le support.
                      </p>
                    </div>
                  ) : (
                    grouped.map(([cat, items]) => (
                      <div key={cat} className="mb-4">
                        <h4 className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {cat}
                        </h4>
                        <div className="space-y-0.5">
                          {items.map((topic) => (
                            <button
                              key={topic.id}
                              type="button"
                              onClick={() => setSelectedTopic(topic)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left group"
                              data-testid={`button-help-topic-${topic.id}`}
                            >
                              <div className="rounded-md bg-slate-100 dark:bg-slate-800 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 p-2 transition-colors">
                                <topic.icon className="h-4 w-4 text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                              </div>
                              <span className="flex-1 text-sm text-slate-800 dark:text-slate-200">
                                {topic.title}
                              </span>
                              <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 dark:text-slate-600" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </ScrollArea>

          {/* Footer */}
          <div className="px-6 py-3 border-t bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center justify-between gap-2">
              <span>
                {filteredTopics.length} sujet{filteredTopics.length > 1 ? "s" : ""}
                {" • "}
                <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border text-[10px]">?</kbd>
              </span>
              <a
                href="mailto:support@agentdebureau.fr"
                className="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <MailIcon className="h-3 w-3" />
                Support
              </a>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
