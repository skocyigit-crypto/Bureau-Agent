import { useState, useEffect } from "react";
import { PhoneIncoming, Link2, Copy, Check, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useSimulateCall } from "@/components/layout";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";

const TELEPHONY_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/telephony`;
type FraudAction = "off" | "voicemail" | "reject";

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Intelligence IA pour les appels</CardTitle>
          <CardDescription>Fonctionnalites IA appliquees aux appels.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Analyse de sentiment en temps reel</Label>
              <p className="text-xs text-muted-foreground">L'IA analyse le ton de la conversation</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Suggestions contextuelles pendant l'appel</Label>
              <p className="text-xs text-muted-foreground">Afficher des suggestions basees sur l'historique du contact</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Resume automatique post-appel</Label>
              <p className="text-xs text-muted-foreground">Generer un resume IA apres chaque appel</p>
            </div>
            <Switch defaultChecked />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Detection des rappels necessaires</Label>
              <p className="text-xs text-muted-foreground">L'IA detecte si un rappel est necessaire et cree la tache</p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

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
