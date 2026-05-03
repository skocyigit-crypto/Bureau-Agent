import { useState, useEffect, useCallback } from "react";
import { Search, Users, Mail, Phone, Building, FileText, Receipt, Euro, AlertCircle, ArrowRight, RefreshCw, ChevronLeft, Download, Printer, FolderKanban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function fmt(v: any) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v)) + " €";
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

interface Client {
  name: string; email?: string; phone?: string; address?: string; company?: string;
}

interface ClientDetail extends Client {
  stats: {
    devisCount: number; devisAcceptes: number; totalDevis: number;
    facturesCount: number; facturesPayees: number; totalFactures: number;
    totalPaid: number; totalDue: number; overdueCount: number; overdueAmount: number;
    projetsCount?: number; projetsActifs?: number;
  };
  devis: any[]; factures: any[]; projets?: any[];
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { toast } = useToast();

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/clients${search ? `?search=${encodeURIComponent(search)}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      setClients(await res.json());
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les clients.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadClients(); }, [loadClients]);

  async function openClient(name: string) {
    setSelected(name);
    setDetailLoading(true);
    try {
      const res = await fetch(`${BASE}/api/clients/${encodeURIComponent(name)}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger la fiche client.", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }

  if (selected) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setDetail(null); }}>
            <ChevronLeft className="w-4 h-4 mr-1" />Retour
          </Button>
          <h1 className="text-xl font-bold">{selected}</h1>
          {detail?.company && <Badge variant="secondary">{detail.company}</Badge>}
        </div>

        {detailLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="pt-5"><Skeleton className="h-16 w-full" /></CardContent></Card>)}
          </div>
        ) : detail ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="border-blue-200 dark:border-blue-900/30">
                <CardContent className="pt-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10"><FileText className="w-5 h-5 text-blue-500" /></div>
                    <div>
                      <p className="text-2xl font-bold">{detail.stats.devisCount}</p>
                      <p className="text-xs text-muted-foreground">Devis · {detail.stats.devisAcceptes} accepté{detail.stats.devisAcceptes !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-emerald-200 dark:border-emerald-900/30">
                <CardContent className="pt-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/10"><Receipt className="w-5 h-5 text-emerald-500" /></div>
                    <div>
                      <p className="text-2xl font-bold">{detail.stats.facturesCount}</p>
                      <p className="text-xs text-muted-foreground">Factures · {detail.stats.facturesPayees} payée{detail.stats.facturesPayees !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-violet-200 dark:border-violet-900/30">
                <CardContent className="pt-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-violet-500/10"><Euro className="w-5 h-5 text-violet-500" /></div>
                    <div>
                      <p className="text-xl font-bold">{fmt(detail.stats.totalFactures)}</p>
                      <p className="text-xs text-muted-foreground">Facturé total</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className={detail.stats.overdueCount > 0 ? "border-red-200 dark:border-red-900/30" : "border-slate-200"}>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${detail.stats.overdueCount > 0 ? "bg-red-500/10" : "bg-slate-500/10"}`}>
                      <AlertCircle className={`w-5 h-5 ${detail.stats.overdueCount > 0 ? "text-red-500" : "text-slate-400"}`} />
                    </div>
                    <div>
                      <p className={`text-xl font-bold ${detail.stats.overdueCount > 0 ? "text-red-600" : ""}`}>{fmt(detail.stats.totalDue)}</p>
                      <p className="text-xs text-muted-foreground">Restant dû{detail.stats.overdueCount > 0 ? ` · ${detail.stats.overdueCount} en retard` : ""}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {(detail.stats.projetsCount ?? 0) > 0 && (
                <Card className="border-indigo-200 dark:border-indigo-900/30">
                  <CardContent className="pt-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-indigo-500/10"><FolderKanban className="w-5 h-5 text-indigo-500" /></div>
                      <div>
                        <p className="text-2xl font-bold">{detail.stats.projetsCount}</p>
                        <p className="text-xs text-muted-foreground">Projet{(detail.stats.projetsCount ?? 0) > 1 ? "s" : ""} · {detail.stats.projetsActifs ?? 0} actif{(detail.stats.projetsActifs ?? 0) > 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 bg-muted/30 rounded-xl text-sm space-y-1.5">
                <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-2">Coordonnées</p>
                {detail.email && <p className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" />{detail.email}</p>}
                {detail.phone && <p className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" />{detail.phone}</p>}
                {detail.company && <p className="flex items-center gap-2"><Building className="w-4 h-4 text-muted-foreground" />{detail.company}</p>}
                {detail.address && <p className="flex items-center gap-2 text-muted-foreground">{detail.address}</p>}
                {!detail.email && !detail.phone && !detail.company && !detail.address && <p className="text-muted-foreground">Aucune coordonnée enregistrée</p>}
              </div>
              <div className="p-4 bg-muted/30 rounded-xl text-sm">
                <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-2">Résumé commercial</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span>CA total devis</span><span className="font-medium">{fmt(detail.stats.totalDevis)}</span></div>
                  <div className="flex justify-between"><span>CA total facturé</span><span className="font-medium">{fmt(detail.stats.totalFactures)}</span></div>
                  <div className="flex justify-between"><span>Total encaissé</span><span className="font-medium text-emerald-600">{fmt(detail.stats.totalPaid)}</span></div>
                  <div className="flex justify-between border-t pt-1.5 mt-1"><span>Solde restant</span><span className={`font-bold ${detail.stats.totalDue > 0 ? "text-red-600" : "text-emerald-600"}`}>{fmt(detail.stats.totalDue)}</span></div>
                </div>
              </div>
            </div>

            {detail.devis.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />Devis ({detail.devis.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Référence</TableHead><TableHead>Titre</TableHead><TableHead>Date</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.devis.slice(0, 5).map(d => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.reference}</TableCell>
                          <TableCell className="text-sm">{d.title || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDate(d.createdAt)}</TableCell>
                          <TableCell>
                            <Badge className="text-xs" variant="secondary">{d.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">{fmt(d.totalAmount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {detail.factures.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Receipt className="w-4 h-4" />Factures ({detail.factures.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Référence</TableHead><TableHead>Titre</TableHead><TableHead>Échéance</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.factures.slice(0, 5).map(f => {
                        const isOverdue = f.dueDate && new Date(f.dueDate) < new Date() && !["payee", "annulee"].includes(f.status);
                        return (
                          <TableRow key={f.id} className={isOverdue ? "bg-red-50/30 dark:bg-red-950/10" : ""}>
                            <TableCell className="font-mono text-xs">{f.reference}</TableCell>
                            <TableCell className="text-sm">{f.title || "—"}</TableCell>
                            <TableCell className={`text-xs ${isOverdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>{fmtDate(f.dueDate)}{isOverdue ? " ⚠️" : ""}</TableCell>
                            <TableCell>
                              <Badge className="text-xs" variant={f.status === "payee" ? "default" : "secondary"}>{f.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">{fmt(f.totalAmount)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {(detail.projets?.length ?? 0) > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2"><FolderKanban className="w-4 h-4 text-indigo-500" />Projets ({detail.projets!.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Titre</TableHead><TableHead>Statut</TableHead><TableHead>Avancement</TableHead><TableHead className="hidden sm:table-cell">Date fin</TableHead><TableHead className="text-right hidden md:table-cell">Budget</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.projets!.slice(0, 5).map(p => {
                        const overdue = p.endDate && new Date(p.endDate) < new Date() && !["termine", "annule"].includes(p.status);
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm font-medium">{p.title}</TableCell>
                            <TableCell><Badge className="text-xs" variant="secondary">{p.status}</Badge></TableCell>
                            <TableCell className="text-xs">{p.progress ?? 0}%</TableCell>
                            <TableCell className={`text-xs hidden sm:table-cell ${overdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>{fmtDate(p.endDate)}{overdue ? " ⚠️" : ""}</TableCell>
                            <TableCell className="text-right text-sm hidden md:table-cell">{p.budget ? fmt(p.budget) : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6 text-blue-500" />Fiche Clients</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Historique commercial par client</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`${BASE}/api/clients/export/csv`} download="clients.csv">
            <Button variant="outline" size="sm" className="gap-2"><Download className="w-4 h-4" />CSV</Button>
          </a>
          <Button variant="outline" size="sm" onClick={loadClients} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Actualiser
          </Button>
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un client..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead className="hidden md:table-cell">Entreprise</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead className="hidden lg:table-cell">Téléphone</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(5)].map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p>{search ? "Aucun client trouvé" : "Aucun client pour l'instant"}</p>
                    <p className="text-xs mt-1">Les clients apparaissent dès qu'un devis ou une facture est créé</p>
                  </TableCell>
                </TableRow>
              ) : clients.map(c => (
                <TableRow key={c.name} className="cursor-pointer hover:bg-muted/40" onClick={() => openClient(c.name)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.company || "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{c.email || "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{c.phone || "—"}</TableCell>
                  <TableCell>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
