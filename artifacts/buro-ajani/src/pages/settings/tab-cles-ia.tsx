import { useState, useEffect, useCallback } from "react";
import { BrainCircuit, Plus, Trash2, Star, CheckCircle2, ShieldCheck, Power, PowerOff, Loader2, ExternalLink, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { confirmAction } from "@/hooks/use-confirm";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AiProviderInfo {
  name: string;
  displayName: string;
  website: string;
  configFields: { key: string; label: string; required: boolean; secret: boolean }[];
  pricing: { description: string };
}

interface ConfiguredAiProvider {
  id: number;
  provider: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  config: Record<string, string>;
  createdAt: string;
}

export function TabClesIa() {
  const { toast } = useToast();

  const [available, setAvailable] = useState<AiProviderInfo[]>([]);
  const [configured, setConfigured] = useState<ConfiguredAiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selected, setSelected] = useState<AiProviderInfo | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configLabel, setConfigLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [availRes, confRes] = await Promise.all([
        fetch(`${API}/api/ai-providers/available`, { credentials: "include" }),
        fetch(`${API}/api/ai-providers`, { credentials: "include" }),
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
      toast({ title: "Erreur de chargement", description: "Impossible de charger les clés IA.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selected, toast]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      const res = await fetch(`${API}/api/ai-providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider: selected.name, label: configLabel || selected.displayName, config: configValues }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Clé IA enregistrée", description: `${selected.displayName} sera désormais utilisé pour les appels IA de votre organisation.` });
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
    const res = await fetch(`${API}/api/ai-providers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ isDefault: true }),
    });
    if (res.ok) { toast({ title: "Fournisseur IA par défaut mis à jour" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const toggleActive = async (p: ConfiguredAiProvider) => {
    const res = await fetch(`${API}/api/ai-providers/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    if (res.ok) { toast({ title: p.isActive ? "Fournisseur désactivé" : "Fournisseur activé" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const remove = async (id: number) => {
    const ok = await confirmAction({
      title: "Supprimer cette clé IA ?",
      description: "Les appels IA repasseront par les clés de la plateforme.",
    });
    if (!ok) return;
    const res = await fetch(`${API}/api/ai-providers/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Clé IA supprimée" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const runTest = async (id: number) => {
    setTestingId(id);
    try {
      const res = await fetch(`${API}/api/ai-providers/${id}/test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        toast({ title: "Clé valide", description: data.message || "Le fournisseur IA répond correctement." });
      } else {
        toast({ title: "Échec du test", description: data.error || "La clé n'a pas pu être vérifiée.", variant: "destructive" });
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
        <AlertTitle>Vos propres clés d'intelligence artificielle</AlertTitle>
        <AlertDescription className="text-sm text-muted-foreground">
          Par défaut, Ajant Bureau utilise les clés IA de la plateforme (Gemini, OpenAI, Anthropic)
          pour l'assistant, le standard téléphonique et l'analyse de documents. En connectant
          <strong> vos propres clés</strong>, les appels IA de votre organisation passent par
          <strong> votre compte fournisseur</strong> et la consommation vous est facturée directement.
          Si votre clé échoue, la plateforme prend le relais automatiquement pour ne jamais bloquer
          une réponse. Chaque clé est <strong>chiffrée</strong> et jamais affichée en clair.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><BrainCircuit className="w-5 h-5" /> Clés IA</CardTitle>
            <CardDescription>Connectez et gérez vos clés Gemini, OpenAI et Anthropic.</CardDescription>
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
                  Aucune clé configurée. Vos appels IA passent actuellement par la plateforme.
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
                  </div>
                  <div className="flex items-end gap-2 flex-wrap">
                    <Button variant="secondary" onClick={() => runTest(p.id)} disabled={testingId === p.id} className="gap-2">
                      {testingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      Tester la clé
                    </Button>
                  </div>
                </div>
              ))}

              {showAddForm && (
                <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">Nouvelle clé IA</h4>
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
