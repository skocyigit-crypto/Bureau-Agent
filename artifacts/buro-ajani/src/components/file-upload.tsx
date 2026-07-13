import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload, FileUp, FileText, FileSpreadsheet, Image as ImageIcon,
  File, Loader2, Trash2, CheckCircle2, XCircle, Eye, Download,
  Brain, Sparkles, X,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

const ACCEPT_ALL = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.xlsx,.xls,.csv,.docx,.doc,.txt,.rtf,.pptx,.ppt,.json,.xml,.zip";

const MIME_ICONS: Record<string, typeof FileText> = {
  "application/pdf": FileText,
  "image/": ImageIcon,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": FileSpreadsheet,
  "application/vnd.ms-excel": FileSpreadsheet,
  "text/csv": FileSpreadsheet,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileText,
};

function getFileIcon(mimeType: string) {
  for (const [key, Icon] of Object.entries(MIME_ICONS)) {
    if (mimeType.startsWith(key)) return Icon;
  }
  return File;
}

function formatSize(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} Mo`;
  return `${(bytes / 1024).toFixed(0)} Ko`;
}

interface UploadedDoc {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileSizeFormatted?: string;
  status: string;
  aiProcessed: boolean;
  category: string;
  createdAt: string;
  description?: string;
  tags?: string[];
}

interface FileUploadProps {
  entityType?: string;
  entityId?: number;
  category?: string;
  analyzeWithAi?: boolean;
  maxFiles?: number;
  compact?: boolean;
  onUploadComplete?: (doc: UploadedDoc) => void;
  onDocumentsChange?: (docs: UploadedDoc[]) => void;
  className?: string;
}

export function FileUpload({
  entityType,
  entityId,
  category = "general",
  analyzeWithAi = false,
  maxFiles = 20,
  compact = false,
  onUploadComplete,
  onDocumentsChange,
  className = "",
}: FileUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const loadDocuments = useCallback(async () => {
    if (!entityType || !entityId) return;
    setLoadingDocs(true);
    try {
      const res = await fetch(`${API}/api/documents/entity/${entityType}/${entityId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
        onDocumentsChange?.(data.documents || []);
      }
    } catch { /* ignore */ } finally {
      setLoadingDocs(false);
    }
  }, [entityType, entityId, onDocumentsChange]);

  useEffect(() => {
    if (entityType && entityId) loadDocuments();
  }, [entityType, entityId]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const uploadFile = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: `${file.name} depasse 25 Mo`, variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadProgress(10);

    try {
      const base64 = await fileToBase64(file);
      setUploadProgress(40);

      const res = await fetch(`${API}/api/documents/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fileContent: base64,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          entityType,
          entityId,
          category,
          analyzeWithAi,
        }),
      });

      setUploadProgress(80);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Echec de l'upload");
      }

      const data = await res.json();
      setUploadProgress(100);

      const newDoc: UploadedDoc = data.document;
      setDocuments(prev => {
        const updated = [newDoc, ...prev];
        onDocumentsChange?.(updated);
        return updated;
      });
      onUploadComplete?.(newDoc);

      toast({
        title: "Document telecharge",
        description: data.aiAnalysis ? `${file.name} — analyse IA terminee` : file.name,
      });
    } catch (err: any) {
      toast({ title: "Erreur d'upload", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).slice(0, maxFiles);
    for (const file of files) {
      await uploadFile(file);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const deleteDocument = async (docId: number) => {
    try {
      const res = await fetch(`${API}/api/documents/${docId}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        setDocuments(prev => {
          const updated = prev.filter(d => d.id !== docId);
          onDocumentsChange?.(updated);
          return updated;
        });
        toast({ title: "Document supprime" });
      }
    } catch {
      toast({ title: "Erreur de suppression", variant: "destructive" });
    }
  };

  const downloadDocument = async (docId: number, fileName: string) => {
    try {
      const res = await fetch(`${API}/api/documents/${docId}/download`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Erreur de telechargement", variant: "destructive" });
    }
  };

  const analyzeDoc = async (docId: number) => {
    try {
      const res = await fetch(`${API}/api/documents/${docId}/analyze`, { method: "POST", credentials: "include" });
      if (res.ok) {
        toast({ title: "Analyse IA terminee" });
        loadDocuments();
      }
    } catch {
      toast({ title: "Erreur d'analyse", variant: "destructive" });
    }
  };

  if (compact) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div
          className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-all cursor-pointer ${
            isDragging ? "border-violet-500 bg-violet-500/5" : "border-muted-foreground/20 hover:border-violet-500/50"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" className="hidden" accept={ACCEPT_ALL} multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          {uploading ? (
            <div className="space-y-2">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-violet-500" />
              <Progress value={uploadProgress} className="h-1" />
            </div>
          ) : (
            <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
              <Upload className="w-4 h-4" />
              <span>Deposer ou cliquer — PDF, Excel, Word, CSV, images</span>
            </div>
          )}
        </div>

        {documents.length > 0 && (
          <div className="space-y-1">
            {documents.map(doc => {
              const Icon = getFileIcon(doc.mimeType);
              return (
                <div key={doc.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 group text-sm">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{doc.fileName}</span>
                  {doc.aiProcessed && <Sparkles className="w-3 h-3 text-violet-500" />}
                  <span className="text-xs text-muted-foreground shrink-0">{formatSize(doc.fileSize)}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); downloadDocument(doc.id, doc.fileName); }} className="p-1 hover:text-blue-500"><Download className="w-3 h-3" /></button>
                    {!doc.aiProcessed && <button onClick={(e) => { e.stopPropagation(); analyzeDoc(doc.id); }} className="p-1 hover:text-violet-500"><Brain className="w-3 h-3" /></button>}
                    <button onClick={(e) => { e.stopPropagation(); deleteDocument(doc.id); }} className="p-1 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <Card
        className={`border-2 border-dashed transition-all duration-200 ${
          isDragging ? "border-violet-500 bg-violet-500/5 scale-[1.005]" : "border-muted-foreground/20 hover:border-violet-500/50"
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <CardContent className="p-6 text-center">
          <input ref={fileInputRef} type="file" className="hidden" accept={ACCEPT_ALL} multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} />

          {uploading ? (
            <div className="space-y-3">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-500" />
              <p className="text-sm text-muted-foreground">Telechargement en cours...</p>
              <Progress value={uploadProgress} className="max-w-xs mx-auto" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-600/10 flex items-center justify-center mx-auto">
                <Upload className="w-7 h-7 text-violet-500" />
              </div>
              <div>
                <h3 className="font-semibold">Deposez vos fichiers ici</h3>
                <p className="text-muted-foreground text-xs mt-1">
                  PDF, Excel, Word, CSV, images, texte — max 25 Mo
                </p>
              </div>
              <Button onClick={() => fileInputRef.current?.click()} size="sm" className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700">
                <FileUp className="w-4 h-4" />
                Choisir des fichiers
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loadingDocs && (
        <div className="flex items-center justify-center py-4 text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Chargement des documents...
        </div>
      )}

      {documents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-muted-foreground">{documents.length} document(s) attache(s)</h4>
          </div>
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {documents.map(doc => {
                const Icon = getFileIcon(doc.mimeType);
                return (
                  <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 group transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.fileName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{formatSize(doc.fileSize)}</span>
                        {doc.aiProcessed && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                            <Sparkles className="w-2.5 h-2.5" /> IA
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{doc.category}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => downloadDocument(doc.id, doc.fileName)}>
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      {!doc.aiProcessed && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => analyzeDoc(doc.id)}>
                          <Brain className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-500" onClick={() => deleteDocument(doc.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

export function DocumentsPanel({ entityType, entityId }: { entityType: string; entityId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [docCount, setDocCount] = useState(0);

  return (
    <Card>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between p-4 hover:bg-accent/30 transition-colors rounded-t-lg">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-violet-500" />
          <span className="font-medium text-sm">Documents & Fichiers</span>
          {docCount > 0 && <Badge variant="secondary" className="text-xs">{docCount}</Badge>}
        </div>
        {expanded ? <X className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
      </button>
      {expanded && (
        <CardContent className="pt-0">
          <FileUpload
            entityType={entityType}
            entityId={entityId}
            analyzeWithAi={false}
            compact
            onDocumentsChange={(docs) => setDocCount(docs.length)}
          />
        </CardContent>
      )}
    </Card>
  );
}
