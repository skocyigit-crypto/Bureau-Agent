import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Icon3D } from "@/components/icon-3d";
import stockWarehouseImg from "@/assets/images/stock-warehouse.png";
import {
  useListStockArticles,
  useCreateStockArticle,
  useUpdateStockArticle,
  useDeleteStockArticle,
  useGetStockStats,
  useImportStockPdf,
} from "@workspace/api-client-react";
import {
  Package,
  Plus,
  Search,
  ScanLine,
  FileUp,
  Trash2,
  Edit,
  AlertTriangle,
  PackageX,
  PackageCheck,
  ArrowUpDown,
  X,
  Camera,
  StopCircle,
  Loader2,
  QrCode,
  Download,
} from "lucide-react";

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "fourniture", label: "Fourniture de bureau" },
  { value: "informatique", label: "Informatique" },
  { value: "mobilier", label: "Mobilier" },
  { value: "consommable", label: "Consommable" },
  { value: "papeterie", label: "Papeterie" },
  { value: "hygiene", label: "Hygiene" },
  { value: "alimentaire", label: "Alimentaire" },
  { value: "autre", label: "Autre" },
];

const UNITS = [
  { value: "piece", label: "Piece" },
  { value: "boite", label: "Boite" },
  { value: "carton", label: "Carton" },
  { value: "paquet", label: "Paquet" },
  { value: "litre", label: "Litre" },
  { value: "kg", label: "Kilogramme" },
  { value: "lot", label: "Lot" },
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  en_stock: { label: "En stock", color: "bg-emerald-100 text-emerald-700" },
  stock_faible: { label: "Stock faible", color: "bg-amber-100 text-amber-700" },
  rupture: { label: "Rupture", color: "bg-red-100 text-red-700" },
  commande: { label: "En commande", color: "bg-blue-100 text-blue-700" },
};

function QrScannerModal({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [manualCode, setManualCode] = useState("");

  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
        scanFrame();
      }
    } catch (e: any) {
      setError("Impossible d'acceder a la camera. Utilisez la saisie manuelle.");
    }
  }, []);

  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const code = await detectBarcodeNative(video);
    if (code) {
      onScan(code);
      stopCamera();
      onClose();
      return;
    }

    animRef.current = requestAnimationFrame(scanFrame);
  }, [onScan, onClose, stopCamera]);

  useEffect(() => {
    if (!open) stopCamera();
  }, [open, stopCamera]);

  const handleManualSubmit = () => {
    if (manualCode.trim()) {
      onScan(manualCode.trim());
      setManualCode("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { stopCamera(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="w-5 h-5" />
            Scanner un code-barres / QR code
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-amber-400 rounded-lg animate-pulse" />
              </div>
            )}
            {!scanning && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button onClick={startCamera} variant="secondary" size="lg">
                  <Camera className="w-5 h-5 mr-2" />
                  Activer la camera
                </Button>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <p className="text-white text-sm text-center">{error}</p>
              </div>
            )}
          </div>

          {scanning && (
            <Button onClick={stopCamera} variant="outline" className="w-full">
              <StopCircle className="w-4 h-4 mr-2" />
              Arreter le scan
            </Button>
          )}

          <div className="border-t pt-4">
            <Label className="text-sm font-medium">Saisie manuelle du code</Label>
            <div className="flex gap-2 mt-2">
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Entrez le code-barres ou la reference..."
                onKeyDown={(e) => { if (e.key === "Enter") handleManualSubmit(); }}
              />
              <Button onClick={handleManualSubmit} disabled={!manualCode.trim()}>
                Rechercher
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function detectBarcodeNative(video: HTMLVideoElement): Promise<string | null> {
  if ("BarcodeDetector" in window) {
    try {
      const detector = new (window as any).BarcodeDetector({
        formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"],
      });
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) return barcodes[0].rawValue;
    } catch {}
  }
  return null;
}

function ArticleFormDialog({
  open,
  onClose,
  initialData,
  onSubmit,
  isLoading,
  title,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: any;
  onSubmit: (data: any) => void;
  isLoading: boolean;
  title: string;
}) {
  const [form, setForm] = useState({
    name: initialData?.name || "",
    reference: initialData?.reference || "",
    barcode: initialData?.barcode || "",
    description: initialData?.description || "",
    category: initialData?.category || "general",
    quantity: initialData?.quantity?.toString() || "0",
    minQuantity: initialData?.minQuantity?.toString() || "5",
    unitPrice: initialData?.unitPrice || "",
    supplier: initialData?.supplier || "",
    location: initialData?.location || "",
    unit: initialData?.unit || "piece",
    notes: initialData?.notes || "",
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name || "",
        reference: initialData.reference || "",
        barcode: initialData.barcode || "",
        description: initialData.description || "",
        category: initialData.category || "general",
        quantity: initialData.quantity?.toString() || "0",
        minQuantity: initialData.minQuantity?.toString() || "5",
        unitPrice: initialData.unitPrice || "",
        supplier: initialData.supplier || "",
        location: initialData.location || "",
        unit: initialData.unit || "piece",
        notes: initialData.notes || "",
      });
    }
  }, [initialData]);

  const handleSubmit = () => {
    onSubmit({
      ...form,
      quantity: parseInt(form.quantity) || 0,
      minQuantity: parseInt(form.minQuantity) || 5,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nom *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nom de l'article" />
          </div>
          <div className="space-y-2">
            <Label>Reference *</Label>
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="REF-0001" />
          </div>
          <div className="space-y-2">
            <Label>Code-barres</Label>
            <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Code-barres / EAN" />
          </div>
          <div className="space-y-2">
            <Label>Categorie</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Quantite</Label>
            <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Quantite minimale</Label>
            <Input type="number" value={form.minQuantity} onChange={(e) => setForm({ ...form, minQuantity: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Prix unitaire</Label>
            <Input value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder="0.00" />
          </div>
          <div className="space-y-2">
            <Label>Unite</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Fournisseur</Label>
            <Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Nom du fournisseur" />
          </div>
          <div className="space-y-2">
            <Label>Emplacement</Label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Bureau A, Etagere 3..." />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description de l'article" rows={2} />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes supplementaires" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={isLoading || !form.name || !form.reference}>
            {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {initialData ? "Modifier" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PdfImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [pdfBase64, setPdfBase64] = useState("");
  const [fileName, setFileName] = useState("");
  const importMutation = useImportStockPdf();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast({ title: "Erreur", description: "Veuillez selectionner un fichier PDF", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setPdfBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleImport = () => {
    if (!pdfBase64) return;
    importMutation.mutate(
      { data: { pdfContent: pdfBase64 } },
      {
        onSuccess: (data: any) => {
          toast({
            title: "Importation terminee",
            description: `${data.imported} article(s) importe(s) avec succes.${data.errors?.length ? ` ${data.errors.length} erreur(s).` : ""}`,
          });
          setPdfBase64("");
          setFileName("");
          onClose();
        },
        onError: (error: any) => {
          toast({ title: "Erreur d'importation", description: error.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="w-5 h-5" />
            Importer depuis un PDF (IA)
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            L'intelligence artificielle analysera votre document PDF (bon de livraison, facture, catalogue fournisseur...) et extraira automatiquement les articles de stock.
          </p>

          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            {fileName ? (
              <div className="flex items-center justify-center gap-2">
                <FileUp className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium">{fileName}</span>
                <Button variant="ghost" size="sm" onClick={() => { setPdfBase64(""); setFileName(""); }}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="cursor-pointer">
                <input type="file" accept=".pdf" onChange={handleFileSelect} className="hidden" />
                <div className="space-y-2">
                  <FileUp className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Cliquez pour selectionner un fichier PDF</p>
                  <p className="text-xs text-muted-foreground">Factures, bons de livraison, catalogues...</p>
                </div>
              </label>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleImport} disabled={!pdfBase64 || importMutation.isPending}>
            {importMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyse IA en cours...
              </>
            ) : (
              <>
                <FileUp className="w-4 h-4 mr-2" />
                Importer avec l'IA
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArticleDetailDialog({ article, open, onClose }: { article: any; open: boolean; onClose: () => void }) {
  if (!article) return null;
  const statusInfo = STATUS_MAP[article.status] || STATUS_MAP.en_stock;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {article.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Reference:</span>
              <p className="font-medium">{article.reference}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Statut:</span>
              <p><Badge className={statusInfo.color}>{statusInfo.label}</Badge></p>
            </div>
            <div>
              <span className="text-muted-foreground">Quantite:</span>
              <p className="font-medium text-lg">{article.quantity} {article.unit}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Quantite min.:</span>
              <p className="font-medium">{article.minQuantity} {article.unit}</p>
            </div>
            {article.unitPrice && (
              <div>
                <span className="text-muted-foreground">Prix unitaire:</span>
                <p className="font-medium">{article.unitPrice} EUR</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Categorie:</span>
              <p className="font-medium">{CATEGORIES.find(c => c.value === article.category)?.label || article.category}</p>
            </div>
            {article.supplier && (
              <div>
                <span className="text-muted-foreground">Fournisseur:</span>
                <p className="font-medium">{article.supplier}</p>
              </div>
            )}
            {article.location && (
              <div>
                <span className="text-muted-foreground">Emplacement:</span>
                <p className="font-medium">{article.location}</p>
              </div>
            )}
            {article.barcode && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Code-barres:</span>
                <div className="flex items-center gap-2 mt-1">
                  <QrCode className="w-5 h-5" />
                  <p className="font-mono text-sm">{article.barcode}</p>
                </div>
              </div>
            )}
          </div>
          {article.description && (
            <div>
              <span className="text-sm text-muted-foreground">Description:</span>
              <p className="text-sm mt-1">{article.description}</p>
            </div>
          )}
          {article.notes && (
            <div>
              <span className="text-sm text-muted-foreground">Notes:</span>
              <p className="text-sm mt-1">{article.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function StockPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<any>(null);
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanNotFound, setScanNotFound] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);

  const { data: articlesData, isLoading, refetch } = useListStockArticles({
    search: search || undefined,
    category: category !== "all" ? category : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    sortBy,
    sortOrder,
    limit: 100,
  });

  const { data: statsData } = useGetStockStats();

  const createMutation = useCreateStockArticle();
  const updateMutation = useUpdateStockArticle();
  const deleteMutation = useDeleteStockArticle();

  const articles = articlesData?.articles || [];
  const total = articlesData?.total || 0;

  const handleCreate = (data: any) => {
    createMutation.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Article cree", description: `"${data.name}" a ete ajoute au stock.` });
          setShowCreateDialog(false);
          refetch();
        },
        onError: (error: any) => {
          toast({ title: "Erreur", description: error.message, variant: "destructive" });
        },
      }
    );
  };

  const handleUpdate = (data: any) => {
    if (!selectedArticle) return;
    updateMutation.mutate(
      { id: selectedArticle.id, data },
      {
        onSuccess: () => {
          toast({ title: "Article modifie", description: `"${data.name}" a ete mis a jour.` });
          setShowEditDialog(false);
          setSelectedArticle(null);
          refetch();
        },
        onError: (error: any) => {
          toast({ title: "Erreur", description: error.message, variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (article: any) => {
    if (!confirm(`Supprimer l'article "${article.name}" ?`)) return;
    deleteMutation.mutate(
      { id: article.id },
      {
        onSuccess: () => {
          toast({ title: "Article supprime", description: `"${article.name}" a ete retire du stock.` });
          refetch();
        },
        onError: (error: any) => {
          toast({ title: "Erreur", description: error.message, variant: "destructive" });
        },
      }
    );
  };

  const handleScan = async (code: string) => {
    setScanLoading(true);
    setScanNotFound(false);
    setScanResult(null);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${baseUrl}/api/stock/scan/${encodeURIComponent(code)}`);
      if (response.ok) {
        const article = await response.json();
        setScanResult(article);
        setSelectedArticle(article);
        setShowDetailDialog(true);
      } else {
        setScanNotFound(true);
        toast({ title: "Article non trouve", description: `Aucun article avec le code "${code}"`, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Erreur de scan", description: "Impossible de rechercher l'article", variant: "destructive" });
    }
    setScanLoading(false);
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortOrder("asc");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3"><Icon3D icon={Package} variant="orange" size="md" /> Gestion du Stock</h1>
          <p className="text-muted-foreground">Gerez vos articles, scannez les codes et importez depuis vos documents.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowScanDialog(true)}>
            <ScanLine className="w-4 h-4 mr-2" />
            Scanner
          </Button>
          <Button variant="outline" onClick={() => setShowPdfDialog(true)}>
            <FileUp className="w-4 h-4 mr-2" />
            Import PDF
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nouvel Article
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={stockWarehouseImg} alt="Gestion du stock" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-orange-900/80 via-orange-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Gestion d'inventaire</h3>
              <p className="text-white/80 text-sm mt-1">Suivi des articles, scan de codes-barres et import intelligent par IA.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-primary/10 p-2.5 rounded-lg">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.totalArticles ?? 0}</p>
              <p className="text-xs text-muted-foreground">Articles total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-emerald-50 p-2.5 rounded-lg">
              <PackageCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{((statsData?.totalValue ?? 0) as number).toFixed(0)} EUR</p>
              <p className="text-xs text-muted-foreground">Valeur totale</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-amber-50 p-2.5 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.lowStockCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">Stock faible</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-red-50 p-2.5 rounded-lg">
              <PackageX className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsData?.outOfStockCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">En rupture</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par nom, reference, code-barres..."
                className="pl-9"
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Categorie" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="en_stock">En stock</SelectItem>
                <SelectItem value="stock_faible">Stock faible</SelectItem>
                <SelectItem value="rupture">Rupture</SelectItem>
                <SelectItem value="commande">En commande</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : articles.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">Aucun article dans le stock</p>
              <p className="text-sm text-muted-foreground mt-1">Ajoutez des articles manuellement ou importez un PDF</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("reference")}>
                      <div className="flex items-center gap-1">Reference <ArrowUpDown className="w-3 h-3" /></div>
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      <div className="flex items-center gap-1">Article <ArrowUpDown className="w-3 h-3" /></div>
                    </th>
                    <th className="text-left p-3 font-medium">Categorie</th>
                    <th className="text-right p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("quantity")}>
                      <div className="flex items-center justify-end gap-1">Quantite <ArrowUpDown className="w-3 h-3" /></div>
                    </th>
                    <th className="text-right p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("unitPrice")}>
                      <div className="flex items-center justify-end gap-1">Prix unit. <ArrowUpDown className="w-3 h-3" /></div>
                    </th>
                    <th className="text-left p-3 font-medium">Statut</th>
                    <th className="text-left p-3 font-medium">Fournisseur</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((article: any) => {
                    const statusInfo = STATUS_MAP[article.status] || STATUS_MAP.en_stock;
                    return (
                      <tr
                        key={article.id}
                        className="border-b hover:bg-muted/20 cursor-pointer transition-colors"
                        onClick={() => { setSelectedArticle(article); setShowDetailDialog(true); }}
                      >
                        <td className="p-3 font-mono text-xs">{article.reference}</td>
                        <td className="p-3">
                          <div>
                            <span className="font-medium">{article.name}</span>
                            {article.barcode && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <QrCode className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground font-mono">{article.barcode}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-xs">
                            {CATEGORIES.find(c => c.value === article.category)?.label || article.category}
                          </Badge>
                        </td>
                        <td className="p-3 text-right font-medium">
                          {article.quantity} <span className="text-muted-foreground text-xs">{article.unit}</span>
                        </td>
                        <td className="p-3 text-right">
                          {article.unitPrice ? `${article.unitPrice} EUR` : "-"}
                        </td>
                        <td className="p-3">
                          <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{article.supplier || "-"}</td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setSelectedArticle(article); setShowEditDialog(true); }}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(article)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
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
          {total > 0 && (
            <div className="p-3 border-t text-sm text-muted-foreground text-center">
              {total} article(s) au total
            </div>
          )}
        </CardContent>
      </Card>

      <QrScannerModal open={showScanDialog} onClose={() => setShowScanDialog(false)} onScan={handleScan} />

      <ArticleFormDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
        title="Nouvel article"
      />

      <ArticleFormDialog
        open={showEditDialog}
        onClose={() => { setShowEditDialog(false); setSelectedArticle(null); }}
        initialData={selectedArticle}
        onSubmit={handleUpdate}
        isLoading={updateMutation.isPending}
        title="Modifier l'article"
      />

      <PdfImportDialog open={showPdfDialog} onClose={() => { setShowPdfDialog(false); refetch(); }} />

      <ArticleDetailDialog
        article={selectedArticle}
        open={showDetailDialog}
        onClose={() => { setShowDetailDialog(false); setSelectedArticle(null); }}
      />
    </div>
  );
}
