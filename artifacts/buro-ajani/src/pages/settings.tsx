import { useState, useEffect } from "react";
import {
  Settings, Shield, Bell, Save, Monitor, Package,
  PhoneIncoming, Layers, CreditCard
} from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";

import { TabAbonnement } from "./settings/tab-abonnement";
import { TabPlateformes } from "./settings/tab-plateformes";
import { TabAppels } from "./settings/tab-appels";
import { TabSauvegardes } from "./settings/tab-sauvegardes";
import { TabInstallation } from "./settings/tab-installation";
import { TabNotifications } from "./settings/tab-notifications";
import { TabSecurite } from "./settings/tab-securite";
import { TabFacturation } from "./settings/tab-facturation";

export default function SettingsPage() {
  const { user } = useWorkspaceUser();
  const { toast } = useToast();
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";
  const [activeTab, setActiveTab] = useState(isAdmin ? "abonnement" : "appels");

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
  }, [toast]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Icon3D icon={Settings} variant="slate" size="md" /> Parametres
        </h1>
        <p className="text-muted-foreground">Configuration de l'application et integrations.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className={`grid w-full lg:w-auto lg:inline-grid ${isAdmin ? "grid-cols-8" : "grid-cols-3"}`}>
          {isAdmin && (
            <TabsTrigger value="abonnement" className="gap-2">
              <Package className="w-4 h-4" />
              Abonnement
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
            <TabsTrigger value="facturation" className="gap-2">
              <CreditCard className="w-4 h-4" />
              Facturation
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="securite" className="gap-2">
              <Shield className="w-4 h-4" />
              Securite
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="abonnement" className="space-y-6 mt-6">
          <TabAbonnement />
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

        <TabsContent value="facturation" className="space-y-6 mt-6">
          <TabFacturation />
        </TabsContent>

        <TabsContent value="securite" className="space-y-6 mt-6">
          <TabSecurite />
        </TabsContent>
      </Tabs>
    </div>
  );
}
