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
import { useTranslation } from "@/i18n";

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
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<NotifPrefs>(loadPrefs);
  const [dirty, setDirty] = useState(false);

  const update = (key: keyof NotifPrefs, value: boolean) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    setDirty(false);
    toast({ title: t("settingsNotifications.prefsSaved") });
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
              {t("settingsNotifications.prefsTitle")}
            </CardTitle>
            <CardDescription>{t("settingsNotifications.prefsDesc")}</CardDescription>
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave} className="gap-2">
              <Save className="w-4 h-4" /> {t("common.save")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.missedCalls")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.missedCallsDesc")}</p>
          </div>
          <Switch checked={prefs.appels} onCheckedChange={(v) => update("appels", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.lateTasks")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.lateTasksDesc")}</p>
          </div>
          <Switch checked={prefs.taches} onCheckedChange={(v) => update("taches", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.newMessages")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.newMessagesDesc")}</p>
          </div>
          <Switch checked={prefs.messages} onCheckedChange={(v) => update("messages", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.aiAlerts")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.aiAlertsDesc")}</p>
          </div>
          <Switch checked={prefs.ia} onCheckedChange={(v) => update("ia", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.secAlerts")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.secAlertsDesc")}</p>
          </div>
          <Switch checked={prefs.securite} onCheckedChange={(v) => update("securite", v)} />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.dailyReport")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.dailyReportDesc")}</p>
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
  const { t } = useTranslation();
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
      toast({ title: t("settingsNotifications.wa.saved") });
    } catch (err: any) {
      toast({
        title: t("settingsNotifications.saveError"),
        description: err?.message || t("settingsNotifications.netError"),
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
              {t("settingsNotifications.wa.title")}
            </CardTitle>
            <CardDescription>
              {t("settingsNotifications.wa.desc")}
            </CardDescription>
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={disabled} className="gap-2">
              <Save className="w-4 h-4" /> {t("common.save")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.wa.taskLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.wa.taskDesc")}</p>
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
            <Label>{t("settingsNotifications.wa.callLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.wa.callDesc")}</p>
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
            <Label>{t("settingsNotifications.wa.apptLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.wa.apptDesc")}</p>
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
            <Label>{t("settingsNotifications.wa.msgLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.wa.msgDesc")}</p>
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
  const { t } = useTranslation();
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
      toast({ title: t("settingsNotifications.qh.saved") });
    } catch (err: any) {
      toast({
        title: t("settingsNotifications.saveError"),
        description: err?.message || t("settingsNotifications.netError"),
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
              {t("settingsNotifications.qh.title")}
            </CardTitle>
            <CardDescription>
              {t("settingsNotifications.qh.desc")}
            </CardDescription>
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={disabled} className="gap-2">
              <Save className="w-4 h-4" /> {t("common.save")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>{t("settingsNotifications.qh.enableLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("settingsNotifications.qh.enableDesc")}</p>
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
                <Label htmlFor="qh-start">{t("settingsNotifications.qh.start")}</Label>
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
                <Label htmlFor="qh-end">{t("settingsNotifications.qh.end")}</Label>
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
                {t("settingsNotifications.qh.overnight", { start: draft.start, end: draft.end })}
              </p>
            )}

            <Separator />
            <div className="space-y-2">
              <Label>{t("settingsNotifications.qh.daysTitle")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settingsNotifications.qh.daysHint")}
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
                      {t(`settingsNotifications.days.${d.value}`)}
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
  const { t } = useTranslation();
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
      toast({ title: t("settingsNotifications.badge.saved") });
    } catch (err: any) {
      toast({
        title: t("settingsNotifications.saveError"),
        description: err?.message || t("settingsNotifications.netError"),
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
              {t("settingsNotifications.badge.title")}
            </CardTitle>
            <CardDescription>
              {t("settingsNotifications.badge.desc")}
            </CardDescription>
          </div>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={disabled} className="gap-2">
              <Save className="w-4 h-4" /> {t("common.save")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {BADGE_SECTIONS.map((section, idx) => {
          const label = t(`settingsNotifications.badge.${section.key}Label`);
          return (
          <div key={section.key}>
            {idx > 0 && <Separator className="mb-4" />}
            <div className="flex items-center justify-between">
              <div>
                <Label>{label}</Label>
                <p className="text-xs text-muted-foreground">{t(`settingsNotifications.badge.${section.key}Desc`)}</p>
              </div>
              <Switch
                disabled={disabled}
                checked={draft[section.key] === true}
                onCheckedChange={(v) => update(section.key, v)}
                aria-label={t("settingsNotifications.badge.muteAria", { label })}
              />
            </div>
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
