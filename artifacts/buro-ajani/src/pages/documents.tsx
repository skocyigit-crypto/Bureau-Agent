import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FileUpload } from "@/components/file-upload";
import {
  FileText, FileSpreadsheet, Image as ImageIcon, File, Download,
  Trash2, Brain, Sparkles, Search, Filter, BarChart3, HardDrive,
  Upload, Loader2, Eye,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  comptabilite: "Comptabilite",
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
  uploadedBy: number | null;
  createdAt: string;
}

interface Stats {
  totalDocuments: number;
  totalSize: string;
  byEntityType: { entity_type: string; count: number }[];
  byCategory: { category: string; count: number }[];
}

export default function DocumentsPage() {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filterEntity !== "all") params.set("entityType", filterEntity);
      if (filterCategory !== "all") params.set("category", filterCategory);

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
  }, [filterEntity, filterCategory]);

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
          </div>

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
              {filtered.map(doc => {
                const Icon = getFileIcon(doc.mimeType);
                return (
                  <Card key={doc.id} className="hover:bg-accent/30 transition-colors">
                    <CardContent className="p-4 flex items-center gap-4">
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
                          <span className="text-xs text-muted-foreground">
                            {new Date(doc.createdAt).toLocaleDateString("fr-FR")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => viewDetail(doc.id)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => downloadDoc(doc.id, doc.fileName)}>
                          <Download className="w-4 h-4" />
                        </Button>
                        {!doc.aiProcessed && (
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => analyzeDoc(doc.id)} disabled={analyzingId === doc.id}>
                            {analyzingId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                          </Button>
                        )}
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
    </div>
  );
}
