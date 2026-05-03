import { useState, useEffect } from "react";
import {
  Settings, Shield, Bell, Save, Monitor, Package,
  PhoneIncoming, Layers, Rocket, BrainCircuit, Building2, Users
} from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";

import { TabAbonnement } from "./settings/tab-abonnement";
import { TabEquipe } from "./settings/tab-equipe";
import { TabPlateformes } from "./settings/tab-plateformes";
import { TabAppels } from "./settings/tab-appels";
import { TabSauvegardes } from "./settings/tab-sauvegardes";
import { TabInstallation } from "./settings/tab-installation";
import { TabNotifications } from "./settings/tab-notifications";
import { TabSecurite } from "./settings/tab-securite";
import { TabMisesAJour } from "./settings/tab-mises-a-jour";
import { TabIntelligenceArtificielle } from "./settings/tab-intelligence-artificielle";
import { TabProfilOrg } from "./settings/tab-profil-org";

export default function SettingsPage() {
  const { user } = useWorkspaceUser();
  const { toast } = useToast();
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";
  const isSuperAdmin = user?.role === "super_admin";
  const [activeTab, setActiveTab] = useState(isAdmin ? "profil" : "appels");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_success") === "true") {
      setActiveTab("google");
      toast({ title: "Google Workspace connecte", description: "Votre compte Google a ete connecte avec succes." });
      window.history.replaceState({}, "", window.location.pathname);
    }
    const googleError = params.get("google_error");
    if (googleError) {
      setActiveTab("google");
      const msgs: Record<string, string> = {
        access_denied: "Vous avez refuse l'acces a Google.",
        no_code: "Code d'autorisation manquant.",
        invalid_state: "Session invalide. Veuillez reessayer.",
        not_authenticated: "Vous devez etre connecte a l'application.",
        not_configured: "Google Workspace n'est pas configure.",
        exchange_failed: "Erreur lors de l'echange du token.",
      };
      toast({ title: "Erreur Google", description: msgs[googleError] || "Erreur inconnue.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
    const tabParam = params.get("tab");
    const VALID_TABS = ["profil", "abonnement", "equipe", "google", "appels", "sauvegardes", "installation", "notifications", "securite", "mises-a-jour", "intelligence-artificielle"];
    if (tabParam && VALID_TABS.includes(tabParam)) {
      setActiveTab(tabParam);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  const adminTabCount = isSuperAdmin ? 11 : isAdmin ? 10 : 3;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Icon3D icon={Settings} variant="slate" size="md" /> Parametres
        </h1>
        <p className="text-muted-foreground">Configuration de l'application et integrations.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className={`grid w-full lg:w-auto lg:inline-grid grid-cols-3 md:grid-cols-${Math.min(adminTabCount, 5)} lg:grid-cols-${adminTabCount}`}>
          {isAdmin && (
            <TabsTrigger value="profil" className="gap-2">
              <Building2 className="w-4 h-4" />
              Entreprise
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="abonnement" className="gap-2">
              <Package className="w-4 h-4" />
              Abonnement
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="equipe" className="gap-2">
              <Users className="w-4 h-4" />
              Équipe
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="google" className="gap-2">
              <Layers className="w-4 h-4" />
              Plateformes
            </TabsTrigger>
          )}
          <TabsTrigger value="appels" className="gap-2">
            <PhoneIncoming className="w-4 h-4" />
            Appels
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="sauvegardes" className="gap-2">
              <Save className="w-4 h-4" />
              Sauvegardes
            </TabsTrigger>
          )}
          <TabsTrigger value="installation" className="gap-2">
            <Monitor className="w-4 h-4" />
            Installation
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="securite" className="gap-2">
              <Shield className="w-4 h-4" />
              Securite
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="intelligence-artificielle" className="gap-2">
              <BrainCircuit className="w-4 h-4" />
              IA
            </TabsTrigger>
          )}
          {isSuperAdmin && (
            <TabsTrigger value="mises-a-jour" className="gap-2">
              <Rocket className="w-4 h-4" />
              Mises a jour
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

        <TabsContent value="installation" className="space-y-6 mt-6">
          <TabInstallation />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6 mt-6">
          <TabNotifications />
        </TabsContent>

        <TabsContent value="securite" className="space-y-6 mt-6">
          <TabSecurite />
        </TabsContent>

        <TabsContent value="intelligence-artificielle" className="space-y-6 mt-6">
          <TabIntelligenceArtificielle />
        </TabsContent>

        <TabsContent value="mises-a-jour" className="space-y-6 mt-6">
          <TabMisesAJour />
        </TabsContent>
      </Tabs>
    </div>
  );
}
