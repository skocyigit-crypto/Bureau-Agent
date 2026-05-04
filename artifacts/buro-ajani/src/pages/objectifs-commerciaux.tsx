import { useState, useEffect, useCallback } from "react";
import { Target, Plus, Trash2, Edit, TrendingUp, RefreshCw, CheckCircle, X, Download, Printer, FolderKanban } from "lucide-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function fmt(v: any) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v));
}

const METRIC_LABELS: Record<string, string> = {
  revenue: "Chiffre d'affaires (€)", devis: "Nombre de devis", factures: "Nombre de factures",
  prospects: "Nombre de prospects", calls: "Nombre d'appels", contacts: "Nombre de contacts",
  projets: "Nombre de projets", projets_termines: "Projets terminés",
};
const PERIOD_LABELS: Record<string, string> = {
  weekly: "Hebdomadaire", monthly: "Mensuel", quarterly: "Trimestriel", yearly: "Annuel",
};

interface Objectif {
  id: number; title: string; metric: string; targetValue: string; currentValue: string;
  period: string; startDate?: string; endDate?: string; status: string; notes?: string;
}

const EMPTY_FORM = { title: "", metric: "revenue", targetValue: "", currentValue: "0", period: "monthly", startDate: "", endDate: "", notes: "" };

export default function ObjectifsCommerciauxPage() {
  const [, navigate] = useLocation();
  const [objectifs, setObjectifs] = useState<Objectif[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Objectif | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function navigateToProjets() {
    const res = await fetch(`${BASE}/api/projets`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ title: "Nouveau projet", status: "planifie", priority: "haute", progress: 0, notes: "Créé depuis les objectifs commerciaux" }),
    });
    if (res.ok) { toast({ title: "Projet créé" }); navigate("/projets"); }
    else toast({ title: "Erreur lors de la création", variant: "destructive" });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/objectifs-commerciaux`, { credentials: "include" });
      if (!r.ok) throw new Error();
      setObjectifs(await r.json());
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les objectifs.", variant: "destructive" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setOpen(true); }
  function openEdit(o: Objectif) {
    setEditing(o);
    setForm({ title: o.title, metric: o.metric, targetValue: o.targetValue, currentValue: o.currentValue, period: o.period, startDate: o.startDate || "", endDate: o.endDate || "", notes: o.notes || "" });
    setOpen(true);
  }

  async function save() {
    if (!form.title.trim() || !form.targetValue) { toast({ title: "Champs requis", description: "Titre et valeur cible sont obligatoires.", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editing ? `${BASE}/api/objectifs-commerciaux/${editing.id}` : `${BASE}/api/objectifs-commerciaux`;
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) { toast({ title: "Erreur", description: d.error, variant: "destructive" }); return; }
      toast({ title: editing ? "Objectif modifié" : "Objectif créé" });
      setOpen(false);
      load();
    } finally { setSaving(false); }
  }

  async function remove(id: number) {
    if (!confirm("Supprimer cet objectif ?")) return;
    await fetch(`${BASE}/api/objectifs-commerciaux/${id}`, { method: "DELETE", credentials: "include" });
    load();
  }

  async function updateProgress(o: Objectif, newValue: string) {
    await fetch(`${BASE}/api/objectifs-commerciaux/${o.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ currentValue: newValue }),
    });
    load();
  }

  const actifs = objectifs.filter(o => o.status === "actif");
  const termines = objectifs.filter(o => o.status !== "actif");
  const totalAtteints = actifs.filter(o => Number(o.currentValue) >= Number(o.targetValue)).length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Target className="w-6 h-6 text-violet-500" />Objectifs Commerciaux</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{actifs.length} objectif{actifs.length !== 1 ? "s" : ""} actif{actifs.length !== 1 ? "s" : ""} · {totalAtteints} atteint{totalAtteints !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Actualiser</Button>
          <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/objectifs-commerciaux/export/csv`} download>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />CSV</Button>
          </a>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-indigo-600 border-indigo-300 hover:bg-indigo-50" onClick={navigateToProjets}>
            <FolderKanban className="w-4 h-4" />Créer un projet
          </Button>
          <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Nouvel objectif</Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Card key={i}><CardContent className="pt-5"><div className="h-28 bg-muted animate-pulse rounded-lg" /></CardContent></Card>)}
        </div>
      ) : actifs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-20 text-violet-500" />
            <p className="font-medium text-muted-foreground">Aucun objectif actif</p>
            <p className="text-sm text-muted-foreground mt-1">Définissez vos objectifs commerciaux pour suivre la performance</p>
            <Button className="mt-4" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Créer le premier objectif</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {actifs.map(o => {
            const pct = Math.min(100, (Number(o.currentValue) / Number(o.targetValue)) * 100);
            const atteint = pct >= 100;
            return (
              <Card key={o.id} className={`relative ${atteint ? "border-emerald-300 dark:border-emerald-700" : ""}`}>
                {atteint && <div className="absolute top-3 right-10 text-emerald-500"><CheckCircle className="w-5 h-5" /></div>}
                <CardHeader className="pb-2 pr-16">
                  <CardTitle className="text-sm leading-tight">{o.title}</CardTitle>
                  <div className="flex gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-xs">{PERIOD_LABELS[o.period] || o.period}</Badge>
                    <Badge variant="secondary" className="text-xs">{METRIC_LABELS[o.metric]?.split(" ")[0] || o.metric}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-semibold text-lg">{fmt(o.currentValue)}{o.metric === "revenue" ? " €" : ""}</span>
                      <span className="text-muted-foreground text-xs self-end">/ {fmt(o.targetValue)}{o.metric === "revenue" ? " €" : ""}</span>
                    </div>
                    <Progress value={pct} className={`h-2 ${atteint ? "[&>div]:bg-emerald-500" : pct >= 75 ? "[&>div]:bg-amber-500" : ""}`} />
                    <p className="text-right text-xs text-muted-foreground mt-1">{pct.toFixed(0)}%</p>
                  </div>
                  {o.notes && <p className="text-xs text-muted-foreground line-clamp-2">{o.notes}</p>}
                  <div className="flex gap-1.5 pt-1">
                    <Input
                      type="number" min="0" placeholder="Valeur actuelle"
                      defaultValue={o.currentValue}
                      className="h-7 text-xs"
                      onBlur={e => { if (e.target.value !== o.currentValue) updateProgress(o, e.target.value); }}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => openEdit(o)}>
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-red-500" onClick={() => remove(o.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {termines.length > 0 && (
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-3">Objectifs terminés / archivés ({termines.length})</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60">
            {termines.map(o => {
              const pct = Math.min(100, (Number(o.currentValue) / Number(o.targetValue)) * 100);
              return (
                <Card key={o.id} className="border-dashed">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm font-medium">{o.title}</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6 -mt-1" onClick={() => remove(o.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-xs text-muted-foreground mt-1">{pct.toFixed(0)}% · {fmt(o.currentValue)} / {fmt(o.targetValue)}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Modifier l'objectif" : "Nouvel objectif commercial"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Titre *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: CA mensuel Q2" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Indicateur</Label>
                <Select value={form.metric} onValueChange={v => setForm(f => ({ ...f, metric: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(METRIC_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Période</Label>
                <Select value={form.period} onValueChange={v => setForm(f => ({ ...f, period: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PERIOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valeur cible *</Label><Input type="number" min="0" value={form.targetValue} onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))} placeholder="Ex: 50000" /></div>
              <div><Label>Valeur actuelle</Label><Input type="number" min="0" value={form.currentValue} onChange={e => setForm(f => ({ ...f, currentValue: e.target.value }))} placeholder="0" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date début</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><Label>Date fin</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Remarques..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Enregistrement..." : editing ? "Enregistrer" : "Créer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
