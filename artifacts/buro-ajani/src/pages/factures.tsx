import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Icon3D } from "@/components/icon-3d";
import analyticsImg from "@/assets/images/analytics-work.png";
import { useListFactures, useUpdateFacture, useDeleteFacture } from "@workspace/api-client-react";
import { Receipt, Search, Trash2, CreditCard, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

const STATUT_CONFIG: Record<string, { label: string; variant: string; icon: typeof Clock }> = {
  en_attente: { label: "En attente", variant: "secondary", icon: Clock },
  payee: { label: "Payee", variant: "default", icon: CheckCircle },
  en_retard: { label: "En retard", variant: "destructive", icon: AlertTriangle },
  annulee: { label: "Annulee", variant: "outline", icon: AlertTriangle },
};

const TYPE_LABELS: Record<string, string> = {
  acompte: "Acompte",
  intermediaire: "Intermediaire",
  finale: "Finale",
  avoir: "Avoir",
};

export default function FacturesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data, isLoading } = useListFactures(
    {
      statut: statutFilter !== "all" ? statutFilter as any : undefined,
      type: typeFilter !== "all" ? typeFilter as any : undefined,
      search: search || undefined,
      limit: 100,
    },
    { query: { queryKey: ["factures", statutFilter, typeFilter, search] } }
  );
  const updateMutation = useUpdateFacture();
  const deleteMutation = useDeleteFacture();

  const handleMarquerPayee = async (id: number) => {
    try {
      await updateMutation.mutateAsync({ id, data: { statut: "payee" } });
      toast({ title: "Facture marquee comme payee" });
      queryClient.invalidateQueries({ queryKey: ["factures"] });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Facture supprimee" });
      queryClient.invalidateQueries({ queryKey: ["factures"] });
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const factures = data?.factures || [];
  const totalMontant = factures.reduce((s, f) => s + Number(f.montantTtc), 0);
  const totalPaye = factures.filter(f => f.statut === "payee").reduce((s, f) => s + Number(f.montantTtc), 0);
  const totalEnAttente = factures.filter(f => f.statut === "en_attente").reduce((s, f) => s + Number(f.montantTtc), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Icon3D icon={Receipt} variant="emerald" size="md" /> Factures
        </h1>
        <p className="text-muted-foreground mt-1">Suivi des factures et paiements.</p>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-32 md:h-40">
          <img src={analyticsImg} alt="Factures" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/80 via-emerald-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center p-6">
            <div className="text-white">
              <h2 className="text-xl font-bold">Facturation</h2>
              <p className="text-white/80 text-sm mt-1">Gerez vos factures d'acompte, intermediaires et finales.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">Total factures</div>
            <div className="text-2xl font-bold mt-1">{data?.total ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Total encaisse</div>
            <div className="text-2xl font-bold mt-1">{totalPaye.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-amber-600 dark:text-amber-400 font-medium">En attente</div>
            <div className="text-2xl font-bold mt-1">{totalEnAttente.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/10">
          <CardContent className="p-4">
            <div className="text-sm text-purple-600 dark:text-purple-400 font-medium">Montant total</div>
            <div className="text-2xl font-bold mt-1">{totalMontant.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</div>
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
                <SelectItem value="en_attente">En attente</SelectItem>
                <SelectItem value="payee">Payee</SelectItem>
                <SelectItem value="en_retard">En retard</SelectItem>
                <SelectItem value="annulee">Annulee</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous types</SelectItem>
                <SelectItem value="acompte">Acompte</SelectItem>
                <SelectItem value="intermediaire">Intermediaire</SelectItem>
                <SelectItem value="finale">Finale</SelectItem>
                <SelectItem value="avoir">Avoir</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Chargement...</div>
          ) : factures.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Aucune facture trouvee.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Numero</th>
                    <th className="text-left py-3 px-2 font-medium">Client</th>
                    <th className="text-left py-3 px-2 font-medium hidden md:table-cell">Type</th>
                    <th className="text-left py-3 px-2 font-medium hidden md:table-cell">Objet</th>
                    <th className="text-right py-3 px-2 font-medium">Montant TTC</th>
                    <th className="text-left py-3 px-2 font-medium">Statut</th>
                    <th className="text-left py-3 px-2 font-medium hidden lg:table-cell">Date</th>
                    <th className="text-right py-3 px-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map(f => {
                    const cfg = STATUT_CONFIG[f.statut] || STATUT_CONFIG.en_attente;
                    return (
                      <tr key={f.id} className="border-b hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-2 font-mono text-xs">{f.numero}</td>
                        <td className="py-3 px-2">{f.prospectPrenom} {f.prospectNom}{f.prospectSociete ? ` (${f.prospectSociete})` : ""}</td>
                        <td className="py-3 px-2 hidden md:table-cell">
                          <Badge variant="outline">{TYPE_LABELS[f.type] || f.type}</Badge>
                        </td>
                        <td className="py-3 px-2 hidden md:table-cell text-muted-foreground truncate max-w-[200px]">{f.objet}</td>
                        <td className="py-3 px-2 text-right font-medium">{Number(f.montantTtc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>
                        <td className="py-3 px-2">
                          <Badge variant={cfg.variant as any}>{cfg.label}</Badge>
                        </td>
                        <td className="py-3 px-2 hidden lg:table-cell text-muted-foreground">
                          {format(new Date(f.createdAt), "dd/MM/yyyy", { locale: fr })}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {f.statut === "en_attente" && (
                              <Button variant="ghost" size="icon" onClick={() => handleMarquerPayee(f.id)} title="Marquer payee">
                                <CreditCard className="w-4 h-4 text-emerald-500" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(f.id)} title="Supprimer">
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
