import { useState, useEffect, useMemo } from "react";
import { Bell, Save, MessageCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useGetMyPreferences,
  useUpdateMyPreferences,
  getGetMyPreferencesQueryKey,
  type WhatsAppNotificationFlags,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

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
    <div className="space-y-6">
      <WhatsAppNotificationsCard />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section WhatsApp : opt-in cote serveur (sauvegarde dans user_preferences,
// utilise par les routes tasks / twilio-voice / calendar / messages pour
// envoyer une notification WhatsApp aux membres de l'organisation).
// ---------------------------------------------------------------------------

const WA_DEFAULTS: Required<WhatsAppNotificationFlags> = {
  task: false,
  call: false,
  appointment: false,
  message: false,
};

function WhatsAppNotificationsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const prefsQuery = useGetMyPreferences({
    query: {
      queryKey: getGetMyPreferencesQueryKey(),
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  });
  const updateMutation = useUpdateMyPreferences();

  const serverFlags = useMemo<Required<WhatsAppNotificationFlags>>(() => {
    const wa = (prefsQuery.data as any)?.whatsappNotifications as WhatsAppNotificationFlags | undefined;
    return { ...WA_DEFAULTS, ...(wa ?? {}) };
  }, [prefsQuery.data]);

  const [draft, setDraft] = useState<Required<WhatsAppNotificationFlags>>(WA_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  const dirty = useMemo(() => {
    return (Object.keys(draft) as Array<keyof WhatsAppNotificationFlags>)
      .some((k) => draft[k] !== serverFlags[k]);
  }, [draft, serverFlags]);

  // Hydratation initiale + reconciliations apres save. Un refetch en
  // arriere-plan ne doit JAMAIS ecraser une modification non sauvegardee.
  useEffect(() => {
    if (!prefsQuery.isSuccess) return;
    if (!hydrated) {
      setDraft(serverFlags);
      setHydrated(true);
    } else if (!dirty) {
      setDraft(serverFlags);
    }
  }, [prefsQuery.isSuccess, serverFlags, hydrated, dirty]);

  const update = (key: keyof WhatsAppNotificationFlags, value: boolean) => {
    setDraft((prev: Required<WhatsAppNotificationFlags>) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ data: { whatsappNotifications: draft } as any });
      await qc.invalidateQueries({ queryKey: getGetMyPreferencesQueryKey() });
      toast({ title: "Notifications WhatsApp enregistrees" });
    } catch (err: any) {
      toast({
        title: "Echec de l'enregistrement",
        description: err?.message || "Erreur reseau",
        variant: "destructive",
      });
    }
  };

  const disabled = prefsQuery.isLoading || updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-green-600" />
              Notifications WhatsApp
            </CardTitle>
            <CardDescription>
              Recevez les alertes du bureau directement sur WhatsApp. Necessite un numero
              de telephone renseigne dans votre profil et un fournisseur Twilio actif
              cote organisation.
            </CardDescription>
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={disabled} className="gap-2">
              <Save className="w-4 h-4" /> Enregistrer
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Nouvelle tache assignee</Label>
            <p className="text-xs text-muted-foreground">Quand une tache vous est attribuee</p>
          </div>
          <Switch
            disabled={disabled}
            checked={draft.task}
            onCheckedChange={(v) => update("task", v)}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Appel entrant</Label>
            <p className="text-xs text-muted-foreground">Lorsque l'agent telephonique recoit un appel</p>
          </div>
          <Switch
            disabled={disabled}
            checked={draft.call}
            onCheckedChange={(v) => update("call", v)}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Nouveau rendez-vous</Label>
            <p className="text-xs text-muted-foreground">Quand un evenement est cree dans l'agenda</p>
          </div>
          <Switch
            disabled={disabled}
            checked={draft.appointment}
            onCheckedChange={(v) => update("appointment", v)}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>Nouveau message</Label>
            <p className="text-xs text-muted-foreground">Lorsqu'un message interne est ajoute</p>
          </div>
          <Switch
            disabled={disabled}
            checked={draft.message}
            onCheckedChange={(v) => update("message", v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
