import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { Search, ShieldCheck, ShieldAlert, ShieldX, ExternalLink, Loader2, Globe, Sparkles, AlertTriangle, Clock } from "lucide-react";
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
  snippet: string;
  risk: UrlRisk;
  reasons: string[];
  threatTypes?: string[];
}

interface WebSearchResponse {
  query: string;
  answer: string;
  results: WebSearchResultItem[];
  relatedSearches: string[];
}

const RECENTS_KEY = "recherche-web:recents";

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveRecent(term: string): string[] {
  const t = term.trim();
  if (!t) return loadRecents();
  const next = [t, ...loadRecents().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

const EXAMPLE_QUERIES = [
  "Actualités économiques en France aujourd'hui",
  "Taux de TVA pour une PME en 2026",
  "Modèle de facture conforme",
  "Météo Paris cette semaine",
];

function faviconUrl(domain: string): string | null {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function ResultFavicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(domain);
  if (!src || failed) {
    return <Globe className="h-3 w-3 shrink-0" />;
  }
  return (
    <img
      src={src}
      alt=""
      className="h-3.5 w-3.5 shrink-0 rounded-sm"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
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
  const search = useSearch();
  const initialQuery = new URLSearchParams(search).get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WebSearchResponse | null>(null);
  const [searched, setSearched] = useState(false);
  const [pendingDanger, setPendingDanger] = useState<WebSearchResultItem | null>(null);
  const [safeOnly, setSafeOnly] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const autoRanRef = useRef(false);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);

  function doSearch(term: string) {
    setQuery(term);
    void runSearch(undefined, term);
  }

  function clearRecents() {
    try {
      localStorage.removeItem(RECENTS_KEY);
    } catch {
      /* ignore */
    }
    setRecents([]);
  }

  async function runSearch(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    setShowSuggest(false);
    setActiveIndex(-1);
    if (loading) return;
    const q = (override ?? query).trim();
    if (q.length < 2) return;
    setRecents(saveRecent(q));
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

  useEffect(() => {
    if (autoRanRef.current) return;
    if (initialQuery.trim().length >= 2) {
      autoRanRef.current = true;
      void runSearch(undefined, initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Suggestions "comme Google" pendant la frappe : appel debounce et leger
  // (pas d'IA / quota) vers /api/web-search/suggest. La recherche complete ne
  // part qu'a la validation (Entree, bouton, ou clic sur une suggestion).
  useEffect(() => {
    const q = query.trim();
    setActiveIndex(-1);
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    if (q.length < 2) {
      suggestAbortRef.current?.abort();
      setSuggestions([]);
      return;
    }
    suggestTimerRef.current = setTimeout(() => {
      suggestAbortRef.current?.abort();
      const ctrl = new AbortController();
      suggestAbortRef.current = ctrl;
      fetch(`${baseUrl}/api/web-search/suggest?q=${encodeURIComponent(q)}`, {
        credentials: "include",
        signal: ctrl.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { suggestions?: string[] } | null) => {
          // Garde anti-course : on ignore toute reponse d'une requete obsolete
          // (annulee par une frappe plus recente ou le demontage de l'effet).
          if (ctrl.signal.aborted) return;
          if (json && Array.isArray(json.suggestions)) {
            setSuggestions(json.suggestions);
          }
        })
        .catch(() => {
          /* abort / reseau : on ignore, aucune erreur visible */
        });
    }, 140);
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
      // Annule immediatement toute requete en vol quand la requete change.
      suggestAbortRef.current?.abort();
    };
  }, [query]);

  const trimmedQuery = query.trim();
  const recentMatches =
    trimmedQuery.length >= 1
      ? recents
          .filter(
            (r) =>
              r.toLowerCase().startsWith(trimmedQuery.toLowerCase()) &&
              r.toLowerCase() !== trimmedQuery.toLowerCase(),
          )
          .slice(0, 3)
      : [];
  const suggestList = Array.from(
    new Set([...recentMatches, ...suggestions]),
  ).slice(0, 8);

  function selectSuggestion(term: string) {
    setShowSuggest(false);
    setActiveIndex(-1);
    doSearch(term);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggest || suggestList.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestList.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestList.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < suggestList.length) {
        e.preventDefault();
        selectSuggestion(suggestList[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggest(false);
      setActiveIndex(-1);
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

  const filteredResults = data
    ? safeOnly
      ? data.results.filter((r) => r.risk !== "dangerous")
      : data.results
    : [];
  const hiddenCount = data ? data.results.length - filteredResults.length : 0;

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
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggest(true);
              }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => window.setTimeout(() => setShowSuggest(false), 120)}
              onKeyDown={onSearchKeyDown}
              placeholder="Rechercher sur le web…"
              className="h-11 rounded-full pl-10 pr-4 text-base shadow-sm"
              autoFocus
              maxLength={300}
              autoComplete="off"
              role="combobox"
              aria-expanded={showSuggest && suggestList.length > 0}
              aria-autocomplete="list"
            />
            {showSuggest && !loading && suggestList.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border bg-popover py-1 text-popover-foreground shadow-lg">
                {suggestList.map((s, i) => {
                  const isRecent = recentMatches.includes(s);
                  return (
                    <button
                      type="button"
                      key={s}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => selectSuggestion(s)}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition ${
                        i === activeIndex ? "bg-muted" : "hover:bg-muted/60"
                      }`}
                    >
                      {isRecent ? (
                        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{s}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Button type="submit" disabled={loading || query.trim().length < 2} className="h-11 rounded-full px-5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rechercher"}
          </Button>
        </form>
      </div>

      {/* État initial : exemples + recherches récentes */}
      {!searched && !loading && (
        <div className="mx-auto max-w-xl space-y-5">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Exemples de recherche</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUERIES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => doSearch(ex)}
                  className="rounded-full border bg-background px-3 py-1.5 text-sm text-foreground/80 shadow-sm transition hover:bg-muted hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
          {recents.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recherches récentes</p>
                <button onClick={clearRecents} className="text-xs text-muted-foreground hover:text-foreground hover:underline">Effacer</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recents.map((r) => (
                  <button
                    key={r}
                    onClick={() => doSearch(r)}
                    className="flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm text-foreground/80 shadow-sm transition hover:bg-muted hover:text-foreground"
                  >
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Résumé sécurité */}
      {counts && !loading && data && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {data.results.length} résultat{data.results.length > 1 ? "s" : ""} · liens analysés :
          </span>
          {counts.safe > 0 && <Badge variant="outline" className={RISK_META.safe.badge}>{counts.safe} sûr{counts.safe > 1 ? "s" : ""}</Badge>}
          {counts.suspicious > 0 && <Badge variant="outline" className={RISK_META.suspicious.badge}>{counts.suspicious} suspect{counts.suspicious > 1 ? "s" : ""}</Badge>}
          {counts.dangerous > 0 && <Badge variant="outline" className={RISK_META.dangerous.badge}>{counts.dangerous} dangereux</Badge>}
          {data.results.length > 0 && (
            <button
              onClick={() => setSafeOnly((v) => !v)}
              className={`ml-auto rounded-full border px-2.5 py-1 transition ${safeOnly ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" : "text-muted-foreground hover:bg-muted"}`}
            >
              {safeOnly ? "✓ Liens dangereux masqués" : "Masquer les liens dangereux"}
            </button>
          )}
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
          {filteredResults.map((item, i) => {
            const meta = RISK_META[item.risk];
            const RiskIcon = meta.icon;
            return (
              <Card key={`${item.url}-${i}`} className={item.risk === "dangerous" ? "border-red-200 dark:border-red-900" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ResultFavicon domain={item.domain} />
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

                  {item.snippet && (
                    <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.snippet}</p>
                  )}

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

          {hiddenCount > 0 && (
            <button
              onClick={() => setSafeOnly(false)}
              className="w-full rounded-lg border border-dashed py-2.5 text-center text-xs text-muted-foreground transition hover:bg-muted"
            >
              {hiddenCount} lien{hiddenCount > 1 ? "s" : ""} dangereux masqué{hiddenCount > 1 ? "s" : ""} — tout afficher
            </button>
          )}

          {data.relatedSearches?.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Search className="h-3.5 w-3.5" />
                Recherches associées
              </p>
              <div className="flex flex-wrap gap-2">
                {data.relatedSearches.map((rs) => (
                  <button
                    key={rs}
                    onClick={() => doSearch(rs)}
                    className="rounded-full border bg-background px-3 py-1.5 text-sm text-foreground/80 shadow-sm transition hover:bg-muted hover:text-foreground"
                  >
                    {rs}
                  </button>
                ))}
              </div>
            </div>
          )}
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
