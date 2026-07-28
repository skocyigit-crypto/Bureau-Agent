import { useState, useEffect } from "react";
import { Rocket, Plus, Trash2, Send, Sparkles, Shield, Bug, Zap, Clock, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Release {
  id: number;
  version: string;
  title: string;
  description: string | null;
  changes: string | null;
  type: string;
  forceUpdate: boolean;
  buildHash: string | null;
  publishedAt: string;
}

const typeOptions = [
  { value: "update", label: "Mise a jour", icon: Zap, color: "bg-blue-100 text-blue-700" },
  { value: "feature", label: "Nouvelle fonctionnalite", icon: Sparkles, color: "bg-purple-100 text-purple-700" },
  { value: "major", label: "Version majeure", icon: Rocket, color: "bg-indigo-100 text-indigo-700" },
  { value: "security", label: "Securite", icon: Shield, color: "bg-red-100 text-red-700" },
  { value: "fix", label: "Correction de bugs", icon: Bug, color: "bg-amber-100 text-amber-700" },
  { value: "performance", label: "Performance", icon: Zap, color: "bg-green-100 text-green-700" },
];

export function TabMisesAJour() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [buildInfo, setBuildInfo] = useState<{ buildHash: string; buildTime: string } | null>(null);

  const [form, setForm] = useState({
    version: "",
    title: "",
    description: "",
    changes: "",
    type: "update",
    forceUpdate: false,
  });

  const loadReleases = async () => {
    try {
      const [relRes, verRes] = await Promise.all([
        fetch(`${API}/api/app-releases?limit=20`, { credentials: "include" }),
        fetch(`${API}/api/app-version`, { credentials: "include" }),
      ]);
      if (relRes.ok) {
        const data = await relRes.json();
        setReleases(data.releases || []);
      }
      if (verRes.ok) {
        const ver = await verRes.json();
        setBuildInfo({ buildHash: ver.buildHash, buildTime: ver.buildTime });
      }
    } catch (err) {
      console.error("[MisesAJour] load failed:", err);
    }
    setLoading(false);
  };

  useEffect(() => { loadReleases(); }, []);

  const handleSubmit = async () => {
    if (!form.version.trim() || !form.title.trim()) {
      toast({ title: t("settingsMisesAJour.toast.error"), description: t("settingsMisesAJour.toast.versionTitleRequired"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/app-releases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ title: t("settingsMisesAJour.toast.publishedTitle"), description: t("settingsMisesAJour.toast.publishedDesc", { version: form.version }) });
        setForm({ version: "", title: "", description: "", changes: "", type: "update", forceUpdate: false });
        setShowForm(false);
        loadReleases();
      } else {
        const err = await res.json();
        toast({ title: t("settingsMisesAJour.toast.error"), description: err.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: t("settingsMisesAJour.toast.error"), description: e.message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`${API}/api/app-releases/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: t("settingsMisesAJour.toast.deletedTitle") });
        loadReleases();
      } else {
        toast({ title: t("settingsMisesAJour.toast.error"), description: t("settingsMisesAJour.toast.deleteError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsMisesAJour.toast.error"), description: t("settingsMisesAJour.toast.networkError"), variant: "destructive" });
    }
  };

  const suggestNextVersion = () => {
    if (releases.length === 0) return "1.0.0";
    const latest = releases[0].version;
    const parts = latest.split(".").map(Number);
    if (parts.length === 3) {
      parts[2]++;
      return parts.join(".");
    }
    return latest + ".1";
  };

  if (loading) {
    return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Rocket className="h-5 w-5 text-indigo-500" />
            {t("settingsMisesAJour.heading")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("settingsMisesAJour.subtitle")}
          </p>
          {buildInfo && (
            <p className="text-xs text-muted-foreground mt-1">
              {t("settingsMisesAJour.currentBuildLabel")}<code className="bg-muted px-1 rounded">{buildInfo.buildHash}</code> — {new Date(buildInfo.buildTime).toLocaleString("fr-FR")}
            </p>
          )}
        </div>
        <Button onClick={() => { setShowForm(!showForm); if (!showForm) setForm(f => ({ ...f, version: suggestNextVersion() })); }} variant={showForm ? "outline" : "default"} className="gap-2">
          {showForm ? t("common.cancel") : <><Plus className="h-4 w-4" /> {t("settingsMisesAJour.publishBtn")}</>}
        </Button>
      </div>

      {showForm && (
        <Card className="border-indigo-200 bg-indigo-50/30 dark:bg-indigo-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4 text-indigo-500" />
              {t("settingsMisesAJour.newUpdate")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">{t("settingsMisesAJour.versionLabel")}</label>
                <Input
                  value={form.version}
                  onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  placeholder={t("settingsMisesAJour.versionPlaceholder")}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">{t("settingsMisesAJour.typeLabel")}</label>
                <div className="flex flex-wrap gap-2">
                  {typeOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm(f => ({ ...f, type: opt.value }))}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${form.type === opt.value ? opt.color + " ring-2 ring-offset-1 ring-current" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    >
                      <opt.icon className="h-3 w-3" />
                      {t(`settingsMisesAJour.types.${opt.value}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">{t("settingsMisesAJour.titleLabel")}</label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={t("settingsMisesAJour.titlePlaceholder")}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">{t("settingsMisesAJour.descLabel")}</label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t("settingsMisesAJour.descPlaceholder")}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("settingsMisesAJour.changesLabel")}
              </label>
              <Textarea
                value={form.changes}
                onChange={e => setForm(f => ({ ...f, changes: e.target.value }))}
                placeholder={t("settingsMisesAJour.changesPlaceholder")}
                rows={5}
              />
            </div>

            <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <div className="flex-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.forceUpdate}
                    onChange={e => setForm(f => ({ ...f, forceUpdate: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">{t("settingsMisesAJour.forceLabel")}</span>
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("settingsMisesAJour.forceHint")}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !form.version.trim() || !form.title.trim()}
                className="gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
              >
                {submitting ? t("settingsMisesAJour.publishing") : <><Send className="h-4 w-4" /> {t("settingsMisesAJour.publishSubmit")}</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {t("settingsMisesAJour.historyTitle", { count: releases.length })}
        </h4>

        {releases.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Rocket className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{t("settingsMisesAJour.emptyLine1")}</p>
              <p className="text-sm mt-1">{t("settingsMisesAJour.emptyLine2")}</p>
            </CardContent>
          </Card>
        ) : (
          releases.map(release => {
            const typeOpt = typeOptions.find(t => t.value === release.type) || typeOptions[0];
            const TypeIcon = typeOpt.icon;
            const changesList = release.changes ? release.changes.split("\n").filter(l => l.trim()) : [];

            return (
              <Card key={release.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`rounded-full p-2 ${typeOpt.color}`}>
                        <TypeIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold">v{release.version}</span>
                          <Badge variant="secondary" className="text-xs">{t(`settingsMisesAJour.types.${typeOpt.value}`)}</Badge>
                          {release.forceUpdate && (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <AlertTriangle className="h-3 w-3" /> {t("settingsMisesAJour.forceBadge")}
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-semibold mt-0.5">{release.title}</h4>
                        {release.description && (
                          <p className="text-sm text-muted-foreground mt-0.5">{release.description}</p>
                        )}
                        {changesList.length > 0 && (
                          <ul className="mt-2 space-y-0.5">
                            {changesList.map((c, i) => (
                              <li key={i} className="text-sm flex items-start gap-1.5">
                                <span className="text-green-500 mt-0.5">+</span>
                                <span>{c.replace(/^[-*•]\s*/, "")}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {new Date(release.publishedAt).toLocaleString("fr-FR")}
                          {release.buildHash && (
                            <span className="text-xs">| {t("settingsMisesAJour.buildInline")} <code className="bg-muted px-1 rounded">{release.buildHash}</code></span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(release.id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
