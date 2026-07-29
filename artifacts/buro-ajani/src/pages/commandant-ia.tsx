import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "@/i18n";
import { confirmAction } from "@/hooks/use-confirm";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Phone, Mail, Calendar, CheckSquare, DollarSign, HardDrive, Camera,
  Users, Zap, Send, RefreshCw, Loader2, AlertTriangle, Star, Clock, FileText,
  MapPin, BarChart3, Shield, Bell, TrendingUp, ArrowRight, Sparkles,
  MessageSquare, Target, Play, Eye, Coffee, Navigation, ExternalLink,
  Search, Wand2, Copy, Mic, Bot, Printer, FolderKanban,
  MessageCircle, Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { streamSse } from "@/lib/ai-stream-client";
import { AvatarDock } from "@workspace/ai-avatar";
import { decodeHandoffParam, consumeHandoff, lastUserPrompt } from "@workspace/demo-handoff";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiPost(path: string, body?: any) {
  const r = await fetch(`${API}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error((err as any).error || `Erreur ${r.status}`); }
  return r.json();
}
async function apiGet(path: string) {
  const r = await fetch(`${API}/api${path}`, { credentials: "include" });
  if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error((err as any).error || `Erreur ${r.status}`); }
  return r.json();
}
async function apiPatch(path: string, body?: any) {
  const r = await fetch(`${API}/api${path}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error((err as any).error || `Erreur ${r.status}`); }
  return r.json();
}
async function apiDelete(path: string) {
  const r = await fetch(`${API}/api${path}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error((err as any).error || `Erreur ${r.status}`); }
  return r.json();
}

export default function CommandantIAPage() {
  const [tab, setTab] = useState("chat");
  const { t } = useTranslation();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-7 w-7 text-amber-500" />
            {t("commandantIa.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("commandantIa.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-500 text-white text-xs">Gemini</Badge>
          <Badge className="bg-violet-500 text-white text-xs">OpenAI</Badge>
          <Badge className="bg-orange-500 text-white text-xs">Anthropic</Badge>
          <Button variant="outline" size="icon" title={t("commandantIa.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 w-full h-auto">
          <TabsTrigger value="chat" className="text-xs gap-1"><MessageCircle className="h-3 w-3" />{t("commandantIa.tabs.chat")}</TabsTrigger>
          <TabsTrigger value="briefing" className="text-xs gap-1"><Coffee className="h-3 w-3" />{t("commandantIa.tabs.briefing")}</TabsTrigger>
          <TabsTrigger value="commandes" className="text-xs gap-1"><Zap className="h-3 w-3" />{t("commandantIa.tabs.commandes")}</TabsTrigger>
          <TabsTrigger value="phone" className="text-xs gap-1"><Phone className="h-3 w-3" />{t("commandantIa.tabs.phone")}</TabsTrigger>
          <TabsTrigger value="email" className="text-xs gap-1"><Mail className="h-3 w-3" />{t("commandantIa.tabs.email")}</TabsTrigger>
          <TabsTrigger value="meetings" className="text-xs gap-1"><Calendar className="h-3 w-3" />{t("commandantIa.tabs.meetings")}</TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs gap-1"><CheckSquare className="h-3 w-3" />{t("commandantIa.tabs.tasks")}</TabsTrigger>
          <TabsTrigger value="finance" className="text-xs gap-1"><DollarSign className="h-3 w-3" />{t("commandantIa.tabs.finance")}</TabsTrigger>
          <TabsTrigger value="photo" className="text-xs gap-1"><Camera className="h-3 w-3" />{t("commandantIa.tabs.photo")}</TabsTrigger>
          <TabsTrigger value="drive" className="text-xs gap-1"><HardDrive className="h-3 w-3" />{t("commandantIa.tabs.drive")}</TabsTrigger>
          <TabsTrigger value="rappels" className="text-xs gap-1"><Bell className="h-3 w-3" />{t("commandantIa.tabs.rappels")}</TabsTrigger>
          <TabsTrigger value="stats" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />{t("commandantIa.tabs.stats")}</TabsTrigger>
        </TabsList>

        <TabsContent value="chat"><ChatTab /></TabsContent>
        <TabsContent value="briefing"><BriefingTab /></TabsContent>
        <TabsContent value="commandes"><CommandesTab /></TabsContent>
        <TabsContent value="phone"><PhoneTab /></TabsContent>
        <TabsContent value="email"><EmailTab /></TabsContent>
        <TabsContent value="meetings"><MeetingsTab /></TabsContent>
        <TabsContent value="tasks"><TasksTab /></TabsContent>
        <TabsContent value="finance"><FinanceTab /></TabsContent>
        <TabsContent value="photo"><PhotoTab /></TabsContent>
        <TabsContent value="drive"><DriveTab /></TabsContent>
        <TabsContent value="rappels"><RappelsTab /></TabsContent>
        <TabsContent value="stats"><StatsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function BriefingTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [searchStreamingSummary, setSearchStreamingSummary] = useState("");
  const searchAbortRef = useRef<AbortController | null>(null);
  const [analysisText, setAnalysisText] = useState("");
  const [analysisType, setAnalysisType] = useState("summary");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation();

  // Switching commandant-ia's tabs unmounts this component (Radix TabsContent
  // has no forceMount) while a stream started here may still be reading —
  // abort in-flight streams on unmount so the server stops generating/
  // billing tokens for a user who navigated away.
  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      analyzeAbortRef.current?.abort();
    };
  }, []);

  const loadBriefing = async () => {
    setLoading(true);
    try {
      const d = await apiGet("/commandant/daily-briefing");
      if (d.success) setData(d);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const smartSearch = async () => {
    if (!searchQuery || searchQuery.length < 2) return;
    setSearching(true);
    setSearchResults(null);
    setSearchStreamingSummary("");
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      await streamSse("/commandant/smart-search/stream", { query: searchQuery }, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === "results") {
            setSearchResults({ query: data?.query, totalResults: data?.totalResults, results: data?.results, aiSummary: "" });
          } else if (event === "token" && data?.chunk) {
            setSearchStreamingSummary(prev => prev + data.chunk);
          } else if (event === "cached" && typeof data?.aiSummary === "string") {
            setSearchStreamingSummary(data.aiSummary);
          } else if (event === "done") {
            setSearchResults({ query: data?.query, totalResults: data?.totalResults, results: data?.results, aiSummary: data?.aiSummary || "" });
            setSearchStreamingSummary("");
          } else if (event === "aborted") {
            if (data?.partialText) setSearchStreamingSummary(data.partialText);
          } else if (event === "error") {
            toast({ title: t("commandantIa.toast.error"), description: data?.error || t("commandantIa.briefing.searchFailed"), variant: "destructive" });
          }
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setSearching(false);
      searchAbortRef.current = null;
    }
  };

  const cancelSearch = () => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      toast({ title: t("commandantIa.toast.cancelled"), description: t("commandantIa.briefing.searchStopped") });
    }
  };

  const analyzeText = async () => {
    if (!analysisText) return;
    setAnalyzing(true);
    setAnalysisResult(null);
    setStreamingText("");
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    try {
      await streamSse("/commandant/analyze-text/stream", { text: analysisText, analysisType }, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === "token" && data?.chunk) setStreamingText(prev => prev + data.chunk);
          else if (event === "cached" && typeof data?.text === "string") setStreamingText(data.text);
          else if (event === "done" && data?.analysis) setAnalysisResult(data.analysis);
          else if (event === "error") toast({ title: t("commandantIa.toast.error"), description: data?.error || t("commandantIa.briefing.analysisFailed"), variant: "destructive" });
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
      analyzeAbortRef.current = null;
    }
  };

  const cancelAnalyze = () => {
    if (analyzeAbortRef.current) {
      analyzeAbortRef.current.abort();
      toast({ title: t("commandantIa.toast.cancelled"), description: t("commandantIa.briefing.analysisStopped") });
    }
  };

  useEffect(() => { loadBriefing(); }, []);

  const weatherIcons: Record<string, string> = { ensoleille: "☀️", nuageux: "⛅", orageux: "⛈️" };
  const typeIcons: Record<string, any> = { contact: Users, tache: CheckSquare, evenement: Calendar, message: MessageSquare };
  const typeColors: Record<string, string> = { contact: "text-blue-600 bg-blue-50", tache: "text-emerald-600 bg-emerald-50", evenement: "text-purple-600 bg-purple-50", message: "text-orange-600 bg-orange-50" };

  return (
    <div className="space-y-4 mt-4">
      <Card className="border-2 border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-blue-500" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && smartSearch()}
              placeholder={t("commandantIa.briefing.searchPlaceholder")}
              className="flex-1 border-0 bg-transparent text-base focus-visible:ring-0 placeholder:text-muted-foreground/60"
            />
            <Button onClick={smartSearch} disabled={searching} size="sm" className="bg-blue-600 hover:bg-blue-700">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
            {searching && (
              <Button onClick={cancelSearch} size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {searchResults && (
        <Card className="border-blue-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><Wand2 className="h-4 w-4 text-blue-500" />{t("commandantIa.briefing.results", { count: searchResults.totalResults, query: searchResults.query })}</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => { setSearchResults(null); setSearchStreamingSummary(""); }} className="text-xs h-6">{t("common.close")}</Button>
            </div>
          </CardHeader>
          <CardContent>
            {searchStreamingSummary && (!searchResults.aiSummary || searching) && (
              <div className="text-xs text-muted-foreground mb-3 p-2 bg-blue-50 rounded flex gap-2">
                {searching && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0 mt-0.5" />}
                <span className="whitespace-pre-wrap">{searchStreamingSummary}</span>
              </div>
            )}
            {!searching && searchResults.aiSummary && <p className="text-xs text-muted-foreground mb-3 p-2 bg-blue-50 rounded">{searchResults.aiSummary}</p>}
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {(searchResults.results && typeof searchResults.results === "object" ? Object.entries(searchResults.results) : []).flatMap(([category, items]: [string, any]) =>
                  (Array.isArray(items) ? items : []).map((item: any) => {
                    const Icon = typeIcons[item.type] || FileText;
                    const colorClass = typeColors[item.type] || "text-gray-600 bg-gray-50";
                    return (
                      <div key={`${item.type}-${item.id}`} className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer">
                        <div className={`p-1 rounded ${colorClass}`}><Icon className="h-3 w-3" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{highlightMatches(item.title || "", searchResults.query || searchQuery)}</div>
                          {item.subtitle && <div className="text-[10px] text-muted-foreground truncate">{highlightMatches(item.subtitle, searchResults.query || searchQuery)}</div>}
                        </div>
                        <Badge variant="outline" className="text-[9px] shrink-0">{item.type}</Badge>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Coffee className="h-5 w-5 text-amber-500" />{t("commandantIa.briefing.dailyTitle")}</h2>
        <Button onClick={loadBriefing} variant="outline" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>
      </div>

      {loading && !data ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : data ? (
        <>
          <Card className="border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="text-4xl">{weatherIcons[data.briefing?.weatherOfBusiness?.toLowerCase()] || "🌤️"}</div>
                <div className="flex-1">
                  <p className="text-base font-medium">{data.briefing?.greeting}</p>
                  {data.briefing?.motivationalNote && <p className="text-sm text-muted-foreground mt-2 italic">{data.briefing.motivationalNote}</p>}
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-600">{data.briefing?.priorityScore || "?"}</div>
                  <div className="text-[10px] text-muted-foreground">{t("commandantIa.briefing.priorityScore")}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <Card className="text-center p-3"><CheckSquare className="h-4 w-4 mx-auto mb-1 text-blue-500" /><div className="text-xl font-bold">{data.rawData?.openTasks || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.briefing.openTasks")}</div></Card>
            <Card className="text-center p-3"><AlertTriangle className="h-4 w-4 mx-auto mb-1 text-red-500" /><div className="text-xl font-bold text-red-600">{data.rawData?.overdueTasks || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.briefing.overdueTasks")}</div></Card>
            <Card className="text-center p-3"><Calendar className="h-4 w-4 mx-auto mb-1 text-emerald-500" /><div className="text-xl font-bold">{data.rawData?.todayEvents || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.briefing.events")}</div></Card>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Card className="text-center p-3"><DollarSign className="h-4 w-4 mx-auto mb-1 text-orange-500" /><div className="text-xl font-bold text-orange-600">{data.rawData?.overdueInvoices || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.briefing.overdueInvoices")}</div></Card>
            <Card className="text-center p-3"><FolderKanban className="h-4 w-4 mx-auto mb-1 text-indigo-500" /><div className="text-xl font-bold text-indigo-600">{data.rawData?.projetsActifs || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.briefing.activeProjects")}</div></Card>
            <Card className={`text-center p-3 ${(data.rawData?.projetsEnRetard || 0) > 0 ? "border-red-200 bg-red-50/40" : ""}`}><FolderKanban className={`h-4 w-4 mx-auto mb-1 ${(data.rawData?.projetsEnRetard || 0) > 0 ? "text-red-500" : "text-slate-400"}`} /><div className={`text-xl font-bold ${(data.rawData?.projetsEnRetard || 0) > 0 ? "text-red-600" : "text-slate-600"}`}>{data.rawData?.projetsEnRetard || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.briefing.overdueProjects")}</div></Card>
          </div>

          {data.briefing?.criticalItems?.length > 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{t("commandantIa.briefing.criticalItems")}</CardTitle></CardHeader>
              <CardContent><ul className="space-y-1">{data.briefing.criticalItems.map((item: string, i: number) => <li key={i} className="text-sm text-red-700 flex items-center gap-1"><ArrowRight className="h-3 w-3 shrink-0" />{item}</li>)}</ul></CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4">
            {data.briefing?.todayAgenda?.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Calendar className="h-4 w-4 text-blue-500" />{t("commandantIa.briefing.agenda")}</CardTitle></CardHeader>
                <CardContent><ul className="space-y-1">{data.briefing.todayAgenda.map((item: string, i: number) => <li key={i} className="text-xs flex items-center gap-1"><Clock className="h-3 w-3 text-muted-foreground shrink-0" />{item}</li>)}</ul></CardContent>
              </Card>
            )}
            {data.briefing?.recommendations?.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Sparkles className="h-4 w-4 text-amber-500" />{t("commandantIa.briefing.aiRecommendations")}</CardTitle></CardHeader>
                <CardContent><ul className="space-y-1">{data.briefing.recommendations.map((item: string, i: number) => <li key={i} className="text-xs flex items-center gap-1"><Star className="h-3 w-3 text-amber-500 shrink-0" />{item}</li>)}</ul></CardContent>
              </Card>
            )}
          </div>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Coffee className="h-8 w-8 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium">{t("commandantIa.briefing.unavailable")}</p>
              <p className="text-xs text-muted-foreground">{t("commandantIa.briefing.unavailableDesc")}</p>
            </div>
            <Button onClick={loadBriefing} variant="outline" size="sm" disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t("commandantIa.briefing.retry")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Separator className="my-4" />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4 text-violet-500" />{t("commandantIa.briefing.textToolsTitle")}</CardTitle>
          <CardDescription className="text-xs">{t("commandantIa.briefing.textToolsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: "summary", l: t("commandantIa.briefing.opt.summary"), icon: FileText },
              { v: "sentiment", l: t("commandantIa.briefing.opt.sentiment"), icon: Eye },
              { v: "entities", l: t("commandantIa.briefing.opt.entities"), icon: Users },
              { v: "action_items", l: t("commandantIa.briefing.opt.actions"), icon: CheckSquare },
              { v: "translate", l: t("commandantIa.briefing.opt.translate"), icon: ArrowRight },
              { v: "rewrite", l: t("commandantIa.briefing.opt.rewrite"), icon: Wand2 },
            ].map(opt => (
              <Button
                key={opt.v}
                variant={analysisType === opt.v ? "default" : "outline"}
                size="sm"
                className={`text-xs gap-1 ${analysisType === opt.v ? "bg-violet-600 hover:bg-violet-700" : ""}`}
                onClick={() => setAnalysisType(opt.v)}
              >
                <opt.icon className="h-3 w-3" />{opt.l}
              </Button>
            ))}
          </div>
          <Textarea
            value={analysisText}
            onChange={e => setAnalysisText(e.target.value)}
            placeholder={t("commandantIa.briefing.analyzePlaceholder")}
            rows={4}
          />
          <div className="flex gap-2">
            <Button onClick={analyzeText} disabled={analyzing || !analysisText} className="flex-1 bg-violet-600 hover:bg-violet-700">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Brain className="h-4 w-4 mr-2" />}{t("commandantIa.briefing.analyzeBtn")}
            </Button>
            {analyzing && (
              <Button onClick={cancelAnalyze} variant="outline" className="border-red-300 text-red-700 hover:bg-red-50">
                <X className="h-4 w-4 mr-1" />{t("common.cancel")}
              </Button>
            )}
          </div>
          {analyzing && streamingText && !analysisResult && (
            <Card className="border-violet-200 bg-violet-50/30">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-violet-700">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t("commandantIa.briefing.responseInProgress")}
                </div>
                <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground max-h-40 overflow-auto">{streamingText}</pre>
              </CardContent>
            </Card>
          )}
          {analysisResult && (
            <Card className="border-violet-200 bg-violet-50/30">
              <CardContent className="p-4">
                <ScrollArea className="max-h-60">
                  <div className="space-y-2 text-sm">
                    {analysisResult.summary && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.summary")}</span> <span className="text-muted-foreground">{analysisResult.summary}</span></div>}
                    {analysisResult.sentiment && <div className="flex items-center gap-2"><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.sentiment")}</span> <Badge className={analysisResult.sentiment === "tres_positif" ? "bg-emerald-200 text-emerald-800" : analysisResult.sentiment === "positif" ? "bg-emerald-100 text-emerald-700" : analysisResult.sentiment === "tres_negatif" ? "bg-red-200 text-red-800" : analysisResult.sentiment === "negatif" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"}>{analysisResult.sentiment}</Badge>{analysisResult.score !== undefined && <span className="text-xs text-muted-foreground">({analysisResult.score}/100)</span>}</div>}
                    {analysisResult.keyPoints?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.keyPoints")}</span><ul className="mt-1">{analysisResult.keyPoints.map((p: string, i: number) => <li key={i} className="text-xs text-muted-foreground ml-3">• {p}</li>)}</ul></div>}
                    {analysisResult.emotions?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.emotions")}</span> {analysisResult.emotions.map((e: string, i: number) => <Badge key={i} variant="outline" className="text-[10px] ml-1">{e}</Badge>)}</div>}
                    {analysisResult.keyPhrases?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.keyPhrases")}</span> {analysisResult.keyPhrases.map((p: string, i: number) => <Badge key={i} variant="secondary" className="text-[10px] ml-1">{p}</Badge>)}</div>}
                    {analysisResult.actions?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.actions")}</span><ul className="mt-1">{analysisResult.actions.map((a: any, i: number) => <li key={i} className="text-xs ml-3 flex items-center gap-1"><CheckSquare className="h-3 w-3 text-emerald-500" /><span className="font-medium">{a.title || a}</span>{a.priority && <Badge variant="outline" className="text-[9px]">{a.priority}</Badge>}{a.deadline && <span className="text-muted-foreground"> ({a.deadline})</span>}</li>)}</ul></div>}
                    {analysisResult.decisions?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.decisions")}</span><ul className="mt-1">{analysisResult.decisions.map((d: string, i: number) => <li key={i} className="text-xs text-muted-foreground ml-3">✓ {d}</li>)}</ul></div>}
                    {analysisResult.people?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.people")}</span> {analysisResult.people.join(", ")}</div>}
                    {analysisResult.companies?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.companies")}</span> {analysisResult.companies.join(", ")}</div>}
                    {analysisResult.dates?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.dates")}</span> {analysisResult.dates.join(", ")}</div>}
                    {analysisResult.amounts?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.amounts")}</span> {analysisResult.amounts.join(", ")}</div>}
                    {analysisResult.translation && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.translation")}</span><div className="mt-1 p-2 bg-white rounded text-xs">{analysisResult.translation}</div></div>}
                    {analysisResult.rewritten && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.rewritten")}</span><div className="mt-1 p-2 bg-white rounded text-xs">{analysisResult.rewritten}</div></div>}
                    {analysisResult.improvements?.length > 0 && <div><span className="font-semibold text-violet-700">{t("commandantIa.briefing.res.improvements")}</span><ul className="mt-1">{analysisResult.improvements.map((imp: string, i: number) => <li key={i} className="text-xs text-muted-foreground ml-3">→ {imp}</li>)}</ul></div>}
                    {analysisResult.readingTime && <div className="text-xs text-muted-foreground">{t("commandantIa.briefing.res.readingComplexity", { time: analysisResult.readingTime, complexity: analysisResult.complexity || "N/A" })}</div>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PhoneTab() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<any>(null);
  const [compileResult, setCompileResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const getSmartResponse = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/call-smart-response", { callerPhone: phone, callerName: name, callNotes: notes, callDirection: "entrant" });
      if (d.success) setResult(d);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const compileCall = async () => {
    setCompiling(true);
    try {
      const d = await apiPost("/commandant/call-compile", { callerPhone: phone, callerName: name, notes, duration: 300 });
      if (d.success) { setCompileResult(d); toast({ title: t("commandantIa.toast.success"), description: t("commandantIa.phone.compileSuccess", { tasks: d.createdTasks?.length || 0, events: d.createdEvents?.length || 0 }) }); }
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setCompiling(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Phone className="h-4 w-4 text-emerald-500" />{t("commandantIa.phone.smartTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">{t("commandantIa.phone.phoneLabel")}</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+33 6 12 34 56 78" /></div>
              <div><Label className="text-xs">{t("commandantIa.phone.nameLabel")}</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Jean Dupont" /></div>
            </div>
            <div><Label className="text-xs">{t("commandantIa.phone.notesLabel")}</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("commandantIa.phone.notesPlaceholder")} rows={3} /></div>
            <div className="flex gap-2">
              <Button onClick={getSmartResponse} disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-700">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}{t("commandantIa.phone.aiResponseBtn")}</Button>
              <Button onClick={compileCall} disabled={compiling} variant="outline" className="flex-1">{compiling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}{t("commandantIa.phone.compileBtn")}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("commandantIa.phone.resultTitle")}</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
              {result ? (
                <div className="space-y-3">
                  {result.contact && <div className="p-2 bg-blue-50 rounded text-xs"><strong>{t("commandantIa.phone.recognizedContact")}</strong> {result.contact.name} ({result.contact.company || "N/A"}) - {result.contact.totalCalls || 0} {t("commandantIa.phone.calls")}</div>}
                  {result.aiResponse?.greeting && <div className="p-2 bg-emerald-50 rounded text-xs"><strong>{t("commandantIa.phone.greeting")}</strong> {result.aiResponse.greeting}</div>}
                  {result.aiResponse?.detectedIntent && <Badge className="text-xs">{result.aiResponse.detectedIntent}</Badge>}
                  {result.aiResponse?.contextBriefing && <p className="text-xs text-muted-foreground">{result.aiResponse.contextBriefing}</p>}
                  {result.aiResponse?.suggestedResponses?.map((r: string, i: number) => <div key={i} className="p-2 bg-muted rounded text-xs flex items-start gap-1"><MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />{r}</div>)}
                  {result.aiResponse?.recommendedActions?.length > 0 && (
                    <div><div className="text-xs font-medium mb-1">{t("commandantIa.phone.recommendedActions")}</div>{result.aiResponse.recommendedActions.map((a: string, i: number) => <div key={i} className="text-xs text-muted-foreground ml-2">• {a}</div>)}</div>
                  )}
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">{t("commandantIa.phone.emptyResult")}</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {compileResult && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-amber-500" />{t("commandantIa.phone.compilationTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{compileResult.compilation?.summary}</p>
            {compileResult.createdTasks?.length > 0 && <div className="text-xs"><strong>{t("commandantIa.phone.createdTasks")}</strong> {compileResult.createdTasks.map((ct: any) => ct.title).join(", ")}</div>}
            {compileResult.createdEvents?.length > 0 && <div className="text-xs"><strong>{t("commandantIa.phone.createdEvents")}</strong> {compileResult.createdEvents.map((e: any) => e.title).join(", ")}</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EmailTab() {
  const [emailFrom, setEmailFrom] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [tone, setTone] = useState("professionnel");
  const [reply, setReply] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState("");
  const [compilation, setCompilation] = useState<any>(null);
  const [compilingEmails, setCompilingEmails] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const generateReply = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/email-smart-reply", { emailFrom, emailSubject, emailBody, tone });
      if (d.success) setReply(d.reply);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const compileEmails = async () => {
    setCompilingEmails(true);
    try {
      const emailList = emails.split("\n---\n").map(block => {
        const lines = block.trim().split("\n");
        return { from: lines[0] || "", subject: lines[1] || "", body: lines.slice(2).join("\n") };
      }).filter(e => e.from || e.subject);
      const d = await apiPost("/commandant/email-compile", { emails: emailList });
      if (d.success) setCompilation(d.compilation);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setCompilingEmails(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4 text-blue-500" />{t("commandantIa.email.smartTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">{t("commandantIa.email.from")}</Label><Input value={emailFrom} onChange={e => setEmailFrom(e.target.value)} placeholder="contact@entreprise.fr" /></div>
            <div><Label className="text-xs">{t("commandantIa.email.subject")}</Label><Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder={t("commandantIa.email.subjectPlaceholder")} /></div>
            <div><Label className="text-xs">{t("commandantIa.email.body")}</Label><Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} placeholder={t("commandantIa.email.bodyPlaceholder")} rows={4} /></div>
            <div><Label className="text-xs">{t("commandantIa.email.tone")}</Label>
              <Select value={tone} onValueChange={setTone}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="professionnel">{t("commandantIa.email.toneOpt.professionnel")}</SelectItem>
                <SelectItem value="formel">{t("commandantIa.email.toneOpt.formel")}</SelectItem>
                <SelectItem value="empathique">{t("commandantIa.email.toneOpt.empathique")}</SelectItem>
                <SelectItem value="commercial">{t("commandantIa.email.toneOpt.commercial")}</SelectItem>
                <SelectItem value="direct">{t("commandantIa.email.toneOpt.direct")}</SelectItem>
              </SelectContent></Select>
            </div>
            <Button onClick={generateReply} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}{t("commandantIa.email.generateBtn")}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("commandantIa.email.generatedTitle")}</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              {reply ? (
                <div className="space-y-3">
                  <div className="text-xs"><strong>{t("commandantIa.email.subjectLabel")}</strong> {reply.replySubject}</div>
                  <div className="flex gap-1 flex-wrap">
                    {reply.detectedIntent && <Badge variant="outline" className="text-[10px]">{reply.detectedIntent}</Badge>}
                    {reply.urgency && <Badge variant={reply.urgency === "haute" ? "destructive" : "secondary"} className="text-[10px]">{reply.urgency}</Badge>}
                    {reply.tone && <Badge className="text-[10px] bg-blue-100 text-blue-700">{reply.tone}</Badge>}
                  </div>
                  <div className="p-3 bg-muted rounded text-sm whitespace-pre-wrap">{reply.replyBody?.replace(/<[^>]*>/g, "") || reply.replyBody}</div>
                  {reply.suggestedActions?.length > 0 && (
                    <div className="space-y-1"><div className="text-xs font-semibold">{t("commandantIa.email.suggestedActions")}</div>{reply.suggestedActions.map((a: string, i: number) => <div key={i} className="text-xs text-muted-foreground">• {a}</div>)}</div>
                  )}
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">{t("commandantIa.email.emptyResult")}</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-purple-500" />{t("commandantIa.email.compileTitle")}</CardTitle>
          <CardDescription className="text-xs">{t("commandantIa.email.compileDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={emails} onChange={e => setEmails(e.target.value)} placeholder={t("commandantIa.email.compilePlaceholder")} rows={5} />
          <Button onClick={compileEmails} disabled={compilingEmails} className="bg-purple-600 hover:bg-purple-700">{compilingEmails ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}{t("commandantIa.email.compileBtn")}</Button>
          {compilation && (
            <div className="space-y-2">
              <div className="p-3 bg-purple-50 rounded text-sm">{compilation.globalSummary}</div>
              {compilation.priorityActions?.map((a: string, i: number) => <div key={i} className="text-xs flex items-center gap-1"><ArrowRight className="h-3 w-3 text-purple-500" />{a}</div>)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MeetingsTab() {
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("60");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const compileMeeting = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/meeting-compile", { meetingTitle: title, participants: participants.split(",").map(s => s.trim()), notes, duration: parseInt(duration), meetingType: "reunion" });
      if (d.success) { setResult(d); toast({ title: t("commandantIa.meetings.compiledTitle"), description: t("commandantIa.meetings.compiledDesc", { tasks: d.createdTasks?.length || 0, events: d.createdEvents?.length || 0, reminders: d.remindersCreated || 0 }) }); }
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-indigo-500" />{t("commandantIa.meetings.title")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">{t("commandantIa.meetings.titleLabel")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("commandantIa.meetings.titlePlaceholder")} /></div>
            <div><Label className="text-xs">{t("commandantIa.meetings.participants")}</Label><Input value={participants} onChange={e => setParticipants(e.target.value)} placeholder="Jean, Marie, Pierre" /></div>
            <div><Label className="text-xs">{t("commandantIa.meetings.duration")}</Label><Input value={duration} onChange={e => setDuration(e.target.value)} type="number" /></div>
            <div><Label className="text-xs">{t("commandantIa.meetings.notes")}</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("commandantIa.meetings.notesPlaceholder")} rows={6} /></div>
            <Button onClick={compileMeeting} disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Brain className="h-4 w-4 mr-2" />}{t("commandantIa.meetings.compileBtn")}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("commandantIa.meetings.reportTitle")}</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              {result ? (
                <div className="space-y-3">
                  <div className="p-3 bg-indigo-50 rounded text-sm font-medium">{result.compilation?.summary}</div>
                  {result.compilation?.keyDecisions?.length > 0 && (
                    <div><div className="text-xs font-semibold mb-1">{t("commandantIa.meetings.decisions")}</div>{result.compilation.keyDecisions.map((d: string, i: number) => <div key={i} className="text-xs ml-2">✓ {d}</div>)}</div>
                  )}
                  {result.createdTasks?.length > 0 && (
                    <div className="p-2 bg-emerald-50 rounded"><div className="text-xs font-semibold text-emerald-700 mb-1">{t("commandantIa.meetings.autoTasks")}</div>{result.createdTasks.map((ct: any, i: number) => <div key={i} className="text-xs">• {ct.title} [{ct.priority}]</div>)}</div>
                  )}
                  {result.createdEvents?.length > 0 && (
                    <div className="p-2 bg-blue-50 rounded"><div className="text-xs font-semibold text-blue-700 mb-1">{t("commandantIa.meetings.plannedFollowups")}</div>{result.createdEvents.map((e: any, i: number) => <div key={i} className="text-xs">• {e.title}</div>)}</div>
                  )}
                  {result.compilation?.nextSteps?.length > 0 && (
                    <div><div className="text-xs font-semibold mb-1">{t("commandantIa.meetings.nextSteps")}</div>{result.compilation.nextSteps.map((s: string, i: number) => <div key={i} className="text-xs ml-2"><ArrowRight className="h-3 w-3 inline mr-1" />{s}</div>)}</div>
                  )}
                  {result.compilation?.risks?.length > 0 && (
                    <div className="p-2 bg-red-50 rounded"><div className="text-xs font-semibold text-red-700">{t("commandantIa.meetings.risks")}</div>{result.compilation.risks.map((r: string, i: number) => <div key={i} className="text-xs text-red-600">⚠ {r}</div>)}</div>
                  )}
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">{t("commandantIa.meetings.empty")}</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TasksTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [interactionContent, setInteractionContent] = useState("");
  const [interactionType, setInteractionType] = useState("note");
  const [createResult, setCreateResult] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const loadOverdue = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/overdue-reminders", { sendEmails: false });
      if (d.success) setData(d);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const sendReminders = async () => {
    try {
      const d = await apiPost("/commandant/overdue-reminders", { sendEmails: true });
      if (d.success) toast({ title: t("commandantIa.tasks.remindersSentTitle"), description: t("commandantIa.tasks.remindersSentDesc", { count: d.emailsSent }) });
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
  };

  const autoCreate = async () => {
    setCreating(true);
    try {
      const d = await apiPost("/commandant/auto-create-from-interaction", { interactionType, content: interactionContent });
      if (d.success) { setCreateResult(d); toast({ title: t("commandantIa.toast.success"), description: t("commandantIa.tasks.autoCreateSuccess", { tasks: d.createdTasks?.length || 0, events: d.createdEvents?.length || 0 }) }); }
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setCreating(false);
  };

  useEffect(() => { loadOverdue(); }, []);

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" />{t("commandantIa.tasks.overdueTitle")}</CardTitle></CardHeader>
          <CardContent>
            {data ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 bg-red-50 rounded"><div className="text-lg font-bold text-red-600">{data.overdue?.tasks || 0}</div><div className="text-[10px]">{t("commandantIa.tasks.tasks")}</div></div>
                  <div className="p-2 bg-orange-50 rounded"><div className="text-lg font-bold text-orange-600">{data.overdue?.invoices || 0}</div><div className="text-[10px]">{t("commandantIa.tasks.invoices")}</div></div>
                  <div className="p-2 bg-blue-50 rounded"><div className="text-lg font-bold text-blue-600">{data.overdue?.events || 0}</div><div className="text-[10px]">{t("commandantIa.tasks.events")}</div></div>
                </div>
                {data.aiAnalysis?.dailySummary && <p className="text-xs bg-muted p-2 rounded">{data.aiAnalysis.dailySummary}</p>}
                {data.aiAnalysis?.criticalAlerts?.map((a: string, i: number) => <div key={i} className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{a}</div>)}
                <Button onClick={sendReminders} className="w-full bg-red-600 hover:bg-red-700"><Send className="h-4 w-4 mr-2" />{t("commandantIa.tasks.sendReminders")}</Button>
              </div>
            ) : <Skeleton className="h-40" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />{t("commandantIa.tasks.autoCreateTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select value={interactionType} onValueChange={setInteractionType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="email">{t("commandantIa.tasks.type.email")}</SelectItem>
              <SelectItem value="appel">{t("commandantIa.tasks.type.appel")}</SelectItem>
              <SelectItem value="reunion">{t("commandantIa.tasks.type.reunion")}</SelectItem>
              <SelectItem value="note">{t("commandantIa.tasks.type.note")}</SelectItem>
            </SelectContent></Select>
            <Textarea value={interactionContent} onChange={e => setInteractionContent(e.target.value)} placeholder={t("commandantIa.tasks.autoPlaceholder")} rows={5} />
            <Button onClick={autoCreate} disabled={creating} className="w-full">{creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}{t("commandantIa.tasks.extractBtn")}</Button>
            {createResult && (
              <div className="p-2 bg-emerald-50 rounded text-xs space-y-1">
                <div className="font-medium">{createResult.summary}</div>
                {createResult.createdTasks?.map((ct: any, i: number) => <div key={i}>{t("commandantIa.tasks.createdTaskLine", { title: ct.title })}</div>)}
                {createResult.createdEvents?.map((e: any, i: number) => <div key={i}>{t("commandantIa.tasks.createdEventLine", { title: e.title })}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FinanceTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiGet("/commandant/payment-overview");
      if (d.success) setData(d);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" />{t("commandantIa.finance.title")}</h2>
        <Button onClick={load} variant="outline" disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {data ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Card className="text-center p-3"><div className="text-xl font-bold text-emerald-600">{data.overview?.totalPaid?.toFixed(0) || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.finance.collected")}</div></Card>
            <Card className="text-center p-3"><div className="text-xl font-bold text-orange-600">{data.overview?.totalPending?.toFixed(0) || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.finance.pending")}</div></Card>
            <Card className="text-center p-3"><div className="text-xl font-bold text-red-600">{data.overview?.totalOverdue?.toFixed(0) || 0}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.finance.overdue")}</div></Card>
            <Card className="text-center p-3 border-2 border-amber-200"><div className="text-xl font-bold text-amber-600">{data.analysis?.healthScore || "?"}</div><div className="text-[10px] text-muted-foreground">{t("commandantIa.finance.healthScore")}</div></Card>
          </div>

          {data.analysis?.summary && <Card className="p-4 bg-gradient-to-r from-emerald-50 to-blue-50"><p className="text-sm">{data.analysis.summary}</p></Card>}
          {data.analysis?.cashFlowForecast && <Card className="p-4"><CardTitle className="text-sm mb-2 flex items-center gap-1"><TrendingUp className="h-4 w-4 text-blue-500" />{t("commandantIa.finance.cashFlow")}</CardTitle><p className="text-xs text-muted-foreground">{data.analysis.cashFlowForecast}</p></Card>}

          {data.analysis?.criticalActions?.length > 0 && (
            <Card className="border-red-200">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700">{t("commandantIa.finance.criticalActions")}</CardTitle></CardHeader>
              <CardContent>{data.analysis.criticalActions.map((a: string, i: number) => <div key={i} className="text-xs flex items-center gap-1 mb-1"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />{a}</div>)}</CardContent>
            </Card>
          )}

          {data.overdueInvoices?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">{t("commandantIa.finance.overdueInvoices")}</CardTitle></CardHeader>
              <CardContent><ScrollArea className="h-40">
                {data.overdueInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between p-2 text-xs border-b">
                    <div><span className="font-mono font-semibold">{inv.reference}</span> <span className="text-muted-foreground">{inv.clientName}</span></div>
                    <div className="flex items-center gap-2"><span className="font-bold text-red-600">{inv.remaining?.toFixed(2)} EUR</span><Badge variant="destructive" className="text-[10px]">{t("commandantIa.finance.daysOverdue", { days: inv.daysOverdue })}</Badge></div>
                  </div>
                ))}
              </ScrollArea></CardContent>
            </Card>
          )}
        </>
      ) : <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>}
    </div>
  );
}

function DriveTab() {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachmentName, setAttachmentName] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const sendFile = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/drive-send-file", { recipientEmail, subject, message, fileName });
      if (d.success) toast({ title: t("commandantIa.drive.sent"), description: d.message });
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const saveAttachment = async () => {
    setSaving(true);
    try {
      const d = await apiPost("/commandant/save-attachment-to-drive", { fileName: attachmentName, fileContent: "base64content", emailSubject });
      if (d.success) toast({ title: t("commandantIa.drive.saved"), description: d.message });
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setSaving(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Send className="h-4 w-4 text-blue-500" />{t("commandantIa.drive.sendTitle")}</CardTitle><CardDescription className="text-xs">{t("commandantIa.drive.sendDesc")}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">{t("commandantIa.drive.recipient")}</Label><Input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="contact@entreprise.fr" /></div>
            <div><Label className="text-xs">{t("commandantIa.drive.subject")}</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t("commandantIa.drive.subjectPlaceholder")} /></div>
            <div><Label className="text-xs">{t("commandantIa.drive.fileName")}</Label><Input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="rapport-mensuel.pdf" /></div>
            <div><Label className="text-xs">{t("commandantIa.drive.message")}</Label><Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={t("commandantIa.drive.messagePlaceholder")} rows={2} /></div>
            <Button onClick={sendFile} disabled={loading} className="w-full">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}{t("commandantIa.drive.sendBtn")}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><HardDrive className="h-4 w-4 text-emerald-500" />{t("commandantIa.drive.saveTitle")}</CardTitle><CardDescription className="text-xs">{t("commandantIa.drive.saveDesc")}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">{t("commandantIa.drive.fileName")}</Label><Input value={attachmentName} onChange={e => setAttachmentName(e.target.value)} placeholder="contrat-signe.pdf" /></div>
            <div><Label className="text-xs">{t("commandantIa.drive.originalEmail")}</Label><Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Re: Contrat de prestation" /></div>
            <Button onClick={saveAttachment} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <HardDrive className="h-4 w-4 mr-2" />}{t("commandantIa.drive.saveBtn")}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiGet("/commandant/employee-stats");
      if (d.success) setData(d);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="h-5 w-5 text-indigo-500" />{t("commandantIa.stats.title")}</h2>
        <Button onClick={load} variant="outline" disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {data ? (
        <>
          {data.analysis?.teamInsights && <Card className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50"><p className="text-sm">{data.analysis.teamInsights}</p>{data.analysis.trends && <p className="text-xs text-muted-foreground mt-2">{data.analysis.trends}</p>}</Card>}

          <div className="grid grid-cols-2 gap-4">
            {data.analysis?.topPerformers?.length > 0 && (
              <Card className="border-emerald-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-700 flex items-center gap-1"><Star className="h-4 w-4" />{t("commandantIa.stats.topPerformers")}</CardTitle></CardHeader>
                <CardContent>{data.analysis.topPerformers.map((p: any, i: number) => <div key={i} className="text-xs mb-1"><strong>{p.name}</strong>: {p.reason}</div>)}</CardContent>
              </Card>
            )}
            {data.analysis?.needsAttention?.length > 0 && (
              <Card className="border-amber-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-700 flex items-center gap-1"><Eye className="h-4 w-4" />{t("commandantIa.stats.needsAttention")}</CardTitle></CardHeader>
                <CardContent>{data.analysis.needsAttention.map((p: any, i: number) => <div key={i} className="text-xs mb-1"><strong>{p.name}</strong>: {p.issue} — <span className="text-amber-600">{p.suggestion}</span></div>)}</CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t("commandantIa.stats.detail")}</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-60">
                <div className="space-y-2">
                  {data.employees?.map((emp: any) => (
                    <div key={emp.id} className="flex items-center justify-between p-2 rounded border hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${emp.stats.productivityScore >= 70 ? "bg-emerald-500" : emp.stats.productivityScore >= 40 ? "bg-amber-500" : "bg-red-500"}`}>{emp.stats.productivityScore}</div>
                        <div><div className="text-sm font-medium">{emp.name}</div><div className="text-[10px] text-muted-foreground">{emp.role} - {emp.department || "N/A"}</div></div>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>✓ {emp.stats.tasksCompleted}</span>
                        <span className={emp.stats.tasksOverdue > 0 ? "text-red-500 font-semibold" : ""}>⚠ {emp.stats.tasksOverdue}</span>
                        <span>📞 {emp.stats.callsMade}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {data.analysis?.recommendations?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Sparkles className="h-4 w-4 text-amber-500" />{t("commandantIa.stats.aiRecommendations")}</CardTitle></CardHeader>
              <CardContent>{data.analysis.recommendations.map((r: string, i: number) => <div key={i} className="text-xs mb-1 flex items-center gap-1"><ArrowRight className="h-3 w-3 text-amber-500 shrink-0" />{r}</div>)}</CardContent>
            </Card>
          )}
        </>
      ) : <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>}
    </div>
  );
}

function PhotoTab() {
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [description, setDescription] = useState("");
  const [linkedEntity, setLinkedEntity] = useState("contact");
  const [linkedEntityId, setLinkedEntityId] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const detectLocation = () => {
    if (!navigator.geolocation) { toast({ title: t("commandantIa.toast.error"), description: t("commandantIa.photo.geoUnsupported"), variant: "destructive" }); return; }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLatitude(String(pos.coords.latitude)); setLongitude(String(pos.coords.longitude)); setDetecting(false); toast({ title: t("commandantIa.photo.positionDetected") }); },
      (err) => { setDetecting(false); toast({ title: t("commandantIa.photo.gpsError"), description: err.message, variant: "destructive" }); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const submitLocation = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/photo-location", {
        latitude: parseFloat(latitude), longitude: parseFloat(longitude), description,
        linkedEntity: linkedEntityId ? linkedEntity : null, linkedEntityId: linkedEntityId ? parseInt(linkedEntityId) : null,
      });
      if (d.success) { setResult(d); toast({ title: t("commandantIa.photo.locationSaved"), description: d.location?.address }); }
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Camera className="h-4 w-4 text-rose-500" />{t("commandantIa.photo.title")}</CardTitle><CardDescription className="text-xs">{t("commandantIa.photo.desc")}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={detectLocation} disabled={detecting} variant="outline" className="w-full border-rose-200 text-rose-700 hover:bg-rose-50">
              {detecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Navigation className="h-4 w-4 mr-2" />}
              {t("commandantIa.photo.detectBtn")}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">{t("commandantIa.photo.latitude")}</Label><Input value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="48.8566" /></div>
              <div><Label className="text-xs">{t("commandantIa.photo.longitude")}</Label><Input value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="2.3522" /></div>
            </div>
            <div><Label className="text-xs">{t("commandantIa.photo.description")}</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t("commandantIa.photo.descPlaceholder")} rows={2} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">{t("commandantIa.photo.linkTo")}</Label>
                <Select value={linkedEntity} onValueChange={setLinkedEntity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="contact">{t("commandantIa.photo.link.contact")}</SelectItem>
                  <SelectItem value="tache">{t("commandantIa.photo.link.tache")}</SelectItem>
                  <SelectItem value="appel">{t("commandantIa.photo.link.appel")}</SelectItem>
                </SelectContent></Select>
              </div>
              <div><Label className="text-xs">{t("commandantIa.photo.idOptional")}</Label><Input value={linkedEntityId} onChange={e => setLinkedEntityId(e.target.value)} placeholder={t("commandantIa.photo.idPlaceholder")} type="number" /></div>
            </div>
            <Button onClick={submitLocation} disabled={loading || (!latitude && !longitude)} className="w-full bg-rose-600 hover:bg-rose-700">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapPin className="h-4 w-4 mr-2" />}{t("commandantIa.photo.saveBtn")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4 text-blue-500" />{t("commandantIa.photo.resultTitle")}</CardTitle></CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="text-xs font-semibold text-blue-700 mb-1">{t("commandantIa.photo.detectedAddress")}</div>
                  <p className="text-sm">{result.location?.address}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>Lat: {result.location?.latitude}</div>
                  <div>Lng: {result.location?.longitude}</div>
                </div>
                {result.location?.mapUrl && (
                  <a href={result.location.mapUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <ExternalLink className="h-3 w-3" />{t("commandantIa.photo.viewMaps")}
                  </a>
                )}
                {result.metadata && (
                  <div className="p-2 bg-muted rounded text-xs space-y-1">
                    <div>{t("commandantIa.photo.time", { time: new Date(result.metadata.timestamp).toLocaleString("fr-FR") })}</div>
                    {result.metadata.linkedEntity && <div>{t("commandantIa.photo.linkedTo", { entity: result.metadata.linkedEntity, id: result.metadata.linkedEntityId })}</div>}
                    {result.metadata.description && <div>{t("commandantIa.photo.note", { note: result.metadata.description })}</div>}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <MapPin className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground">{t("commandantIa.photo.empty")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RappelsTab() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [reminderTaskId, setReminderTaskId] = useState("");
  const [reminderEmail, setReminderEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const { toast } = useToast();
  const { t } = useTranslation();

  const loadOverdueTasks = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/overdue-reminders", { sendEmails: false });
      if (d.success) {
        setTasks(d.aiAnalysis?.taskReminders || []);
      }
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const sendReminder = async (taskId: number) => {
    if (!reminderEmail) { toast({ title: t("commandantIa.rappels.emailRequired"), variant: "destructive" }); return; }
    setSendingId(taskId);
    try {
      const d = await apiPost("/commandant/send-task-reminder", { taskId, recipientEmail: reminderEmail, customMessage: customMessage || undefined });
      if (d.success) toast({ title: t("commandantIa.rappels.reminderSentTitle"), description: t("commandantIa.rappels.reminderSentDesc", { email: reminderEmail }) });
      else throw new Error(d.error || t("commandantIa.rappels.failed"));
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setSendingId(null);
  };

  const sendBulkReminders = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/overdue-reminders", { sendEmails: true });
      if (d.success) toast({ title: t("commandantIa.rappels.bulkSentTitle"), description: t("commandantIa.rappels.bulkSentDesc", { count: d.emailsSent || 0 }) });
    } catch (err: any) { toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  useEffect(() => { loadOverdueTasks(); }, []);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Bell className="h-5 w-5 text-orange-500" />{t("commandantIa.rappels.title")}</h2>
        <div className="flex gap-2">
          <Button onClick={loadOverdueTasks} variant="outline" disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={sendBulkReminders} disabled={loading} className="bg-orange-600 hover:bg-orange-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}{t("commandantIa.rappels.autoInvoiceBtn")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" />{t("commandantIa.rappels.aiDetected")}</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {tasks.length > 0 ? (
                <div className="space-y-2">
                  {tasks.map((rem: any, i: number) => (
                    <div key={i} className="p-2 border rounded-lg hover:bg-muted/50">
                      <div className="flex items-center justify-between">
                        <Badge variant={rem.urgency === "critique" ? "destructive" : rem.urgency === "haute" ? "default" : "secondary"} className="text-[10px]">{rem.urgency || t("commandantIa.rappels.defaultUrgency")}</Badge>
                        {rem.taskId && <span className="text-[10px] text-muted-foreground">#{rem.taskId}</span>}
                      </div>
                      <p className="text-xs mt-1">{rem.message}</p>
                      {rem.suggestedAction && <p className="text-[10px] text-muted-foreground mt-1 italic">{rem.suggestedAction}</p>}
                    </div>
                  ))}
                </div>
              ) : loading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
              ) : (
                <div className="text-center py-8"><CheckSquare className="h-8 w-8 mx-auto text-emerald-500 mb-2" /><p className="text-xs text-muted-foreground">{t("commandantIa.rappels.noReminders")}</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Send className="h-4 w-4 text-blue-500" />{t("commandantIa.rappels.individualTitle")}</CardTitle><CardDescription className="text-xs">{t("commandantIa.rappels.individualDesc")}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">{t("commandantIa.rappels.taskId")}</Label><Input placeholder="Ex: 42" type="number" value={reminderTaskId} onChange={e => setReminderTaskId(e.target.value)} /></div>
            <div><Label className="text-xs">{t("commandantIa.rappels.recipient")}</Label><Input value={reminderEmail} onChange={e => setReminderEmail(e.target.value)} placeholder="collaborateur@example.com" /></div>
            <div><Label className="text-xs">{t("commandantIa.rappels.customMessage")}</Label><Textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)} placeholder={t("commandantIa.rappels.customPlaceholder")} rows={3} /></div>
            <Button
              onClick={() => {
                const taskId = parseInt(reminderTaskId || "0");
                if (taskId > 0) sendReminder(taskId);
                else toast({ title: t("commandantIa.rappels.taskIdRequired"), variant: "destructive" });
              }}
              disabled={sendingId !== null}
              className="w-full"
            >
              {sendingId !== null ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Bell className="h-4 w-4 mr-2" />}{t("commandantIa.rappels.sendBtn")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function highlightMatches(text: string, query: string) {
  if (!text) return text;
  const terms = Array.from(new Set(
    query.split(/\s+/).map(t => t.trim()).filter(t => t.length > 0)
  ));
  if (terms.length === 0) return text;
  const escaped = terms
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="bg-amber-200 text-amber-950 rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

function entityTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case "contact": return t("commandantIa.entityType.contact");
    case "task": return t("commandantIa.entityType.task");
    case "event": return t("commandantIa.entityType.event");
    case "invoice": return t("commandantIa.entityType.invoice");
    case "prospect": return t("commandantIa.entityType.prospect");
    default: return t("commandantIa.entityType.default");
  }
}

function entityChipClass(type: string): string {
  switch (type) {
    case "contact": return "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100";
    case "task": return "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100";
    case "event": return "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100";
    case "invoice": return "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100";
    case "prospect": return "bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100";
    default: return "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100";
  }
}

function entityTypeIcon(type: string) {
  switch (type) {
    case "contact": return <Users className="h-3 w-3" />;
    case "task": return <CheckSquare className="h-3 w-3" />;
    case "event": return <Calendar className="h-3 w-3" />;
    case "invoice": return <DollarSign className="h-3 w-3" />;
    case "prospect": return <Target className="h-3 w-3" />;
    default: return <FileText className="h-3 w-3" />;
  }
}

function ChatTab() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [spokenText, setSpokenText] = useState("");
  const [input, setInput] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState<number | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Full demo transcript imported from the marketing site (slim {r,t} messages).
  // Rendered as collapsible prior context and sent with the first real message so
  // the Commandant's first answer accounts for the whole exchange.
  const [importedDemo, setImportedDemo] = useState<{ r: string; t: string }[] | null>(null);
  const [demoOpen, setDemoOpen] = useState(true);
  const { toast } = useToast();
  const { t } = useTranslation();

  // Cross-app handoff: when arriving from /tanitim/ demo, decode the visitor's
  // conversation and pre-fill the chat input with their last question + a short
  // context note so the assistant continues naturally. The conversation can
  // arrive two ways: the ?demo=BASE64 URL param, or — if that param was dropped
  // during the sign-up/login redirect — a short-lived localStorage key that the
  // marketing site writes on the same origin. The URL param wins; the
  // localStorage fallback is consumed (and cleared) only if no param is present.
  useEffect(() => {
    const applySlim = (slim: { r: string; t: string }[] | null): boolean => {
      if (!Array.isArray(slim) || slim.length === 0) return false;
      const clean = slim
        .filter((s) => s && (s.r === "u" || s.r === "a") && typeof s.t === "string" && s.t.trim())
        .map((s) => ({ r: s.r, t: String(s.t).slice(0, 400) }));
      const prompt = lastUserPrompt(clean);
      if (!prompt) return false;
      // Keep the full exchange so it can be shown as prior context and sent with
      // the first real message; still pre-fill the input with the last question.
      setImportedDemo(clean);
      setInput(`${t("commandantIa.chat.demoPrefix")} ${prompt}`);
      return true;
    };

    let imported = false;

    // 1) URL param (preferred — most precise, reflects the exact landing).
    try {
      const url = new URL(window.location.href);
      const raw = url.searchParams.get("demo");
      if (raw) {
        imported = applySlim(decodeHandoffParam(raw));
        url.searchParams.delete("demo");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
      }
    } catch {
      // ignore malformed handoff payloads
    }

    // 2) localStorage fallback (survives a dropped param through redirects).
    // consumeHandoff enforces the 30-min TTL and ALWAYS clears the key, so a
    // stale demo never leaks into a later, unrelated session.
    const storage = typeof window !== "undefined" ? window.localStorage : null;
    const fallback = consumeHandoff(storage, Date.now());
    if (!imported && fallback) imported = applySlim(fallback);

    if (imported) {
      toast({ title: t("commandantIa.chat.demoImportedTitle"), description: t("commandantIa.chat.demoImportedDesc") });
    }

    // Server-persisted handoff: survives the 30-min localStorage window and lets
    // a prospect resume on another device once the token is claimed. We claim
    // any token carried from the marketing site, then fetch the bound transcript
    // (which also works days later / on a fresh device with no token at all).
    (async () => {
      const TOKEN_KEY = "ajan.demo.token";
      let token = "";
      try {
        const url = new URL(window.location.href);
        token = url.searchParams.get("demo_token") || "";
        if (token) {
          url.searchParams.delete("demo_token");
          window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
        }
      } catch { /* ignore */ }
      if (!token) {
        try {
          const raw = window.localStorage.getItem(TOKEN_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { token?: string };
            if (typeof parsed.token === "string") token = parsed.token;
          }
        } catch { /* ignore */ }
      }
      // Clear the durable token regardless so it never leaks into a later session.
      try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }

      try {
        if (token) {
          await apiPost("/commandant/demo-handoff/claim", { token }).catch(() => {});
        }
        const d = await apiGet("/commandant/demo-handoff");
        const h = d?.handoff;
        if (h && Array.isArray(h.transcript)) {
          // Only apply if the instant (base64) path didn't already import a demo,
          // to avoid duplicating context — but always purge the server row.
          if (!imported && applySlim(h.transcript)) {
            imported = true;
            toast({ title: t("commandantIa.chat.demoImportedTitle"), description: t("commandantIa.chat.demoImportedDesc") });
          }
          if (typeof h.id === "number") {
            await apiPost("/commandant/demo-handoff/consume", { id: h.id }).catch(() => {});
          }
        }
      } catch { /* ignore — demo continuity is best-effort */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const d = await apiGet(`/commandant/conversations/search?q=${encodeURIComponent(q)}`);
        if (cancelled) return;
        if (d.success) setSearchResults(d.results || []);
      } catch (err: any) {
        if (cancelled) return;
        toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchQuery, toast]);

  const loadConversations = useCallback(async (selectFirst = false) => {
    setLoadingList(true);
    try {
      const d = await apiGet("/commandant/conversations");
      if (d.success) {
        setConversations(d.conversations || []);
        if (selectFirst && d.conversations?.length > 0 && selectedId === null) {
          setSelectedId(d.conversations[0].id);
        }
      }
    } catch (err: any) {
      toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  }, [selectedId, toast]);

  const loadMessages = useCallback(async (id: number) => {
    setLoadingMsgs(true);
    setMessages([]);
    try {
      const d = await apiGet(`/commandant/conversations/${id}/messages`);
      if (d.success) setMessages(d.messages || []);
    } catch (err: any) {
      toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setLoadingMsgs(false);
    }
  }, [toast]);

  useEffect(() => { loadConversations(true); }, []);
  useEffect(() => { if (selectedId) loadMessages(selectedId); }, [selectedId, loadMessages]);

  useEffect(() => {
    if (!pendingScrollMessageId || loadingMsgs) return;
    if (!messages.some(m => m.id === pendingScrollMessageId)) return;
    const targetId = pendingScrollMessageId;
    const handle = window.setTimeout(() => {
      const el = messageRefs.current.get(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMessageId(targetId);
        window.setTimeout(() => {
          setHighlightedMessageId(prev => prev === targetId ? null : prev);
        }, 2200);
      }
      setPendingScrollMessageId(null);
    }, 50);
    return () => window.clearTimeout(handle);
  }, [pendingScrollMessageId, loadingMsgs, messages]);

  const openSearchResult = (r: any) => {
    const targetMessageId = typeof r.messageId === "number" ? r.messageId : null;
    if (selectedId === r.conversationId) {
      if (targetMessageId) setPendingScrollMessageId(targetMessageId);
    } else {
      if (targetMessageId) setPendingScrollMessageId(targetMessageId);
      setSelectedId(r.conversationId);
    }
  };

  const newChat = async () => {
    try {
      const d = await apiPost("/commandant/conversations", {});
      if (d.success && d.conversation) {
        setConversations(prev => [d.conversation, ...prev]);
        setSelectedId(d.conversation.id);
        setMessages([]);
      }
    } catch (err: any) {
      toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    let convId = selectedId;
    if (!convId) {
      try {
        const d = await apiPost("/commandant/conversations", {});
        if (!d.success || !d.conversation) throw new Error(t("commandantIa.chat.cannotCreate"));
        convId = d.conversation.id;
        setConversations(prev => [d.conversation, ...prev]);
        setSelectedId(convId);
      } catch (err: any) {
        toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
        return;
      }
    }
    setInput("");
    // Attach the imported demo transcript only on the first real message of a
    // fresh exchange, so the Commandant's first answer accounts for it. Sent once
    // then cleared, so it never leaks into later turns or unrelated conversations.
    const demoContext = importedDemo && importedDemo.length && messages.length === 0
      ? importedDemo
      : null;
    const optimistic = { id: `tmp-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    setSending(true);
    try {
      const d = await apiPost(
        `/commandant/conversations/${convId}/messages`,
        demoContext ? { message: text, demoContext } : { message: text },
      );
      if (d.success) {
        setImportedDemo(null);
        setMessages(prev => {
          const without = prev.filter(m => m.id !== optimistic.id);
          return [...without, d.userMessage, d.assistantMessage];
        });
        if (d.assistantMessage?.content) setSpokenText(d.assistantMessage.content);
        if (d.conversation) {
          setConversations(prev => {
            const others = prev.filter(c => c.id !== d.conversation.id);
            return [d.conversation, ...others];
          });
        }
      }
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setInput(text);
      toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const startRename = (c: any) => { setRenamingId(c.id); setRenameValue(c.title); };
  const cancelRename = () => { setRenamingId(null); setRenameValue(""); };
  const saveRename = async (id: number) => {
    const title = renameValue.trim();
    if (!title) { cancelRename(); return; }
    try {
      const d = await apiPatch(`/commandant/conversations/${id}`, { title });
      if (d.success) {
        setConversations(prev => prev.map(c => c.id === id ? { ...c, title: d.conversation.title } : c));
      }
    } catch (err: any) {
      toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      cancelRename();
    }
  };

  const deleteConv = async (id: number) => {
    if (!(await confirmAction({ title: t("commandantIa.chat.deleteConfirm"), confirmLabel: t("common.delete"), destructive: true }))) return;
    try {
      await apiDelete(`/commandant/conversations/${id}`);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setMessages([]);
      }
    } catch (err: any) {
      toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:h-[calc(100vh-220px)] lg:min-h-[500px]">
      <Card className="col-span-3 flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-1"><MessageCircle className="h-4 w-4 text-amber-500" />{t("commandantIa.chat.conversations")}</CardTitle>
            <Button size="sm" variant="default" className="h-7 gap-1 bg-amber-600 hover:bg-amber-700" onClick={newChat}>
              <Plus className="h-3 w-3" />{t("commandantIa.chat.new")}
            </Button>
          </div>
          <div className="relative mt-2">
            <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t("commandantIa.chat.searchPlaceholder")}
              className="h-7 text-xs pl-7 pr-7"
            />
            {searchQuery && (
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-2">
          <ScrollArea className="h-full pr-2">
            {searchQuery.trim() ? (
              searching && searchResults.length === 0 ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  {t("commandantIa.chat.noSearchResults", { query: searchQuery })}
                </div>
              ) : (
                <div className="space-y-1">
                  {searchResults.map((r: any) => (
                    <div
                      key={`${r.conversationId}-${r.messageId ?? "title"}`}
                      className={`group rounded px-2 py-2 cursor-pointer text-xs ${selectedId === r.conversationId ? "bg-amber-50 border border-amber-200" : "hover:bg-muted/50"}`}
                      onClick={() => openSearchResult(r)}
                    >
                      <div className="font-medium truncate">{highlightMatches(r.title || "", searchQuery)}</div>
                      {r.snippet ? (
                        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          <span className="text-amber-600 mr-1">{r.role === "user" ? t("commandantIa.chat.you") : t("commandantIa.chat.ai")}</span>{highlightMatches(r.snippet, searchQuery)}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground mt-0.5">{t("commandantIa.chat.titleMatch")}</div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : loadingList && conversations.length === 0 ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                {t("commandantIa.chat.noConversations")}
              </div>
            ) : (
              <div className="space-y-1">
                {conversations.map(c => (
                  <div
                    key={c.id}
                    className={`group rounded px-2 py-2 cursor-pointer text-xs flex items-center gap-1 ${selectedId === c.id ? "bg-amber-50 border border-amber-200" : "hover:bg-muted/50"}`}
                    onClick={() => renamingId !== c.id && setSelectedId(c.id)}
                  >
                    {renamingId === c.id ? (
                      <>
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveRename(c.id); if (e.key === "Escape") cancelRename(); }}
                          className="h-6 text-xs flex-1"
                          onClick={e => e.stopPropagation()}
                        />
                        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={e => { e.stopPropagation(); saveRename(c.id); }}><Check className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={e => { e.stopPropagation(); cancelRename(); }}><X className="h-3 w-3" /></Button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{c.title}</div>
                          <div className="text-[10px] text-muted-foreground">{format(new Date(c.updatedAt), "d MMM HH:mm", { locale: fr })}</div>
                        </div>
                        <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={e => { e.stopPropagation(); startRename(c); }}><Edit2 className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100 text-red-500" onClick={e => { e.stopPropagation(); deleteConv(c.id); }}><Trash2 className="h-3 w-3" /></Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="col-span-9 flex flex-col">
        <CardHeader className="pb-2 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-amber-500" />
                {selectedId ? (conversations.find(c => c.id === selectedId)?.title || t("commandantIa.chat.conversationFallback")) : t("commandantIa.chat.commandantTitle")}
              </CardTitle>
              <CardDescription className="text-xs">{t("commandantIa.chat.subtitle")}</CardDescription>
            </div>
            <AvatarDock text={spokenText} accent="#f59e0b" storageKey="buro.commandant.voice" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
          <ScrollArea className="flex-1 p-4">
            {importedDemo && importedDemo.length > 0 && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60">
                <button
                  type="button"
                  onClick={() => setDemoOpen(o => !o)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-amber-800"
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("commandantIa.chat.importedConv", { count: importedDemo.length })}
                  </span>
                  {demoOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {demoOpen && (
                  <div className="space-y-2 px-3 pb-3">
                    {importedDemo.map((m, i) => (
                      <div key={i} className={`flex flex-col ${m.r === "u" ? "items-end" : "items-start"}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs whitespace-pre-wrap ${m.r === "u" ? "bg-amber-600/90 text-white" : "bg-white border border-amber-100 text-amber-900"}`}>
                          {m.t}
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] text-amber-700/80 pt-1">
                      {t("commandantIa.chat.importedNote")}
                    </p>
                  </div>
                )}
              </div>
            )}
            {loadingMsgs ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Sparkles className="h-10 w-10 mx-auto mb-3 text-amber-500 opacity-50" />
                <p className="text-sm">{t("commandantIa.chat.emptyTitle")}</p>
                <p className="text-xs mt-1">{t("commandantIa.chat.emptyExamples")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m: any) => {
                  const isHighlighted = typeof m.id === "number" && highlightedMessageId === m.id;
                  const entities: Array<{ id: number; type: string; label: string; url: string }> =
                    m.role === "assistant" && m.metadata?.retrievedEntities ? m.metadata.retrievedEntities : [];
                  return (
                    <div
                      key={m.id}
                      ref={el => {
                        if (typeof m.id !== "number") return;
                        if (el) messageRefs.current.set(m.id, el);
                        else messageRefs.current.delete(m.id);
                      }}
                      className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"} transition-all duration-500 ${isHighlighted ? "scale-[1.01]" : ""}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap transition-all duration-500 ${m.role === "user" ? "bg-amber-600 text-white" : "bg-muted"} ${isHighlighted ? "ring-2 ring-amber-400 ring-offset-2 shadow-lg" : ""}`}
                      >
                        {m.content}
                      </div>
                      {entities.length > 0 && (
                        <div className="mt-1.5 max-w-[80%] flex flex-wrap gap-1">
                          {entities.map((e) => (
                            <Link
                              key={`${e.type}-${e.id}`}
                              href={e.url}
                              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 ${entityChipClass(e.type)}`}
                              title={`${t("commandantIa.chat.open")} ${entityTypeLabel(e.type, t)}: ${e.label}`}
                            >
                              {entityTypeIcon(e.type)}
                              <span className="truncate max-w-[180px]">{e.label}</span>
                              <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />{t("commandantIa.chat.thinking")}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
          <div className="border-t p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={t("commandantIa.chat.inputPlaceholder")}
              rows={2}
              disabled={sending}
              className="flex-1 resize-none text-sm"
            />
            <Button onClick={sendMessage} disabled={sending || !input.trim()} className="bg-amber-600 hover:bg-amber-700 self-end">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CommandesTab() {
  const { toast } = useToast();
  const { t } = useTranslation();

  // Execute-command state
  const [command, setCommand] = useState("");
  const [cmdContext, setCmdContext] = useState<any>(null);
  const [cmdStreamText, setCmdStreamText] = useState("");
  const [cmdResult, setCmdResult] = useState<any>(null);
  const [cmdRunning, setCmdRunning] = useState(false);
  const cmdAbortRef = useRef<AbortController | null>(null);

  // Weekly digest state
  const [digestMetrics, setDigestMetrics] = useState<any>(null);
  const [digestStreamText, setDigestStreamText] = useState("");
  const [digestResult, setDigestResult] = useState<any>(null);
  const [digestRunning, setDigestRunning] = useState(false);
  const digestAbortRef = useRef<AbortController | null>(null);

  // See BriefingTab's identical cleanup above: unmounting mid-stream (tab
  // switch) must not leave the server streaming to an abandoned request.
  useEffect(() => {
    return () => {
      cmdAbortRef.current?.abort();
      digestAbortRef.current?.abort();
    };
  }, []);

  function tryParseJson(text: string): any | null {
    if (!text) return null;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }

  const runCommand = async () => {
    if (!command || command.trim().length < 3) return;
    setCmdRunning(true);
    setCmdContext(null);
    setCmdStreamText("");
    setCmdResult(null);
    const controller = new AbortController();
    cmdAbortRef.current = controller;
    try {
      await streamSse("/commandant/execute-command/stream", { command }, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === "context") {
            setCmdContext(data?.context || null);
          } else if (event === "token" && data?.chunk) {
            setCmdStreamText(prev => prev + data.chunk);
          } else if (event === "cached" && typeof data?.text === "string") {
            setCmdStreamText(data.text);
          } else if (event === "done") {
            const parsedResult = data?.result || tryParseJson(data?.text || "") || null;
            setCmdResult(parsedResult);
            const nextCtx = data?.context ?? parsedResult?.context ?? null;
            if (nextCtx) setCmdContext(nextCtx);
            setCmdStreamText("");
          } else if (event === "aborted") {
            if (data?.partialText) setCmdStreamText(data.partialText);
          } else if (event === "error") {
            setCmdStreamText("");
            toast({ title: t("commandantIa.toast.error"), description: data?.error || t("commandantIa.commandes.cmdFailed"), variant: "destructive" });
          }
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setCmdRunning(false);
      cmdAbortRef.current = null;
    }
  };

  const cancelCommand = () => {
    if (cmdAbortRef.current) {
      cmdAbortRef.current.abort();
      toast({ title: t("commandantIa.toast.cancelled"), description: t("commandantIa.commandes.cmdStopped") });
    }
  };

  const runDigest = async () => {
    setDigestRunning(true);
    setDigestMetrics(null);
    setDigestStreamText("");
    setDigestResult(null);
    const controller = new AbortController();
    digestAbortRef.current = controller;
    try {
      await streamSse("/commandant/weekly-digest/stream", {}, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === "metrics") {
            setDigestMetrics(data || null);
          } else if (event === "token" && data?.chunk) {
            setDigestStreamText(prev => prev + data.chunk);
          } else if (event === "cached" && typeof data?.text === "string") {
            setDigestStreamText(data.text);
          } else if (event === "done") {
            setDigestResult(data?.digest || null);
            setDigestStreamText("");
          } else if (event === "aborted") {
            if (data?.partialText) setDigestStreamText(data.partialText);
          } else if (event === "error") {
            setDigestStreamText("");
            toast({ title: t("commandantIa.toast.error"), description: data?.error || t("commandantIa.commandes.digestFailed"), variant: "destructive" });
          }
        },
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: t("commandantIa.toast.error"), description: err.message, variant: "destructive" });
    } finally {
      setDigestRunning(false);
      digestAbortRef.current = null;
    }
  };

  const cancelDigest = () => {
    if (digestAbortRef.current) {
      digestAbortRef.current.abort();
      toast({ title: t("commandantIa.toast.cancelled"), description: t("commandantIa.commandes.digestStopped") });
    }
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Execute command */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            {t("commandantIa.commandes.cmdTitle")}
          </CardTitle>
          <CardDescription className="text-xs">
            {t("commandantIa.commandes.cmdDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <Wand2 className="h-4 w-4 text-amber-500 shrink-0" />
            <Input
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !cmdRunning && runCommand()}
              placeholder={t("commandantIa.commandes.cmdPlaceholder")}
              className="flex-1 border-0 bg-transparent text-base focus-visible:ring-0 placeholder:text-muted-foreground/60"
            />
            <Button onClick={runCommand} disabled={cmdRunning} size="sm" className="bg-amber-600 hover:bg-amber-700">
              {cmdRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
            {cmdRunning && (
              <Button onClick={cancelCommand} size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {cmdContext && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(cmdContext).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-[10px]">
                  {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </Badge>
              ))}
            </div>
          )}

          {(cmdRunning || cmdStreamText) && !cmdResult && (
            <div className="text-xs text-muted-foreground p-3 bg-amber-50 rounded border border-amber-100 flex gap-2">
              {cmdRunning && <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0 mt-0.5" />}
              <span className="whitespace-pre-wrap break-words">{cmdStreamText || t("commandantIa.commandes.waiting")}</span>
            </div>
          )}

          {cmdResult && (
            <div className="space-y-2">
              {cmdResult.category && <Badge className="bg-amber-100 text-amber-800 text-xs">{cmdResult.category}</Badge>}
              {cmdResult.response && <p className="text-sm whitespace-pre-wrap">{cmdResult.response}</p>}
              {(() => {
                const followUps: any[] = Array.isArray(cmdResult.suggestedFollowUps)
                  ? cmdResult.suggestedFollowUps
                  : Array.isArray(cmdResult.suggestedActions)
                    ? cmdResult.suggestedActions
                    : [];
                if (followUps.length === 0) return null;
                return (
                  <div>
                    <Label className="text-xs">{t("commandantIa.commandes.followUps")}</Label>
                    <ul className="text-xs space-y-1 mt-1">
                      {followUps.map((a: any, i: number) => (
                        <li key={i} className="flex items-start gap-1.5"><ArrowRight className="h-3 w-3 mt-0.5 text-amber-500" />{typeof a === "string" ? a : a?.label || a?.command || JSON.stringify(a)}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly digest */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Coffee className="h-4 w-4 text-blue-500" />
              {t("commandantIa.commandes.digestTitle")}
            </CardTitle>
            <div className="flex gap-2">
              <Button onClick={runDigest} disabled={digestRunning} size="sm" className="bg-blue-600 hover:bg-blue-700">
                {digestRunning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                {t("commandantIa.commandes.generate")}
              </Button>
              {digestRunning && (
                <Button onClick={cancelDigest} size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <CardDescription className="text-xs">
            {t("commandantIa.commandes.digestDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {digestMetrics?.rawData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {digestMetrics.rawData.taches && (
                <div className="p-2 bg-emerald-50 rounded border border-emerald-100">
                  <div className="font-semibold">{t("commandantIa.commandes.taches")}</div>
                  <div className="text-muted-foreground">{t("commandantIa.commandes.tachesStat", { done: digestMetrics.rawData.taches.terminees, created: digestMetrics.rawData.taches.creees })}</div>
                </div>
              )}
              {digestMetrics.rawData.appels && (
                <div className="p-2 bg-blue-50 rounded border border-blue-100">
                  <div className="font-semibold">{t("commandantIa.commandes.appels")}</div>
                  <div className="text-muted-foreground">{t("commandantIa.commandes.appelsStat", { total: digestMetrics.rawData.appels.total, rate: digestMetrics.rawData.appels.tauxReponse })}</div>
                </div>
              )}
              {digestMetrics.rawData.factures && (
                <div className="p-2 bg-amber-50 rounded border border-amber-100">
                  <div className="font-semibold">{t("commandantIa.commandes.factures")}</div>
                  <div className="text-muted-foreground">{t("commandantIa.commandes.facturesStat", { paid: digestMetrics.rawData.factures.payees, overdue: digestMetrics.rawData.factures.enRetard })}</div>
                </div>
              )}
              {digestMetrics.rawData.contacts && (
                <div className="p-2 bg-violet-50 rounded border border-violet-100">
                  <div className="font-semibold">{t("commandantIa.commandes.contacts")}</div>
                  <div className="text-muted-foreground">{t("commandantIa.commandes.contactsStat", { count: digestMetrics.rawData.contacts.nouveaux })}</div>
                </div>
              )}
            </div>
          )}

          {(digestRunning || digestStreamText) && !digestResult && (
            <div className="text-xs text-muted-foreground p-3 bg-blue-50 rounded border border-blue-100 flex gap-2">
              {digestRunning && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0 mt-0.5" />}
              <span className="whitespace-pre-wrap break-words">{digestStreamText || t("commandantIa.commandes.waiting")}</span>
            </div>
          )}

          {digestResult && (
            <div className="space-y-3">
              {digestResult.headline && (
                <div className="flex items-center gap-2">
                  {typeof digestResult.weekScore === "number" && (
                    <Badge className="bg-blue-600 text-white">{digestResult.weekScore}/100</Badge>
                  )}
                  <h3 className="text-sm font-semibold">{digestResult.headline}</h3>
                </div>
              )}
              {digestResult.executiveSummary && <p className="text-sm text-muted-foreground">{digestResult.executiveSummary}</p>}
              {Array.isArray(digestResult.wins) && digestResult.wins.length > 0 && (
                <div>
                  <Label className="text-xs flex items-center gap-1"><Star className="h-3 w-3 text-emerald-500" />{t("commandantIa.commandes.wins")}</Label>
                  <ul className="text-xs space-y-1 mt-1">{digestResult.wins.map((w: string, i: number) => <li key={i}>• {w}</li>)}</ul>
                </div>
              )}
              {Array.isArray(digestResult.concerns) && digestResult.concerns.length > 0 && (
                <div>
                  <Label className="text-xs flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />{t("commandantIa.commandes.concerns")}</Label>
                  <ul className="text-xs space-y-1 mt-1">{digestResult.concerns.map((c: string, i: number) => <li key={i}>• {c}</li>)}</ul>
                </div>
              )}
              {Array.isArray(digestResult.topPriorities) && digestResult.topPriorities.length > 0 && (
                <div>
                  <Label className="text-xs flex items-center gap-1"><Target className="h-3 w-3 text-violet-500" />{t("commandantIa.commandes.priorities")}</Label>
                  <ul className="text-xs space-y-1 mt-1">{digestResult.topPriorities.map((p: string, i: number) => <li key={i}>• {p}</li>)}</ul>
                </div>
              )}
              {digestResult.outlook && (
                <div className="p-2 bg-blue-50 rounded text-xs">
                  <span className="font-semibold">{t("commandantIa.commandes.outlook")}</span>{digestResult.outlook}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
