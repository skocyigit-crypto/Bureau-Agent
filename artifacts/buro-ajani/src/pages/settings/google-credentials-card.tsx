/**
 * Identifiants OAuth Google de l'organisation.
 *
 * Jusqu'ici, seule la plateforme pouvait brancher Google (variables
 * d'environnement partagees): la table existait, le serveur savait lire et
 * dechiffrer ces identifiants, mais rien ne permettait de les y ecrire. Chaque
 * client peut desormais deposer sa propre application OAuth — ses e-mails, son
 * agenda et son Drive passent alors par SON application, pas par la notre.
 *
 * Le secret n'est jamais relu: une fois enregistre, l'ecran n'affiche que sa
 * presence.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

interface Status {
  configured: boolean;
  clientIdMasked: string | null;
  redirectUri: string;
  usesPlatformFallback: boolean;
  updatedAt: string | null;
}

export function GoogleCredentialsCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/org-google-credentials`, { credentials: "include" });
      if (res.ok) setStatus(await res.json());
    } catch { /* section simplement absente si l'appel echoue */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/org-google-credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: t("googleCredentials.toast.saved") });
        setClientId(""); setClientSecret("");
        await load();
      } else {
        toast({ title: t("googleCredentials.toast.saveFailed"), description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: t("googleCredentials.toast.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirmAction({
      title: t("googleCredentials.confirmDelete.title"),
      description: t("googleCredentials.confirmDelete.description"),
      confirmLabel: t("googleCredentials.confirmDelete.confirm"),
      destructive: true,
    }))) return;
    const res = await fetch(`${BASE}/api/org-google-credentials`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: t("googleCredentials.toast.deleted") }); await load(); }
    else toast({ title: t("googleCredentials.toast.deleteFailed"), variant: "destructive" });
  };

  const copyRedirect = async () => {
    if (!status?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* presse-papiers indisponible: l'URI reste lisible a l'ecran */ }
  };

  if (!status) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-blue-600" />
          {t("googleCredentials.title")}
        </CardTitle>
        <CardDescription>{t("googleCredentials.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
          <p className="text-xs font-medium">{t("googleCredentials.redirectLabel")}</p>
          <div className="flex items-center gap-2">
            <code className="text-xs break-all flex-1">{status.redirectUri}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copyRedirect} aria-label={t("googleCredentials.copy")}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("googleCredentials.redirectHelp")}</p>
        </div>

        {status.configured ? (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{t("googleCredentials.configured")}</p>
              <p className="text-xs text-muted-foreground">{status.clientIdMasked}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={remove} aria-label={t("googleCredentials.delete")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {status.usesPlatformFallback
              ? t("googleCredentials.usingPlatform")
              : t("googleCredentials.notConfigured")}
          </p>
        )}

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("googleCredentials.clientId")}</Label>
            <Input aria-label={t("googleCredentials.clientId")}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789-xxxx.apps.googleusercontent.com"
              autoComplete="off"
            />
          </div>
          <div>
            <Label className="text-xs">{t("googleCredentials.clientSecret")}</Label>
            <Input aria-label={t("googleCredentials.clientSecret")}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="GOCSPX-…"
              autoComplete="new-password"
            />
          </div>
          <Button size="sm" onClick={save} disabled={saving || !clientId.trim() || !clientSecret.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {status.configured ? t("googleCredentials.replace") : t("googleCredentials.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
