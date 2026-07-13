import { useState, useEffect, useCallback } from "react";
import { Mail, Plus, Trash2, Star, Send, CheckCircle2, ShieldCheck, Power, PowerOff, Loader2, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceUser } from "@/components/workspace-user";
import { confirmAction } from "@/hooks/use-confirm";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface EmailProviderInfo {
  name: string;
  displayName: string;
  website: string;
  configFields: { key: string; label: string; required: boolean; secret: boolean }[];
  pricing: { description: string };
}

interface ConfiguredEmailProvider {
  id: number;
  provider: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  config: Record<string, string>;
  createdAt: string;
}

export function TabEmailExpediteur() {
  const { toast } = useToast();
  const { user } = useWorkspaceUser();

  const [available, setAvailable] = useState<EmailProviderInfo[]>([]);
  const [configured, setConfigured] = useState<ConfiguredEmailProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selected, setSelected] = useState<EmailProviderInfo | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configLabel, setConfigLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testingId, setTestingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [availRes, confRes] = await Promise.all([
        fetch(`${API}/api/email/providers/available`, { credentials: "include" }),
        fetch(`${API}/api/email/providers`, { credentials: "include" }),
      ]);
      if (availRes.ok) {
        const d = await availRes.json();
        setAvailable(d.providers ?? []);
        if (!selected && d.providers?.length) setSelected(d.providers[0]);
      }
      if (confRes.ok) {
        const d = await confRes.json();
        setConfigured(d.providers ?? []);
      }
    } catch {
      toast({ title: "Erreur de chargement", description: "Impossible de charger la configuration email.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selected, toast]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user?.email && !testEmail) setTestEmail(user.email); }, [user, testEmail]);

  const resetForm = () => {
    setShowAddForm(false);
    setConfigValues({});
    setConfigLabel("");
  };

  const handleCreate = async () => {
    if (!selected) return;
    for (const f of selected.configFields) {
      if (f.required && !configValues[f.key]?.trim()) {
        toast({ title: "Champ requis", description: f.label, variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/email/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: selected.name, label: configLabel || selected.displayName, config: configValues }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Fournisseur configuré", description: `${selected.displayName} est prêt à envoyer vos emails.` });
        resetForm();
        load();
      } else {
        toast({ title: "Échec", description: data.error || "Configuration impossible.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id: number) => {
    const res = await fetch(`${API}/api/email/providers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ isDefault: true }),
    });
    if (res.ok) { toast({ title: "Fournisseur par défaut mis à jour" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const toggleActive = async (p: ConfiguredEmailProvider) => {
    const res = await fetch(`${API}/api/email/providers/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    if (res.ok) { toast({ title: p.isActive ? "Fournisseur désactivé" : "Fournisseur activé" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const remove = async (id: number) => {
    const ok = await confirmAction({
      title: "Supprimer ce fournisseur ?",
      description: "Vos emails repasseront par le service d'envoi de la plateforme.",
    });
    if (!ok) return;
    const res = await fetch(`${API}/api/email/providers/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Fournisseur supprimé" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const sendTest = async (id: number) => {
    const to = testEmail.trim();
    if (!to || !to.includes("@")) {
      toast({ title: "Adresse de test invalide", description: "Saisissez une adresse email valide.", variant: "destructive" });
      return;
    }
    setTestingId(id);
    try {
      const res = await fetch(`${API}/api/email/providers/${id}/test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        toast({ title: "Email de test envoyé", description: `Vérifiez la boîte de réception de ${to} (expéditeur : ${data.from || "—"}).` });
      } else {
        toast({ title: "Échec du test", description: data.error || "L'envoi de test a échoué.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Alert className="border-indigo-200 bg-indigo-50">
        <ShieldCheck className="h-4 w-4 text-indigo-600" />
        <AlertTitle>Votre propre service d'envoi d'emails</AlertTitle>
        <AlertDescription className="text-sm text-muted-foreground">
          Par défaut, Agent de Bureau envoie vos emails (factures, rappels, messages de l'assistant)
          via le service d'envoi de la plateforme. En connectant <strong>votre propre clé Resend</strong>,
          vos emails partent depuis <strong>votre domaine</strong> et les coûts d'envoi vous sont
          directement facturés par Resend. Si votre clé échoue, la plateforme prend le relais
          automatiquement pour ne jamais bloquer un envoi. La clé est <strong>chiffrée</strong> et
          jamais affichée en clair.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" /> Fournisseurs d'email</CardTitle>
            <CardDescription>Connectez et gérez votre clé d'envoi d'emails.</CardDescription>
          </div>
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Ajouter
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>
          ) : (
            <>
              {configured.length === 0 && !showAddForm && (
                <p className="text-sm text-muted-foreground">
                  Aucun fournisseur configuré. Vos emails partent actuellement via la plateforme.
                </p>
              )}

              {configured.map((p) => (
                <div key={p.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.label}</span>
                      <Badge variant="outline">{p.provider}</Badge>
                      {p.isDefault && <Badge className="gap-1"><Star className="w-3 h-3" /> Par défaut</Badge>}
                      {p.isActive
                        ? <Badge variant="secondary" className="gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Actif</Badge>
                        : <Badge variant="secondary">Inactif</Badge>}
                    </div>
                    <div className="flex items-center gap-1">
                      {!p.isDefault && (
                        <Button variant="outline" size="sm" onClick={() => setDefault(p.id)} className="gap-1" title="Définir par défaut">
                          <Star className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => toggleActive(p)} title={p.isActive ? "Désactiver" : "Activer"}>
                        {p.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => remove(p.id)} className="text-destructive" title="Supprimer">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {p.config.apiKey && <div>Clé API : <code className="font-mono">{p.config.apiKey}</code></div>}
                    {p.config.fromEmail && <div>Expéditeur : <code className="font-mono">{p.config.fromEmail}</code></div>}
                  </div>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <Label className="text-xs">Adresse de test</Label>
                      <Input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="vous@exemple.fr" />
                    </div>
                    <Button variant="secondary" onClick={() => sendTest(p.id)} disabled={testingId === p.id} className="gap-2">
                      {testingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Envoyer un test
                    </Button>
                  </div>
                </div>
              ))}

              {showAddForm && (
                <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">Nouveau fournisseur</h4>
                    <Button variant="ghost" size="sm" onClick={resetForm}>Annuler</Button>
                  </div>

                  {available.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {available.map((a) => (
                        <Button key={a.name} variant={selected?.name === a.name ? "default" : "outline"} size="sm" onClick={() => setSelected(a)}>
                          {a.displayName}
                        </Button>
                      ))}
                    </div>
                  )}

                  {selected && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {selected.pricing.description}{" "}
                        <a href={selected.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                          {selected.displayName} <ExternalLink className="w-3 h-3" />
                        </a>
                      </p>
                      <div>
                        <Label className="text-xs">Nom (libellé interne)</Label>
                        <Input value={configLabel} onChange={(e) => setConfigLabel(e.target.value)} placeholder={selected.displayName} />
                      </div>
                      {selected.configFields.map((f) => (
                        <div key={f.key}>
                          <Label className="text-xs">{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                          <Input
                            type={f.secret ? "password" : "text"}
                            value={configValues[f.key] ?? ""}
                            onChange={(e) => setConfigValues((v) => ({ ...v, [f.key]: e.target.value }))}
                            placeholder={f.secret ? "••••••••" : ""}
                            autoComplete="off"
                          />
                        </div>
                      ))}
                      <Button onClick={handleCreate} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Enregistrer
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
