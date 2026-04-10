import { useState } from "react";
import { Bell } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function TabNotifications() {
  const [notifAppels, setNotifAppels] = useState(true);
  const [notifTaches, setNotifTaches] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifIA, setNotifIA] = useState(true);

  return (
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
  );
}
