import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, PlayCircle, PauseCircle, Clock, CheckCircle, AlertTriangle, Activity,
  BarChart3, RefreshCw, Settings2, Bot, CalendarClock, Mail, Phone, Users,
  FileText, TrendingUp, Loader2, Plus, Trash2, Bell, MessageSquare, ClipboardList, Copy, Pencil, Download, Printer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const TYPE_ICONS: Record<string, any> = {
  "Taches en retard": FileText,
  "Rappels calendrier": CalendarClock,
  "Messages non lus": Mail,
  "Contacts inactifs": Users,
  "Appels manques": Phone,
};

const TYPE_COLORS: Record<string, string> = {
  "Taches en retard": "text-red-500 bg-red-500/10",
  "Rappels calendrier": "text-blue-500 bg-blue-500/10",
  "Messages non lus": "text-purple-500 bg-purple-500/10",
  "Contacts inactifs": "text-amber-500 bg-amber-500/10",
  "Appels manques": "text-green-500 bg-green-500/10",
};

const TRIGGER_LABELS: Record<string, string> = {
  schedule: "Plannifie (recurrent)",
  missed_call: "Appel manque",
  contact_no_activity: "Contact inactif",
  task_overdue: "Tache en retard",
};

const ACTION_LABELS: Record<string, string> = {
  send_notification: "Envoyer une notification",
  create_task: "Creer une tache",
  send_sms: "Envoyer un SMS (Twilio)",
};

const ACTION_ICONS: Record<string, any> = {
  send_notification: Bell,
  create_task: ClipboardList,
  send_sms: MessageSquare,
};

interface RuleAction {
  type: string;
  params: Record<string, string>;
}

interface RuleForm {
  name: string;
  description: string;
  trigger: string;
  schedule: string;
  inactivityDays: string;
  actions: RuleAction[];
}

const DEFAULT_FORM: RuleForm = {
  name: "",
  description: "",
  trigger: "schedule",
  schedule: "1h",
  inactivityDays: "30",
  actions: [{ type: "send_notification", params: { title: "", message: "", notifType: "info" } }],
};

function ActionEditor({ action, index, onChange, onRemove }: {
  action: RuleAction;
  index: number;
  onChange: (updated: RuleAction) => void;
  onRemove: () => void;
}) {
  const Icon = ACTION_ICONS[action.type] || Bell;

  function setParam(key: string, value: string) {
    onChange({ ...action, params: { ...action.params, [key]: value } });
  }

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary shrink-0" />
        <Select value={action.type} onValueChange={t => onChange({ type: t, params: {} })}>
          <SelectTrigger className="flex-1 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="shrink-0 h-8 w-8 text-muted-foreground" onClick={onRemove}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {action.type === "send_notification" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Titre</Label>
              <Input className="h-7 text-xs mt-1" value={action.params.title ?? ""} onChange={e => setParam("title", e.target.value)} placeholder="Titre de la notification" />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={action.params.notifType ?? "info"} onValueChange={v => setParam("notifType", v)}>
                <SelectTrigger className="h-7 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="alerte">Alerte</SelectItem>
                  <SelectItem value="rappel">Rappel</SelectItem>
                  <SelectItem value="succes">Succes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Message <span className="text-muted-foreground">({"{{phoneNumber}}"} disponible)</span></Label>
            <Textarea className="text-xs mt-1 min-h-[60px]" value={action.params.message ?? ""} onChange={e => setParam("message", e.target.value)} placeholder="Message de la notification..." />
          </div>
        </>
      )}

      {action.type === "create_task" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">Titre de la tache</Label>
            <Input className="h-7 text-xs mt-1" value={action.params.title ?? ""} onChange={e => setParam("title", e.target.value)} placeholder="Rappeler {{firstName}} {{lastName}}" />
          </div>
          <div>
            <Label className="text-xs">Priorite</Label>
            <Select value={action.params.priority ?? "moyenne"} onValueChange={v => setParam("priority", v)}>
              <SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basse">Basse</SelectItem>
                <SelectItem value="moyenne">Moyenne</SelectItem>
                <SelectItem value="haute">Haute</SelectItem>
                <SelectItem value="urgente">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Echeance (jours)</Label>
            <Input type="number" className="h-7 text-xs mt-1" value={action.params.dueDays ?? "1"} onChange={e => setParam("dueDays", e.target.value)} min="1" />
          </div>
        </div>
      )}

      {action.type === "send_sms" && (
        <>
          <div>
            <Label className="text-xs">Numero destinataire <span className="text-muted-foreground">(laisser vide = numero du contact)</span></Label>
            <Input className="h-7 text-xs mt-1" value={action.params.to ?? ""} onChange={e => setParam("to", e.target.value)} placeholder="+33612345678 ou vide" />
          </div>
          <div>
            <Label className="text-xs">Message SMS <span className="text-muted-foreground">({"{{phoneNumber}}"} disponible)</span></Label>
            <Textarea className="text-xs mt-1 min-h-[60px]" value={action.params.message ?? ""} onChange={e => setParam("message", e.target.value)} placeholder="Bonjour, nous avons manque votre appel..." />
          </div>
        </>
      )}
    </div>
  );
}

function EditRuleDialog({ rule, onSaved, onClose }: { rule: any; onSaved: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; description: string; schedule: string }>({
    name: rule.name || "",
    description: rule.description || "",
    schedule: rule.schedule || "1h",
  });

  async function submit() {
    if (!form.name.trim()) { toast({ title: "Nom requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/api/automations/${rule.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim(), schedule: form.schedule }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      toast({ title: "Regle mise a jour" });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Erreur", description: "Impossible de modifier la regle", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" /> Modifier la regle
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nom de la regle <span className="text-red-500">*</span></Label>
            <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Description</Label>
            <Input className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <Label>Frequence d'execution</Label>
            <Select value={form.schedule} onValueChange={v => setForm(f => ({ ...f, schedule: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5min">Toutes les 5 min</SelectItem>
                <SelectItem value="15min">Toutes les 15 min</SelectItem>
                <SelectItem value="30min">Toutes les 30 min</SelectItem>
                <SelectItem value="1h">Toutes les heures</SelectItem>
                <SelectItem value="6h">Toutes les 6h</SelectItem>
                <SelectItem value="12h">Toutes les 12h</SelectItem>
                <SelectItem value="24h">Une fois par jour</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRuleDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RuleForm>(DEFAULT_FORM);

  function addAction() {
    setForm(f => ({ ...f, actions: [...f.actions, { type: "send_notification", params: { title: "", message: "", notifType: "info" } }] }));
  }

  function updateAction(i: number, updated: RuleAction) {
    setForm(f => { const a = [...f.actions]; a[i] = updated; return { ...f, actions: a }; });
  }

  function removeAction(i: number) {
    setForm(f => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }));
  }

  async function submit() {
    if (!form.name.trim()) { toast({ title: "Nom requis", variant: "destructive" }); return; }
    if (form.actions.length === 0) { toast({ title: "Au moins une action requise", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const conditions = form.trigger === "contact_no_activity"
        ? { inactivityDays: parseInt(form.inactivityDays) || 30 }
        : undefined;

      const res = await fetch(`${baseUrl}/api/automations`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          type: "custom",
          trigger: form.trigger,
          schedule: form.schedule,
          conditions,
          actions: form.actions,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erreur serveur");
      }

      toast({ title: "Regle creee", description: `"${form.name}" est maintenant active.` });
      setOpen(false);
      setForm(DEFAULT_FORM);
      onCreated();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" /> Nouvelle regle
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" /> Creer une regle d'automatisation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nom de la regle <span className="text-red-500">*</span></Label>
              <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: SMS appel manque" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Input className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description optionnelle..." />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Declencheur</Label>
              <Select value={form.trigger} onValueChange={v => setForm(f => ({ ...f, trigger: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TRIGGER_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Frequence d'execution</Label>
              <Select value={form.schedule} onValueChange={v => setForm(f => ({ ...f, schedule: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5min">Toutes les 5 min</SelectItem>
                  <SelectItem value="15min">Toutes les 15 min</SelectItem>
                  <SelectItem value="30min">Toutes les 30 min</SelectItem>
                  <SelectItem value="1h">Toutes les heures</SelectItem>
                  <SelectItem value="6h">Toutes les 6h</SelectItem>
                  <SelectItem value="12h">Toutes les 12h</SelectItem>
                  <SelectItem value="24h">Une fois par jour</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.trigger === "contact_no_activity" && (
              <div>
                <Label>Inactivite (jours)</Label>
                <Input type="number" className="mt-1" value={form.inactivityDays} onChange={e => setForm(f => ({ ...f, inactivityDays: e.target.value }))} min="1" max="365" />
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Actions ({form.actions.length})</Label>
              <Button size="sm" variant="outline" onClick={addAction} className="gap-1 h-7 text-xs">
                <Plus className="w-3 h-3" /> Ajouter
              </Button>
            </div>
            {form.actions.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Aucune action. Ajoutez-en une ci-dessus.</p>
            )}
            {form.actions.map((a, i) => (
              <ActionEditor key={i} action={a} index={i} onChange={u => updateAction(i, u)} onRemove={() => removeAction(i)} />
            ))}
          </div>

          {form.trigger === "missed_call" && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              <strong>Astuce :</strong> Pour send_sms, laissez le numero vide — le numero de l'appelant manque sera utilise automatiquement. Utilisez {"{{phoneNumber}}"} dans le message.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Creer la regle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AutomationsPage() {
  const { toast } = useToast();
  const [rules, setRules] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<any>(null);

  async function fetchData() {
    setLoading(true);
    try {
      const [rulesRes, logsRes] = await Promise.all([
        fetch(`${baseUrl}/api/automations`, { credentials: "include" }),
        fetch(`${baseUrl}/api/automations/logs?limit=100`, { credentials: "include" }),
      ]);
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data.rules);
      } else {
        toast({ title: "Erreur", description: "Impossible de charger les regles", variant: "destructive" });
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs);
        setStats(data.stats);
      } else {
        toast({ title: "Erreur", description: "Impossible de charger les journaux", variant: "destructive" });
      }
    } catch (err) {
      console.error("[Automations] fetch failed:", err);
      toast({ title: "Erreur", description: "Impossible de charger les automatisations", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function deleteRule(id: number, name: string) {
    if (!confirm(`Supprimer la regle "${name}" ?`)) return;
    try {
      const res = await fetch(`${baseUrl}/api/automations/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Erreur serveur");
      toast({ title: "Regle supprimee" });
      fetchData();
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer la regle", variant: "destructive" });
    }
  }

  async function toggleRule(id: number, enabled: boolean) {
    try {
      const res = await fetch(`${baseUrl}/api/automations/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      fetchData();
    } catch {
      toast({ title: "Erreur", description: "Impossible de modifier la regle", variant: "destructive" });
    }
  }

  useEffect(() => { fetchData(); }, []);

  function timeAgo(date: string | null): string {
    if (!date) return "Jamais";
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "A l'instant";
    if (mins < 60) return `Il y a ${mins}min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Il y a ${hours}h`;
    return `Il y a ${Math.floor(hours / 24)}j`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const builtInRules = rules.filter(r => r.builtIn);
  const customRules = rules.filter(r => !r.builtIn);
  const successRate = stats ? (stats.totalToday > 0 ? Math.round((stats.successToday / stats.totalToday) * 100) : 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white">
              <Zap className="w-6 h-6" />
            </div>
            Automatisations
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Moteur d'automatisation intelligent - surveillance et actions automatiques
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" /> Actualiser
          </Button>
          <a href={`${baseUrl}/api/automations/export/csv`} download="automations.csv">
            <Button variant="outline" size="sm" title="Exporter CSV"><Download className="w-4 h-4" /></Button>
          </a>
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <CreateRuleDialog onCreated={fetchData} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-green-500/10 text-green-500">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.totalToday || 0}</p>
                <p className="text-xs text-muted-foreground">Executions aujourd'hui</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{successRate}%</p>
                <p className="text-xs text-muted-foreground">Taux de reussite</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.itemsToday || 0}</p>
                <p className="text-xs text-muted-foreground">Elements traites</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.errorToday || 0}</p>
                <p className="text-xs text-muted-foreground">Erreurs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="regles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="regles" className="gap-1.5">
            <Settings2 className="w-4 h-4" /> Regles actives
          </TabsTrigger>
          <TabsTrigger value="journal" className="gap-1.5">
            <BarChart3 className="w-4 h-4" /> Journal d'execution
          </TabsTrigger>
        </TabsList>

        <TabsContent value="regles" className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Bot className="w-4 h-4" /> Automatisations systeme (integrees)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {builtInRules.map(rule => {
              const Icon = TYPE_ICONS[rule.name] || Zap;
              const colorClass = TYPE_COLORS[rule.name] || "text-gray-500 bg-gray-500/10";
              return (
                <Card key={rule.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${colorClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-sm">{rule.name}</h4>
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                            <PlayCircle className="w-2.5 h-2.5 mr-0.5" /> Actif
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{rule.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Chaque 5 minutes
                          </span>
                          <Badge variant="secondary" className="text-[10px]">Systeme</Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Regles personnalisees ({customRules.length})
            </h3>
          </div>

          {customRules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Zap className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground font-medium">Aucune regle personnalisee</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">Creez des automatisations sur mesure pour votre flux de travail</p>
                <CreateRuleDialog onCreated={fetchData} />
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {customRules.map(rule => (
                <Card key={rule.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${rule.enabled ? "bg-amber-500/10 text-amber-500" : "bg-gray-500/10 text-gray-500"}`}>
                        <Zap className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-sm truncate">{rule.name}</h4>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${rule.enabled ? "bg-green-500/10 text-green-600 border-green-500/30" : "bg-gray-500/10 text-gray-500 border-gray-500/30"}`}>
                            {rule.enabled ? <><PlayCircle className="w-2.5 h-2.5 mr-0.5" /> Actif</> : <><PauseCircle className="w-2.5 h-2.5 mr-0.5" /> Pause</>}
                          </Badge>
                        </div>
                        {rule.description && <p className="text-xs text-muted-foreground truncate">{rule.description}</p>}
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {rule.schedule || "Manuel"}</span>
                          <span>{rule.runCount} exec.</span>
                          {rule.lastRun && <span>{timeAgo(rule.lastRun)}</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[10px]">
                            {TRIGGER_LABELS[rule.trigger] || rule.trigger}
                          </Badge>
                          {Array.isArray(rule.actions) && (
                            <span className="text-[10px] text-muted-foreground">{rule.actions.length} action(s)</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3 pt-3 border-t">
                      <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => toggleRule(rule.id, rule.enabled)}>
                        {rule.enabled ? <PauseCircle className="w-3 h-3 mr-1" /> : <PlayCircle className="w-3 h-3 mr-1" />}
                        {rule.enabled ? "Suspendre" : "Activer"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Modifier" onClick={() => setEditingRule(rule)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Dupliquer" onClick={async () => {
                        const res = await fetch(`${baseUrl}/api/automations/${rule.id}/duplicate`, { method: "POST", credentials: "include" });
                        if (res.ok) { toast({ title: "Automation dupliquée" }); fetchData(); }
                      }}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => deleteRule(rule.id, rule.name)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="journal" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Historique des executions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Aucune execution enregistree
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map(log => (
                    <div key={log.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/40 transition-colors border-b last:border-b-0">
                      <div className={`p-1.5 rounded-lg ${log.status === "success" ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                        {log.status === "success" ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{log.ruleName}</span>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${log.status === "success" ? "text-green-600" : "text-red-600"}`}>
                            {log.status === "success" ? "Reussi" : "Erreur"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                          <span>{log.itemsProcessed} element(s)</span>
                          {log.duration !== null && <span>{log.duration}ms</span>}
                          <span>{timeAgo(log.createdAt)}</span>
                        </div>
                      </div>
                      {log.error && (
                        <span className="text-[10px] text-red-500 max-w-[200px] truncate">{log.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editingRule && (
        <EditRuleDialog rule={editingRule} onSaved={fetchData} onClose={() => setEditingRule(null)} />
      )}
    </div>
  );
}
