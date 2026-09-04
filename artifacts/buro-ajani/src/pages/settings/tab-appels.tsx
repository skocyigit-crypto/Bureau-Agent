import { useSimulateCall } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { Check,Copy,Link2,PhoneIncoming,ShieldAlert } from "lucide-react";
import { useEffect,useState } from "react";

const TELEPHONY_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/telephony`;
type FraudAction = "off" | "voicemail" | "reject";

const REC_VOICES: Record<string, { label: string; value: string }[]> = {
  fr: [{ label: "Léa", value: "" }, { label: "Céline", value: "Polly.Celine" }, { label: "Mathieu", value: "Polly.Mathieu" }],
  tr: [{ label: "Filiz", value: "" }],
  en: [{ label: "Joanna", value: "" }, { label: "Matthew", value: "Polly.Matthew" }, { label: "Amy", value: "Polly.Amy" }],
};
const DAY_LABELS: [string, string][] = [
  ["mon", "Lun"], ["tue", "Mar"], ["wed", "Mer"], ["thu", "Jeu"], ["fri", "Ven"], ["sat", "Sam"], ["sun", "Dim"],
];

/**
 * Reglages REELS de la secretaire IA. Remplace l'ancienne carte "Intelligence
 * IA" dont les 4 interrupteurs (`defaultChecked`, sans etat) ne pilotaient
 * rien: le back-end lisait deja transfert, horaires, voix, SMS, alerte patron,
 * mais aucun endpoint ne les enregistrait ni ne les affichait.
 */
function AiReceptionistSettings() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Record<string, any>) => setCfg((c) => ({ ...(c ?? {}), ...patch }));

  useEffect(() => {
    fetch(`${TELEPHONY_API}/ai-receptionist`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setCfg(d); })
      .catch(() => {});
  }, []);

  const setDay = (day: string, on: boolean, open = 9, close = 18) => {
    const days = { ...((cfg?.businessHours?.days) ?? {}) };
    if (on) days[day] = [open, close]; else delete days[day];
    set({ businessHours: { ...(cfg?.businessHours ?? {}), days } });
  };
  const setDayVal = (day: string, idx: 0 | 1, val: number) => {
    const cur = cfg?.businessHours?.days?.[day] ?? [9, 18];
    const next = [...cur] as [number, number]; next[idx] = val;
    set({ businessHours: { ...(cfg?.businessHours ?? {}), days: { ...(cfg?.businessHours?.days ?? {}), [day]: next } } });
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const res = await fetch(`${TELEPHONY_API}/ai-receptionist`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !!cfg.enabled, language: cfg.language || "fr", greeting: cfg.greeting || "", orgName: cfg.orgName || "",
          voice: cfg.voice || "", autoDetectLanguage: !!cfg.autoDetectLanguage,
          forwardToNumber: cfg.forwardToNumber || "", ownerAlertNumber: cfg.ownerAlertNumber || "",
          allowPhoneCancellation: !!cfg.allowPhoneCancellation, smsConfirmation: cfg.smsConfirmation !== false,
          autoFollowupTask: cfg.autoFollowupTask !== false, autoSmsOnMissed: cfg.autoSmsOnMissed !== false,
          autoSmsTemplate: cfg.autoSmsTemplate || "", emailRecapEnabled: cfg.emailRecapEnabled !== false,
          businessHours: cfg.businessHours ?? null,
        }),
      });
      const d = await res.json();
      if (res.ok) toast({ title: t("settingsAppels.recept.saved") });
      else toast({ title: t("settingsAppels.recept.error"), description: d.error, variant: "destructive" });
    } catch { toast({ title: t("settingsAppels.recept.error"), description: t("settingsAppels.recept.saveFailed"), variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (!cfg) return null;
  const voices = REC_VOICES[cfg.language as string] ?? REC_VOICES.fr;
  const toggle = (key: string, label: string, desc: string, def = false) => (
    <div className="flex items-center justify-between">
      <div><Label>{label}</Label><p className="text-xs text-muted-foreground">{desc}</p></div>
      <Switch checked={cfg[key] !== undefined ? !!cfg[key] : def} onCheckedChange={(v) => set({ [key]: v })} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("settingsAppels.recept.title")}</CardTitle>
        <CardDescription>{t("settingsAppels.recept.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!cfg.configured && (
          <p className="text-xs text-amber-600">{t("settingsAppels.recept.noTwilio")}</p>
        )}
        {toggle("enabled", t("settingsAppels.recept.enabledLabel"), t("settingsAppels.recept.enabledDesc"))}
        <Separator />
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">{t("settingsAppels.recept.language")}</Label>
            <Select value={cfg.language || "fr"} onValueChange={(v) => set({ language: v, voice: "" })}>
              <SelectTrigger aria-label={t("settingsAppels.recept.language")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="fr">Français</SelectItem><SelectItem value="tr">Türkçe</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">{t("settingsAppels.recept.voice")}</Label>
            <Select value={cfg.voice || ""} onValueChange={(v) => set({ voice: v })}>
              <SelectTrigger aria-label={t("settingsAppels.recept.voice")}><SelectValue /></SelectTrigger>
              <SelectContent>{voices.map((v) => <SelectItem key={v.value || "default"} value={v.value}>{v.label}{v.value ? "" : t("settingsAppels.voiceDefaultSuffix")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label className="text-xs">{t("settingsAppels.recept.orgName")}</Label><Input aria-label={t("settingsAppels.recept.orgName")} value={cfg.orgName || ""} onChange={(e) => set({ orgName: e.target.value })} placeholder={t("settingsAppels.recept.orgNamePlaceholder")} /></div>
        <div><Label className="text-xs">{t("settingsAppels.recept.greeting")}</Label><Textarea aria-label={t("settingsAppels.recept.greeting")} rows={2} value={cfg.greeting || ""} onChange={(e) => set({ greeting: e.target.value })} placeholder={t("settingsAppels.recept.greetingPlaceholder")} /></div>
        {toggle("autoDetectLanguage", t("settingsAppels.recept.autoDetectLabel"), t("settingsAppels.recept.autoDetectDesc"))}
        <Separator />
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">{t("settingsAppels.recept.forwardLabel")}</Label><Input aria-label={t("settingsAppels.recept.forwardLabel")} value={cfg.forwardToNumber || ""} onChange={(e) => set({ forwardToNumber: e.target.value })} placeholder="+33…" /></div>
          <div><Label className="text-xs">{t("settingsAppels.recept.ownerLabel")}</Label><Input aria-label={t("settingsAppels.recept.ownerLabel")} value={cfg.ownerAlertNumber || ""} onChange={(e) => set({ ownerAlertNumber: e.target.value })} placeholder="+33…" /></div>
        </div>
        <Separator />
        {toggle("smsConfirmation", t("settingsAppels.recept.smsConfirmLabel"), t("settingsAppels.recept.smsConfirmDesc"), true)}
        {toggle("autoFollowupTask", t("settingsAppels.recept.followupLabel"), t("settingsAppels.recept.followupDesc"), true)}
        {toggle("allowPhoneCancellation", t("settingsAppels.recept.cancelPhoneLabel"), t("settingsAppels.recept.cancelPhoneDesc"))}
        {toggle("autoSmsOnMissed", t("settingsAppels.recept.autoSmsLabel"), t("settingsAppels.recept.autoSmsDesc"), true)}
        {toggle("emailRecapEnabled", t("settingsAppels.recept.recapLabel"), t("settingsAppels.recept.recapDesc"), true)}
        <div><Label className="text-xs">{t("settingsAppels.recept.smsTemplate")}</Label><Input aria-label={t("settingsAppels.recept.smsTemplate")} value={cfg.autoSmsTemplate || ""} onChange={(e) => set({ autoSmsTemplate: e.target.value })} placeholder={t("settingsAppels.recept.smsTemplatePlaceholder")} /><p className="text-[10px] text-muted-foreground mt-0.5">{t("settingsAppels.recept.smsVariables")}</p></div>
        <Separator />
        <div>
          <Label className="text-xs">{t("settingsAppels.recept.hoursLabel")}</Label>
          <div className="space-y-1.5 mt-1.5">
            {DAY_LABELS.map(([key]) => {
              const win = cfg.businessHours?.days?.[key];
              return (
                <div key={key} className="flex items-center gap-2">
                  <Switch checked={!!win} onCheckedChange={(v) => setDay(key, v)} />
                  <span className="w-8 text-xs">{t(`settingsAppels.days.${key}`)}</span>
                  {win ? (
                    <>
                      <Input aria-label={t("common.startHour")} type="number" min={0} max={24} value={win[0]} onChange={(e) => setDayVal(key, 0, parseInt(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                      <span className="text-xs text-muted-foreground">→</span>
                      <Input aria-label={t("common.endHour")} type="number" min={0} max={24} value={win[1]} onChange={(e) => setDayVal(key, 1, parseInt(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                      <span className="text-[10px] text-muted-foreground">h</span>
                    </>
                  ) : <span className="text-xs text-muted-foreground">{t("settingsAppels.recept.closed")}</span>}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{t("settingsAppels.recept.hoursHint")}</p>
        </div>
        <Button onClick={save} disabled={saving} className="w-full">{saving ? t("settingsAppels.recept.saving") : t("settingsAppels.recept.saveBtn")}</Button>
      </CardContent>
    </Card>
  );
}

function WebhookUrlRow({ label, url }: { label: string; url: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
        <code className="text-xs bg-muted px-2 py-1 rounded block truncate">{url}</code>
      </div>
      <Button size="icon" variant="ghost" className="shrink-0" onClick={copy} title={t("settingsAppels.copy")}>
        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

export function TabAppels() {
  const [callRingDuration, setCallRingDuration] = useState("30");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const { simulateIncomingCall } = useSimulateCall();
  const { user } = useWorkspaceUser();
  const { toast } = useToast();
  const { t } = useTranslation();
  const isSuperAdmin = user.role === "super_admin";

  // F4: Protection automatique contre les appels frauduleux.
  const [fraudAction, setFraudAction] = useState<FraudAction>("off");
  const [fraudConfigured, setFraudConfigured] = useState(true);
  const [fraudSaving, setFraudSaving] = useState(false);

  useEffect(() => {
    fetch(`${TELEPHONY_API}/fraud-protection`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setFraudAction(d.action as FraudAction);
          setFraudConfigured(d.configured !== false);
        }
      })
      .catch(() => {});
  }, []);

  const saveFraudAction = async (action: FraudAction) => {
    const prev = fraudAction;
    setFraudAction(action);
    setFraudSaving(true);
    try {
      const res = await fetch(`${TELEPHONY_API}/fraud-protection`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setFraudAction(prev);
        const msg = res.status === 404
          ? t("settingsAppels.fraudToast.needTwilio")
          : t("settingsAppels.fraudToast.saveFailed");
        toast({ title: t("settingsAppels.fraudToast.error"), description: msg, variant: "destructive" });
        return;
      }
      toast({ title: t("settingsAppels.fraudToast.updated"), description: t("settingsAppels.fraudToast.updatedDesc") });
    } catch {
      setFraudAction(prev);
      toast({ title: t("settingsAppels.fraudToast.networkError"), description: t("settingsAppels.fraudToast.networkDesc"), variant: "destructive" });
    } finally {
      setFraudSaving(false);
    }
  };

  const baseUrl = `${window.location.protocol}//${window.location.host}/api`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PhoneIncoming className="w-5 h-5" />
            {t("settingsAppels.incoming.title")}
          </CardTitle>
          <CardDescription>{t("settingsAppels.incoming.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsAppels.incoming.ringLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsAppels.incoming.ringDesc")}</p>
            </div>
            <Select value={callRingDuration} onValueChange={setCallRingDuration}>
              <SelectTrigger aria-label={t("settingsAppels.incoming.ringLabel")} className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">{t("settingsAppels.incoming.seconds", { n: 15 })}</SelectItem>
                <SelectItem value="30">{t("settingsAppels.incoming.seconds", { n: 30 })}</SelectItem>
                <SelectItem value="45">{t("settingsAppels.incoming.seconds", { n: 45 })}</SelectItem>
                <SelectItem value="60">{t("settingsAppels.incoming.seconds", { n: 60 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsAppels.incoming.soundLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsAppels.incoming.soundDesc")}</p>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsAppels.incoming.autoIdLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsAppels.incoming.autoIdDesc")}</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>{t("settingsAppels.incoming.autoRecLabel")}</Label>
              <p className="text-xs text-muted-foreground">{t("settingsAppels.incoming.autoRecDesc")}</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                {t("settingsAppels.incoming.fraudLabel")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settingsAppels.incoming.fraudDesc")}
              </p>
              {!fraudConfigured && (
                <p className="text-xs text-amber-600 mt-1">{t("settingsAppels.incoming.fraudNotConfigured")}</p>
              )}
            </div>
            <Select value={fraudAction} onValueChange={(v) => saveFraudAction(v as FraudAction)} disabled={fraudSaving || !fraudConfigured}>
              <SelectTrigger className="w-44 shrink-0" aria-label={t("settingsAppels.fraudLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t("settingsAppels.incoming.fraudOff")}</SelectItem>
                <SelectItem value="voicemail">{t("settingsAppels.incoming.fraudVoicemail")}</SelectItem>
                <SelectItem value="reject">{t("settingsAppels.incoming.fraudReject")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isSuperAdmin && (
            <>
              <Separator />
              <div>
                <Label className="mb-2 block">{t("settingsAppels.incoming.testLabel")} <Badge variant="outline" className="ml-2 text-[10px]">{t("settingsAppels.incoming.testBadge")}</Badge></Label>
                <p className="text-xs text-muted-foreground mb-3">{t("settingsAppels.incoming.testDesc")}</p>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => simulateIncomingCall()} className="gap-2">
                    <PhoneIncoming className="w-4 h-4" />
                    {t("settingsAppels.incoming.simulateBtn")}
                  </Button>
                  <Input aria-label={t("settingsAppels.incoming.customPhonePlaceholder")} placeholder={t("settingsAppels.incoming.customPhonePlaceholder")} className="w-48" id="custom-phone" />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const input = document.getElementById("custom-phone") as HTMLInputElement;
                      if (input?.value) simulateIncomingCall(input.value);
                    }}
                  >
                    {t("settingsAppels.incoming.callNumberBtn")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AiReceptionistSettings />

      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-5 h-5 text-blue-500" />
            {t("settingsAppels.webhook.title")}
            <Badge variant="secondary" className="ml-auto text-xs">{t("settingsAppels.webhook.badge")}</Badge>
          </CardTitle>
          <CardDescription>
            {t("settingsAppels.webhook.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WebhookUrlRow
            label={t("settingsAppels.webhook.voiceLabel")}
            url={`${baseUrl}/voice/twilio/incoming`}
          />
          <Separator />
          <WebhookUrlRow
            label={t("settingsAppels.webhook.statusLabel")}
            url={`${baseUrl}/voice/twilio/status`}
          />
          <Separator />
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-semibold">{t("settingsAppels.webhook.howTitle")}</p>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>{t("settingsAppels.webhook.s1")} <strong>console.twilio.com</strong></li>
              <li>{t("settingsAppels.webhook.s2")} <strong>Phone Numbers → Manage → Active Numbers</strong></li>
              <li>{t("settingsAppels.webhook.s3")}</li>
              <li>{t("settingsAppels.webhook.s4a")} <strong>Voice Configuration</strong>{t("settingsAppels.webhook.s4b")}</li>
              <li>{t("settingsAppels.webhook.s5")} <strong>HTTP POST</strong></li>
              <li>{t("settingsAppels.webhook.s6")}</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
