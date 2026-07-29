import { useState, useRef, useCallback } from "react";
import { Upload, FileText, CheckCircle, AlertCircle, ArrowLeft, Download, RefreshCw, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useTranslation } from "@/i18n";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map(line => {
    const vals = line.split(sep).map(v => v.replace(/^"|"$/g, "").trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  }).filter(row => Object.values(row).some(v => v));
}

const SAMPLE_CSV = `Prénom,Nom,Email,Téléphone,Entreprise,Catégorie,Notes
Jean,Dupont,jean.dupont@exemple.fr,0612345678,Dupont SARL,client,Client VIP
Marie,Martin,marie.martin@exemple.fr,0698765432,Martin SAS,prospect,À relancer
Paul,Bernard,,0601020304,,fournisseur,`;

export default function ContactsImportPage() {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) { toast({ title: t("contactsImport.toast.csvRequired"), variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length === 0) { toast({ title: t("contactsImport.toast.emptyFile"), variant: "destructive" }); return; }
      setRows(parsed);
      setResult(null);
    };
    reader.readAsText(file, "UTF-8");
  }, [t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  async function doImport() {
    if (!rows || rows.length === 0) return;
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/contacts/import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ rows }),
      });
      const d = await r.json();
      if (!r.ok) { toast({ title: t("contactsImport.toast.error"), description: d.error, variant: "destructive" }); return; }
      setResult(d);
      toast({ title: t("contactsImport.importedCount", { count: d.imported }) });
    } catch {
      toast({ title: t("contactsImport.toast.networkError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modele_import_contacts.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const PREVIEW_COLS = rows && rows.length > 0 ? Object.keys(rows[0]).slice(0, 6) : [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/contacts"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />{t("common.back")}</Button></Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Upload className="w-6 h-6 text-blue-500" />{t("contactsImport.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("contactsImport.subtitle")}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="border-dashed col-span-2">
          <CardContent className="pt-6">
            <div
              className="border-2 border-dashed border-muted-foreground/20 rounded-xl p-8 text-center hover:border-primary/40 transition-colors cursor-pointer"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="font-medium text-sm">{t("contactsImport.dropHere")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("contactsImport.browseHint")}</p>
              <p className="text-xs text-muted-foreground mt-2">{t("contactsImport.separators")}</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("contactsImport.recognizedColumns")}</CardTitle></CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <p><strong>{t("contactsImport.recognizedCols.firstName")}</strong> {t("contactsImport.recognizedCols.or")} <code>prenom</code>, <code>firstName</code></p>
              <p><strong>{t("contactsImport.recognizedCols.lastName")}</strong> {t("contactsImport.recognizedCols.or")} <code>nom</code>, <code>lastName</code></p>
              <p><strong>{t("contactsImport.recognizedCols.email")}</strong> {t("contactsImport.recognizedCols.or")} <code>email</code></p>
              <p><strong>{t("contactsImport.recognizedCols.phone")}</strong> {t("contactsImport.recognizedCols.or")} <code>telephone</code>, <code>Tel</code></p>
              <p><strong>{t("contactsImport.recognizedCols.company")}</strong> {t("contactsImport.recognizedCols.or")} <code>company</code></p>
              <p><strong>{t("contactsImport.recognizedCols.category")}</strong> : {t("contactsImport.recognizedCols.categoryDesc")}</p>
              <p><strong>{t("contactsImport.recognizedCols.notes")}</strong> : {t("contactsImport.recognizedCols.notesDesc")}</p>
            </CardContent>
          </Card>
          <Button variant="outline" size="sm" className="w-full" onClick={downloadSample}>
            <Download className="w-4 h-4 mr-2" />{t("contactsImport.downloadTemplate")}
          </Button>
        </div>
      </div>

      {rows && rows.length > 0 && !result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4" />{t("contactsImport.previewTitle", { count: rows.length })}</CardTitle>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setRows(null); if (fileRef.current) fileRef.current.value = ""; }}><X className="w-4 h-4 mr-1" />{t("common.cancel")}</Button>
                <Button size="sm" disabled={loading} onClick={doImport}>
                  {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  {t("contactsImport.importCount", { count: rows.length })}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  {PREVIEW_COLS.map(col => <TableHead key={col}>{col}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 10).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                    {PREVIEW_COLS.map(col => <TableCell key={col} className="text-sm max-w-32 truncate">{row[col] || <span className="text-muted-foreground/40">—</span>}</TableCell>)}
                  </TableRow>
                ))}
                {rows.length > 10 && (
                  <TableRow>
                    <TableCell colSpan={PREVIEW_COLS.length + 1} className="text-center text-xs text-muted-foreground py-2">{t("contactsImport.moreRows", { count: rows.length - 10 })}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className={result.skipped === 0 ? "border-emerald-300 dark:border-emerald-700" : "border-amber-300 dark:border-amber-700"}>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-xl ${result.skipped === 0 ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                {result.skipped === 0 ? <CheckCircle className="w-6 h-6 text-emerald-500" /> : <AlertCircle className="w-6 h-6 text-amber-500" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-lg">{t("contactsImport.importedCount", { count: result.imported })}</p>
                <p className="text-sm text-muted-foreground">{result.skipped > 0 ? t("contactsImport.skippedCount", { count: result.skipped }) : t("contactsImport.allImported")}</p>
                {result.errors.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {result.errors.map((e, i) => <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{e}</p>)}
                  </div>
                )}
                <div className="flex gap-2 mt-4">
                  <Link href="/contacts"><Button>{t("contactsImport.viewContacts")}</Button></Link>
                  <Button variant="outline" onClick={() => { setRows(null); setResult(null); if (fileRef.current) fileRef.current.value = ""; }}>{t("contactsImport.newImport")}</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
