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
import { useListProspects, useCreateProspect, useUpdateProspect, useDeleteProspect } from "@workspace/api-client-react";
import { UserPlus, Search, Plus, Trash2, Edit, Phone, Mail, Building, MapPin, Eye } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

const SOURCES = [
  { value: "direct", label: "Direct" },
  { value: "site_web", label: "Site web" },
  { value: "recommandation", label: "Recommandation" },
  { value: "salon", label: "Salon professionnel" },
  { value: "publicite", label: "Publicite" },
  { value: "reseaux_sociaux", label: "Reseaux sociaux" },
  { value: "autre", label: "Autre" },
];

export default function ProspectsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProspect, setEditingProspect] = useState<any>(null);

  const [formData, setFormData] = useState({
    prenom: "", nom: "", societe: "", email: "", telephone: "", mobile: "",
    adresse: "", ville: "", codePostal: "", source: "direct", notes: "",
  });

  const { data, isLoading } = useListProspects(
    { statut: statutFilter !== "all" ? statutFilter : undefined, search: search || undefined, limit: 100 },
    { query: { queryKey: ["prospects", statutFilter, search] } }
  );
  const createMutation = useCreateProspect();
  const updateMutation = useUpdateProspect();
  const deleteMutation = useDeleteProspect();

  const resetForm = () => {
    setFormData({ prenom: "", nom: "", societe: "", email: "", telephone: "", mobile: "", adresse: "", ville: "", codePostal: "", source: "direct", notes: "" });
    setEditingProspect(null);
  };

  const handleSave = async () => {
    if (!formData.prenom || !formData.nom || !formData.telephone) {
      toast({ title: "Erreur", description: "Prenom, nom et telephone sont obligatoires.", variant: "destructive" });
      return;
    }
    try {
      if (editingProspect) {
        await updateMutation.mutateAsync({ id: editingProspect.id, data: formData });
        toast({ title: "Prospect mis a jour" });
      } else {
        await createMutation.mutateAsync({ data: formData });
        toast({ title: "Prospect cree" });
      }
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      setIsCreateOpen(false);
      resetForm();
    } catch {
      toast({ title: "Erreur", description: "Impossible de sauvegarder.", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      toast({ title: "Prospect supprime" });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const openEdit = (p: any) => {
    setFormData({
      prenom: p.prenom, nom: p.nom, societe: p.societe || "", email: p.email || "",
      telephone: p.telephone, mobile: p.mobile || "", adresse: p.adresse || "",
      ville: p.ville || "", codePostal: p.codePostal || "", source: p.source, notes: p.notes || "",
    });
    setEditingProspect(p);
    setIsCreateOpen(true);
  };

  const prospects = data?.prospects || [];
  const totalProspects = prospects.filter(p => p.statut === "prospect").length;
  const totalClients = prospects.filter(p => p.statut === "client").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={UserPlus} variant="indigo" size="md" /> Prospects
          </h1>
          <p className="text-muted-foreground mt-1">Gestion des prospects et clients potentiels.</p>
        </div>
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" /> Nouveau prospect
        </Button>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-32 md:h-40">
          <img src={officeTeamImg} alt="Gestion des prospects" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/80 via-indigo-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center p-6">
            <div className="text-white">
              <h2 className="text-xl font-bold">Pipeline commercial</h2>
              <p className="text-white/80 text-sm mt-1">Suivez vos prospects et convertissez-les en clients.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">Total</div>
            <div className="text-2xl font-bold mt-1">{data?.total ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-amber-600 dark:text-amber-400 font-medium">Prospects</div>
            <div className="text-2xl font-bold mt-1">{totalProspects}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Clients</div>
            <div className="text-2xl font-bold mt-1">{totalClients}</div>
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
            <Select value={statutFilter} onValueChange={setStatutFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="prospect">Prospects</SelectItem>
                <SelectItem value="client">Clients</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Chargement...</div>
          ) : prospects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Aucun prospect trouve.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Nom</th>
                    <th className="text-left py-3 px-2 font-medium hidden md:table-cell">Societe</th>
                    <th className="text-left py-3 px-2 font-medium hidden md:table-cell">Telephone</th>
                    <th className="text-left py-3 px-2 font-medium hidden lg:table-cell">Email</th>
                    <th className="text-left py-3 px-2 font-medium">Statut</th>
                    <th className="text-left py-3 px-2 font-medium hidden lg:table-cell">Source</th>
                    <th className="text-left py-3 px-2 font-medium hidden lg:table-cell">Date</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map(p => (
                    <tr key={p.id} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-2 font-medium">{p.prenom} {p.nom}</td>
                      <td className="py-3 px-2 hidden md:table-cell text-muted-foreground">{p.societe || "-"}</td>
                      <td className="py-3 px-2 hidden md:table-cell">{p.telephone}</td>
                      <td className="py-3 px-2 hidden lg:table-cell text-muted-foreground">{p.email || "-"}</td>
                      <td className="py-3 px-2">
                        <Badge variant={p.statut === "client" ? "default" : "secondary"}>
                          {p.statut === "client" ? "Client" : "Prospect"}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 hidden lg:table-cell text-muted-foreground capitalize">{p.source.replace(/_/g, " ")}</td>
                      <td className="py-3 px-2 hidden lg:table-cell text-muted-foreground">
                        {format(new Date(p.createdAt), "dd/MM/yyyy", { locale: fr })}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/devis?prospectId=${p.id}`}>
                            <Button variant="ghost" size="icon" title="Creer un devis"><Eye className="w-4 h-4" /></Button>
                          </Link>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Modifier"><Edit className="w-4 h-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)} title="Supprimer"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={v => { if (!v) resetForm(); setIsCreateOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProspect ? "Modifier le prospect" : "Nouveau prospect"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Prenom *</Label><Input value={formData.prenom} onChange={e => setFormData(f => ({ ...f, prenom: e.target.value }))} /></div>
              <div><Label>Nom *</Label><Input value={formData.nom} onChange={e => setFormData(f => ({ ...f, nom: e.target.value }))} /></div>
            </div>
            <div><Label>Societe</Label><Input value={formData.societe} onChange={e => setFormData(f => ({ ...f, societe: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Telephone *</Label><Input value={formData.telephone} onChange={e => setFormData(f => ({ ...f, telephone: e.target.value }))} /></div>
              <div><Label>Mobile</Label><Input value={formData.mobile} onChange={e => setFormData(f => ({ ...f, mobile: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Email</Label><Input type="email" value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))} /></div>
              <div>
                <Label>Source</Label>
                <Select value={formData.source} onValueChange={v => setFormData(f => ({ ...f, source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Adresse</Label><Input value={formData.adresse} onChange={e => setFormData(f => ({ ...f, adresse: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Ville</Label><Input value={formData.ville} onChange={e => setFormData(f => ({ ...f, ville: e.target.value }))} /></div>
              <div><Label>Code postal</Label><Input value={formData.codePostal} onChange={e => setFormData(f => ({ ...f, codePostal: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>Annuler</Button>
            <Button onClick={handleSave}>{editingProspect ? "Mettre a jour" : "Creer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
