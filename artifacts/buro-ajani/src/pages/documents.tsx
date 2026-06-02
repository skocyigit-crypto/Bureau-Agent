import { useState, useEffect, useCallback } from "react";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FileUpload } from "@/components/file-upload";
import {
  FileText, FileSpreadsheet, Image as ImageIcon, File, Download,
  Trash2, Brain, Sparkles, Search, Filter, BarChart3, HardDrive,
  Upload, Loader2, Eye, Printer, Edit, FolderKanban, ShieldCheck, ShieldAlert,
  Shield, ShieldQuestion,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

import { useLocation } from "wouter";
import { streamSse } from "@/lib/ai-stream-client";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const ENTITY_LABELS: Record<string, string> = {
  contact: "Contact",
  task: "Tache",
  message: "Message",
  invoice: "Facture",
  devis: "Devis",
  prospect: "Prospect",
  project: "Projet",
  stock: "Stock",
  event: "Evenement",
  general: "General",
};

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  contrat: "Contrat",
  facture: "Facture",
  rapport: "Rapport",
  cv: "CV",
  correspondance: "Correspondance",
  technique: "Technique",
  juridique: "Juridique",
  comptabilite: "Comptabilité",
};

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv") return FileSpreadsheet;
  if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("document")) return FileText;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} Mo`;
  return `${(bytes / 1024).toFixed(0)} Ko`;
}

interface Doc {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  entityType: string | null;
  entityId: number | null;
  category: string;
  description: string | null;
  tags: string[];
  aiProcessed: boolean;
  status: string;
  scanVerdict?: string | null;
  scanEngine?: string | null;
  scanDetail?: string | null;
  scannedAt?: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface Stats {
  totalDocuments: number;
  totalSize: string;
  byEntityType: { entity_type: string; count: number }[];
  byCategory: { category: string; count: number }[];
  byScanVerdict?: { safe: number; dangerous: number; unscanned: number };
}

export default function DocumentsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterScan, setFilterScan] = useState<string>(() => {
    const scan = new URLSearchParams(window.location.search).get("scan");
    return scan === "safe" || scan === "dangerous" || scan === "none" ? scan : "all";
  });
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [scanningId, setScanningId] = useState<number | null>(null);
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null);
  const [editDocForm, setEditDocForm] = useState({ category: "", description: "", entityType: "" });
  const [editDocSaving, setEditDocSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState<{ completed: number; total: number } | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filterEntity !== "all") params.set("entityType", filterEntity);
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (filterScan !== "all") params.set("scanVerdict", filterScan);

      const [docsRes, statsRes] = await Promise.all([
        fetch(`${API}/api/documents/list?${params}`, { credentials: "include" }),
        fetch(`${API}/api/documents/stats/overview`, { credentials: "include" }),
      ]);

      if (docsRes.ok) {
        const data = await docsRes.json();
        setDocuments(data.documents || []);
        setTotal(data.total || 0);
      } else {
        console.error("[Documents] docs fetch HTTP error:", docsRes.status);
        toast({ title: "Erreur de chargement des documents", variant: "destructive" });
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch (err) {
      console.error("[Documents] load failed:", err);
      toast({ title: "Erreur de chargement des documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [filterEntity, filterCategory, filterScan]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const downloadDoc = async (id: number, name: string) => {
    try {
      const res = await fetch(`${API}/api/documents/${id}/download`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Erreur de telechargement", variant: "destructive" });
    }
  };

  const deleteDoc = async (id: number) => {
    try {
      const res = await fetch(`${API}/api/documents/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "Document supprime" });
        loadDocuments();
      } else {
        toast({ title: "Erreur de suppression", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const toggleSelect = (id: number) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleAll = () => setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map((d: any) => d.id));
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!(await confirmAction({ title: `Supprimer ${selectedIds.length} document(s) ?`, confirmLabel: "Supprimer", destructive: true }))) return;
    const res = await fetch(`${API}/api/bulk/documents/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { toast({ title: `${selectedIds.length} document(s) supprime(s)` }); setSelectedIds([]); loadDocuments(); }
    else toast({ title: "Erreur", variant: "destructive" });
  };

  const handleBulkScan = async () => {
    if (selectedIds.length === 0 || bulkScanning) return;
    setBulkScanning(true);
    setBulkScanProgress({ completed: 0, total: selectedIds.length });
    const ctrl = new AbortController();
    let finished = false;
    try {
      await streamSse("/documents/bulk/scan/stream", { ids: selectedIds }, {
        signal: ctrl.signal,
        onEvent: (event, data) => {
          if (event === "start") {
            setBulkScanProgress({ completed: 0, total: data.total ?? selectedIds.length });
          } else if (event === "progress") {
            setBulkScanProgress({ completed: data.completed ?? 0, total: data.total ?? selectedIds.length });
          } else if (event === "done") {
            finished = true;
            const parts: string[] = [];
            if (data.safe) parts.push(`${data.safe} sain(s)`);
            if (data.dangerous) parts.push(`${data.dangerous} menace(s)`);
            if (data.failed) parts.push(`${data.failed} échec(s)`);
            toast({
              title: `${data.scanned} document(s) analysé(s)`,
              description: parts.join(" · ") || undefined,
              variant: data.dangerous ? "destructive" : "default",
            });
          } else if (event === "error") {
            finished = true;
            toast({ title: data?.error || "Erreur d'analyse antivirus", variant: "destructive" });
          }
        },
      });
      if (!finished) {
        // Stream ended without a terminal event (e.g. reattached to a completed
        // job that had no replayable "done"); reconcile via status snapshot.
        const res = await fetch(`${API}/api/documents/bulk/scan/status`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.status === "completed" || data.status === "cancelled") {
            const parts: string[] = [];
            if (data.safe) parts.push(`${data.safe} sain(s)`);
            if (data.dangerous) parts.push(`${data.dangerous} menace(s)`);
            if (data.failed) parts.push(`${data.failed} échec(s)`);
            toast({
              title: `${(data.safe ?? 0) + (data.dangerous ?? 0)} document(s) analysé(s)`,
              description: parts.join(" · ") || undefined,
              variant: data.dangerous ? "destructive" : "default",
            });
          }
        }
      }
      setSelectedIds([]);
      await loadDocuments();
    } catch {
      toast({ title: "Erreur d'analyse antivirus", variant: "destructive" });
    } finally {
      setBulkScanning(false);
      setBulkScanProgress(null);
    }
  };

  const analyzeDoc = async (id: number) => {
    setAnalyzingId(id);
    try {
      const res = await fetch(`${API}/api/documents/${id}/analyze`, { method: "POST", credentials: "include" });
      if (res.ok) {
        toast({ title: "Analyse IA terminee" });
        loadDocuments();
      } else {
        toast({ title: "Erreur d'analyse", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur d'analyse", variant: "destructive" });
    } finally {
      setAnalyzingId(null);
    }
  };

  const rescanDoc = async (id: number) => {
    setScanningId(id);
    try {
      const res = await fetch(`${API}/api/documents/${id}/scan`, { method: "POST", credentials: "include" });
      if (res.ok) {
        const result = await res.json();
        if (result.scanVerdict === "safe") {
          toast({ title: "Document vérifié : sain" });
        } else {
          toast({ title: "Menace détectée", description: "Ce fichier a été marqué comme dangereux.", variant: "destructive" });
        }
        await loadDocuments();
      } else {
        toast({ title: "Erreur d'analyse antivirus", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur d'analyse antivirus", variant: "destructive" });
    } finally {
      setScanningId(null);
    }
  };

  const scanAllUnscanned = async () => {
    const total = stats?.byScanVerdict?.unscanned ?? 0;
    if (total === 0 || bulkScanning) return;
    setBulkScanning(true);
    setBulkScanProgress({ completed: 0, total });
    let done = 0;
    let totalSafe = 0;
    let totalDangerous = 0;
    try {
      for (let i = 0; i < 1000; i++) {
        const res = await fetch(`${API}/api/documents/scan-unscanned`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ batchSize: 15 }),
        });
        if (!res.ok) {
          toast({ title: "Erreur d'analyse antivirus en lot", variant: "destructive" });
          break;
        }
        const result = await res.json();
        done += result.scanned ?? 0;
        totalSafe += result.safe ?? 0;
        totalDangerous += result.dangerous ?? 0;
        setBulkScanProgress({ completed: Math.min(done, total), total: Math.max(total, done) });
        if ((result.scanned ?? 0) === 0 || (result.remaining ?? 0) === 0) break;
      }
      if (totalDangerous > 0) {
        toast({
          title: `${done} document(s) analysé(s)`,
          description: `${totalDangerous} menace(s) détectée(s), ${totalSafe} sain(s).`,
          variant: "destructive",
        });
      } else {
        toast({ title: `${done} document(s) analysé(s)`, description: "Aucune menace détectée." });
      }
      await loadDocuments();
    } catch {
      toast({ title: "Erreur d'analyse antivirus en lot", variant: "destructive" });
    } finally {
      setBulkScanning(false);
      setBulkScanProgress(null);
    }
  };

  const openEditDoc = (doc: Doc) => {
    setEditingDoc(doc);
    setEditDocForm({ category: doc.category || "general", description: doc.description || "", entityType: doc.entityType || "" });
  };

  const handleUpdateDoc = async () => {
    if (!editingDoc) return;
    setEditDocSaving(true);
    try {
      const body: any = { category: editDocForm.category, description: editDocForm.description };
      if (editDocForm.entityType) body.entityType = editDocForm.entityType;
      const res = await fetch(`${API}/api/documents/${editingDoc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast({ title: "Document mis à jour" });
        setEditingDoc(null);
        loadDocuments();
      } else {
        toast({ title: "Erreur de mise a jour", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    } finally {
      setEditDocSaving(false);
    }
  };

  const viewDetail = async (id: number) => {
    try {
      const res = await fetch(`${API}/api/documents/${id}`, { credentials: "include" });
      if (res.ok) {
        setSelectedDoc(await res.json());
        setDetailOpen(true);
      }
    } catch (err) {
      console.error("[Documents] view detail failed:", err);
    }
  };

  const filtered = documents.filter(d =>
    !search || d.fileName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">Gestion centralisee de tous vos fichiers</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`${API}/api/documents/export/csv`} download>
            <Button variant="outline" size="icon" title="Exporter CSV"><Download className="w-4 h-4" /></Button>
          </a>
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-violet-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalDocuments}</p>
                <p className="text-xs text-muted-foreground">Documents</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <HardDrive className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalSize}</p>
                <p className="text-xs text-muted-foreground">Stockage</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{documents.filter(d => d.aiProcessed).length}</p>
                <p className="text-xs text-muted-foreground">Analyses IA</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.byEntityType?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Modules lies</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="w-4 h-4" /> Telecharger
              </CardTitle>
              <CardDescription>Deposez vos fichiers pour les ajouter</CardDescription>
            </CardHeader>
            <CardContent>
              <FileUpload
                analyzeWithAi
                compact
                onUploadComplete={() => loadDocuments()}
              />
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un document..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterEntity} onValueChange={setFilterEntity}>
              <SelectTrigger className="w-[160px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les modules</SelectItem>
                {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Categorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterScan} onValueChange={setFilterScan}>
              <SelectTrigger className="w-[170px]">
                <ShieldCheck className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Sécurité" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  Toute sécurité{stats?.byScanVerdict ? ` (${stats.byScanVerdict.safe + stats.byScanVerdict.dangerous + stats.byScanVerdict.unscanned})` : ""}
                </SelectItem>
                <SelectItem value="safe">
                  Vérifié (sain){stats?.byScanVerdict ? ` (${stats.byScanVerdict.safe})` : ""}
                </SelectItem>
                <SelectItem value="dangerous">
                  Menace détectée{stats?.byScanVerdict ? ` (${stats.byScanVerdict.dangerous})` : ""}
                </SelectItem>
                <SelectItem value="none">
                  Non analysé{stats?.byScanVerdict ? ` (${stats.byScanVerdict.unscanned})` : ""}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {stats?.byScanVerdict && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterScan(filterScan === "safe" ? "all" : "safe")}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterScan === "safe" ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"}`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {stats.byScanVerdict.safe} vérifié{stats.byScanVerdict.safe > 1 ? "s" : ""}
              </button>
              <button
                type="button"
                onClick={() => setFilterScan(filterScan === "dangerous" ? "all" : "dangerous")}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterScan === "dangerous" ? "border-red-500 bg-red-500/15 text-red-700 dark:text-red-400" : "border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20"}`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                {stats.byScanVerdict.dangerous} menace{stats.byScanVerdict.dangerous > 1 ? "s" : ""}
              </button>
              <button
                type="button"
                onClick={() => setFilterScan(filterScan === "none" ? "all" : "none")}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterScan === "none" ? "border-slate-400 bg-slate-400/20 text-slate-700 dark:text-slate-300" : "border-slate-400/30 bg-slate-400/10 text-slate-500 hover:bg-slate-400/20"}`}
              >
                <ShieldQuestion className="w-3.5 h-3.5" />
                {stats.byScanVerdict.unscanned} non analysé{stats.byScanVerdict.unscanned > 1 ? "s" : ""}
              </button>
              {stats.byScanVerdict.unscanned > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={scanAllUnscanned}
                  disabled={bulkScanning}
                  className="h-7 gap-1.5 text-xs"
                >
                  {bulkScanning ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {bulkScanProgress ? `Analyse ${bulkScanProgress.completed}/${bulkScanProgress.total}…` : "Analyse…"}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Tout analyser
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Chargement...
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Aucun document</p>
                <p className="text-sm mt-1">Commencez par telecharger un fichier</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {selectedIds.length > 0 && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selectedIds.length} document(s) sélectionné(s)</span>
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={handleBulkScan} disabled={bulkScanning}>
                    {bulkScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                    {bulkScanning
                      ? bulkScanProgress
                        ? `Analyse… ${bulkScanProgress.completed}/${bulkScanProgress.total}`
                        : "Analyse en cours…"
                      : "Analyser la sécurité"}
                  </Button>
                  <Button size="sm" variant="destructive" className="gap-1 h-7 text-xs" onClick={handleBulkDelete} disabled={bulkScanning}><Trash2 className="w-3 h-3" />Supprimer la sélection</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds([])} disabled={bulkScanning}>Annuler</Button>
                </div>
              )}
              {filtered.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 rounded-lg border">
                  <Checkbox checked={selectedIds.length === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
                  <span className="text-xs text-muted-foreground">Tout sélectionner ({filtered.length})</span>
                </div>
              )}
              {filtered.map(doc => {
                const Icon = getFileIcon(doc.mimeType);
                return (
                  <Card key={doc.id} className="hover:bg-accent/30 transition-colors">
                    <CardContent className="p-4 flex items-center gap-4">
                      <Checkbox checked={selectedIds.includes(doc.id)} onCheckedChange={() => toggleSelect(doc.id)} />
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
                        <Icon className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{doc.fileName}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">{formatSize(doc.fileSize)}</span>
                          {doc.entityType && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {ENTITY_LABELS[doc.entityType] || doc.entityType}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {CATEGORY_LABELS[doc.category] || doc.category}
                          </Badge>
                          {doc.aiProcessed && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-violet-500/10 text-violet-600">
                              <Sparkles className="w-2.5 h-2.5" /> IA
                            </Badge>
                          )}
                          {doc.scanVerdict === "safe" && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 gap-1 bg-emerald-500/10 text-emerald-600"
                              title={`Analyse antivirus : ${doc.scanEngine || "moteur"}${doc.scannedAt ? ` — ${new Date(doc.scannedAt).toLocaleDateString("fr-FR")}` : ""}`}
                            >
                              <ShieldCheck className="w-2.5 h-2.5" />
                              {doc.scanEngine ? `Vérifié (${doc.scanEngine})` : "Vérifié"}
                            </Badge>
                          )}
                          {doc.scanVerdict === "dangerous" && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-red-500/10 text-red-600">
                              <ShieldAlert className="w-2.5 h-2.5" /> Menace
                            </Badge>
                          )}
                          {!doc.scanVerdict && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-slate-500/10 text-slate-500">
                              <ShieldQuestion className="w-2.5 h-2.5" /> Non analysé
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {new Date(doc.createdAt).toLocaleDateString("fr-FR")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => viewDetail(doc.id)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditDoc(doc)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => downloadDoc(doc.id, doc.fileName)}>
                          <Download className="w-4 h-4" />
                        </Button>
                        {!doc.aiProcessed && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => analyzeDoc(doc.id)} disabled={analyzingId === doc.id}>
                            {analyzingId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                          </Button>
                        )}
                        {!doc.scanVerdict && (
                          <Button
                            size="icon" variant="ghost" className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                            title="Analyser la sécurité"
                            onClick={() => rescanDoc(doc.id)}
                            disabled={scanningId === doc.id}
                          >
                            {scanningId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                          </Button>
                        )}
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-500/10"
                          title="Créer un projet"
                          onClick={async () => {
                            const res = await fetch(`${API}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: `Document - ${doc.fileName}`, status: "planifie", priority: "moyenne", progress: 0, notes: `Projet créé depuis le document : ${doc.fileName}` }) });
                            if (res.ok) { toast({ title: "Projet créé" }); setLocation("/projets"); }
                            else toast({ title: "Erreur", variant: "destructive" });
                          }}
                        >
                          <FolderKanban className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-500" onClick={() => deleteDoc(doc.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedDoc?.fileName}</DialogTitle>
          </DialogHeader>
          {selectedDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Type:</span> <span className="ml-2">{selectedDoc.mimeType}</span></div>
                <div><span className="text-muted-foreground">Taille:</span> <span className="ml-2">{formatSize(selectedDoc.fileSize)}</span></div>
                <div><span className="text-muted-foreground">Categorie:</span> <span className="ml-2">{CATEGORY_LABELS[selectedDoc.category] || selectedDoc.category}</span></div>
                <div><span className="text-muted-foreground">Statut:</span> <span className="ml-2">{selectedDoc.status}</span></div>
                {selectedDoc.entityType && (
                  <div><span className="text-muted-foreground">Module:</span> <span className="ml-2">{ENTITY_LABELS[selectedDoc.entityType] || selectedDoc.entityType}</span></div>
                )}
                <div><span className="text-muted-foreground">Date:</span> <span className="ml-2">{new Date(selectedDoc.createdAt).toLocaleString("fr-FR")}</span></div>
              </div>

              {selectedDoc.description && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium text-sm mb-1">Description</h4>
                    <p className="text-sm text-muted-foreground">{selectedDoc.description}</p>
                  </div>
                </>
              )}

              {selectedDoc.scanVerdict && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      {selectedDoc.scanVerdict === "safe" ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                      )}
                      Analyse antivirus
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Verdict:</span>
                        <span className="ml-2">{selectedDoc.scanVerdict === "safe" ? "Sain" : "Menace détectée"}</span>
                      </div>
                      {selectedDoc.scanEngine && (
                        <div><span className="text-muted-foreground">Moteur:</span> <span className="ml-2">{selectedDoc.scanEngine}</span></div>
                      )}
                      {selectedDoc.scannedAt && (
                        <div><span className="text-muted-foreground">Analysé le:</span> <span className="ml-2">{new Date(selectedDoc.scannedAt).toLocaleString("fr-FR")}</span></div>
                      )}
                    </div>
                    {selectedDoc.scanDetail && (
                      <p className="text-xs text-muted-foreground mt-2">{selectedDoc.scanDetail}</p>
                    )}
                  </div>
                </>
              )}

              {!selectedDoc.scanVerdict && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                      <ShieldQuestion className="w-4 h-4 text-slate-400" /> Analyse antivirus
                    </h4>
                    <p className="text-sm text-muted-foreground mb-3">Ce document n'a pas encore été analysé.</p>
                    <Button
                      size="sm" variant="outline" className="gap-2"
                      disabled={scanningId === selectedDoc.id}
                      onClick={async () => { await rescanDoc(selectedDoc.id); await viewDetail(selectedDoc.id); }}
                    >
                      {scanningId === selectedDoc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                      Analyser la sécurité
                    </Button>
                  </div>
                </>
              )}

              {selectedDoc.aiAnalysis && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-500" /> Analyse IA
                    </h4>
                    {selectedDoc.aiAnalysis.summary && (
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">{selectedDoc.aiAnalysis.summary}</p>
                    )}
                    {selectedDoc.aiAnalysis.documentType && (
                      <div className="flex gap-2">
                        <Badge variant="secondary">{selectedDoc.aiAnalysis.documentType}</Badge>
                        {selectedDoc.aiAnalysis.confidence && (
                          <Badge variant="outline">{Math.round(selectedDoc.aiAnalysis.confidence * 100)}% confiance</Badge>
                        )}
                      </div>
                    )}
                    {selectedDoc.aiAnalysis.extractedFields && Object.keys(selectedDoc.aiAnalysis.extractedFields).length > 0 && (
                      <div className="space-y-1">
                        <h5 className="text-xs font-medium text-muted-foreground">Champs extraits</h5>
                        <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-3 rounded-lg">
                          {Object.entries(selectedDoc.aiAnalysis.extractedFields).map(([key, val]) => (
                            <div key={key}>
                              <span className="text-muted-foreground">{key}:</span>{" "}
                              <span className="font-medium">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {selectedDoc.extractedText && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium text-sm mb-1">Texte extrait</h4>
                    <pre className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {selectedDoc.extractedText}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingDoc} onOpenChange={(o) => { if (!o) setEditingDoc(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier le document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Categorie</Label>
              <Select value={editDocForm.category} onValueChange={(v) => setEditDocForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Module associe</Label>
              <Select value={editDocForm.entityType || "none"} onValueChange={(v) => setEditDocForm(f => ({ ...f, entityType: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  {Object.entries(ENTITY_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={editDocForm.description}
                onChange={(e) => setEditDocForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Description du document..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDoc(null)}>Annuler</Button>
            <Button onClick={handleUpdateDoc} disabled={editDocSaving}>
              {editDocSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
