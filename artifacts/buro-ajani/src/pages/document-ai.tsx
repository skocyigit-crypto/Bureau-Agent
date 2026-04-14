import { useState, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileUp, Brain, CheckCircle2, XCircle, AlertTriangle,
  FileText, Users, ListChecks, Loader2, Sparkles, ArrowRight, Eye,
  Upload, Trash2, RefreshCw, Zap, ChevronDown, ChevronUp,
  MessageSquare,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

type DocumentType =
  | "bon_commande" | "bon_livraison" | "contrat"
  | "cv" | "carte_visite" | "courrier" | "releve_bancaire"
  | "rapport" | "formulaire" | "piece_identite" | "attestation"
  | "note_frais" | "planning" | "inconnu";

type DestinationModule =
  | "contacts" | "taches" | "messages" | "aucun";

interface SuggestedAction {
  action: string;
  module: DestinationModule;
  label: string;
  description: string;
  data: Record<string, any>;
  priority: "haute" | "moyenne" | "basse";
}

interface RelatedEntity {
  type: string;
  id: number;
  name: string;
  matchReason: string;
}

interface AnalysisResult {
  documentType: DocumentType;
  confidence: number;
  title: string;
  summary: string;
  destination: DestinationModule;
  destinationReason: string;
  extractedFields: Record<string, any>;
  suggestedActions: SuggestedAction[];
  relatedEntities: RelatedEntity[];
  warnings: string[];
}

interface ActionResult {
  success: boolean;
  module: string;
  action: string;
  message: string;
  createdId?: number;
}

const DOC_TYPE_LABELS: Record<DocumentType, { label: string; color: string }> = {
  bon_commande: { label: "Bon de commande", color: "bg-purple-500" },
  bon_livraison: { label: "Bon de livraison", color: "bg-violet-500" },
  contrat: { label: "Contrat", color: "bg-amber-600" },
  cv: { label: "CV / Resume", color: "bg-emerald-500" },
  carte_visite: { label: "Carte de visite", color: "bg-teal-500" },
  courrier: { label: "Courrier", color: "bg-slate-500" },
  releve_bancaire: { label: "Releve bancaire", color: "bg-green-600" },
  rapport: { label: "Rapport", color: "bg-cyan-500" },
  formulaire: { label: "Formulaire", color: "bg-pink-500" },
  piece_identite: { label: "Piece d'identite", color: "bg-red-500" },
  attestation: { label: "Attestation", color: "bg-yellow-600" },
  note_frais: { label: "Note de frais", color: "bg-lime-600" },
  planning: { label: "Planning", color: "bg-sky-500" },
  inconnu: { label: "Inconnu", color: "bg-gray-500" },
};

const MODULE_ICONS: Record<DestinationModule, any> = {
  contacts: Users,
  taches: ListChecks,
  messages: MessageSquare,
  aucun: FileText,
};

const MODULE_LABELS: Record<DestinationModule, string> = {
  contacts: "Contacts",
  taches: "Taches",
  messages: "Messages",
  aucun: "Aucun",
};

export default function DocumentAiPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [executingActions, setExecutingActions] = useState<Set<number>>(new Set());
  const [actionResults, setActionResults] = useState<Map<number, ActionResult>>(new Map());
  const [showExtracted, setShowExtracted] = useState(false);
  const [processingHistory, setProcessingHistory] = useState<Array<{ fileName: string; type: string; time: string; actions: number }>>([]);

  const handleFile = useCallback((file: File) => {
    const supportedTypes = [
      "application/pdf",
      "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff",
    ];
    if (!supportedTypes.includes(file.type)) {
      toast({ title: "Format non supporte", description: "Formats acceptes: PDF, PNG, JPEG, WebP, GIF, BMP, TIFF", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: "Taille maximale: 10 Mo", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setAnalysisResult(null);
    setActionResults(new Map());
    setShowExtracted(false);

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setFilePreview(null);
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    setActionResults(new Map());

    try {
      const base64 = await fileToBase64(selectedFile);
      const res = await fetch(`${API}/api/document-ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fileContent: base64,
          mimeType: selectedFile.type,
          fileName: selectedFile.name,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erreur d'analyse");
      }

      const result = await res.json();
      setAnalysisResult(result);
      toast({
        title: "Analyse terminee",
        description: `Document identifie: ${DOC_TYPE_LABELS[result.documentType as DocumentType]?.label || result.documentType} (${Math.round(result.confidence * 100)}% confiance)`,
      });
    } catch (err: any) {
      toast({ title: "Erreur d'analyse", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExecuteAction = async (action: SuggestedAction, index: number) => {
    setExecutingActions(prev => new Set(prev).add(index));

    try {
      const res = await fetch(`${API}/api/document-ai/execute-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          extractedFields: analysisResult?.extractedFields || {},
        }),
      });

      const result = await res.json();
      setActionResults(prev => new Map(prev).set(index, result));

      if (result.success) {
        toast({ title: "Action executee", description: result.message });
      } else {
        toast({ title: "Echec de l'action", description: result.message, variant: "destructive" });
      }
    } catch (err: any) {
      setActionResults(prev => new Map(prev).set(index, {
        success: false, module: action.module, action: action.action, message: err.message,
      }));
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setExecutingActions(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  const handleExecuteAll = async () => {
    if (!analysisResult) return;
    const unexecuted = analysisResult.suggestedActions
      .map((a, i) => ({ action: a, index: i }))
      .filter(({ index }) => !actionResults.has(index));

    for (const { action, index } of unexecuted) {
      await handleExecuteAction(action, index);
    }

    setProcessingHistory(prev => [{
      fileName: selectedFile?.name || "",
      type: analysisResult.documentType,
      time: new Date().toLocaleTimeString("fr-FR"),
      actions: unexecuted.length,
    }, ...prev.slice(0, 9)]);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setFilePreview(null);
    setAnalysisResult(null);
    setActionResults(new Map());
    setShowExtracted(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            Document IA
          </h1>
          <p className="text-muted-foreground mt-1">
            Deposez n'importe quel document — l'IA l'analysera, l'identifiera et le classera automatiquement dans le bon module.
          </p>
        </div>
        {analysisResult && (
          <Button variant="outline" onClick={handleReset} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Nouveau document
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {!analysisResult && (
            <Card
              className={`border-2 border-dashed transition-all duration-200 ${
                isDragging
                  ? "border-violet-500 bg-violet-500/5 scale-[1.01]"
                  : "border-muted-foreground/20 hover:border-violet-500/50"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <CardContent className="p-8 md:p-12 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />

                {!selectedFile ? (
                  <div className="space-y-4">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-600/10 flex items-center justify-center mx-auto">
                      <Upload className="w-10 h-10 text-violet-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">Deposez votre document ici</h3>
                      <p className="text-muted-foreground text-sm mt-1">
                        PDF, images (PNG, JPEG, WebP) — max 10 Mo
                      </p>
                    </div>
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
                    >
                      <FileUp className="w-4 h-4" />
                      Choisir un fichier
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filePreview && (
                      <div className="max-w-sm mx-auto rounded-xl overflow-hidden border shadow-sm">
                        <img src={filePreview} alt="Apercu" className="w-full h-auto max-h-64 object-contain bg-muted/50" />
                      </div>
                    )}
                    {!filePreview && (
                      <div className="w-20 h-20 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
                        <FileText className="w-10 h-10 text-red-500" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-lg font-semibold">{selectedFile.name}</h3>
                      <p className="text-muted-foreground text-sm">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} Mo — {selectedFile.type}
                      </p>
                    </div>
                    <div className="flex gap-3 justify-center">
                      <Button
                        onClick={handleAnalyze}
                        disabled={analyzing}
                        className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
                      >
                        {analyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Analyse en cours...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Analyser avec l'IA
                          </>
                        )}
                      </Button>
                      <Button variant="outline" onClick={handleReset} className="gap-2">
                        <Trash2 className="w-4 h-4" />
                        Retirer
                      </Button>
                    </div>
                    {analyzing && (
                      <div className="max-w-md mx-auto space-y-2">
                        <Progress value={undefined} className="h-1.5" />
                        <p className="text-xs text-muted-foreground animate-pulse">
                          L'IA analyse le contenu du document, identifie le type, extrait les donnees et cherche les correspondances...
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {analysisResult && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl ${DOC_TYPE_LABELS[analysisResult.documentType]?.color || "bg-gray-500"} flex items-center justify-center`}>
                        <FileText className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-xl">{analysisResult.title}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="font-medium">
                            {DOC_TYPE_LABELS[analysisResult.documentType]?.label || analysisResult.documentType}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={
                              analysisResult.confidence >= 0.8
                                ? "text-green-600 border-green-300"
                                : analysisResult.confidence >= 0.5
                                ? "text-amber-600 border-amber-300"
                                : "text-red-600 border-red-300"
                            }
                          >
                            {Math.round(analysisResult.confidence * 100)}% confiance
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-muted-foreground">{analysisResult.summary}</p>

                  <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-500/5 border border-violet-500/10">
                    {(() => {
                      const Icon = MODULE_ICONS[analysisResult.destination] || FileText;
                      return <Icon className="w-5 h-5 text-violet-600" />;
                    })()}
                    <div className="flex-1">
                      <span className="font-medium text-sm">
                        Destination recommandee: {MODULE_LABELS[analysisResult.destination] || analysisResult.destination}
                      </span>
                      <p className="text-xs text-muted-foreground">{analysisResult.destinationReason}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-violet-500" />
                  </div>

                  {analysisResult.warnings.length > 0 && (
                    <div className="space-y-2">
                      {analysisResult.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded bg-amber-500/5 border border-amber-500/10 text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                          <span className="text-amber-700 dark:text-amber-400">{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowExtracted(!showExtracted)}
                      className="gap-2 text-muted-foreground"
                    >
                      <Eye className="w-4 h-4" />
                      Donnees extraites
                      {showExtracted ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </Button>
                    {showExtracted && (
                      <div className="mt-2 p-3 rounded-lg bg-muted/50 border">
                        <ScrollArea className="max-h-72">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                            {JSON.stringify(analysisResult.extractedFields, null, 2)}
                          </pre>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {analysisResult.suggestedActions.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <Zap className="w-4 h-4 text-violet-500" />
                          Actions suggerees
                        </CardTitle>
                        <CardDescription>
                          L'IA propose {analysisResult.suggestedActions.length} action(s) basee(s) sur le contenu du document
                        </CardDescription>
                      </div>
                      {analysisResult.suggestedActions.length > 1 && (
                        <Button
                          onClick={handleExecuteAll}
                          disabled={executingActions.size > 0}
                          size="sm"
                          className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600"
                        >
                          <Sparkles className="w-3 h-3" />
                          Tout executer
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {analysisResult.suggestedActions.map((action, i) => {
                      const result = actionResults.get(i);
                      const isExecuting = executingActions.has(i);
                      const Icon = MODULE_ICONS[action.module] || FileText;
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                            result?.success
                              ? "bg-green-500/5 border-green-500/20"
                              : result && !result.success
                              ? "bg-red-500/5 border-red-500/20"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            result?.success ? "bg-green-500/10" : result ? "bg-red-500/10" : "bg-violet-500/10"
                          }`}>
                            {result?.success ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            ) : result ? (
                              <XCircle className="w-4 h-4 text-red-600" />
                            ) : (
                              <Icon className="w-4 h-4 text-violet-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{action.label}</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {MODULE_LABELS[action.module]}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 ${
                                  action.priority === "haute"
                                    ? "text-red-600 border-red-300"
                                    : action.priority === "basse"
                                    ? "text-gray-500 border-gray-300"
                                    : "text-amber-600 border-amber-300"
                                }`}
                              >
                                {action.priority}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                            {result && (
                              <p className={`text-xs mt-1 font-medium ${result.success ? "text-green-600" : "text-red-600"}`}>
                                {result.message}
                                {result.createdId && ` (ID: ${result.createdId})`}
                              </p>
                            )}
                          </div>
                          {!result && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleExecuteAction(action, i)}
                              disabled={isExecuting}
                              className="shrink-0"
                            >
                              {isExecuting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                "Executer"
                              )}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        <div className="space-y-6">
          {analysisResult?.relatedEntities && analysisResult.relatedEntities.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-500" />
                  Entites liees
                </CardTitle>
                <CardDescription>
                  Correspondances trouvees dans votre base de donnees
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {analysisResult.relatedEntities.map((entity, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg border text-sm">
                    <div className="w-7 h-7 rounded bg-violet-500/10 flex items-center justify-center shrink-0">
                      <Users className="w-3.5 h-3.5 text-violet-600" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium block truncate">{entity.name}</span>
                      <span className="text-xs text-muted-foreground">{entity.matchReason}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Types de documents reconnus</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(DOC_TYPE_LABELS)
                  .filter(([k]) => k !== "inconnu")
                  .map(([key, { label, color }]) => (
                    <div
                      key={key}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                        analysisResult?.documentType === key
                          ? "bg-violet-500/10 border border-violet-500/20 font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
                      {label}
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Modules de destination</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {Object.entries(MODULE_LABELS)
                  .filter(([k]) => k !== "aucun")
                  .map(([key, label]) => {
                    const Icon = MODULE_ICONS[key as DestinationModule];
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                          analysisResult?.destination === key
                            ? "bg-violet-500/10 border border-violet-500/20 font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>

          {processingHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Historique de session</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {processingHistory.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/50">
                      <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium truncate block">{h.fileName}</span>
                        <span className="text-muted-foreground">
                          {DOC_TYPE_LABELS[h.type as DocumentType]?.label || h.type} — {h.actions} action(s) — {h.time}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
