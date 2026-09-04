import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import {
AlertTriangle,
BookOpen,
Brain,
FileText,
KeyRound,
Loader2,
RefreshCw,
Sparkles,
} from "lucide-react";
import { useCallback,useEffect,useState } from "react";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

interface KbStatus {
  totalDocuments: number;
  indexableDocuments: number;
  indexedDocuments: number;
  staleDocuments: number;
  totalChunks: number;
  embeddedChunks: number;
  searchMode: "semantic" | "lexical";
  lastIndexedAt: string | null;
}

interface KbSource {
  ref: number;
  documentId: number;
  fileName: string;
  score: number;
  snippet: string;
}

interface KbAnswer {
  answer: string;
  sources: KbSource[];
  grounded: boolean;
}

const EXAMPLE_QUESTIONS = [
  "knowledgeBase.examples.q1",
  "knowledgeBase.examples.q2",
  "knowledgeBase.examples.q3",
  "knowledgeBase.examples.q4",
];

/** Insère les citations [1], [2] sous forme de pastilles cliquables dans le
 *  texte de la réponse. */
function renderAnswerWithCitations(
  answer: string,
  onCite: (ref: number) => void,
  citeLabel: (ref: number) => string,
): React.ReactNode {
  const parts = answer.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const ref = Number(m[1]);
      return (
        <button
          key={i}
          type="button"
          onClick={() => onCite(ref)}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary align-middle hover:bg-primary/20 transition-colors"
          aria-label={citeLabel(ref)}
        >
          {ref}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function KnowledgeBasePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useWorkspaceUser();
  const isAdmin = user.role === "super_admin" || user.role === "administrateur";

  const [status, setStatus] = useState<KbStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<KbAnswer | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/knowledge-base/status`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("status");
      setStatus((await res.json()) as KbStatus);
    } catch {
      // Statut non bloquant: on laisse l'utilisateur poser des questions.
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleReindex = useCallback(async () => {
    setReindexing(true);
    try {
      const res = await fetch(`${baseUrl}/api/knowledge-base/reindex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ force: false }),
      });
      const data = (await res.json()) as {
        error?: string;
        documentsProcessed?: number;
        chunksWritten?: number;
        remaining?: number;
        status?: KbStatus;
      };
      if (!res.ok) throw new Error(data.error || t("knowledgeBase.toast.reindexFailed"));
      if (data.status) setStatus(data.status);
      toast({
        title: t("knowledgeBase.toast.reindexDone"),
        description:
          t("knowledgeBase.toast.reindexDoneDesc", {
            docs: data.documentsProcessed ?? 0,
            chunks: data.chunksWritten ?? 0,
          }) +
          (data.remaining
            ? t("knowledgeBase.toast.remainingSuffix", { remaining: data.remaining })
            : "."),
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: t("knowledgeBase.toast.reindexError"),
        description: err instanceof Error ? err.message : t("knowledgeBase.toast.unknownError"),
      });
    } finally {
      setReindexing(false);
    }
  }, [toast, t]);

  const handleAsk = useCallback(
    async (q?: string) => {
      const text = (q ?? question).trim();
      if (!text) return;
      if (q) setQuestion(q);
      setAsking(true);
      setResult(null);
      try {
        const res = await fetch(`${baseUrl}/api/knowledge-base/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ question: text }),
        });
        const data = (await res.json()) as KbAnswer & { error?: string };
        if (!res.ok) throw new Error(data.error || t("knowledgeBase.toast.searchFailed"));
        setResult(data);
      } catch (err) {
        toast({
          variant: "destructive",
          title: t("knowledgeBase.toast.searchError"),
          description: err instanceof Error ? err.message : t("knowledgeBase.toast.unknownError"),
        });
      } finally {
        setAsking(false);
      }
    },
    [question, toast, t],
  );

  const scrollToSource = useCallback((ref: number) => {
    const el = document.getElementById(`kb-source-${ref}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 1600);
    }
  }, []);

  const hasIndex = (status?.totalChunks ?? 0) > 0;
  const needsIndex =
    !statusLoading &&
    status &&
    status.indexableDocuments > 0 &&
    status.indexedDocuments < status.indexableDocuments;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      {/* En-tête */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("knowledgeBase.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("knowledgeBase.subtitle")}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => void handleReindex()}
            disabled={reindexing}
            className="shrink-0"
          >
            {reindexing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {reindexing ? t("knowledgeBase.indexing") : t("knowledgeBase.indexDocuments")}
          </Button>
        )}
      </div>

      {/* Statut */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <StatItem icon={FileText} label={t("knowledgeBase.stats.indexable")} value={status?.indexableDocuments ?? 0} />
          <StatItem icon={Brain} label={t("knowledgeBase.stats.indexed")} value={status?.indexedDocuments ?? 0} />
          <StatItem icon={BookOpen} label={t("knowledgeBase.stats.chunks")} value={status?.totalChunks ?? 0} />
          <div className="ml-auto flex items-center gap-2">
            {status && (
              <Badge variant={status.searchMode === "semantic" ? "default" : "secondary"}>
                {status.searchMode === "semantic" ? (
                  <>
                    <Sparkles className="mr-1 h-3 w-3" />
                    {t("knowledgeBase.searchSemantic")}
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-1 h-3 w-3" />
                    {t("knowledgeBase.searchLexical")}
                  </>
                )}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {needsIndex && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {t("knowledgeBase.needsIndex")}{" "}
            {isAdmin
              ? t("knowledgeBase.needsIndexAdmin")
              : t("knowledgeBase.needsIndexUser")}
          </div>
        </div>
      )}

      {/* Zone de question */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <Textarea aria-label={t("knowledgeBase.questionPlaceholder")}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("knowledgeBase.questionPlaceholder")}
            rows={3}
            maxLength={1000}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleAsk();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("knowledgeBase.hint")}
            </span>
            <Button onClick={() => void handleAsk()} disabled={asking || !question.trim()}>
              {asking ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {asking ? t("knowledgeBase.searching") : t("knowledgeBase.ask")}
            </Button>
          </div>

          {!hasIndex && !statusLoading && (
            <p className="text-sm text-muted-foreground">
              {t("knowledgeBase.noIndex")}
            </p>
          )}

          {hasIndex && !result && !asking && (
            <div className="flex flex-wrap gap-2 pt-1">
              {EXAMPLE_QUESTIONS.map((ex) => {
                const label = t(ex);
                return (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => void handleAsk(label)}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Réponse */}
      {asking && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("knowledgeBase.searchingDocs")}
          </CardContent>
        </Card>
      )}

      {result && !asking && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">{t("knowledgeBase.answer")}</span>
              {result.grounded ? (
                <Badge variant="secondary" className="text-xs">
                  {t("knowledgeBase.groundedOn", { count: result.sources.length })}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  {t("knowledgeBase.outOfScope")}
                </Badge>
              )}
            </div>

            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {renderAnswerWithCitations(result.answer, scrollToSource, (ref) => t("knowledgeBase.viewSource", { ref }))}
            </div>

            {result.sources.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("knowledgeBase.sources")}
                </p>
                {result.sources.map((s) => (
                  <div
                    key={s.ref}
                    id={`kb-source-${s.ref}`}
                    className="rounded-lg border border-border bg-muted/30 p-3 transition-all"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                        {s.ref}
                      </span>
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">{s.fileName}</span>
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">{s.snippet}…</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="leading-tight">
        <div className="text-lg font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
