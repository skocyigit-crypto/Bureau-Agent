import { useState } from "react";
import { Search, ShieldCheck, ShieldAlert, ShieldX, ExternalLink, Loader2, Globe, Sparkles, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

type UrlRisk = "safe" | "suspicious" | "dangerous";

interface WebSearchResultItem {
  title: string;
  url: string;
  displayUrl: string;
  domain: string;
  risk: UrlRisk;
  reasons: string[];
  threatTypes?: string[];
}

interface WebSearchResponse {
  query: string;
  answer: string;
  results: WebSearchResultItem[];
}

const RISK_META: Record<UrlRisk, { label: string; badge: string; icon: typeof ShieldCheck; dot: string }> = {
  safe: {
    label: "Sûr",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
    icon: ShieldCheck,
    dot: "text-emerald-500",
  },
  suspicious: {
    label: "Suspect",
    badge: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
    icon: ShieldAlert,
    dot: "text-amber-500",
  },
  dangerous: {
    label: "Dangereux",
    badge: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
    icon: ShieldX,
    dot: "text-red-500",
  },
};

export default function RechercheWebPage() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WebSearchResponse | null>(null);
  const [searched, setSearched] = useState(false);
  const [pendingDanger, setPendingDanger] = useState<WebSearchResultItem | null>(null);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`${baseUrl}/api/web-search`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          toast({ variant: "destructive", title: "Quota IA atteint", description: body.error ?? "Réessayez plus tard." });
        } else {
          toast({ variant: "destructive", title: "Recherche impossible", description: body.error ?? "Une erreur est survenue." });
        }
        setData(null);
        return;
      }
      const json = (await res.json()) as WebSearchResponse;
      setData(json);
    } catch {
      toast({ variant: "destructive", title: "Recherche impossible", description: "Vérifiez votre connexion et réessayez." });
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function openResult(item: WebSearchResultItem) {
    if (item.risk === "dangerous") {
      setPendingDanger(item);
      return;
    }
    window.open(item.url, "_blank", "noopener,noreferrer");
  }

  const counts = data
    ? data.results.reduce(
        (acc, r) => {
          acc[r.risk]++;
          return acc;
        },
        { safe: 0, suspicious: 0, dangerous: 0 } as Record<UrlRisk, number>,
      )
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      {/* En-tête */}
      <div className={searched ? "mb-6" : "mb-8 mt-10 text-center"}>
        {!searched && (
          <div className="mb-6 flex flex-col items-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Globe className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Recherche web sécurisée</h1>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Cherchez sur le web depuis votre espace. Chaque lien est analysé par
              l'antivirus intégré avant que vous ne cliquiez.
            </p>
          </div>
        )}

        <form onSubmit={runSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher sur le web…"
              className="h-11 rounded-full pl-10 pr-4 text-base shadow-sm"
              autoFocus
              maxLength={300}
            />
          </div>
          <Button type="submit" disabled={loading || query.trim().length < 2} className="h-11 rounded-full px-5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rechercher"}
          </Button>
        </form>
      </div>

      {/* Résumé sécurité */}
      {counts && !loading && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Liens analysés :</span>
          {counts.safe > 0 && <Badge variant="outline" className={RISK_META.safe.badge}>{counts.safe} sûr{counts.safe > 1 ? "s" : ""}</Badge>}
          {counts.suspicious > 0 && <Badge variant="outline" className={RISK_META.suspicious.badge}>{counts.suspicious} suspect{counts.suspicious > 1 ? "s" : ""}</Badge>}
          {counts.dangerous > 0 && <Badge variant="outline" className={RISK_META.dangerous.badge}>{counts.dangerous} dangereux</Badge>}
        </div>
      )}

      {/* Chargement */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mb-3 h-6 w-6 animate-spin" />
          <p className="text-sm">Recherche et analyse de sécurité en cours…</p>
        </div>
      )}

      {/* Réponse IA */}
      {!loading && data?.answer && (
        <Card className="mb-5 border-primary/20 bg-primary/[0.03]">
          <CardContent className="p-4">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Résumé IA
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{data.answer}</p>
          </CardContent>
        </Card>
      )}

      {/* Résultats */}
      {!loading && data && (
        <div className="space-y-3">
          {data.results.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucune source web n'a pu être récupérée pour cette recherche.
            </p>
          )}
          {data.results.map((item, i) => {
            const meta = RISK_META[item.risk];
            const RiskIcon = meta.icon;
            return (
              <Card key={`${item.url}-${i}`} className={item.risk === "dangerous" ? "border-red-200 dark:border-red-900" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Globe className="h-3 w-3 shrink-0" />
                        <span className="truncate">{item.displayUrl || item.domain || item.url}</span>
                      </div>
                      <button
                        onClick={() => openResult(item)}
                        className="block truncate text-left text-base font-medium text-primary hover:underline"
                        title={item.title}
                      >
                        {item.title}
                      </button>
                    </div>
                    <Badge variant="outline" className={`shrink-0 gap-1 ${meta.badge}`}>
                      <RiskIcon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                  </div>

                  {item.reasons.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      {item.reasons.slice(0, 3).map((r, ri) => (
                        <li key={ri} className="flex items-start gap-1.5">
                          <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${meta.dot} bg-current`} />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={item.risk === "dangerous" ? "destructive" : "outline"}
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => openResult(item)}
                    >
                      {item.risk === "dangerous" ? <AlertTriangle className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
                      Ouvrir le lien
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Avertissement avant d'ouvrir un lien dangereux */}
      <AlertDialog open={!!pendingDanger} onOpenChange={(o) => !o && setPendingDanger(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldX className="h-5 w-5" />
              Lien signalé comme dangereux
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  L'antivirus a détecté un risque sur{" "}
                  <span className="font-medium break-all">{pendingDanger?.domain || pendingDanger?.displayUrl}</span>.
                </p>
                {pendingDanger?.reasons?.length ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                    {pendingDanger.reasons.slice(0, 4).map((r, ri) => (
                      <li key={ri}>{r}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="font-medium text-foreground">Souhaitez-vous vraiment ouvrir ce lien ?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (pendingDanger) window.open(pendingDanger.url, "_blank", "noopener,noreferrer");
                setPendingDanger(null);
              }}
            >
              Ouvrir quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
