import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaceUser } from "@/components/workspace-user";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { CheckCircle2,ExternalLink,Loader2,Mail,Plus,Power,PowerOff,Send,ShieldCheck,Star,Trash2 } from "lucide-react";
import { useCallback,useEffect,useState } from "react";

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
  const { t } = useTranslation();

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
      toast({ title: t("settingsEmailExpediteur.toast.loadErrorTitle"), description: t("settingsEmailExpediteur.toast.loadErrorDesc"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [selected, toast, t]);

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
        toast({ title: t("settingsEmailExpediteur.toast.fieldRequired"), description: f.label, variant: "destructive" });
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
        toast({ title: t("settingsEmailExpediteur.toast.configuredTitle"), description: t("settingsEmailExpediteur.toast.configuredDesc", { provider: selected.displayName }) });
        resetForm();
        load();
      } else {
        toast({ title: t("settingsEmailExpediteur.toast.failTitle"), description: data.error || t("settingsEmailExpediteur.toast.configError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsEmailExpediteur.toast.networkError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (id: number) => {
    const res = await fetch(`${API}/api/email/providers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ isDefault: true }),
    });
    if (res.ok) { toast({ title: t("settingsEmailExpediteur.toast.defaultUpdated") }); load(); }
    else toast({ title: t("settingsEmailExpediteur.toast.error"), variant: "destructive" });
  };

  const toggleActive = async (p: ConfiguredEmailProvider) => {
    const res = await fetch(`${API}/api/email/providers/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    if (res.ok) { toast({ title: p.isActive ? t("settingsEmailExpediteur.toast.deactivated") : t("settingsEmailExpediteur.toast.activated") }); load(); }
    else toast({ title: t("settingsEmailExpediteur.toast.error"), variant: "destructive" });
  };

  const remove = async (id: number) => {
    const ok = await confirmAction({
      title: t("settingsEmailExpediteur.confirm.deleteTitle"),
      description: t("settingsEmailExpediteur.confirm.deleteDesc"),
    });
    if (!ok) return;
    const res = await fetch(`${API}/api/email/providers/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: t("settingsEmailExpediteur.toast.deleted") }); load(); }
    else toast({ title: t("settingsEmailExpediteur.toast.error"), variant: "destructive" });
  };

  const sendTest = async (id: number) => {
    const to = testEmail.trim();
    if (!to || !to.includes("@")) {
      toast({ title: t("settingsEmailExpediteur.toast.testInvalidTitle"), description: t("settingsEmailExpediteur.toast.testInvalidDesc"), variant: "destructive" });
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
        toast({ title: t("settingsEmailExpediteur.toast.testSentTitle"), description: t("settingsEmailExpediteur.toast.testSentDesc", { to, from: data.from || "—" }) });
      } else {
        toast({ title: t("settingsEmailExpediteur.toast.testFailTitle"), description: data.error || t("settingsEmailExpediteur.toast.testFailDesc"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsEmailExpediteur.toast.networkError"), variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Alert className="border-indigo-200 bg-indigo-50">
        <ShieldCheck className="h-4 w-4 text-indigo-600" />
        <AlertTitle>{t("settingsEmailExpediteur.alertTitle")}</AlertTitle>
        <AlertDescription className="text-sm text-muted-foreground">
          {t("settingsEmailExpediteur.alertBody1")}
          <strong>{t("settingsEmailExpediteur.alertStrongResendKey")}</strong>{t("settingsEmailExpediteur.alertBody2")}
          <strong>{t("settingsEmailExpediteur.alertStrongDomain")}</strong>{t("settingsEmailExpediteur.alertBody3")}
          <strong>{t("settingsEmailExpediteur.alertStrongEncrypted")}</strong>{t("settingsEmailExpediteur.alertBody4")}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" /> {t("settingsEmailExpediteur.cardTitle")}</CardTitle>
            <CardDescription>{t("settingsEmailExpediteur.cardDescription")}</CardDescription>
          </div>
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} className="gap-2">
              <Plus className="w-4 h-4" /> {t("common.add")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading")}</div>
          ) : (
            <>
              {configured.length === 0 && !showAddForm && (
                <p className="text-sm text-muted-foreground">
                  {t("settingsEmailExpediteur.noneConfigured")}
                </p>
              )}

              {configured.map((p) => (
                <div key={p.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.label}</span>
                      <Badge variant="outline">{p.provider}</Badge>
                      {p.isDefault && <Badge className="gap-1"><Star className="w-3 h-3" /> {t("settingsEmailExpediteur.defaultBadge")}</Badge>}
                      {p.isActive
                        ? <Badge variant="secondary" className="gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> {t("settingsEmailExpediteur.active")}</Badge>
                        : <Badge variant="secondary">{t("settingsEmailExpediteur.inactive")}</Badge>}
                    </div>
                    <div className="flex items-center gap-1">
                      {!p.isDefault && (
                        <Button variant="outline" size="sm" onClick={() => setDefault(p.id)} className="gap-1" title={t("settingsEmailExpediteur.setDefaultTitle")}>
                          <Star className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => toggleActive(p)} title={p.isActive ? t("settingsEmailExpediteur.deactivateTitle") : t("settingsEmailExpediteur.activateTitle")}>
                        {p.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => remove(p.id)} className="text-destructive" title={t("common.delete")}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {p.config.apiKey && <div>{t("settingsEmailExpediteur.apiKeyLabel")}<code className="font-mono">{p.config.apiKey}</code></div>}
                    {p.config.fromEmail && <div>{t("settingsEmailExpediteur.fromLabel")}<code className="font-mono">{p.config.fromEmail}</code></div>}
                  </div>
                  <div className="flex items-end gap-2 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <Label className="text-xs">{t("settingsEmailExpediteur.testAddressLabel")}</Label>
                      <Input aria-label={t("settingsEmailExpediteur.testAddressLabel")} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder={t("settingsEmailExpediteur.testPlaceholder")} />
                    </div>
                    <Button variant="secondary" onClick={() => sendTest(p.id)} disabled={testingId === p.id} className="gap-2">
                      {testingId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {t("settingsEmailExpediteur.sendTest")}
                    </Button>
                  </div>
                </div>
              ))}

              {showAddForm && (
                <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">{t("settingsEmailExpediteur.newProvider")}</h4>
                    <Button variant="ghost" size="sm" onClick={resetForm}>{t("common.cancel")}</Button>
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
                        <Label className="text-xs">{t("settingsEmailExpediteur.nameLabel")}</Label>
                        <Input aria-label={t("settingsEmailExpediteur.nameLabel")} value={configLabel} onChange={(e) => setConfigLabel(e.target.value)} placeholder={selected.displayName} />
                      </div>
                      {selected.configFields.map((f) => (
                        <div key={f.key}>
                          <Label className="text-xs">{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                          <Input
                            aria-label={f.label}
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
                        {t("common.save")}
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
