import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Brain, Send, X, Sparkles, Loader2, AlertTriangle, Lightbulb, Info, Zap, ChevronDown, ChevronUp, MessageCircle, Calculator, ChevronRight, Hash, Percent, TrendingUp, Ruler, Pi, BarChart2, DollarSign, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAskAiAssistant, useRequestAiSuggestions } from "@workspace/api-client-react";

interface MathResult {
  expression: string;
  type: string;
  result: string;
  steps: string[];
  unit?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  data?: { label: string; valeur: string }[];
  actions?: { label: string; description: string }[];
  mathDetected?: boolean;
  mathResults?: MathResult[];
  timestamp: Date;
}

const PAGE_MAP: Record<string, string> = {
  "/": "dashboard",
  "/appels": "calls",
  "/contacts": "contacts",
  "/taches": "tasks",
  "/messages": "messages",
  "/rapports": "rapports",
  "/logiciels": "logiciels",
  "/analyse": "dashboard",
  "/parametres": "dashboard",
  "/pointage": "pointage",
  "/utilisateurs": "utilisateurs",
};

export function AiAssistantButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 transition-all duration-300 flex items-center justify-center group hover:scale-105"
        title="Assistant IA"
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentPage = PAGE_MAP[location] || "dashboard";

  const askAssistant = useAskAiAssistant();
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

  const handleSend = () => {
    if (!input.trim() || askAssistant.isPending) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput("");

    askAssistant.mutate(
      { data: { question: input.trim(), currentPage } },
      {
        onSuccess: (response: any) => {
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: response.reponse,
            data: response.donnees,
            actions: response.actions,
            mathDetected: response.mathDetected,
            mathResults: response.mathResults,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, assistantMessage]);
        },
        onError: () => {
          setMessages(prev => [...prev, {
            role: "assistant",
            content: "Desole, une erreur s'est produite. Veuillez reessayer.",
            timestamp: new Date(),
          }]);
        },
      }
    );
  };

  const handleQuickQuestion = (question: string) => {
    setInput(question);
    setTimeout(() => {
      const userMessage: ChatMessage = { role: "user", content: question, timestamp: new Date() };
      setMessages(prev => [...prev, userMessage]);
      setInput("");

      askAssistant.mutate(
        { data: { question, currentPage } },
        {
          onSuccess: (response: any) => {
            setMessages(prev => [...prev, {
              role: "assistant",
              content: response.reponse,
              data: response.donnees,
              actions: response.actions,
              mathDetected: response.mathDetected,
              mathResults: response.mathResults,
              timestamp: new Date(),
            }]);
          },
          onError: () => {
            setMessages(prev => [...prev, {
              role: "assistant",
              content: "Desole, une erreur s'est produite.",
              timestamp: new Date(),
            }]);
          },
        }
      );
    }, 50);
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

  const getMathTypeIcon = (type: string) => {
    switch (type) {
      case "arithmetic": return <Hash className="w-3 h-3" />;
      case "percentage": return <Percent className="w-3 h-3" />;
      case "financial": return <DollarSign className="w-3 h-3" />;
      case "statistics": return <BarChart2 className="w-3 h-3" />;
      case "geometry": return <Pi className="w-3 h-3" />;
      case "conversion": return <ArrowRightLeft className="w-3 h-3" />;
      case "power": case "root": case "logarithm": return <TrendingUp className="w-3 h-3" />;
      case "trigonometry": return <Ruler className="w-3 h-3" />;
      default: return <Calculator className="w-3 h-3" />;
    }
  };

  const getMathTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      arithmetic: "Arithmetique", percentage: "Pourcentage", power: "Puissance",
      root: "Racine", logarithm: "Logarithme", trigonometry: "Trigonometrie",
      statistics: "Statistiques", financial: "Financier", conversion: "Conversion",
      geometry: "Geometrie", ratio: "Ratio", comparison: "Comparaison",
      fraction: "Fraction", equation: "Equation", date_calc: "Date",
    };
    return labels[type] || type;
  };

  const quickQuestions = [
    "Quel est le resume de la journee ?",
    "Combien d'appels manques cette semaine ?",
    "Quelles taches sont en retard ?",
    "Calcule 15% de 2500€ HT avec TVA",
  ];

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] h-[600px] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <Brain className="w-5 h-5" />
          <div>
            <h3 className="font-semibold text-sm">Assistant IA</h3>
            <p className="text-[11px] text-white/70">Gemini - Intelligence de bureau</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-white/80 hover:text-white hover:bg-white/20" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {requestSuggestions.data && requestSuggestions.data.suggestions.length > 0 && (
        <div className="border-b border-border">
          <button className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors" onClick={() => setShowSuggestions(!showSuggestions)}>
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              Suggestions IA ({requestSuggestions.data.suggestions.length})
            </span>
            {showSuggestions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showSuggestions && (
            <div className="px-3 pb-3 space-y-2 max-h-[200px] overflow-y-auto">
              {requestSuggestions.data.resumeCourt && (
                <p className="text-xs text-muted-foreground px-1 italic">{requestSuggestions.data.resumeCourt}</p>
              )}
              {requestSuggestions.data.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
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
          Analyse de la page en cours...
        </div>
      )}

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-purple-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Posez vos questions</p>
              <p className="text-xs text-muted-foreground">L'assistant connait les donnees de votre bureau en temps reel.</p>
            </div>
            <div className="w-full space-y-2 mt-2">
              {quickQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickQuestion(q)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted rounded-bl-md"
                }`}>
                  <p className="text-sm leading-relaxed">{msg.content}</p>

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

                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {msg.actions.map((a, j) => (
                        <div key={j} className="flex items-start gap-1.5 text-xs">
                          <Zap className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium">{a.label}</span>
                            <span className="text-muted-foreground"> - {a.description}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.mathDetected && msg.mathResults && msg.mathResults.length > 0 && (
                    <MathResultsPanel results={msg.mathResults} getMathTypeIcon={getMathTypeIcon} getMathTypeLabel={getMathTypeLabel} />
                  )}
                </div>
              </div>
            ))}
            {askAssistant.isPending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  <span className="text-sm text-muted-foreground">Analyse en cours...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-border p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-center gap-2"
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Posez une question sur votre bureau..."
            className="flex-1 h-9 text-sm bg-muted/50 border-none"
            disabled={askAssistant.isPending}
          />
          <Button
            type="submit"
            size="icon"
            className="h-9 w-9 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-full shrink-0"
            disabled={!input.trim() || askAssistant.isPending}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

function MathResultsPanel({ results, getMathTypeIcon, getMathTypeLabel }: {
  results: MathResult[];
  getMathTypeIcon: (type: string) => React.ReactNode;
  getMathTypeLabel: (type: string) => string;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Calculator className="w-3.5 h-3.5 text-blue-500" />
        <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">
          Analyse mathematique ({results.length} sous-composant{results.length > 1 ? "s" : ""})
        </span>
      </div>
      <div className="space-y-1.5">
        {results.map((mr, idx) => (
          <div key={idx} className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/30 overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors"
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
            >
              <span className="text-blue-600 dark:text-blue-400 shrink-0">
                {getMathTypeIcon(mr.type)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <code className="text-[11px] font-mono text-foreground truncate">{mr.expression}</code>
                  <Badge variant="outline" className="h-3.5 px-1 text-[8px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 shrink-0">
                    {getMathTypeLabel(mr.type)}
                  </Badge>
                </div>
              </div>
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300 shrink-0">
                = {mr.result}{mr.unit ? ` ${mr.unit}` : ""}
              </span>
              <ChevronRight className={`w-3 h-3 text-blue-400 shrink-0 transition-transform ${expandedIdx === idx ? "rotate-90" : ""}`} />
            </button>
            {expandedIdx === idx && mr.steps.length > 0 && (
              <div className="px-2 pb-2 pt-0.5 border-t border-blue-200/30 dark:border-blue-800/30">
                <div className="space-y-0.5">
                  {mr.steps.map((step, si) => (
                    <div key={si} className="flex items-start gap-1.5 text-[10px]">
                      <span className="text-blue-400 shrink-0 mt-px font-mono">{si + 1}.</span>
                      <span className="text-muted-foreground font-mono">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
