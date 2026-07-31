import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
Bell,
BrainCircuit,Building2,
Layers,
Mail,
Monitor,Package,
PhoneIncoming,
Printer,
Rocket,
Save,
Settings,Shield,
Sparkles,
Users,
Webhook
} from "lucide-react";
import { lazy,Suspense,useEffect,useMemo,useState } from "react";

import { getAvailableSettingsTabs } from "./settings/settings-access";

const TabAbonnement = lazy(() => import("./settings/tab-abonnement").then(m => ({ default: m.TabAbonnement })));
const TabApiWebhooks = lazy(() => import("./settings/tab-api-webhooks").then(m => ({ default: m.TabApiWebhooks })));
const TabAppels = lazy(() => import("./settings/tab-appels").then(m => ({ default: m.TabAppels })));
const TabClesIa = lazy(() => import("./settings/tab-cles-ia").then(m => ({ default: m.TabClesIa })));
const TabEmailExpediteur = lazy(() => import("./settings/tab-email-expediteur").then(m => ({ default: m.TabEmailExpediteur })));
const TabEquipe = lazy(() => import("./settings/tab-equipe").then(m => ({ default: m.TabEquipe })));
const TabInstallation = lazy(() => import("./settings/tab-installation").then(m => ({ default: m.TabInstallation })));
const TabIntelligenceArtificielle = lazy(() => import("./settings/tab-intelligence-artificielle").then(m => ({ default: m.TabIntelligenceArtificielle })));
const TabMisesAJour = lazy(() => import("./settings/tab-mises-a-jour").then(m => ({ default: m.TabMisesAJour })));
const TabNotifications = lazy(() => import("./settings/tab-notifications").then(m => ({ default: m.TabNotifications })));
const TabPlateformes = lazy(() => import("./settings/tab-plateformes").then(m => ({ default: m.TabPlateformes })));
const TabPreferencesIa = lazy(() => import("./settings/tab-preferences-ia").then(m => ({ default: m.TabPreferencesIa })));
const TabProfilOrg = lazy(() => import("./settings/tab-profil-org").then(m => ({ default: m.TabProfilOrg })));
const TabSauvegardes = lazy(() => import("./settings/tab-sauvegardes").then(m => ({ default: m.TabSauvegardes })));
const TabSecurite = lazy(() => import("./settings/tab-securite").then(m => ({ default: m.TabSecurite })));

function SettingsTabLoader() {
  return (
    <div className="flex min-h-48 items-center justify-center" role="status" aria-label="Chargement">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    </div>
  );
}

function LazySettingsTab({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return <Suspense fallback={<SettingsTabLoader />}>{children}</Suspense>;
}
export default function SettingsPage() {
  const { user } = useWorkspaceUser();
  const { toast } = useToast();
  const { t } = useTranslation();
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";
  const isSuperAdmin = user?.role === "super_admin";
  const [activeTab, setActiveTab] = useState(isAdmin ? "profil" : "appels");
  const availableTabs = useMemo(() => getAvailableSettingsTabs(isAdmin, isSuperAdmin), [isAdmin, isSuperAdmin]);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_success") === "true") {
      setActiveTab("google");
      toast({ title: t("settings.toast.googleConnectedTitle"), description: t("settings.toast.googleConnectedDesc") });
      window.history.replaceState({}, "", window.location.pathname);
    }
    const googleError = params.get("google_error");
    if (googleError) {
      setActiveTab("google");
      const msgs: Record<string, string> = {
        access_denied: t("settings.toast.err_access_denied"),
        no_code: t("settings.toast.err_no_code"),
        invalid_state: t("settings.toast.err_invalid_state"),
        not_authenticated: t("settings.toast.err_not_authenticated"),
        exchange_failed: t("settings.toast.err_exchange_failed"),
      };
      toast({ title: t("settings.toast.googleTitle"), description: msgs[googleError] || t("settings.toast.googleGeneric"), variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    const tabParam = params.get("tab");
    if (tabParam && availableTabs.includes(tabParam)) {
      setActiveTab(tabParam);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast, availableTabs, t]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(isAdmin ? "profil" : "appels");
    }
  }, [activeTab, availableTabs, isAdmin]);


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={Settings} variant="slate" size="md" /> {t("settings.title")}
          </h1>
          <p className="text-muted-foreground">{t("settings.subtitle")}</p>
        </div>
        <Button variant="outline" size="icon" title={t("settings.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1 p-1">
          {isAdmin && (
            <TabsTrigger value="profil" className="gap-2">
              <Building2 className="w-4 h-4" />
              {t("settings.tabs.entreprise")}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="abonnement" className="gap-2">
              <Package className="w-4 h-4" />
              {t("settings.tabs.abonnement")}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="equipe" className="gap-2">
              <Users className="w-4 h-4" />
              {t("settings.tabs.equipe")}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="google" className="gap-2">
              <Layers className="w-4 h-4" />
              {t("settings.tabs.plateformes")}
            </TabsTrigger>
          )}
          <TabsTrigger value="appels" className="gap-2">
            <PhoneIncoming className="w-4 h-4" />
            {t("settings.tabs.appels")}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="sauvegardes" className="gap-2">
              <Save className="w-4 h-4" />
              {t("settings.tabs.sauvegardes")}
            </TabsTrigger>
          )}
          <TabsTrigger value="preferences-ia" className="gap-2">
            <Sparkles className="w-4 h-4" />
            {t("settings.tabs.preferencesIa")}
          </TabsTrigger>
          <TabsTrigger value="installation" className="gap-2">
            <Monitor className="w-4 h-4" />
            {t("settings.tabs.installation")}
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            {t("settings.tabs.notifications")}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="securite" className="gap-2">
              <Shield className="w-4 h-4" />
              {t("settings.tabs.securite")}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="intelligence-artificielle" className="gap-2">
              <BrainCircuit className="w-4 h-4" />
              {t("settings.tabs.ia")}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="api-webhooks" className="gap-2">
              <Webhook className="w-4 h-4" />
              {t("settings.tabs.apiWebhooks")}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="email-expediteur" className="gap-2">
              <Mail className="w-4 h-4" />
              {t("settings.tabs.emailExpediteur")}
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="cles-ia" className="gap-2">
              <BrainCircuit className="w-4 h-4" />
              {t("settings.tabs.clesIa")}
            </TabsTrigger>
          )}
          {isSuperAdmin && (
            <TabsTrigger value="mises-a-jour" className="gap-2">
              <Rocket className="w-4 h-4" />
              {t("settings.tabs.misesAJour")}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profil" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "profil"}><TabProfilOrg /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="abonnement" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "abonnement"}><TabAbonnement /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="equipe" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "equipe"}><TabEquipe /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="google" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "google"}><TabPlateformes /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="appels" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "appels"}><TabAppels /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="sauvegardes" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "sauvegardes"}><TabSauvegardes /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="preferences-ia" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "preferences-ia"}><TabPreferencesIa /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="installation" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "installation"}><TabInstallation /></LazySettingsTab>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6 mt-6">
          <LazySettingsTab active={activeTab === "notifications"}><TabNotifications /></LazySettingsTab>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="securite" className="space-y-6 mt-6">
            <LazySettingsTab active={activeTab === "securite"}><TabSecurite /></LazySettingsTab>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="intelligence-artificielle" className="space-y-6 mt-6">
            <LazySettingsTab active={activeTab === "intelligence-artificielle"}><TabIntelligenceArtificielle /></LazySettingsTab>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="api-webhooks" className="space-y-6 mt-6">
            <LazySettingsTab active={activeTab === "api-webhooks"}><TabApiWebhooks /></LazySettingsTab>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="email-expediteur" className="space-y-6 mt-6">
            <LazySettingsTab active={activeTab === "email-expediteur"}><TabEmailExpediteur /></LazySettingsTab>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="cles-ia" className="space-y-6 mt-6">
            <LazySettingsTab active={activeTab === "cles-ia"}><TabClesIa /></LazySettingsTab>
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="mises-a-jour" className="space-y-6 mt-6">
            <LazySettingsTab active={activeTab === "mises-a-jour"}><TabMisesAJour /></LazySettingsTab>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
