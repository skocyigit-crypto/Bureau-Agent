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
import { useListDevis, useCreateDevis, useUpdateDevis, useDeleteDevis, useListProspects } from "@workspace/api-client-react";
import { FileText, Search, Plus, Trash2, Edit, Check, Send, X, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

const METIERS = [
  "electricite", "plomberie", "maconnerie", "peinture", "menuiserie",
  "carrelage", "chauffage", "toiture", "isolation", "climatisation",
  "serrurerie", "vitrerie", "demolition", "terrassement", "charpente",
  "platrerie", "revetement_sol", "facade", "etancheite", "general",
];

const STATUT_COLORS: Record<string, string> = {
  brouillon: "secondary",
  envoye: "outline",
  accepte: "default",
  refuse: "destructive",
  expire: "secondary",
};

const STATUT_LABELS: Record<string, string> = {
  brouillon: "Brouillon",
  envoye: "Envoye",
  accepte: "Accepte",
  refuse: "Refuse",
  expire: "Expire",
};

interface LigneForm {
  description: string;
  metier: string;
  quantite: number;
  unite: string;
  prixUnitaire: number;
}

export default function DevisPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [formData, setFormData] = useState({
    prospectId: 0, objet: "", description: "", conditions: "", notes: "",
  });
  const [lignes, setLignes] = useState<LigneForm[]>([
    { description: "", metier: "general", quantite: 1, unite: "unite", prixUnitaire: 0 },
  ]);

  const { data, isLoading } = useListDevis(
    { statut: statutFilter !== "all" ? statutFilter as any : undefined, search: search || undefined, limit: 100 },
    { query: { queryKey: ["devis", statutFilter, search] } }
  );
  const { data: prospectsData } = useListProspects({ limit: 200 }, { query: { queryKey: ["prospects-for-devis"] } });
  const createMutation = useCreateDevis();
  const updateMutation = useUpdateDevis();
  const deleteMutation = useDeleteDevis();

  const resetForm = () => {
    setFormData({ prospectId: 0, objet: "", description: "", conditions: "", notes: "" });
    setLignes([{ description: "", metier: "general", quantite: 1, unite: "unite", prixUnitaire: 0 }]);
  };

  const addLigne = () => {
    setLignes(l => [...l, { description: "", metier: "general", quantite: 1, unite: "unite", prixUnitaire: 0 }]);
  };

  const removeLigne = (idx: number) => {
    setLignes(l => l.filter((_, i) => i !== idx));
  };

  const updateLigne = (idx: number, field: keyof LigneForm, value: any) => {
    setLignes(l => l.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const totalHt = lignes.reduce((sum, l) => sum + l.quantite * l.prixUnitaire, 0);
  const totalTtc = totalHt * 1.2;

  const handleCreate = async () => {
    if (!formData.prospectId || !formData.objet) {
      toast({ title: "Erreur", description: "Selectionnez un prospect et saisissez l'objet.", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: { ...formData, lignes: lignes.filter(l => l.description) },
      });
      toast({ title: "Devis cree" });
      queryClient.invalidateQueries({ queryKey: ["devis"] });
      setIsCreateOpen(false);
      resetForm();
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleAccepter = async (id: number) => {
    try {
      await updateMutation.mutateAsync({ id, data: { statut: "accepte" } });
      toast({ title: "Devis accepte", description: "Facture d'acompte et chantiers crees automatiquement." });
      queryClient.invalidateQueries({ queryKey: ["devis"] });
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      queryClient.invalidateQueries({ queryKey: ["factures"] });
      queryClient.invalidateQueries({ queryKey: ["chantiers"] });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleEnvoyer = async (id: number) => {
    try {
      await updateMutation.mutateAsync({ id, data: { statut: "envoye" } });
      toast({ title: "Devis envoye" });
      queryClient.invalidateQueries({ queryKey: ["devis"] });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["devis"] });
      toast({ title: "Devis supprime" });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const devisList = data?.devis || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={FileText} variant="amber" size="md" /> Devis
          </h1>
          <p className="text-muted-foreground mt-1">Gestion des devis et propositions commerciales.</p>
        </div>
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" /> Nouveau devis
        </Button>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-32 md:h-40">
          <img src={officeTeamImg} alt="Devis" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-amber-900/80 via-amber-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center p-6">
            <div className="text-white">
              <h2 className="text-xl font-bold">Propositions commerciales</h2>
              <p className="text-white/80 text-sm mt-1">Creez, envoyez et suivez vos devis.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {["brouillon", "envoye", "accepte", "refuse"].map(s => (
          <Card key={s} className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/30 dark:to-slate-900/10">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground font-medium capitalize">{STATUT_LABELS[s]}</div>
              <div className="text-2xl font-bold mt-1">{devisList.filter(d => d.statut === s).length}</div>
            </CardContent>
          </Card>
        ))}
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
                <SelectItem value="brouillon">Brouillon</SelectItem>
                <SelectItem value="envoye">Envoye</SelectItem>
                <SelectItem value="accepte">Accepte</SelectItem>
                <SelectItem value="refuse">Refuse</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Chargement...</div>
          ) : devisList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Aucun devis trouve.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Numero</th>
                    <th className="text-left py-3 px-2 font-medium">Prospect/Client</th>
                    <th className="text-left py-3 px-2 font-medium hidden md:table-cell">Objet</th>
                    <th className="text-right py-3 px-2 font-medium">Montant TTC</th>
                    <th className="text-left py-3 px-2 font-medium">Statut</th>
                    <th className="text-left py-3 px-2 font-medium hidden lg:table-cell">Date</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devisList.map(d => (
                    <tr key={d.id} className="border-b hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-2 font-mono text-xs">{d.numero}</td>
                      <td className="py-3 px-2">{d.prospectPrenom} {d.prospectNom}{d.prospectSociete ? ` (${d.prospectSociete})` : ""}</td>
                      <td className="py-3 px-2 hidden md:table-cell text-muted-foreground truncate max-w-[200px]">{d.objet}</td>
                      <td className="py-3 px-2 text-right font-medium">{Number(d.montantTtc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>
                      <td className="py-3 px-2">
                        <Badge variant={STATUT_COLORS[d.statut] as any}>{STATUT_LABELS[d.statut]}</Badge>
                      </td>
                      <td className="py-3 px-2 hidden lg:table-cell text-muted-foreground">
                        {format(new Date(d.createdAt), "dd/MM/yyyy", { locale: fr })}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {d.statut === "brouillon" && (
                            <Button variant="ghost" size="icon" onClick={() => handleEnvoyer(d.id)} title="Envoyer"><Send className="w-4 h-4 text-blue-500" /></Button>
                          )}
                          {(d.statut === "envoye" || d.statut === "brouillon") && (
                            <Button variant="ghost" size="icon" onClick={() => handleAccepter(d.id)} title="Accepter"><Check className="w-4 h-4 text-emerald-500" /></Button>
                          )}
                          {d.statut !== "accepte" && (
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)} title="Supprimer"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                          )}
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nouveau devis</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label>Prospect *</Label>
              <Select value={formData.prospectId ? String(formData.prospectId) : ""} onValueChange={v => setFormData(f => ({ ...f, prospectId: Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Selectionner un prospect" /></SelectTrigger>
                <SelectContent>
                  {(prospectsData?.prospects || []).map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.prenom} {p.nom}{p.societe ? ` - ${p.societe}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Objet *</Label><Input value={formData.objet} onChange={e => setFormData(f => ({ ...f, objet: e.target.value }))} placeholder="Ex: Renovation cuisine complète" /></div>
            <div><Label>Description</Label><Textarea value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))} rows={2} /></div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Lignes du devis</Label>
                <Button variant="outline" size="sm" onClick={addLigne}><Plus className="w-4 h-4 mr-1" /> Ajouter</Button>
              </div>
              {lignes.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded-lg p-3">
                  <div className="col-span-4">
                    <Label className="text-xs">Description</Label>
                    <Input value={l.description} onChange={e => updateLigne(i, "description", e.target.value)} placeholder="Travaux..." />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Metier</Label>
                    <Select value={l.metier} onValueChange={v => updateLigne(i, "metier", v)}>
                      <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {METIERS.map(m => <SelectItem key={m} value={m} className="capitalize">{m.replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1">
                    <Label className="text-xs">Qte</Label>
                    <Input type="number" value={l.quantite} onChange={e => updateLigne(i, "quantite", Number(e.target.value))} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unite</Label>
                    <Select value={l.unite} onValueChange={v => updateLigne(i, "unite", v)}>
                      <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unite">Unite</SelectItem>
                        <SelectItem value="m2">m2</SelectItem>
                        <SelectItem value="ml">ml</SelectItem>
                        <SelectItem value="forfait">Forfait</SelectItem>
                        <SelectItem value="heure">Heure</SelectItem>
                        <SelectItem value="jour">Jour</SelectItem>
                        <SelectItem value="lot">Lot</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Prix unit. EUR</Label>
                    <Input type="number" value={l.prixUnitaire} onChange={e => updateLigne(i, "prixUnitaire", Number(e.target.value))} />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {lignes.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeLigne(i)}><X className="w-4 h-4 text-destructive" /></Button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex justify-end gap-6 pt-2 text-sm font-medium">
                <span>Total HT: {totalHt.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</span>
                <span>TVA 20%</span>
                <span className="text-lg">TTC: {totalTtc.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</span>
              </div>
            </div>

            <div><Label>Conditions</Label><Textarea value={formData.conditions} onChange={e => setFormData(f => ({ ...f, conditions: e.target.value }))} rows={2} placeholder="Conditions de paiement, delais..." /></div>
            <div><Label>Notes</Label><Textarea value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); resetForm(); }}>Annuler</Button>
            <Button onClick={handleCreate}>Creer le devis</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
