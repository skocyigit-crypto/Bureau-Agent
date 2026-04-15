import { useState, useEffect } from "react";
import { Bell, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "agent-bureau-notif-prefs";

interface NotifPrefs {
  appels: boolean;
  taches: boolean;
  messages: boolean;
  ia: boolean;
  securite: boolean;
  rapportSecurite: boolean;
}

const DEFAULT_PREFS: NotifPrefs = {
  appels: true,
  taches: true,
  messages: true,
  ia: true,
  securite: true,
  rapportSecurite: true,
};

function loadPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PREFS;
}

export function TabNotifications() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>(loadPrefs);
  const [dirty, setDirty] = useState(false);

  const update = (key: keyof NotifPrefs, value: boolean) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    setDirty(false);
    toast({ title: "Preferences enregistrees" });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Preferences de notification
            </CardTitle>
            <CardDescription>Choisissez les notifications que vous souhaitez recevoir.</CardDescription>
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave} className="gap-2">
              <Save className="w-4 h-4" /> Enregistrer
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Appels manques</Label>
            <p className="text-xs text-muted-foreground">Notification pour chaque appel manque</p>
          </div>
          <Switch checked={prefs.appels} onCheckedChange={(v) => update("appels", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Taches en retard</Label>
            <p className="text-xs text-muted-foreground">Alerte quand une tache depasse sa date limite</p>
          </div>
          <Switch checked={prefs.taches} onCheckedChange={(v) => update("taches", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Nouveaux messages</Label>
            <p className="text-xs text-muted-foreground">Notification pour les messages urgents</p>
          </div>
          <Switch checked={prefs.messages} onCheckedChange={(v) => update("messages", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Alertes IA</Label>
            <p className="text-xs text-muted-foreground">Notifications de la reconnaissance IA (detections critiques)</p>
          </div>
          <Switch checked={prefs.ia} onCheckedChange={(v) => update("ia", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Alertes de securite Workspace</Label>
            <p className="text-xs text-muted-foreground">Notification immediate en cas de menace detectee, fichier bloque ou tentative de phishing</p>
          </div>
          <Switch checked={prefs.securite} onCheckedChange={(v) => update("securite", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Rapport de securite quotidien</Label>
            <p className="text-xs text-muted-foreground">Resume quotidien des evenements de securite envoye au Super Administrateur</p>
          </div>
          <Switch checked={prefs.rapportSecurite} onCheckedChange={(v) => update("rapportSecurite", v)} />
        </div>
      </CardContent>
    </Card>
  );
}
