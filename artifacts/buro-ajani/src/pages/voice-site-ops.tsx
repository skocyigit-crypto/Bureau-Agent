import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { HardHat, Mic, MicOff, Loader2, Package, ClipboardCheck, TrendingUp, CheckCircle2, AlertTriangle, Building2, Send, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type ActionStatus =
  | "ready"
  | "needs_chantier"
  | "chantier_not_found"
  | "chantier_ambiguous"
  | "article_not_found"
  | "task_not_found"
  | "invalid";

interface ResolvedAction {
  kind: "stock_deduction" | "work_order" | "progress_update";
  status: ActionStatus;
  summary: string;
  projetId?: number | null;
  projetTitle?: string | null;
  articleName?: string | null;
  articleReference?: string | null;
  quantity?: number;
  quantityAvailable?: number | null;
  mode?: "create" | "complete";
  title?: string | null;
  progress?: number | null;
  note?: string | null;
}

interface ParseResponse {
  actions: ResolvedAction[];
  readyCount: number;
  token: string | null;
  expiresAt: number | null;
  transcript: string;
}

interface ConfirmResult {
  index: number;
  kind: string;
  ok: boolean;
  message: string;
}

const KIND_META: Record<
  ResolvedAction["kind"],
  { label: string; icon: typeof Package; tint: string }
> = {
  stock_deduction: { label: "Sortie de stock", icon: Package, tint: "text-amber-600" },
  work_order: { label: "Ordre de travaux", icon: ClipboardCheck, tint: "text-blue-600" },
  progress_update: { label: "Avancement chantier", icon: TrendingUp, tint: "text-emerald-600" },
};

const STATUS_MESSAGE: Record<Exclude<ActionStatus, "ready">, string> = {
  needs_chantier: "Chantier non précisé — dictez le nom du chantier concerné.",
  chantier_not_found: "Chantier introuvable dans vos projets.",
  chantier_ambiguous: "Plusieurs chantiers correspondent — soyez plus précis.",
  article_not_found: "Article de stock introuvable.",
  task_not_found: "Aucune tâche ouverte ne correspond sur ce chantier.",
  invalid: "Information incomplète (quantité, titre ou avancement manquant).",
};

export default function VoiceSiteOpsPage() {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<ConfirmResult[] | null>(null);

  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef("");

  const sttSupported = useMemo(
    () =>
      typeof window !== "undefined" &&
      !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    [],
  );

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    baseTextRef.current = text ? text.trim() + " " : "";

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (finalText) baseTextRef.current += finalText;
      setText((baseTextRef.current + interim).trimStart());
    };
    recognition.onerror = (e: any) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        toast({
          title: "Micro indisponible",
          description: "Autorisez l'accès au microphone pour dicter la note.",
          variant: "destructive",
        });
      }
      stopListening();
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [text, toast, stopListening]);

  const analyze = useCallback(async () => {
    const note = text.trim();
    if (!note) return;
    stopListening();
    setParsing(true);
    setResults(null);
    setParsed(null);
    try {
      const res = await fetch(`${BASE}/api/voice/site-ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text: note, language: "fr" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Analyse impossible.");
      }
      const data: ParseResponse = await res.json();
      setParsed(data);
      // Par défaut, toutes les actions applicables sont cochées.
      const readyIdx = new Set<number>();
      let r = 0;
      for (const a of data.actions) {
        if (a.status === "ready") readyIdx.add(r++);
      }
      setSelected(readyIdx);
      if (data.actions.length === 0) {
        toast({
          title: "Aucune action détectée",
          description: "Reformulez la note (matériel, tâche ou avancement).",
        });
      }
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }, [text, stopListening, toast]);

  // Les actions "ready" reçoivent un index séquentiel = leur position dans le
  // jeton signé côté serveur (qui ne contient QUE les actions applicables).
  const readyActions = useMemo(() => {
    if (!parsed) return [];
    const out: { action: ResolvedAction; readyIndex: number }[] = [];
    let r = 0;
    for (const a of parsed.actions) {
      if (a.status === "ready") out.push({ action: a, readyIndex: r++ });
    }
    return out;
  }, [parsed]);

  const blockedActions = useMemo(
    () => (parsed ? parsed.actions.filter((a) => a.status !== "ready") : []),
    [parsed],
  );

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const confirm = useCallback(async () => {
    if (!parsed?.token || selected.size === 0) return;
    setConfirming(true);
    try {
      const res = await fetch(`${BASE}/api/voice/site-ops/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: parsed.token, accept: Array.from(selected) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Confirmation impossible.");
      }
      const data: { applied: number; results: ConfirmResult[] } = await res.json();
      setResults(data.results);
      setParsed(null);
      setSelected(new Set());
      toast({
        title: "Opérations enregistrées",
        description: `${data.applied} action(s) appliquée(s) sur le chantier.`,
      });
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  }, [parsed, selected, toast]);

  const reset = () => {
    setText("");
    setParsed(null);
    setResults(null);
    setSelected(new Set());
  };

  return (
    <div className="container mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          <HardHat className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saisie vocale chantier</h1>
          <p className="text-sm text-muted-foreground">
            Dictez une note de chantier — l'IA prépare les sorties de stock, les
            tâches et l'avancement. Rien n'est enregistré sans votre confirmation.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Note du chef de chantier</CardTitle>
          <CardDescription>
            Exemple : « Sur le chantier Rivoli, sortie de 20 sacs de ciment, le
            coffrage du 2e étage est terminé, avancement à 60 %. »
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Dictez ou saisissez votre note de chantier…"
            rows={5}
            className="resize-none"
            data-testid="input-site-note"
          />
          <div className="flex flex-wrap items-center gap-2">
            {sttSupported && (
              <Button
                type="button"
                variant={listening ? "destructive" : "outline"}
                onClick={listening ? stopListening : startListening}
                data-testid="button-toggle-mic"
              >
                {listening ? (
                  <>
                    <MicOff className="mr-2 h-4 w-4" /> Arrêter
                  </>
                ) : (
                  <>
                    <Mic className="mr-2 h-4 w-4" /> Dicter
                  </>
                )}
              </Button>
            )}
            <Button
              type="button"
              onClick={analyze}
              disabled={parsing || !text.trim()}
              data-testid="button-analyze"
            >
              {parsing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyse…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" /> Analyser la note
                </>
              )}
            </Button>
            {(text || parsed || results) && (
              <Button type="button" variant="ghost" onClick={reset} data-testid="button-reset">
                <RotateCcw className="mr-2 h-4 w-4" /> Réinitialiser
              </Button>
            )}
            {listening && (
              <span className="flex items-center gap-1.5 text-sm text-red-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Écoute…
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {parsing && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {parsed && (
        <div className="space-y-4">
          {readyActions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Actions proposées ({readyActions.length})
                </CardTitle>
                <CardDescription>
                  Décochez ce que vous ne voulez pas appliquer, puis confirmez.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {readyActions.map(({ action, readyIndex }) => {
                  const meta = KIND_META[action.kind];
                  const Icon = meta.icon;
                  const checked = selected.has(readyIndex);
                  const overdraw =
                    action.kind === "stock_deduction" &&
                    action.quantityAvailable != null &&
                    (action.quantity ?? 0) > action.quantityAvailable;
                  return (
                    <div
                      key={readyIndex}
                      className="flex items-start gap-3 rounded-lg border p-3"
                      data-testid={`action-card-${readyIndex}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(readyIndex)}
                        className="mt-1"
                        data-testid={`checkbox-action-${readyIndex}`}
                      />
                      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.tint}`} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{meta.label}</Badge>
                          {action.projetTitle && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Building2 className="h-3 w-3" /> {action.projetTitle}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium">{action.summary}</p>
                        {action.kind === "stock_deduction" &&
                          action.quantityAvailable != null && (
                            <p
                              className={`text-xs ${overdraw ? "text-red-500" : "text-muted-foreground"}`}
                            >
                              Stock actuel : {action.quantityAvailable}
                              {overdraw && " — quantité supérieure au stock (sera mise à 0)"}
                            </p>
                          )}
                      </div>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  onClick={confirm}
                  disabled={confirming || selected.size === 0}
                  className="w-full"
                  data-testid="button-confirm"
                >
                  {confirming ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enregistrement…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmer{" "}
                      {selected.size > 0 && `(${selected.size})`}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {blockedActions.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Actions à compléter ({blockedActions.length})
                </CardTitle>
                <CardDescription>
                  Ces éléments n'ont pas pu être résolus automatiquement.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {blockedActions.map((action, i) => {
                  const meta = KIND_META[action.kind];
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-dashed p-3 text-sm"
                      data-testid={`blocked-action-${i}`}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{meta.label}</Badge>
                      </div>
                      <p className="mt-1">{action.summary}</p>
                      {action.status !== "ready" && (
                        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                          {STATUS_MESSAGE[action.status]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {readyActions.length === 0 && blockedActions.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Aucune action détectée dans cette note.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {results && (
        <Card className="border-emerald-200 dark:border-emerald-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Résultat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {results.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                data-testid={`result-${i}`}
              >
                {r.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                )}
                <span className={r.ok ? "" : "text-red-500"}>{r.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
