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
import { useEffect,useMemo,useState } from "react";

import { getAvailableSettingsTabs } from "./settings/settings-access";

import { TabAbonnement } from "./settings/tab-abonnement";
import { TabApiWebhooks } from "./settings/tab-api-webhooks";
import { TabAppels } from "./settings/tab-appels";
import { TabClesIa } from "./settings/tab-cles-ia";
import { TabEmailExpediteur } from "./settings/tab-email-expediteur";
import { TabEquipe } from "./settings/tab-equipe";
import { TabInstallation } from "./settings/tab-installation";
import { TabIntelligenceArtificielle } from "./settings/tab-intelligence-artificielle";
import { TabMisesAJour } from "./settings/tab-mises-a-jour";
import { TabNotifications } from "./settings/tab-notifications";
import { TabPlateformes } from "./settings/tab-plateformes";
import { TabPreferencesIa } from "./settings/tab-preferences-ia";
import { TabProfilOrg } from "./settings/tab-profil-org";
import { TabSauvegardes } from "./settings/tab-sauvegardes";
import { TabSecurite } from "./settings/tab-securite";

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
          <TabProfilOrg />
        </TabsContent>

        <TabsContent value="abonnement" className="space-y-6 mt-6">
          <TabAbonnement />
        </TabsContent>

        <TabsContent value="equipe" className="space-y-6 mt-6">
          <TabEquipe />
        </TabsContent>

        <TabsContent value="google" className="space-y-6 mt-6">
          <TabPlateformes />
        </TabsContent>

        <TabsContent value="appels" className="space-y-6 mt-6">
          <TabAppels />
        </TabsContent>

        <TabsContent value="sauvegardes" className="space-y-6 mt-6">
          <TabSauvegardes />
        </TabsContent>

        <TabsContent value="preferences-ia" className="space-y-6 mt-6">
          <TabPreferencesIa />
        </TabsContent>

        <TabsContent value="installation" className="space-y-6 mt-6">
          <TabInstallation />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6 mt-6">
          <TabNotifications />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="securite" className="space-y-6 mt-6">
            <TabSecurite />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="intelligence-artificielle" className="space-y-6 mt-6">
            <TabIntelligenceArtificielle />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="api-webhooks" className="space-y-6 mt-6">
            <TabApiWebhooks />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="email-expediteur" className="space-y-6 mt-6">
            <TabEmailExpediteur />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="cles-ia" className="space-y-6 mt-6">
            <TabClesIa />
          </TabsContent>
        )}

        {isSuperAdmin && (
          <TabsContent value="mises-a-jour" className="space-y-6 mt-6">
            <TabMisesAJour />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
