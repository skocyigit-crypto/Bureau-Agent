import { AlertCircle, AlertTriangle, Lightbulb, CheckCircle2, Loader2, Brain } from "lucide-react";

interface ValidationResult {
  isValid: boolean;
  errors: { champ: string; message: string }[];
  warnings: { champ: string; message: string }[];
  suggestions: { champ: string; suggestion: string }[];
}

interface AiValidationFeedbackProps {
  result: ValidationResult | null;
  isValidating: boolean;
}

export function AiValidationFeedback({ result, isValidating }: AiValidationFeedbackProps) {
  if (isValidating) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/30">
        <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
        <span className="text-xs text-purple-700 dark:text-purple-300">Verification IA en cours...</span>
      </div>
    );
  }

  if (!result) return null;

  const hasIssues = result.errors.length > 0 || result.warnings.length > 0 || result.suggestions.length > 0;

  if (!hasIssues && result.isValid) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        <span className="text-xs text-emerald-700 dark:text-emerald-300">L'IA n'a detecte aucun probleme. Les donnees sont valides.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2">
        <Brain className="w-3.5 h-3.5 text-purple-500" />
        Retours de l'IA
      </div>

      {result.errors.map((e, i) => (
        <div key={`err-${i}`} className="flex items-start gap-2 text-xs">
          <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
          <div>
            <span className="font-medium text-destructive">{e.champ}:</span>{" "}
            <span className="text-foreground">{e.message}</span>
          </div>
        </div>
      ))}

      {result.warnings.map((w, i) => (
        <div key={`warn-${i}`} className="flex items-start gap-2 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium text-amber-600">{w.champ}:</span>{" "}
            <span className="text-foreground">{w.message}</span>
          </div>
        </div>
      ))}

      {result.suggestions.map((s, i) => (
        <div key={`sug-${i}`} className="flex items-start gap-2 text-xs">
          <Lightbulb className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium text-blue-600">{s.champ}:</span>{" "}
            <span className="text-foreground">{s.suggestion}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
