import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { confirmAction } from "@/hooks/use-confirm";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
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
  Shield, ShieldQuestion, X, RotateCcw, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useWorkspaceUser } from "@/components/workspace-user";

import { useLocation } from "wouter";
import { streamSse } from "@/lib/ai-stream-client";
import { useTranslation, type TFunction } from "@/i18n";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

// La liste documents est filtrée côté client (l'API /list ne recherche pas par
// nom de fichier). On pagine donc les résultats filtrés côté client pour éviter
// de rendre des dizaines de cartes d'un coup.
const DOCS_PAGE_SIZE = 12;

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

// Cout estime d'une analyse antivirus fraiche (appels moteur, lookup VirusTotal,
// heuristiques) quand on ne dispose pas d'une mesure reelle. ~1,5 s/fichier.
const DEFAULT_SCAN_COST_MS = 1500;

function formatSeconds(seconds: number): string {
  const rounded = seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds);
  return rounded.toLocaleString("fr-FR");
}

// Traduit le nombre de fichiers reutilises en benefice concret: analyses
// evitees + temps gagne estime. On mesure le cout moyen d'une analyse fraiche
// a partir du job en cours quand c'est possible, sinon on retombe sur une
// estimation par defaut. Retourne un suffixe a coller a la description du toast.
function formatReuseSavings(job: { reused: number; scanned: number; startedAt: number | null; finishedAt: number | null }, t: TFunction): string {
  if (job.reused <= 0) return "";
  const fresh = job.scanned - job.reused;
  let avgCostMs = DEFAULT_SCAN_COST_MS;
  if (fresh > 0 && job.startedAt && job.finishedAt && job.finishedAt > job.startedAt) {
    avgCostMs = (job.finishedAt - job.startedAt) / fresh;
  }
  const savedSeconds = (job.reused * avgCostMs) / 1000;
  return t("documents.reuseSavings", { count: job.reused, seconds: formatSeconds(savedSeconds) });
}

// Traduit un total de millisecondes economisees en libelle lisible (minutes au
// dela de 60 s, sinon secondes), pour le compteur cumulatif persiste.
function formatCumulativeSaved(savedMs: number): string {
  const totalSeconds = savedMs / 1000;
  if (totalSeconds >= 60) {
    const minutes = totalSeconds / 60;
    const rounded = minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes);
    return `${rounded.toLocaleString("fr-FR")} min`;
  }
  return `${formatSeconds(totalSeconds)} s`;
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
  reuseSavings?: { reusedScanCount: number; reusedScanSavedMs: number };
}

interface BulkScanJobState {
  status: "running" | "completed" | "failed" | "cancelled" | "idle";
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  scanned: number;
  safe: number;
  dangerous: number;
  reused: number;
  failed: number;
  remaining: number;
  error: string | null;
}

export default function DocumentsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user } = useWorkspaceUser();
  const isOwner = user?.role === "super_admin" || user?.role === "administrateur";
  const [resettingSavings, setResettingSavings] = useState(false);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [docPage, setDocPage] = useState(0);
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
  const [bulkScanCancelling, setBulkScanCancelling] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState<{ completed: number; total: number; reused: number } | null>(null);
  // Distingue les deux chemins partageant l'etat bulkScan* : "selected" = scan SSE
  // de la selection (handleBulkScan), "all" = scan "Tout analyser" en arriere-plan.
  // L'annulation choisit le bon endpoint selon ce mode.
  const [bulkScanKind, setBulkScanKind] = useState<"selected" | "all" | null>(null);
  const bulkScanCtrlRef = useRef<AbortController | null>(null);
  // Ignore les reponses obsoletes quand les filtres changent vite : sans ce garde,
  // la reponse d'un ancien filtre peut arriver apres et ecraser la liste affichee.
  const docsGenRef = useRef(0);

  const loadDocuments = useCallback(async () => {
    const gen = ++docsGenRef.current;
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
      if (gen !== docsGenRef.current) return;

      if (docsRes.ok) {
        const data = await docsRes.json();
        if (gen !== docsGenRef.current) return;
        setDocuments(data.documents || []);
        setTotal(data.total || 0);
      } else {
        console.error("[Documents] docs fetch HTTP error:", docsRes.status);
        toast({ title: t("documents.toast.loadError"), variant: "destructive" });
      }
      if (statsRes.ok) {
        const s = await statsRes.json();
        if (gen !== docsGenRef.current) return;
        setStats(s);
      }
    } catch (err) {
      if (gen !== docsGenRef.current) return;
      console.error("[Documents] load failed:", err);
      toast({ title: t("documents.toast.loadError"), variant: "destructive" });
    } finally {
      if (gen === docsGenRef.current) setLoading(false);
    }
  }, [filterEntity, filterCategory, filterScan]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const handleResetSavings = useCallback(async () => {
    const ok = await confirmAction({
      title: t("documents.confirm.resetTitle"),
      description: t("documents.confirm.resetDesc"),
      confirmLabel: t("documents.confirm.resetConfirm"),
      destructive: true,
    });
    if (!ok) return;
    setResettingSavings(true);
    try {
      const res = await fetch(`${API}/api/documents/reuse-savings/reset`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setStats((prev) => (prev ? { ...prev, reuseSavings: data.reuseSavings } : prev));
      toast({ title: t("documents.toast.counterReset") });
    } catch (err) {
      console.error("[Documents] reset savings failed:", err);
      toast({ title: t("documents.toast.resetError"), variant: "destructive" });
    } finally {
      setResettingSavings(false);
    }
  }, [toast]);

  // Reattache a un scan en arriere-plan deja en cours (refresh / retour sur la page).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/documents/scan-unscanned/status`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const { job } = (await res.json()) as { job: BulkScanJobState };
        if (job.status === "running") {
          setBulkScanning(true);
          setBulkScanKind("all");
          setBulkScanProgress({ completed: job.scanned, total: Math.max(job.total, job.scanned), reused: job.reused ?? 0 });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Progression du scan en lot diffusee via le canal temps reel (SSE).
  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail as { type?: string; meta?: Record<string, unknown> } | undefined;
      if (!detail || detail.type !== "security" || detail.meta?.source !== "bulk-scan") return;
      const m = detail.meta as unknown as BulkScanJobState;
      if (m.status === "running") {
        setBulkScanning(true);
        setBulkScanKind("all");
        setBulkScanProgress({ completed: m.scanned, total: Math.max(m.total, m.scanned), reused: m.reused ?? 0 });
      } else {
        setBulkScanning(false);
        setBulkScanCancelling(false);
        setBulkScanKind(null);
        setBulkScanProgress(null);
        if (m.status === "completed") {
          const reusedNote = formatReuseSavings(m, t);
          if (m.dangerous > 0) {
            toast({
              title: t("documents.toast.scannedCount", { count: m.scanned }),
              description: t("documents.toast.scanResultDanger", { dangerous: m.dangerous, safe: m.safe }) + reusedNote,
              variant: "destructive",
            });
          } else {
            toast({ title: t("documents.toast.scannedCount", { count: m.scanned }), description: t("documents.toast.scanResultSafe") + reusedNote });
          }
        } else if (m.status === "cancelled") {
          toast({ title: t("documents.toast.scanInterrupted"), description: m.scanned > 0 ? t("documents.toast.scanInterruptedDesc", { count: m.scanned }) : undefined });
        } else if (m.status === "failed") {
          toast({ title: t("documents.toast.bulkScanError"), variant: "destructive" });
        }
        loadDocuments();
      }
    };
    window.addEventListener("realtime-sync", onSync);
    return () => window.removeEventListener("realtime-sync", onSync);
  }, [loadDocuments, toast]);

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
      toast({ title: t("documents.toast.downloadError"), variant: "destructive" });
    }
  };

  const deleteDoc = async (id: number) => {
    try {
      const res = await fetch(`${API}/api/documents/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: t("documents.toast.docDeleted") });
        loadDocuments();
      } else {
        toast({ title: t("documents.toast.deleteError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("documents.toast.error"), variant: "destructive" });
    }
  };

  const toggleSelect = (id: number) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleAll = () => setSelectedIds(selectedIds.length === filtered.length ? [] : filtered.map((d: any) => d.id));
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!(await confirmAction({ title: t("documents.confirm.bulkDelete", { count: selectedIds.length }), confirmLabel: t("documents.confirm.deleteConfirm"), destructive: true }))) return;
    const res = await fetch(`${API}/api/bulk/documents/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { toast({ title: t("documents.toast.bulkDeleted", { count: selectedIds.length }) }); setSelectedIds([]); loadDocuments(); }
    else toast({ title: t("documents.toast.error"), variant: "destructive" });
  };

  const handleBulkScan = async () => {
    if (selectedIds.length === 0 || bulkScanning) return;
    setBulkScanning(true);
    setBulkScanCancelling(false);
    setBulkScanKind("selected");
    setBulkScanProgress({ completed: 0, total: selectedIds.length, reused: 0 });
    const ctrl = new AbortController();
    bulkScanCtrlRef.current = ctrl;
    let finished = false;
    try {
      await streamSse("/documents/bulk/scan/stream", { ids: selectedIds }, {
        signal: ctrl.signal,
        onEvent: (event, data) => {
          if (event === "start") {
            setBulkScanProgress({ completed: 0, total: data.total ?? selectedIds.length, reused: data.reused ?? 0 });
          } else if (event === "progress") {
            setBulkScanProgress({ completed: data.completed ?? 0, total: data.total ?? selectedIds.length, reused: data.reused ?? 0 });
          } else if (event === "done") {
            finished = true;
            const parts: string[] = [];
            if (data.safe) parts.push(t("documents.parts.safe", { count: data.safe }));
            if (data.dangerous) parts.push(t("documents.parts.threat", { count: data.dangerous }));
            if (data.reused) parts.push(t("documents.parts.reused", { count: data.reused }));
            if (data.failed) parts.push(t("documents.parts.failed", { count: data.failed }));
            toast({
              title: t("documents.toast.scannedCount", { count: data.scanned }),
              description: parts.join(" · ") || undefined,
              variant: data.dangerous ? "destructive" : "default",
            });
          } else if (event === "error") {
            finished = true;
            toast({ title: data?.error || t("documents.toast.scanError"), variant: "destructive" });
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
            if (data.safe) parts.push(t("documents.parts.safe", { count: data.safe }));
            if (data.dangerous) parts.push(t("documents.parts.threat", { count: data.dangerous }));
            if (data.reused) parts.push(t("documents.parts.reused", { count: data.reused }));
            if (data.failed) parts.push(t("documents.parts.failed", { count: data.failed }));
            toast({
              title: t("documents.toast.scannedCount", { count: (data.safe ?? 0) + (data.dangerous ?? 0) }),
              description: parts.join(" · ") || undefined,
              variant: data.dangerous ? "destructive" : "default",
            });
          }
        }
      }
      setSelectedIds([]);
      await loadDocuments();
    } catch {
      if (ctrl.signal.aborted) {
        // Annulation demandée par l'utilisateur : on garde les verdicts déjà
        // calculés et on revient à l'état inactif sans alarmer.
        toast({ title: t("documents.toast.scanInterrupted") });
        await loadDocuments();
      } else {
        toast({ title: t("documents.toast.scanError"), variant: "destructive" });
      }
    } finally {
      bulkScanCtrlRef.current = null;
      setBulkScanning(false);
      setBulkScanCancelling(false);
      setBulkScanKind(null);
      setBulkScanProgress(null);
    }
  };

  const handleCancelBulkScan = async () => {
    if (!bulkScanning || bulkScanCancelling) return;
    setBulkScanCancelling(true);
    if (bulkScanKind === "all") {
      // Scan "Tout analyser" en arrière-plan : pas de flux SSE côté client, on
      // demande l'arrêt au serveur. La fin "cancelled" arrive via realtime-sync,
      // qui remettra l'UI à l'état inactif et gardera les verdicts déjà calculés.
      try {
        await fetch(`${API}/api/documents/scan-unscanned/cancel`, { method: "POST", credentials: "include" });
      } catch {
        // Le job s'arrêtera de toute façon ; on garde le bouton en état "Arrêt…".
      }
      return;
    }
    try {
      await fetch(`${API}/api/documents/bulk/scan/cancel`, { method: "POST", credentials: "include" });
    } catch {
      // Le serveur s'arrêtera de toute façon dès que le client se déconnecte.
    }
    // Coupe le flux SSE côté client pour cesser d'écouter immédiatement.
    bulkScanCtrlRef.current?.abort();
  };

  const analyzeDoc = async (id: number) => {
    setAnalyzingId(id);
    try {
      const res = await fetch(`${API}/api/documents/${id}/analyze`, { method: "POST", credentials: "include" });
      if (res.ok) {
        toast({ title: t("documents.toast.aiDone") });
        loadDocuments();
      } else {
        toast({ title: t("documents.toast.aiError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("documents.toast.aiError"), variant: "destructive" });
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
          toast({ title: t("documents.toast.verifiedSafe") });
        } else {
          toast({ title: t("documents.toast.threatTitle"), description: t("documents.toast.threatDesc"), variant: "destructive" });
        }
        await loadDocuments();
      } else {
        toast({ title: t("documents.toast.scanError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("documents.toast.scanError"), variant: "destructive" });
    } finally {
      setScanningId(null);
    }
  };

  const scanAllUnscanned = async () => {
    const total = stats?.byScanVerdict?.unscanned ?? 0;
    if (total === 0 || bulkScanning) return;
    try {
      const res = await fetch(`${API}/api/documents/scan-unscanned/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        toast({ title: t("documents.toast.bulkScanError"), variant: "destructive" });
        return;
      }
      const data = await res.json();
      const job = data.job as BulkScanJobState;
      setBulkScanning(true);
      setBulkScanCancelling(false);
      setBulkScanKind("all");
      setBulkScanProgress({ completed: job.scanned ?? 0, total: job.total || total, reused: job.reused ?? 0 });
      toast({ title: t("documents.toast.bulkStarted"), description: t("documents.toast.bulkStartedDesc") });
    } catch {
      toast({ title: t("documents.toast.bulkScanError"), variant: "destructive" });
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
        toast({ title: t("documents.toast.updated") });
        setEditingDoc(null);
        loadDocuments();
      } else {
        toast({ title: t("documents.toast.updateError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("documents.toast.error"), variant: "destructive" });
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

  const debouncedSearch = useDebouncedValue(search, 300);

  const filtered = useMemo(
    () =>
      documents.filter(
        d => !debouncedSearch || d.fileName.toLowerCase().includes(debouncedSearch.toLowerCase())
      ),
    [documents, debouncedSearch]
  );

  const docTotalPages = Math.max(1, Math.ceil(filtered.length / DOCS_PAGE_SIZE));
  const pagedDocs = useMemo(
    () => filtered.slice(docPage * DOCS_PAGE_SIZE, docPage * DOCS_PAGE_SIZE + DOCS_PAGE_SIZE),
    [filtered, docPage]
  );

  // Revenir à la première page quand le filtrage change la liste (recherche
  // debouncée ou filtres serveur), ou si la page courante dépasse le total.
  useEffect(() => { setDocPage(0); }, [debouncedSearch, filterEntity, filterCategory, filterScan]);
  useEffect(() => {
    if (docPage > docTotalPages - 1) setDocPage(docTotalPages - 1);
  }, [docPage, docTotalPages]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("documents.title")}</h1>
          <p className="text-muted-foreground">{t("documents.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`${API}/api/documents/export/csv`} download>
            <Button variant="outline" size="icon" title={t("documents.actions.exportCsv")}><Download className="w-4 h-4" /></Button>
          </a>
          <Button variant="outline" size="icon" title={t("documents.actions.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
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
                <p className="text-xs text-muted-foreground">{t("documents.stats.documents")}</p>
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
                <p className="text-xs text-muted-foreground">{t("documents.stats.storage")}</p>
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
                <p className="text-xs text-muted-foreground">{t("documents.stats.aiAnalyses")}</p>
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
                <p className="text-xs text-muted-foreground">{t("documents.stats.linkedModules")}</p>
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
                <Upload className="w-4 h-4" /> {t("documents.upload.title")}
              </CardTitle>
              <CardDescription>{t("documents.upload.desc")}</CardDescription>
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
                placeholder={t("documents.search.placeholder")}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
                aria-label={t("documents.search.aria")}
              />
            </div>
            <Select value={filterEntity} onValueChange={setFilterEntity}>
              <SelectTrigger className="w-[160px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder={t("documents.filters.modulePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("documents.filters.allModules")}</SelectItem>
                {Object.keys(ENTITY_LABELS).map((key) => (
                  <SelectItem key={key} value={key}>{t(`documents.entities.${key}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("documents.filters.categoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("documents.filters.allCategories")}</SelectItem>
                {Object.keys(CATEGORY_LABELS).map((key) => (
                  <SelectItem key={key} value={key}>{t(`documents.categories.${key}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterScan} onValueChange={setFilterScan}>
              <SelectTrigger className="w-[170px]">
                <ShieldCheck className="w-4 h-4 mr-2" />
                <SelectValue placeholder={t("documents.filters.securityPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("documents.filters.allSecurity")}{stats?.byScanVerdict ? ` (${stats.byScanVerdict.safe + stats.byScanVerdict.dangerous + stats.byScanVerdict.unscanned})` : ""}
                </SelectItem>
                <SelectItem value="safe">
                  {t("documents.filters.verified")}{stats?.byScanVerdict ? ` (${stats.byScanVerdict.safe})` : ""}
                </SelectItem>
                <SelectItem value="dangerous">
                  {t("documents.filters.threat")}{stats?.byScanVerdict ? ` (${stats.byScanVerdict.dangerous})` : ""}
                </SelectItem>
                <SelectItem value="none">
                  {t("documents.filters.unscanned")}{stats?.byScanVerdict ? ` (${stats.byScanVerdict.unscanned})` : ""}
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
                {t("documents.pills.verified", { count: stats.byScanVerdict.safe })}
              </button>
              <button
                type="button"
                onClick={() => setFilterScan(filterScan === "dangerous" ? "all" : "dangerous")}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterScan === "dangerous" ? "border-red-500 bg-red-500/15 text-red-700 dark:text-red-400" : "border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20"}`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                {t("documents.pills.threat", { count: stats.byScanVerdict.dangerous })}
              </button>
              <button
                type="button"
                onClick={() => setFilterScan(filterScan === "none" ? "all" : "none")}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filterScan === "none" ? "border-slate-400 bg-slate-400/20 text-slate-700 dark:text-slate-300" : "border-slate-400/30 bg-slate-400/10 text-slate-500 hover:bg-slate-400/20"}`}
              >
                <ShieldQuestion className="w-3.5 h-3.5" />
                {t("documents.pills.unscanned", { count: stats.byScanVerdict.unscanned })}
              </button>
              {(stats.byScanVerdict.unscanned > 0 || (bulkScanning && bulkScanKind === "all")) && (
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
                      {bulkScanProgress
                        ? `${t("documents.bulk.scanProgress", { completed: bulkScanProgress.completed, total: bulkScanProgress.total })}${bulkScanProgress.reused > 0 ? t("documents.bulk.reusedSuffix", { count: bulkScanProgress.reused }) : ""}…`
                        : t("documents.bulk.scanningShort")}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {t("documents.bulk.scanAll")}
                    </>
                  )}
                </Button>
              )}
              {bulkScanning && bulkScanKind === "all" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCancelBulkScan}
                  disabled={bulkScanCancelling}
                  className="h-7 gap-1 text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                  {bulkScanCancelling ? t("documents.bulk.stopping") : t("documents.bulk.cancelScan")}
                </Button>
              )}
            </div>
          )}

          {stats?.reuseSavings && stats.reuseSavings.reusedScanCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300">
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>
                {t("documents.savings.prefix")}<span className="font-semibold">{formatCumulativeSaved(stats.reuseSavings.reusedScanSavedMs)}</span>
                {t("documents.savings.suffix", { count: stats.reuseSavings.reusedScanCount })}
              </span>
              {isOwner && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleResetSavings}
                  disabled={resettingSavings}
                  className="ml-auto h-6 gap-1 px-2 text-xs text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
                >
                  {resettingSavings ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  {t("documents.actions.reset")}
                </Button>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              {t("documents.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">{t("documents.empty.title")}</p>
                <p className="text-sm mt-1">{t("documents.empty.desc")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {selectedIds.length > 0 && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{t("documents.bulk.selected", { count: selectedIds.length })}</span>
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={handleBulkScan} disabled={bulkScanning}>
                    {bulkScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                    {bulkScanning
                      ? bulkScanProgress
                        ? t("documents.bulk.scanningProgress", { completed: bulkScanProgress.completed, total: bulkScanProgress.total })
                        : t("documents.bulk.scanningInProgress")
                      : t("documents.bulk.scanSecurity")}
                  </Button>
                  {bulkScanning && (
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={handleCancelBulkScan} disabled={bulkScanCancelling}>
                      <X className="w-3 h-3" />
                      {bulkScanCancelling ? t("documents.bulk.stopping") : t("documents.bulk.cancelScan")}
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" className="gap-1 h-7 text-xs" onClick={handleBulkDelete} disabled={bulkScanning}><Trash2 className="w-3 h-3" />{t("documents.bulk.deleteSelection")}</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds([])} disabled={bulkScanning}>{t("common.cancel")}</Button>
                </div>
              )}
              {filtered.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 rounded-lg border">
                  <Checkbox checked={selectedIds.length === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
                  <span className="text-xs text-muted-foreground">{t("documents.bulk.selectAll", { count: filtered.length })}</span>
                </div>
              )}
              {pagedDocs.map(doc => {
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
                              {ENTITY_LABELS[doc.entityType] ? t(`documents.entities.${doc.entityType}`) : doc.entityType}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {CATEGORY_LABELS[doc.category] ? t(`documents.categories.${doc.category}`) : doc.category}
                          </Badge>
                          {doc.aiProcessed && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-violet-500/10 text-violet-600">
                              <Sparkles className="w-2.5 h-2.5" /> {t("documents.badges.ai")}
                            </Badge>
                          )}
                          {doc.scanVerdict === "safe" && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 gap-1 bg-emerald-500/10 text-emerald-600"
                              title={`${t("documents.badges.scanTitle", { engine: doc.scanEngine || t("documents.badges.engineFallback") })}${doc.scannedAt ? ` — ${new Date(doc.scannedAt).toLocaleDateString("fr-FR")}` : ""}`}
                            >
                              <ShieldCheck className="w-2.5 h-2.5" />
                              {doc.scanEngine ? t("documents.badges.verifiedWith", { engine: doc.scanEngine }) : t("documents.badges.verified")}
                            </Badge>
                          )}
                          {doc.scanVerdict === "dangerous" && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-red-500/10 text-red-600">
                              <ShieldAlert className="w-2.5 h-2.5" /> {t("documents.badges.threat")}
                            </Badge>
                          )}
                          {!doc.scanVerdict && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-slate-500/10 text-slate-500">
                              <ShieldQuestion className="w-2.5 h-2.5" /> {t("documents.badges.unscanned")}
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
                            title={t("documents.actions.scanSecurity")}
                            onClick={() => rescanDoc(doc.id)}
                            disabled={scanningId === doc.id}
                          >
                            {scanningId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                          </Button>
                        )}
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-500/10"
                          title={t("documents.actions.createProject")}
                          onClick={async () => {
                            const res = await fetch(`${API}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: t("documents.project.title", { name: doc.fileName }), status: "planifie", priority: "moyenne", progress: 0, notes: t("documents.project.notes", { name: doc.fileName }) }) });
                            if (res.ok) { toast({ title: t("documents.toast.projectCreated") }); setLocation("/projets"); }
                            else toast({ title: t("documents.toast.error"), variant: "destructive" });
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
              {docTotalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    {t("documents.pagination", { count: filtered.length, page: docPage + 1, pages: docTotalPages })}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={docPage === 0} onClick={() => setDocPage(p => p - 1)} aria-label={t("documents.pager.prev")}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={docPage >= docTotalPages - 1} onClick={() => setDocPage(p => p + 1)} aria-label={t("documents.pager.next")}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
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
                <div><span className="text-muted-foreground">{t("documents.detail.type")}</span> <span className="ml-2">{selectedDoc.mimeType}</span></div>
                <div><span className="text-muted-foreground">{t("documents.detail.size")}</span> <span className="ml-2">{formatSize(selectedDoc.fileSize)}</span></div>
                <div><span className="text-muted-foreground">{t("documents.detail.category")}</span> <span className="ml-2">{CATEGORY_LABELS[selectedDoc.category] ? t(`documents.categories.${selectedDoc.category}`) : selectedDoc.category}</span></div>
                <div><span className="text-muted-foreground">{t("documents.detail.status")}</span> <span className="ml-2">{selectedDoc.status}</span></div>
                {selectedDoc.entityType && (
                  <div><span className="text-muted-foreground">{t("documents.detail.module")}</span> <span className="ml-2">{ENTITY_LABELS[selectedDoc.entityType] ? t(`documents.entities.${selectedDoc.entityType}`) : selectedDoc.entityType}</span></div>
                )}
                <div><span className="text-muted-foreground">{t("documents.detail.date")}</span> <span className="ml-2">{new Date(selectedDoc.createdAt).toLocaleString("fr-FR")}</span></div>
              </div>

              {selectedDoc.description && (
                <>
                  <Separator />
                  <div>
                    <h4 className="font-medium text-sm mb-1">{t("documents.detail.description")}</h4>
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
                      {t("documents.detail.scanTitle")}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">{t("documents.detail.verdict")}</span>
                        <span className="ml-2">{selectedDoc.scanVerdict === "safe" ? t("documents.detail.safe") : t("documents.detail.threatDetected")}</span>
                      </div>
                      {selectedDoc.scanEngine && (
                        <div><span className="text-muted-foreground">{t("documents.detail.engine")}</span> <span className="ml-2">{selectedDoc.scanEngine}</span></div>
                      )}
                      {selectedDoc.scannedAt && (
                        <div><span className="text-muted-foreground">{t("documents.detail.scannedAt")}</span> <span className="ml-2">{new Date(selectedDoc.scannedAt).toLocaleString("fr-FR")}</span></div>
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
                      <ShieldQuestion className="w-4 h-4 text-slate-400" /> {t("documents.detail.scanTitle")}
                    </h4>
                    <p className="text-sm text-muted-foreground mb-3">{t("documents.detail.notScanned")}</p>
                    <Button
                      size="sm" variant="outline" className="gap-2"
                      disabled={scanningId === selectedDoc.id}
                      onClick={async () => { await rescanDoc(selectedDoc.id); await viewDetail(selectedDoc.id); }}
                    >
                      {scanningId === selectedDoc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                      {t("documents.actions.scanSecurity")}
                    </Button>
                  </div>
                </>
              )}

              {selectedDoc.aiAnalysis && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-500" /> {t("documents.detail.aiAnalysis")}
                    </h4>
                    {selectedDoc.aiAnalysis.summary && (
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">{selectedDoc.aiAnalysis.summary}</p>
                    )}
                    {selectedDoc.aiAnalysis.documentType && (
                      <div className="flex gap-2">
                        <Badge variant="secondary">{selectedDoc.aiAnalysis.documentType}</Badge>
                        {selectedDoc.aiAnalysis.confidence && (
                          <Badge variant="outline">{t("documents.detail.confidence", { pct: Math.round(selectedDoc.aiAnalysis.confidence * 100) })}</Badge>
                        )}
                      </div>
                    )}
                    {selectedDoc.aiAnalysis.extractedFields && Object.keys(selectedDoc.aiAnalysis.extractedFields).length > 0 && (
                      <div className="space-y-1">
                        <h5 className="text-xs font-medium text-muted-foreground">{t("documents.detail.extractedFields")}</h5>
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
                    <h4 className="font-medium text-sm mb-1">{t("documents.detail.extractedText")}</h4>
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
            <DialogTitle>{t("documents.editDialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("documents.form.category")}</Label>
              <Select value={editDocForm.category} onValueChange={(v) => setEditDocForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(CATEGORY_LABELS).map((k) => (
                    <SelectItem key={k} value={k}>{t(`documents.categories.${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("documents.form.module")}</Label>
              <Select value={editDocForm.entityType || "none"} onValueChange={(v) => setEditDocForm(f => ({ ...f, entityType: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder={t("documents.form.none")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("documents.form.none")}</SelectItem>
                  {Object.keys(ENTITY_LABELS).map((k) => (
                    <SelectItem key={k} value={k}>{t(`documents.entities.${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("documents.form.description")}</Label>
              <Textarea
                value={editDocForm.description}
                onChange={(e) => setEditDocForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t("documents.form.descriptionPlaceholder")}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingDoc(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleUpdateDoc} disabled={editDocSaving}>
              {editDocSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
