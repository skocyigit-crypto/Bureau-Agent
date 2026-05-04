import { useState, useEffect, useCallback } from "react";
import { AlertCircle, Clock, CheckCircle2, Mail, RefreshCw, Euro, Calendar, ExternalLink, Search, Download, Printer, FolderKanban } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function fmt(v: any) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v)) + " €";
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}
function daysOverdue(dueDate: string): number {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
}

interface OverdueFacture {
  id: number; reference: string; clientName: string; clientEmail?: string;
  totalAmount: string; paidAmount: string; dueDate: string; status: string;
}

export default function RelancesPage() {
  const [, setLocation] = useLocation();
  const [factures, setFactures] = useState<OverdueFacture[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [retardFilter, setRetardFilter] = useState("all");
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/factures-client?overdue=true&limit=100&sortBy=dueDate&sortOrder=asc`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setFactures(d.data || []);
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les relances.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendRelance(f: OverdueFacture) {
    if (!f.clientEmail) { toast({ title: "Email manquant", description: "Aucun email enregistré pour ce client.", variant: "destructive" }); return; }
    setSending(f.id);
    try {
      const res = await fetch(`${BASE}/api/factures-client/${f.id}/send`, { method: "POST", credentials: "include" });
      const d = await res.json();
      if (res.ok) toast({ title: "Relance envoyée", description: `Email envoyé à ${f.clientEmail}` });
      else toast({ title: "Erreur", description: d.error, variant: "destructive" });
    } finally {
      setSending(null);
    }
  }

  const totalDue = factures.reduce((acc, f) => acc + Math.max(0, Number(f.totalAmount) - Number(f.paidAmount || 0)), 0);
  const critiques = factures.filter(f => daysOverdue(f.dueDate) >= 30);
  const withEmail = factures.filter(f => f.clientEmail);

  const filtered = factures.filter(f => {
    const q = search.toLowerCase();
    const matchSearch = !q || f.clientName.toLowerCase().includes(q) || f.reference.toLowerCase().includes(q);
    const days = daysOverdue(f.dueDate);
    const matchRetard = retardFilter === "all" || (retardFilter === "7" && days >= 7) || (retardFilter === "30" && days >= 30) || (retardFilter === "60" && days >= 60);
    return matchSearch && matchRetard;
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-red-500" />
            Relances Clients
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Factures en retard de paiement</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Actualiser
          </Button>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-red-200 dark:border-red-900/30">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10"><Euro className="w-5 h-5 text-red-500" /></div>
              <div>
                <p className="text-2xl font-bold text-red-600">{fmt(totalDue)}</p>
                <p className="text-xs text-muted-foreground">Total en souffrance</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 dark:border-amber-900/30">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10"><Clock className="w-5 h-5 text-amber-500" /></div>
              <div>
                <p className="text-2xl font-bold">{factures.length}</p>
                <p className="text-xs text-muted-foreground">Factures en retard · {critiques.length} &gt; 30j</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 dark:border-blue-900/30">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><Mail className="w-5 h-5 text-blue-500" /></div>
              <div>
                <p className="text-2xl font-bold">{withEmail.length}</p>
                <p className="text-xs text-muted-foreground">Avec email disponible</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
            <div>
              <CardTitle className="text-base">Factures en retard</CardTitle>
              <CardDescription>Triées par date d'échéance croissante — les plus urgentes en premier</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Client ou ref..." className="h-8 pl-7 w-44 text-xs" />
              </div>
              <Select value={retardFilter} onValueChange={setRetardFilter}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous retards</SelectItem>
                  <SelectItem value="7">&gt; 7 jours</SelectItem>
                  <SelectItem value="30">&gt; 30 jours</SelectItem>
                  <SelectItem value="60">&gt; 60 jours</SelectItem>
                </SelectContent>
              </Select>
              <a href={`${BASE}/api/factures-client/export/csv?overdue=true`} download="relances.csv"><Button variant="outline" size="icon" className="h-8 w-8" title="Exporter CSV"><Download className="w-3.5 h-3.5" /></Button></a>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-t rounded-b-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Référence</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden sm:table-cell w-28">Échéance</TableHead>
                  <TableHead className="w-24">Retard</TableHead>
                  <TableHead className="text-right w-32">Solde dû</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(4)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(6)].map((_, j) => <TableCell key={j}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell>)}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30 text-emerald-500" />
                      <p>{factures.length === 0 ? "Aucune facture en retard — Bravo !" : "Aucun résultat pour ces filtres."}</p>
                    </TableCell>
                  </TableRow>
                ) : filtered.map(f => {
                  const days = daysOverdue(f.dueDate);
                  const remaining = Math.max(0, Number(f.totalAmount) - Number(f.paidAmount || 0));
                  const urgencyClass = days >= 60 ? "text-red-600 dark:text-red-400" : days >= 30 ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400";
                  return (
                    <TableRow key={f.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-medium">{f.reference}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{f.clientName}</div>
                        {f.clientEmail && <div className="text-xs text-muted-foreground">{f.clientEmail}</div>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs">{fmtDate(f.dueDate)}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs font-medium ${days >= 60 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : days >= 30 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"}`}>
                          {days}j
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-sm text-red-600 dark:text-red-400">{fmt(remaining)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {f.clientEmail && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              disabled={sending === f.id}
                              onClick={() => sendRelance(f)}
                              title="Envoyer une relance par email"
                            >
                              {sending === f.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                            </Button>
                          )}
                          <Link href="/factures-client">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Voir la facture">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-500/10"
                            title="Créer un projet de recouvrement"
                            onClick={async () => {
                              const res = await fetch(`${BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: `Recouvrement - ${f.clientName}`, status: "planifie", priority: days >= 60 ? "haute" : days >= 30 ? "moyenne" : "basse", progress: 0, clientName: f.clientName, notes: `Relance créée depuis la facture ${f.reference} — ${days} jour(s) de retard` }) });
                              if (res.ok) { toast({ title: "Projet créé" }); setLocation("/projets"); }
                              else toast({ title: "Erreur", variant: "destructive" });
                            }}
                          >
                            <FolderKanban className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {factures.length > 0 && withEmail.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">Envoyer des relances groupées</p>
                <p className="text-xs text-muted-foreground">{withEmail.length} client{withEmail.length !== 1 ? "s" : ""} avec email disponible</p>
              </div>
              <Button
                size="sm"
                disabled={sending !== null}
                onClick={async () => {
                  let sent = 0;
                  for (const f of withEmail) {
                    if (!f.clientEmail) continue;
                    await fetch(`${BASE}/api/factures-client/${f.id}/send`, { method: "POST", credentials: "include" });
                    sent++;
                  }
                  toast({ title: "Relances envoyées", description: `${sent} email${sent !== 1 ? "s" : ""} envoyé${sent !== 1 ? "s" : ""}` });
                }}
              >
                <Mail className="w-4 h-4 mr-2" />Tout relancer ({withEmail.length})
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
