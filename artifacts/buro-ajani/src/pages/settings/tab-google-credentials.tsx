import { useState, useEffect, useCallback } from "react";
import { KeyRound, Save, Loader2, Trash2, Copy, Check, ExternalLink, ShieldCheck, AlertCircle, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceUser } from "@/components/workspace-user";

interface CredentialsStatus {
  configured: boolean;
  clientIdPreview: string | null;
  updatedAt: string | null;
  envFallbackAvailable: boolean;
  redirectUri: string;
  canManage: boolean;
}

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function TabGoogleCredentials() {
  const { toast } = useToast();
  const { user } = useWorkspaceUser();
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<CredentialsStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    try {
      const res = await fetch(`${BASE}/api/google-oauth/app-credentials`, { credentials: "include" });
      if (res.ok) {
        setStatus(await res.json());
      } else {
        toast({ title: "Erreur", description: "Impossible de charger la configuration Google.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!isAdmin) return;
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({ title: "Champs requis", description: "Renseignez le Client ID et le Client Secret.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/google-oauth/app-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: "Identifiants enregistres",
          description: data.reconnectRequired
            ? "Les comptes Google existants ont ete deconnectes : chaque utilisateur devra se reconnecter avec la nouvelle configuration."
            : "Vos utilisateurs peuvent maintenant connecter leur compte Google.",
        });
        setClientId("");
        setClientSecret("");
        await load();
      } else {
        toast({ title: "Erreur", description: data.error || "Echec de l'enregistrement.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!isAdmin) return;
    setDeleting(true);
    try {
      const res = await fetch(`${BASE}/api/google-oauth/app-credentials`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "Identifiants supprimes", description: "La configuration Google de l'organisation a ete retiree." });
        await load();
      } else {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Erreur", description: data.error || "Echec de la suppression.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const copyRedirect = async () => {
    if (!status?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Copie impossible", description: "Copiez l'URL manuellement.", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card className="border-muted">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Identifiants Google (OAuth)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seuls les administrateurs de l'organisation peuvent configurer les identifiants Google.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Identifiants Google (OAuth)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connectez votre propre projet Google Cloud. Chaque organisation utilise ses propres identifiants.
          </p>
        </div>
        {status?.configured ? (
          <Badge variant="default" className="bg-emerald-500 text-white gap-1"><ShieldCheck className="h-3 w-3" /> Configure</Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300"><AlertCircle className="h-3 w-3" /> Non configure</Badge>
        )}
      </div>

      {!status?.configured && (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800/50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Configuration requise avant de connecter Google</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tant que les identifiants OAuth ne sont pas renseignes, vos utilisateurs ne peuvent pas
                connecter Gmail, Agenda ou Drive.
                {status?.envFallbackAvailable && " Une configuration globale de secours est disponible, mais il est recommande d'utiliser vos propres identifiants."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-blue-500" />
            URL de redirection autorisee
          </CardTitle>
          <CardDescription>
            Ajoutez cette URL dans Google Cloud Console &rarr; Identifiants &rarr; votre client OAuth &rarr;
            &laquo; URI de redirection autorises &raquo;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Input readOnly value={status?.redirectUri || ""} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={copyRedirect} title="Copier">
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            Le Client ID doit se terminer par <code className="font-mono">.apps.googleusercontent.com</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-violet-500" />
            {status?.configured ? "Mettre a jour les identifiants" : "Enregistrer les identifiants"}
          </CardTitle>
          <CardDescription>
            {status?.configured
              ? `Identifiants actuels : ${status.clientIdPreview ?? ""}${status.updatedAt ? " — mis a jour le " + new Date(status.updatedAt).toLocaleDateString("fr-FR") : ""}. Renseignez de nouvelles valeurs pour les remplacer.`
              : "Le Client Secret est chiffre avant stockage et n'est jamais reaffiche."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAdmin && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 p-3 rounded-lg border bg-muted/30">
              <AlertCircle className="h-3.5 w-3.5" />
              Seuls les administrateurs de l'organisation peuvent modifier ces identifiants.
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="googleClientId">Client ID</Label>
            <Input
              id="googleClientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={!isAdmin}
              placeholder="1234567890-abc.apps.googleusercontent.com"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="googleClientSecret">Client Secret</Label>
            <Input
              id="googleClientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={!isAdmin}
              placeholder="GOCSPX-..."
              className="font-mono text-xs"
              autoComplete="new-password"
            />
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Enregistrer
              </Button>
              {status?.configured && (
                <>
                  <Separator orientation="vertical" className="h-6" />
                  <Button onClick={remove} disabled={deleting} size="sm" variant="outline" className="text-destructive">
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    Supprimer
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
