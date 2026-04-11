import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Target, Search, Plus, MoreHorizontal, Edit, Trash2, ArrowRight, Columns3, LayoutList, DollarSign, TrendingUp, Users2, Percent, Calendar, Clock, CheckCircle2, AlertCircle, RefreshCw, CalendarPlus, User } from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${baseUrl}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(opts?.headers || {}) }, ...opts });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Erreur"); }
  if (res.status === 204) return null;
  return res.json();
}

const STAGE_COLORS: Record<string, string> = {
  nouveau: "bg-indigo-500", contact: "bg-blue-500", qualification: "bg-cyan-500",
  proposition: "bg-amber-500", negociation: "bg-orange-500", gagne: "bg-emerald-500", perdu: "bg-red-500",
};

const STAGE_LABELS: Record<string, string> = {
  nouveau: "Nouveau", contact: "Contact", qualification: "Qualification",
  proposition: "Proposition", negociation: "Negociation", gagne: "Gagne", perdu: "Perdu",
};

const PRIORITY_COLORS: Record<string, string> = { haute: "destructive", moyenne: "secondary", basse: "outline" };

function euro(v: number | string | null | undefined) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(v) || 0);
}

function ScheduleSection({ form, setForm, teamMembers }: { form: any; setForm: (f: any) => void; teamMembers: any[] }) {
  const [showScheduler, setShowScheduler] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availability, setAvailability] = useState<any>(null);

  const assignedUser = teamMembers.find((m: any) => String(m.id) === String(form.assignedTo));

  useEffect(() => {
    if (!form.assignedTo || !selectedDate) return;
    setLoadingSlots(true);
    apiFetch(`/prospect-calendar/availability?userId=${form.assignedTo}&date=${selectedDate}&days=1`)
      .then(data => setAvailability(data))
      .catch(() => setAvailability(null))
      .finally(() => setLoadingSlots(false));
  }, [form.assignedTo, selectedDate]);

  const selectSlot = (slot: any) => {
    setForm({
      ...form,
      rdvStartDate: slot.start,
      rdvEndDate: slot.end,
    });
  };

  if (!form.assignedTo) return null;

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-indigo-500" />
          <span className="font-medium text-sm">Planifier un rendez-vous</span>
        </div>
        <Switch checked={showScheduler} onCheckedChange={setShowScheduler} />
      </div>

      {showScheduler && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>Calendrier de <strong>{assignedUser?.prenom} {assignedUser?.nom}</strong></span>
            {assignedUser?.hasGoogleSync && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <RefreshCw className="h-2.5 w-2.5" /> Google Sync
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Date du rendez-vous</Label>
              <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <Label className="text-xs">Synchroniser Google Agenda</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <Switch checked={form.syncGoogle || false} onCheckedChange={v => setForm({ ...form, syncGoogle: v })} disabled={!assignedUser?.hasGoogleSync} />
                <span className="text-xs text-muted-foreground">{assignedUser?.hasGoogleSync ? "Actif" : "Non connecte"}</span>
              </div>
            </div>
          </div>

          {selectedDate && (
            <div>
              <Label className="text-xs mb-2 block">Creneaux disponibles</Label>
              {loadingSlots ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Analyse des calendriers...
                </div>
              ) : availability ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                    <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" /> {availability.freeSlots} libres</span>
                    <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-red-500" /> {availability.busySlots} occupes</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 max-h-[200px] overflow-y-auto">
                    {availability.allSlots?.filter((s: any) => {
                      const d = new Date(s.start);
                      return d.toISOString().slice(0, 10) === selectedDate;
                    }).map((slot: any, i: number) => {
                      const startTime = new Date(slot.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                      const endTime = new Date(slot.end).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                      const isSelected = form.rdvStartDate === slot.start;
                      return (
                        <TooltipProvider key={i}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                disabled={!slot.available}
                                onClick={() => slot.available && selectSlot(slot)}
                                className={`text-xs px-2 py-1.5 rounded border transition-all ${
                                  isSelected
                                    ? "bg-indigo-500 text-white border-indigo-600"
                                    : slot.available
                                    ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 hover:bg-green-100 dark:hover:bg-green-950/50 cursor-pointer"
                                    : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-muted-foreground line-through opacity-60 cursor-not-allowed"
                                }`}
                              >
                                {startTime}-{endTime}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {slot.available ? "Disponible" : `Occupe: ${slot.eventTitle || ""} (${slot.source || ""})`}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                  </div>
                  {form.rdvStartDate && (
                    <div className="flex items-center gap-2 mt-2 p-2 bg-indigo-50 dark:bg-indigo-950/30 rounded border border-indigo-200 dark:border-indigo-900">
                      <CalendarPlus className="h-4 w-4 text-indigo-500" />
                      <span className="text-xs font-medium">
                        RDV : {new Date(form.rdvStartDate).toLocaleDateString("fr-FR")} de {new Date(form.rdvStartDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} a {new Date(form.rdvEndDate).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Selectionnez une date pour voir les disponibilites</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Prospects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const { data: pipelineData, isLoading } = useQuery({ queryKey: ["prospects-pipeline"], queryFn: () => apiFetch("/prospects/pipeline") });
  const { data: listData } = useQuery({ queryKey: ["prospects-list", search], queryFn: () => apiFetch(`/prospects?search=${search}`) });
  const { data: calendarSources } = useQuery({ queryKey: ["prospect-calendar-sources"], queryFn: () => apiFetch("/prospect-calendar/sources") });
  const { data: teamData } = useQuery({ queryKey: ["team-availability"], queryFn: () => apiFetch("/prospect-calendar/team-availability") });
  const { data: teamMembersData } = useQuery({ queryKey: ["prospect-team-members"], queryFn: () => apiFetch("/prospect-calendar/team-members") });

  const teamMembers = (teamMembersData?.members || []);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const { rdvStartDate, rdvEndDate, syncGoogle, ...prospectData } = data;
      const prospect = await apiFetch("/prospects", { method: "POST", body: JSON.stringify(prospectData) });

      if (rdvStartDate && rdvEndDate && data.assignedTo) {
        await apiFetch("/prospect-calendar/schedule", {
          method: "POST",
          body: JSON.stringify({
            prospectId: prospect.id,
            prospectTitle: prospect.title,
            assignedUserId: parseInt(data.assignedTo),
            startDate: rdvStartDate,
            endDate: rdvEndDate,
            syncGoogle: syncGoogle || false,
            contactName: data.contactName,
            contactEmail: data.email,
            contactPhone: data.phone,
            company: data.company,
          }),
        });
      }
      return prospect;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects-pipeline"] });
      qc.invalidateQueries({ queryKey: ["prospects-list"] });
      qc.invalidateQueries({ queryKey: ["team-availability"] });
      toast({ title: "Prospect cree", description: form.rdvStartDate ? "Rendez-vous planifie et synchronise" : undefined });
      setIsDialogOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, rdvStartDate, rdvEndDate, syncGoogle, ...data }: any) => {
      const prospect = await apiFetch(`/prospects/${id}`, { method: "PATCH", body: JSON.stringify(data) });

      if (rdvStartDate && rdvEndDate && data.assignedTo) {
        await apiFetch("/prospect-calendar/schedule", {
          method: "POST",
          body: JSON.stringify({
            prospectId: id,
            prospectTitle: data.title || prospect?.title,
            assignedUserId: parseInt(data.assignedTo),
            startDate: rdvStartDate,
            endDate: rdvEndDate,
            syncGoogle: syncGoogle || false,
            contactName: data.contactName,
            contactEmail: data.email,
            contactPhone: data.phone,
            company: data.company,
          }),
        });
      }
      return prospect;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospects-pipeline"] });
      qc.invalidateQueries({ queryKey: ["prospects-list"] });
      qc.invalidateQueries({ queryKey: ["team-availability"] });
      toast({ title: "Prospect mis a jour" });
      setIsDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/prospects/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["prospects-pipeline"] }); qc.invalidateQueries({ queryKey: ["prospects-list"] }); toast({ title: "Prospect supprime" }); },
  });

  const moveStage = useCallback((id: number, stage: string) => {
    updateMutation.mutate({ id, stage });
  }, [updateMutation]);

  const openCreate = () => { setEditing(null); setForm({ title: "", stage: "nouveau", priority: "moyenne", probability: 50, value: "", assignedTo: "", syncGoogle: false }); setIsDialogOpen(true); };
  const openEdit = (p: any) => { setEditing(p); setForm({ ...p, value: p.value || "", assignedTo: p.assignedTo || "" }); setIsDialogOpen(true); };

  const handleSave = () => {
    const data = { ...form, value: form.value ? Number(form.value) : null, probability: Number(form.probability) || 50 };
    if (editing) updateMutation.mutate({ id: editing.id, ...data });
    else createMutation.mutate(data);
  };

  const stats = pipelineData?.stats;

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={Target} variant="blue" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Pipeline Commercial</h1>
            <p className="text-muted-foreground text-sm">Gerez vos prospects et opportunites</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {calendarSources && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Calendar className="h-3 w-3" />
              {calendarSources.totalSources} calendrier{calendarSources.totalSources !== 1 ? "s" : ""} synchronise{calendarSources.totalSources !== 1 ? "s" : ""}
            </Badge>
          )}
          <div className="flex border rounded-lg">
            <Button variant={viewMode === "kanban" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("kanban")}><Columns3 className="h-4 w-4 mr-1" /> Kanban</Button>
            <Button variant={viewMode === "list" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("list")}><LayoutList className="h-4 w-4 mr-1" /> Liste</Button>
          </div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nouveau Prospect</Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Users2 className="h-5 w-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{stats.totalCount}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Pipeline</p><p className="text-xl font-bold">{euro(stats.totalValue)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-indigo-500" /><div><p className="text-xs text-muted-foreground">Gagne</p><p className="text-xl font-bold">{euro(stats.wonValue)}</p></div></div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Percent className="h-5 w-5 text-amber-500" /><div><p className="text-xs text-muted-foreground">Prob. moy.</p><p className="text-xl font-bold">{stats.avgProbability}%</p></div></div></CardContent></Card>
        </div>
      )}

      {teamData?.team && teamData.team.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-indigo-500" /> Disponibilite de l'equipe aujourd'hui</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {teamData.team.map((member: any) => (
                <div key={member.userId} className="flex-shrink-0 border rounded-lg p-2 min-w-[140px]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-2 h-2 rounded-full ${member.freeSlots > 6 ? "bg-green-500" : member.freeSlots > 2 ? "bg-amber-500" : "bg-red-500"}`} />
                    <span className="text-xs font-medium truncate">{member.userName}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>{member.freeSlots} creneaux libres</span>
                    {member.hasGoogleSync && <RefreshCw className="h-2.5 w-2.5 text-blue-500" />}
                  </div>
                  {member.nextAvailable && (
                    <p className="text-[10px] text-green-600 mt-0.5">
                      Proch. : {new Date(member.nextAvailable).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === "list" && (
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-7 gap-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : viewMode === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {pipelineData?.stages?.map((stage: any) => (
            <div key={stage.id} className="min-w-[260px] w-[260px] flex-shrink-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-3 h-3 rounded-full ${STAGE_COLORS[stage.id]}`} />
                <span className="font-semibold text-sm">{stage.label}</span>
                <Badge variant="secondary" className="ml-auto text-xs">{pipelineData.pipeline[stage.id]?.length || 0}</Badge>
              </div>
              <div className="space-y-2 min-h-[200px] bg-muted/30 rounded-lg p-2">
                {pipelineData.pipeline[stage.id]?.map((p: any) => (
                  <Card key={p.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openEdit(p)}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <h3 className="font-medium text-sm leading-tight">{p.title}</h3>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm" className="h-6 w-6 p-0"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(p); }}><Edit className="h-3 w-3 mr-2" /> Modifier</DropdownMenuItem>
                            {stage.id !== "gagne" && <DropdownMenuItem onClick={e => { e.stopPropagation(); moveStage(p.id, "gagne"); }}><ArrowRight className="h-3 w-3 mr-2" /> Marquer gagne</DropdownMenuItem>}
                            <DropdownMenuItem className="text-red-600" onClick={e => { e.stopPropagation(); deleteMutation.mutate(p.id); }}><Trash2 className="h-3 w-3 mr-2" /> Supprimer</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {p.company && <p className="text-xs text-muted-foreground">{p.company}</p>}
                      {p.contactName && <p className="text-xs text-muted-foreground">{p.contactName}</p>}
                      {p.assignedTo && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-indigo-500" />
                          <span className="text-[10px] text-indigo-600">{teamMembers.find((m: any) => String(m.id) === String(p.assignedTo))?.prenom || p.assignedTo}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        {p.value && <span className="text-xs font-semibold text-emerald-600">{euro(p.value)}</span>}
                        <Badge variant={PRIORITY_COLORS[p.priority] as any} className="text-[10px]">{p.priority}</Badge>
                      </div>
                      {p.probability != null && (
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${p.probability}%` }} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Titre</th>
                  <th className="text-left p-3 font-medium">Societe</th>
                  <th className="text-left p-3 font-medium">Assigne</th>
                  <th className="text-left p-3 font-medium">Etape</th>
                  <th className="text-left p-3 font-medium">Valeur</th>
                  <th className="text-left p-3 font-medium">Prob.</th>
                  <th className="text-left p-3 font-medium">Priorite</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {(listData?.prospects || []).map((p: any) => (
                    <tr key={p.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => openEdit(p)}>
                      <td className="p-3 font-medium">{p.title}</td>
                      <td className="p-3 text-muted-foreground">{p.company || "-"}</td>
                      <td className="p-3 text-muted-foreground">
                        {p.assignedTo ? (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 text-indigo-500" />
                            {teamMembers.find((m: any) => String(m.id) === String(p.assignedTo))?.prenom || p.assignedTo}
                          </span>
                        ) : "-"}
                      </td>
                      <td className="p-3"><Badge className={`${STAGE_COLORS[p.stage]} text-white text-xs`}>{STAGE_LABELS[p.stage]}</Badge></td>
                      <td className="p-3">{p.value ? euro(p.value) : "-"}</td>
                      <td className="p-3">{p.probability}%</td>
                      <td className="p-3"><Badge variant={PRIORITY_COLORS[p.priority] as any}>{p.priority}</Badge></td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}><Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); openEdit(p); }}><Edit className="h-3 w-3 mr-2" /> Modifier</DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={e => { e.stopPropagation(); deleteMutation.mutate(p.id); }}><Trash2 className="h-3 w-3 mr-2" /> Supprimer</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!listData?.prospects || listData.prospects.length === 0) && (
                <div className="text-center py-12 text-muted-foreground">Aucun prospect pour le moment</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le prospect" : "Nouveau prospect"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Titre *</Label><Input value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Societe</Label><Input value={form.company || ""} onChange={e => setForm({ ...form, company: e.target.value })} /></div>
              <div><Label>Contact</Label><Input value={form.contactName || ""} onChange={e => setForm({ ...form, contactName: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Telephone</Label><Input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Etape</Label>
                <Select value={form.stage || "nouveau"} onValueChange={v => setForm({ ...form, stage: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STAGE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Priorite</Label>
                <Select value={form.priority || "moyenne"} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="haute">Haute</SelectItem><SelectItem value="moyenne">Moyenne</SelectItem><SelectItem value="basse">Basse</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Source</Label><Input value={form.source || ""} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="Web, Salon..." /></div>
            </div>

            <div>
              <Label>Assigne a</Label>
              <Select value={form.assignedTo || ""} onValueChange={v => setForm({ ...form, assignedTo: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selectionner un commercial" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((m: any) => {
                    const avail = teamData?.team?.find((t: any) => t.userId === m.id);
                    return (
                      <SelectItem key={m.id} value={String(m.id)}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${avail && avail.freeSlots > 6 ? "bg-green-500" : avail && avail.freeSlots > 2 ? "bg-amber-500" : "bg-red-500"}`} />
                          <span>{m.prenom} {m.nom}</span>
                          <span className="text-muted-foreground text-xs">({m.role})</span>
                          {m.hasGoogleSync && <RefreshCw className="h-3 w-3 text-blue-400" />}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valeur (EUR)</Label><Input type="number" value={form.value || ""} onChange={e => setForm({ ...form, value: e.target.value })} /></div>
              <div><Label>Probabilite (%)</Label><Input type="number" min={0} max={100} value={form.probability || 50} onChange={e => setForm({ ...form, probability: e.target.value })} /></div>
            </div>
            <div><Label>Date de cloture prevue</Label><Input type="date" value={form.expectedCloseDate ? form.expectedCloseDate.slice(0, 10) : ""} onChange={e => setForm({ ...form, expectedCloseDate: e.target.value })} /></div>

            <ScheduleSection form={form} setForm={setForm} teamMembers={teamMembers} />

            <div><Label>Notes</Label><Textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={!form.title}>
              {form.rdvStartDate && <CalendarPlus className="h-4 w-4 mr-1" />}
              {editing ? "Enregistrer" : form.rdvStartDate ? "Creer + Planifier RDV" : "Creer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
