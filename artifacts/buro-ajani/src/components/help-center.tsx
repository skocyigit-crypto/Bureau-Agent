import { useTranslation } from "@/i18n";
import { AnimatePresence,motion } from "framer-motion";
import {
ArrowLeft,
BarChart3,
Bell,
Briefcase,
Calendar,
CheckSquare,
ChevronRight,
CreditCard,
FileText,
FolderOpen,
HelpCircle,
Mail,
Mail as MailIcon,
MessageSquare,
Phone,
Plug,
Search,
Settings as SettingsIcon,
Shield,
Smartphone,
Sparkles,
Users,
X,
} from "lucide-react";
import { useEffect,useMemo,useState } from "react";
import { useLocation } from "wouter";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import {
Sheet,
SheetContent,
SheetDescription,
SheetHeader,
SheetTitle,
} from "./ui/sheet";

// Les champs textuels (title/steps/tip/category) sont internationalises via t()
// au moment du rendu; le tableau ne conserve que des cles stables et le nombre
// d'etapes. On ne peut pas appeler t() au niveau module.
type HelpTopic = {
  id: string;
  category: string; // slug de categorie (cle i18n)
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  href?: string;
  stepCount: number;
  hasTip?: boolean;
};

const TOPICS: HelpTopic[] = [
  // Démarrage
  {
    id: "premiers-pas",
    category: "demarrage",
    icon: Sparkles,
    keywords: ["debut", "commencer", "start", "nouveau", "decouvrir"],
    href: "/onboarding",
    stepCount: 5,
    hasTip: true,
  },
  // Communication
  {
    id: "appels",
    category: "communication",
    icon: Phone,
    keywords: ["appel", "telephone", "call", "twilio", "voip", "communication"],
    href: "/appels",
    stepCount: 4,
    hasTip: true,
  },
  {
    id: "messages",
    category: "communication",
    icon: MessageSquare,
    keywords: ["message", "sms", "chat", "envoyer", "communication"],
    href: "/messages",
    stepCount: 4,
  },
  {
    id: "gmail",
    category: "communication",
    icon: Mail,
    keywords: ["mail", "email", "gmail", "courrier", "ia", "agent"],
    href: "/gmail-agent",
    stepCount: 4,
    hasTip: true,
  },
  // Carnet d'adresses
  {
    id: "contacts",
    category: "carnet",
    icon: Users,
    keywords: ["contact", "client", "carnet", "adresse", "annuaire"],
    href: "/contacts",
    stepCount: 4,
  },
  {
    id: "prospects",
    category: "carnet",
    icon: Briefcase,
    keywords: ["prospect", "vente", "crm", "pipeline", "lead"],
    href: "/prospects",
    stepCount: 4,
  },
  // Organisation
  {
    id: "taches",
    category: "organisation",
    icon: CheckSquare,
    keywords: ["tache", "todo", "rappel", "echeance", "deadline"],
    href: "/taches",
    stepCount: 4,
  },
  {
    id: "projets",
    category: "organisation",
    icon: FolderOpen,
    keywords: ["projet", "project", "equipe", "collaboration"],
    href: "/projets",
    stepCount: 4,
  },
  {
    id: "calendrier",
    category: "organisation",
    icon: Calendar,
    keywords: ["calendrier", "agenda", "rdv", "rendez-vous", "google calendar"],
    href: "/calendrier",
    stepCount: 4,
  },
  // Documents
  {
    id: "documents",
    category: "documents",
    icon: FileText,
    keywords: ["document", "fichier", "pdf", "stockage", "drive"],
    href: "/documents",
    stepCount: 4,
    hasTip: true,
  },
  {
    id: "rapports",
    category: "documents",
    icon: BarChart3,
    keywords: ["rapport", "report", "statistique", "bilan", "performance"],
    href: "/rapports",
    stepCount: 4,
  },
  // IA
  {
    id: "agents-ia",
    category: "ia",
    icon: Sparkles,
    keywords: ["ia", "ai", "agent", "intelligence", "assistant", "automatisation"],
    href: "/agents-ia",
    stepCount: 4,
    hasTip: true,
  },
  {
    id: "commandant-ia",
    category: "ia",
    icon: Sparkles,
    keywords: ["commandant", "chat", "ia", "question", "assistant central"],
    href: "/commandant-ia",
    stepCount: 4,
  },
  // Intégrations
  {
    id: "google-workspace",
    category: "integrations",
    icon: Plug,
    keywords: ["google", "workspace", "gmail", "drive", "calendar", "agenda", "integration", "oauth", "connexion", "email", "mail"],
    href: "/google-workspace",
    stepCount: 5,
    hasTip: true,
  },
  {
    id: "telephonie",
    category: "integrations",
    icon: Phone,
    keywords: ["twilio", "telephonie", "voip", "appel", "configuration", "numero"],
    href: "/telephonie",
    stepCount: 4,
  },
  // Facturation
  {
    id: "abonnement",
    category: "facturation",
    icon: CreditCard,
    keywords: ["abonnement", "facture", "billing", "stripe", "plan", "payment", "carte"],
    href: "/parametres",
    stepCount: 4,
    hasTip: true,
  },
  {
    id: "factures",
    category: "facturation",
    icon: FileText,
    keywords: ["facture", "invoice", "pdf", "comptabilite", "telecharger"],
    href: "/gestion-licence",
    stepCount: 4,
  },
  // Mobile
  {
    id: "mobile",
    category: "mobile-app",
    icon: Smartphone,
    keywords: ["mobile", "app", "smartphone", "android", "ios", "telecharger"],
    href: "/telecharger",
    stepCount: 4,
  },
  // Sécurité
  {
    id: "utilisateurs",
    category: "administration",
    icon: Users,
    keywords: ["utilisateur", "user", "equipe", "invitation", "role", "admin", "permission"],
    href: "/utilisateurs",
    stepCount: 4,
  },
  {
    id: "protection-donnees",
    category: "administration",
    icon: Shield,
    keywords: ["rgpd", "gdpr", "protection", "donnee", "privacy", "securite", "sauvegarde"],
    href: "/protection-donnees",
    stepCount: 4,
  },
  // Paramètres
  {
    id: "parametres",
    category: "parametres",
    icon: SettingsIcon,
    keywords: ["parametre", "settings", "profil", "notification", "preference", "langue"],
    href: "/parametres",
    stepCount: 4,
  },
  {
    id: "notifications",
    category: "parametres",
    icon: Bell,
    keywords: ["notification", "alerte", "rappel", "push", "email"],
    href: "/parametres",
    stepCount: 4,
  },
];


function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function HelpCenter() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<HelpTopic | null>(null);
  const [, setLocation] = useLocation();

  // Helpers de traduction pour les champs du tableau TOPICS (module-scope).
  const topicTitle = (topic: HelpTopic) => t(`helpCenter.topics.${topic.id}.title`);
  const topicSteps = (topic: HelpTopic) =>
    Array.from({ length: topic.stepCount }, (_, i) =>
      t(`helpCenter.topics.${topic.id}.step${i}`),
    );
  const topicTip = (topic: HelpTopic) => t(`helpCenter.topics.${topic.id}.tip`);
  const categoryLabel = (cat: string) => t(`helpCenter.categories.${cat}`);

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
    return TOPICS.filter((topic) => {
      const haystack = normalize(
        [
          topicTitle(topic),
          categoryLabel(topic.category),
          ...topic.keywords,
          ...topicSteps(topic),
        ].join(" ")
      );
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t]);

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
        aria-label={t("helpCenter.openAria")}
        title={t("helpCenter.openTitle")}
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
                <SheetTitle>{t("helpCenter.title")}</SheetTitle>
                <SheetDescription className="text-xs">
                  {t("helpCenter.subtitle")}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Search */}
          <div className="px-6 py-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input aria-label={t("helpCenter.searchPlaceholder")}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("helpCenter.searchPlaceholder")}
                className="pl-9 pr-9"
                data-testid="input-help-search"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label={t("helpCenter.clearSearch")}
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
                    {t("helpCenter.back")}
                  </Button>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2.5">
                      <selectedTopic.icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <Badge variant="outline" className="mb-1.5 text-xs">
                        {categoryLabel(selectedTopic.category)}
                      </Badge>
                      <h3 className="font-semibold text-base leading-snug">
                        {topicTitle(selectedTopic)}
                      </h3>
                    </div>
                  </div>

                  <ol className="space-y-2.5 mb-4">
                    {topicSteps(selectedTopic).map((step, i) => (
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

                  {selectedTopic.hasTip && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 p-3 text-sm text-amber-900 dark:text-amber-200 mb-4">
                      <div className="flex gap-2">
                        <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span><strong>{t("helpCenter.tipLabel")}</strong> {topicTip(selectedTopic)}</span>
                      </div>
                    </div>
                  )}

                  {selectedTopic.href && (
                    <Button
                      onClick={() => handleGoToPage(selectedTopic.href!)}
                      className="w-full"
                      data-testid="button-help-goto"
                    >
                      {t("helpCenter.gotoPage")}
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
                      <p className="text-sm text-slate-500 mb-1">{t("helpCenter.noResultsTitle")}</p>
                      <p className="text-xs text-slate-400">
                        {t("helpCenter.noResultsDesc")}
                      </p>
                    </div>
                  ) : (
                    grouped.map(([cat, items]) => (
                      <div key={cat} className="mb-4">
                        <h4 className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {categoryLabel(cat)}
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
                                {topicTitle(topic)}
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
                {filteredTopics.length > 1
                  ? t("helpCenter.subjectsPlural", { count: filteredTopics.length })
                  : t("helpCenter.subjectsSingular", { count: filteredTopics.length })}
                {" • "}
                <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border text-[10px]">?</kbd>
              </span>
              <a
                href="mailto:support@agentdebureau.fr"
                className="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400"
              >
                <MailIcon className="h-3 w-3" />
                {t("helpCenter.support")}
              </a>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
