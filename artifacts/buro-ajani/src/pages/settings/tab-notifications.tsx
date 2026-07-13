import { useState, useEffect, useMemo } from "react";
import { Bell, Save, MessageCircle, Moon, BellOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useGetMyPreferences,
  useUpdateMyPreferences,
  getGetMyPreferencesQueryKey,
  type WhatsAppNotificationFlags,
  type QuietHoursPrefs,
  type BadgeMuteFlags,
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
      <QuietHoursCard />
      <BadgeMuteCard />
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

// ---------------------------------------------------------------------------
// Section Heures silencieuses : fenetre "ne pas deranger" cote serveur. Pendant
// cette plage, les notifications WhatsApp sortantes sont supprimees pour cet
// utilisateur (sauvegarde dans user_preferences.quietHours).
// ---------------------------------------------------------------------------

type QuietHoursDraft = {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
  timezone: string;
};

const QH_DEFAULTS: QuietHoursDraft = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  days: [],
  timezone: "Europe/Paris",
};

// 0 = dimanche ... 6 = samedi (aligne sur Date.getDay / serveur).
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 0, label: "Dim" },
];

function normalizeServerQuietHours(qh: QuietHoursPrefs | undefined): QuietHoursDraft {
  return {
    enabled: qh?.enabled ?? QH_DEFAULTS.enabled,
    start: typeof qh?.start === "string" ? qh.start : QH_DEFAULTS.start,
    end: typeof qh?.end === "string" ? qh.end : QH_DEFAULTS.end,
    days: Array.isArray(qh?.days) ? [...qh.days].sort((a, b) => a - b) : [],
    timezone: typeof qh?.timezone === "string" && qh.timezone ? qh.timezone : QH_DEFAULTS.timezone,
  };
}

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

function QuietHoursCard() {
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

  const serverDraft = useMemo<QuietHoursDraft>(() => {
    const qh = (prefsQuery.data as any)?.quietHours as QuietHoursPrefs | undefined;
    return normalizeServerQuietHours(qh);
  }, [prefsQuery.data]);

  const [draft, setDraft] = useState<QuietHoursDraft>(QH_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  const dirty = useMemo(() => {
    return (
      draft.enabled !== serverDraft.enabled ||
      draft.start !== serverDraft.start ||
      draft.end !== serverDraft.end ||
      draft.timezone !== serverDraft.timezone ||
      !sameDays(draft.days, serverDraft.days)
    );
  }, [draft, serverDraft]);

  // Hydratation initiale + reconciliation apres save sans ecraser une edition.
  useEffect(() => {
    if (!prefsQuery.isSuccess) return;
    if (!hydrated) {
      setDraft(serverDraft);
      setHydrated(true);
    } else if (!dirty) {
      setDraft(serverDraft);
    }
  }, [prefsQuery.isSuccess, serverDraft, hydrated, dirty]);

  const toggleDay = (day: number) => {
    setDraft((prev) => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day].sort((a, b) => a - b),
    }));
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        data: {
          quietHours: {
            enabled: draft.enabled,
            start: draft.start,
            end: draft.end,
            days: draft.days,
            timezone: draft.timezone,
          },
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getGetMyPreferencesQueryKey() });
      toast({ title: "Heures silencieuses enregistrees" });
    } catch (err: any) {
      toast({
        title: "Echec de l'enregistrement",
        description: err?.message || "Erreur reseau",
        variant: "destructive",
      });
    }
  };

  const disabled = prefsQuery.isLoading || updateMutation.isPending;
  const overnight = draft.start > draft.end;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Moon className="w-5 h-5 text-indigo-500" />
              Heures silencieuses
            </CardTitle>
            <CardDescription>
              Pendant cette plage horaire, vous ne recevez plus de notifications WhatsApp.
              Les autres canaux (dans l'application) restent actifs.
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
            <Label>Activer les heures silencieuses</Label>
            <p className="text-xs text-muted-foreground">Suspend les notifications WhatsApp sur la plage choisie</p>
          </div>
          <Switch
            disabled={disabled}
            checked={draft.enabled}
            onCheckedChange={(v) => setDraft((prev) => ({ ...prev, enabled: v }))}
          />
        </div>

        {draft.enabled && (
          <>
            <Separator />
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="qh-start">Debut</Label>
                <Input
                  id="qh-start"
                  type="time"
                  className="w-32"
                  disabled={disabled}
                  value={draft.start}
                  onChange={(e) => setDraft((prev) => ({ ...prev, start: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="qh-end">Fin</Label>
                <Input
                  id="qh-end"
                  type="time"
                  className="w-32"
                  disabled={disabled}
                  value={draft.end}
                  onChange={(e) => setDraft((prev) => ({ ...prev, end: e.target.value }))}
                />
              </div>
            </div>
            {overnight && (
              <p className="text-xs text-muted-foreground">
                Plage de nuit : de {draft.start} jusqu'au lendemain {draft.end}.
              </p>
            )}

            <Separator />
            <div className="space-y-2">
              <Label>Jours d'application</Label>
              <p className="text-xs text-muted-foreground">
                Aucun jour selectionne = tous les jours.
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => {
                  const active = draft.days.includes(d.value);
                  return (
                    <Button
                      key={d.value}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      disabled={disabled}
                      className="w-14"
                      onClick={() => toggleDay(d.value)}
                    >
                      {d.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section Badges : sourdine par section des compteurs "nouveautes" de la
// sidebar (Tâche #76). Sauvegarde cote serveur (user_preferences.mutedBadges).
// Mettre une section en sourdine masque son badge sans toucher aux compteurs
// des autres sections.
// ---------------------------------------------------------------------------

const BADGE_SECTIONS: { key: keyof BadgeMuteFlags; label: string; desc: string }[] = [
  { key: "rappel", label: "Rappels", desc: "Badge des rappels du calendrier" },
  { key: "call", label: "Appels", desc: "Badge des appels manques / messagerie" },
  { key: "message", label: "Messages", desc: "Badge des nouveaux messages internes" },
  { key: "task", label: "Taches", desc: "Badge des nouvelles taches assignees" },
  { key: "note", label: "Notes internes", desc: "Badge des nouvelles notes internes" },
  { key: "prospect", label: "Prospects", desc: "Badge des nouveaux prospects (super-admin)" },
  { key: "agentQueue", label: "File d'approbation", desc: "Badge des propositions de l'agent en attente" },
];

const BADGE_MUTE_DEFAULTS: Required<BadgeMuteFlags> = {
  rappel: false,
  call: false,
  message: false,
  task: false,
  note: false,
  prospect: false,
  agentQueue: false,
};

function BadgeMuteCard() {
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

  const serverFlags = useMemo<Required<BadgeMuteFlags>>(() => {
    const mb = (prefsQuery.data as any)?.mutedBadges as BadgeMuteFlags | undefined;
    return { ...BADGE_MUTE_DEFAULTS, ...(mb ?? {}) };
  }, [prefsQuery.data]);

  const [draft, setDraft] = useState<Required<BadgeMuteFlags>>(BADGE_MUTE_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  const dirty = useMemo(() => {
    return (Object.keys(draft) as Array<keyof BadgeMuteFlags>).some((k) => draft[k] !== serverFlags[k]);
  }, [draft, serverFlags]);

  useEffect(() => {
    if (!prefsQuery.isSuccess) return;
    if (!hydrated) {
      setDraft(serverFlags);
      setHydrated(true);
    } else if (!dirty) {
      setDraft(serverFlags);
    }
  }, [prefsQuery.isSuccess, serverFlags, hydrated, dirty]);

  const update = (key: keyof BadgeMuteFlags, value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ data: { mutedBadges: draft } as any });
      await qc.invalidateQueries({ queryKey: getGetMyPreferencesQueryKey() });
      toast({ title: "Sourdine des badges enregistree" });
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
              <BellOff className="w-5 h-5 text-amber-500" />
              Badges de la barre laterale
            </CardTitle>
            <CardDescription>
              Mettez en sourdine le compteur "nouveautes" de certaines sections.
              Les compteurs des autres sections restent actifs.
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
        {BADGE_SECTIONS.map((section, idx) => (
          <div key={section.key}>
            {idx > 0 && <Separator className="mb-4" />}
            <div className="flex items-center justify-between">
              <div>
                <Label>{section.label}</Label>
                <p className="text-xs text-muted-foreground">{section.desc}</p>
              </div>
              <Switch
                disabled={disabled}
                checked={draft[section.key] === true}
                onCheckedChange={(v) => update(section.key, v)}
                aria-label={`Mettre en sourdine le badge ${section.label}`}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
