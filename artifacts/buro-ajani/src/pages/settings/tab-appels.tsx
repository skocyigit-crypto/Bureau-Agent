import { useState, useEffect } from "react";
import { PhoneIncoming, Link2, Copy, Check, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useSimulateCall } from "@/components/layout";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";

const TELEPHONY_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/telephony`;
type FraudAction = "off" | "voicemail" | "reject";

const REC_VOICES: Record<string, { label: string; value: string }[]> = {
  fr: [{ label: "Léa (défaut)", value: "" }, { label: "Céline", value: "Polly.Celine" }, { label: "Mathieu", value: "Polly.Mathieu" }],
  tr: [{ label: "Filiz (défaut)", value: "" }],
  en: [{ label: "Joanna (défaut)", value: "" }, { label: "Matthew", value: "Polly.Matthew" }, { label: "Amy", value: "Polly.Amy" }],
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
      if (res.ok) toast({ title: "Réglages enregistrés" });
      else toast({ title: "Erreur", description: d.error, variant: "destructive" });
    } catch { toast({ title: "Erreur", description: "Enregistrement échoué.", variant: "destructive" }); }
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
        <CardTitle className="text-base">Secrétaire IA — comportement</CardTitle>
        <CardDescription>Réglages réels appliqués aux appels entrants pris par la secrétaire.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!cfg.configured && (
          <p className="text-xs text-amber-600">Aucun fournisseur Twilio configuré : les réglages seront actifs une fois Twilio connecté.</p>
        )}
        {toggle("enabled", "Secrétaire IA activée", "Prend les appels entrants automatiquement")}
        <Separator />
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Langue</Label>
            <Select value={cfg.language || "fr"} onValueChange={(v) => set({ language: v, voice: "" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="fr">Français</SelectItem><SelectItem value="tr">Türkçe</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Voix</Label>
            <Select value={cfg.voice || ""} onValueChange={(v) => set({ voice: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{voices.map((v) => <SelectItem key={v.value || "default"} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label className="text-xs">Nom de l'entreprise (annoncé)</Label><Input value={cfg.orgName || ""} onChange={(e) => set({ orgName: e.target.value })} placeholder="Ex : Cabinet Dupont" /></div>
        <div><Label className="text-xs">Message d'accueil</Label><Textarea rows={2} value={cfg.greeting || ""} onChange={(e) => set({ greeting: e.target.value })} placeholder="Bonjour, vous êtes bien chez…" /></div>
        {toggle("autoDetectLanguage", "Détection automatique de la langue", "Bascule sur la langue de l'appelant dès le 1er tour")}
        <Separator />
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Transférer vers (n° humain)</Label><Input value={cfg.forwardToNumber || ""} onChange={(e) => set({ forwardToNumber: e.target.value })} placeholder="+33…" /></div>
          <div><Label className="text-xs">Alerte patron (SMS urgent)</Label><Input value={cfg.ownerAlertNumber || ""} onChange={(e) => set({ ownerAlertNumber: e.target.value })} placeholder="+33…" /></div>
        </div>
        <Separator />
        {toggle("smsConfirmation", "SMS de confirmation de rendez-vous", "Envoie un SMS quand un RDV est pris", true)}
        {toggle("autoFollowupTask", "Tâche de suivi automatique", "Crée une tâche après chaque RDV pris", true)}
        {toggle("allowPhoneCancellation", "Autoriser l'annulation par téléphone", "L'appelant peut demander l'annulation d'un RDV (soumise à approbation)")}
        {toggle("autoSmsOnMissed", "SMS automatique sur appel manqué", "Envoie un SMS de rappel si l'IA n'a pas pu répondre", true)}
        {toggle("emailRecapEnabled", "E-mail de récapitulatif après appel", "Résumé de l'appel envoyé à l'équipe", true)}
        <div><Label className="text-xs">Modèle de SMS d'appel manqué</Label><Input value={cfg.autoSmsTemplate || ""} onChange={(e) => set({ autoSmsTemplate: e.target.value })} placeholder="Bonjour {name}, nous avons manqué votre appel…" /><p className="text-[10px] text-muted-foreground mt-0.5">Variables : {"{name}"} {"{time}"}</p></div>
        <Separator />
        <div>
          <Label className="text-xs">Horaires d'ouverture (hors horaires → messagerie)</Label>
          <div className="space-y-1.5 mt-1.5">
            {DAY_LABELS.map(([key, label]) => {
              const win = cfg.businessHours?.days?.[key];
              return (
                <div key={key} className="flex items-center gap-2">
                  <Switch checked={!!win} onCheckedChange={(v) => setDay(key, v)} />
                  <span className="w-8 text-xs">{label}</span>
                  {win ? (
                    <>
                      <Input type="number" min={0} max={24} value={win[0]} onChange={(e) => setDayVal(key, 0, parseInt(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                      <span className="text-xs text-muted-foreground">→</span>
                      <Input type="number" min={0} max={24} value={win[1]} onChange={(e) => setDayVal(key, 1, parseInt(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                      <span className="text-[10px] text-muted-foreground">h</span>
                    </>
                  ) : <span className="text-xs text-muted-foreground">Fermé</span>}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Aucun horaire = disponible 24h/24.</p>
        </div>
        <Button onClick={save} disabled={saving} className="w-full">{saving ? "Enregistrement…" : "Enregistrer les réglages"}</Button>
      </CardContent>
    </Card>
  );
}

function WebhookUrlRow({ label, url }: { label: string; url: string }) {
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
      <Button size="icon" variant="ghost" className="shrink-0" onClick={copy} title="Copier">
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
          ? "Configurez d'abord un fournisseur Twilio."
          : "Enregistrement impossible.";
        toast({ title: "Erreur", description: msg, variant: "destructive" });
        return;
      }
      toast({ title: "Protection mise à jour", description: "Votre réglage a été enregistré." });
    } catch {
      setFraudAction(prev);
      toast({ title: "Erreur réseau", description: "Vérifiez votre connexion.", variant: "destructive" });
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
            Gestion des appels entrants
          </CardTitle>
          <CardDescription>Configurez le comportement des appels entrants.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Duree de sonnerie</Label>
              <p className="text-xs text-muted-foreground">Temps avant bascule en appel manque</p>
            </div>
            <Select value={callRingDuration} onValueChange={setCallRingDuration}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 secondes</SelectItem>
                <SelectItem value="30">30 secondes</SelectItem>
                <SelectItem value="45">45 secondes</SelectItem>
                <SelectItem value="60">60 secondes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Son de sonnerie</Label>
              <p className="text-xs text-muted-foreground">Jouer un son lors d'un appel entrant</p>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Identification automatique</Label>
              <p className="text-xs text-muted-foreground">Rechercher le contact correspondant au numero</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Enregistrement automatique</Label>
              <p className="text-xs text-muted-foreground">Enregistrer automatiquement chaque appel dans l'historique</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                Protection contre les appels frauduleux
              </Label>
              <p className="text-xs text-muted-foreground">
                Filtre les appels à risque (liste de blocage + réputation Twilio). Vos numéros de
                confiance (liste d'autorisation) ne sont jamais filtrés.
              </p>
              {!fraudConfigured && (
                <p className="text-xs text-amber-600 mt-1">Configurez un fournisseur Twilio pour activer ce réglage.</p>
              )}
            </div>
            <Select value={fraudAction} onValueChange={(v) => saveFraudAction(v as FraudAction)} disabled={fraudSaving || !fraudConfigured}>
              <SelectTrigger className="w-44 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Désactivée</SelectItem>
                <SelectItem value="voicemail">Vers messagerie</SelectItem>
                <SelectItem value="reject">Rejeter l'appel</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isSuperAdmin && (
            <>
              <Separator />
              <div>
                <Label className="mb-2 block">Tester l'experience d'appel <Badge variant="outline" className="ml-2 text-[10px]">Super admin</Badge></Label>
                <p className="text-xs text-muted-foreground mb-3">Simulez un appel entrant pour tester l'interface (visible uniquement par le super-administrateur).</p>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => simulateIncomingCall()} className="gap-2">
                    <PhoneIncoming className="w-4 h-4" />
                    Simuler un appel
                  </Button>
                  <Input placeholder="+33 1 XX XX XX XX" className="w-48" id="custom-phone" />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const input = document.getElementById("custom-phone") as HTMLInputElement;
                      if (input?.value) simulateIncomingCall(input.value);
                    }}
                  >
                    Appeler ce numero
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
            Configuration Twilio — Receptionniste IA
            <Badge variant="secondary" className="ml-auto text-xs">Webhooks</Badge>
          </CardTitle>
          <CardDescription>
            Copiez ces URLs dans votre console Twilio pour activer la receptionniste IA sur vos appels entrants.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WebhookUrlRow
            label="Voice URL (A Call Comes In → Webhook → HTTP POST)"
            url={`${baseUrl}/voice/twilio/incoming`}
          />
          <Separator />
          <WebhookUrlRow
            label="Status Callback URL (Call Status Changes)"
            url={`${baseUrl}/voice/twilio/status`}
          />
          <Separator />
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-semibold">Comment configurer :</p>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Connectez-vous a <strong>console.twilio.com</strong></li>
              <li>Allez dans <strong>Phone Numbers → Manage → Active Numbers</strong></li>
              <li>Cliquez sur votre numero</li>
              <li>Dans la section <strong>Voice Configuration</strong>, collez l'URL Voice ci-dessus</li>
              <li>Definissez la methode sur <strong>HTTP POST</strong></li>
              <li>Enregistrez. L'IA repondra automatiquement aux appels entrants.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
