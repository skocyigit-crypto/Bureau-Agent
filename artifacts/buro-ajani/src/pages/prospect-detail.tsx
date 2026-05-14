import { useRoute, useLocation, Link } from "wouter";
import { confirmAction } from "@/hooks/use-confirm";
import { useState, useEffect, useCallback } from "react";
import { useWorkspaceUser } from "@/components/workspace-user";
import { AccessDenied } from "@/components/access-denied";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  ArrowLeft, Edit, Phone, Mail, Building, Calendar, Tag, X, Save, Printer,
  TrendingUp, DollarSign, Target, FileText, Trash2, Copy, UserPlus,
  FolderKanban, Loader2, User, Briefcase, ExternalLink, PhoneCall, PhoneMissed,
  Voicemail, CheckSquare, Clock, AlertCircle, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GhostTextarea } from "@/components/ghost-textarea";
import { DocumentsPanel } from "@/components/file-upload";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const STAGES = [
  { key: "nouveau", label: "Nouveau", color: "bg-slate-100 text-slate-600 border-slate-200" },
  { key: "contact", label: "Contact", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { key: "qualification", label: "Qualification", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { key: "proposition", label: "Proposition", color: "bg-amber-100 text-amber-700 border-amber-200" },
  { key: "negociation", label: "Négociation", color: "bg-orange-100 text-orange-700 border-orange-200" },
  { key: "gagne", label: "Gagné", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { key: "perdu", label: "Perdu", color: "bg-red-100 text-red-700 border-red-200" },
] as const;

const PRIORITIES = [
  { key: "haute", label: "Haute", color: "bg-red-100 text-red-700" },
  { key: "moyenne", label: "Moyenne", color: "bg-amber-100 text-amber-700" },
  { key: "basse", label: "Basse", color: "bg-slate-100 text-slate-600" },
];

function fmtEur(v: any) {
  if (!v) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parseFloat(v));
}

function StageBadge({ stage }: { stage: string }) {
  const s = STAGES.find(x => x.key === stage) || STAGES[0];
  return <Badge className={`${s.color} text-xs`} variant="outline">{s.label}</Badge>;
}
function PriorityBadge({ priority }: { priority: string }) {
  const p = PRIORITIES.find(x => x.key === priority) || PRIORITIES[1];
  return <Badge className={`${p.color} border-0 text-xs`}>{p.label}</Badge>;
}

interface Prospect {
  id: number; title: string; description?: string; contactName?: string; company?: string;
  email?: string; phone?: string; stage: string; priority: string; value?: string;
  currency: string; probability: number; source?: string; assignedTo?: string;
  expectedCloseDate?: string; wonAt?: string; lostAt?: string; lostReason?: string;
  notes?: string; tags?: string[]; contactId?: number | null; createdAt: string; updatedAt?: string;
}

const EMPTY_FORM = { title: "", contactName: "", company: "", email: "", phone: "", stage: "nouveau", priority: "moyenne", value: "", currency: "EUR", probability: "50", source: "", assignedTo: "", expectedCloseDate: "", notes: "" };

export default function ProspectDetail() {
  // Module backoffice (super-admin uniquement) — Tâche #52.
  const { user: workspaceUser } = useWorkspaceUser();
  if (workspaceUser.role !== "super_admin") return <AccessDenied />;
  const [, params] = useRoute("/prospects/:id");
  const prospectId = params?.id ? parseInt(params.id) : 0;
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [historyData, setHistoryData] = useState<{ calls: any[]; tasks: any[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [linkedContact, setLinkedContact] = useState<any>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [savingTags, setSavingTags] = useState(false);

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    if (!prospectId) return;
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`${BASE}/api/prospects/${prospectId}`, { credentials: "include" });
      if (res.status === 404) { setNotFound(true); setProspect(null); setLinkedContact(null); return; }
      if (!res.ok) throw new Error("erreur");
      const data: Prospect = await res.json();
      setProspect(data);
      setTags(data.tags || []);
      if (data.contactId) {
        try {
          const cr = await fetch(`${BASE}/api/contacts/${data.contactId}`, { credentials: "include" });
          if (cr.ok) setLinkedContact(await cr.json()); else setLinkedContact(null);
        } catch { setLinkedContact(null); }
      } else {
        setLinkedContact(null);
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger le prospect.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [prospectId, toast]);

  const loadHistory = useCallback(async () => {
    if (!prospectId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${BASE}/api/prospects/${prospectId}/history`, { credentials: "include" });
      if (res.ok) setHistoryData(await res.json());
    } catch {} finally { setHistoryLoading(false); }
  }, [prospectId]);

  useEffect(() => { load(); loadHistory(); }, [load, loadHistory]);

  const openEdit = () => {
    if (!prospect) return;
    setForm({
      title: prospect.title, contactName: prospect.contactName || "", company: prospect.company || "",
      email: prospect.email || "", phone: prospect.phone || "", stage: prospect.stage,
      priority: prospect.priority, value: prospect.value || "", currency: prospect.currency || "EUR",
      probability: String(prospect.probability ?? 50), source: prospect.source || "",
      assignedTo: prospect.assignedTo || "",
      expectedCloseDate: prospect.expectedCloseDate ? prospect.expectedCloseDate.substring(0, 10) : "",
      notes: prospect.notes || "",
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ title: "Titre requis", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/prospects/${prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, probability: Number(form.probability), value: form.value || null }),
      });
      if (res.ok) {
        toast({ title: "Prospect mis à jour" });
        setEditOpen(false);
        load();
      } else {
        const d = await res.json();
        toast({ title: "Erreur", description: d.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Sauvegarde échouée.", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleStageChange = async (stage: string) => {
    const res = await fetch(`${BASE}/api/prospects/${prospectId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ stage }),
    });
    if (res.ok) { toast({ title: "Étape mise à jour" }); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const saveTags = async (next: string[]) => {
    setSavingTags(true);
    try {
      await fetch(`${BASE}/api/prospects/${prospectId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ tags: next }),
      });
    } finally { setSavingTags(false); }
  };
  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    const next = [...tags, t]; setTags(next); setTagInput(""); saveTags(next);
  };
  const removeTag = (tag: string) => { const next = tags.filter(t => t !== tag); setTags(next); saveTags(next); };

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      const res = await fetch(`${BASE}/api/prospects/${prospectId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ notes: notesValue }),
      });
      if (res.ok) { toast({ title: "Notes enregistrées" }); setEditingNotes(false); load(); }
      else toast({ title: "Erreur", variant: "destructive" });
    } finally { setSavingNotes(false); }
  };

  const handleDuplicate = async () => {
    const res = await fetch(`${BASE}/api/prospects/${prospectId}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) {
      const copy = await res.json();
      toast({ title: "Prospect dupliqué" });
      navigate(`/prospects/${copy.id}`);
    } else toast({ title: "Erreur", description: "Impossible de dupliquer", variant: "destructive" });
  };

  const handleDelete = async () => {
    if (!(await confirmAction({ title: "Supprimer ce prospect ?", confirmLabel: "Supprimer", destructive: true }))) return;
    const res = await fetch(`${BASE}/api/prospects/${prospectId}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Prospect supprimé" }); navigate("/prospects"); }
    else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
  };

  const handleConvert = async () => {
    if (!(await confirmAction({ title: "Convertir en contact ?", description: "Le statut du prospect passera à « Gagné ».", confirmLabel: "Convertir" }))) return;
    const res = await fetch(`${BASE}/api/prospects/${prospectId}/convert`, { method: "POST", credentials: "include" });
    const d = await res.json();
    if (res.ok) { toast({ title: "Converti !", description: d.message }); load(); }
    else toast({ title: "Erreur", description: d.error, variant: "destructive" });
  };

  const handleCreateProjet = async () => {
    if (!prospect) return;
    try {
      const res = await fetch(`${BASE}/api/projets`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          title: prospect.title,
          clientName: prospect.contactName || "",
          clientCompany: prospect.company || "",
          status: "planifie", priority: prospect.priority,
          budget: prospect.value || undefined, currency: prospect.currency || "EUR",
          progress: 0, notes: prospect.notes || "",
        }),
      });
      if (res.ok) { toast({ title: "Projet créé", description: `Le projet "${prospect.title}" a été créé.` }); navigate("/projets"); }
      else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch {
      toast({ title: "Erreur", description: "Impossible de créer le projet.", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-64 md:col-span-1" />
          <Skeleton className="h-64 md:col-span-2" />
        </div>
      </div>
    );
  }

  if (notFound || !prospect) {
    return (
      <div className="space-y-6">
        <Button variant="outline" size="sm" asChild className="gap-2">
          <Link href="/prospects"><ArrowLeft className="w-4 h-4" /> Retour aux prospects</Link>
        </Button>
        <Card><CardContent className="py-12 text-center text-muted-foreground">Prospect introuvable.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/prospects"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{prospect.title}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StageBadge stage={prospect.stage} />
            <PriorityBadge priority={prospect.priority} />
            {prospect.value && <span className="text-sm font-semibold text-emerald-600">{fmtEur(prospect.value)}</span>}
            {prospect.probability != null && <span className="text-xs text-muted-foreground">· {prospect.probability}% de probabilité</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={openEdit} className="gap-2"><Edit className="w-4 h-4" /> Modifier</Button>
          {prospect.phone && (
            <Button className="bg-primary text-primary-foreground gap-2" onClick={() => window.open(`tel:${prospect.phone}`, "_self")}>
              <Phone className="w-4 h-4" /> Appeler
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-amber-500" />Détails du prospect</CardTitle>
              <CardDescription>Informations commerciales</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {prospect.contactName && <div className="flex items-center gap-3"><User className="w-4 h-4 text-muted-foreground" /><span>{prospect.contactName}</span></div>}
              {prospect.company && <div className="flex items-center gap-3"><Building className="w-4 h-4 text-muted-foreground" /><span>{prospect.company}</span></div>}
              {prospect.phone && <div className="flex items-center gap-3"><Phone className="w-4 h-4 text-muted-foreground" /><span>{prospect.phone}</span></div>}
              {prospect.email && <div className="flex items-center gap-3"><Mail className="w-4 h-4 text-muted-foreground" /><span className="truncate">{prospect.email}</span></div>}
              <div className="pt-3 mt-3 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Étape</span>
                  <Select value={prospect.stage} onValueChange={handleStageChange}>
                    <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {prospect.value && <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" />Valeur</span><span className="font-semibold text-emerald-600">{fmtEur(prospect.value)}</span></div>}
                <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" />Probabilité</span><span className="font-medium">{prospect.probability}%</span></div>
                {prospect.expectedCloseDate && (
                  <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />Clôture prévue</span><span className="font-medium">{format(new Date(prospect.expectedCloseDate), "d MMM yyyy", { locale: fr })}</span></div>
                )}
                {prospect.source && <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Source</span><span className="font-medium">{prospect.source}</span></div>}
                {prospect.assignedTo && <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Assigné à</span><span className="font-medium">{prospect.assignedTo}</span></div>}
              </div>
              <div className="pt-3 mt-3 border-t border-border text-xs text-muted-foreground">
                <div>Créé le {format(new Date(prospect.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>
                {prospect.updatedAt && <div>Modifié le {format(new Date(prospect.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>}
                {prospect.wonAt && <div className="text-emerald-600">Gagné le {format(new Date(prospect.wonAt), "d MMM yyyy", { locale: fr })}</div>}
                {prospect.lostAt && <div className="text-red-600">Perdu le {format(new Date(prospect.lostAt), "d MMM yyyy", { locale: fr })}{prospect.lostReason ? ` — ${prospect.lostReason}` : ""}</div>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={handleConvert}><UserPlus className="w-4 h-4" />Convertir en contact</Button>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-indigo-600" onClick={handleCreateProjet}><FolderKanban className="w-4 h-4" />Créer un projet</Button>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={handleDuplicate}><Copy className="w-4 h-4" />Dupliquer</Button>
              <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-red-600 hover:text-red-700" onClick={handleDelete}><Trash2 className="w-4 h-4" />Supprimer</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-muted-foreground" />Étiquettes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
                {tags.length === 0 && <span className="text-xs text-muted-foreground italic">Aucune étiquette</span>}
                {tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full border border-primary/20">
                    {tag}
                    <button onClick={() => removeTag(tag)} disabled={savingTags} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 text-xs border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Ajouter une étiquette..."
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  disabled={savingTags}
                />
                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addTag} disabled={!tagInput.trim() || savingTags}>+</Button>
              </div>
            </CardContent>
          </Card>

          <DocumentsPanel entityType="prospect" entityId={prospect.id} />
        </div>

        <div className="md:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Aperçu</TabsTrigger>
              <TabsTrigger value="history">Historique</TabsTrigger>
              <TabsTrigger value="contact">Contact lié</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <Card>
                <CardHeader><CardTitle>Description</CardTitle></CardHeader>
                <CardContent>
                  {prospect.description ? (
                    <p className="text-sm whitespace-pre-wrap">{prospect.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Aucune description.</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Pipeline</CardTitle><CardDescription>Avancement dans les étapes</CardDescription></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-1 overflow-x-auto pb-2">
                    {STAGES.map(s => {
                      const isCurrent = s.key === prospect.stage;
                      return (
                        <div key={s.key} className="flex-1 min-w-[80px]">
                          <div className={`h-2 rounded-full ${isCurrent ? "bg-amber-500" : (STAGES.findIndex(x => x.key === prospect.stage) > STAGES.findIndex(x => x.key === s.key) ? "bg-emerald-400" : "bg-slate-200")}`} />
                          <p className={`text-[10px] mt-1 text-center ${isCurrent ? "font-semibold" : "text-muted-foreground"}`}>{s.label}</p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><History className="w-4 h-4 text-amber-500" />Historique des appels</CardTitle>
                    <CardDescription>Appels associés au contact, téléphone ou nom du prospect</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/appels${linkedContact ? `?contactId=${linkedContact.id}` : prospect.phone ? `?search=${encodeURIComponent(prospect.phone)}` : ""}`)}>
                    <ExternalLink className="w-4 h-4 mr-1" />Voir tous
                  </Button>
                </CardHeader>
                <CardContent>
                  {historyLoading ? (
                    <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                  ) : historyData?.calls && historyData.calls.length > 0 ? (
                    <div className="space-y-2">
                      {historyData.calls.map((call: any) => {
                        const StatusIcon = call.status === "manque" ? PhoneMissed : call.status === "messagerie" ? Voicemail : PhoneCall;
                        const statusColor = call.status === "manque" ? "text-red-600" : call.status === "messagerie" ? "text-amber-600" : "text-emerald-600";
                        return (
                          <Link key={call.id} href={`/appels/${call.id}`} className="block">
                            <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 cursor-pointer">
                              <div className="flex items-center gap-3 min-w-0">
                                <StatusIcon className={`w-4 h-4 ${statusColor} flex-shrink-0`} />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{call.contactName || call.phoneNumber}</p>
                                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {format(new Date(call.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}
                                    {call.direction === "entrant" ? " · Entrant" : " · Sortant"}
                                  </p>
                                </div>
                              </div>
                              <ArrowLeft className="w-4 h-4 rotate-180 text-muted-foreground" />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-sm italic">Aucun appel trouvé pour ce prospect.</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><CheckSquare className="w-4 h-4 text-blue-500" />Tâches liées</CardTitle>
                    <CardDescription>Tâches mentionnant ce prospect ou son contact</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/taches`)}>
                    <ExternalLink className="w-4 h-4 mr-1" />Voir toutes
                  </Button>
                </CardHeader>
                <CardContent>
                  {historyLoading ? (
                    <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                  ) : historyData?.tasks && historyData.tasks.length > 0 ? (
                    <div className="space-y-2">
                      {historyData.tasks.map((task: any) => {
                        const StatusIcon = task.status === "termine" ? CheckSquare : task.status === "en_cours" ? AlertCircle : Clock;
                        const statusColor = task.status === "termine" ? "text-emerald-600" : task.status === "en_cours" ? "text-blue-600" : "text-amber-600";
                        return (
                          <div key={task.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30">
                            <div className="flex items-center gap-3 min-w-0">
                              <StatusIcon className={`w-4 h-4 ${statusColor} flex-shrink-0`} />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{task.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  <PriorityBadge priority={task.priority} />
                                  {task.dueDate && <span className="ml-2">Échéance: {format(new Date(task.dueDate), "d MMM yyyy", { locale: fr })}</span>}
                                </p>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground">{format(new Date(task.createdAt), "dd/MM/yy")}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-sm italic">Aucune tâche liée à ce prospect.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="contact" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Contact lié</CardTitle>
                  <CardDescription>Le contact CRM associé à ce prospect</CardDescription>
                </CardHeader>
                <CardContent>
                  {linkedContact ? (
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center text-sm font-medium text-secondary">
                          {linkedContact.firstName?.charAt(0)}{linkedContact.lastName?.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{linkedContact.firstName} {linkedContact.lastName}</p>
                          <p className="text-xs text-muted-foreground">{[linkedContact.company, linkedContact.email].filter(Boolean).join(" · ")}</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" asChild className="gap-1">
                        <Link href={`/contacts/${linkedContact.id}`}><ExternalLink className="w-3.5 h-3.5" /> Ouvrir</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      Aucun contact CRM lié à ce prospect.
                      <div className="mt-3">
                        <Button size="sm" variant="outline" onClick={handleConvert} className="gap-1"><UserPlus className="w-3.5 h-3.5" />Convertir en contact</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div><CardTitle>Notes</CardTitle><CardDescription>Informations supplémentaires sur ce prospect</CardDescription></div>
                  {!editingNotes ? (
                    <Button variant="outline" size="sm" onClick={() => { setNotesValue(prospect.notes || ""); setEditingNotes(true); }}>
                      <Edit className="w-3.5 h-3.5 mr-1" />Modifier
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditingNotes(false)}>Annuler</Button>
                      <Button size="sm" disabled={savingNotes} onClick={saveNotes}>
                        <Save className="w-3.5 h-3.5 mr-1" />{savingNotes ? "Enregistrement..." : "Enregistrer"}
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {editingNotes ? (
                    <Textarea
                      className="resize-none min-h-[160px] text-sm"
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      placeholder="Entrez des notes sur ce prospect..."
                    />
                  ) : prospect.notes ? (
                    <div className="p-4 bg-muted/50 rounded-lg whitespace-pre-wrap text-sm border border-border">{prospect.notes}</div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground italic">Aucune note. Cliquez sur Modifier pour en ajouter.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier le prospect</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Titre *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Étape</Label>
                <Select value={form.stage} onValueChange={v => setForm(f => ({ ...f, stage: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Priorité</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Valeur (€)</Label><Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></div>
              <div><Label className="text-xs">Probabilité (%)</Label><Input type="number" min="0" max="100" value={form.probability} onChange={e => setForm(f => ({ ...f, probability: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Contact</Label><Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} /></div>
              <div><Label className="text-xs">Entreprise</Label><Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              <div><Label className="text-xs">Téléphone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Source</Label><Input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} /></div>
              <div><Label className="text-xs">Assigné à</Label><Input value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Date de clôture prévue</Label><Input type="date" value={form.expectedCloseDate} onChange={e => setForm(f => ({ ...f, expectedCloseDate: e.target.value }))} /></div>
            <div><Label className="text-xs">Notes</Label><GhostTextarea fieldType="prospect_note" context={{ title: form.title, contactName: form.contactName }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Mettre à jour</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
