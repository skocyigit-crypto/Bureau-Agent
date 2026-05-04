import { useState, useEffect, useCallback } from "react";
import { Package, Search, Plus, MoreHorizontal, Loader2, Trash2, Edit, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw, Minus, ArrowUp, Download, History, Printer, Copy, FolderKanban } from "lucide-react";
import { useLocation } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const PAGE_SIZE = 20;

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  en_stock: { label: "En stock", color: "bg-emerald-100 text-emerald-700" },
  stock_faible: { label: "Stock faible", color: "bg-amber-100 text-amber-700" },
  rupture: { label: "Rupture", color: "bg-red-100 text-red-700" },
};

const CATEGORIES = ["general", "electronique", "fournitures", "mobilier", "consommable", "outillage", "informatique", "autre"];
const UNITS = ["piece", "kg", "litre", "boite", "lot", "metre", "carton"];

function fmtEur(v: any) {
  if (!v || v === "0") return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(v));
}

interface Article {
  id: number; name: string; reference: string; barcode?: string; description?: string;
  category: string; quantity: number; minQuantity: number; unitPrice?: string;
  supplier?: string; location?: string; unit: string; status: string; notes?: string; createdAt: string;
}

const EMPTY = { name: "", reference: "", barcode: "", description: "", category: "general", quantity: "0", minQuantity: "5", unitPrice: "", supplier: "", location: "", unit: "piece", notes: "" };

export default function StockPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Article | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sortBy: "name", sortOrder: "asc" });
      if (search) params.set("search", search);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (lowStockOnly) params.set("lowStock", "true");
      const [r1, r2] = await Promise.all([
        fetch(`${BASE}/api/stock?${params}`, { credentials: "include" }),
        fetch(`${BASE}/api/stock/stats`, { credentials: "include" }),
      ]);
      if (r1.ok) { const d = await r1.json(); setArticles(d.articles || []); setTotal(d.total || 0); }
      if (r2.ok) setStats(await r2.json());
    } catch { toast({ title: "Erreur", description: "Chargement echoue.", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [page, search, categoryFilter, statusFilter, lowStockOnly, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, categoryFilter, statusFilter, lowStockOnly]);

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY }); setDialogOpen(true); };
  const openEdit = (a: Article) => {
    setEditingId(a.id);
    setForm({ name: a.name, reference: a.reference, barcode: a.barcode || "", description: a.description || "", category: a.category, quantity: String(a.quantity), minQuantity: String(a.minQuantity), unitPrice: a.unitPrice || "", supplier: a.supplier || "", location: a.location || "", unit: a.unit, notes: a.notes || "" });
    setDialogOpen(true);
  };
  const openAdjust = (a: Article) => { setAdjustTarget(a); setAdjustDelta(""); setAdjustDialogOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Nom requis", variant: "destructive" }); return; }
    if (!form.reference.trim()) { toast({ title: "Référence requise", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url = editingId ? `${BASE}/api/stock/${editingId}` : `${BASE}/api/stock`;
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...form, quantity: Number(form.quantity), minQuantity: Number(form.minQuantity), unitPrice: form.unitPrice || null }) });
      if (res.ok) { toast({ title: editingId ? "Article mis a jour" : "Article cree" }); setDialogOpen(false); load(); }
      else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleAdjust = async () => {
    if (!adjustTarget || !adjustDelta) return;
    const delta = parseInt(adjustDelta);
    if (isNaN(delta)) { toast({ title: "Delta invalide", variant: "destructive" }); return; }
    setAdjusting(true);
    try {
      const res = await fetch(`${BASE}/api/stock/${adjustTarget.id}/adjust`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ delta }) });
      if (res.ok) { toast({ title: "Stock ajuste" }); setAdjustDialogOpen(false); load(); }
      else { const d = await res.json(); toast({ title: "Erreur", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Erreur", variant: "destructive" }); }
    finally { setAdjusting(false); }
  };

  const handleDuplicate = async (id: number) => {
    const res = await fetch(`${BASE}/api/stock/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Article dupliqué" }); load(); }
    else toast({ title: "Erreur", description: "Impossible de dupliquer", variant: "destructive" });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer cet article ?")) return;
    const res = await fetch(`${BASE}/api/stock/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) { toast({ title: "Article supprime" }); load(); }
  };

  const toggleSelect = (id: number) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleAll = () => setSelectedIds(selectedIds.length === articles.length ? [] : articles.map(a => a.id));
  const handleBulkStatus = async (status: string) => {
    if (!selectedIds.length) return;
    const res = await fetch(`${BASE}/api/bulk/stock/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds, status }) });
    if (res.ok) { toast({ title: `${selectedIds.length} article(s) mis à jour` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Supprimer ${selectedIds.length} article(s) ?`)) return;
    const res = await fetch(`${BASE}/api/bulk/stock/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { toast({ title: `${selectedIds.length} article(s) supprime(s)` }); setSelectedIds([]); load(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Icon3D icon={Package} variant="blue" size="md" /> Gestion du Stock
          </h1>
          <p className="text-muted-foreground">Inventaire, suivi des niveaux et alertes de rupture.</p>
        </div>
        <div className="flex gap-2">
          <a href={`${BASE}/api/stock/export/csv`} download><Button variant="outline" size="sm" className="gap-2"><Download className="w-4 h-4" />CSV</Button></a>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Link href="/stock/mouvements"><Button variant="outline" size="sm" className="gap-2"><History className="w-4 h-4" />Mouvements</Button></Link>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nouvel article</Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Total articles</p><p className="text-2xl font-bold">{stats.total}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground">Valeur totale</p><p className="text-2xl font-bold text-emerald-600">{fmtEur(stats.totalValue)}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-500" />Stock faible</p><p className="text-2xl font-bold text-amber-600">{stats.lowStock}</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-500" />Ruptures</p><p className="text-2xl font-bold text-red-600">{stats.outOfStock}</p></CardContent></Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Catégorie" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Toutes</SelectItem>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous statuts</SelectItem>{Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant={lowStockOnly ? "default" : "outline"} size="sm" onClick={() => setLowStockOnly(v => !v)} className="gap-1"><AlertTriangle className="w-3 h-3" />Alertes</Button>
        <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg flex-wrap">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selectedIds.length} article(s) sélectionné(s)</span>
          <Select onValueChange={handleBulkStatus}>
            <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Changer statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en_stock">En stock</SelectItem>
              <SelectItem value="stock_faible">Stock faible</SelectItem>
              <SelectItem value="rupture">Rupture</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="destructive" className="gap-1 h-7 text-xs" onClick={handleBulkDelete}><Trash2 className="w-3 h-3" />Supprimer la sélection</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds([])}>Annuler</Button>
        </div>
      )}

      <Card>
        {loading ? (
          <div className="p-4 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={articles.length > 0 && selectedIds.length === articles.length} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Article</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Qté</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>P.U.</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Aucun article trouvé.</TableCell></TableRow>}
              {articles.map(a => {
                const sc = STATUS_CFG[a.status] || STATUS_CFG.en_stock;
                return (
                  <TableRow key={a.id} className={a.status === "rupture" ? "bg-red-50/50 dark:bg-red-950/10" : a.status === "stock_faible" ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}>
                    <TableCell><Checkbox checked={selectedIds.includes(a.id)} onCheckedChange={() => toggleSelect(a.id)} /></TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{a.name}</p>
                        {a.location && <p className="text-xs text-muted-foreground">{a.location}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{a.reference}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{a.category}</Badge></TableCell>
                    <TableCell className="text-right">
                      <span className={`font-bold ${a.quantity === 0 ? "text-red-600" : a.quantity <= a.minQuantity ? "text-amber-600" : ""}`}>
                        {a.quantity} <span className="font-normal text-xs text-muted-foreground">{a.unit}</span>
                      </span>
                    </TableCell>
                    <TableCell><Badge className={`${sc.color} border-0 text-xs`}>{sc.label}</Badge></TableCell>
                    <TableCell className="text-sm">{fmtEur(a.unitPrice)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.supplier}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openAdjust(a)}><RefreshCw className="w-3 h-3 mr-2" />Ajuster stock</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(a)}><Edit className="w-3 h-3 mr-2" />Modifier</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(a.id)}><Copy className="w-3 h-3 mr-2" />Dupliquer</DropdownMenuItem>
                          <DropdownMenuItem className="text-indigo-600" onClick={async () => {
                            const res = await fetch(`${BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: `Projet - ${a.name}`, status: "planifie", priority: "moyenne", progress: 0, notes: `Créé depuis l'article stock: ${a.reference || a.name}` }) });
                            if (res.ok) { toast({ title: "Projet créé" }); setLocation("/projets"); }
                            else toast({ title: "Erreur", variant: "destructive" });
                          }}><FolderKanban className="w-3 h-3 mr-2" />Créer un projet</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(a.id)}><Trash2 className="w-3 h-3 mr-2" />Supprimer</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-sm text-muted-foreground">{total} article{total !== 1 ? "s" : ""}</p>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Modifier l'article" : "Nouvel article"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Nom *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><Label className="text-xs">Référence *</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Catégorie</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Unité</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Quantité</Label><Input type="number" min="0" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
              <div><Label className="text-xs">Seuil alerte</Label><Input type="number" min="0" value={form.minQuantity} onChange={e => setForm(f => ({ ...f, minQuantity: e.target.value }))} /></div>
              <div><Label className="text-xs">Prix unitaire</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} placeholder="0.00" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Fournisseur</Label><Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} /></div>
              <div><Label className="text-xs">Emplacement</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Étagère A-3..." /></div>
            </div>
            <div><Label className="text-xs">Code-barres</Label><Input value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} /></div>
            <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}{editingId ? "Mettre à jour" : "Créer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Ajuster le stock — {adjustTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Stock actuel : <strong>{adjustTarget?.quantity} {adjustTarget?.unit}</strong></p>
            <div>
              <Label className="text-xs">Variation (positif = entrée, négatif = sortie)</Label>
              <Input type="number" value={adjustDelta} onChange={e => setAdjustDelta(e.target.value)} placeholder="+10 ou -5" />
            </div>
            {adjustDelta && adjustTarget && (
              <p className="text-sm">Nouveau stock : <strong>{Math.max(0, adjustTarget.quantity + parseInt(adjustDelta || "0"))} {adjustTarget.unit}</strong></p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleAdjust} disabled={adjusting}>{adjusting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Confirmer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
