import { useState, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload, FileUp, FileText, FileSpreadsheet, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Brain, ArrowRight,
  ArrowLeft, Users, ListChecks, Download, Sparkles, Info,
  ChevronDown, ChevronUp, RotateCcw,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ProcessedRow {
  rowIndex: number;
  fields: Record<string, any>;
  errors: string[];
  warnings: string[];
  duplicateOf?: { id: number; name: string };
  selected?: boolean;
}

interface ProcessResult {
  understood: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  suggestedModule: string;
  suggestedModuleReason: string;
  columns: string[];
  columnMapping: Record<string, string>;
  rows: ProcessedRow[];
  summary: string;
  dataPreview: Record<string, any>[];
}

interface ImportResult {
  success: boolean;
  totalImported: number;
  totalSkipped: number;
  totalErrors: number;
  importedIds: number[];
  errors: { rowIndex: number; error: string }[];
  skipped: { rowIndex: number; reason: string }[];
}

type Step = "upload" | "processing" | "review" | "importing" | "done";

const MODULE_LABELS: Record<string, string> = {
  contacts: "Contacts",
  taches: "Taches",
  aucun: "Aucun",
};

const MODULE_ICONS: Record<string, typeof Users> = {
  contacts: Users,
  taches: ListChecks,
};

const FIELD_LABELS: Record<string, string> = {
  firstName: "Prenom",
  lastName: "Nom",
  email: "Email",
  phone: "Telephone",
  mobile: "Mobile",
  company: "Societe",
  category: "Categorie",
  address: "Adresse",
  notes: "Notes",
  title: "Titre",
  description: "Description",
  status: "Statut",
  priority: "Priorite",
  dueDate: "Echeance",
  assignedTo: "Assigne a",
  name: "Nom",
  subject: "Sujet",
  content: "Contenu",
};

export default function DocumentImportPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [targetModule, setTargetModule] = useState<string>("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: "Maximum 25 Mo", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    setStep("processing");
    setProgress(10);

    try {
      const base64 = await fileToBase64(file);
      setProgress(30);

      const res = await fetch(`${API}/api/documents/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fileContent: base64, fileName: file.name, mimeType: file.type }),
      });

      setProgress(90);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erreur de traitement");
      }

      const result: ProcessResult = await res.json();
      setProcessResult(result);
      setTargetModule(result.suggestedModule);
      const valid = new Set(result.rows.filter(r => r.errors.length === 0).map(r => r.rowIndex));
      setSelectedRows(valid);
      setStep("review");
      setProgress(100);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
      setStep("upload");
      setProgress(0);
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleImport = async () => {
    if (!processResult || !targetModule || targetModule === "aucun") return;

    setStep("importing");
    try {
      const res = await fetch(`${API}/api/documents/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          rows: processResult.rows,
          targetModule,
          skipDuplicates,
          selectedRows: Array.from(selectedRows),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erreur d'importation");
      }

      const result: ImportResult = await res.json();
      setImportResult(result);
      setStep("done");

      toast({
        title: "Importation terminee",
        description: `${result.totalImported} enregistrement(s) importe(s)`,
      });
    } catch (err: any) {
      toast({ title: "Erreur d'importation", description: err.message, variant: "destructive" });
      setStep("review");
    }
  };

  const handleReset = () => {
    setStep("upload");
    setSelectedFile(null);
    setProcessResult(null);
    setImportResult(null);
    setTargetModule("");
    setSelectedRows(new Set());
    setExpandedRows(new Set());
    setProgress(0);
  };

  const toggleRow = (idx: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleAllRows = () => {
    if (!processResult) return;
    const validRows = processResult.rows.filter(r => r.errors.length === 0).map(r => r.rowIndex);
    if (selectedRows.size === validRows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(validRows));
    }
  };

  const toggleExpandRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Import Intelligent</h1>
          <p className="text-muted-foreground">
            Deposez un fichier — l'IA l'analysera, vous montrera ce qu'elle a compris, et ecrira les donnees dans le bon module
          </p>
        </div>
        {step !== "upload" && (
          <Button variant="outline" onClick={handleReset} className="gap-2">
            <RotateCcw className="w-4 h-4" /> Recommencer
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm">
        {["upload", "processing", "review", "importing", "done"].map((s, i) => {
          const labels = ["Fichier", "Analyse IA", "Verification", "Importation", "Termine"];
          const isActive = step === s;
          const isPast = ["upload", "processing", "review", "importing", "done"].indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
              <Badge variant={isActive ? "default" : isPast ? "secondary" : "outline"}
                className={isActive ? "bg-violet-600" : isPast ? "bg-emerald-500/10 text-emerald-600" : ""}>
                {isPast && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {labels[i]}
              </Badge>
            </div>
          );
        })}
      </div>

      {step === "upload" && (
        <Card
          className={`border-2 border-dashed transition-all duration-200 ${
            isDragging ? "border-violet-500 bg-violet-500/5 scale-[1.005]" : "border-muted-foreground/20 hover:border-violet-500/50"
          }`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        >
          <CardContent className="p-12 text-center">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv,.docx,.doc,.pdf,.txt,.rtf,.pptx,.ppt,.png,.jpg,.jpeg"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <div className="space-y-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-600/10 flex items-center justify-center mx-auto">
                <Upload className="w-10 h-10 text-violet-500" />
              </div>
              <div>
                <h3 className="text-xl font-semibold">Deposez votre fichier ici</h3>
                <p className="text-muted-foreground mt-2">
                  Excel, CSV, Word, PDF, images — l'IA detectera automatiquement le contenu
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-3">
                  {[".xlsx", ".csv", ".docx", ".pdf", ".txt"].map(ext => (
                    <Badge key={ext} variant="outline" className="text-xs">{ext}</Badge>
                  ))}
                </div>
              </div>
              <Button onClick={() => fileInputRef.current?.click()} size="lg"
                className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700">
                <FileUp className="w-5 h-5" /> Choisir un fichier
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "processing" && (
        <Card>
          <CardContent className="p-12 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto">
              <Brain className="w-10 h-10 text-violet-500 animate-pulse" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">L'IA analyse votre fichier...</h3>
              <p className="text-muted-foreground mt-1">{selectedFile?.name}</p>
              <p className="text-sm text-muted-foreground mt-2">
                Lecture du contenu, detection des colonnes, extraction des données, verification des doublons...
              </p>
            </div>
            <Progress value={progress} className="max-w-md mx-auto" />
          </CardContent>
        </Card>
      )}

      {step === "review" && processResult && (
        <div className="space-y-6">
          <Card className="border-violet-500/30 bg-violet-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="w-5 h-5 text-violet-500" /> Ce que l'IA a compris
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed">{processResult.understood}</p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-2xl font-bold">{processResult.totalRows}</p>
                  <p className="text-xs text-muted-foreground">Enregistrements detectes</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-2xl font-bold text-emerald-600">{processResult.validRows}</p>
                  <p className="text-xs text-muted-foreground">Valides</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-2xl font-bold text-red-500">{processResult.errorRows}</p>
                  <p className="text-xs text-muted-foreground">Avec erreurs</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-2xl font-bold text-amber-500">{processResult.rows.filter(r => r.duplicateOf).length}</p>
                  <p className="text-xs text-muted-foreground">Doublons</p>
                </div>
              </div>

              {processResult.columns.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Colonnes detectees:</h4>
                  <div className="flex flex-wrap gap-1">
                    {processResult.columns.map(col => (
                      <Badge key={col} variant="secondary" className="text-xs">{col}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Module de destination</CardTitle>
              <CardDescription>
                {processResult.suggestedModuleReason}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Select value={targetModule} onValueChange={setTargetModule}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Module cible" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contacts">Contacts</SelectItem>
                    <SelectItem value="taches">Taches</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="skipDuplicates"
                    checked={skipDuplicates}
                    onCheckedChange={(v) => setSkipDuplicates(v as boolean)}
                  />
                  <label htmlFor="skipDuplicates" className="text-sm">Ignorer les doublons</label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Donnees a importer</CardTitle>
                <CardDescription>{selectedRows.size} sur {processResult.rows.length} selectionne(s)</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={toggleAllRows}>
                {selectedRows.size === processResult.rows.filter(r => r.errors.length === 0).length ? "Tout deselectionner" : "Tout selectionner"}
              </Button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[500px]">
                <div className="space-y-2">
                  {processResult.rows.map((row) => {
                    const hasErrors = row.errors.length > 0;
                    const isDuplicate = !!row.duplicateOf;
                    const isExpanded = expandedRows.has(row.rowIndex);
                    const isSelected = selectedRows.has(row.rowIndex);

                    const displayFields = Object.entries(row.fields).slice(0, 3);
                    const mainLabel = row.fields.firstName
                      ? `${row.fields.firstName} ${row.fields.lastName || ""}`.trim()
                      : row.fields.title || row.fields.name || row.fields.lastName || `Ligne ${row.rowIndex + 1}`;

                    return (
                      <div key={row.rowIndex}
                        className={`border rounded-lg overflow-hidden transition-colors ${
                          hasErrors ? "border-red-500/30 bg-red-500/5" :
                          isDuplicate ? "border-amber-500/30 bg-amber-500/5" :
                          isSelected ? "border-emerald-500/30 bg-emerald-500/5" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3 p-3">
                          <Checkbox
                            checked={isSelected}
                            disabled={hasErrors}
                            onCheckedChange={() => toggleRow(row.rowIndex)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{mainLabel}</span>
                              {hasErrors && <Badge variant="destructive" className="text-[10px]">Erreur</Badge>}
                              {isDuplicate && <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-600">Doublon</Badge>}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                              {displayFields.map(([key, val]) => (
                                <span key={key} className="text-xs text-muted-foreground">
                                  {FIELD_LABELS[key] || key}: <span className="text-foreground">{String(val || "—")}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => toggleExpandRow(row.rowIndex)}>
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                        </div>

                        {isExpanded && (
                          <div className="px-3 pb-3 border-t bg-muted/20">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-3 text-xs">
                              {Object.entries(row.fields).map(([key, val]) => (
                                <div key={key} className="p-2 rounded bg-background border">
                                  <span className="text-muted-foreground">{FIELD_LABELS[key] || key}</span>
                                  <p className="font-medium mt-0.5">{String(val || "—")}</p>
                                </div>
                              ))}
                            </div>
                            {row.errors.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {row.errors.map((e, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs text-red-600">
                                    <XCircle className="w-3 h-3 shrink-0" /> {e}
                                  </div>
                                ))}
                              </div>
                            )}
                            {row.warnings.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {row.warnings.map((w, i) => (
                                  <div key={i} className="flex items-center gap-2 text-xs text-amber-600">
                                    <AlertTriangle className="w-3 h-3 shrink-0" /> {w}
                                  </div>
                                ))}
                              </div>
                            )}
                            {row.duplicateOf && (
                              <div className="mt-2 p-2 rounded bg-amber-500/10 text-xs text-amber-700">
                                <Info className="w-3 h-3 inline mr-1" />
                                Doublon de: {row.duplicateOf.name} (ID: {row.duplicateOf.id})
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleReset} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Annuler
            </Button>
            <Button
              onClick={handleImport}
              disabled={selectedRows.size === 0 || !targetModule || targetModule === "aucun"}
              size="lg"
              className="gap-2 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700"
            >
              <Download className="w-5 h-5" />
              Importer {selectedRows.size} enregistrement(s) dans {MODULE_LABELS[targetModule] || targetModule}
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <Card>
          <CardContent className="p-12 text-center space-y-6">
            <Loader2 className="w-16 h-16 mx-auto text-emerald-500 animate-spin" />
            <div>
              <h3 className="text-xl font-semibold">Importation en cours...</h3>
              <p className="text-muted-foreground mt-1">
                Ecriture de {selectedRows.size} enregistrement(s) dans {MODULE_LABELS[targetModule]}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && importResult && (
        <div className="space-y-6">
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-8 text-center space-y-4">
              <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-500" />
              <h3 className="text-2xl font-bold">Importation terminee!</h3>

              <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-2xl font-bold text-emerald-600">{importResult.totalImported}</p>
                  <p className="text-xs text-muted-foreground">Importes</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-2xl font-bold text-amber-500">{importResult.totalSkipped}</p>
                  <p className="text-xs text-muted-foreground">Ignores</p>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-2xl font-bold text-red-500">{importResult.totalErrors}</p>
                  <p className="text-xs text-muted-foreground">Erreurs</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {importResult.skipped.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> Enregistrements ignores
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  {importResult.skipped.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-mono text-xs">#{s.rowIndex + 1}</span>
                      <span>{s.reason}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {importResult.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" /> Erreurs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  {importResult.errors.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-red-600">
                      <span className="font-mono text-xs">#{e.rowIndex + 1}</span>
                      <span>{e.error}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-center gap-4">
            <Button variant="outline" onClick={handleReset} className="gap-2">
              <RotateCcw className="w-4 h-4" /> Nouveau fichier
            </Button>
            <Button asChild className="gap-2">
              <a href={targetModule === "contacts" ? "/contacts" : "/taches"}>
                <ArrowRight className="w-4 h-4" /> Voir les {MODULE_LABELS[targetModule]}
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
