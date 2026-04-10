import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Brain, Send, X, Sparkles, Loader2, AlertTriangle, Lightbulb, Info, Zap, ChevronDown, ChevronUp, MessageCircle, Calculator, ChevronRight, Hash, Percent, TrendingUp, Ruler, Pi, BarChart2, DollarSign, ArrowRightLeft, Wand2, Navigation, Bell, RotateCcw, Activity, Target, Shield, Flame, ThumbsUp, Plus, UserPlus, CheckCircle2, ArrowUpCircle, MailCheck, BellRing, Package, ListChecks, ClipboardCheck, Mail, Calendar, FolderPlus, Search, FileText, Download, UserCheck, Edit, Globe, Briefcase, PhoneForwarded, RefreshCw, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRequestAiSuggestions } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: { label: string; type: string; target: string; details: string }[];
  insights?: string[];
  mood?: string;
  stats?: any;
  data?: { label: string; valeur: string }[];
  mathDetected?: boolean;
  mathResults?: MathResult[];
  timestamp: Date;
}

interface MathResult {
  expression: string;
  type: string;
  result: string;
  steps: string[];
  unit?: string;
}

const PAGE_MAP: Record<string, string> = {
  "/": "dashboard", "/appels": "calls", "/contacts": "contacts",
  "/taches": "tasks", "/messages": "messages", "/rapports": "rapports",
  "/logiciels": "logiciels", "/analyse": "dashboard", "/parametres": "dashboard",
  "/pointage": "pointage", "/utilisateurs": "utilisateurs",
  "/factures": "factures", "/stock": "stock", "/projets": "projets",
  "/calendrier": "calendrier", "/prospects": "prospects", "/devis": "devis",
};

const MOOD_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  positif: { icon: ThumbsUp, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  neutre: { icon: Activity, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/30" },
  alerte: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30" },
  critique: { icon: Flame, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/30" },
};

export function AiAssistantButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 transition-all duration-300 flex items-center justify-center group hover:scale-105"
        title="Assistant IA Elite"
      >
        <Brain className="w-6 h-6 group-hover:scale-110 transition-transform" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-white animate-pulse" />
      </button>
      {isOpen && <AiAssistantPanel onClose={() => setIsOpen(false)} />}
    </>
  );
}

function AiAssistantPanel({ onClose }: { onClose: () => void }) {
  const [location] = useLocation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const currentPage = PAGE_MAP[location] || "dashboard";
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const requestSuggestions = useRequestAiSuggestions();

  useEffect(() => {
    requestSuggestions.mutate({ data: { page: currentPage as any } });
  }, [currentPage]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: "user", content: text.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));

      const res = await fetch(`${BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text.trim(),
          context: { page: currentPage, location },
          history,
        }),
      });

      if (!res.ok) throw new Error("Erreur serveur");
      const data = await res.json();

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.message || "Reponse non disponible.",
        actions: data.actions || [],
        insights: data.insights || [],
        mood: data.mood || "neutre",
        stats: data.stats,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.warn("AI Chat error:", err);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Desole, une erreur s'est produite. Veuillez reessayer.",
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages, currentPage, location, BASE]);

  const handleSend = () => sendMessage(input);
  const handleQuickQuestion = (q: string) => sendMessage(q);

  const [executingAction, setExecutingAction] = useState<string | null>(null);

  const executeAiAction = async (type: string, target: string) => {
    const res = await fetch(`${BASE}/api/ai/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ type, target }),
    });
    if (!res.ok) throw new Error("Erreur d'execution");
    return res.json();
  };

  const handleAction = async (action: any) => {
    const actionKey = `${action.type}-${action.target}`;
    setExecutingAction(actionKey);
    try {
      if (action.type === "navigate" && action.target) {
        const target = String(action.target);
        if (target.startsWith("/") && !target.startsWith("//")) {
          window.location.href = target;
        }
        return;
      }

      if (action.type === "reminder") {
        toast({ title: "Rappel programme", description: action.details || action.label });
        return;
      }

      if (action.type === "auto_fix") {
        const res = await fetch(`${BASE}/api/ai/agents/auto-fix`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          toast({ title: "Corrections appliquees", description: `${data.totalFixes} corrections effectuees.` });
          setMessages(prev => [...prev, { role: "assistant", content: `Auto-correction terminee: ${data.totalFixes} corrections appliquees.`, mood: "positif", timestamp: new Date() }]);
        }
        return;
      }

      const executableTypes = ["create_task", "create_contact", "complete_task", "escalate_task", "bulk_escalate", "mark_messages_read", "send_notification", "stock_alert", "update_task", "bulk_complete_tasks", "update_contact", "search_contacts", "send_email", "create_event", "schedule_followup", "create_project", "update_project", "create_prospect", "update_prospect", "convert_prospect", "update_stock", "search_web", "generate_report", "search_all", "export_data"];
      if (executableTypes.includes(action.type)) {
        const result = await executeAiAction(action.type, action.target);
        if (result.success) {
          toast({ title: "Action executee", description: result.message });
          const extraContent = result.data ? `\n\n${typeof result.data === "string" ? result.data : (result.data.answer || result.data.content || JSON.stringify(result.data, null, 2))}` : "";
          setMessages(prev => [...prev, { role: "assistant", content: `${result.message}${extraContent}`, mood: "positif", timestamp: new Date() }]);
        } else {
          toast({ title: "Echec", description: result.message || "Action echouee.", variant: "destructive" });
        }
        return;
      }

      toast({ title: action.label, description: action.details || "Action non reconnue." });
    } catch (err) {
      console.warn("Action error:", err);
      toast({ title: "Erreur", description: "Impossible d'executer cette action.", variant: "destructive" });
    } finally {
      setExecutingAction(null);
    }
  };

  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case "urgence": return <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />;
      case "amelioration": return <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />;
      case "information": return <Info className="w-4 h-4 text-blue-500 shrink-0" />;
      case "action": return <Zap className="w-4 h-4 text-emerald-500 shrink-0" />;
      default: return <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />;
    }
  };

  const getPriorityColor = (priorite: string) => {
    switch (priorite) {
      case "haute": return "bg-destructive/10 text-destructive border-destructive/20";
      case "moyenne": return "bg-amber-500/10 text-amber-700 border-amber-500/20";
      case "basse": return "bg-blue-500/10 text-blue-700 border-blue-500/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case "auto_fix": return <Wand2 className="w-3 h-3" />;
      case "navigate": return <Navigation className="w-3 h-3" />;
      case "reminder": return <Bell className="w-3 h-3" />;
      case "create_task": return <Plus className="w-3 h-3" />;
      case "create_contact": return <UserPlus className="w-3 h-3" />;
      case "complete_task": return <CheckCircle2 className="w-3 h-3" />;
      case "escalate_task": return <ArrowUpCircle className="w-3 h-3" />;
      case "bulk_escalate": return <ListChecks className="w-3 h-3" />;
      case "mark_messages_read": return <MailCheck className="w-3 h-3" />;
      case "send_notification": return <BellRing className="w-3 h-3" />;
      case "stock_alert": return <Package className="w-3 h-3" />;
      case "send_email": return <Mail className="w-3 h-3" />;
      case "create_event": return <Calendar className="w-3 h-3" />;
      case "schedule_followup": return <PhoneForwarded className="w-3 h-3" />;
      case "create_project": return <FolderPlus className="w-3 h-3" />;
      case "update_project": return <Briefcase className="w-3 h-3" />;
      case "create_prospect": return <Target className="w-3 h-3" />;
      case "update_prospect": return <TrendingUp className="w-3 h-3" />;
      case "convert_prospect": return <UserCheck className="w-3 h-3" />;
      case "update_task": return <Edit className="w-3 h-3" />;
      case "update_contact": return <Edit className="w-3 h-3" />;
      case "update_stock": return <RefreshCw className="w-3 h-3" />;
      case "search_web": return <Globe className="w-3 h-3" />;
      case "search_contacts": case "search_all": return <Search className="w-3 h-3" />;
      case "generate_report": return <FileText className="w-3 h-3" />;
      case "export_data": return <Download className="w-3 h-3" />;
      case "bulk_complete_tasks": return <ClipboardCheck className="w-3 h-3" />;
      default: return <Zap className="w-3 h-3" />;
    }
  };

  const getActionColor = (type: string) => {
    switch (type) {
      case "create_task": case "update_task": return "from-emerald-50 to-green-50 dark:from-emerald-950/20 dark:to-green-950/20 border-emerald-200/50 dark:border-emerald-800/30 hover:from-emerald-100 hover:to-green-100";
      case "create_contact": case "update_contact": return "from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 border-blue-200/50 dark:border-blue-800/30 hover:from-blue-100 hover:to-cyan-100";
      case "complete_task": case "bulk_complete_tasks": return "from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200/50 dark:border-green-800/30 hover:from-green-100 hover:to-emerald-100";
      case "escalate_task": case "bulk_escalate": return "from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 border-orange-200/50 dark:border-orange-800/30 hover:from-orange-100 hover:to-amber-100";
      case "stock_alert": case "update_stock": return "from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 border-red-200/50 dark:border-red-800/30 hover:from-red-100 hover:to-rose-100";
      case "auto_fix": return "from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 border-violet-200/50 dark:border-violet-800/30 hover:from-violet-100 hover:to-purple-100";
      case "send_email": return "from-sky-50 to-blue-50 dark:from-sky-950/20 dark:to-blue-950/20 border-sky-200/50 dark:border-sky-800/30 hover:from-sky-100 hover:to-blue-100";
      case "create_event": case "schedule_followup": return "from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20 border-amber-200/50 dark:border-amber-800/30 hover:from-amber-100 hover:to-yellow-100";
      case "create_project": case "update_project": return "from-indigo-50 to-blue-50 dark:from-indigo-950/20 dark:to-blue-950/20 border-indigo-200/50 dark:border-indigo-800/30 hover:from-indigo-100 hover:to-blue-100";
      case "create_prospect": case "update_prospect": case "convert_prospect": return "from-pink-50 to-rose-50 dark:from-pink-950/20 dark:to-rose-950/20 border-pink-200/50 dark:border-pink-800/30 hover:from-pink-100 hover:to-rose-100";
      case "search_web": case "search_all": case "search_contacts": return "from-cyan-50 to-teal-50 dark:from-cyan-950/20 dark:to-teal-950/20 border-cyan-200/50 dark:border-cyan-800/30 hover:from-cyan-100 hover:to-teal-100";
      case "generate_report": case "export_data": return "from-slate-50 to-gray-50 dark:from-slate-950/20 dark:to-gray-950/20 border-slate-200/50 dark:border-slate-800/30 hover:from-slate-100 hover:to-gray-100";
      default: return "from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/20 border-purple-200/50 dark:border-purple-800/30 hover:from-purple-100 hover:to-indigo-100";
    }
  };

  const getActionIconColor = (type: string) => {
    switch (type) {
      case "create_task": case "update_task": return "text-emerald-500";
      case "create_contact": case "update_contact": return "text-blue-500";
      case "complete_task": case "bulk_complete_tasks": return "text-green-500";
      case "escalate_task": case "bulk_escalate": return "text-orange-500";
      case "stock_alert": case "update_stock": return "text-red-500";
      case "auto_fix": return "text-violet-500";
      case "mark_messages_read": return "text-teal-500";
      case "send_notification": return "text-amber-500";
      case "send_email": return "text-sky-500";
      case "create_event": case "schedule_followup": return "text-amber-600";
      case "create_project": case "update_project": return "text-indigo-500";
      case "create_prospect": case "update_prospect": case "convert_prospect": return "text-pink-500";
      case "search_web": case "search_all": case "search_contacts": return "text-cyan-500";
      case "generate_report": case "export_data": return "text-slate-500";
      default: return "text-purple-500";
    }
  };

  const quickQuestions = [
    "Donne-moi le briefing executif complet du jour",
    "Quelles sont les urgences a traiter maintenant ?",
    "Envoie un email de relance au dernier prospect",
    "Planifie un suivi pour les contacts inactifs",
    "Genere un rapport de performance global",
    "Cree un projet pour le nouveau client",
    "Quels prospects sont prets a convertir ?",
    "Recherche les tarifs du marche pour nos services",
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[440px] h-[650px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <div className="relative">
            <Brain className="w-5 h-5" />
            <Sparkles className="w-2.5 h-2.5 absolute -top-1 -right-1 text-yellow-300" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Assistant IA Elite</h3>
            <p className="text-[10px] text-white/70">IA Ultra · Email · CRM · Projets · Recherche · Actions</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20" onClick={() => setMessages([])} title="Nouvelle conversation">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {requestSuggestions.data && requestSuggestions.data.suggestions.length > 0 && (
        <div className="border-b border-border">
          <button className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors" onClick={() => setShowSuggestions(!showSuggestions)}>
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              Suggestions proactives ({requestSuggestions.data.suggestions.length})
            </span>
            {showSuggestions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showSuggestions && (
            <div className="px-3 pb-3 space-y-2 max-h-[180px] overflow-y-auto">
              {requestSuggestions.data.resumeCourt && (
                <p className="text-xs text-muted-foreground px-1 italic">{requestSuggestions.data.resumeCourt}</p>
              )}
              {requestSuggestions.data.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer" onClick={() => sendMessage(s.titre)}>
                  {getSuggestionIcon(s.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium truncate">{s.titre}</span>
                      <Badge variant="outline" className={`h-4 px-1 text-[9px] shrink-0 ${getPriorityColor(s.priorite)}`}>
                        {s.priorite}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{s.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {requestSuggestions.isPending && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
          Analyse contextuelle en cours...
        </div>
      )}

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 flex items-center justify-center">
              <Brain className="w-7 h-7 text-purple-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">Intelligence de Bureau</p>
              <p className="text-[11px] text-muted-foreground max-w-[280px]">
                Votre bureau, votre CRM, vos projets, vos emails — je gere tout. Demandez-moi n'importe quoi.
              </p>
            </div>
            <div className="w-full space-y-1.5 mt-1">
              {quickQuestions.map((q, i) => (
                <button key={i} onClick={() => handleQuickQuestion(q)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex items-center gap-2"
                >
                  <ChevronRight className="w-3 h-3 shrink-0 text-purple-400" />
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 ${msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted rounded-bl-md"
                }`}>
                  {msg.mood && msg.role === "assistant" && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {(() => {
                        const mc = MOOD_CONFIG[msg.mood] || MOOD_CONFIG.neutre;
                        const MoodIcon = mc.icon;
                        return (
                          <Badge variant="outline" className={`h-4 px-1.5 text-[9px] ${mc.color} ${mc.bg} border-current/20`}>
                            <MoodIcon className="w-2.5 h-2.5 mr-0.5" />
                            {msg.mood === "positif" ? "Tout va bien" : msg.mood === "alerte" ? "Attention requise" : msg.mood === "critique" ? "Action urgente" : "Normal"}
                          </Badge>
                        );
                      })()}
                    </div>
                  )}

                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                  {msg.insights && msg.insights.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      <div className="flex items-center gap-1 mb-1">
                        <Target className="w-3 h-3 text-violet-500" />
                        <span className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider">Insights</span>
                      </div>
                      {msg.insights.map((insight, j) => (
                        <div key={j} className="flex items-start gap-1.5 text-[11px]">
                          <Sparkles className="w-3 h-3 text-violet-400 mt-0.5 shrink-0" />
                          <span className="text-muted-foreground">{insight}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
                      <div className="flex items-center gap-1 mb-1">
                        <Zap className="w-3 h-3 text-amber-500" />
                        <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Actions executables ({msg.actions.length})</span>
                      </div>
                      {msg.actions.map((a, j) => {
                        const actionKey = `${a.type}-${a.target}`;
                        const isExecuting = executingAction === actionKey;
                        return (
                          <button key={j} onClick={() => handleAction(a)} disabled={isExecuting}
                            className={`w-full flex items-center gap-2 text-left text-xs p-2 rounded-lg bg-gradient-to-r ${getActionColor(a.type)} transition-all border ${isExecuting ? "opacity-60" : "hover:shadow-sm"}`}
                          >
                            <span className={`shrink-0 ${getActionIconColor(a.type)}`}>
                              {isExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : getActionIcon(a.type)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-foreground">{a.label}</span>
                              {a.details && <span className="text-muted-foreground ml-1 text-[10px]">— {a.details}</span>}
                            </div>
                            {isExecuting ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" /> : <ChevronRight className={`w-3 h-3 ${getActionIconColor(a.type)} shrink-0`} />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {msg.data && msg.data.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {msg.data.map((d, j) => (
                        <div key={j} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{d.label}</span>
                          <span className="font-semibold">{d.valeur}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.mathDetected && msg.mathResults && msg.mathResults.length > 0 && (
                    <MathResultsPanel results={msg.mathResults} />
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-sm text-muted-foreground">Analyse multi-IA en cours...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-border p-3">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Demandez n'importe quoi sur votre bureau..."
            className="flex-1 h-9 text-sm bg-muted/50 border-none"
            disabled={isLoading}
          />
          <Button
            type="submit" size="icon"
            className="h-9 w-9 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-full shrink-0"
            disabled={!input.trim() || isLoading}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

function MathResultsPanel({ results }: { results: MathResult[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const getMathTypeIcon = (type: string) => {
    switch (type) {
      case "arithmetic": return <Hash className="w-3 h-3" />;
      case "percentage": return <Percent className="w-3 h-3" />;
      case "financial": return <DollarSign className="w-3 h-3" />;
      case "statistics": return <BarChart2 className="w-3 h-3" />;
      case "geometry": return <Pi className="w-3 h-3" />;
      case "conversion": return <ArrowRightLeft className="w-3 h-3" />;
      default: return <Calculator className="w-3 h-3" />;
    }
  };

  const getMathTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      arithmetic: "Arithmetique", percentage: "Pourcentage", power: "Puissance",
      root: "Racine", logarithm: "Logarithme", trigonometry: "Trigonometrie",
      statistics: "Statistiques", financial: "Financier", conversion: "Conversion",
      geometry: "Geometrie",
    };
    return labels[type] || type;
  };

  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Calculator className="w-3.5 h-3.5 text-blue-500" />
        <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Calculs ({results.length})</span>
      </div>
      <div className="space-y-1.5">
        {results.map((mr, idx) => (
          <div key={idx} className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/30 overflow-hidden">
            <button className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors" onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}>
              <span className="text-blue-600 dark:text-blue-400 shrink-0">{getMathTypeIcon(mr.type)}</span>
              <div className="flex-1 min-w-0">
                <code className="text-[11px] font-mono text-foreground truncate">{mr.expression}</code>
              </div>
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300 shrink-0">= {mr.result}{mr.unit ? ` ${mr.unit}` : ""}</span>
              <ChevronRight className={`w-3 h-3 text-blue-400 shrink-0 transition-transform ${expandedIdx === idx ? "rotate-90" : ""}`} />
            </button>
            {expandedIdx === idx && mr.steps.length > 0 && (
              <div className="px-2 pb-2 pt-0.5 border-t border-blue-200/30 dark:border-blue-800/30">
                {mr.steps.map((step, si) => (
                  <div key={si} className="flex items-start gap-1.5 text-[10px]">
                    <span className="text-blue-400 shrink-0 mt-px font-mono">{si + 1}.</span>
                    <span className="text-muted-foreground font-mono">{step}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
