import { useState } from "react";
import { Brain, Sparkles, AlertTriangle, Lightbulb, Info, Zap, Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useRequestAiSuggestions, type RequestAiSuggestionsBodyPage } from "@workspace/api-client-react";

const VALID_PAGES: Record<string, RequestAiSuggestionsBodyPage> = {
  dashboard: "dashboard", calls: "calls", contacts: "contacts",
  tasks: "tasks", messages: "messages", rapports: "rapports", logiciels: "logiciels",
  pointage: "pointage", utilisateurs: "utilisateurs",
};

interface AiSuggestionsCardProps {
  page?: string;
  pageContext?: string;
  title?: string;
  compact?: boolean;
}

export function AiSuggestionsCard({ page, pageContext, title, compact = false }: AiSuggestionsCardProps) {
  const resolvedPage: RequestAiSuggestionsBodyPage = VALID_PAGES[page || pageContext || "dashboard"] ?? "dashboard";
  const [isExpanded, setIsExpanded] = useState(!compact);

  const suggestions = useRequestAiSuggestions();

  const handleLoad = () => {
    suggestions.mutate({ data: { page: resolvedPage } });
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

  const getPriorityBadge = (priorite: string) => {
    switch (priorite) {
      case "haute": return <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Haute</Badge>;
      case "moyenne": return <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-amber-500/20 text-amber-700">Moyenne</Badge>;
      case "basse": return <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-muted text-muted-foreground">Basse</Badge>;
      default: return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "urgence": return "Urgence";
      case "amelioration": return "Amelioration";
      case "information": return "Information";
      case "action": return "Action";
      default: return type;
    }
  };

  if (!suggestions.data && !suggestions.isPending) {
    return (
      <Card className="border-dashed border-purple-300/50 dark:border-purple-700/30 bg-gradient-to-br from-purple-50/50 to-indigo-50/30 dark:from-purple-950/20 dark:to-indigo-950/10">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/40 dark:to-indigo-900/30 flex items-center justify-center">
              <Brain className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Intelligence IA disponible</p>
              <p className="text-xs text-muted-foreground">Obtenez des suggestions personnalisees pour cette page</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleLoad}
            className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950/30"
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            Analyser
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-purple-200/50 dark:border-purple-800/30 bg-gradient-to-br from-purple-50/30 to-indigo-50/20 dark:from-purple-950/10 dark:to-indigo-950/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <CardTitle className="text-base">{title || "Suggestions IA"}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleLoad} disabled={suggestions.isPending}>
              <RefreshCw className={`w-3.5 h-3.5 ${suggestions.isPending ? 'animate-spin' : ''}`} />
            </Button>
            {compact && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            )}
          </div>
        </div>
        {suggestions.data?.resumeCourt && (
          <CardDescription className="text-xs italic mt-1">{suggestions.data.resumeCourt}</CardDescription>
        )}
      </CardHeader>

      {(isExpanded || !compact) && (
        <CardContent className="pt-0">
          {suggestions.isPending ? (
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
              <span className="text-sm text-muted-foreground">Analyse en cours...</span>
            </div>
          ) : suggestions.data?.suggestions && suggestions.data.suggestions.length > 0 ? (
            <div className="space-y-3">
              {suggestions.data.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-card/80 border border-border/50 hover:border-purple-200 dark:hover:border-purple-800/50 transition-colors">
                  {getSuggestionIcon(s.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{s.titre}</span>
                      {getPriorityBadge(s.priorite)}
                      <Badge variant="outline" className="h-5 px-1.5 text-[9px] text-muted-foreground">{getTypeLabel(s.type)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Aucune suggestion disponible pour le moment.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
