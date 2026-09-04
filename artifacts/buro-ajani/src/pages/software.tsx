import officeTeamImg from "@/assets/images/office-team.webp";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { Icon3D } from "@/components/icon-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useConnectIntegration,useGetIntegrationsCatalog,useTestIntegration,type SoftwareIntegration } from "@workspace/api-client-react";
import { BarChart3,Brain,CheckCircle2,ChevronDown,ChevronUp,Cpu,CreditCard,FolderKanban,FolderOpen,Globe,Link2,Loader2,Mail,MessageSquare,Printer,Puzzle,Radar,RefreshCw,Search,Settings2,Shield,Sparkles,Target,TrendingUp,Users,Zap } from "lucide-react";
import { useEffect,useState } from "react";
import { useLocation } from "wouter";

const CATEGORY_META: Record<string, { icon: React.ElementType; color: string }> = {
  crm: { icon: Users, color: "text-blue-600 bg-blue-100" },
  communication: { icon: MessageSquare, color: "text-green-600 bg-green-100" },
  gestion_projet: { icon: BarChart3, color: "text-purple-600 bg-purple-100" },
  comptabilite: { icon: CreditCard, color: "text-amber-600 bg-amber-100" },
  documents: { icon: FolderOpen, color: "text-orange-600 bg-orange-100" },
  messagerie: { icon: Mail, color: "text-sky-600 bg-sky-100" },
  marketing: { icon: Zap, color: "text-pink-600 bg-pink-100" },
  automatisation: { icon: RefreshCw, color: "text-indigo-600 bg-indigo-100" },
  support: { icon: Shield, color: "text-teal-600 bg-teal-100" },
};

const LOGO_COLORS: Record<string, string> = {
  salesforce: "bg-[#00A1E0]",
  hubspot: "bg-[#FF7A59]",
  pipedrive: "bg-[#2D2D2D]",
  slack: "bg-[#4A154B]",
  teams: "bg-[#6264A7]",
  zoom: "bg-[#2D8CFF]",
  trello: "bg-[#0079BF]",
  asana: "bg-[#F06A6A]",
  notion: "bg-[#000000]",
  sage: "bg-[#00DC82]",
  quickbooks: "bg-[#2CA01C]",
  docusign: "bg-[#FFCD00]",
  dropbox: "bg-[#0061FF]",
  outlook: "bg-[#0078D4]",
  mailchimp: "bg-[#FFE01B]",
  sendinblue: "bg-[#0092FF]",
  zapier: "bg-[#FF4A00]",
  make: "bg-[#6D00CC]",
  jira: "bg-[#0052CC]",
  intercom: "bg-[#286EFA]",
  zendesk: "bg-[#03363D]",
};

const SOFTWARE_CATALOG_NAMES: Record<string, string> = {
  salesforce: "Salesforce", hubspot: "HubSpot", pipedrive: "Pipedrive", slack: "Slack",
  teams: "Microsoft Teams", zoom: "Zoom", trello: "Trello", asana: "Asana", notion: "Notion",
  sage: "Sage", quickbooks: "QuickBooks", docusign: "DocuSign", dropbox: "Dropbox Business",
  outlook: "Microsoft Outlook", mailchimp: "Mailchimp", sendinblue: "Brevo", zapier: "Zapier",
  make: "Make", jira: "Jira", intercom: "Intercom", zendesk: "Zendesk",
};

function SoftwareLogo({ id, name }: { id: string; name: string }) {
  const bg = LOGO_COLORS[id] || "bg-gray-500";
  const initials = name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
  const textColor = ["docusign", "mailchimp"].includes(id) ? "text-black" : "text-white";
  return (
    <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center ${textColor} font-bold text-sm shrink-0`}>
      {initials}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === "connecte") return <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">{t("software.status.connected")}</Badge>;
  if (status === "en_attente") return <Badge className="bg-amber-100 text-amber-700 text-[10px]">{t("software.status.pending")}</Badge>;
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">{t("software.status.notConnected")}</Badge>;
}

export default function Software() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedIntegration, setSelectedIntegration] = useState<SoftwareIntegration | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const [discovery, setDiscovery] = useState<any>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryExpanded, setDiscoveryExpanded] = useState(true);
  const [discoveryError, setDiscoveryError] = useState(false);
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function navigateToProjets() {
    const res = await fetch(`${baseUrl}/api/projets`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ title: t("software.projectTitle"), status: "planifie", priority: "moyenne", progress: 0, notes: t("software.projectNotes") }),
    });
    if (res.ok) { toast({ title: t("software.toast.projectCreated") }); navigate("/projets"); }
    else toast({ title: t("software.toast.projectCreateError"), variant: "destructive" });
  }

  const { data: catalog, isLoading } = useGetIntegrationsCatalog({
    query: { queryKey: ["integrations-catalog"] },
  });

  const connectMutation = useConnectIntegration();
  const testMutation = useTestIntegration();

  const loadDiscovery = () => {
    setDiscoveryLoading(true);
    setDiscoveryError(false);
    fetch(`${baseUrl}/api/integrations/smart-discovery`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => setDiscovery(data))
      .catch(() => setDiscoveryError(true))
      .finally(() => setDiscoveryLoading(false));
  };

  useEffect(() => { loadDiscovery(); }, []);

  const integrations = catalog?.integrations ?? [];
  const categories = catalog?.categories ?? [];

  const filteredIntegrations = integrations.filter((i: SoftwareIntegration) => {
    const matchesSearch = !searchQuery || i.name.toLowerCase().includes(searchQuery.toLowerCase()) || i.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === "all" || i.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenConfig = (integration: SoftwareIntegration) => {
    setSelectedIntegration(integration);
    setConfigValues({});
  };

  const handleConnect = () => {
    if (!selectedIntegration) return;

    const missingRequired = selectedIntegration.configFields
      .filter((f: any) => f.required && !configValues[f.key]?.trim())
      .map((f: any) => f.label);

    if (missingRequired.length > 0) {
      toast({
        title: t("software.toast.missingRequired"),
        description: t("software.toast.missingRequiredDesc", { fields: missingRequired.join(", ") }),
        variant: "destructive",
      });
      return;
    }

    connectMutation.mutate(
      { integrationId: selectedIntegration.id, data: configValues },
      {
        onSuccess: (response) => {
          toast({
            title: t("software.toast.configured", { name: selectedIntegration.name }),
            description: response.message || t("software.toast.connectionSaved", { name: selectedIntegration.name }),
          });
          setSelectedIntegration(null);
          setConfigValues({});
        },
        onError: () => {
          toast({
            title: t("software.toast.connectionError"),
            description: t("software.toast.connectionErrorDesc", { name: selectedIntegration.name }),
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleTest = () => {
    if (!selectedIntegration) return;
    testMutation.mutate(
      { integrationId: selectedIntegration.id },
      {
        onSuccess: (response) => {
          toast({
            title: t("software.toast.testSuccess"),
            description: response.message || t("software.toast.testSuccessDesc", { name: selectedIntegration.name }),
          });
        },
        onError: () => {
          toast({
            title: t("software.toast.testFailed"),
            description: t("software.toast.testFailedDesc", { name: selectedIntegration.name }),
            variant: "destructive",
          });
        },
      }
    );
  };

  const categoryCounts = [
    { id: "all", label: t("software.all"), count: integrations.length },
    ...categories.filter((c: any) => c.id !== "all").map((c: any) => ({
      ...c,
      count: integrations.filter((i: SoftwareIntegration) => i.category === c.id).length,
    })),
  ];

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 flex items-center justify-center gap-3 py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="text-muted-foreground">{t("software.loading")}</span>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3"><Icon3D icon={Puzzle} variant="purple" size="md" /> {t("software.title")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("software.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-100 text-emerald-700 text-sm px-3 py-1">
            {t("software.available", { count: catalog?.totalAvailable ?? 0 })}
          </Badge>
          <Button variant="outline" size="sm" className="gap-1.5 text-indigo-600 border-indigo-300 hover:bg-indigo-50" onClick={navigateToProjets}>
            <FolderKanban className="w-4 h-4" />{t("software.createProject")}
          </Button>
          <Button variant="outline" size="icon" title={t("software.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={officeTeamImg} alt={t("software.bannerAlt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-purple-900/80 via-purple-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">{t("software.bannerTitle")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("software.bannerSubtitle")}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-violet-200 dark:border-violet-800 bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-violet-950/30 dark:via-background dark:to-indigo-950/20 overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                <Radar className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2">
                  {t("software.smartDiscovery")}
                  <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 text-[10px]">
                    <Sparkles className="w-3 h-3 mr-0.5" /> {t("software.aiBadge")}
                  </Badge>
                </h3>
                <p className="text-xs text-muted-foreground">{t("software.smartDiscoveryDesc")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={loadDiscovery} disabled={discoveryLoading} className="text-xs h-7">
                {discoveryLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                {t("software.analyze")}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDiscoveryExpanded(!discoveryExpanded)} aria-label={t("common.toggleDetails")}>
                {discoveryExpanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        </div>

        {discoveryExpanded && (
          <div className="px-5 pb-5">
            {discoveryLoading && (
              <div className="flex items-center justify-center gap-3 py-8">
                <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
                <span className="text-sm text-muted-foreground">{t("software.analyzing")}</span>
              </div>
            )}

            {discoveryError && (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">{t("software.discoveryError")}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={loadDiscovery}>{t("software.retry")}</Button>
              </div>
            )}

            {discovery && !discoveryLoading && (
              <div className="space-y-4">
                {discovery.detectedPlatforms?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5" /> {t("software.detectedPlatforms")}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {discovery.detectedPlatforms.map((p: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-white/5 border border-violet-100 dark:border-violet-800/50 shadow-sm">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-4 h-4 text-white" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm">{p.name}</p>
                            <p className="text-[11px] text-muted-foreground">{p.reason}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[9px] py-0">{t("software.confidence", { pct: p.confidence })}</Badge>
                              <Badge variant="outline" className="text-[9px] py-0">{t("software.servicesCount", { count: p.ecosystem.length })}</Badge>
                            </div>
                            {p.ecosystem.length > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-1 truncate">{p.ecosystem.slice(0, 4).join(" · ")}{p.ecosystem.length > 4 ? ` +${p.ecosystem.length - 4}` : ""}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {discovery.detectedIndustry?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5" /> {t("software.detectedIndustry")}
                    </p>
                    {discovery.detectedIndustry.map((ind: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{ind.reason}</p>
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[9px] mt-1">{t("software.confidence", { pct: ind.confidence })}</Badge>
                      </div>
                    ))}
                  </div>
                )}

                {discovery.scoredRecommendations?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" /> {t("software.recommendations", { count: discovery.scoredRecommendations.length })}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {discovery.scoredRecommendations.slice(0, 6).map((rec: any, idx: number) => {
                        const bg = LOGO_COLORS[rec.integration.id] || "bg-gray-500";
                        const initials = rec.integration.name.split(" ").map((w: string) => w[0]).join("").substring(0, 2).toUpperCase();
                        const textColor = ["docusign", "mailchimp"].includes(rec.integration.id) ? "text-black" : "text-white";
                        return (
                          <button type="button" key={idx} className="flex w-full items-start gap-3 p-3 rounded-xl bg-white dark:bg-white/5 border shadow-sm hover:shadow-md transition-shadow text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => handleOpenConfig(rec.integration)}>
                            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center ${textColor} font-bold text-xs shrink-0`}>
                              {initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold text-sm">{rec.integration.name}</p>
                                <Badge className={`text-[9px] py-0 ${rec.priority === "haute" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400" : rec.priority === "moyenne" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                                  {rec.priority === "haute" ? t("software.priorityHigh") : rec.priority === "moyenne" ? t("software.priorityMedium") : t("software.priorityLow")}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{rec.reasons[0]}</p>
                              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1 mt-1.5">
                                <div className="bg-gradient-to-r from-violet-500 to-indigo-500 h-1 rounded-full" style={{ width: `${rec.score}%` }} />
                              </div>
                              <p className="text-[9px] text-muted-foreground mt-0.5">{t("software.score", { score: rec.score })}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {discovery.aiInsights && (
                  <div className="p-4 rounded-xl bg-gradient-to-r from-violet-100/60 to-indigo-100/60 dark:from-violet-900/20 dark:to-indigo-900/20 border border-violet-200 dark:border-violet-800/50">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center shrink-0">
                        <Brain className="w-4 h-4 text-white" />
                      </div>
                      <div className="space-y-2 min-w-0">
                        <p className="font-semibold text-sm flex items-center gap-1.5">
                          {t("software.aiAnalysis")}
                          <Badge className="bg-violet-200 text-violet-800 dark:bg-violet-800 dark:text-violet-200 text-[9px]">Gemini</Badge>
                        </p>
                        {discovery.aiInsights.insights && (
                          <p className="text-sm text-foreground/80">{discovery.aiInsights.insights}</p>
                        )}
                        {discovery.aiInsights.topRecommendations?.length > 0 && (
                          <div className="space-y-1.5 mt-2">
                            {discovery.aiInsights.topRecommendations.map((rec: any, idx: number) => (
                              <div key={idx} className="flex items-start gap-2 text-sm">
                                <Cpu className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                                <div>
                                  <span className="font-medium">{rec.softwareId ? SOFTWARE_CATALOG_NAMES[rec.softwareId] || rec.softwareId : ""}: </span>
                                  <span className="text-foreground/70">{rec.reason}</span>
                                  {rec.businessImpact && <span className="text-violet-600 dark:text-violet-400 text-xs ml-1">→ {rec.businessImpact}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {discovery.aiInsights.ecosystemAdvice && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{discovery.aiInsights.ecosystemAdvice}</p>
                        )}
                        {discovery.aiInsights.automationTip && (
                          <div className="flex items-center gap-1.5 mt-1 text-xs text-indigo-600 dark:text-indigo-400">
                            <Zap className="w-3 h-3" />
                            {discovery.aiInsights.automationTip}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {discovery.orgProfile && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="w-3 h-3" /> {t("software.usersCount", { count: discovery.orgProfile.userCount })}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="w-3 h-3" /> {t("software.contactsCount", { count: discovery.orgProfile.contactCount })}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MessageSquare className="w-3 h-3" /> {t("software.callsCount", { count: discovery.orgProfile.callCount })}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3" /> {t("software.tasksCount", { count: discovery.orgProfile.taskCount })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input aria-label={t("software.searchPlaceholder")}
          placeholder={t("software.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {categoryCounts.map(cat => {
          const meta = CATEGORY_META[cat.id];
          return (
            <Button
              key={cat.id}
              variant={activeCategory === cat.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(cat.id)}
              className={activeCategory === cat.id ? "" : "hover:bg-accent"}
            >
              {meta && <meta.icon className="w-3.5 h-3.5 mr-1.5" />}
              {cat.id === "all" && <Puzzle className="w-3.5 h-3.5 mr-1.5" />}
              {(cat.id === "all" ? cat.label : (CATEGORY_META[cat.id] ? t(`software.categories.${cat.id}`) : cat.label))} ({cat.count})
            </Button>
          );
        })}
      </div>

      <AiSuggestionsCard page="logiciels" />

      {filteredIntegrations.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center gap-4 text-center">
            <Puzzle className="w-12 h-12 text-muted-foreground/30" />
            <h3 className="text-lg font-medium">{t("software.empty")}</h3>
            <p className="text-sm text-muted-foreground">{t("software.emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredIntegrations.map((integration: SoftwareIntegration) => {
            const catMeta = CATEGORY_META[integration.category];
            return (
              <Card key={integration.id} className="hover:shadow-md transition-shadow group">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <SoftwareLogo id={integration.id} name={integration.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-sm truncate">{integration.name}</h3>
                        <StatusBadge status={integration.status} />
                      </div>
                      {catMeta && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${catMeta.color}`}>
                            <catMeta.icon className="w-3 h-3" />
                            {t(`software.categories.${integration.category}`)}
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{integration.description}</p>
                      <div className="space-y-1 mb-3">
                        {integration.features.slice(0, 2).map((f, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                            <span className="truncate">{f}</span>
                          </div>
                        ))}
                        {integration.features.length > 2 && (
                          <span className="text-[10px] text-muted-foreground">{t("software.moreFeatures", { count: integration.features.length - 2 })}</span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => handleOpenConfig(integration)}
                      >
                        <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                        {t("software.configure")}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedIntegration} onOpenChange={(open) => { if (!open) { setSelectedIntegration(null); setConfigValues({}); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedIntegration && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <SoftwareLogo id={selectedIntegration.id} name={selectedIntegration.name} />
                  <div>
                    <DialogTitle>{selectedIntegration.name}</DialogTitle>
                    <DialogDescription>{selectedIntegration.description}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <Separator />

              <div>
                <h4 className="text-sm font-semibold mb-2">{t("software.features")}</h4>
                <div className="space-y-1.5">
                  {selectedIntegration.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="text-sm font-semibold">{t("software.configuration")}</h4>
                {selectedIntegration.configFields.map((field: any) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </Label>
                    <Input
                      aria-label={field.label}
                      type={field.type === "password" ? "password" : "text"}
                      placeholder={field.type === "url" ? "https://..." : field.label}
                      value={configValues[field.key] || ""}
                      onChange={(e) => setConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => handleTest()} disabled={testMutation.isPending}>
                  {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {t("software.test")}
                </Button>
                <Button onClick={handleConnect} disabled={connectMutation.isPending} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white">
                  {connectMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      {t("software.connecting")}
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" />
                      {t("software.connect", { name: selectedIntegration.name })}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
