import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { useListChantiers, useUpdateChantier, useDeleteChantier } from "@workspace/api-client-react";
import { HardHat, Search, Trash2, Edit, Play, Pause, CheckCircle, Plus, MapPin } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

const STATUT_CONFIG: Record<string, { label: string; variant: string; color: string }> = {
  planifie: { label: "Planifie", variant: "secondary", color: "bg-slate-100 text-slate-700" },
  en_cours: { label: "En cours", variant: "default", color: "bg-blue-100 text-blue-700" },
  en_pause: { label: "En pause", variant: "outline", color: "bg-amber-100 text-amber-700" },
  termine: { label: "Termine", variant: "default", color: "bg-emerald-100 text-emerald-700" },
  annule: { label: "Annule", variant: "destructive", color: "bg-red-100 text-red-700" },
};

const METIER_LABELS: Record<string, string> = {
  electricite: "Electricite", plomberie: "Plomberie", maconnerie: "Maconnerie",
  peinture: "Peinture", menuiserie: "Menuiserie", carrelage: "Carrelage",
  chauffage: "Chauffage", toiture: "Toiture", isolation: "Isolation",
  climatisation: "Climatisation", serrurerie: "Serrurerie", vitrerie: "Vitrerie",
  demolition: "Demolition", terrassement: "Terrassement", charpente: "Charpente",
  platrerie: "Platrerie", revetement_sol: "Revetement de sol", facade: "Facade",
  etancheite: "Etancheite", general: "General",
};

export default function ChantiersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState("all");
  const [metierFilter, setMetierFilter] = useState("all");
  const [editingChantier, setEditingChantier] = useState<any>(null);

  const { data, isLoading } = useListChantiers(
    {
      statut: statutFilter !== "all" ? statutFilter as any : undefined,
      metier: metierFilter !== "all" ? metierFilter : undefined,
      search: search || undefined, limit: 100,
    },
    { query: { queryKey: ["chantiers", statutFilter, metierFilter, search] } }
  );
  const updateMutation = useUpdateChantier();
  const deleteMutation = useDeleteChantier();

  const handleStatutChange = async (id: number, statut: string) => {
    try {
      await updateMutation.mutateAsync({ id, data: { statut } as any });
      toast({ title: `Chantier ${STATUT_CONFIG[statut]?.label?.toLowerCase() || statut}` });
      queryClient.invalidateQueries({ queryKey: ["chantiers"] });
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Chantier supprime" });
      queryClient.invalidateQueries({ queryKey: ["chantiers"] });
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
  };

  const chantiers = data?.chantiers || [];
  const enCours = chantiers.filter(c => c.statut === "en_cours").length;
  const planifies = chantiers.filter(c => c.statut === "planifie").length;
  const termines = chantiers.filter(c => c.statut === "termine").length;

  const uniqueMetiers = [...new Set(chantiers.map(c => c.metier))].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Icon3D icon={HardHat} variant="orange" size="md" /> Chantiers
        </h1>
        <p className="text-muted-foreground mt-1">Suivi des chantiers par metier et statut.</p>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-32 md:h-40">
          <img src={officeTeamImg} alt="Chantiers" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-orange-900/80 via-orange-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center p-6">
            <div className="text-white">
              <h2 className="text-xl font-bold">Gestion des chantiers</h2>
              <p className="text-white/80 text-sm mt-1">Suivez l'avancement de vos chantiers par corps de metier.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">Total</div>
            <div className="text-2xl font-bold mt-1">{data?.total ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-amber-600 dark:text-amber-400 font-medium">En cours</div>
            <div className="text-2xl font-bold mt-1">{enCours}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/30 dark:to-slate-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-slate-600 dark:text-slate-400 font-medium">Planifies</div>
            <div className="text-2xl font-bold mt-1">{planifies}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Termines</div>
            <div className="text-2xl font-bold mt-1">{termines}</div>
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
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="planifie">Planifie</SelectItem>
                <SelectItem value="en_cours">En cours</SelectItem>
                <SelectItem value="en_pause">En pause</SelectItem>
                <SelectItem value="termine">Termine</SelectItem>
                <SelectItem value="annule">Annule</SelectItem>
              </SelectContent>
            </Select>
            <Select value={metierFilter} onValueChange={setMetierFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous metiers</SelectItem>
                {uniqueMetiers.map(m => (
                  <SelectItem key={m} value={m}>{METIER_LABELS[m] || m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Chargement...</div>
          ) : chantiers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Aucun chantier trouve.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {chantiers.map(c => {
                const cfg = STATUT_CONFIG[c.statut] || STATUT_CONFIG.planifie;
                return (
                  <Card key={c.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold truncate">{c.nom}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {c.prospectPrenom} {c.prospectNom}{c.prospectSociete ? ` - ${c.prospectSociete}` : ""}
                          </p>
                        </div>
                        <Badge className={cfg.color}>{cfg.label}</Badge>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="capitalize">{METIER_LABELS[c.metier] || c.metier}</Badge>
                        {c.devisNumero && <Badge variant="secondary" className="font-mono text-xs">{c.devisNumero}</Badge>}
                      </div>

                      {c.adresse && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="truncate">{c.adresse}</span>
                        </div>
                      )}

                      {c.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>
                      )}

                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(c.createdAt), "dd/MM/yyyy", { locale: fr })}
                        </div>
                        <div className="flex items-center gap-1">
                          {c.statut === "planifie" && (
                            <Button variant="ghost" size="icon" onClick={() => handleStatutChange(c.id, "en_cours")} title="Demarrer">
                              <Play className="w-4 h-4 text-blue-500" />
                            </Button>
                          )}
                          {c.statut === "en_cours" && (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => handleStatutChange(c.id, "en_pause")} title="Pause">
                                <Pause className="w-4 h-4 text-amber-500" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleStatutChange(c.id, "termine")} title="Terminer">
                                <CheckCircle className="w-4 h-4 text-emerald-500" />
                              </Button>
                            </>
                          )}
                          {c.statut === "en_pause" && (
                            <Button variant="ghost" size="icon" onClick={() => handleStatutChange(c.id, "en_cours")} title="Reprendre">
                              <Play className="w-4 h-4 text-blue-500" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)} title="Supprimer">
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
