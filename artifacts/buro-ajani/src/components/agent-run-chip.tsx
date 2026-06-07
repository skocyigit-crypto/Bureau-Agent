import { Link } from "wouter";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useAgentRunStatus } from "@/hooks/use-agent-run-status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Tâche #42 : pastille globale dans l'en-tête. Visible partout dès qu'une
// analyse multi-agents tourne pour l'organisation, avec la progression (ex.
// 4/10) et un retour en un clic vers la page Agents IA. Réservée aux comptes
// admin (l'endpoint de statut est lui-même protégé par `requireAdmin`).
export function AgentRunChip() {
  const { user } = useWorkspaceUser();
  const isAdmin = user.role === "super_admin" || user.role === "administrateur";
  const run = useAgentRunStatus(isAdmin);

  if (!isAdmin || !run.visible) return null;

  const failed = run.status === "failed";
  const cancelled = run.status === "cancelled";
  const finishedOk = !run.running && !failed && !cancelled;

  const label = `${run.completedAgents}/${run.totalAgents}`;
  const tooltip = run.running
    ? `Analyse multi-agents en cours (${label}) — cliquez pour voir le détail`
    : failed
      ? "L'analyse multi-agents a échoué — cliquez pour voir le détail"
      : cancelled
        ? "Analyse multi-agents annulée"
        : "Analyse multi-agents terminée";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/agents-ia"
          aria-label={tooltip}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            failed || cancelled
              ? "border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20"
              : finishedOk
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                : "border-purple-500/30 bg-purple-500/10 text-purple-600 hover:bg-purple-500/20"
          }`}
        >
          {run.running ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : failed || cancelled ? (
            <XCircle className="w-3.5 h-3.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          <span className="tabular-nums">{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
