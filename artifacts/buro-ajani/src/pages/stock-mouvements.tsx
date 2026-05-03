import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Package, TrendingUp, TrendingDown, RefreshCw, Search, Filter, ChevronLeft, ChevronRight, Download, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 30;

function fmtDate(d: string) {
  return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface Mouvement {
  id: number; articleId: number; articleName: string; articleReference?: string;
  type: string; delta: number; quantityBefore: number; quantityAfter: number;
  reason?: string; userName?: string; createdAt: string;
}

export default function StockMouvementsPage() {
  const [data, setData] = useState<{ mouvements: Mouvement[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const r = await fetch(`${BASE}/api/stock/mouvements?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les mouvements.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, page]);

  useEffect(() => { setPage(0); }, [search, typeFilter]);
  useEffect(() => { load(); }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const TYPE_LABELS: Record<string, { label: string; color: string }> = {
    ajustement: { label: "Ajustement", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    entree: { label: "Entrée", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
    sortie: { label: "Sortie", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    inventaire: { label: "Inventaire", color: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300" },
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/stock"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Retour</Button></Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="w-6 h-6 text-slate-500" />Mouvements de Stock</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Historique complet des entrées et sorties de stock</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Rechercher un article…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <Filter className="w-3 h-3 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            <SelectItem value="ajustement">Ajustement</SelectItem>
            <SelectItem value="entree">Entrée</SelectItem>
            <SelectItem value="sortie">Sortie</SelectItem>
            <SelectItem value="inventaire">Inventaire</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Actualiser">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/stock/mouvements/export/csv`} download="mouvements_stock.csv">
          <Button variant="outline" size="sm" className="gap-2"><Download className="w-4 h-4" />CSV</Button>
        </a>
        <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Article</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Variation</TableHead>
                <TableHead className="text-center">Avant</TableHead>
                <TableHead className="text-center">Après</TableHead>
                <TableHead>Motif</TableHead>
                <TableHead>Utilisateur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <TableRow key={i}>{[...Array(8)].map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
                ))
              ) : !data?.mouvements.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p className="text-muted-foreground text-sm">Aucun mouvement enregistré</p>
                    <p className="text-xs text-muted-foreground mt-1">Les mouvements apparaissent dès que vous ajustez le stock</p>
                  </TableCell>
                </TableRow>
              ) : (
                data.mouvements.map(m => {
                  const cfg = TYPE_LABELS[m.type] || TYPE_LABELS.ajustement;
                  const positive = m.delta > 0;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.createdAt)}</TableCell>
                      <TableCell>
                        <p className="font-medium text-sm">{m.articleName}</p>
                        {m.articleReference && <p className="text-xs text-muted-foreground">{m.articleReference}</p>}
                      </TableCell>
                      <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span></TableCell>
                      <TableCell className="text-center">
                        <span className={`flex items-center justify-center gap-1 font-bold text-sm ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {positive ? "+" : ""}{m.delta}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">{m.quantityBefore}</TableCell>
                      <TableCell className="text-center text-sm font-medium">{m.quantityAfter}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{m.reason || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.userName || "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{data.total} mouvement{data.total !== 1 ? "s" : ""} au total</p>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="flex items-center px-3 text-sm">{page + 1}/{totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
