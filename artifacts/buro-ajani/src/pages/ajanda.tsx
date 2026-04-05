import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Icon3D } from "@/components/icon-3d";
import officeTeamImg from "@/assets/images/office-team.png";
import { useListRendezVous, useCreateRendezVous, useUpdateRendezVous, useDeleteRendezVous, useListProspects } from "@workspace/api-client-react";
import { CalendarDays, Search, Plus, Trash2, Edit, Phone, MapPin, Clock, CheckCircle, X } from "lucide-react";
import { format, isToday, isTomorrow, isPast, addHours } from "date-fns";
import { fr } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  rdv: { label: "Rendez-vous", color: "bg-blue-100 text-blue-700" },
  appel: { label: "Appel", color: "bg-emerald-100 text-emerald-700" },
  visite: { label: "Visite", color: "bg-purple-100 text-purple-700" },
  reunion: { label: "Reunion", color: "bg-amber-100 text-amber-700" },
};

const STATUT_CONFIG: Record<string, { label: string; variant: string }> = {
  planifie: { label: "Planifie", variant: "secondary" },
  confirme: { label: "Confirme", variant: "default" },
  annule: { label: "Annule", variant: "destructive" },
  termine: { label: "Termine", variant: "outline" },
};

export default function AjandaPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const now = new Date();
  const [formData, setFormData] = useState({
    titre: "", description: "", prospectId: 0, contactNom: "", telephone: "",
    type: "rdv", dateDebut: "", dateFin: "", lieu: "", rappel: "30min", notes: "",
  });

  const { data, isLoading } = useListRendezVous(
    {
      type: typeFilter !== "all" ? typeFilter as any : undefined,
      search: search || undefined, limit: 200, sortBy: "dateDebut", sortOrder: "asc",
    },
    { query: { queryKey: ["rendezVous", typeFilter, search] } }
  );
  const { data: prospectsData } = useListProspects({ limit: 200 }, { query: { queryKey: ["prospects-for-rdv"] } });
  const createMutation = useCreateRendezVous();
  const updateMutation = useUpdateRendezVous();
  const deleteMutation = useDeleteRendezVous();

  const resetForm = () => {
    setFormData({
      titre: "", description: "", prospectId: 0, contactNom: "", telephone: "",
      type: "rdv", dateDebut: "", dateFin: "", lieu: "", rappel: "30min", notes: "",
    });
  };

  const handleCreate = async () => {
    if (!formData.titre || !formData.dateDebut || !formData.dateFin) {
      toast({ title: "Erreur", description: "Titre et dates sont obligatoires.", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: {
          ...formData,
          prospectId: formData.prospectId || undefined,
          type: formData.type as any,
        },
      });
      toast({ title: "Rendez-vous cree" });
      queryClient.invalidateQueries({ queryKey: ["rendezVous"] });
      setIsCreateOpen(false);
      resetForm();
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const handleTerminer = async (id: number) => {
    try {
      await updateMutation.mutateAsync({ id, data: { statut: "termine" } });
      toast({ title: "Rendez-vous termine" });
      queryClient.invalidateQueries({ queryKey: ["rendezVous"] });
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const handleAnnuler = async (id: number) => {
    try {
      await updateMutation.mutateAsync({ id, data: { statut: "annule" } });
      toast({ title: "Rendez-vous annule" });
      queryClient.invalidateQueries({ queryKey: ["rendezVous"] });
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Rendez-vous supprime" });
      queryClient.invalidateQueries({ queryKey: ["rendezVous"] });
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const rdvs = data?.rendezVous || [];
  const todayRdvs = rdvs.filter(r => isToday(new Date(r.dateDebut)) && r.statut !== "annule");
  const upcomingRdvs = rdvs.filter(r => !isPast(new Date(r.dateDebut)) && r.statut !== "annule" && r.statut !== "termine");

  const getDateLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return "Aujourd'hui";
    if (isTomorrow(d)) return "Demain";
    return format(d, "EEEE d MMMM", { locale: fr });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={CalendarDays} variant="purple" size="md" /> Ajanda
          </h1>
          <p className="text-muted-foreground mt-1">Rendez-vous, appels et reunions planifies.</p>
        </div>
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" /> Nouveau rendez-vous
        </Button>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-32 md:h-40">
          <img src={officeTeamImg} alt="Ajanda" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-purple-900/80 via-purple-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center p-6">
            <div className="text-white">
              <h2 className="text-xl font-bold">Votre agenda</h2>
              <p className="text-white/80 text-sm mt-1">{todayRdvs.length} rendez-vous aujourd'hui, {upcomingRdvs.length} a venir.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">Aujourd'hui</div>
            <div className="text-2xl font-bold mt-1">{todayRdvs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-purple-600 dark:text-purple-400 font-medium">A venir</div>
            <div className="text-2xl font-bold mt-1">{upcomingRdvs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Termines</div>
            <div className="text-2xl font-bold mt-1">{rdvs.filter(r => r.statut === "termine").length}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-amber-600 dark:text-amber-400 font-medium">Total</div>
            <div className="text-2xl font-bold mt-1">{data?.total ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous types</SelectItem>
                <SelectItem value="rdv">Rendez-vous</SelectItem>
                <SelectItem value="appel">Appel</SelectItem>
                <SelectItem value="visite">Visite</SelectItem>
                <SelectItem value="reunion">Reunion</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Chargement...</div>
          ) : rdvs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Aucun rendez-vous trouve.</div>
          ) : (
            <div className="space-y-3">
              {rdvs.map(r => {
                const typeCfg = TYPE_CONFIG[r.type] || TYPE_CONFIG.rdv;
                const statutCfg = STATUT_CONFIG[r.statut] || STATUT_CONFIG.planifie;
                const isExpired = isPast(new Date(r.dateFin)) && r.statut === "planifie";
                return (
                  <div key={r.id} className={`flex items-center gap-4 p-4 rounded-lg border transition-colors hover:bg-muted/50 ${isExpired ? "border-red-200 bg-red-50/50" : ""}`}>
                    <div className="hidden sm:flex flex-col items-center min-w-[60px]">
                      <div className="text-xs text-muted-foreground">{format(new Date(r.dateDebut), "EEE", { locale: fr })}</div>
                      <div className="text-lg font-bold">{format(new Date(r.dateDebut), "dd")}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(r.dateDebut), "MMM", { locale: fr })}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium">{r.titre}</h3>
                        <Badge className={typeCfg.color}>{typeCfg.label}</Badge>
                        <Badge variant={statutCfg.variant as any}>{statutCfg.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(r.dateDebut), "HH:mm")} - {format(new Date(r.dateFin), "HH:mm")}</span>
                        {r.contactNom && <span>{r.contactNom}</span>}
                        {r.prospectNom && <span>{r.prospectPrenom} {r.prospectNom}</span>}
                        {r.lieu && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.lieu}</span>}
                        {r.telephone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.telephone}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {(r.statut === "planifie" || r.statut === "confirme") && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => handleTerminer(r.id)} title="Terminer"><CheckCircle className="w-4 h-4 text-emerald-500" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleAnnuler(r.id)} title="Annuler"><X className="w-4 h-4 text-amber-500" /></Button>
                        </>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)} title="Supprimer"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={v => { if (!v) resetForm(); setIsCreateOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouveau rendez-vous</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Titre *</Label><Input value={formData.titre} onChange={e => setFormData(f => ({ ...f, titre: e.target.value }))} placeholder="Ex: Visite chantier Dupont" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={formData.type} onValueChange={v => setFormData(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rdv">Rendez-vous</SelectItem>
                    <SelectItem value="appel">Appel</SelectItem>
                    <SelectItem value="visite">Visite</SelectItem>
                    <SelectItem value="reunion">Reunion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Prospect/Client</Label>
                <Select value={formData.prospectId ? String(formData.prospectId) : "none"} onValueChange={v => setFormData(f => ({ ...f, prospectId: v === "none" ? 0 : Number(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Optionnel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
                    {(prospectsData?.prospects || []).map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.prenom} {p.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Date/heure debut *</Label><Input type="datetime-local" value={formData.dateDebut} onChange={e => setFormData(f => ({ ...f, dateDebut: e.target.value }))} /></div>
              <div><Label>Date/heure fin *</Label><Input type="datetime-local" value={formData.dateFin} onChange={e => setFormData(f => ({ ...f, dateFin: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Contact</Label><Input value={formData.contactNom} onChange={e => setFormData(f => ({ ...f, contactNom: e.target.value }))} placeholder="Nom du contact" /></div>
              <div><Label>Telephone</Label><Input value={formData.telephone} onChange={e => setFormData(f => ({ ...f, telephone: e.target.value }))} /></div>
            </div>
            <div><Label>Lieu</Label><Input value={formData.lieu} onChange={e => setFormData(f => ({ ...f, lieu: e.target.value }))} placeholder="Adresse ou lieu" /></div>
            <div>
              <Label>Rappel</Label>
              <Select value={formData.rappel} onValueChange={v => setFormData(f => ({ ...f, rappel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="15min">15 minutes avant</SelectItem>
                  <SelectItem value="30min">30 minutes avant</SelectItem>
                  <SelectItem value="1h">1 heure avant</SelectItem>
                  <SelectItem value="2h">2 heures avant</SelectItem>
                  <SelectItem value="1j">1 jour avant</SelectItem>
                  <SelectItem value="aucun">Aucun rappel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
            <div><Label>Notes</Label><Textarea value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>Annuler</Button>
            <Button onClick={handleCreate}>Creer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
